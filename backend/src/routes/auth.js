// src/routes/auth.js
// Auth routes: user register/login/me/onboard/forgot-password + Gmail OAuth

import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { getAuthUrl, exchangeCodeForTokens } from '../mcp/gmailTool.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = express.Router()
const prisma = new PrismaClient()

const SECURITY_QUESTIONS = [
  "What is your pet's name?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the name of your first school?",
  "What is your favourite movie?",
  "What is your favourite food?",
]

function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  )
}

function safeUser(user) {
  const { password, securityAnswer, ...rest } = user
  return rest
}

// ─── GET /auth/security-questions — list available questions ──────────────────
router.get('/security-questions', (req, res) => {
  res.json({ questions: SECURITY_QUESTIONS })
})

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, securityQuestion, securityAnswer } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
    if (!securityQuestion || !securityAnswer?.trim()) {
      return res.status(400).json({ error: 'Security question and answer are required' })
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' })

    const hashedPassword = await bcrypt.hash(password, 10)
    const hashedAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 10)
    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const user = await prisma.user.create({
      data: {
        id,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name?.trim() || null,
        securityQuestion,
        securityAnswer: hashedAnswer,
      }
    })

    const token = signToken(user)
    res.status(201).json({ token, user: safeUser(user) })
  } catch (err) {
    console.error('Register error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return res.status(401).json({ error: 'Invalid email or password' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

    const token = signToken(user)
    res.json({ token, user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /auth/forgot-password/verify-email — check if email exists & return question ──
router.post('/forgot-password/verify-email', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return res.status(404).json({ error: 'No account found with this email' })

    if (!user.securityQuestion || !user.securityAnswer) {
      return res.status(400).json({
        error: 'No security question set for this account. Use the direct reset below.',
        noQuestion: true,
      })
    }

    res.json({ securityQuestion: user.securityQuestion })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /auth/forgot-password/reset — verify answer + set new password ─────
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, securityAnswer, newPassword } = req.body
    if (!email || !securityAnswer || !newPassword) {
      return res.status(400).json({ error: 'Email, security answer, and new password are required' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return res.status(404).json({ error: 'No account found with this email' })

    if (!user.securityAnswer) {
      return res.status(400).json({ error: 'No security question set for this account' })
    }

    const valid = await bcrypt.compare(securityAnswer.trim().toLowerCase(), user.securityAnswer)
    if (!valid) return res.status(401).json({ error: 'Incorrect security answer' })

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, updatedAt: new Date() },
    })

    const token = signToken(updated)
    res.json({ token, user: safeUser(updated), message: 'Password reset successful' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /auth/forgot-password/direct-reset — for legacy users with no security question ──
// This uses email-only verification (acceptable for local/personal app)
router.post('/forgot-password/direct-reset', async (req, res) => {
  try {
    const { email, newPassword, securityQuestion, securityAnswer } = req.body
    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password are required' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return res.status(404).json({ error: 'No account found with this email' })

    // Only allow direct reset if user has NO security question set
    if (user.securityQuestion && user.securityAnswer) {
      return res.status(400).json({ error: 'This account has a security question. Use the standard reset flow.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    const updateData = { password: hashedPassword, updatedAt: new Date() }

    // If they also provided a security question + answer, save those too
    if (securityQuestion && securityAnswer?.trim()) {
      updateData.securityQuestion = securityQuestion
      updateData.securityAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 10)
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    })

    const token = signToken(updated)
    res.json({ token, user: safeUser(updated), message: 'Password reset successful' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /auth/me — get current user from token ───────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /auth/onboard — save profile form, mark onboarded ─────────────────
router.patch('/onboard', requireAuth, async (req, res) => {
  try {
    const { name, status, location, targetJobs } = req.body
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        name: name?.trim() || undefined,
        status: status || undefined,
        location: location?.trim() || undefined,
        targetJobs: Array.isArray(targetJobs) ? JSON.stringify(targetJobs) : undefined,
        isOnboarded: true,
        updatedAt: new Date(),
      }
    })
    res.json({ user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Gmail OAuth (unchanged) ──────────────────────────────────────────────────
router.get('/gmail', (req, res) => {
  try {
    const url = getAuthUrl()
    res.redirect(url)
  } catch (err) {
    res.status(500).send(`OAuth setup error: ${err.message}`)
  }
})

router.get('/gmail/callback', async (req, res) => {
  try {
    const { code, error } = req.query
    if (error) return res.status(400).send(`<html><body style="font-family:monospace;padding:40px;background:#080808;color:#ff4444"><h2>❌ Gmail auth failed</h2><p>${error}</p></body></html>`)
    if (!code) return res.status(400).send('Missing auth code')
    await exchangeCodeForTokens(code)
    res.send(`<html><body style="font-family:monospace;padding:40px;background:#080808;color:#00ff88"><h2>✅ Gmail connected!</h2><p>You can close this tab.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>`)
  } catch (err) {
    res.status(500).send(`<html><body style="font-family:monospace;padding:40px;background:#080808;color:#ff4444"><h2>❌ Error</h2><p>${err.message}</p></body></html>`)
  }
})

export default router
