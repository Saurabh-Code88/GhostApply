// src/mcp/linkedinTool.js
// 🔗 LINKEDIN MCP TOOL — automated message sending via Playwright

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_PATH = path.join(__dirname, '../../.linkedin_session.json')

// ─── Session Management ───────────────────────────────────────────────────────

export async function saveLinkedInSession(cookies) {
  fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2))
  console.log('✅ LinkedIn session saved')
}

function loadLinkedInSession() {
  if (!fs.existsSync(SESSION_PATH)) return null
  return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'))
}

// Login once manually — saves session so you never login again
export async function linkedInLogin({ email, password }) {
  const browser = await chromium.launch({ headless: false }) // show UI for login
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://www.linkedin.com/login')
  await page.fill('#username', email)
  await page.fill('#password', password)
  await page.click('[type="submit"]')
  await page.waitForURL('**/feed**', { timeout: 30000 })

  // Save cookies
  const cookies = await context.cookies()
  await saveLinkedInSession(cookies)

  console.log('✅ LinkedIn login successful')
  await browser.close()
  return { success: true }
}

// ─── Tool: Send LinkedIn Connection + Message ─────────────────────────────────

export async function send_linkedin_message({ profileUrl, message, founderName }) {
  console.log(`🔗 LinkedIn: messaging ${founderName || profileUrl}...`)

  const cookies = loadLinkedInSession()
  if (!cookies) {
    throw new Error('LinkedIn not connected. Call linkedInLogin() first.')
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()

  // Restore session
  await context.addCookies(cookies)

  const page = await context.newPage()

  try {
    // Go to profile
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(2000)

    // Check if already connected
    const connectBtn = page.locator('button:has-text("Connect"), button:has-text("Follow")')
    const messageBtn = page.locator('button:has-text("Message")')

    if (await messageBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Already connected — send message directly
      await messageBtn.click()
      await page.waitForTimeout(1500)

      const msgBox = page.locator('.msg-form__contenteditable, [data-placeholder="Write a message…"]')
      await msgBox.click()
      await msgBox.fill(message)
      await page.waitForTimeout(500)

      // Send
      const sendBtn = page.locator('.msg-form__send-button, button[type="submit"]:has-text("Send")')
      await sendBtn.click()
      await page.waitForTimeout(1000)

      console.log(`  ✅ Message sent to ${founderName}`)
      return { success: true, action: 'message_sent' }
    }

    if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Not connected — send connection request with note
      await connectBtn.click()
      await page.waitForTimeout(1000)

      // Check if "Add a note" option appears
      const addNoteBtn = page.locator('button:has-text("Add a note")')
      if (await addNoteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addNoteBtn.click()
        await page.waitForTimeout(500)

        // LinkedIn connection note max 300 chars
        const note = message.slice(0, 295)
        const noteBox = page.locator('#custom-message, textarea[name="message"]')
        await noteBox.fill(note)
        await page.waitForTimeout(300)
      }

      // Send connection request
      const sendConnectBtn = page.locator('button:has-text("Send"), button[aria-label*="Send"]')
      await sendConnectBtn.click()
      await page.waitForTimeout(1000)

      console.log(`  ✅ Connection request sent to ${founderName}`)
      return { success: true, action: 'connection_sent', note: message.slice(0, 295) }
    }

    console.log(`  ⚠️ Could not find Connect/Message button for ${founderName}`)
    return { success: false, action: 'not_found' }

  } catch (err) {
    console.error(`  ❌ LinkedIn error:`, err.message)
    return { success: false, error: err.message }
  } finally {
    await browser.close()
  }
}

// ─── Tool: Bulk LinkedIn Outreach ─────────────────────────────────────────────

export async function bulk_linkedin_outreach({ contacts }) {
  // contacts: [{ profileUrl, message, founderName, jobId }]
  const results = []

  for (const contact of contacts) {
    const result = await send_linkedin_message(contact)
    results.push({ ...contact, ...result })

    // Be polite — wait 10-20s between messages (avoids LinkedIn rate limits)
    const delay = 10000 + Math.random() * 10000
    console.log(`  ⏳ Waiting ${Math.round(delay / 1000)}s before next message...`)
    await new Promise(r => setTimeout(r, delay))
  }

  return results
}
