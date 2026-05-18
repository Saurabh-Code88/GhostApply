// src/routes/outreach.js
import express from 'express'
import { prisma } from '../db/client.js'
import { sendOutreach, checkForReplies, sendAllApproved } from '../agents/outreachAgent.js'
import { getAuthUrl, exchangeCodeForTokens, loadTokens } from '../mcp/gmailTool.js'
import { linkedInLogin } from '../mcp/linkedinTool.js'

const router = express.Router()

// ─── Gmail OAuth ──────────────────────────────────────────────────────────────

// GET /auth/gmail — redirect to Google consent screen
router.get('/gmail', (req, res) => {
  const url = getAuthUrl()
  res.redirect(url)
})

// GET /auth/gmail/callback — Google redirects here with code
router.get('/gmail/callback', async (req, res) => {
  try {
    const { code } = req.query
    await exchangeCodeForTokens(code)
    res.send(`
      <html><body style="font-family:monospace;padding:40px;background:#080808;color:#00ff88">
        <h2>✅ Gmail connected!</h2>
        <p>You can close this tab and return to GhostApply.</p>
      </body></html>
    `)
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`)
  }
})

// GET /api/outreach/gmail/status — check if Gmail is connected
router.get('/gmail/status', (req, res) => {
  const tokens = loadTokens()
  res.json({ connected: !!tokens })
})

// ─── LinkedIn Login ───────────────────────────────────────────────────────────

// POST /api/outreach/linkedin/login
router.post('/linkedin/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const result = await linkedInLogin({ email, password })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Send Outreach ────────────────────────────────────────────────────────────

// POST /api/outreach/send
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

// POST /api/outreach/send-all
router.post('/send-all', async (req, res) => {
  try {
    const { channel = 'linkedin' } = req.body
    res.json({ message: 'Sending all approved jobs...', channel })
    sendAllApproved({ channel }).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/outreach/check-replies
router.post('/check-replies', async (req, res) => {
  try {
    const result = await checkForReplies()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Outreach History ─────────────────────────────────────────────────────────

// GET /api/outreach/logs
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

// ─── Update draft message ─────────────────────────────────────────────────────

// PATCH /api/outreach/draft/:jobId
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
