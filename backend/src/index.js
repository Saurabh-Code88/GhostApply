import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { initDB } from './db/client.js'
import { startScheduler } from './agents/scheduler.js'
import jobsRouter from './routes/jobs.js'
import outreachRouter from './routes/outreach.js'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin => origin.trim()).filter(Boolean)

app.set('trust proxy', 1)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})
app.use('/api', apiLimiter)

app.use('/api/jobs', jobsRouter)
app.use('/api/outreach', outreachRouter)
app.use('/auth', outreachRouter)

app.get('/health', async (_, res) => {
  try {
    await import('./db/client.js').then(async ({ prisma }) => {
      await prisma.$queryRaw`SELECT 1`
    })
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: '👻 GhostApply is hunting...',
      db: 'connected',
    })
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      message: 'Database unavailable',
      db: 'disconnected',
      error: error.message,
    })
  }
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  })
})

async function start() {
  try {
    await initDB()
    startScheduler()
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n👻 GhostApply backend running on http://0.0.0.0:${PORT}`)
      console.log(`   Health: http://0.0.0.0:${PORT}/health\n`)
    })
  } catch (err) {
    console.error('Failed to start:', err)
    process.exit(1)
  }
}

start()
