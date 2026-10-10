// src/agents/scheduler.js
import cron from 'node-cron'
import { runHuntAgent } from './huntAgent.js'
import { runMatchAgent } from './matchAgent.js'
import { checkForReplies } from './outreachAgent.js'
import { prisma } from '../db/client.js'

let _lastRun = null
let _pipelineRunning = false

// Map of scheduleId → cron task, so we can stop/restart them on reload
const _cronTasks = new Map()

export function getLastRun() { return _lastRun }
export function isPipelineRunning() { return _pipelineRunning }

async function getResumeKeywords(userId) {
  try {
    const resume = await prisma.resume.findFirst({ where: { userId } })
    if (resume?.searchKeywords) return JSON.parse(resume.searchKeywords)
  } catch { /* ignore */ }
  return null
}

export async function runFullPipeline(userId = 'default') {
  if (_pipelineRunning) return
  _pipelineRunning = true
  const startTime = Date.now()
  console.log('\n╔══════════════════════════════════════╗')
  console.log('  ║   👻 GhostApply Pipeline Starting    |')
  console.log(`  ║${new Date().toLocaleString('en-IN')} ║`)
  console.log('  ╚══════════════════════════════════════╝\n')

  try {
    const keywords = await getResumeKeywords(userId)

    console.log('STEP 1/2 — HUNT\n' + '─'.repeat(40))
    const huntResult = await runHuntAgent({ keywords, userId })

    console.log('\nSTEP 2/2 — MATCH\n' + '─'.repeat(40))
    const matchResult = await runMatchAgent(userId, { jobIds: huntResult.jobIds })

    console.log('\nCHECK REPLIES\n' + '─'.repeat(40))
    const replyResult = await checkForReplies()

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    _lastRun = {
      completedAt: new Date().toISOString(),
      duration: parseFloat(duration),
      scraped: huntResult.total,
      newSaved: huntResult.saved,
      matched: matchResult.matched,
      replied: replyResult.replied,
    }

    console.log('\n╔══════════════════════════════════════╗')
    console.log('║        ✅ Pipeline Complete           ║')
    console.log(`║  🔍 Scraped:  ${String(huntResult.total).padEnd(22)}║`)
    console.log(`║  🎯 Matched:  ${String(matchResult.matched).padEnd(22)}║`)
    console.log(`║  💬 Replied:  ${String(replyResult.replied).padEnd(22)}║`)
    console.log(`║  ⏱️  Duration: ${String(duration + ' min').padEnd(22)}║`)
    console.log('╚══════════════════════════════════════╝\n')
  } catch (err) {
    console.error('💀 Pipeline error:', err)
  } finally {
    _pipelineRunning = false
  }
}

/**
 * Load all enabled schedules from DB and register cron jobs.
 * Stops any previously registered cron jobs first (hot-reload safe).
 */
export async function reloadSchedules() {
  // Stop all existing user-defined cron tasks
  for (const [id, task] of _cronTasks.entries()) {
    task.stop()
    _cronTasks.delete(id)
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: { enabled: true },
    })

    for (const schedule of schedules) {
      if (!cron.validate(schedule.cronExpr)) {
        console.warn(`  ⚠️ Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpr}`)
        continue
      }

      const task = cron.schedule(schedule.cronExpr, async () => {
        console.log(`\n⏰ Scheduled run triggered: "${schedule.name}" (${schedule.cronExpr})`)
        try {
          // Update lastRunAt
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: { lastRunAt: new Date() },
          })
          await runFullPipeline(schedule.userId)
        } catch (err) {
          console.error(`  ❌ Scheduled run error for ${schedule.id}:`, err.message)
        }
      }, { timezone: schedule.timezone || 'Asia/Kolkata' })

      _cronTasks.set(schedule.id, task)
      console.log(`  ✅ Registered schedule: "${schedule.name}" → ${schedule.cronExpr} (${schedule.timezone})`)
    }

    console.log(`⏰ ${schedules.length} user schedule(s) loaded`)
  } catch (err) {
    console.error('  ❌ Failed to load schedules:', err.message)
  }
}

export function startScheduler() {
  console.log('⏰ Scheduler starting — loading user-defined schedules...')
  // Load user-defined schedules from DB
  reloadSchedules().catch(console.error)
}
