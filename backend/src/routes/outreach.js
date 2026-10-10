// src/routes/outreach.js
import express from 'express'
import { prisma } from '../db/client.js'
import { sendOutreach, checkForReplies, sendAllApproved } from '../agents/outreachAgent.js'
import { loadTokens } from '../mcp/gmailTool.js'
import { linkedInLogin } from '../mcp/linkedinTool.js'
import { fetch_founder_info, fetch_company_news, draft_cold_message } from '../mcp/mcpServer.js'

const router = express.Router()

// ─── Gmail Status ─────────────────────────────────────────────────────────────
router.get('/gmail/status', (req, res) => {
  const tokens = loadTokens()
  res.json({ connected: !!tokens })
})

// ─── LinkedIn Login ───────────────────────────────────────────────────────────
router.post('/linkedin/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const result = await linkedInLogin({ email, password })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/outreach/enrich/:jobId — per-job on-demand enrichment ──────────
// Called when user clicks "Reach Out" on a specific job
// Runs 4-layer founder enrichment + drafts cold message (does NOT send anything)
router.post('/enrich/:jobId', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.jobId } })
    if (!job) return res.status(404).json({ error: 'Job not found' })

    // Return immediately with a status — enrichment is async
    res.json({ success: true, message: 'Enrichment started', jobId: job.id })

    // Run enrichment async after response
    ;(async () => {
      try {
        console.log(`\n🎯 On-demand enrichment for: ${job.title} @ ${job.company}`)

        const founderInfo = await fetch_founder_info({
          companyName: job.company,
          companyUrl: job.url,
          jobDescription: job.description || ''
        })

        const newsData = await fetch_company_news({ companyName: job.company })

        // Get resume summary for draft
        const resume = await prisma.resume.findFirst({ where: { userId: 'default' } })
        const resumeSummary = resume
          ? resume.content.split('\n').filter(l => l.trim().length > 20).slice(0, 8).join(' ').slice(0, 600)
          : ''

        let fitData = {}
        try { fitData = JSON.parse(job.fitReason || '{}') } catch {}

        const { message } = await draft_cold_message({
          founderName: founderInfo.name,
          companyName: job.company,
          jobTitle: job.title,
          jobDescription: job.description?.slice(0, 1000) || '',
          resumeSummary,
          talkingPoint: fitData.talkingPoint || '',
          companyNews: newsData.summary
        })

        await prisma.job.update({
          where: { id: job.id },
          data: {
            founderName: founderInfo.name,
            founderLinkedIn: founderInfo.linkedin,
            founderEmail: founderInfo.email,
            companyNews: newsData.summary,
            draftMessage: message,
            status: 'SELECTED',
          }
        })

        console.log(`  ✅ Enrichment complete for: ${job.company}`)
      } catch (err) {
        console.error(`  ❌ Enrichment failed for ${job.company}:`, err.message)
      }
    })()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/outreach/enrich/:jobId/status — poll enrichment result ──────────
router.get('/enrich/:jobId/status', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.jobId },
      select: {
        id: true,
        status: true,
        founderName: true,
        founderLinkedIn: true,
        founderEmail: true,
        companyNews: true,
        draftMessage: true,
      }
    })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    res.json({
      ready: !!job.draftMessage,
      ...job
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/outreach/send ──────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  try {
    const { jobId, channel = 'linkedin', founderEmail } = req.body
    if (!jobId) return res.status(400).json({ error: 'jobId required' })
    const result = await sendOutreach({ jobId, channel, founderEmail })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/outreach/send-all ──────────────────────────────────────────────
router.post('/send-all', async (req, res) => {
  try {
    const { channel = 'linkedin' } = req.body
    res.json({ message: 'Sending all selected jobs...', channel })
    sendAllApproved({ channel }).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/outreach/check-replies ────────────────────────────────────────
router.post('/check-replies', async (req, res) => {
  try {
    const result = await checkForReplies()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/outreach/logs ───────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const logs = await prisma.outreachLog.findMany({
      include: { job: { select: { title: true, company: true, founderName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    })
    res.json(logs)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/outreach/draft/:jobId ────────────────────────────────────────
router.patch('/draft/:jobId', async (req, res) => {
  try {
    const { draftMessage } = req.body
    const job = await prisma.job.update({
      where: { id: req.params.jobId },
      data: { draftMessage }
    })
    res.json({ success: true, job })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
