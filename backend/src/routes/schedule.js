// src/routes/schedule.js
import express from 'express'
import { prisma } from '../db/client.js'
import { reloadSchedules } from '../agents/scheduler.js'

const router = express.Router()

// ─── GET /api/schedules ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ schedules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/schedules ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, cronExpr, timezone } = req.body
    if (!cronExpr) return res.status(400).json({ error: 'cronExpr is required' })

    const schedule = await prisma.schedule.create({
      data: {
        userId: req.user.userId,
        name: name || 'Daily Hunt',
        cronExpr,
        timezone: timezone || 'Asia/Kolkata',
        enabled: true,
      },
    })

    // Hot-reload cron jobs
    reloadSchedules().catch(console.error)

    res.json({ schedule })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/schedules/:id ───────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { enabled, name, cronExpr, timezone } = req.body
    const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.userId !== req.user.userId) {
      return res.status(404).json({ error: 'Schedule not found' })
    }

    const schedule = await prisma.schedule.update({
      where: { id: req.params.id },
      data: {
        ...(enabled !== undefined && { enabled }),
        ...(name && { name }),
        ...(cronExpr && { cronExpr }),
        ...(timezone && { timezone }),
      },
    })

    reloadSchedules().catch(console.error)

    res.json({ schedule })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── DELETE /api/schedules/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.userId !== req.user.userId) {
      return res.status(404).json({ error: 'Schedule not found' })
    }

    await prisma.schedule.delete({ where: { id: req.params.id } })

    reloadSchedules().catch(console.error)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
