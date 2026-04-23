# Changelog

## 2026-04-24 - Production Re-Audit + Hardening

- Added production hardening for proxy/cookie-aware request handling, explicit origin policy, CSRF-style origin checks, and safer API/IP rate-limit keying.
- Added automatic stale-state cleanup for pending OTP orders and pending deposits with idempotent expiration behavior.
- Added hidden upstream Tellabot integration module (`handler_api.php` flow) with server-only activation and SMS polling functions.
- Added Circle Dev-Controlled wallet integration scaffolding for user wallet creation, USDC balance lookup, and transfer-to-master payment execution.
- Added additive OTP APIs:
  - `POST /api/buy-number`
  - `GET /api/check-sms/:orderId`
  - `POST /api/wallet/create`
  - `GET /api/wallet/balance`
- Preserved existing routes and legacy flows for backward compatibility, while sanitizing internal upstream identifiers from client-facing order payloads.
- Added UI enhancements for Circle wallet deposit UX and compatibility routing for OTP purchase/check flows.
- Added minimal test suite (auth smoke, OTP lifecycle with mocked Circle/Tellabot, pending cleanup behavior) and test/lint/typecheck scripts.
- Confirmed existing pricing/pay-per-use behavior remains intact; no plan/upgrade/subscription-removal changes were introduced.
