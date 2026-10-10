// src/agents/huntAgent.js
// HUNT AGENT - scrapes Indeed + LinkedIn for fresh jobs daily

import { chromium } from 'playwright'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { prisma } from '../db/client.js'
import { generateEmbedding } from '../utils/embeddings.js'
import { saveJobEmbedding } from '../db/client.js'

const INDEED_PAGES_PER_QUERY = 2
const INDEED_SEARCH_KEYWORDS = [
  'fresher software engineer',
  'junior backend developer node js',
  'backend developer node js fresher',
  'mern stack developer fresher',
  'full stack developer fresher',
  'software developer 0 years',
  'react node developer fresher',
  'graduate software engineer trainee'
]

const LINKEDIN_SEARCH_KEYWORDS = [
  'fresher software engineer India',
  'junior backend engineer Node.js India',
  'backend developer Node.js fresher India',
  'full stack developer MERN fresher India',
  'software engineer intern backend India',
  'founding engineer Node React India',
  'graduate software engineer startup India',
  'entry level software developer India'
]

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
}

const INDIA_TECH_LOCATIONS = [
  'Bangalore/Bengaluru',
  'Bengaluru',
  'Bangalore',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Gurgaon',
  'Gurugram',
  'Noida',
  'Delhi NCR',
  'Delhi',
  'Mumbai',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Coimbatore',
  'Remote',
  'Pan India',
  'India'
]

function normalizeText(value = '') {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeJobKey(job) {
  return `${normalizeText(job.title)}::${normalizeText(job.company)}`
}

function parsePostedAt(postedText) {
  if (!postedText) return null

  const text = postedText.toLowerCase()
  const now = new Date()

  if (text.includes('today') || text.includes('just now')) return now
  if (text.includes('yesterday')) {
    now.setDate(now.getDate() - 1)
    return now
  }

  const match = text.match(/(\d+)\s+(day|week|month)s?\s+ago/)
  if (!match) return null

  const amount = Number(match[1])
  const unit = match[2]

  if (unit === 'day') now.setDate(now.getDate() - amount)
  if (unit === 'week') now.setDate(now.getDate() - amount * 7)
  if (unit === 'month') now.setMonth(now.getMonth() - amount)

  return now
}

function buildIndeedUrl(keyword, pageNumber = 1) {
  const params = new URLSearchParams({
    q: keyword,
    l: 'India',
    fromage: '3',
    sort: 'date',
  })

  const start = (pageNumber - 1) * 10
  if (start > 0) params.set('start', String(start))

  return `https://in.indeed.com/jobs?${params.toString()}`
}

function shouldFetchDescription(job) {
  const minLength = job.source === 'indeed' ? 350 : 1000
  return !job.description || job.description.length < minLength
}

function buildEmbeddingText(job) {
  return [
    job.title,
    job.company,
    job.location,
    job.salary,
    job.description
  ].filter(Boolean).join(' ')
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

function cleanUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    url.searchParams.delete('from')
    url.searchParams.delete('fromjk')
    url.searchParams.delete('vjs')
    url.hash = ''
    return url.href
  } catch {
    return rawUrl
  }
}

function normalizeIndeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, 'https://in.indeed.com')
    const jk = url.searchParams.get('jk')

    if (jk) return `https://in.indeed.com/viewjob?jk=${jk}`
    return cleanUrl(url.href)
  } catch {
    return rawUrl
  }
}

// Strip LinkedIn tracking query parameters to get a stable canonical URL
function normalizeLinkedInUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    // Remove all query params (trackingId etc)
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return rawUrl
  }
}

function isIndeedJobUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('indeed.com')
      && (parsed.pathname.includes('/viewjob') || parsed.searchParams.has('jk'))
  } catch {
    return false
  }
}

function isLikelyEarlyCareerTitle(title = '') {
  return !/\b(manager|lead|senior|principal|staff|architect|director|head)\b/i.test(title)
}

const NON_TECH_ROLE_PATTERN = /\b(seo|sales|marketing|business development|business developer|hr|human resources|recruiter|talent acquisition|graphic designer|animator|video editor|content writer|copywriter|social media|customer support|telecaller|operations|admin|accountant|finance|icsi|company secretary|chartered accountant)\b/i
const TARGET_TECH_ROLE_PATTERN = /\b(software engineer|software developer|software development engineer|sde|backend|back end|node(?:\.js|js)?|express(?:\.js)?|nestjs|mern|full[ -]?stack|fullstack|web developer|java developer|java\/kotlin|kotlin|python developer|founding engineer|graduate software engineer|associate software engineer|developer engineer|computer science engineer|api developer|cloud engineer)\b/i
const FRONTEND_ONLY_ROLE_PATTERN = /\b(frontend|front-end|front end|ui developer|react developer|angular developer|vue developer|html|css)\b/i
const BACKEND_FULLSTACK_SIGNAL_PATTERN = /\b(backend|back end|node(?:\.js|js)?|express|nestjs|api|server|postgres|postgresql|redis|websocket|full[ -]?stack|fullstack|mern|java|kotlin|python|cloud|database)\b/i

function isRelevantTechJob(job = {}) {
  const title = job.title || ''
  const roleText = `${title} ${job.description || ''}`

  if (!isLikelyEarlyCareerTitle(title)) return false
  if (NON_TECH_ROLE_PATTERN.test(roleText)) return false
  if (!TARGET_TECH_ROLE_PATTERN.test(roleText)) return false
  if (FRONTEND_ONLY_ROLE_PATTERN.test(title) && !BACKEND_FULLSTACK_SIGNAL_PATTERN.test(roleText)) return false

  return true
}

function parseSearchResults(html, source) {
  const $ = cheerio.load(html)
  const results = []

  if (source === 'duckduckgo') {
    $('.result').each((_, el) => {
      const link = $(el).find('a.result__a, .result__title a').first()
      const title = link.text().trim()
      const url = cleanUrl(unwrapSearchUrl(link.attr('href')))
      const snippet = $(el).find('.result__snippet').text().trim()

      if (title && url) results.push({ title, url, snippet })
    })
  }

  if (source === 'bing') {
    $('li.b_algo').each((_, el) => {
      const link = $(el).find('h2 a').first()
      const title = link.text().trim()
      const url = cleanUrl(unwrapSearchUrl(link.attr('href')))
      const snippet = $(el).find('.b_caption p').text().trim()

      if (title && url) results.push({ title, url, snippet })
    })
  }

  return results
}

async function fetchSearchResults(query) {
  const sources = [
    {
      name: 'bing',
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    },
  ]
  const allResults = []

  for (const source of sources) {
    try {
      const response = await axios.get(source.url, {
        headers: SEARCH_HEADERS,
        timeout: 10000,
      })
      allResults.push(...parseSearchResults(response.data, source.name))
    } catch (err) {
      console.log(`  ⚠️ ${source.name} fallback failed: ${err.message}`)
    }
  }

  return allResults
}

function titleCase(value) {
  return normalizeText(value).replace(/\b\w/g, char => char.toUpperCase())
}

function parseLocationFromSearchText(text) {
  return INDIA_TECH_LOCATIONS.find(location => new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) || 'India'
}

function parseCompanyFromSearchText(text) {
  const patterns = [
    /\bat\s+([^|,.-]+?)\s+(?:-|,|\||$)/i,
    /\bcompany\s*:\s*([^|,.-]+)/i,
    /\bfrom\s+([^|,.-]+?)\s+(?:-|,|\||$)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const company = match?.[1]?.replace(/\s+/g, ' ').trim()
    if (company && company.length > 2 && company.length < 80) return company
  }

  return 'Unknown Company'
}

function parseTitleFromSearchText(result, keyword) {
  const cleaned = result.title
    .replace(/\s+\|\s+Indeed.*$/i, '')
    .replace(/\s+-\s+Indeed.*$/i, '')
    .replace(/\s+Jobs?,?\s+Employment.*$/i, '')
    .trim()

  return cleaned || titleCase(keyword)
}

async function scrapeIndeedFromSearchIndex(keyword) {
  const query = `site:in.indeed.com/viewjob "${keyword}" India fresher OR "0 years" OR "0-1"`
  const results = await fetchSearchResults(query)

  return results
    .filter(result => isIndeedJobUrl(result.url))
    .slice(0, 12)
    .map(result => {
      const searchText = `${result.title} ${result.snippet}`

      return {
        title: parseTitleFromSearchText(result, keyword),
        company: parseCompanyFromSearchText(searchText),
        location: parseLocationFromSearchText(searchText),
        salary: '',
        url: normalizeIndeedUrl(result.url),
        description: result.snippet || result.title,
        postedAt: null,
        source: 'indeed'
      }
    })
    .filter(job => job.title && job.url && isRelevantTechJob(job))
}

// Indeed Scraper
async function scrapeIndeed(page, keywords = INDEED_SEARCH_KEYWORDS) {
  const jobs = []

  for (const keyword of keywords) {
    let usedFallback = false

    for (let pageNumber = 1; pageNumber <= INDEED_PAGES_PER_QUERY; pageNumber++) {
      console.log(`🔍 Indeed: searching "${keyword}" page ${pageNumber}...`)
      const url = buildIndeedUrl(keyword, pageNumber)

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
        await page.waitForTimeout(1800)

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 900))
          await page.waitForTimeout(700)
        }

        const scan = await page.evaluate(() => {
          const clean = (value = '') => value.replace(/\s+/g, ' ').trim()
          const textOf = (root, selectors) => {
            for (const selector of selectors) {
              const el = root.querySelector(selector)
              const text = clean(el?.innerText || el?.textContent || '')
              if (text) return text
            }
            return ''
          }
          const hrefOf = (root, selectors) => {
            for (const selector of selectors) {
              const el = root.querySelector(selector)
              const href = el?.href || el?.getAttribute?.('href')
              if (href) return new URL(href, window.location.origin).href
            }
            return ''
          }
          const uniq = (items) => Array.from(new Set(items.filter(Boolean)))

          const blockedText = clean(document.body.innerText || '').toLowerCase()
          if (/captcha|access denied|robot|unusual traffic|additional verification|required to continue/.test(blockedText)) {
            return { blocked: true, jobs: [] }
          }

          const cardSelectors = [
            '[data-testid="slider_container"]',
            '.job_seen_beacon',
            '.cardOutline',
            '.jobsearch-ResultsList > li',
            '.result'
          ]
          const cards = uniq(cardSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector))))
          const cardsFromAnchors = Array.from(document.querySelectorAll('a.jcs-JobTitle, a[href*="/viewjob"], a[href*="jk="]'))
            .map(anchor => anchor.closest('[data-testid="slider_container"], .job_seen_beacon, .cardOutline, .jobsearch-ResultsList > li, .result') || anchor.parentElement)
            .filter(Boolean)

          const jobs = uniq([...cards, ...cardsFromAnchors]).map(card => {
            const title = textOf(card, [
              'h2.jobTitle a span[title]',
              'a.jcs-JobTitle span[title]',
              'a.jcs-JobTitle',
              '[data-testid="jobTitle"]',
              '.jobTitle'
            ])
            const company = textOf(card, [
              '[data-testid="company-name"]',
              '.companyName',
              '[data-testid="companyName"]',
              '.company_location [data-testid="company-name"]'
            ])
            const location = textOf(card, [
              '[data-testid="text-location"]',
              '.companyLocation',
              '[data-testid="job-location"]'
            ])
            const salary = textOf(card, [
              '.salary-snippet-container',
              '[data-testid="attribute_snippet_testid"]',
              '[class*="salary"]'
            ])
            const description = textOf(card, [
              '.job-snippet',
              '[data-testid="jobsnippet"]',
              '.underShelfFooter',
              '[class*="snippet"]'
            ])
            const postedText = textOf(card, [
              '[data-testid="myJobsStateDate"]',
              '.date',
              '[class*="date"]'
            ])
            const jobUrl = hrefOf(card, [
              'a.jcs-JobTitle',
              'h2.jobTitle a',
              'a[href*="/viewjob"]',
              'a[href*="jk="]'
            ])

            return {
              title,
              company,
              location,
              salary,
              url: jobUrl,
              description,
              postedText,
              source: 'indeed'
            }
          }).filter(job =>
            job.title
            && job.company
            && job.url
            && !/\b(manager|lead|senior|principal|staff|architect|director|head)\b/i.test(job.title)
          )

          return { blocked: false, jobs }
        })

        const normalized = scan.jobs
          .map(job => ({
            ...job,
            url: normalizeIndeedUrl(job.url),
            postedAt: parsePostedAt(job.postedText)
          }))
          .filter(isRelevantTechJob)

        jobs.push(...normalized)
        console.log(`  ↳ Found ${normalized.length} jobs`)

        if ((scan.blocked || !normalized.length) && !usedFallback) {
          usedFallback = true
          console.log('  ↳ Direct Indeed blocked/empty, trying search-index fallback...')
          const fallbackJobs = await scrapeIndeedFromSearchIndex(keyword)
          jobs.push(...fallbackJobs)
          console.log(`  ↳ Fallback found ${fallbackJobs.length} jobs`)
        }

        if (scan.blocked) break
      } catch (err) {
        console.log(`  ⚠️ Indeed search failed for "${keyword}" page ${pageNumber}: ${err.message}`)

        if (!usedFallback) {
          usedFallback = true
          const fallbackJobs = await scrapeIndeedFromSearchIndex(keyword)
          jobs.push(...fallbackJobs)
          console.log(`  ↳ Fallback found ${fallbackJobs.length} jobs`)
        }
      }

      await page.waitForTimeout(1500)
    }
  }

  return jobs
}

// LinkedIn Scraper
async function scrapeLinkedIn(page, keywords = LINKEDIN_SEARCH_KEYWORDS) {
  const jobs = []

  for (const keyword of keywords) {
    console.log(`🔍 LinkedIn: searching "${keyword}"...`)
    const encodedKeyword = encodeURIComponent(keyword)
    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodedKeyword}&location=India&f_TPR=r86400&f_E=1,2`

    const loaded = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .then(() => true)
      .catch(err => {
        console.log(`  ⚠️ LinkedIn navigation failed for "${keyword}": ${err.message}`)
        return false
      })

    if (!loaded) {
      await page.waitForTimeout(1000)
      continue
    }

    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(2000)

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 800))
      await page.waitForTimeout(800)
    }

    const extracted = await page.evaluate(() => {
      const cards = document.querySelectorAll('.job-search-card')
      return Array.from(cards).map(card => {
        const titleEl = card.querySelector('.base-search-card__title')
        const companyEl = card.querySelector('.base-search-card__subtitle')
        const locationEl = card.querySelector('.job-search-card__location')
        const linkEl = card.querySelector('a.base-card__full-link')
        const timeEl = card.querySelector('time')

        const cardText = card.innerText?.toLowerCase() || ''
        const isClosed = cardText.includes('no longer accepting applications')

        return {
          title: titleEl?.innerText?.trim() || '',
          company: companyEl?.innerText?.trim() || '',
          location: locationEl?.innerText?.trim() || '',
          url: linkEl?.href || '',
          description: '',
          postedAt: timeEl?.getAttribute('datetime') || null,
          source: 'linkedin',
          isClosed
        }
      }).filter(job =>
        job.title
        && job.url
        && !job.isClosed
        && !/\b(manager|lead|senior|principal|staff|architect|director|head)\b/i.test(job.title)
      )
    })

    const relevantJobs = extracted
      .filter(isRelevantTechJob)
      .map(job => ({ ...job, url: normalizeLinkedInUrl(job.url) }))
    jobs.push(...relevantJobs)
    console.log(`  ↳ Found ${relevantJobs.length} jobs`)
    await page.waitForTimeout(2000)
  }

  return jobs
}

// Fetch Full Job Description
async function fetchJobDescription(page, job) {
  if (!shouldFetchDescription(job)) return job.description

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(1200)

    if (job.source === 'indeed') {
      const isClosed = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('job has expired') || 
               text.includes('no longer available') || 
               text.includes('expired');
      });

      if (isClosed) {
        job.isClosed = true;
        return '';
      }

      const description = await page.evaluate(() => {
        const clean = (value = '') => value.replace(/\s+/g, ' ').trim()
        const blockedText = clean(document.body.innerText || '').toLowerCase()
        if (/captcha|access denied|robot|unusual traffic|additional verification|required to continue/.test(blockedText)) return ''

        const selectors = [
          '#jobDescriptionText',
          '[data-testid="jobDescriptionText"]',
          '.jobsearch-jobDescriptionText',
          '[class*="jobDescription"]',
          'main'
        ]

        for (const selector of selectors) {
          const el = document.querySelector(selector)
          const text = clean(el?.innerText || el?.textContent || '')
          if (text.length > 200) return text
        }

        return clean(document.body.innerText || '').slice(0, 5000)
      }).catch(() => '')

      return description || job.description || ''
    }

    if (job.source === 'linkedin') {
      const isClosed = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('no longer accepting applications') ||
               text.includes('job is closed') ||
               text.includes('position is closed') ||
               text.includes('no longer active') ||
               !!document.querySelector('.artdeco-inline-feedback--error') ||
               !!document.querySelector('.jobs-search-closed-banner');
      });

      if (isClosed) {
        job.isClosed = true;
        return '';
      }

      return await page.$eval(
        '.show-more-less-html__markup, .description__text',
        el => el.innerText.trim()
      ).catch(() => '')
    }
  } catch {
    console.log(`  ⚠️ Could not fetch description for ${job.url}`)
  }

  return job.description || ''
}

// Save to DB
async function saveJobs(jobs, userId) {
  let saved = 0
  let skipped = 0
  const jobIds = []
  const existingJobs = await prisma.job.findMany({
    where: { userId },
    select: { title: true, company: true, url: true }
  })
  const existingUrls = new Set(existingJobs.map(job => job.url))
  const existingKeys = new Set(existingJobs.map(normalizeJobKey))
  const seenKeys = new Set()

  for (const job of jobs) {
    try {
      if (!job.title || !job.company || !job.url) {
        skipped++
        continue
      }

      if (!isRelevantTechJob(job)) {
        skipped++
        continue
      }

      const jobKey = normalizeJobKey(job)

      if (existingUrls.has(job.url) || existingKeys.has(jobKey) || seenKeys.has(jobKey)) {
        skipped++
        continue
      }

      const created = await prisma.job.create({
        data: {
          title: job.title,
          company: job.company,
          location: job.location || '',
          salary: job.salary || '',
          description: job.description || '',
          url: job.url,
          source: job.source,
          postedAt: job.postedAt ? new Date(job.postedAt) : null,
          status: 'PENDING',
          ...(userId && userId !== 'default' ? { userId } : {})
        }
      })

      saved++
      jobIds.push(created.id)
      existingUrls.add(job.url)
      existingKeys.add(jobKey)
      seenKeys.add(jobKey)

      const embeddingText = buildEmbeddingText(job)
      if (embeddingText.length > 50) {
        try {
          const embedding = await generateEmbedding(embeddingText)
          await saveJobEmbedding(created.id, embedding)
          console.log(`  ✅ Saved + embedded: ${job.title} @ ${job.company}`)
        } catch (err) {
          console.log(`  ⚠️ Saved, embedding will backfill later: ${job.title} @ ${job.company} (${err.message})`)
        }
      } else {
        console.log(`  📝 Saved (no description): ${job.title} @ ${job.company}`)
      }
    } catch (err) {
      console.error(`  ❌ Error saving ${job.url}:`, err.message)
    }
  }

  return { saved, skipped, jobIds }
}

// Main Hunt Function
// options.keywords: string[] from resume profile (optional — falls back to hardcoded)
export async function runHuntAgent(options = {}) {
  const resumeKeywords = Array.isArray(options.keywords) && options.keywords.length > 0
    ? options.keywords
    : null

  const indeedKeywords = resumeKeywords || INDEED_SEARCH_KEYWORDS
  const linkedinKeywords = resumeKeywords
    ? resumeKeywords.map(k => k.includes('India') ? k : `${k} India`)
    : LINKEDIN_SEARCH_KEYWORDS

  if (resumeKeywords) {
    console.log(`\n👻 GhostApply - HUNT AGENT starting (resume-based keywords)...\n`)
    console.log(`  Using ${resumeKeywords.length} keywords from resume profile`)
  } else {
    console.log('\n👻 GhostApply - HUNT AGENT starting (default keywords)...\n')
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  })

  const page = await context.newPage()

  try {
    const indeedJobs = await scrapeIndeed(page, indeedKeywords)
    const linkedInJobs = await scrapeLinkedIn(page, linkedinKeywords)
    const allJobs = [...indeedJobs, ...linkedInJobs]
    const relevantJobs = allJobs.filter(isRelevantTechJob)

    console.log(`\n📦 Total scraped: ${allJobs.length} jobs`)
    console.log(`🧹 Relevant tech candidates: ${relevantJobs.length}`)
    console.log('💾 Fetching descriptions and saving to database...\n')

    const seenScrapeKeys = new Set()
    const uniqueJobs = relevantJobs.filter(job => {
      const key = normalizeJobKey(job)
      if (seenScrapeKeys.has(key)) return false
      seenScrapeKeys.add(key)
      return true
    })

    // Pre-filter against DB to avoid fetching descriptions for jobs we already have
    const existingJobs = await prisma.job.findMany({ select: { title: true, company: true, url: true } })
    const existingUrls = new Set(existingJobs.map(j => j.url))
    const existingKeys = new Set(existingJobs.map(normalizeJobKey))
    
    const newJobs = uniqueJobs.filter(job => {
      return !existingUrls.has(job.url) && !existingKeys.has(normalizeJobKey(job))
    })

    const skippedCount = uniqueJobs.length - newJobs.length;
    if (skippedCount > 0) {
      console.log(`  ↳ Skipped ${skippedCount} jobs that already exist in database`)
    }

    if (newJobs.length > 0) {
      console.log(`  ↳ Need to fetch full descriptions for ${newJobs.length} new jobs...`)
    }

    for (let i = 0; i < newJobs.length; i++) {
      const job = newJobs[i];
      if (shouldFetchDescription(job)) {
        process.stdout.write(`    [${i + 1}/${newJobs.length}] Fetching ${job.company}... `)
        job.description = await fetchJobDescription(page, job)
        console.log('Done.')
      }
    }

    // Filter out jobs that were closed/expired
    const openNewJobs = newJobs.filter(j => !j.isClosed)
    const closedCount = newJobs.length - openNewJobs.length
    if (closedCount > 0) {
      console.log(`  ↳ Filtered out ${closedCount} closed jobs (no longer accepting applications)`)
    }

    const { saved, skipped, jobIds } = await saveJobs(openNewJobs, options.userId)
    // Add back the pre-filtered skipped count for the final log
    console.log(`\n✅ Hunt complete: ${saved} new jobs saved, ${skipped + skippedCount + closedCount} already existed or were closed`)

    return { saved, skipped: skipped + skippedCount, total: allJobs.length, relevant: relevantJobs.length, unique: uniqueJobs.length, jobIds }
  } finally {
    await browser.close()
  }
}

// Run directly: node src/agents/huntAgent.js
if (process.argv[1]?.includes('huntAgent')) {
  import('dotenv/config').then(() => {
    runHuntAgent()
      .then(result => {
        console.log('\n🎉 Done:', result)
        process.exit(0)
      })
      .catch(err => {
        console.error('💀 Hunt failed:', err)
        process.exit(1)
      })
  })
}
