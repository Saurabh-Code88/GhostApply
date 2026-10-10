// scripts/reset-password.js
// Reset a user's password directly via CLI:
// Usage: node scripts/reset-password.js <email> <newPassword> [optionalSecurityQuestion] [optionalSecurityAnswer]

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const [,, emailArg, newPasswordArg, secQArg, secAArg] = process.argv

  if (!emailArg) {
    console.log('\n❌ Error: Email required.')
    console.log('Usage: node scripts/reset-password.js <email> <newPassword> [securityQuestion] [securityAnswer]')
    console.log('\nExisting users:')
    const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, securityQuestion: true } })
    if (users.length === 0) {
      console.log('  (No users in database)')
    } else {
      users.forEach(u => console.log(`  - ${u.email} (${u.name || 'unnamed'}) | Security Question: ${u.securityQuestion ? 'SET' : 'NOT SET'}`))
    }
    process.exit(1)
  }

  const email = emailArg.toLowerCase().trim()
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    console.log(`\n❌ No user found with email: ${email}`)
    const all = await prisma.user.findMany({ select: { email: true } })
    console.log('Existing emails in DB:', all.map(a => a.email).join(', ') || 'None')
    process.exit(1)
  }

  if (!newPasswordArg) {
    console.log(`\n❌ Error: New password required for user ${email}`)
    console.log('Usage: node scripts/reset-password.js <email> <newPassword> [securityQuestion] [securityAnswer]')
    process.exit(1)
  }

  if (newPasswordArg.length < 6) {
    console.log('\n❌ Password must be at least 6 characters')
    process.exit(1)
  }

  const hashedPassword = await bcrypt.hash(newPasswordArg, 10)
  const updateData = {
    password: hashedPassword,
    updatedAt: new Date(),
  }

  if (secQArg && secAArg) {
    updateData.securityQuestion = secQArg
    updateData.securityAnswer = await bcrypt.hash(secAArg.trim().toLowerCase(), 10)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  })

  console.log(`\n✅ Password successfully updated for: ${email}`)
  if (secQArg && secAArg) {
    console.log(`✅ Security question & answer also set to: "${secQArg}"`)
  }
}

main()
  .catch(err => {
    console.error('❌ Error resetting password:', err)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
