// src/agents/outreachAgent.js
// 📬 OUTREACH AGENT — sends approved job outreach via Gmail + LinkedIn

import { prisma } from '../db/client.js'
import { send_email, generate_subject, check_replies } from '../mcp/gmailTool.js'
import { send_linkedin_message } from '../mcp/linkedinTool.js'

// ─── Send outreach for a single approved job ──────────────────────────────────

export async function sendOutreach({ jobId, channel = 'linkedin', founderEmail = null }) {
  const job = await prisma.job.findUnique({ where: { id: jobId } })
  if (!job) throw new Error(`Job ${jobId} not found`)
  if (!job.draftMessage) throw new Error(`No draft message for job ${jobId}`)
  if (job.status !== 'APPROVED') throw new Error(`Job must be APPROVED to send outreach`)

  console.log(`\n📬 Sending outreach: ${job.title} @ ${job.company} via ${channel}`)

  let result = null

  if (channel === 'email' && founderEmail) {
    // Generate a smart subject line
    let fitData = {}
    try { fitData = JSON.parse(job.fitReason || '{}') } catch {}

    const subject = await generate_subject({
      founderName: job.founderName,
      companyName: job.company,
      jobTitle: job.title,
      talkingPoint: fitData.talkingPoint || ''
    })

    console.log(`  📌 Subject: "${subject}"`)

    result = await send_email({
      to: founderEmail,
      subject,
      body: job.draftMessage,
      jobId
    })

    // Save to outreach log
    await prisma.outreachLog.create({
      data: {
        jobId,
        message: job.draftMessage,
        sentAt: new Date(),
        status: 'SENT',
        // Store threadId for reply tracking
        ...(result.threadId && { threadId: result.threadId })
      }
    })
  }

  if (channel === 'linkedin' && job.founderLinkedIn) {
    result = await send_linkedin_message({
      profileUrl: job.founderLinkedIn,
      message: job.draftMessage,
      founderName: job.founderName
    })

    await prisma.outreachLog.create({
      data: {
        jobId,
        message: job.draftMessage,
        sentAt: new Date(),
        status: result.success ? 'SENT' : 'DRAFT'
      }
    })
  }

  // Update job status
  if (result?.success) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'SENT' }
    })
    console.log(`  ✅ Outreach sent successfully`)
  }

  return result
}

// ─── Check for replies (runs daily) ──────────────────────────────────────────

export async function checkForReplies() {
  console.log('\n🔍 Checking for replies...')

  // Get all sent outreach logs that have threadIds
  const sentLogs = await prisma.outreachLog.findMany({
    where: {
      status: 'SENT',
      threadId: { not: null }
    },
    include: { job: true }
  })

  if (!sentLogs.length) {
    console.log('  No sent outreach to check.')
    return { checked: 0, replied: 0 }
  }

  const threadIds = sentLogs.map(l => l.threadId).filter(Boolean)
  const replyResults = await check_replies({ threadIds })

  let repliedCount = 0

  for (const result of replyResults) {
    if (result.replied) {
      const log = sentLogs.find(l => l.threadId === result.threadId)
      if (!log) continue

      // Update log + job status
      await prisma.outreachLog.update({
        where: { id: log.id },
        data: { status: 'REPLIED' }
      })

      await prisma.job.update({
        where: { id: log.jobId },
        data: { status: 'REPLIED' }
      })

      console.log(`  🎉 REPLY from: ${log.job.company} (${result.from})`)
      repliedCount++
    }
  }

  // Mark ghosted — no reply after 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  await prisma.outreachLog.updateMany({
    where: {
      status: 'SENT',
      sentAt: { lt: sevenDaysAgo }
    },
    data: { status: 'GHOSTED' }
  })

  // Also update job status for ghosted
  const ghostedLogs = await prisma.outreachLog.findMany({
    where: { status: 'GHOSTED' },
    select: { jobId: true }
  })

  for (const log of ghostedLogs) {
    await prisma.job.update({
      where: { id: log.jobId },
      data: { status: 'GHOSTED' }
    }).catch(() => {}) // ignore if already updated
  }

  console.log(`  ✅ Checked ${threadIds.length} threads · ${repliedCount} new replies`)
  return { checked: threadIds.length, replied: repliedCount }
}

// ─── Bulk send all approved jobs ──────────────────────────────────────────────

export async function sendAllApproved({ channel = 'linkedin' }) {
  const approvedJobs = await prisma.job.findMany({
    where: { status: 'APPROVED' }
  })

  console.log(`\n📬 Sending outreach for ${approvedJobs.length} approved jobs via ${channel}`)

  const results = []
  for (const job of approvedJobs) {
    const result = await sendOutreach({ jobId: job.id, channel })
    results.push({ jobId: job.id, company: job.company, ...result })

    // Delay between sends
    await new Promise(r => setTimeout(r, 3000))
  }

  return results
}
