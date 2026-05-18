# 👻 GhostApply

> You sleep. It hunts.

An **agentic job search engine** — every morning it scrapes Indeed + LinkedIn, scores each JD against your resume using RAG, researches the founder, drafts a personalized cold message, and tracks replies. You just approve and send.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│               React Dashboard                       │
│   Jobs · Outreach Inbox · Stats                     │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────┐
│              Node.js Backend                        │
│                                                     │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │Hunt Agent  │  │Match Agent │  │Research Agent │  │
│  │Playwright  │  │RAG+pgvector│  │  MCP Tools    │  │
│  └────────────┘  └────────────┘  └───────────────┘  │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │           Outreach Agent                       │ │
│  │   Gmail OAuth · LinkedIn Playwright            │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌──────────────┐        ┌─────────────────────┐    │
│  │  PostgreSQL  │        │       Redis         │    │
│  │  + pgvector  │        │    (Bull queue)     │    │
│  └──────────────┘        └─────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Pipeline (runs daily 6 AM IST)

```
Hunt → Match → Research → Draft → [You Approve] → Send → Track Replies
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Scraping | Playwright (Chromium) |
| Vector DB | PostgreSQL + pgvector |
| Embeddings | OpenAI text-embedding-3-small |
| LLM | Groq Llama-3.3-70B |
| MCP Tools | Custom Node.js server |
| Email | Gmail OAuth2 (googleapis) |
| LinkedIn | Playwright automation |
| Frontend | React + Vite |
| Queue | Bull + Redis |
| Deploy | Docker + Railway |

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/yourusername/ghostapply
cd ghostapply
```

### 2. Start infra

```bash
docker-compose up postgres redis -d
```

### 3. Backend setup

```bash
cd backend
npm install
npx playwright install chromium
cp .env.example .env
# Fill in your API keys in .env
npx prisma migrate dev --name init
npx prisma generate
npm run dev
```

### 4. Frontend setup

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### 5. Upload resume

```bash
curl -X POST http://localhost:3001/api/jobs/resume/upload \
  -F "resume=@/path/to/resume.pdf"
```

### 6. Connect Gmail (optional)

```bash
# Visit in browser:
open http://localhost:3001/auth/gmail
# Authorize → tokens saved automatically
```

### 7. Connect LinkedIn (optional)

```bash
# Run once to save session:
node -e "
import('./backend/src/mcp/linkedinTool.js').then(m =>
  m.linkedInLogin({ email: 'you@gmail.com', password: 'yourpass' })
)
"
```

### 8. Run pipeline

```bash
# Manual trigger:
curl -X POST http://localhost:3001/api/jobs/pipeline/run

# Or use dashboard "▶ Run" button
```

---

## Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login + deploy
railway login
railway init
railway up

# Set environment variables
railway variables set GROQ_API_KEY=...
railway variables set OPENAI_API_KEY=...
railway variables set GMAIL_CLIENT_ID=...
railway variables set GMAIL_CLIENT_SECRET=...
```

---

## Environment Variables

```env
# Required
DATABASE_URL=postgresql://ghost:ghost123@localhost:5432/ghostapply
REDIS_URL=redis://localhost:6379
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key

# Gmail (optional — for email sending)
GMAIL_CLIENT_ID=your_google_oauth_client_id
GMAIL_CLIENT_SECRET=your_google_oauth_client_secret
GMAIL_REDIRECT_URI=http://localhost:3001/auth/gmail/callback
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/jobs` | List all jobs (filter by status, score) |
| GET | `/api/jobs/stats` | Aggregate stats |
| PATCH | `/api/jobs/:id` | Update job status |
| POST | `/api/jobs/resume/upload` | Upload resume PDF |
| POST | `/api/jobs/pipeline/run` | Trigger full pipeline |
| POST | `/api/outreach/send` | Send outreach for a job |
| POST | `/api/outreach/check-replies` | Check Gmail threads for replies |
| GET | `/api/outreach/logs` | Full outreach history |
| PATCH | `/api/outreach/draft/:jobId` | Update draft message |
| GET | `/auth/gmail` | Start Gmail OAuth flow |

---

## Project Structure

```
ghostapply/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── huntAgent.js        # Playwright scraper (Indeed + LinkedIn)
│   │   │   ├── matchAgent.js       # RAG fit scoring
│   │   │   ├── researchAgent.js    # Founder info + news + draft
│   │   │   ├── outreachAgent.js    # Gmail + LinkedIn sending
│   │   │   └── scheduler.js        # 6AM cron pipeline
│   │   ├── mcp/
│   │   │   ├── mcpServer.js        # Core MCP tools
│   │   │   ├── gmailTool.js        # Gmail OAuth + send + reply tracking
│   │   │   └── linkedinTool.js     # LinkedIn session + messaging
│   │   ├── db/
│   │   │   └── client.js           # pgvector queries
│   │   ├── routes/
│   │   │   ├── jobs.js             # Job CRUD + pipeline trigger
│   │   │   └── outreach.js         # Send + track outreach
│   │   ├── utils/
│   │   │   └── embeddings.js       # OpenAI embeddings util
│   │   └── index.js                # Express entry point
│   ├── prisma/
│   │   └── schema.prisma           # DB schema
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Full dashboard (Jobs + Inbox + Stats)
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── railway.toml
└── README.md
```

---

## MCP Tools

| Tool | Description |
|---|---|
| `fetch_founder_info` | Finds founder LinkedIn + Twitter via Google |
| `fetch_company_news` | Latest news via Google News RSS |
| `draft_cold_message` | Personalized outreach via Groq |
| `scrape_job_description` | Full JD from any URL |
| `send_email` | Gmail OAuth send with smart subject |
| `check_replies` | Thread-based reply detection |
| `send_linkedin_message` | Connection request or direct message |

---

## TLDR

> "GhostApply is an agentic job search engine I built out of frustration — it scrapes Indeed and LinkedIn every morning, scores each JD against my resume using RAG and pgvector, researches the founder, and drafts a personalized cold message. I just approve and send. I used it to find this interview."
