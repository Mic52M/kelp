# @kelp/test-target

Deliberately-vulnerable Express app that Kelp's pen-testing specialists
(#19) probe against to validate detections end-to-end without needing a real
customer.

⚠️  **Do not deploy this anywhere that is not localhost.** It has hard-coded
credentials, a weak session-signing key, and endpoints that are supposed to
leak. That's the whole point.

## Ground-truth vulnerabilities

Each entry names the specialist expected to find it and the corresponding
`vuln_class` in Kelp's DB enum.

| Endpoint                        | Class    | Specialist         | Expected outcome                                                |
| ------------------------------- | -------- | ------------------ | --------------------------------------------------------------- |
| `GET /api/orders/:id`           | `bola`   | `bola`             | Confirmed: account A can read account B's order id `ord_2001`.  |
| `GET /api/session-lookup?as=…`  | `auth`   | `auth-bypass`      | Confirmed: query param bypasses the session identity check.     |
| `GET /api/orders/search?q=…`    | `injection` | `injection`     | Confirmed: `' OR '1'='1--` widens the WHERE clause to all rows. |
| `GET /api/fetch?url=…`          | `ssrf`      | `ssrf`          | Confirmed: any URL (loopback, RFC1918, metadata IP) is fetched. |
| `GET /api/admin/users-with-hashes` | `exposure` | `exposure`   | Confirmed: response shape includes password_hash, salt, reset token. |
| `GET /api/db/select?table=orders_public&owner=…` | `rls` | `rls-deep` | Confirmed: RLS off → cross-account read succeeds against other-owner filter. |
| `GET /api/set-insecure-cookie`  | `auth`      | `weak-crypto`   | Confirmed: Set-Cookie missing HttpOnly, Secure, SameSite.       |

Control (properly-scoped) endpoints used to prove **no false positives**:

| Endpoint                | Expected outcome                              |
| ----------------------- | --------------------------------------------- |
| `GET /api/profiles/:id` | Not flagged — enforces `owner === caller`.    |
| `GET /api/me`           | Not flagged — no impersonation technique wins.|
| `GET /api/orders/find`  | Not flagged — parameterised filter, no bypass.|
| `GET /api/fetch-safe`   | Not flagged — allowlist rejects any non-listed host. |
| `GET /api/public-users` | Not flagged — response shape is only id + display_name. |
| `GET /api/db/select?table=orders_scoped&owner=…` | Not flagged — RLS enforced, cross-account read denied. |
| `GET /api/set-secure-cookie` | Not flagged — HttpOnly + Secure + SameSite all set. |

## Seed users

| Email          | Password  | User id  | Owns              |
| -------------- | --------- | -------- | ----------------- |
| `a@test.local` | `secretA` | `userA`  | `ord_1001`, `ord_1002`, `prf_a` |
| `b@test.local` | `secretB` | `userB`  | `ord_2001`, `ord_2002`, `prf_b` |

## Run

```bash
npm install --workspace @kelp/test-target
npm run dev --workspace @kelp/test-target
# → http://localhost:4400
```

Sanity check:

```bash
# 1. Login as account A
TOKEN=$(curl -s -XPOST http://localhost:4400/api/login \
  -H 'content-type: application/json' \
  -d '{"email":"a@test.local","password":"secretA"}' | jq -r .token)

# 2. Confirm the BOLA: A reads B's order
curl -s http://localhost:4400/api/orders/ord_2001 \
  -H "Authorization: Bearer $TOKEN"
# → { "id":"ord_2001", "ownerId":"userB", ... }  ← this is the flaw

# 3. Control: A can NOT read B's profile
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:4400/api/profiles/prf_b \
  -H "Authorization: Bearer $TOKEN"
# → 403
```

## How the specialists are validated

`packages/core/src/agent/specialists/*` implement Kelp's pen-testing agents.
Each one has a deterministic executor with the invariant `no confirmed
probe → no finding` (see `packages/core/src/agent/specialist.ts`). Validation
means:

1. Start the test target on `:4400`.
2. Point the specialist's real backend (worker `apps/worker/src/agent/*`) at
   `http://localhost:4400` with test-account credentials.
3. Run one campaign via `runActivePentest`.
4. Assert the outcome: the vulnerable endpoint IS reported, the secure one
   is NOT.

A future `apps/worker/src/test-target-backend.ts` will wrap the specialist
backends around this app so the same validation runs against every new
specialist before it ships.
