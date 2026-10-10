// scripts/migrate-vectors.js
// Adds pgvector embedding columns to resumes and jobs tables
// Run once: node scripts/migrate-vectors.js

import 'dotenv/config'
import pg from 'pg'

const url = process.env.DATABASE_URL
const parsed = new URL(url)

const pool = new pg.Pool({
  host: parsed.hostname,
  port: parseInt(parsed.port, 10) || 5432,
  database: parsed.pathname.replace(/^\//, ''),
  user: parsed.username,
  password: parsed.password,
  ssl: parsed.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : false,
})

const client = await pool.connect()

try {
  console.log('🔧 Running vector migration...\n')

  // Step 1: Enable pgvector extension
  await client.query('CREATE EXTENSION IF NOT EXISTS vector')
  console.log('✅ pgvector extension enabled')

  // Step 2: Check current columns on resumes
  const resumeCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'resumes' AND column_name = 'embedding'
  `)

  if (resumeCols.rows.length === 0) {
    await client.query('ALTER TABLE resumes ADD COLUMN embedding vector(384)')
    console.log('✅ Added embedding column to resumes table')
  } else {
    console.log('ℹ️  resumes.embedding already exists — skipped')
  }

  // Step 3: Check current columns on jobs
  const jobCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'embedding'
  `)

  if (jobCols.rows.length === 0) {
    await client.query('ALTER TABLE jobs ADD COLUMN embedding vector(384)')
    console.log('✅ Added embedding column to jobs table')
  } else {
    console.log('ℹ️  jobs.embedding already exists — skipped')
  }

  // Step 4: Create HNSW indexes for fast cosine similarity search
  await client.query(`
    CREATE INDEX IF NOT EXISTS resumes_embedding_idx
    ON resumes USING hnsw (embedding vector_cosine_ops)
  `)
  console.log('✅ HNSW index on resumes.embedding')

  await client.query(`
    CREATE INDEX IF NOT EXISTS jobs_embedding_idx
    ON jobs USING hnsw (embedding vector_cosine_ops)
  `)
  console.log('✅ HNSW index on jobs.embedding')

  console.log('\n🎉 Migration complete! Re-upload your resume to generate embeddings.')

} catch (err) {
  console.error('❌ Migration failed:', err.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
