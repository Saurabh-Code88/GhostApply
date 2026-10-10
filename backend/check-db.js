import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const jobs = await prisma.job.groupBy({ by: ['userId'], _count: true })
  console.log('Jobs by userId:', jobs)
  
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true } })
  console.log('Users in DB:', users)
}

main().finally(() => prisma.$disconnect())
