// scripts/dedup-jobs.js
// One-off cleanup: remove duplicate (title, company) jobs from the DB
// keeping only the best-scored (or most recent) per pair.
//
// Run: node scripts/dedup-jobs.js

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function normalizeText(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

async function main() {
  const all = await prisma.job.findMany({
    orderBy: [{ fitScore: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      company: true,
      status: true,
      fitScore: true,
      createdAt: true,
    }
  })

  console.log(`Total jobs in DB: ${all.length}`)

  const seenKeys = new Map() // key -> best job id to keep
  const toDelete = []

  for (const job of all) {
    const key = `${normalizeText(job.title)}::${normalizeText(job.company)}`
    if (!seenKeys.has(key)) {
      seenKeys.set(key, job.id)
    } else {
      toDelete.push(job.id)
    }
  }

  console.log(`Duplicates to remove: ${toDelete.length}`)

  if (toDelete.length === 0) {
    console.log('✅ No duplicates found.')
    return
  }

  // Show what we're deleting
  const dupeJobs = all.filter(j => toDelete.includes(j.id))
  for (const j of dupeJobs.slice(0, 20)) {
    console.log(`  🗑️  [${j.status}] ${j.title} @ ${j.company} (score: ${j.fitScore ?? 'null'})`)
  }
  if (dupeJobs.length > 20) console.log(`  ... and ${dupeJobs.length - 20} more`)

  const { count } = await prisma.job.deleteMany({
    where: { id: { in: toDelete } }
  })

  console.log(`\n✅ Deleted ${count} duplicate job records.`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌ Error:', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
