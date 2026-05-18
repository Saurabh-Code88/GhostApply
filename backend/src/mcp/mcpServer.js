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

function parseSearchResults(html, source) {
  const $ = cheerio.load(html)
  const results = []

  if (source === 'duckduckgo') {
    $('.result').each((_, el) => {
      const link = $(el).find('a.result__a, .result__title a').first()
      const title = link.text().trim()
      const url = cleanProfileUrl(unwrapSearchUrl(link.attr('href')))
      const snippet = $(el).find('.result__snippet').text().trim()

      if (title && url) results.push({ title, url, snippet })
    })
  }

  if (source === 'bing') {
    $('li.b_algo').each((_, el) => {
      const link = $(el).find('h2 a').first()
      const title = link.text().trim()
      const url = cleanProfileUrl(unwrapSearchUrl(link.attr('href')))
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
      const results = parseSearchResults(response.data, source.name)
      allResults.push(...results)
    } catch (err) {
      console.log(`  ⚠️ ${source.name} search failed: ${err.message}`)
    }
  }

  return allResults
}

function isLinkedInPersonUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('linkedin.com') && /^\/in\/[^/]+/.test(parsed.pathname)
  } catch {
    return false
  }
}

function isSocialProfileUrl(url) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const segments = parsed.pathname.split('/').filter(Boolean)
    return ['twitter.com', 'x.com'].includes(host)
      && segments.length === 1
      && !['search', 'share', 'intent', 'home', 'i'].includes(segments[0])
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

  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

async function findFounderLinkedIn(companyName) {
  const queries = [
    `"${companyName}" founder CEO site:linkedin.com/in`,
    `"${companyName}" cofounder site:linkedin.com/in`,
    `"${companyName}" CTO founder site:linkedin.com/in`,
    `${companyName} founder LinkedIn`,
  ]
  const candidates = []

  for (const query of queries) {
    const results = await fetchSearchResults(query)
    candidates.push(...results.filter(result => isLinkedInPersonUrl(result.url)))
  }

  return candidates
    .map(candidate => ({
      ...candidate,
      score: scoreFounderCandidate(candidate, companyName),
    }))
    .sort((a, b) => b.score - a.score)[0] || null
}

async function findFounderTwitter(companyName, founderName) {
  const queries = founderName
    ? [`"${founderName}" "${companyName}" site:x.com OR site:twitter.com`]
    : [`"${companyName}" founder site:x.com OR site:twitter.com`]

  for (const query of queries) {
    const results = await fetchSearchResults(query)
    const candidate = results.find(result => isSocialProfileUrl(result.url))
    if (candidate) return cleanProfileUrl(candidate.url)
  }

  return null
}

// Tool: Fetch Founder Info
export async function fetch_founder_info({ companyName }) {
  console.log(`🔍 MCP: fetching founder info for ${companyName}...`)

  const founderData = { name: null, linkedin: null, twitter: null, bio: null }

  try {
    const linkedInCandidate = await findFounderLinkedIn(companyName)

    if (linkedInCandidate && linkedInCandidate.score >= 20) {
      founderData.linkedin = cleanProfileUrl(linkedInCandidate.url)
      founderData.name = parseFounderName(linkedInCandidate)
      founderData.bio = linkedInCandidate.snippet || linkedInCandidate.title
    }

    founderData.twitter = await findFounderTwitter(companyName, founderData.name)
  } catch (err) {
    console.error('  ⚠️ Founder search error:', err.message)
  }

  console.log('  ↳ Found:', founderData)
  return founderData
}

// Tool: Fetch Company News
export async function fetch_company_news({ companyName }) {
  console.log(`📰 MCP: fetching news for ${companyName}...`)

  try {
    const query = encodeURIComponent(`${companyName} startup India 2024 2025 funding product`)
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

    const summary = articles.length
      ? articles.map(article => article.title).join('. ')
      : `${companyName} is an early-stage startup.`

    console.log(`  ↳ Found ${articles.length} articles`)
    return { articles, summary }
  } catch (err) {
    console.error('  ⚠️ News fetch error:', err.message)
    return { articles: [], summary: '' }
  }
}

// Tool: Draft Cold Message
export async function draft_cold_message({
  founderName,
  companyName,
  jobTitle,
  jobDescription,
  resumeSummary,
  talkingPoint,
  companyNews,
}) {
  console.log(`✍️  MCP: drafting cold message for ${companyName}...`)

  const firstName = founderName?.split(' ')[0] || 'there'
  const newsContext = companyNews || ''

  const prompt = `Write a cold outreach message from a job applicant to a startup founder on LinkedIn.

APPLICANT BACKGROUND:
${resumeSummary}

FOUNDER: ${founderName || 'the founder'}
COMPANY: ${companyName}
ROLE APPLYING FOR: ${jobTitle}
KEY TALKING POINT FROM JD: ${talkingPoint || ''}
RECENT COMPANY NEWS: ${newsContext}

RULES:
- Address them as "${firstName}"
- Under 120 words total
- Sound human, not like a template
- ONE specific thing about their product/company (not generic flattery)
- ONE specific thing from applicant's background that's relevant
- Clear ask: 15-minute call
- No buzzwords like "synergy", "leverage", "passionate"
- No "I hope this message finds you well"
- End with a question, not a statement

Write ONLY the message, no subject line, no preamble:`

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  })

  const message = response.choices[0].message.content.trim()
  console.log('  ✅ Draft ready')
  return { message }
}

// Tool: Scrape Job Description
export async function scrape_job_description({ url }) {
  console.log(`🔗 MCP: scraping JD from ${url}...`)

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

// MCP Request Handler
export async function handleMCPRequest(toolName, params) {
  const tool = tools[toolName]
  if (!tool) throw new Error(`Unknown MCP tool: ${toolName}`)
  return await tool(params)
}
