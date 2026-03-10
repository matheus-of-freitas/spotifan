# Spotifan

Spotify release tracker — never miss an album from the artists you follow.

Spotifan syncs your followed artists from Spotify and builds a chronological feed of their album releases. Albums are cached for 24 hours, deduplicated across collaborations, and filterable by year.

## Architecture

Monorepo with three packages:

| Package                                   | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| [`packages/backend`](packages/backend/)   | Hono API on AWS Lambda — auth, sync, releases          |
| [`packages/frontend`](packages/frontend/) | React 18 SPA — Spotify-styled release browser          |
| [`packages/infra`](packages/infra/)       | AWS CDK v2 — DynamoDB, Lambda, API Gateway, CloudFront |

## Tech Stack

| Layer          | Technologies                                                                       |
| -------------- | ---------------------------------------------------------------------------------- |
| Frontend       | React 18, TanStack Router, TanStack Query v5, Zustand, Framer Motion, Tailwind CSS |
| Backend        | Node.js 22, Hono, TypeScript (strict), DynamoDB (single-table)                     |
| Infrastructure | AWS CDK v2, Lambda, API Gateway v2, S3, CloudFront                                 |
| Auth           | Spotify PKCE OAuth, AES-256-GCM token encryption                                   |
| Testing        | Vitest, MSW v2, React Testing Library                                              |
| CI/CD          | GitHub Actions                                                                     |

## Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **AWS account** (for deployment only)

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up backend environment
cp packages/backend/.env.example packages/backend/.env
# Edit .env with your Spotify app credentials:
#   SPOTIFY_CLIENT_ID=...
#   SPOTIFY_CLIENT_SECRET=...

# Start backend (port 3000)
pnpm dev:backend

# Start frontend (port 5173, proxies /api to backend)
pnpm dev:frontend
```

### Environment Variables (Local)

| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `IS_LOCAL`                  | Set to `true` for local development                                |
| `SPOTIFY_CLIENT_ID`         | Spotify OAuth app client ID                                        |
| `SPOTIFY_CLIENT_SECRET`     | Spotify OAuth app client secret                                    |
| `COOKIE_SECRET`             | 32+ char secret for token encryption (has a default for local dev) |
| `TABLE_NAME`                | DynamoDB table name (default: `spotifan`)                          |
| `SYNC_WORKER_FUNCTION_NAME` | Lambda name for async sync (empty for local = runs in-process)     |

## Scripts

| Script               | Description               |
| -------------------- | ------------------------- |
| `pnpm dev:frontend`  | Start frontend dev server |
| `pnpm dev:backend`   | Start backend dev server  |
| `pnpm build`         | Build all packages        |
| `pnpm test`          | Run all tests             |
| `pnpm test:backend`  | Run backend tests         |
| `pnpm test:frontend` | Run frontend tests        |
| `pnpm lint`          | Run ESLint                |
| `pnpm lint:fix`      | Fix lint issues           |
| `pnpm format`        | Format with Prettier      |
| `pnpm format:check`  | Check formatting          |

## Project Structure

```
spotifan/
├── .github/workflows/ci.yml    # CI pipeline
├── packages/
│   ├── backend/                 # Hono API + Lambda handlers
│   │   └── src/
│   │       ├── db/              # DynamoDB operations
│   │       ├── handlers/        # Route handlers
│   │       ├── lambdas/         # Lambda entry points
│   │       ├── lib/             # Config, crypto, errors, retry
│   │       └── services/        # Spotify client, sync, tokens
│   ├── frontend/                # React SPA
│   │   └── src/
│   │       ├── api/             # API client functions
│   │       ├── components/      # UI components
│   │       ├── routes/          # TanStack Router pages
│   │       └── store/           # Zustand stores
│   └── infra/                   # CDK stack
│       └── lib/
│           ├── spotifan-stack.ts
│           └── constructs/      # Database, API, Frontend
├── CLAUDE.md
├── eslint.config.mjs
├── package.json
└── pnpm-workspace.yaml
```

## CI/CD

GitHub Actions runs on every push to `main` and on pull requests:

1. **Lint** — ESLint + Prettier check
2. **Backend Tests** — Vitest with 100% coverage enforcement
3. **Frontend Tests & Build** — Vitest + Vite build
4. **CDK Synth** — Synthesizes CloudFormation (after builds pass)

## License

Private project — not published.
