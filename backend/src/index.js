// src/index.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDB } from './db/client.js'
import { startScheduler } from './agents/scheduler.js'
import jobsRouter from './routes/jobs.js'
import outreachRouter from './routes/outreach.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

// Routes
app.use('/api/jobs', jobsRouter)
app.use('/api/outreach', outreachRouter)
app.use('/auth', outreachRouter)

// Health check
app.get('/health', (_, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  message: '👻 GhostApply is hunting...'
}))

// Startup
async function start() {
  try {
    await initDB()
    startScheduler()
    app.listen(PORT, () => {
      console.log(`\n👻 GhostApply backend running on http://localhost:${PORT}`)
      console.log(`   Health: http://localhost:${PORT}/health\n`)
    })
  } catch (err) {
    console.error('Failed to start:', err)
    process.exit(1)
  }
}

start()
