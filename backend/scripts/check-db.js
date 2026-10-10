import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const [counts, top] = await Promise.all([
  p.job.groupBy({ by: ['status'], _count: { _all: true } }),
  p.job.findMany({ where: { status: 'MATCHED' }, select: { title: true, company: true, fitScore: true, draftMessage: true }, take: 10, orderBy: { fitScore: 'desc' } })
])
console.log('\n=== STATUS COUNTS ===')
counts.forEach(c => console.log(`  ${c.status}: ${c._count._all}`))
console.log('\n=== TOP MATCHED JOBS ===')
top.forEach(j => console.log(`  [${j.fitScore}] ${j.title} @ ${j.company} | draft: ${j.draftMessage ? 'YES' : 'NO'}`))
await p.$disconnect()
