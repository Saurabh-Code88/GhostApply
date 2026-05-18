// src/utils/embeddings.js
import axios from 'axios'

// Hugging Face free inference API
// Model: sentence-transformers/all-MiniLM-L6-v2
// - 384-dimensional vectors
// - Fast, accurate, free-tier friendly
const HF_API_URL = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction'
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY

// Generate embedding for any text
export async function generateEmbedding(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 4000)

  console.log('  🔄 Calling HuggingFace API...')

  const response = await axios.post(
    HF_API_URL,
    { inputs: cleaned, options: { wait_for_model: true } },
    {
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  )

  const embedding = Array.isArray(response.data[0])
    ? response.data[0]
    : response.data

  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error('HuggingFace returned an invalid embedding payload')
  }

  return embedding.map(Number)
}

// Compute cosine similarity between two vectors
export function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
  return dot / (magA * magB)
}

// Convert similarity (0-1) to fit score (0-100)
export function similarityToScore(similarity) {
  return Math.round(similarity * 100)
}

// Save resume embedding to DB
export async function saveResumeEmbedding(resumeId, embedding) {
  const { default: pool } = await import('../db/client.js')
  await pool.query(
    'UPDATE resumes SET embedding = $1 WHERE id = $2',
    [JSON.stringify(embedding), resumeId]
  )
}

// Save job embedding to DB
export async function saveJobEmbedding(jobId, embedding) {
  const { default: pool } = await import('../db/client.js')
  await pool.query(
    'UPDATE jobs SET embedding = $1 WHERE id = $2',
    [JSON.stringify(embedding), jobId]
  )
}
