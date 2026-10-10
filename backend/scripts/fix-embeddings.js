// Re-add embedding columns that were dropped by prisma db push
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function fix() {
  const client = await pool.connect()
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await client.query('ALTER TABLE resumes ADD COLUMN IF NOT EXISTS embedding vector(384)')
    await client.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS embedding vector(384)')
    console.log('✅ Embedding columns re-added to resumes and jobs tables')
  } catch (err) {
    console.error('❌ Error:', err.message)
  } finally {
    client.release()
    await pool.end()
  }
}

fix()
