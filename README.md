# Multi-Hostel SaaS Platform

Multi-tenant hostel management platform for Nepal — public hostel discovery, hostel admin operations, resident portal, guardian view, and platform-owner administration. Built per the canonical spec in [`docs/`](docs/README.md).

## Monorepo Layout

```
apps/web          Next.js (App Router) — web app + REST API route handlers
apps/mobile       React Native + Expo (Phase 6)
packages/db       Mongoose connection, models, seed & migration scripts
packages/shared   Shared enums/roles, Zod schemas, email sender + templates
docs/             Canonical project documentation (read docs/README.md first)
```

Workspaces are managed with npm workspaces + Turborepo (`turbo.json`).

## Local Setup

```bash
# 1. Install dependencies (root — installs all workspaces)
npm install

# 2. Configure environment
#    Copy .env.example to .env at the repo root and fill in values.
#    Minimum for local dev: MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
#    SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD.

# 3. Seed the initial SUPERADMIN account
npm run db:seed

# 4. Run the web app
npm run web:dev     # http://localhost:3000
```

## Common Commands

| Command | What it does |
|---|---|
| `npm run web:dev` | Start the Next.js dev server |
| `npm run web:build` | Production build |
| `npm run web:test` | Run the vitest suite |
| `npm run web:lint` | ESLint |
| `npm --prefix apps/web run typecheck` | TypeScript check |
| `npm run db:seed` | Seed/refresh the SUPERADMIN account |
| `node --experimental-transform-types packages/db/src/migrate-roles.ts` | One-shot legacy→canonical role migration |

## Store Catalogue

The store seed is idempotent and upserts demo products and departments by slug.
It stores curated Unsplash image URLs by default:

```bash
npm --prefix apps/web run seed:store
```

To add photos only to products whose `images` array is empty, use the backfill
mode. It matches product names and tags and leaves existing artwork untouched:

```bash
npm --prefix apps/web run seed:store -- --fill-missing
```

For a deployed catalogue, `--upload` downloads each source URL once, writes the
bytes to the configured public R2 bucket, creates a public file asset, and stores
the resulting `assetId` instead of the remote URL. Configure `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PUBLIC`, and
`R2_PUBLIC_URL` first:

```bash
npm --prefix apps/web run seed:store -- --upload
```

## Documentation

All product/architecture rules live in [`docs/`](docs/README.md) — read in the order listed there (`PRD.md` → `ARCHITECTURE.md` → `PHASES.md` → `RULES.md` → `MEMORY.md`). The current build phase and running project state are tracked in [`docs/MEMORY.md`](docs/MEMORY.md).

## Agent Context

This project uses Graphify for fast codebase orientation.

- Start with `AGENTS.md` for Codex.
- Start with `CLAUDE.md` for Claude.
- Treat `graphify-out/` as the canonical agent-context folder.
- Read `graphify-out/GRAPH_REPORT.md` before broad file searches.
- If present, use `graphify-out/wiki/index.md` for relevant context before raw file reads.
- Use `graphify query`, `graphify path`, and `graphify explain` for architecture questions.
- Run `graphify update .` after uncommitted code changes if the graph is stale.
- Graphify hooks update the graph after commits/checkouts, and the local pre-push hook runs `graphify update .` before pushes.
- Keep `graphify-out/` committed with code after the first graph is generated; do not add it to `.gitignore`.
