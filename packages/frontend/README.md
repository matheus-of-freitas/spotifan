# @spotifan/frontend

React 18 SPA with a Spotify-inspired dark theme — browse album releases from your followed artists.

## Scripts

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Type-check + Vite build
pnpm preview          # Preview production build
pnpm test             # Run tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage
```

## Tech Stack

| Category | Library |
|----------|---------|
| Routing | TanStack Router (file-based) |
| Data fetching | TanStack Query v5 |
| State management | Zustand 5 |
| Animations | Framer Motion 12 |
| Styling | Tailwind CSS 3 (Spotify color palette) |
| Build | Vite 5 |
| Testing | Vitest + React Testing Library + jsdom |

## Dev Proxy

The Vite dev server proxies `/api` requests to `http://localhost:3000` (the backend):

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3000',
  },
}
```

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `index.tsx` | Main view — release grid with year filter and sync controls (authenticated) |
| `/login` | `login.tsx` | Spotify OAuth login page (public) |

## Components

### Layout
- **Header** — User profile image, display name, logout button

### Releases
- **ReleaseGrid** — Infinite-scroll album grid using Intersection Observer + TanStack Query
- **ReleaseCard** — Album card with cover art, title, artist, release date (Framer Motion animations)
- **YearFilter** — Year filter dropdown, fetches available years from backend

### Sync
- **SyncProgress** — Sync trigger button or progress bar with artist count and status (idle/running/done/error)

## State Management

### Filter Store (`store/filterStore.ts`)
Manages the selected year filter for the release grid.

### Auth (`hooks/useAuth.ts`)
Derives auth state directly from TanStack Query — no separate store needed.

## Source Structure

```
src/
├── api/                # API client functions (auth, releases, sync)
├── components/
│   ├── layout/         # Header
│   ├── releases/       # ReleaseGrid, ReleaseCard, YearFilter
│   └── sync/           # SyncProgress
├── hooks/              # useAuth
├── lib/                # Utilities (cn)
├── routes/             # TanStack Router file-based routes
├── store/              # Zustand stores (filter)
├── main.tsx            # App entry point
└── index.css           # Global styles + Tailwind
```
