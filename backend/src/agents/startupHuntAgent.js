// src/agents/startupHuntAgent.js
// STARTUP HUNT AGENT — scrapes Wellfound + LinkedIn founder/HR hiring posts

import { chromium } from 'playwright'
import axios from 'axios'
import * as cheerio from 'cheerio'
import Groq from 'groq-sdk'
import { prisma } from '../db/client.js'
import { generateEmbedding } from '../utils/embeddings.js'
import { saveJobEmbedding } from '../db/client.js'

// ─── State ────────────────────────────────────────────────────────────────────
let _startupHuntRunning = false
let _startupHuntLastRun = null

export function isStartupHuntRunning() { return _startupHuntRunning }
export function getStartupHuntLastRun() { return _startupHuntLastRun }

// ─── Constants ────────────────────────────────────────────────────────────────
const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
}

const WELLFOUND_ROLE_MAP = {
  'backend':            ['backend-developer'],
  'backend developer':  ['backend-developer'],
  'frontend':           ['frontend-developer'],
  'frontend developer': ['frontend-developer'],
  'full stack':         ['software-engineer', 'full-stack-developer'],
  'fullstack':          ['software-engineer', 'full-stack-developer'],
  'node':               ['backend-developer'],
  'node.js':            ['backend-developer'],
  'react':              ['frontend-developer'],
  'python':             ['backend-developer'],
  'java':               ['software-engineer'],
  'devops':             ['devops-engineer'],
  'mern':               ['software-engineer'],
  'sde':                ['software-engineer'],
  'software engineer':  ['software-engineer'],
  'software developer': ['software-engineer'],
}

const DEFAULT_WELLFOUND_SLUGS = [
  'software-engineer',
  'backend-developer',
  'full-stack-developer',
  'frontend-developer',
]

const LINKEDIN_POST_QUERIES_TEMPLATES = [
  'site:linkedin.com/posts "hiring" "{skill}" startup India',
  'site:linkedin.com/posts "looking for" "{skill}" founder India',
  'site:linkedin.com/posts "we\'re hiring" "{skill}" engineer India',
  'site:linkedin.com/posts "join us" OR "join our" "{skill}" startup India',
  'site:linkedin.com/posts "open role" "{skill}" founding OR founder India',
  'site:linkedin.com/feed "hiring" "{skill}" startup founder India',
]

const DEFAULT_LINKEDIN_SKILLS = [
  'backend developer',
  'software engineer',
  'node.js',
  'full stack',
  'react developer',
  'founding engineer',
]

const INDIA_TECH_LOCATIONS = [
  'Bangalore', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai',
  'Gurgaon', 'Gurugram', 'Noida', 'Delhi NCR', 'Delhi',
  'Mumbai', 'Kolkata', 'Ahmedabad', 'Remote', 'India',
]

// ─── Shared helpers (same patterns as huntAgent.js) ───────────────────────────
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

function buildEmbeddingText(job) {
  return [job.title, job.company, job.location, job.salary, job.description]
    .filter(Boolean).join(' ')
}

function cleanUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.href
  } catch {
    return rawUrl
  }
}

function unwrapSearchUrl(rawHref) {
  if (!rawHref) return ''
  try {
    const parsed = new URL(rawHref, 'https://www.bing.com')
    const wrapped = parsed.searchParams.get('u') || parsed.searchParams.get('uddg')
    return wrapped ? decodeURIComponent(wrapped) : parsed.href
  } catch {
    return rawHref
  }
}

// ─── Tech job relevance filter (lighter than huntAgent — startups are more varied) ──
const NON_TECH_PATTERN = /\b(seo|sales|marketing|business development|hr|human resources|recruiter|graphic designer|video editor|content writer|copywriter|social media|customer support|telecaller|operations|admin|accountant|finance|chartered accountant)\b/i
const SENIOR_PATTERN = /\b(director|vp|vice president|chief|head of(?! engineering)|principal|staff engineer)\b/i

function isRelevantStartupJob(job = {}) {
  const text = `${job.title || ''} ${job.description || ''}`
  if (NON_TECH_PATTERN.test(text)) return false
  if (SENIOR_PATTERN.test(job.title || '')) return false
  return true
}


// ═══════════════════════════════════════════════════════════════════════════════
// WELLFOUND SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

function skillsToWellfoundSlugs(skills = []) {
  const slugSet = new Set()

  for (const skill of skills) {
    const key = normalizeText(skill)
    for (const [pattern, slugs] of Object.entries(WELLFOUND_ROLE_MAP)) {
      if (key.includes(pattern) || pattern.includes(key)) {
        slugs.forEach(s => slugSet.add(s))
      }
    }
  }

  if (slugSet.size === 0) {
    DEFAULT_WELLFOUND_SLUGS.forEach(s => slugSet.add(s))
  }

  return [...slugSet]
}

async function scrapeWellfound(page, skills = []) {
  const slugs = skillsToWellfoundSlugs(skills)
  const jobs = []

  for (const slug of slugs) {
    const url = `https://wellfound.com/role/l/${slug}/india`
    console.log(`🚀 Wellfound: searching "${slug}"...`)

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(2500)

      // Scroll to load more
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000))
        await page.waitForTimeout(800)
      }

      // Strategy 1: Try __NEXT_DATA__ JSON extraction
      let extracted = []
      try {
        const nextData = await page.evaluate(() => {
          const script = document.querySelector('#__NEXT_DATA__')
          if (!script) return null
          try { return JSON.parse(script.textContent) } catch { return null }
        })

        if (nextData) {
          const listings = extractWellfoundFromNextData(nextData, slug)
          if (listings.length > 0) {
            extracted = listings
            console.log(`  ↳ __NEXT_DATA__: found ${listings.length} listings`)
          }
        }
      } catch (err) {
        console.log(`  ↳ __NEXT_DATA__ extraction failed: ${err.message}`)
      }

      // Strategy 2: Fallback to DOM extraction
      if (extracted.length === 0) {
        extracted = await page.evaluate(() => {
          const results = []

          // Try various card selectors that Wellfound has used
          const cardSelectors = [
            '[data-test="StartupResult"]',
            '[class*="JobListing"]',
            '[class*="styles_component"]',
            'div[class*="job"]',
          ]

          for (const selector of cardSelectors) {
            const cards = document.querySelectorAll(selector)
            if (cards.length === 0) continue

            cards.forEach(card => {
              const titleEl = card.querySelector('a[class*="title"], h2, [class*="jobTitle"], [class*="listingTitle"]')
              const companyEl = card.querySelector('[class*="company"], [class*="startup"], h3')
              const locationEl = card.querySelector('[class*="location"]')
              const salaryEl = card.querySelector('[class*="salary"], [class*="compensation"]')
              const linkEl = card.querySelector('a[href*="/jobs/"], a[href*="/company/"]')
              const sizeEl = card.querySelector('[class*="size"], [class*="employee"]')

              const title = titleEl?.innerText?.trim() || ''
              const company = companyEl?.innerText?.trim() || ''
              const url = linkEl?.href || ''

              if (title && company) {
                results.push({
                  title,
                  company,
                  location: locationEl?.innerText?.trim() || '',
                  salary: salaryEl?.innerText?.trim() || '',
                  url,
                  description: card.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) || '',
                  teamSize: sizeEl?.innerText?.trim() || '',
                })
              }
            })

            if (results.length > 0) break
          }

          // Fallback: broad link-based extraction
          if (results.length === 0) {
            const links = document.querySelectorAll('a[href*="/jobs/"]')
            links.forEach(link => {
              const text = link.closest('div')?.innerText?.replace(/\s+/g, ' ').trim() || ''
              const title = link.innerText?.trim() || ''
              if (title && title.length > 5 && title.length < 100 && text.length > 20) {
                results.push({
                  title,
                  company: '',
                  location: '',
                  salary: '',
                  url: link.href,
                  description: text.slice(0, 500),
                  teamSize: '',
                })
              }
            })
          }

          return results
        })
        console.log(`  ↳ DOM fallback: found ${extracted.length} listings`)
      }

      // Process extracted jobs
      for (const item of extracted) {
        // Skip large companies (500+ employees)
        if (isLargeCompany(item.teamSize)) continue

        const jobUrl = item.url
          ? (item.url.startsWith('http') ? item.url : `https://wellfound.com${item.url}`)
          : ''

        jobs.push({
          title: item.title,
          company: item.company || 'Unknown Startup',
          location: item.location || 'India',
          salary: item.salary || '',
          url: jobUrl,
          description: item.description || '',
          source: 'wellfound',
          postedAt: null,
        })
      }

      console.log(`  ↳ Added ${extracted.length} jobs after filtering`)
    } catch (err) {
      console.log(`  ⚠️ Wellfound search failed for "${slug}": ${err.message}`)
    }

    await page.waitForTimeout(2000)
  }

  return jobs
}

function extractWellfoundFromNextData(nextData, slug) {
  const results = []

  try {
    // Wellfound stores job data in various nested paths within __NEXT_DATA__
    const traverse = (obj, depth = 0) => {
      if (!obj || depth > 8) return
      if (typeof obj !== 'object') return

      // Look for job-like objects
      if (obj.title && (obj.company || obj.companyName || obj.startup)) {
        results.push({
          title: obj.title || obj.name || '',
          company: obj.company?.name || obj.companyName || obj.startup?.name || obj.startup || '',
          location: obj.locationNames?.join(', ') || obj.location || '',
          salary: obj.compensation || obj.salary || '',
          url: obj.slug ? `/jobs/${obj.slug}` : (obj.url || ''),
          description: obj.description || obj.snippet || '',
          teamSize: obj.company?.size || obj.companySize || obj.teamSize || '',
        })
        return
      }

      if (Array.isArray(obj)) {
        obj.forEach(item => traverse(item, depth + 1))
      } else {
        Object.values(obj).forEach(val => traverse(val, depth + 1))
      }
    }

    traverse(nextData?.props?.pageProps)
  } catch {
    // Ignore traversal errors
  }

  return results
}

function isLargeCompany(teamSizeStr = '') {
  if (!teamSizeStr) return false
  const text = teamSizeStr.toLowerCase()
  // Common patterns: "501-1000", "1001-5000", "500+", "5001+"
  const match = text.match(/(\d+)/)
  if (match) {
    const num = parseInt(match[1], 10)
    if (num >= 500) return true
  }
  return false
}


// ═══════════════════════════════════════════════════════════════════════════════
// LINKEDIN POSTS SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

function buildLinkedInPostQueries(skills = []) {
  const searchSkills = skills.length > 0
    ? skills.slice(0, 6)
    : DEFAULT_LINKEDIN_SKILLS

  const queries = []
  for (const skill of searchSkills) {
    // Pick 2-3 query templates per skill to avoid too many searches
    const templates = LINKEDIN_POST_QUERIES_TEMPLATES.slice(0, 3)
    for (const template of templates) {
      queries.push(template.replace('{skill}', skill))
    }
  }

  return queries
}

async function fetchBingResults(query) {
  try {
    const response = await axios.get(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=15`,
      { headers: SEARCH_HEADERS, timeout: 12000 }
    )
    const $ = cheerio.load(response.data)
    const results = []

    $('li.b_algo').each((_, el) => {
      const link = $(el).find('h2 a').first()
      const title = link.text().trim()
      const rawUrl = link.attr('href')
      const url = cleanUrl(unwrapSearchUrl(rawUrl))
      const snippet = $(el).find('.b_caption p').text().trim()

      if (title && url) results.push({ title, url, snippet })
    })

    return results
  } catch (err) {
    console.log(`  ⚠️ Bing search failed: ${err.message}`)
    return []
  }
}

function isLinkedInPostUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('linkedin.com')
      && (/\/posts\//.test(parsed.pathname) || /\/feed\/update\//.test(parsed.pathname) || /\/pulse\//.test(parsed.pathname))
  } catch {
    return false
  }
}

function normalizeLinkedInPostUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return rawUrl
  }
}

async function extractPostContent(page, postUrl) {
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const data = await page.evaluate(() => {
      const clean = (val = '') => val.replace(/\s+/g, ' ').trim()

      // Extract the post text
      const postSelectors = [
        '.feed-shared-update-v2__description',
        '.feed-shared-text',
        '[data-test-id="main-feed-activity-content"]',
        '.break-words',
        '.update-components-text',
        'article',
        '.feed-shared-update-v2',
      ]
      let postText = ''
      for (const sel of postSelectors) {
        const el = document.querySelector(sel)
        const text = clean(el?.innerText || '')
        if (text.length > 50) { postText = text; break }
      }

      // If no specific post element found, try the main content area
      if (!postText) {
        postText = clean(document.querySelector('main')?.innerText || '').slice(0, 3000)
      }

      // Extract poster name
      const posterSelectors = [
        '.feed-shared-actor__name',
        '.update-components-actor__name',
        '.feed-shared-actor__title',
        '[data-test-id="actor-name"]',
        'a[class*="actor"] span',
      ]
      let posterName = ''
      for (const sel of posterSelectors) {
        const el = document.querySelector(sel)
        const name = clean(el?.innerText || '')
        if (name && name.length > 2 && name.length < 60) { posterName = name; break }
      }

      // Extract poster headline/title
      const headlineSelectors = [
        '.feed-shared-actor__description',
        '.update-components-actor__description',
        '.feed-shared-actor__sub-description',
      ]
      let posterTitle = ''
      for (const sel of headlineSelectors) {
        const el = document.querySelector(sel)
        const text = clean(el?.innerText || '')
        if (text.length > 3) { posterTitle = text; break }
      }

      // Extract poster LinkedIn profile URL
      const profileLink = document.querySelector(
        '.feed-shared-actor__container-link, .update-components-actor__container-link, a[href*="/in/"]'
      )
      let posterLinkedIn = profileLink?.href || ''
      if (posterLinkedIn) {
        try {
          const u = new URL(posterLinkedIn)
          u.search = ''
          u.hash = ''
          posterLinkedIn = u.href.replace(/\/$/, '')
        } catch { /* keep as-is */ }
      }

      return { postText: postText.slice(0, 3000), posterName, posterTitle, posterLinkedIn }
    })

    return data
  } catch (err) {
    console.log(`  ⚠️ Failed to extract post: ${err.message}`)
    return null
  }
}

async function parsePostWithGroq(postText, posterName, posterTitle, postUrl) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Analyze this LinkedIn post and determine if it's about hiring/recruiting for a tech role at a startup or small company.

POSTER: ${posterName || 'Unknown'}
POSTER TITLE: ${posterTitle || 'Unknown'}
POST TEXT:
${postText.slice(0, 2000)}

Respond with ONLY a JSON object (no explanation, no markdown):
{
  "isHiring": true/false,
  "confidence": "high"/"medium"/"low",
  "roleMentioned": "the specific role they're hiring for, or empty string",
  "companyName": "the company name, or empty string",
  "location": "location mentioned, or 'India'",
  "keyRequirements": "brief comma-separated list of skills/requirements mentioned",
  "description": "2-3 sentence summary of what they're looking for"
}`
      }],
      temperature: 0,
      max_tokens: 300,
    })

    const raw = response.choices[0].message.content.trim()
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    return parsed
  } catch (err) {
    console.log(`  ⚠️ Groq post parsing failed: ${err.message}`)
    return null
  }
}

async function scrapeLinkedInPosts(page, skills = []) {
  const queries = buildLinkedInPostQueries(skills)
  const allResults = []
  const seenUrls = new Set()

  console.log(`\n🔍 LinkedIn Posts: searching with ${queries.length} queries...`)

  // Phase 1: Gather post URLs from Bing search
  for (const query of queries) {
    console.log(`  → Bing: "${query.slice(0, 80)}..."`)
    const results = await fetchBingResults(query)

    const postResults = results
      .filter(r => isLinkedInPostUrl(r.url))
      .map(r => ({ ...r, url: normalizeLinkedInPostUrl(r.url) }))
      .filter(r => {
        if (seenUrls.has(r.url)) return false
        seenUrls.add(r.url)
        return true
      })

    allResults.push(...postResults)
    console.log(`    ↳ ${postResults.length} new post URLs found`)
    await new Promise(r => setTimeout(r, 1200))
  }

  console.log(`  📋 Total unique post URLs: ${allResults.length}`)

  // Phase 2: Visit posts and extract content (limit to top 20 to avoid timeout)
  const postsToVisit = allResults.slice(0, 20)
  const jobs = []

  for (let i = 0; i < postsToVisit.length; i++) {
    const result = postsToVisit[i]
    process.stdout.write(`  [${i + 1}/${postsToVisit.length}] Visiting ${result.url.slice(0, 60)}... `)

    const postData = await extractPostContent(page, result.url)
    if (!postData || !postData.postText || postData.postText.length < 50) {
      console.log('skipped (no content)')
      continue
    }

    // Use Groq to parse the post
    const parsed = await parsePostWithGroq(
      postData.postText,
      postData.posterName,
      postData.posterTitle,
      result.url
    )

    if (!parsed || !parsed.isHiring || parsed.confidence === 'low') {
      console.log('skipped (not a hiring post)')
      continue
    }

    const jobTitle = parsed.roleMentioned || 'Software Engineer'
    const company = parsed.companyName || 'Startup'

    jobs.push({
      title: jobTitle,
      company: company,
      location: parsed.location || 'India',
      salary: '',
      description: [
        parsed.description || '',
        parsed.keyRequirements ? `Requirements: ${parsed.keyRequirements}` : '',
        `\n\n— Original post by ${postData.posterName || 'Unknown'}${postData.posterTitle ? ` (${postData.posterTitle})` : ''}`,
      ].filter(Boolean).join('\n'),
      url: result.url,
      source: 'linkedin-post',
      postedAt: null,
      // Store poster info directly as founder data
      founderName: postData.posterName || parsed.posterName || null,
      founderLinkedIn: postData.posterLinkedIn || null,
    })

    console.log(`✅ ${jobTitle} @ ${company} (by ${postData.posterName || 'Unknown'})`)
    await page.waitForTimeout(1500)
  }

  return jobs
}


// ═══════════════════════════════════════════════════════════════════════════════
// SAVE TO DB (follows same pattern as huntAgent.js)
// ═══════════════════════════════════════════════════════════════════════════════

async function saveStartupJobs(jobs, userId) {
  let saved = 0
  let skipped = 0
  const jobIds = []

  const existingJobs = await prisma.job.findMany({
    where: { userId },
    select: { title: true, company: true, url: true }
  })
  const existingUrls = new Set(existingJobs.map(j => j.url))
  const existingKeys = new Set(existingJobs.map(normalizeJobKey))
  const seenKeys = new Set()

  for (const job of jobs) {
    try {
      if (!job.title || !job.url) {
        skipped++
        continue
      }

      if (!isRelevantStartupJob(job)) {
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
          founderName: job.founderName || null,
          founderLinkedIn: job.founderLinkedIn || null,
          ...(userId && userId !== 'default' ? { userId } : {}),
        }
      })

      saved++
      jobIds.push(created.id)
      existingUrls.add(job.url)
      existingKeys.add(jobKey)
      seenKeys.add(jobKey)

      // Generate and save embedding
      const embeddingText = buildEmbeddingText(job)
      if (embeddingText.length > 50) {
        try {
          const embedding = await generateEmbedding(embeddingText)
          await saveJobEmbedding(created.id, embedding)
          console.log(`  ✅ Saved + embedded: ${job.title} @ ${job.company} [${job.source}]`)
        } catch (err) {
          console.log(`  ⚠️ Saved, embedding later: ${job.title} @ ${job.company} (${err.message})`)
        }
      } else {
        console.log(`  📝 Saved (no description): ${job.title} @ ${job.company}`)
      }
    } catch (err) {
      if (err.code === 'P2002') {
        // Unique constraint violation (duplicate URL) — skip silently
        skipped++
      } else {
        console.error(`  ❌ Error saving ${job.url}:`, err.message)
      }
    }
  }

  return { saved, skipped, jobIds }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function runStartupHunt(options = {}) {
  if (_startupHuntRunning) {
    console.log('⚠️ Startup Hunt is already running')
    return
  }

  _startupHuntRunning = true
  const startTime = Date.now()

  const skills = Array.isArray(options.skills) && options.skills.length > 0
    ? options.skills
    : null

  const keywords = Array.isArray(options.keywords) && options.keywords.length > 0
    ? options.keywords
    : null

  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   🚀 Startup Hunt Starting           ║')
  console.log(`║   ${new Date().toLocaleString('en-IN')}   ║`)
  console.log('╚══════════════════════════════════════╝\n')

  if (skills) console.log(`  Using ${skills.length} skills from resume profile`)
  if (keywords) console.log(`  Using ${keywords.length} search keywords from resume`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  })

  const page = await context.newPage()

  try {
    // ── Step 1: Wellfound ──────────────────────────────────────────────────
    console.log('\nSTEP 1/2 — WELLFOUND\n' + '─'.repeat(40))
    const wellfoundJobs = await scrapeWellfound(page, skills || [])
    console.log(`\n  📦 Wellfound total: ${wellfoundJobs.length} jobs`)

    // ── Step 2: LinkedIn Posts ─────────────────────────────────────────────
    console.log('\nSTEP 2/2 — LINKEDIN POSTS\n' + '─'.repeat(40))
    const linkedInPostSkills = skills || keywords?.map(k =>
      k.replace(/\b(india|fresher|junior|intern|0 years|entry level)\b/gi, '').trim()
    ).filter(k => k.length > 3) || null
    const linkedInJobs = await scrapeLinkedInPosts(page, linkedInPostSkills || [])
    console.log(`\n  📦 LinkedIn Posts total: ${linkedInJobs.length} jobs`)

    // ── Merge + dedup ─────────────────────────────────────────────────────
    const allJobs = [...wellfoundJobs, ...linkedInJobs]
    const seenKeys = new Set()
    const uniqueJobs = allJobs.filter(job => {
      const key = normalizeJobKey(job)
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

    console.log(`\n  📦 Combined unique: ${uniqueJobs.length} startup jobs`)
    console.log('  💾 Saving to database...\n')

    // ── Fetch descriptions for Wellfound jobs ─────────────────────────────
    const wellfoundToFetch = uniqueJobs.filter(j =>
      j.source === 'wellfound' && (!j.description || j.description.length < 300) && j.url
    )
    if (wellfoundToFetch.length > 0) {
      console.log(`  ↳ Fetching full descriptions for ${wellfoundToFetch.length} Wellfound jobs...`)
      for (let i = 0; i < wellfoundToFetch.length; i++) {
        const job = wellfoundToFetch[i]
        try {
          process.stdout.write(`    [${i + 1}/${wellfoundToFetch.length}] ${job.company}... `)
          await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
          await page.waitForTimeout(2000)

          const description = await page.evaluate(() => {
            const selectors = [
              '[class*="description"]',
              '[class*="job-detail"]',
              '[class*="jobDescription"]',
              'article',
              'main',
            ]
            for (const sel of selectors) {
              const el = document.querySelector(sel)
              const text = el?.innerText?.replace(/\s+/g, ' ').trim() || ''
              if (text.length > 200) return text
            }
            return ''
          })

          if (description && description.length > job.description.length) {
            job.description = description.slice(0, 5000)
          }
          console.log('Done.')
        } catch {
          console.log('Failed.')
        }
        await page.waitForTimeout(1000)
      }
    }

    // ── Save ──────────────────────────────────────────────────────────────
    const { saved, skipped, jobIds } = await saveStartupJobs(uniqueJobs, options.userId)

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    _startupHuntLastRun = {
      completedAt: new Date().toISOString(),
      duration: parseFloat(duration),
      total: allJobs.length,
      wellfound: wellfoundJobs.length,
      linkedInPosts: linkedInJobs.length,
      saved,
      skipped,
    }

    console.log('\n╔══════════════════════════════════════╗')
    console.log('║      ✅ Startup Hunt Complete        ║')
    console.log(`║  🟠 Wellfound:  ${String(wellfoundJobs.length).padEnd(20)}║`)
    console.log(`║  🔵 LI Posts:   ${String(linkedInJobs.length).padEnd(20)}║`)
    console.log(`║  💾 Saved:      ${String(saved).padEnd(20)}║`)
    console.log(`║  ⏱️  Duration:   ${String(duration + ' min').padEnd(20)}║`)
    console.log('╚══════════════════════════════════════╝\n')

    return { saved, skipped, total: allJobs.length, wellfound: wellfoundJobs.length, linkedInPosts: linkedInJobs.length, jobIds }
  } catch (err) {
    console.error('💀 Startup Hunt error:', err)
    throw err
  } finally {
    await browser.close()
    _startupHuntRunning = false
  }
}


// ── Run directly: node src/agents/startupHuntAgent.js ──────────────────────────
if (process.argv[1]?.includes('startupHuntAgent')) {
  import('dotenv/config').then(() => {
    runStartupHunt()
      .then(result => {
        console.log('\n🎉 Done:', result)
        process.exit(0)
      })
      .catch(err => {
        console.error('💀 Startup Hunt failed:', err)
        process.exit(1)
      })
  })
}
