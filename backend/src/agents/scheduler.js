// src/agents/scheduler.js
// ⏰ SCHEDULER — runs the full GhostApply pipeline every morning at 6 AM

import cron from 'node-cron'
import { runHuntAgent } from './huntAgent.js'
import { runMatchAgent } from './matchAgent.js'
import { runResearchAgent } from './researchAgent.js'
import { checkForReplies } from './outreachAgent.js'

// Full pipeline: Hunt → Match → Research
async function runFullPipeline() {
  const startTime = Date.now()
  console.log('\n╔══════════════════════════════════════╗')
  console.log('  ║   👻 GhostApply Pipeline Starting    |')
  console.log(`  ║${new Date().toLocaleString('en-IN')} ║`)
  console.log('  ╚══════════════════════════════════════╝\n')

  try {
    // Step 1: Hunt
    console.log('STEP 1/3 — HUNT\n' + '─'.repeat(40))
    const huntResult = await runHuntAgent()

    // Step 2: Match
    console.log('\nSTEP 2/3 — MATCH\n' + '─'.repeat(40))
    const matchResult = await runMatchAgent('default', { jobIds: huntResult.jobIds })

    // Step 3: Research (only if new matches found)
    console.log('\nSTEP 3/3 — RESEARCH\n' + '─'.repeat(40))
    const researchResult = await runResearchAgent('default', { jobIds: matchResult.matchedJobIds })

    // Step 4: Check replies
    console.log('\nSTEP 4/4 — CHECK REPLIES\n' + '─'.repeat(40))
    const replyResult = await checkForReplies()

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log('\n╔══════════════════════════════════════╗')
    console.log('║        ✅ Pipeline Complete           ║')
    console.log(`║  🔍 Scraped:  ${String(huntResult.total).padEnd(22)}║`)
    console.log(`║  🎯 Matched:  ${String(matchResult.matched).padEnd(22)}║`)
    console.log(`║  📬 Drafted:  ${String(researchResult.researched).padEnd(22)}║`)
    console.log(`║  💬 Replied:  ${String(replyResult.replied).padEnd(22)}║`)
    console.log(`║  ⏱️  Duration: ${String(duration + ' min').padEnd(22)}║`)
    console.log('╚══════════════════════════════════════╝\n')

  } catch (err) {
    console.error('💀 Pipeline error:', err)
  }
}

// Schedule: every day at 6:00 AM IST
export function startScheduler() {
  console.log('⏰ Scheduler started — pipeline runs daily at 6:00 AM IST')

  cron.schedule('0 6 * * *', runFullPipeline, {
    timezone: 'Asia/Kolkata'
  })
}

// Also export for manual trigger via API
export { runFullPipeline }
