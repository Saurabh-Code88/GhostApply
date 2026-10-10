// src/routes/jobs.js
import express from 'express'
import multer from 'multer'
import { prisma } from '../db/client.js'
import { processResume } from '../agents/matchAgent.js'
import { runHuntAgent } from '../agents/huntAgent.js'
import { runMatchAgent } from '../agents/matchAgent.js'
import { runFullPipeline, getLastRun, isPipelineRunning } from '../agents/scheduler.js'
import { runStartupHunt, isStartupHuntRunning, getStartupHuntLastRun } from '../agents/startupHuntAgent.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// ─── GET /api/jobs/resume ─────────────────────────────────────────────────────
router.get('/resume', async (req, res) => {
  try {
    const resume = await prisma.resume.findFirst({ where: { userId: req.user.userId } })
    if (!resume) return res.json({ resume: null })

    res.json({
      resume: {
        id: resume.id,
        hasResume: true,
        targetRoles: resume.targetRoles ? JSON.parse(resume.targetRoles) : [],
        targetSkills: resume.targetSkills ? JSON.parse(resume.targetSkills) : [],
        searchKeywords: resume.searchKeywords ? JSON.parse(resume.searchKeywords) : [],
        experienceLevel: resume.experienceLevel || 'fresher',
        updatedAt: resume.updatedAt,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/jobs/resume/upload ─────────────────────────────────────────────
router.post('/resume/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const result = await processResume(req.file.path, req.user.userId)
    res.json({
      success: true,
      resumeId: result.resume.id,
      profile: result.profile,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/jobs/resume ───────────────────────────────────────────────────
router.patch('/resume', async (req, res) => {
  try {
    const { targetRoles } = req.body
    if (!Array.isArray(targetRoles)) {
      return res.status(400).json({ error: 'targetRoles must be an array' })
    }

    const existing = await prisma.resume.findFirst({ where: { userId: req.user.userId } })
    if (!existing) return res.status(404).json({ error: 'No resume found. Upload a resume first.' })

    // Regenerate search keywords using the existing resume content + new roles
    const { extractRoleProfile } = await import('../agents/matchAgent.js')
    const roleContext = `Target roles: ${targetRoles.join(', ')}.\n\n${existing.content.slice(0, 3000)}`
    const profile = await extractRoleProfile(roleContext)

    // Override roles with user-specified ones, keep AI-generated keywords
    const updatedResume = await prisma.resume.update({
      where: { id: existing.id },
      data: {
        targetRoles: JSON.stringify(targetRoles),
        targetSkills: JSON.stringify(profile.skills),
        searchKeywords: JSON.stringify(profile.searchKeywords),
        experienceLevel: profile.experienceLevel,
      },
    })

    res.json({
      success: true,
      resume: {
        id: updatedResume.id,
        hasResume: true,
        targetRoles,
        targetSkills: profile.skills,
        searchKeywords: profile.searchKeywords,
        experienceLevel: profile.experienceLevel,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/jobs ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, minScore, page = 1, limit = 200 } = req.query

    const where = { userId: req.user.userId }
    if (status) where.status = status
    if (minScore) where.fitScore = { gte: parseFloat(minScore) }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ fitScore: 'desc' }, { createdAt: 'desc' }],
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.job.count({ where })
    ])

    const parsed = jobs.map(job => ({
      ...job,
      fitData: (() => {
        try { return JSON.parse(job.fitReason || '{}') } catch { return {} }
      })()
    }))

    res.json({ jobs: parsed, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/jobs/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const uid = req.user.userId
    const [total, matched, selected, sent, replied, ghosted] = await Promise.all([
      prisma.job.count({ where: { userId: uid } }),
      prisma.job.count({ where: { userId: uid, status: 'MATCHED' } }),
      prisma.job.count({ where: { userId: uid, status: 'SELECTED' } }),
      prisma.job.count({ where: { userId: uid, status: 'SENT' } }),
      prisma.job.count({ where: { userId: uid, status: 'REPLIED' } }),
      prisma.job.count({ where: { userId: uid, status: 'GHOSTED' } }),
    ])
    res.json({ total, matched, selected, sent, replied, ghosted })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/jobs/stats/weekly ───────────────────────────────────────────────
router.get('/stats/weekly', async (req, res) => {
  try {
    const uid = req.user.userId
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      days.push({ label: DAY_LABELS[d.getDay()], start: new Date(d), end })
    }

    const results = await Promise.all(
      days.map(async ({ label, start, end }) => {
        const [scraped, matched] = await Promise.all([
          prisma.job.count({ where: { userId: uid, createdAt: { gte: start, lt: end } } }),
          prisma.job.count({
            where: {
              userId: uid,
              createdAt: { gte: start, lt: end },
              status: { in: ['MATCHED', 'SELECTED', 'SENT', 'REPLIED', 'GHOSTED'] }
            }
          })
        ])
        return { day: label, scraped, matched }
      })
    )

    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/jobs/:id ──────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status, draftMessage } = req.body
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(draftMessage !== undefined && { draftMessage })
      }
    })
    res.json(job)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/jobs/pipeline/status ───────────────────────────────────────────
router.get('/pipeline/status', (req, res) => {
  res.json({ running: isPipelineRunning(), lastRun: getLastRun() })
})

// ─── POST /api/jobs/pipeline/run ─────────────────────────────────────────────
router.post('/pipeline/run', async (req, res) => {
  try {
    res.json({ success: true, message: 'Pipeline started' })
    runFullPipeline(req.user.userId).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/jobs/hunt ──────────────────────────────────────────────────────
router.post('/hunt', async (req, res) => {
  if (isPipelineRunning()) return res.status(409).json({ error: 'Pipeline already running' })
  try {
    res.json({ success: true, message: 'Hunt started' })
    const resume = await prisma.resume.findFirst({ where: { userId: req.user.userId } })
    const keywords = resume?.searchKeywords ? JSON.parse(resume.searchKeywords) : null
    runHuntAgent({ keywords, userId: req.user.userId }).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/jobs/match ─────────────────────────────────────────────────────
router.post('/match', async (req, res) => {
  if (isPipelineRunning()) return res.status(409).json({ error: 'Pipeline already running' })
  try {
    res.json({ success: true, message: 'Match started' })
    runMatchAgent(req.user.userId).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/jobs/startup-hunt/status ────────────────────────────────────────
router.get('/startup-hunt/status', (req, res) => {
  res.json({ running: isStartupHuntRunning(), lastRun: getStartupHuntLastRun() })
})

// ─── POST /api/jobs/startup-hunt ──────────────────────────────────────────────
router.post('/startup-hunt', async (req, res) => {
  if (isPipelineRunning() || isStartupHuntRunning()) {
    return res.status(409).json({ error: 'A hunt is already running' })
  }
  try {
    res.json({ success: true, message: 'Startup Hunt started' })
    const resume = await prisma.resume.findFirst({ where: { userId: req.user.userId } })
    const keywords = resume?.searchKeywords ? JSON.parse(resume.searchKeywords) : null
    const skills = resume?.targetSkills ? JSON.parse(resume.targetSkills) : null
    runStartupHunt({ keywords, skills, userId: req.user.userId }).catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
