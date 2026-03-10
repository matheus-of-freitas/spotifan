# @spotifan/backend

Hono API running on AWS Lambda — handles Spotify OAuth (PKCE), artist release syncing, and album browsing.

## Scripts

```bash
pnpm dev              # Start local dev server (tsx watch, port 3000)
pnpm build            # Compile TypeScript
pnpm test             # Run tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage report
```

## Environment Variables

### Local Development (`IS_LOCAL=true`)

| Variable | Required | Description |
|----------|----------|-------------|
| `IS_LOCAL` | Yes | Set to `true` to use env-based config |
| `SPOTIFY_CLIENT_ID` | Yes | Spotify OAuth application ID |
| `SPOTIFY_CLIENT_SECRET` | Yes | Spotify OAuth application secret |
| `COOKIE_SECRET` | No | 32+ char AES key (defaults to a local dev value) |
| `TABLE_NAME` | No | DynamoDB table name (default: `spotifan`) |
| `SYNC_WORKER_FUNCTION_NAME` | No | Empty for local — sync runs in-process |

### Production

Config is loaded from AWS Secrets Manager (`spotifan/config`). Only `TABLE_NAME`, `SYNC_WORKER_FUNCTION_NAME`, and `SECRET_NAME` come from Lambda environment variables.

## API Routes

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/auth/login` | Initiate PKCE login flow |
| `GET` | `/api/auth/callback` | OAuth callback handler |

### Protected (requires `__Host-session` cookie)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/auth/me` | Get current user info |
| `POST` | `/api/sync` | Trigger album sync |
| `GET` | `/api/sync/status` | Get sync progress |
| `GET` | `/api/releases` | Get synced releases (paginated, filterable by year) |
| `GET` | `/api/releases/years` | Get available release years |

## Architecture

```
lambdas/
  api.ts          ── Hono app (API Gateway handler)
  syncWorker.ts   ── Async sync Lambda
  local.ts        ── Local dev server

handlers/         ── Request handling (auth, sync, releases)
    ↓
services/         ── Business logic (Spotify API, sync orchestration, tokens)
    ↓
db/               ── DynamoDB operations (single-table design)

lib/              ── Config, crypto, errors, retry
```

### Auth Flow

1. User hits `/api/auth/login` — server generates PKCE `code_verifier` + `state`, stores in DynamoDB (10min TTL), redirects to Spotify
2. Spotify redirects to `/api/auth/callback` — server exchanges code for tokens using stored verifier
3. Tokens are encrypted with AES-256-GCM (key derived from `cookieSecret`) and stored in DynamoDB
4. Session is set via `__Host-session` HttpOnly/Secure cookie containing the Spotify user ID

### Sync Flow

1. User triggers `/api/sync` — checks 24h cooldown via `lastSyncedAt`
2. Fetches followed artists from Spotify (paginated)
3. For each artist, checks DynamoDB cache (24h TTL); cache miss → fetches from Spotify API (`include_groups=album`)
4. Deduplicates collab albums using `seenAlbumIds: Set<string>`
5. Writes releases to DynamoDB under the user's partition

### DynamoDB Single-Table Design

| Item | PK | SK |
|------|----|----|
| User | `USER#{spotifyId}` | `METADATA` |
| Sync status | `USER#{spotifyId}` | `SYNC#CURRENT` |
| Years index | `USER#{spotifyId}` | `YEARS#INDEX` |
| Release | `USER#{spotifyId}` | `RELEASE#{year}#{date}#{albumId}` |
| Artist cache | `ARTIST#{artistId}` | `RELEASE#{albumId}` |
| PKCE state | `PKCE#{state}` | `VERIFIER` |

## Testing

- **Framework:** Vitest
- **HTTP Mocking:** MSW v2
- **Test count:** 119 tests across 15 test files
- **Coverage thresholds:** 100% lines, functions, branches, and statements

```bash
pnpm test:coverage
```

Coverage includes: `db/`, `handlers/`, `services/`, `lib/`, `lambdas/` (excluding `api.ts`, `local.ts`, and type files).
