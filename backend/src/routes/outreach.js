import express from 'express'
import { prisma } from '../db/client.js'
import { sendOutreach, checkForReplies, sendAllApproved } from '../agents/outreachAgent.js'
import { getAuthUrl, exchangeCodeForTokens, loadTokens } from '../mcp/gmailTool.js'
import { linkedInLogin } from '../mcp/linkedinTool.js'

const router = express.Router()

function requireAdmin(req, res, next) {
  const token = process.env.APP_ADMIN_TOKEN
  if (!token) return next()

  const authHeader = req.headers.authorization || ''
  if (authHeader === `Bearer ${token}`) return next()

  return res.status(401).json({ error: 'Unauthorized' })
}

router.get('/gmail', (req, res) => {
  const url = getAuthUrl()
  res.redirect(url)
})

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

router.get('/gmail/status', (req, res) => {
  const tokens = loadTokens()
  res.json({ connected: !!tokens })
})

router.post('/linkedin/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const result = await linkedInLogin({ email, password })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/send', requireAdmin, async (req, res) => {
  try {
    const { jobId, channel = 'linkedin', founderEmail } = req.body
    if (!jobId) return res.status(400).json({ error: 'jobId required' })

    const result = await sendOutreach({ jobId, channel, founderEmail })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/send-all', requireAdmin, async (req, res) => {
  try {
    const { channel = 'linkedin' } = req.body
    res.json({ message: 'Sending all approved jobs...', channel })
    sendAllApproved({ channel }).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/check-replies', requireAdmin, async (req, res) => {
  try {
    const result = await checkForReplies()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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

router.patch('/draft/:jobId', requireAdmin, async (req, res) => {
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
