# Addon Sections Report

Branch: `auto/mega-full-production-2026-04-24`  
Date: 2026-04-24

## Sections Implemented (Additive)

### Section 21 — Device fingerprinting + fraud scoring
- Added login fingerprint collection hooks for registration and login.
- Added `login_events` persistence with `fingerprint_hash`, IP, ASN, country, risk score, and reasons.
- Added risk scoring engine with VPN/datacenter/new-device/country-change/multi-account/failed-login factors.
- Added linked account lookup endpoint for admin: `GET /api/admin/users/:id/linked-accounts`.

### Section 22 — Abuse prevention engine
- Added `abuse_events`, `abuse_blocks`, and `api_key_usage`.
- Added rapid-buy protection gates for user/IP behavior in buy flow.
- Added API key abuse tracking and automatic key revocation path.
- Added admin abuse events listing and resolve endpoints.

### Section 23 — Provider blackout + leak hardening
- Added centralized scrubber for provider-related terms and sensitive keys in JSON responses.
- Added hardened safe error mapping with provider-neutral messaging.
- Updated admin/frontend labels from provider-specific wording to generic provider wording.
- Added `/api/status` provider-neutral status endpoint.
- Added build leak check script: `npm run check:leaks`.

### Section 24 — Advanced monetization (additive)
- Added annual billing-ready plan payload endpoint: `GET /api/plans`.
- Added additive upgrade endpoint processing for monthly/annual.
- Added service bundle support:
  - `service_bundles`, `user_bundle_credits`
  - `GET /api/bundles`
  - `POST /api/bundles/:id/purchase`
  - Bundle-first credit consumption in buy flow.
- Added win-back tracking storage and scheduled candidate marking in cleanup job.

### Section 25 — Changelog + announcements
- Added `changelogs`, `changelog_reads`.
- Added endpoints:
  - `GET /api/changelog`
  - `POST /api/changelog/read-all`
  - `POST /api/admin/changelog`
- Added frontend changelog page and unread badge in dashboard navigation.

### Section 26 — Support system + FAQ
- Added `support_tickets`, `support_ticket_messages`, `faq_entries`.
- Added endpoints:
  - `GET/POST /api/support`
  - `GET /api/admin/support`
  - `POST /api/admin/support/:id/reply`
  - `GET /api/faq`
  - `POST /api/admin/faq`
- Added frontend pages for support and FAQ.
- Added stale ticket auto-close in cleanup job.

### Section 27 — Performance + reliability
- Added additional indexes and analytics table for frequent query paths.
- Added 5-minute in-memory cache-aside for:
  - `GET /api/v1/services`
  - `GET /api/services/:service/stats`
  - `GET /api/stats`
- Added health/readiness endpoints:
  - `GET /healthz`
  - `GET /readyz`
- Added graceful shutdown handling with inflight request draining and cleanup stop.

### Section 28/29 — Verification + live deployment checks
- Added `VERSION` generation in build pipeline.
- Added endpoint `GET /api/version`.
- Added deployment scripts:
  - `scripts/check-leaks.js`
  - `scripts/check-live.js`
  - `scripts/purge-cache.js`
  - `scripts/deploy.sh`
- Added service worker + offline page and frontend version refresh banner.
- Added `nginx.conf.template`.

## Test Coverage Added

- Added `server/__tests__/addon-sections.test.ts` for:
  - VPN/datacenter risk elevation
  - Multi-account fingerprint risk
  - Rapid-buy soft-block behavior
  - API-key auto-revoke behavior
  - `/api/version` and `/healthz` availability and scrub sanity

## New Environment Variables

- `FRAUD_RISK_STRICT_MODE`
- `CAPTCHA_PROVIDER_KEY`
- `CAPTCHA_PROVIDER_SECRET`
- `REFERRAL_CREDIT_DAILY_LIMIT_CENTS`
- `CASHBACK_RATE_LIMIT_PER_HOUR`
- `WINBACK_MIN_DEPOSIT_CENTS`
- `WINBACK_CREDIT_CENTS`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_API_TOKEN`

## Manual Configuration Notes

- Configure cloud cache purge vars only when using Cloudflare CDN purge automation.
- Ensure provider credentials are present in runtime env and not exposed client-side.
- Validate production reverse proxy cache headers using `nginx.conf.template` guidance.
