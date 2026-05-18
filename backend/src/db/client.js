// src/db/client.js
import { PrismaClient } from '@prisma/client'
import pg from 'pg'

// Prisma client (for ORM queries)
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://ghost:ghost123@127.0.0.1:5433/ghostapply'
    }
  }
})

// Raw pg client (for vector operations - pgvector needs raw SQL)
const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 5433,
  database: 'ghostapply',
  user: 'ghost',
  password: 'ghost123',
  ssl: false,
})

// Run once on startup - enables pgvector extension
export async function initDB() {
  const client = await pool.connect()
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    console.log('✅ pgvector extension ready')
  } finally {
    client.release()
  }
}

// Store embedding for a resume
export async function saveResumeEmbedding(resumeId, embedding) {
  const client = await pool.connect()
  try {
    const embeddingStr = '[' + Array.from(embedding).join(',') + ']'
    await client.query(
      'UPDATE resumes SET embedding = $1::vector WHERE id = $2',
      [embeddingStr, resumeId]
    )
    console.log('  ✅ Embedding saved for resume:', resumeId)
  } catch (err) {
    console.error('  ❌ Embedding save error:', err.message)
  } finally {
    client.release()
  }
}

// Store embedding for a job
export async function saveJobEmbedding(jobId, embedding) {
  const client = await pool.connect()
  try {
    const embeddingStr = '[' + Array.from(embedding).join(',') + ']'
    await client.query(
      'UPDATE jobs SET embedding = $1::vector WHERE id = $2',
      [embeddingStr, jobId]
    )
  } catch (err) {
    console.error('  ❌ Job embedding save error:', err.message)
  } finally {
    client.release()
  }
}

// Cosine similarity search — find jobs most similar to resume
export async function findMatchingJobs(resumeEmbedding, limit = 20) {
  const client = await pool.connect()
  try {
    const result = await client.query(
      `SELECT id, title, company, location, salary, url, source, posted_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM jobs
       WHERE embedding IS NOT NULL
         AND status = 'PENDING'
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [`[${resumeEmbedding.join(',')}]`, limit]
    )
    return result.rows
  } finally {
    client.release()
  }
}

export default pool
