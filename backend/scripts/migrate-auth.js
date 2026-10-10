// scripts/migrate-auth.js
// Adds users table + userId column to resumes and jobs
// Run once: node scripts/migrate-auth.js

import 'dotenv/config'
import pg from 'pg'

const parsed = new URL(process.env.DATABASE_URL)
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
  console.log('🔧 Running auth migration...\n')

  // 1. Create users table
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      name        TEXT,
      status      TEXT,
      location    TEXT,
      targetjobs  TEXT,
      isonboarded BOOLEAN NOT NULL DEFAULT false,
      createdat   TIMESTAMP NOT NULL DEFAULT now(),
      updatedat   TIMESTAMP NOT NULL DEFAULT now()
    )
  `)
  console.log('✅ users table ready')

  // 2. Add userid to resumes if missing
  const resumeUserIdExists = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'resumes' AND column_name = 'userid'
  `)
  if (resumeUserIdExists.rows.length === 0) {
    await client.query(`ALTER TABLE resumes ADD COLUMN userid TEXT`)
    console.log('✅ Added userid to resumes')
  } else {
    // Drop the existing unique constraint so we can add FK
    await client.query(`ALTER TABLE resumes DROP CONSTRAINT IF EXISTS resumes_userid_key`)
    console.log('ℹ️  resumes.userid exists — dropped old unique constraint')
  }

  // 3. Add userid to jobs if missing
  const jobUserIdExists = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'userid'
  `)
  if (jobUserIdExists.rows.length === 0) {
    await client.query(`ALTER TABLE jobs ADD COLUMN userid TEXT`)
    console.log('✅ Added userid to jobs')
  } else {
    console.log('ℹ️  jobs.userid already exists — skipped')
  }

  // 4. Clear orphaned rows before adding FK (e.g. old userid='default')
  const deleted = await client.query(`
    DELETE FROM resumes WHERE userid IS NOT NULL
      AND userid NOT IN (SELECT id FROM users)
  `)
  if (deleted.rowCount > 0) console.log(`🧹 Cleared ${deleted.rowCount} orphaned resume row(s) (old 'default' userId)`)

  await client.query(`
    UPDATE jobs SET userid = NULL WHERE userid IS NOT NULL
      AND userid NOT IN (SELECT id FROM users)
  `)
  console.log('🧹 Nullified orphaned job userids')

  // 5. Add FK constraints (idempotent)
  await client.query(`
    ALTER TABLE resumes
      DROP CONSTRAINT IF EXISTS resumes_userid_fkey
  `)
  await client.query(`
    ALTER TABLE resumes
      ADD CONSTRAINT resumes_userid_fkey
      FOREIGN KEY (userid) REFERENCES users(id)
      ON DELETE CASCADE
  `)
  console.log('✅ FK: resumes.userid → users.id')

  await client.query(`
    ALTER TABLE jobs
      DROP CONSTRAINT IF EXISTS jobs_userid_fkey
  `)
  await client.query(`
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_userid_fkey
      FOREIGN KEY (userid) REFERENCES users(id)
      ON DELETE SET NULL
  `)
  console.log('✅ FK: jobs.userid → users.id (nullable)')

  // 5. Unique constraint on resumes.userid
  await client.query(`
    ALTER TABLE resumes
      DROP CONSTRAINT IF EXISTS resumes_userid_unique
  `)
  await client.query(`
    ALTER TABLE resumes
      ADD CONSTRAINT resumes_userid_unique UNIQUE (userid)
  `)
  console.log('✅ Unique constraint on resumes.userid')

  console.log('\n🎉 Auth migration complete!')

} catch (err) {
  console.error('❌ Migration failed:', err.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
