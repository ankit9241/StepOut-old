# StepOut — Mind Dump & Real-World Challenges

A cognitive reset and real-world task verification application. StepOut combines AI-powered mind dump extraction with physical challenges that get you away from your screen.

## Features

- **Mind Dump & Knowledge Extraction**: Convert unstructured thoughts, braindumps, and notes into structured tasks, deadlines, and durable memories using local AI (Ollama) or configurable models.
- **Human-in-the-Loop Review**: Review, edit, or reject AI proposals before anything is committed to your task database.
- **Physical Challenges (Physical CAPTCHA)**: Small real-world physical micro-missions to break prolonged screen fatigue and reset focus.
- **Dual Persistence Architecture**: MongoDB persistence with seamless fallback to in-memory storage for rapid zero-config local development.
- **Local AI Privacy**: Built-in integration with Ollama for 100% private on-device LLM inference.

## Tech Stack

- **Framework**: TanStack Start (SSR + Vite)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 & Lucide Icons
- **UI Components**: Radix UI primitives & shadcn/ui
- **State & Data Fetching**: TanStack Query & TanStack Router
- **Backend & API**: H3 / Nitro API routes with Zod schema validation
- **Database**: MongoDB (with fallback in-memory engine)
- **AI Integration**: Ollama (e.g. `gemma3:latest`)
- **Testing**: Vitest & Testing Library

## Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended) or [Bun](https://bun.sh/)
- (Optional) [MongoDB](https://www.mongodb.com/) running locally or via Atlas
- (Optional) [Ollama](https://ollama.com/) running locally (`ollama run gemma3:latest`)

### 2. Installation

```bash
npm install
# or
bun install
```

### 3. Environment Variables

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure your `.env` values:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/stepout
MONGODB_DB_NAME=stepout
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:latest
ALLOW_IN_MEMORY_DB=true
```

### 4. Running Locally

```bash
npm run dev
# or
bun run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Running Tests & Quality Checks

```bash
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm test            # Vitest suite
npm run build       # Production build
```

## License

MIT
