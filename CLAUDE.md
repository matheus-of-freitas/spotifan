# Spotifan

Spotify release tracker — never miss an album from the artists you follow.

## Package Manager

Use **pnpm** for all installs and scripts. Never use npm or yarn.

```bash
pnpm install                           # install all deps
pnpm --filter @spotifan/backend test   # run backend tests
pnpm --filter @spotifan/frontend dev   # start frontend dev server
pnpm -r run build                      # build all packages
```

## Project Structure

```
packages/
  backend/   — Node 22 Lambda + Hono API (TypeScript, NodeNext modules)
  frontend/  — React 18 SPA + Vite (TanStack Router, shadcn/ui, Framer Motion)
  infra/     — AWS CDK v2 (TypeScript, commonjs)
```

## Git Workflow

- Feature branches: `feat/<name>` from `main`
- Merge only when: all tests pass, lint passes, coverage meets thresholds
- Each feature branch should be self-contained and independently mergeable
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `test:`)

## TypeScript

- `strict: true` in all packages — no exceptions
- `noExplicitAny`: error — only use `unknown` with proper narrowing
- Only use `as` casts when genuinely necessary and document why
- Prefer `satisfies` over `as` for type checking without widening

## Testing

### Backend

- Framework: Vitest
- Coverage: **100% line/function/branch/statement** enforced via thresholds
- HTTP mocking: MSW v2
- Run: `pnpm --filter @spotifan/backend test`
- Coverage: `pnpm --filter @spotifan/backend test:coverage`

### Frontend

- Framework: Vitest + React Testing Library + jsdom
- Coverage: best-effort (no strict threshold)
- Run: `pnpm --filter @spotifan/frontend test`

## Linting & Formatting

```bash
pnpm lint          # ESLint (flat config)
pnpm format:check  # Prettier check
pnpm format        # Prettier fix
```

## Key Architectural Decisions

### Albums Only

Sync fetches **albums only** (no singles, no compilations). The Spotify API call uses `include_groups=album`.

### Deduplication

Collab albums (same albumId under multiple artists) are deduplicated during sync using a `seenAlbumIds: Set<string>` initialized from already-persisted album IDs. Each album appears once in the user's release list and is never re-written.

### Persistence & Caching

- **User releases persist forever** (no TTL) — they are the source of truth
- Artist releases cached in DynamoDB with 24h TTL (`ARTIST#{id}` namespace)
- Stale cache → re-fetch from Spotify; fresh cache → skip API call

### Sync Types

- **Quick sync** (daily cooldown, 24h): reads artist list from `ARTIST_FOLLOW#` items (no Spotify artist-list call), fetches only current-year albums, merges new years into existing years index; **requires a prior Full Sync** (gated on `lastFullSyncAt`)
- **Full sync** (weekly cooldown, 7 days): fetches all artists from Spotify, persists list as individual `ARTIST_FOLLOW#{artistId}` items, fetches all albums across all years, rebuilds years index from scratch
- Both skip albums already persisted in the user's release list
- Cooldowns tracked independently via `lastQuickSyncAt` / `lastFullSyncAt` on user metadata
- New artists followed after the last Full Sync are missed by Quick Sync — picked up on the next Full Sync (accepted trade-off)

### Auth

- PKCE flow, server-side only (verifier stored in DynamoDB, TTL 10min)
- Tokens encrypted with AES-256-GCM, stored in DynamoDB
- Session: `__Host-session` HttpOnly/Secure cookie containing Spotify user ID

### DynamoDB Single-Table Design

Table: `spotifan` | PK + SK | GSI1PK + GSI1SK | TTL: `ttl`

| Item          | PK                  | SK                                |
| ------------- | ------------------- | --------------------------------- |
| User          | `USER#{spotifyId}`  | `METADATA`                        |
| Sync status   | `USER#{spotifyId}`  | `SYNC#CURRENT`                    |
| Years index   | `USER#{spotifyId}`  | `YEARS#INDEX`                     |
| Artist follow | `USER#{spotifyId}`  | `ARTIST_FOLLOW#{artistId}`        |
| Release       | `USER#{spotifyId}`  | `RELEASE#{year}#{date}#{albumId}` |
| Artist cache  | `ARTIST#{artistId}` | `RELEASE#{albumId}`               |
| PKCE state    | `PKCE#{state}`      | `VERIFIER`                        |

## Environment Variables (Backend)

```
IS_LOCAL=true                     # enables local DynamoDB endpoint + env config
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
COOKIE_SECRET=...                 # 32+ chars, used for AES key derivation
TABLE_NAME=spotifan-local
SYNC_WORKER_FUNCTION_NAME=        # empty for local (runs sync in-process)
SECRET_NAME=spotifan/config       # AWS Secrets Manager secret name (prod)
```
