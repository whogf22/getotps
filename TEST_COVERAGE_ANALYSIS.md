# Test Coverage Analysis

## Current State

**Test coverage: 0%** — No test files, test runner, or testing dependencies exist in the project.

---

## Prioritized Test Recommendations

### Priority 1: Critical Business Logic (Unit Tests)

#### 1. OTP Extraction (`server/routes.ts:82-98`)
The `extractOTPFromText()` function is a pure function at the core of the product. Incorrect extraction = broken OTP delivery.

**Recommended test cases:**
- 4, 5, 6, 7, 8-digit codes in plain text
- Codes with prefixes: `code:`, `pin:`, `verification:`
- Messages with no numeric codes
- Messages with multiple numbers (phone numbers vs OTP)
- Edge cases: empty string, very long messages

#### 2. Balance & Pricing Calculations
Floating-point arithmetic on money (`parseFloat`, `.toFixed(2)`) throughout `routes.ts`.

**Recommended test cases:**
- Markup calculation (1.5x on TellaBot cost)
- Balance deduction on order creation
- Refund on order cancellation
- Crypto-to-USD conversion at various rates
- Edge: exactly sufficient balance, $0.00 balance, very small amounts

#### 3. DatabaseStorage Class (`server/storage.ts:140-280`)
Every CRUD method should be integration-tested against an in-memory SQLite DB.

**Critical methods to test:**
- `createUser` — unique email/username constraints
- `updateUserBalance` — correctness under concurrent updates
- `upsertServices` — deletes all then reinserts (data integrity)
- `getActiveOrders` — status filter logic (only `waiting` and `received`)
- `cancelOrder` — status and completedAt are set correctly
- `generateApiKey` — returns valid key, updates DB

---

### Priority 2: API Security & Authorization (Integration Tests)

#### 4. Authentication Middleware
- Unauthenticated requests to protected routes return 401
- Non-admin users accessing admin routes return 403
- Authenticated users can access their own resources

#### 5. Resource Ownership Checks
- User A cannot view/cancel/check-sms on User B's orders
- User A cannot submit tx hash for User B's crypto deposit
- Admin can access any resource

#### 6. Registration & Login
- Duplicate email rejection (400)
- Duplicate username rejection (400)
- Password is hashed (not stored plaintext)
- Password is never returned in API responses
- Session is created on successful login/register

---

### Priority 3: API v1 Key-Based Auth

#### 7. `requireApiKey` Middleware
- Header-based auth (`X-API-Key`)
- Query param auth (`?api_key=`)
- Missing key returns 401
- Invalid key returns 401

#### 8. API v1 Order Lifecycle
- Service lookup by name, slug, or numeric ID
- Order creation with balance check
- Auto-check SMS on GET `/api/v1/order/:id`
- Cancel with refund

---

### Priority 4: State Machine & Edge Cases

#### 9. Order Status Transitions
- `waiting` -> `received` (on SMS arrival)
- `waiting` -> `cancelled` (on cancel)
- Cannot cancel a `received` or `completed` order
- Cannot check-sms on a `cancelled` order

#### 10. Crypto Deposit State Machine
- `pending` -> `confirming` (on hash submit)
- `confirming` -> `completed` (on confirmation)
- Cannot submit hash on non-pending deposit
- Cannot confirm a non-confirming deposit
- Double-confirm protection

#### 11. Service Cache TTL
- Returns cached data within TTL window
- Refreshes from TellaBot API after TTL expires
- Falls back to DB data on API failure

---

### Priority 5: Input Validation

#### 12. Missing Validation Coverage
- `/api/orders` — validate `serviceId`/`serviceName` types
- `/api/crypto/create-deposit` — validate upper bound on amount
- `/api/profile/change-password` — validate new password strength/length
- All routes — malformed input should return 400, not 500

---

## Bug Found

**API v1 cancel route (`routes.ts:711-731`) does not create a refund transaction**, unlike the web cancel route (`routes.ts:418-457`). API-cancelled orders won't appear in the user's transaction history.

---

## Recommended Test Setup

- **Test runner:** Vitest (compatible with existing Vite toolchain)
- **HTTP testing:** supertest (for API route integration tests)
- **Database:** In-memory SQLite for test isolation
- **Structure:**
  ```
  tests/
    unit/
      extractOTP.test.ts
      pricing.test.ts
    integration/
      storage.test.ts
      auth.test.ts
      orders.test.ts
      crypto.test.ts
      api-v1.test.ts
  ```
