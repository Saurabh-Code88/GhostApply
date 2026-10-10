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
  if (!HF_API_KEY) {
    throw new Error('HUGGINGFACE_API_KEY environment variable is not set')
  }

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
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
  if (magA === 0 || magB === 0) return 0
  return dot / (magA * magB)
}

// Convert similarity (-1 to 1) to fit score (0–100)
export function similarityToScore(similarity) {
  // Clamp to [0, 1] first (cosine similarity is -1..1 but embeddings are usually >=0)
  const clamped = Math.max(0, Math.min(1, similarity))
  return Math.round(clamped * 100)
}

// NOTE: saveResumeEmbedding and saveJobEmbedding are defined in db/client.js
// (they use the correct ::vector cast for pgvector).
// Do NOT redefine them here — import from db/client.js instead.
