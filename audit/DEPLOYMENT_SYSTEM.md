# Deployment System

## Cache-busting strategy

- Build generates hashed client asset names (Vite output) and a root `VERSION` file.
- API responses are sent with `Cache-Control: no-store`.
- HTML responses are served with `Cache-Control: no-cache, must-revalidate`.
- Hashed static assets are served with `Cache-Control: public, max-age=31536000, immutable`.

## Version broadcast system

- Build writes `VERSION` JSON with:
  - `version` (git short hash)
  - `built_at` (ISO timestamp)
  - `branch` (current branch)
- Backend exposes `GET /api/version`.
- Frontend polls `/api/version` every 5 minutes and shows a refresh banner on version changes.
- Banner supports refresh now / later dismissal (30-minute cooldown).

## Service worker strategy

- Production-only registration in `client/src/main.tsx`.
- Network-first for HTML/navigation.
- Network-only behavior for `/api/*` (no API caching).
- Cache-first for static assets.
- Offline fallback page at `client/public/offline.html`.
- Immediate takeover via `clients.claim()`.

## Nginx config location

- Template file: `nginx.conf.template`.
- Includes immutable cache for static files and no-cache for HTML entry route.

## Deployment command

```bash
bash scripts/deploy.sh
```

## Live verification command

```bash
npm run check:live
```
