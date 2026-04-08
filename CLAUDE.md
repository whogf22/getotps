# CLAUDE.md

Guidance for Claude Code (and other AI assistants) when working in this repository.

## Project Overview

**GetOTPs** is a full-stack SMS verification SaaS. Users buy disposable phone numbers to receive OTP codes for third-party services (WhatsApp, Telegram, Google, etc.). Numbers are sourced from the upstream **TellaBot** API and resold with a 50% markup. Users fund their balance via crypto deposits (BTC/ETH/USDT/USDC/LTC). An HTTP API (`/api/v1/*`) is exposed for programmatic use via API keys.

- **Stack:** Express 5 + React 18 + Vite 7 + TypeScript + Drizzle ORM + better-sqlite3 + TanStack Query + Tailwind + shadcn/ui + wouter
- **Single-port architecture:** The Express server serves both API and client on the same port (default 5000). In dev, Vite runs in middleware mode inside Express; in prod, the server serves the pre-built `dist/public` directory.
- **Database:** Local SQLite file (`data.db`) with WAL mode. Tables are created via raw `CREATE TABLE IF NOT EXISTS` in `server/storage.ts` on startup; Drizzle is used for queries only. A default admin (`admin@getotps.com` / `admin123`) is seeded automatically.

## Directory Layout

```
.
├── client/                  # React frontend (Vite root)
│   ├── index.html
│   └── src/
│       ├── App.tsx          # Router (wouter with hash-based location)
│       ├── main.tsx
│       ├── index.css        # Tailwind entry + CSS variables
│       ├── components/
│       │   ├── DashboardLayout.tsx
│       │   ├── Logo.tsx
│       │   └── ui/          # shadcn/ui (new-york style)
│       ├── contexts/        # AuthContext, ThemeContext
│       ├── hooks/           # use-mobile, use-toast
│       ├── lib/             # queryClient, utils (cn helper)
│       └── pages/           # Landing, Login, Register, Dashboard,
│                            # BuyNumber, ActiveNumbers, History,
│                            # AddFunds, ApiDocs, Profile, not-found
├── server/
│   ├── index.ts             # Express bootstrap + HTTP server
│   ├── routes.ts            # ALL HTTP routes + TellaBot client (single file)
│   ├── storage.ts           # DatabaseStorage (Drizzle) + DDL + seed
│   ├── vite.ts              # Dev-mode Vite middleware
│   └── static.ts            # Prod-mode static serving
├── shared/
│   └── schema.ts            # Drizzle tables + Zod insert schemas + TS types
├── script/
│   └── build.ts             # Custom build (vite + esbuild bundle)
├── drizzle.config.ts        # Points to ./data.db, SQLite dialect
├── vite.config.ts           # Client root = ./client, outDir = ./dist/public
├── tsconfig.json            # Path aliases: @/* → client/src/*, @shared/* → shared/*
├── tailwind.config.ts
├── components.json          # shadcn config
└── data.db                  # SQLite (gitignored; WAL/SHM files may appear)
```

## Development Workflow

### Commands
| Command | What it does |
| --- | --- |
| `npm run dev` | `tsx server/index.ts` with `NODE_ENV=development`. Express boots Vite in middleware mode; HMR over `/vite-hmr`. Single server on `PORT` (default `5000`). |
| `npm run build` | Runs `script/build.ts`: (1) `viteBuild()` → `dist/public`; (2) `esbuild` bundles `server/index.ts` → `dist/index.cjs` (CJS, minified). Only the dependencies in `build.ts`'s `allowlist` are inlined; everything else stays external. |
| `npm run start` | `NODE_ENV=production node dist/index.cjs` — serves the bundled server + static client. |
| `npm run check` | `tsc` type-check (noEmit). There is no lint, no test runner, and no formatter configured. |
| `npm run db:push` | `drizzle-kit push` to sync schema to `./data.db`. Note: tables are *also* created imperatively in `server/storage.ts`, so in most cases you don't need to run this. |

### Environment variables
All optional — sensible fallbacks exist in code.
- `PORT` — defaults to `5000`. This is the only non-firewalled port in the intended deployment environment; do not introduce additional listeners.
- `NODE_ENV` — `development` uses Vite middleware; `production` serves `dist/public`.
- `SESSION_SECRET` — defaults to a hardcoded string; set this in any real deployment.
- `TELLABOT_USER`, `TELLABOT_API_KEY` — upstream SMS provider credentials (hardcoded dev defaults exist in `server/routes.ts`).

### Running
`npm run dev`, then open `http://localhost:5000`. The frontend uses **hash-based routing** (`/#/dashboard`, etc.) via `wouter/use-hash-location`, which matters if you're constructing URLs or redirecting.

## Key Conventions

### Path aliases
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/*` (not currently present)

These are configured in **both** `tsconfig.json` and `vite.config.ts`. When adding a new alias, update both.

### Schema & types (`shared/schema.ts`)
- Drizzle tables for `users`, `services`, `orders`, `transactions`, `cryptoDeposits`.
- Monetary values are stored as **`text`**, not numeric — always `parseFloat()` for math and `.toFixed(2)` / `.toFixed(8)` when writing back. Don't switch to number columns without auditing every call site.
- Timestamps are **ISO strings** in `text` columns (via `new Date().toISOString()`), not SQLite DATETIME.
- `createInsertSchema` from `drizzle-zod` exports `InsertUser`, `InsertService`, etc. Types are consumed across client and server via `@shared/schema`.
- The DDL in `server/storage.ts` must be kept in sync with the Drizzle schema when adding columns — otherwise prod DBs that never ran `drizzle-kit push` will be missing columns.

### Storage layer (`server/storage.ts`)
- All DB access goes through the `storage` singleton (`DatabaseStorage` implementing `IStorage`). Add new DB operations as methods on this class rather than calling `db` directly from routes.
- `upsertServices()` currently does a full delete + re-insert of all services. This is intentional for the 5-minute TellaBot cache refresh — be aware it will invalidate any locally-overridden service rows.

### Routes (`server/routes.ts`)
- This is one large file on purpose — all routes, auth setup, TellaBot client, OTP extraction, and crypto wallet config live here. When adding routes, keep them in the matching `========== SECTION ==========` block (AUTH / SERVICES / ORDERS / CRYPTO / ADMIN / API v1).
- **Two auth schemes coexist:**
  - **Session-based** (`requireAuth` / `requireAdmin`) via `passport-local` + `express-session` + in-memory store — used by `/api/*` routes consumed by the React app. `credentials: "include"` is needed from the client.
  - **API-key** (`requireApiKey`) reading `x-api-key` header or `api_key` query — used by `/api/v1/*` routes intended for external programmatic use.
- `requireAdmin` checks `req.user.role === "admin"`. The default seeded admin has API key + `100.00` balance.
- **TellaBot integration:** `tellabotAPI(cmd, params)` is the one-stop function. Commands used: `list_services`, `request`, `read_sms`, `reject`, `balance`. Services are cached in-memory for 5 minutes and also mirrored to the `services` DB table.
- **Price markup:** `MARKUP_MULTIPLIER = 1.5` is applied when mirroring TellaBot prices into the DB. User-facing prices come from the DB.
- `extractOTPFromText()` tries regex patterns in priority order — keep the 6-digit pattern first, as that's the most common real-world case.
- There are `simulate-sms` and `simulate-confirm` routes for demo/dev fallback when TellaBot balance is low or during local testing. Don't remove them without checking the client (`BuyNumber.tsx`, `AddFunds.tsx`) first.

### Frontend patterns
- **Routing:** `wouter` with `useHashLocation`. All navigation uses `<Link href="/path">` (no leading `#`); programmatic nav uses `window.location.hash = "/path"`.
- **Auth:** `AuthContext` wraps TanStack Query. `useAuth()` exposes `user`, `login`, `logout`, `register`, `refreshUser`. `ProtectedRoute` in `App.tsx` redirects unauthenticated users to `/login`.
- **Data fetching:** `queryClient.ts` default `queryFn` joins `queryKey` as the URL (so `useQuery({ queryKey: ["/api/services"] })` just works). Mutations use `apiRequest(method, url, data)` which throws on non-2xx. `staleTime: Infinity` is the global default — queries do not auto-refetch; call `queryClient.invalidateQueries(...)` explicitly when data changes.
- **API base URL:** `API_BASE` in `queryClient.ts` uses a placeholder-replacement trick (`"__PORT_5000__"`). If the string starts with `__` it's treated as unset and requests are same-origin. Don't "fix" this — it's intentional for a deployment system that does a literal string substitution.
- **UI components:** shadcn/ui (`new-york` style) in `client/src/components/ui/`. Use `cn()` from `@/lib/utils` for conditional classNames. When adding a new shadcn component, follow the existing file conventions rather than running the shadcn CLI (which may not be installed).
- **Theming:** `ThemeContext` (light/dark) + CSS variables defined in `client/src/index.css`. `tailwind.config.ts` maps semantic tokens (`background`, `foreground`, `sidebar-*`, etc.).
- **Testing hooks:** Components frequently include `data-testid="..."` attributes — preserve these when editing.
- **Toast notifications:** `useToast()` from `@/hooks/use-toast` (shadcn pattern).

### Build specifics
`script/build.ts` uses an **allowlist** of dependencies to bundle into `dist/index.cjs`; everything else is marked external. When adding a runtime dependency that must be bundled (e.g. because it has side effects that trip up Node's module loader), add it to the `allowlist` array. When adding a runtime dependency that should be loaded from `node_modules` at runtime, do nothing — it's external by default. The goal stated in-code is to reduce `openat(2)` syscalls at cold start.

## Things to Watch Out For

- **Don't commit `data.db`** — it's in `.gitignore` along with `*.db`, but `data.db-shm` / `data.db-wal` may linger. These are SQLite WAL sidecars; safe to leave untracked.
- **Don't bypass the `storage` abstraction** in routes. Add methods to `DatabaseStorage` instead of importing `db` into `routes.ts`.
- **Money math:** always parse → operate → `toFixed(2)`. Never concatenate string amounts. Refund flows mirror purchase flows — if you change one, check the other.
- **Keep the DDL in `server/storage.ts` in sync with `shared/schema.ts`.** Adding a column to Drizzle alone will not migrate existing SQLite files.
- **Don't introduce a second port.** `server/index.ts` comments state that only `PORT` is reachable; API + client must share it.
- **`rawBody` on `IncomingMessage`** is captured in `server/index.ts` for potential webhook signature verification — don't strip the `verify` callback on `express.json()`.
- **API v1 vs session API:** these are parallel, not layered. If you add a feature, decide which surface(s) it belongs to. Don't call session-auth helpers from `/api/v1/*` routes.
- **TellaBot failures should degrade gracefully** — the services endpoint falls back to cached DB data; orders return 503 with a friendly message. Preserve this behavior in new TellaBot-touching code.
- **Error responses:** session routes use `{ message: "..." }`; `/api/v1/*` routes use `{ error: "..." }`. Follow the convention of the surface you're editing.
- **No test suite exists.** Don't invent one unless the user asks — but do run `npm run check` after non-trivial changes to catch type errors.

## Quick Reference: Adding a New Feature

1. **New DB column/table:** update `shared/schema.ts` **and** the `CREATE TABLE` DDL in `server/storage.ts`. Add typed accessors to `DatabaseStorage`.
2. **New API route:** add to the appropriate section in `server/routes.ts`. Pick `requireAuth` (session) or `requireApiKey` (v1). Use the `storage` singleton.
3. **New page:** create `client/src/pages/Foo.tsx`, wire into `App.tsx` as a `<ProtectedRoute>` (or public `<Route>`), and add to `navItems` in `DashboardLayout.tsx` if it belongs in the sidebar.
4. **New query:** `useQuery({ queryKey: ["/api/your-endpoint"] })` — the default `queryFn` handles it. Invalidate via `queryClient.invalidateQueries({ queryKey: [...] })` after mutations.
5. **New shadcn component:** copy an existing file in `components/ui/` as a template — don't run the shadcn CLI.
