// src/mcp/gmailTool.js
// 📧 GMAIL MCP TOOL — OAuth2 + send cold outreach emails

import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_PATH = path.join(__dirname, '../../.gmail_token.json')

// ─── OAuth2 Client Setup ──────────────────────────────────────────────────────

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/auth/gmail/callback'
  )
}

// Generate auth URL — user visits this once to grant access
export function getAuthUrl() {
  const oauth2Client = getOAuthClient()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly', // to check replies
    ],
    prompt: 'consent'
  })
}

// Exchange code for tokens — called after user grants access
export async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)
  // Save tokens to disk
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))
  console.log('✅ Gmail tokens saved')
  return tokens
}

// Load saved tokens
export function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
}

// Get authenticated Gmail client
export async function getGmailClient() {
  const tokens = loadTokens()
  if (!tokens) throw new Error('Gmail not connected. Visit /auth/gmail to connect.')

  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials(tokens)

  // Auto-refresh if expired
  oauth2Client.on('tokens', (newTokens) => {
    const current = loadTokens() || {}
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2))
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

// ─── Tool: Send Email ─────────────────────────────────────────────────────────

export async function send_email({ to, subject, body, jobId }) {
  console.log(`📧 Gmail: sending to ${to}...`)

  const gmail = await getGmailClient()

  // Build RFC 2822 email
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\n')

  // Base64 encode (URL-safe)
  const encoded = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded }
  })

  console.log(`  ✅ Email sent — messageId: ${res.data.id}`)
  return {
    success: true,
    messageId: res.data.id,
    threadId: res.data.threadId
  }
}

// ─── Tool: Check for Replies ──────────────────────────────────────────────────

export async function check_replies({ threadIds }) {
  console.log(`🔍 Gmail: checking ${threadIds.length} threads for replies...`)

  const gmail = await getGmailClient()
  const replies = []

  for (const threadId of threadIds) {
    try {
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      })

      const messages = thread.data.messages || []

      // If more than 1 message in thread → got a reply!
      if (messages.length > 1) {
        const lastMsg = messages[messages.length - 1]
        const from = lastMsg.payload?.headers?.find(h => h.name === 'From')?.value
        replies.push({ threadId, replied: true, from, messageCount: messages.length })
      } else {
        replies.push({ threadId, replied: false, messageCount: 1 })
      }
    } catch (err) {
      console.error(`  ⚠️ Error checking thread ${threadId}:`, err.message)
    }
  }

  const repliedCount = replies.filter(r => r.replied).length
  console.log(`  ↳ ${repliedCount}/${threadIds.length} threads have replies`)
  return replies
}

// ─── Tool: Draft Subject Line ─────────────────────────────────────────────────
// Generates a compelling subject for cold outreach

import Groq from 'groq-sdk'
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function generate_subject({ founderName, companyName, jobTitle, talkingPoint }) {
  const prompt = `Write a cold email subject line for a job application.

Founder: ${founderName || 'Founder'}
Company: ${companyName}
Role: ${jobTitle}
Key angle: ${talkingPoint || 'strong technical background'}

Rules:
- Under 8 words
- No "Following up" or "Opportunity" or "Application for"
- Make them curious, not salesy
- Reference something specific about them OR the candidate's work
- No exclamation marks

Output ONLY the subject line, nothing else.`

  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 50,
  })

  return res.choices[0].message.content.trim().replace(/^["']|["']$/g, '')
}
