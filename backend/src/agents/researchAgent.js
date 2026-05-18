// src/agents/researchAgent.js
// RESEARCH AGENT - enriches calibrated matches with founder info + drafts outreach

import { prisma } from '../db/client.js'
import {
  fetch_founder_info,
  fetch_company_news,
  draft_cold_message
} from '../mcp/mcpServer.js'

const MIN_RESEARCH_SCORE = 65

function buildResumeSummary(resumeText) {
  const lines = resumeText.split('\n').filter(line => line.trim().length > 20)
  return lines.slice(0, 8).join(' ').slice(0, 600)
}

function parseFitReason(fitReason) {
  try {
    return JSON.parse(fitReason || '{}')
  } catch {
    return {}
  }
}

function isResearchWorthy(job) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase()
  const fitData = parseFitReason(job.fitReason)

  if ((job.fitScore || 0) < MIN_RESEARCH_SCORE) return false
  if (!fitData.calibration) return false
  if (/\b(manager|lead|senior|sr\.?|principal|staff|architect|director|head)\b/.test(text)) return false
  if (/\b(frontend|front-end|front end|ui developer)\b/.test(text) && !/\b(backend|full stack|fullstack|node|api|server)\b/.test(text)) return false

  return true
}

export async function runResearchAgent(userId = 'default', options = {}) {
  console.log('\nGhostApply - RESEARCH AGENT starting...\n')

  const hasScopedJobIds = Array.isArray(options.jobIds)
  const scopedJobIds = hasScopedJobIds
    ? Array.from(new Set(options.jobIds.filter(Boolean)))
    : []

  if (hasScopedJobIds && !scopedJobIds.length) {
    console.log('No freshly matched jobs to research.')
    return { researched: 0 }
  }

  const matchedCandidates = await prisma.job.findMany({
    where: {
      status: 'MATCHED',
      draftMessage: null,
      fitScore: { gte: MIN_RESEARCH_SCORE },
      ...(hasScopedJobIds ? { id: { in: scopedJobIds } } : {})
    },
    orderBy: { fitScore: 'desc' },
    ...(hasScopedJobIds ? {} : { take: 50 })
  })
  const matchedJobs = matchedCandidates.filter(isResearchWorthy).slice(0, 20)

  if (!matchedJobs.length) {
    console.log('No new calibrated matches to research.')
    return { researched: 0 }
  }

  const resume = await prisma.resume.findFirst({ where: { userId } })
  const resumeSummary = resume ? buildResumeSummary(resume.content) : ''

  console.log(`Researching ${matchedJobs.length} calibrated matched jobs...\n`)

  let researched = 0

  for (const job of matchedJobs) {
    console.log(`\n${job.title} @ ${job.company}`)

    try {
      const founderInfo = await fetch_founder_info({
        companyName: job.company,
        companyUrl: job.url
      })

      const newsData = await fetch_company_news({ companyName: job.company })

      const fitData = parseFitReason(job.fitReason)
      const talkingPoint = fitData.talkingPoint || ''

      const { message } = await draft_cold_message({
        founderName: founderInfo.name,
        companyName: job.company,
        jobTitle: job.title,
        jobDescription: job.description?.slice(0, 1000) || '',
        resumeSummary,
        talkingPoint,
        companyNews: newsData.summary
      })

      await prisma.job.update({
        where: { id: job.id },
        data: {
          founderName: founderInfo.name,
          founderLinkedIn: founderInfo.linkedin,
          founderTwitter: founderInfo.twitter,
          companyNews: newsData.summary,
          draftMessage: message
        }
      })

      console.log('  -> Research complete, draft ready')
      researched++

      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (err) {
      console.error(`  -> Research failed for ${job.company}:`, err.message)
    }
  }

  console.log(`\nResearch complete: ${researched} jobs enriched`)
  return { researched }
}

if (process.argv[1]?.includes('researchAgent')) {
  import('dotenv/config').then(() => {
    runResearchAgent()
      .then(result => { console.log('\nDone:', result); process.exit(0) })
      .catch(err => { console.error('Research failed:', err); process.exit(1) })
  })
}
