// src/mcp/mcpServer.js
// MCP SERVER - custom tools for GhostApply

import { chromium } from 'playwright'
import Groq from 'groq-sdk'
import * as cheerio from 'cheerio'
import axios from 'axios'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
}

// Tool Registry
export const tools = {
  fetch_founder_info,
  fetch_company_news,
  draft_cold_message,
  scrape_job_description,
}

function normalizeText(value = '') {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function companyTokens(companyName = '') {
  return normalizeText(companyName)
    .split(' ')
    .filter(token => token.length > 2 && !['pvt', 'ltd', 'llp', 'inc', 'com', 'jobs'].includes(token))
}

function cleanProfileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return rawUrl
  }
}

function unwrapSearchUrl(rawHref) {
  if (!rawHref) return ''
  try {
    const parsed = new URL(rawHref, 'https://duckduckgo.com')
    const wrapped = parsed.searchParams.get('uddg') || parsed.searchParams.get('u')
    return wrapped ? decodeURIComponent(wrapped) : parsed.href
  } catch {
    return rawHref
  }
}

function extractDomainFromUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function isDomainMatch(domainA, domainB) {
  if (!domainA || !domainB) return false
  const cleanA = domainA.toLowerCase().replace(/^www\./, '').trim()
  const cleanB = domainB.toLowerCase().replace(/^www\./, '').trim()
  if (cleanA === cleanB) return true
  if (cleanA.endsWith('.' + cleanB) || cleanB.endsWith('.' + cleanA)) return true
  return false
}

// --- Layer 1: Groq extraction from job description --------------------------
async function extractFromJobDescription(jobDescription) {
  if (!jobDescription || jobDescription.length < 100) return null
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `From the following job description, extract the name of any person mentioned:
- Hiring manager or recruiter
- Founder or co-founder ("Founded by X", "Started by X")
- Person to report to ("you'll work with X", "you'll report to X")
- Any email prefix that looks like a name (e.g. john@company.com -> "John")

If absolutely no person's name is found, respond with exactly: null

Job description:
${jobDescription.slice(0, 2000)}

Respond with ONLY the person's name (first + last if available) or null. No explanation.`
      }],
      temperature: 0,
      max_tokens: 30,
    })
    const extracted = response.choices[0].message.content.trim().replace(/['"]/g, '')
    if (extracted && extracted.toLowerCase() !== 'null' && extracted.split(' ').length <= 5) {
      return extracted
    }
    return null
  } catch {
    return null
  }
}

// --- Resolve company domain name from name/url -------------------------------
async function resolveCompanyDomain(companyName, companyUrl) {
  let domain = companyUrl ? extractDomainFromUrl(companyUrl) : null
  const jobBoards = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'naukri.com', 'instahyre.com']
  
  if (!domain || jobBoards.some(b => domain.includes(b))) {
    // 1. Try Clearbit Autocomplete API (Free, keyless, and very fast)
    try {
      console.log(`  -> Trying Clearbit autocomplete for: ${companyName}`)
      const cleanName = companyName.replace(/\b(pvt\.?\s*ltd|private limited|inc\.|llc|co\.)\b/gi, '').trim()
      const response = await axios.get(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(cleanName)}`, {
        timeout: 6000
      })
      if (response.data && response.data.length > 0) {
        const candidate = response.data[0].domain
        if (candidate && !jobBoards.some(b => candidate.includes(b))) {
          console.log(`  -> Clearbit resolved domain: ${candidate}`)
          return candidate
        }
      }
    } catch (err) {
      console.log(`  -> Clearbit autocomplete failed: ${err.message}`)
    }

    // 2. Fallback to Bing search
    try {
      console.log(`  -> Falling back to Bing search for: ${companyName}`)
      const query = `${companyName} official website India`
      const response = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
        headers: SEARCH_HEADERS, timeout: 8000,
      })
      const $ = cheerio.load(response.data)
      const firstResult = $('li.b_algo h2 a').first().attr('href')
      if (firstResult) {
        const candidate = extractDomainFromUrl(firstResult)
        if (candidate && !jobBoards.some(b => candidate.includes(b))) {
          console.log(`  -> Bing resolved domain: ${candidate}`)
          return candidate
        }
      }
    } catch { /* ignore */ }
  }

  // Final check: make sure we don't return a job board domain as the company's domain
  if (domain && jobBoards.some(b => domain.includes(b))) {
    return null
  }
  return domain
}

// --- Layer 2: Company website scrape ----------------------------------------
async function scrapeCompanyWebsite(domain) {
  if (!domain) return null

  const pagesToTry = [
    `https://${domain}/about`,
    `https://${domain}/team`,
    `https://${domain}/about-us`,
    `https://${domain}/founders`,
    `https://${domain}`,
  ]

  for (const pageUrl of pagesToTry) {
    try {
      const response = await axios.get(pageUrl, {
        headers: { ...SEARCH_HEADERS, 'Accept': 'text/html' },
        timeout: 7000,
        maxRedirects: 3,
      })
      const $ = cheerio.load(response.data)
      const text = $('body').text().replace(/\s+/g, ' ').slice(0, 5000)

      const founderPatterns = [
        /(?:founder|co-founder|ceo|chief executive|started by|founded by)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/gi,
        /([A-Z][a-z]+ [A-Z][a-z]+)[,\s]+(?:founder|co-founder|ceo|chief executive)/gi,
      ]
      for (const pattern of founderPatterns) {
        const match = pattern.exec(text)
        if (match?.[1] && match[1].length > 4 && match[1].length < 50) {
          return { name: match[1].trim(), source: 'website' }
        }
      }
    } catch { /* page not found or timeout, try next */ }
  }
  return null
}

// --- Layer 3: DuckDuckGo HTML search ----------------------------------------
function isLinkedInPersonUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('linkedin.com') && /^\/in\/[^/]+/.test(parsed.pathname)
  } catch {
    return false
  }
}

function scoreFounderCandidate(result, companyName) {
  const haystack = normalizeText(`${result.title} ${result.snippet}`)
  const url = result.url.toLowerCase()
  let score = 0

  if (isLinkedInPersonUrl(result.url)) score += 20
  if (/(^| )(founder|cofounder|co founder|ceo|cto|founding)( |$)/.test(haystack)) score += 12

  for (const token of companyTokens(companyName)) {
    if (haystack.includes(token)) score += 3
  }

  if (/\/company\/|\/jobs\/|\/pulse\/|\/posts\/|\/school\//.test(url)) score -= 20
  if (/recruiter|hiring|job|career/.test(haystack)) score -= 5

  return score
}

function parseFounderName(result) {
  const titleName = result.title
    .replace(/\s+\|\s+LinkedIn.*$/i, '')
    .replace(/\s+-\s+LinkedIn.*$/i, '')
    .replace(/\s+-\s+(Founder|Co-Founder|Cofounder|CEO|CTO|Chief).*$/i, '')
    .replace(/\s+@\s+.*$/i, '')
    .trim()

  if (titleName && titleName.split(/\s+/).length <= 5) return titleName

  const slug = result.url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]
  if (!slug) return null
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

// --- Resolve Google News RSS article redirects to get original destination URL ---
async function resolveGoogleNewsUrl(googleNewsUrl) {
  try {
    const response = await axios.get(googleNewsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 6000
    })
    const $ = cheerio.load(response.data)
    const data = $('c-wiz[data-p]').attr('data-p')
    if (!data) return googleNewsUrl
    
    const obj = JSON.parse(data.replace('%.@.', '["garturlreq",'))
    const payload = { 
      'f.req': JSON.stringify([[['Fbv4je', JSON.stringify([...obj.slice(0, -6), ...obj.slice(-2)]), 'null', 'generic']]]) 
    }

    const postResponse = await axios.post(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute', 
      new URLSearchParams(payload).toString(), 
      { 
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 6000
      }
    )

    const cleanedJson = postResponse.data.replace(/^\s*\)\]\}'\s*\n/, '')
    const parsed = JSON.parse(cleanedJson)
    const arrayString = parsed[0][2]
    return JSON.parse(arrayString)[1]
  } catch {
    return googleNewsUrl
  }
}

// --- Layer 3: Search LinkedIn via Google News (does not get blocked) --------
async function searchLinkedInViaGoogleNews(companyName) {
  const queries = [
    `"${companyName}" founder site:linkedin.com/in`,
    `"${companyName}" CEO site:linkedin.com/in`,
    `"${companyName}" site:linkedin.com/in`
  ]

  for (const query of queries) {
    try {
      const response = await axios.get(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
        { timeout: 8000 }
      )
      const $ = cheerio.load(response.data, { xmlMode: true })
      const items = []
      $('item').each((_, el) => {
        const title = $(el).find('title').text()
        const link = $(el).find('link').text()
        if (title && link) {
          items.push({ title, link })
        }
      })

      // Filter and resolve redirects for top 3 candidates
      const candidates = []
      for (const item of items.slice(0, 3)) {
        const resolvedUrl = await resolveGoogleNewsUrl(item.link)
        if (resolvedUrl && isLinkedInPersonUrl(resolvedUrl)) {
          candidates.push({
            title: item.title,
            url: resolvedUrl
          })
        }
      }

      if (candidates.length > 0) {
        const best = candidates[0]
        let name = best.title
          .replace(/\s+-\s+LinkedIn.*$/i, '')
          .replace(/\s+-\s+.*$/i, '')
          .replace(/\s+@\s+.*$/i, '')
          .trim()

        if (name && name.split(/\s+/).length <= 5) {
          return {
            name,
            linkedin: cleanProfileUrl(best.url),
            source: 'googlenews'
          }
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

// --- GetProspect LinkedIn Search (Enrich a contact directly by LinkedIn URL) ---
async function getprospectLinkedInSearch(linkedinUrl) {
  const apiKey = process.env.GETPROSPECT_API_KEY
  if (!apiKey) return null

  try {
    const response = await axios.get('https://api.getprospect.com/public/v1/insights/contact', {
      params: {
        linkedinUrl
      },
      headers: {
        'apiKey': apiKey,
        'Accept': 'application/json'
      },
      timeout: 8000
    })

    const data = response.data
    if (data) {
      return {
        name: [data.firstName, data.lastName].filter(Boolean).join(' ') || null,
        email: data.email || null,
        position: data.company?.position || null,
        domain: data.company?.domain || null,
        linkedin: linkedinUrl
      }
    }
    return null
  } catch (err) {
    console.error('  [GetProspect LinkedIn] Error:', err.response?.data || err.message)
    return null
  }
}

// --- GetProspect Person Search (Enrich a contact by name and domain) ---------
async function getprospectPersonSearch(firstName, lastName, domain) {
  const apiKey = process.env.GETPROSPECT_API_KEY
  if (!apiKey) return null

  try {
    const response = await axios.post('https://api.getprospect.com/api/v1/insights/search', {
      filter: {
        first_name: firstName,
        last_name: lastName,
        company_domains: [domain]
      }
    }, {
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    })

    const insightId = response.data?.id
    if (!insightId) return null

    // Wait a brief moment for processing
    await new Promise(resolve => setTimeout(resolve, 2000))

    const contactsResponse = await axios.get(`https://api.getprospect.com/api/v1/insights/search/contact/${insightId}`, {
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    })

    const contacts = contactsResponse.data?.data || []
    const best = contacts[0]
    if (best) {
      return {
        name: [best.firstName, best.lastName].filter(Boolean).join(' ') || null,
        email: best.email || null,
        position: best.position || null,
        linkedin: best.linkedInUrl || null
      }
    }
    return null
  } catch (err) {
    console.error('  [GetProspect Person] Error:', err.response?.data || err.message)
    return null
  }
}

// --- GetProspect Domain Search (Find key contacts by domain) ----------------
async function getprospectDomainSearch(domain) {
  const apiKey = process.env.GETPROSPECT_API_KEY
  if (!apiKey) return null

  try {
    const response = await axios.post('https://api.getprospect.com/api/v1/insights/search', {
      filter: {
        company_domains: [domain]
      }
    }, {
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    })

    const insightId = response.data?.id
    if (!insightId) return null

    // Wait a brief moment for processing
    await new Promise(resolve => setTimeout(resolve, 2000))

    const contactsResponse = await axios.get(`https://api.getprospect.com/api/v1/insights/search/contact/${insightId}`, {
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/json'
      },
      params: {
        pageSize: 5,
        pageNumber: 1
      },
      timeout: 8000
    })

    const contacts = contactsResponse.data?.data || []
    if (contacts.length === 0) return null

    const priority = ['founder', 'ceo', 'cto', 'co-founder', 'hiring manager', 'recruiter', 'talent acquisition']
    const sorted = contacts.sort((a, b) => {
      const aScore = priority.findIndex(p => (a.position || '').toLowerCase().includes(p))
      const bScore = priority.findIndex(p => (b.position || '').toLowerCase().includes(p))
      return (aScore === -1 ? 99 : aScore) - (bScore === -1 ? 99 : bScore)
    })

    const best = sorted[0]
    if (best) {
      return {
        name: [best.firstName, best.lastName].filter(Boolean).join(' ') || null,
        email: best.email || null,
        position: best.position || null,
        linkedin: best.linkedInUrl || null
      }
    }
    return null
  } catch (err) {
    console.error('  [GetProspect Domain] Error:', err.response?.data || err.message)
    return null
  }
}

// --- Tool: Fetch Founder Info -----------------------------------------------
export async function fetch_founder_info({ companyName, companyUrl, jobDescription }) {
  console.log(`MCP: fetching founder info for ${companyName}...`)

  const founderData = { name: null, linkedin: null, email: null, bio: null, enrichmentLayer: null }

  // Resolve real company domain first (so Layer 2 and Layer 4 don't get skipped on job board links)
  const realDomain = await resolveCompanyDomain(companyName, companyUrl)
  if (realDomain) {
    console.log(`  -> Resolved company domain: ${realDomain}`)
  }

  // LAYER 1: Groq extraction from job description (free, no API needed)
  console.log('  [Layer 1] Groq JD extraction...')
  const jdName = await extractFromJobDescription(jobDescription)
  if (jdName) {
    founderData.name = jdName
    founderData.enrichmentLayer = 'jd_extraction'
    console.log(`  -> Layer 1 found: ${jdName}`)
  }

  // LAYER 2: Company website scrape (free)
  if (!founderData.name && realDomain) {
    console.log('  [Layer 2] Company website scrape...')
    const websiteResult = await scrapeCompanyWebsite(realDomain)
    if (websiteResult?.name) {
      founderData.name = websiteResult.name
      founderData.enrichmentLayer = 'website'
      console.log(`  -> Layer 2 found: ${websiteResult.name}`)
    } else {
      console.log('  -> Layer 2: no founder name found on website')
    }
  }

  // LAYER 3: Google News search for LinkedIn profile
  if (!founderData.name || !founderData.linkedin) {
    console.log('  [Layer 3] Google News LinkedIn search...')
    const newsResult = await searchLinkedInViaGoogleNews(companyName)
    if (newsResult) {
      if (!founderData.name && newsResult.name) founderData.name = newsResult.name
      if (!founderData.linkedin && newsResult.linkedin) founderData.linkedin = newsResult.linkedin
      founderData.enrichmentLayer = founderData.enrichmentLayer || 'googlenews'
      console.log(`  -> Layer 3 found: ${newsResult.name || 'no name'} / ${newsResult.linkedin || 'no LI'}`)
    } else {
      console.log('  -> Layer 3: no results')
    }
  }

  // LAYER 4: GetProspect (only if GETPROSPECT_API_KEY is set)
  if (!founderData.name || !founderData.email || !founderData.linkedin) {
    console.log('  [Layer 4] GetProspect contact search...')
    const apiKey = process.env.GETPROSPECT_API_KEY
    const validDomain = realDomain && !['linkedin.com', 'indeed.com', 'glassdoor.com', 'naukri.com'].some(b => realDomain.includes(b)) ? realDomain : null

    if (apiKey) {
      let gpResult = null

      // Case A: If we already have a LinkedIn URL (from Layer 3), enrich it directly!
      if (founderData.linkedin) {
        console.log(`  -> Enriching existing LinkedIn URL on GetProspect: ${founderData.linkedin}`)
        const enrichResult = await getprospectLinkedInSearch(founderData.linkedin)
        if (enrichResult) {
          if (enrichResult.domain && validDomain && !isDomainMatch(enrichResult.domain, validDomain)) {
            console.log(`  -> Warning: GetProspect contact domain (${enrichResult.domain}) does not match company domain (${validDomain}). Mismatch detected. Discarding Layer 3 contact.`)
            founderData.name = null
            founderData.linkedin = null
            founderData.enrichmentLayer = null
          } else {
            gpResult = enrichResult
          }
        }
      }

      // Case B: We have a name from Layer 1/2/3, match them on domain
      if (!gpResult && founderData.name && validDomain) {
        const tokens = founderData.name.split(' ')
        const firstName = tokens[0]
        const lastName = tokens.slice(1).join(' ') || ''
        console.log(`  -> Matching existing contact name on GetProspect: ${founderData.name} @ ${validDomain}`)
        gpResult = await getprospectPersonSearch(firstName, lastName, validDomain)
      }

      // Case C: We don't have a name yet, search by domain
      if (!gpResult && validDomain) {
        console.log(`  -> Searching GetProspect for domain contacts: ${validDomain}`)
        gpResult = await getprospectDomainSearch(validDomain)
      }

      if (gpResult) {
        if (!founderData.name && gpResult.name) founderData.name = gpResult.name
        if (!founderData.email && gpResult.email) founderData.email = gpResult.email
        if (!founderData.linkedin && gpResult.linkedin) founderData.linkedin = gpResult.linkedin
        founderData.enrichmentLayer = founderData.enrichmentLayer || 'getprospect'
        console.log(`  -> Layer 4 found: ${founderData.name || 'no name'} / ${founderData.email || 'no email'} / ${founderData.linkedin || 'no LI'}`)
      } else {
        console.log('  -> Layer 4: GetProspect returned no results')
      }
    } else {
      console.log('  -> Layer 4: skipped (GetProspect API key not set)')
    }
  }

  console.log(`  -> Final: name=${founderData.name}, linkedin=${founderData.linkedin}, email=${founderData.email}`)
  return founderData
}

// --- Tool: Fetch Company News -----------------------------------------------
export async function fetch_company_news({ companyName }) {
  console.log(`MCP: fetching news for ${companyName}...`)

  const queries = [
    `"${companyName}" 2024 OR 2025`,
    `${companyName} hiring technology 2024 2025`,
  ]

  for (const rawQuery of queries) {
    try {
      const query = encodeURIComponent(rawQuery)
      const response = await axios.get(
        `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
        { timeout: 10000 }
      )

      const $ = cheerio.load(response.data, { xmlMode: true })
      const articles = []

      $('item').slice(0, 3).each((_, el) => {
        articles.push({
          title: $(el).find('title').text(),
          link: $(el).find('link').text(),
          pubDate: $(el).find('pubDate').text(),
        })
      })

      if (articles.length > 0) {
        const summary = articles.map(a => a.title).join('. ')
        console.log(`  Found ${articles.length} articles (query: "${rawQuery}")`)
        return { articles, summary }
      }
    } catch (err) {
      console.error('  News fetch error:', err.message)
    }
  }

  console.log('  No articles found across all queries')
  return { articles: [], summary: '' }
}

// --- Tool: Draft Cold Message -----------------------------------------------
// Detects whether we found a real founder/exec name or not, and adapts the
// tone accordingly: startup founder -> personal cold DM; large company -> recruiter/hiring-manager note.
export async function draft_cold_message({
  founderName,
  companyName,
  jobTitle,
  jobDescription,
  resumeSummary,
  talkingPoint,
  companyNews,
}) {
  console.log(`MCP: drafting cold message for ${companyName}...`)

  const hasFounder = !!(founderName && founderName.trim())
  const firstName = hasFounder ? founderName.split(' ')[0] : 'Hi'
  const newsContext = companyNews || ''

  // Detect large-company signals using POSITIVE evidence only.
  const largeCompanyNamePatterns = [
    /\b(pvt\.?\s*ltd|private limited)\b/i,
    /\b(technologies|solutions|consulting|systems)\b/i,
    /\b(global|worldwide|international|group|corp|corporation)\b/i,
  ]
  const knownLargeCorps = [
    'tcs', 'infosys', 'wipro', 'hcl', 'cognizant', 'accenture', 'capgemini',
    'ibm', 'deloitte', 'synechron', 'mphasis', 'hexaware', 'mindtree',
    'tech mahindra', 'ltimindtree', 'persistent', 'zensar', 'coforge',
    'birlasoft', 'mastech', 'niit technologies',
  ]
  const nameLower = companyName.toLowerCase()
  const isKnownLargeCorp = knownLargeCorps.some(c => nameLower.includes(c))
  const hasLargeNamePattern = largeCompanyNamePatterns.some(r => r.test(companyName))

  const looksLikeLargeCompany = isKnownLargeCorp || hasLargeNamePattern

  const prompt = looksLikeLargeCompany
    ? `Write a short LinkedIn note from a job applicant to a hiring manager or recruiter at a technology company.

APPLICANT BACKGROUND:
${resumeSummary}

COMPANY: ${companyName}
ROLE APPLYING FOR: ${jobTitle}
KEY TALKING POINT FROM JD: ${talkingPoint || ''}
RECENT COMPANY NEWS: ${newsContext}

RULES:
- ${hasFounder ? `Address them as "${firstName}"` : 'Open with "Hi" - no name since we don\'t have a specific contact'}
- Under 100 words total
- Sound like a human, not a cover letter
- Mention ONE specific thing about the role or company that genuinely interests you
- ONE concrete thing from your background that matches what they need
- Clear ask: expressing interest and asking if there's a fit
- No buzzwords like "synergy", "leverage", "passionate", "results-driven"
- No "I hope this message finds you well"
- End with a question

Write ONLY the message, no subject line, no preamble:`
    : `Write a cold outreach message from a job applicant to ${hasFounder ? `the founder of a startup` : `someone at a startup`} on LinkedIn.

APPLICANT BACKGROUND:
${resumeSummary}

${hasFounder ? `FOUNDER: ${founderName}` : `COMPANY CONTACT: unknown - address the message to the team generically`}
COMPANY: ${companyName}
ROLE APPLYING FOR: ${jobTitle}
KEY TALKING POINT FROM JD: ${talkingPoint || ''}
RECENT COMPANY NEWS: ${newsContext}

RULES:
- ${hasFounder ? `Address them as "${firstName}"` : 'Open with "Hi" - do NOT invent a name. Address it to the team at the company.'}
- Under 120 words total
- Sound human, not like a template
- ONE specific thing about their product/company (not generic flattery)
- ONE specific thing from applicant's background that's relevant
- Clear ask: 15-minute call
- No buzzwords like "synergy", "leverage", "passionate"
- No "I hope this message finds you well"
- End with a question, not a statement

Write ONLY the message, no subject line, no preamble:`

  console.log(`  Tone: ${looksLikeLargeCompany ? 'recruiter/hiring-manager (large company)' : `startup${hasFounder ? ` - founder: ${founderName}` : ' - no founder found, generic greeting'}`}`)

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  })

  const message = response.choices[0].message.content.trim()
  console.log('  Draft ready')
  return { message }
}

// --- Tool: Scrape Job Description -------------------------------------------
export async function scrape_job_description({ url }) {
  console.log(`MCP: scraping JD from ${url}...`)

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(2000)

    const description = await page.evaluate(() => {
      const bodyText = document.body.innerText.trim()
      const aboutJobIndex = bodyText.search(/about the job/i)
      const aboutCompanyIndex = bodyText.search(/about the company/i)

      if (aboutJobIndex >= 0) {
        const endIndex = aboutCompanyIndex > aboutJobIndex ? aboutCompanyIndex : bodyText.length
        return bodyText.slice(aboutJobIndex, endIndex).trim()
      }

      const selectors = [
        '[data-test="job-description"]',
        '.job-description',
        '.description__text',
        '.show-more-less-html__markup',
        '[class*="jobDescription"]',
        'article',
        'main'
      ]

      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (el?.innerText?.length > 200) return el.innerText.trim()
      }

      return bodyText.slice(0, 5000)
    })

    return { description }
  } finally {
    await browser.close()
  }
}

// --- MCP Request Handler ----------------------------------------------------
export async function handleMCPRequest(toolName, params) {
  const tool = tools[toolName]
  if (!tool) throw new Error(`Unknown MCP tool: ${toolName}`)
  return await tool(params)
}
