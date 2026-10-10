import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('Clearing database...')
  
  // Delete outreach logs first (to avoid foreign key constraint errors)
  const deletedLogs = await prisma.outreachLog.deleteMany({})
  console.log(`Deleted ${deletedLogs.count} outreach logs.`)

  // Delete all jobs
  const deletedJobs = await prisma.job.deleteMany({})
  console.log(`Deleted ${deletedJobs.count} jobs.`)
}

main()
  .then(() => console.log('Database cleared successfully!'))
  .catch(console.error)
  .finally(() => prisma.$disconnect())
