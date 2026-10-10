import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany()
  if (users.length === 0) {
    console.log('No users found.')
    return
  }
  
  // Assuming the active user is the latest one created, or just the first one if there's only one.
  const activeUser = users.find(u => u.email === 'saunikpramanik121@gmail.com') || users[users.length - 1]
  console.log(`Assigning orphaned jobs to ${activeUser.email} (${activeUser.id})`)
  
  const result = await prisma.job.updateMany({
    where: { userId: null },
    data: { userId: activeUser.id }
  })
  
  console.log(`Updated ${result.count} jobs.`)
}

main().finally(() => prisma.$disconnect())
