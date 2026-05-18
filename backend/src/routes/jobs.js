// src/routes/jobs.js
import express from 'express'
import multer from 'multer'
import path from 'path'
import { prisma } from '../db/client.js'
import { processResume } from '../agents/matchAgent.js'
import { runFullPipeline } from '../agents/scheduler.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// ─── GET /api/jobs — fetch all jobs with filters ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, minScore, page = 1, limit = 20 } = req.query

    const where = {}
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

    // Parse fitReason JSON
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
    const [total, matched, approved, sent, replied, ghosted] = await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: { status: 'MATCHED' } }),
      prisma.job.count({ where: { status: 'APPROVED' } }),
      prisma.job.count({ where: { status: 'SENT' } }),
      prisma.job.count({ where: { status: 'REPLIED' } }),
      prisma.job.count({ where: { status: 'GHOSTED' } }),
    ])

    res.json({ total, matched, approved, sent, replied, ghosted })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/jobs/:id — update job status ──────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status, draftMessage } = req.body
    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(draftMessage && { draftMessage })
      }
    })
    res.json(job)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/resume/upload ──────────────────────────────────────────────────
router.post('/resume/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const result = await processResume(req.file.path, 'default')
    res.json({ success: true, resumeId: result.resume.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/pipeline/run — manual trigger ──────────────────────────────────
router.post('/pipeline/run', async (req, res) => {
  try {
    res.json({ success: true, message: 'Pipeline started — check console for progress' })
    // Run async after response
    runFullPipeline().catch(console.error)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
