// src/db/client.js
import { PrismaClient } from '@prisma/client'
import pg from 'pg'

// Prisma client (for ORM queries) — reads DATABASE_URL from .env
export const prisma = new PrismaClient()

// Parse DATABASE_URL for the raw pg pool (needed for pgvector raw SQL)
function buildPoolConfig() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 5432,
      database: parsed.pathname.replace(/^\//, ''),
      user: parsed.username,
      password: parsed.password,
      ssl: parsed.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : false,
    }
  } catch {
    // Fallback: pass the raw URL string directly
    return { connectionString: url }
  }
}

// Raw pg client (for vector operations - pgvector needs raw SQL)
const pool = new pg.Pool(buildPoolConfig())

// Run once on startup - enables pgvector extension and ensures embedding columns exist
export async function initDB() {
  const client = await pool.connect()
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'resumes' AND column_name = 'embedding') THEN
          ALTER TABLE resumes ADD COLUMN embedding vector(384);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'embedding') THEN
          ALTER TABLE jobs ADD COLUMN embedding vector(384);
        END IF;
      END $$;
    `)
    console.log('✅ pgvector extension & embedding columns ready')
  } catch (err) {
    console.warn('⚠️ pgvector init warning:', err.message)
  } finally {
    client.release()
  }
}

// Store embedding for a resume (uses ::vector cast for pgvector)
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

// Store embedding for a job (uses ::vector cast for pgvector)
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
