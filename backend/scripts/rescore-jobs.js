// scripts/rescore-jobs.js
// Re-score all SKIPPED jobs that had Groq analyzed (fitReason exists) using the new formula
// Run: node scripts/rescore-jobs.js

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { calibrateScore } from '../src/agents/matchAgent.js'

const prisma = new PrismaClient()

const MATCH_THRESHOLD = 52

async function main() {
  // Find all SKIPPED jobs that had Groq scoring (have fitReason with groqScore)
  const skipped = await prisma.job.findMany({
    where: { status: 'SKIPPED', fitReason: { not: null } }
  })

  console.log(`Found ${skipped.length} SKIPPED jobs to re-evaluate\n`)

  let promoted = 0
  let stillSkipped = 0

  for (const job of skipped) {
    let fitData
    try { fitData = JSON.parse(job.fitReason) } catch { continue }

    const vectorScore = fitData.vectorScore
    const groqScore = fitData.groqScore
    if (!vectorScore || !groqScore) continue

    const calibration = calibrateScore(vectorScore, groqScore, job)
    const newScore = calibration.finalScore

    if (newScore >= MATCH_THRESHOLD) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'PENDING', // reset to PENDING so matchAgent can process them
          fitScore: null,
          fitReason: null
        }
      })
      console.log(`  🎯 PROMOTED: [${newScore}] ${job.title} @ ${job.company} (was ${job.fitScore})`)
      promoted++
    } else {
      stillSkipped++
    }
  }

  console.log(`\n✅ Done: ${promoted} promoted to PENDING for re-match, ${stillSkipped} still below threshold.`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Error:', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
