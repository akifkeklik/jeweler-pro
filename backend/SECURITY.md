# Jeweler Pro API: security operations notes

This file describes the security behaviour operators rely on, and the guarantees
behind it. Audit findings are referenced in brackets (H1, M1–M4, L1–L7).

---

## 1. Rate limiting and login protection (H1, M1, L6)

**General API limit.** Every `/api` request is first counted by
`middleware/apiRateLimit.js` (`express-rate-limit`): 600 requests per minute
per client address by default (`API_RATE_LIMIT_PER_MINUTE`, 0 = off when the
reverse proxy limits instead). A refusal is `429 RATE_LIMITED` with
`Retry-After` and the standard `RateLimit` headers. The targeted limiters
below still apply inside this bound.

### Limits

| Endpoint | Dimension | Limit | Counts |
|---|---|---|---|
| `POST /api/auth/login` | IP + account | 10 / 15 min | every attempt (successes refunded) |
| | IP | 30 / 15 min | failures only (successes refunded) |
| | account (all IPs) | 20 / 15 min | failures only (successes refunded) |
| `POST /api/auth/refresh` | IP | 120 / min | every call |
| `POST /api/auth/forgot-password` | IP | 10 / 15 min | every call |
| | account | 5 / hour | every call |
| `POST /api/auth/reset-password[/validate]` | IP | 20 / 15 min | every call |
| `POST /api/prices/refresh` | authenticated user (`businessId` + `_id`), IP fallback | 1 / 5 s | every call |

- **IP** means the *rate-limit identity*: the IPv4 address, or the **IPv6 /64**
  network. Privacy extensions rotate the low 64 bits of an IPv6 address, so a
  per-address limit could be bypassed by a single client. IPv4-mapped IPv6
  (`::ffff:a.b.c.d`) is the same client as `a.b.c.d`.
- **Account** is a keyed HMAC of the normalised e-mail (trim + lower case, the
  same normalisation used for stored accounts). The HMAC key is random per
  process, so limiter memory never holds raw e-mail addresses. Unknown
  accounts are limited exactly like real ones, so the limiter does not reveal
  which accounts exist.
- **Account-lockout DoS:** an attacker can exhaust an account's account-wide
  budget from many IPs. A client identity (IP/64 + account) that logged in
  successfully within the last 30 days is exempt from the *account-wide*
  limit. It is still bound by its own IP + account and IP limits, so the owner
  can keep signing in from their usual network while unknown networks stay
  blocked.
- Attempts are charged before the password check. Parallel in-flight requests
  cannot burst past a limit.

### Memory and complexity

- Every limiter table has a hard cap of `RATE_LIMIT_MAX_ENTRIES` keys (default
  10 000, allowed range 100–1 000 000).
- Measured cost is about 150 bytes per key in the worst case, where every
  entry is an established counter (measured with `--expose-gc` on Node 24; the
  regression test fails above 400 bytes). That makes about 1.4 MB per table at
  the default cap. There are nine tables plus the known-client set, so the
  worst case is about 15 MB in total. At 50 000 keys per table it is about
  6.3 MB per table, or about 65 MB in total. That is why 50 000 is not the
  default.
- Each request does O(1) work. Expired entries are reclaimed incrementally,
  16 per request normally and up to 256 under capacity pressure. The table is
  never scanned in full.

### Eviction and capacity exhaustion

- Keys seen once (probation) can be evicted, oldest first, when a table is
  full. Counters with two or more attempts, and every blocked key, are never
  evicted. Flooding a table with fresh keys therefore cannot reset an
  attacker's own blocked counter or anyone's meaningful counter.
- If every slot holds a live established counter, **new** clients get
  `429 RATE_LIMIT_CAPACITY_EXHAUSTED` (fail closed) until entries expire.
  Clients that are already tracked keep their normal behaviour. The event is
  logged once per window as `[rate-limit] "<name>" kapasitesi doldu`, which
  usually means a distributed attack.

### Single instance vs. multiple instances

- **One API process:** the limits above are exact.
- **N processes or replicas:** each process counts on its own. An attacker
  gets up to N × limit, and counters reset on every restart or deploy.
  Horizontally scaled deployments **must** add an equivalent limit at the
  reverse proxy or load balancer, or implement a shared store such as Redis
  (not implemented). Production start-up logs a warning about this.
- `TRUST_PROXY` must describe the real proxy chain (see `.env.example`).
  Otherwise every client shares the proxy's IP, or clients can choose their
  own IP.

---

## 2. Environment (M2)

`config/environment.js` is the only module that interprets `NODE_ENV`. Case and
surrounding whitespace are normalised (`" Production "` becomes `production`).
Any value other than `development`, `test` or `production` stops start-up, and
until then it is treated like production (fail closed). After validation,
`process.env.NODE_ENV` and Express' `env` setting are rewritten to the
canonical value. Production always uses Secure cookies and never returns
internal error messages or stack traces. Stack traces appear only in
`development`.

---

## 3. Break-glass admin recovery (M3, L2)

Use this only when the business has **no usable admin**.

1. Generate a fresh token:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set the following and start the API **once**:
   ```
   ADMIN_RECOVERY=true
   ADMIN_RECOVERY_TOKEN=<token from step 1>
   ADMIN_EMAIL=<account to recover>
   ADMIN_PASSWORD=<new password, ≥ 14 characters>
   ```
3. Remove `ADMIN_RECOVERY`, `ADMIN_RECOVERY_TOKEN` and `ADMIN_PASSWORD` again.

Guarantees:

- **Each token works once.** Its SHA-256 (never the token itself) is stored in
  `admin_recovery_consumptions` in the same transaction as the account change.
  Leftover variables on later restarts change nothing. Two instances starting
  at the same moment produce exactly one recovery.
- `ADMIN_RECOVERY=true` without a token does nothing and logs an error.
- Recovery is **refused while another active admin exists**. That admin can
  restore the account in the UI. For an emergency, such as the other admin
  account being compromised, add `ADMIN_RECOVERY_OVERRIDE_ACTIVE_ADMINS=true`.
  The override is recorded in the audit record.
- In a single transaction, the recovery creates the account or re-activates
  and promotes it, replaces the password hash, increments `tokenVersion`
  (which invalidates all access tokens), revokes all refresh sessions, removes
  any reset token and writes the mandatory `user.admin_recovery` audit record.
  If any step fails, including the audit write, nothing changes and start-up
  fails.
- An account that already is an active admin is left untouched. The token is
  consumed and the attempt is audited as `user.admin_recovery_skipped`.
- Tokens and passwords are never logged.

---

## 4. Audit data retention and minimisation (M4)

Policy for **new** audit records, enforced centrally in `utils/audit.js`:

| Data | Policy |
|---|---|
| Secrets (`password*`, `token`, `secret`, `authorization`) | never stored |
| Person's name and e-mail in `User` records | never stored. The record keeps the account id and authorization-relevant state (role, branch, permissions, active). A name change is recorded as `nameChanged: true`. |
| Client IP | only a network prefix (`ipPrefix`: IPv4 /24, IPv6 /48). Full addresses exist only in `AuthSession` documents, which MongoDB deletes 1 day after the session expires. |
| E-mail delivery failures | an allowlisted `errorCode` (for example `EENVELOPE`) and the numeric `smtpResponseCode`. Raw SMTP text is never stored, because it can contain addresses and server details. |
| Security telemetry: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_reset_requested`, `*.password_reset_email_failed` | `expiresAt` is set to creation time plus `AUDIT_TELEMETRY_RETENTION_DAYS` (default 180, range 30–3650), and a TTL index removes the record after that |
| Business and state-change records (users, sales, cash, password changes, session revocation, admin recovery) | kept indefinitely (no `expiresAt`) |

Tenant isolation is unchanged. `GET /api/audit` only returns records whose
actor belongs to the caller's business, including deleted members through the
PII-free `deleted_users` tombstone.

### Historical records (proposal, not executed automatically)

Records written before this change can contain names, e-mail addresses, full
IPs and raw SMTP error text. The application never rewrites them: audit
records are immutable, and the TTL index ignores documents without
`expiresAt`. Clean them up with a separate, controlled procedure:

1. **Approve:** the data-protection owner approves the scope and retention,
   taking into account commercial-law retention duties for financial records.
2. **Back up:** take an encrypted backup of `auditlogs` with restricted
   access and a defined destruction date.
3. **Inventory:** run a read-only query to see what is affected, for example:
   ```js
   db.auditlogs.countDocuments({ resourceType: 'User', $or: [
     { 'before.email': { $exists: true } }, { 'after.email': { $exists: true } },
     { 'before.name':  { $exists: true } }, { 'after.name':  { $exists: true } } ] })
   db.auditlogs.countDocuments({ 'after.ip': { $exists: true } })
   db.auditlogs.countDocuments({ 'after.error': { $exists: true } })
   ```
4. **Redact:** run a reviewed one-off script in a maintenance window using the
   raw driver (the Mongoose schema marks these fields immutable). It
   `$unset`s `before/after.name` and `before/after.email`, replaces
   `after.ip` with the `ipPrefix` computed by `utils/ipAddress.auditIpPrefix`,
   and replaces `after.error` with `errorCode: 'LEGACY_REDACTED'`. Each
   modified document gets a `redactedAt` marker, and one summary audit record
   (`audit.historical_redaction`) is written with the counts.
5. **Expire telemetry (optional):** set `expiresAt` on historical telemetry
   actions, based on their `createdAt` and the approved retention period.
6. **Verify:** re-run the inventory queries and expect zero. Then destroy the
   backup on schedule.

---

## 5. Password-reset tokens (L3)

- Only the SHA-256 of a token is stored. Each token is single-use and expires
  after `PASSWORD_RESET_TTL_MINUTES`.
- A token is bound to the account's `tokenVersion` at issuance. Deactivation,
  password changes, "sign out everywhere" and admin session revocation
  increment the version, which invalidates outstanding links permanently.
- Admin-sent resets are issued inside the business admin guard transaction, so
  they are serialised with deactivation, deletion, re-activation and
  permission changes. Self-service resets use a conditional write that only
  matches an active account with an unchanged `tokenVersion`.
- Re-activation also clears any reset token.
- At consumption, expiry, `active: true` and the version binding are all
  checked again atomically.

---

## 6. Origins and loopback (L4, L5)

- `config/origins.js` canonicalises origins (case, default port, one trailing
  `/`, IDN to punycode). It rejects paths, queries, fragments, credentials,
  `null` and `*`. CORS, both CSRF guards, start-up validation and e-mail links
  all use this one representation, and the allowlist is strict.
- Production rejects `APP_URL` and `CORS_ORIGIN` values that point at the
  local host in any spelling: `localhost.`, `*.localhost`, `127.1`,
  `2130706433`, `0x7f.1`, `[::1]`, `[0:0:0:0:0:0:0:1]`, `[::ffff:127.0.0.1]`,
  `0.0.0.0`, `[::]`, and so on.

---

## 7. MongoDB deployment requirements (L7)

User management, admin recovery, reset-token issuance and sales need
multi-document transactions. That requires a **replica set (MongoDB ≥ 4.0)**
or a **sharded cluster (≥ 4.2)**.

- At start-up the API asks the **connected server** (`hello`) for its
  topology, wire version and session support, then runs and commits a real
  read-only transaction. A `?replicaSet=` parameter in the URI is not trusted
  as proof.
- In **production** the server refuses to start if either check fails, with
  `MongoDB üretim gereksinimlerini karşılamıyor`. In development and test it
  only logs a warning.
- Error messages never contain the connection string or credentials.
- A single-node replica set is enough for transactions but not for
  durability. Production should run at least three data-bearing members.
