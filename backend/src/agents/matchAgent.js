// src/agents/matchAgent.js
import fs from 'fs'
import pdfParse from 'pdf-parse'
import Groq from 'groq-sdk'
import { prisma, saveResumeEmbedding, saveJobEmbedding } from '../db/client.js'
import pool from '../db/client.js'
import { generateEmbedding, cosineSimilarity, similarityToScore } from '../utils/embeddings.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const MATCH_THRESHOLD = 65
const MIN_VECTOR_SCORE_FOR_ANALYSIS = 35
const MIN_VECTOR_SCORE_FOR_MATCH = 42
const VECTOR_WEIGHT = 0.65
const GROQ_WEIGHT = 0.35

export async function processResume(pdfPath, userId = 'default') {
  console.log('Processing resume...')
  const buffer = fs.readFileSync(pdfPath)
  const data = await pdfParse(buffer)
  const resumeText = data.text.replace(/\s+/g, ' ').trim()
  console.log(`  -> Extracted ${resumeText.length} characters`)

  const resume = await prisma.resume.upsert({
    where: { userId },
    create: { userId, content: resumeText },
    update: { content: resumeText }
  })

  const embedding = await generateEmbedding(resumeText)
  await saveResumeEmbedding(resume.id, embedding)
  console.log('  -> Resume embedded and saved')
  return { resume, embedding }
}

async function analyzeWithGroq(resumeText, job) {
  const prompt = `You are a strict technical recruiter for an Indian CS final-year student looking for junior software engineering roles.

Be conservative. Do not reward generic overlap. Penalize senior/lead/manager roles, frontend-only internships, support/QA/manual testing roles, and roles with little backend/full-stack/software engineering relevance.

RESUME:
${resumeText.slice(0, 3000)}

JOB: ${job.title} at ${job.company}
DESCRIPTION:
${job.description.slice(0, 2000)}

Analyze the fit and respond in this EXACT JSON format (no markdown, no extra text):
{
  "score": <number 0-100>,
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["skill1", "skill2"],
  "reason": "<2 sentence explanation of why this is or isn't a good fit>",
  "talkingPoint": "<one specific thing from their job description the candidate should mention in outreach>"
}`

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 500,
  })

  try {
    const text = response.choices[0].message.content.trim()
    const json = text.match(/\{[\s\S]*\}/)?.[0] || text
    return JSON.parse(json)
  } catch {
    return {
      score: 50,
      matchedSkills: [],
      missingSkills: [],
      reason: 'Could not analyze fit.',
      talkingPoint: ''
    }
  }
}

function clampScore(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function jobSearchText(job) {
  return `${job.title || ''} ${job.company || ''} ${job.description || ''}`.toLowerCase()
}

function buildJobEmbeddingText(job) {
  return [
    job.title,
    job.company,
    job.location,
    job.salary,
    job.description
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function analyzeRoleFit(job) {
  const title = (job.title || '').toLowerCase()
  const text = jobSearchText(job)
  const reasons = []
  let penalty = 0
  let bonus = 0
  let hardSkip = false

  if (/\b(manager|lead|senior|sr\.?|principal|staff|architect|director|head)\b/.test(title)) {
    hardSkip = true
    penalty += 35
    reasons.push('senior/leadership title')
  }

  const hasFrontend = /\b(frontend|front-end|front end|ui developer|react developer|angular developer|vue developer)\b/.test(text)
  const hasBackend = /\b(backend|back-end|back end|full stack|fullstack|mern|node|node\.js|express|api|server|postgres|postgresql|redis|websocket|software engineer|software developer)\b/.test(text)

  if (hasFrontend && !hasBackend) {
    penalty += 12
    reasons.push('frontend-only role')
  }

  if (/\b(internship|intern)\b/.test(title) && !/\b(software|backend|full stack|fullstack|mern|node)\b/.test(title)) {
    penalty += 8
    reasons.push('non-software internship')
  }

  if (/\b(manual testing|qa|quality analyst|test engineer|support engineer|technical support|business analyst|data analyst|wordpress|salesforce|devops|sre)\b/.test(text)) {
    penalty += 12
    reasons.push('off-target role family')
  }

  const targetSignals = [
    /\bbackend\b/,
    /\bfull stack\b|\bfullstack\b/,
    /\bmern\b/,
    /\bnode\b|\bnode\.js\b/,
    /\bexpress\b/,
    /\bpostgres\b|\bpostgresql\b/,
    /\bredis\b/,
    /\bwebsocket\b|\bwebsockets\b/,
    /\bdocker\b/,
    /\bapi\b|\brest\b/
  ]
  const signalCount = targetSignals.filter(pattern => pattern.test(text)).length
  bonus += Math.min(signalCount * 2, 10)

  if (!hasBackend && !/\bsoftware engineer|software developer|sde\b/.test(text)) {
    penalty += 10
    reasons.push('weak software/backend signal')
  }

  return { hardSkip, penalty, bonus, reasons }
}

export function calibrateScore(vectorScore, groqScore, job) {
  const roleFit = analyzeRoleFit(job)
  const safeVectorScore = clampScore(vectorScore)
  const safeGroqScore = clampScore(groqScore)

  if (roleFit.hardSkip) {
    return {
      finalScore: Math.min(45, Math.max(0, safeVectorScore - roleFit.penalty)),
      roleFit,
      cappedGroqScore: safeGroqScore,
      capReason: 'Hard-skipped senior/leadership role.'
    }
  }

  let maxGroqBoost = 14
  if (safeVectorScore < 35) maxGroqBoost = 4
  else if (safeVectorScore < MIN_VECTOR_SCORE_FOR_MATCH) maxGroqBoost = 8

  const cappedGroqScore = Math.min(safeGroqScore, safeVectorScore + maxGroqBoost)
  const blendedScore = (safeVectorScore * VECTOR_WEIGHT) + (cappedGroqScore * GROQ_WEIGHT)
  const adjustedScore = blendedScore + roleFit.bonus - roleFit.penalty

  let finalScore = clampScore(adjustedScore)
  if (safeVectorScore < MIN_VECTOR_SCORE_FOR_MATCH) {
    finalScore = Math.min(finalScore, MATCH_THRESHOLD - 1)
  }

  return {
    finalScore,
    roleFit,
    cappedGroqScore,
    capReason: cappedGroqScore < safeGroqScore
      ? `Groq score capped from ${safeGroqScore} to ${cappedGroqScore}.`
      : ''
  }
}

function buildFitReason({ analysis, vectorScore, calibration, usedGroq }) {
  const reasonParts = [
    usedGroq ? analysis.reason : 'Scored by vector similarity with role-fit calibration.',
    calibration.capReason,
    calibration.roleFit.reasons.length
      ? `Role-fit adjustment: ${calibration.roleFit.reasons.join(', ')}.`
      : ''
  ].filter(Boolean)

  return {
    reason: reasonParts.join(' '),
    matchedSkills: Array.isArray(analysis.matchedSkills) ? analysis.matchedSkills : [],
    missingSkills: Array.isArray(analysis.missingSkills) ? analysis.missingSkills : [],
    talkingPoint: analysis.talkingPoint || '',
    vectorScore,
    groqScore: usedGroq ? clampScore(analysis.score) : null,
    cappedGroqScore: usedGroq ? calibration.cappedGroqScore : null,
    calibration: {
      threshold: MATCH_THRESHOLD,
      minVectorForMatch: MIN_VECTOR_SCORE_FOR_MATCH,
      vectorWeight: usedGroq ? VECTOR_WEIGHT : 1,
      groqWeight: usedGroq ? GROQ_WEIGHT : 0,
      rolePenalty: calibration.roleFit.penalty,
      roleBonus: calibration.roleFit.bonus,
      roleReasons: calibration.roleFit.reasons
    }
  }
}

function parseEmbedding(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw.map(Number)
  if (typeof raw === 'string') return JSON.parse(raw).map(Number)
  if (typeof raw === 'object') return Object.values(raw).map(Number)
  return null
}

export async function runMatchAgent(userId = 'default', options = {}) {
  console.log('\nGhostApply - MATCH AGENT starting...\n')

  const resume = await prisma.resume.findFirst({ where: { userId } })
  if (!resume) throw new Error('No resume found. Upload your resume first.')

  const { rows } = await pool.query('SELECT embedding FROM resumes WHERE id = $1', [resume.id])
  const resumeEmbedding = parseEmbedding(rows[0]?.embedding)

  if (!resumeEmbedding || !resumeEmbedding.length) {
    throw new Error('Resume embedding not found. Re-upload your resume.')
  }

  const hasScopedJobIds = Array.isArray(options.jobIds)
  const scopedJobIds = hasScopedJobIds
    ? Array.from(new Set(options.jobIds.filter(Boolean)))
    : []

  if (hasScopedJobIds && !scopedJobIds.length) {
    console.log('No new jobs from this hunt to score.\n')
    return { matched: 0, skipped: 0, matchedJobIds: [] }
  }

  const pendingJobs = await prisma.job.findMany({
    where: hasScopedJobIds
      ? { id: { in: scopedJobIds }, status: 'PENDING' }
      : { status: 'PENDING' },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    ...(hasScopedJobIds ? {} : { take: 50 })
  })

  console.log(hasScopedJobIds
    ? `Scoring ${pendingJobs.length} fresh jobs from this hunt...\n`
    : `Scoring ${pendingJobs.length} pending jobs...\n`
  )

  let matched = 0
  let skipped = 0
  const matchedJobIds = []

  for (const job of pendingJobs) {
    try {
      const precheck = analyzeRoleFit(job)
      if (precheck.hardSkip || precheck.penalty >= 20) {
        const finalScore = 0
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'SKIPPED',
            fitScore: finalScore,
            fitReason: JSON.stringify({
              reason: `Skipped before embedding/Groq: ${precheck.reasons.join(', ')}.`,
              matchedSkills: [],
              missingSkills: [],
              talkingPoint: '',
              roleFit: precheck
            })
          }
        })
        console.log(`  -> Role precheck skipped before embedding: ${job.title} @ ${job.company}`)
        skipped++
        continue
      }

      const rawJobEmbedding = await getJobEmbedding(job.id)
      let jobEmbedding = parseEmbedding(rawJobEmbedding)

      if (!jobEmbedding || !jobEmbedding.length) {
        const embeddingText = buildJobEmbeddingText(job)

        if (embeddingText.length < 30) {
          console.log(`  -> No embedding text: ${job.title} @ ${job.company}`)
          skipped++
          continue
        }

        console.log(`  -> Backfilling embedding: ${job.title} @ ${job.company}`)
        jobEmbedding = await generateEmbedding(embeddingText)
        await saveJobEmbedding(job.id, jobEmbedding)
      }

      const similarity = cosineSimilarity(resumeEmbedding, jobEmbedding)
      const vectorScore = similarityToScore(similarity)

      console.log(`  -> Vector score ${vectorScore}: ${job.title} @ ${job.company}`)

      if (isNaN(vectorScore) || vectorScore < MIN_VECTOR_SCORE_FOR_ANALYSIS) {
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'SKIPPED',
            fitScore: 0,
            fitReason: JSON.stringify({
              reason: `Vector score ${vectorScore} is below the analysis floor (${MIN_VECTOR_SCORE_FOR_ANALYSIS}).`,
              matchedSkills: [],
              missingSkills: [],
              talkingPoint: '',
              vectorScore
            })
          }
        })
        skipped++
        continue
      }

      let finalScore = vectorScore
      let fitReason = {}

      try {
        const analysis = await analyzeWithGroq(resume.content, job)
        const calibration = calibrateScore(vectorScore, analysis.score, job)
        finalScore = calibration.finalScore
        fitReason = buildFitReason({ analysis, vectorScore, calibration, usedGroq: true })
      } catch {
        console.log(`  -> Groq skipped, using calibrated vector score: ${vectorScore}`)
        const analysis = { score: vectorScore, matchedSkills: [], missingSkills: [], talkingPoint: '' }
        const calibration = calibrateScore(vectorScore, vectorScore, job)
        finalScore = calibration.finalScore
        fitReason = buildFitReason({ analysis, vectorScore, calibration, usedGroq: false })
      }

      await prisma.job.update({
        where: { id: job.id },
        data: {
          fitScore: finalScore,
          fitReason: JSON.stringify(fitReason),
          status: finalScore >= MATCH_THRESHOLD ? 'MATCHED' : 'SKIPPED'
        }
      })

      if (finalScore >= MATCH_THRESHOLD) {
        console.log(`  -> MATCHED (${finalScore}): ${job.title} @ ${job.company}`)
        matched++
        matchedJobIds.push(job.id)
      } else {
        console.log(`  -> Low fit (${finalScore}): ${job.title} @ ${job.company}`)
        skipped++
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (err) {
      console.error(`  -> Error scoring ${job.id}:`, err.message)
    }
  }

  console.log(`\nMatch complete: ${matched} matched, ${skipped} skipped`)
  return { matched, skipped, matchedJobIds }
}

async function getJobEmbedding(jobId) {
  const { rows } = await pool.query('SELECT embedding FROM jobs WHERE id = $1', [jobId])
  return rows[0]?.embedding || null
}

if (process.argv[1]?.includes('matchAgent')) {
  import('dotenv/config').then(() => {
    runMatchAgent()
      .then(result => { console.log('\nDone:', result); process.exit(0) })
      .catch(err => { console.error('Match failed:', err); process.exit(1) })
  })
}
