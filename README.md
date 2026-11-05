# Jeweler Pro

Jeweler Pro is a jewelry-business management application built with Vue 2, Vuetify 2, Node.js, Express 5 and MongoDB. It combines product and stock management, customer records, sales, pricing and operational reports.

## Main capabilities

- Product, category and material management
- Customer records
- Authenticated admin/staff access
- Server-side sales totals and stock validation
- Sale cancellation with stock restoration and retained financial history
- Unit-price and optional unit-cost snapshots at the time of sale
- Daily, weekly and monthly reports, top sellers and low-stock list
- TCMB currency data and jewelry price views

## Technology

| Area | Technologies |
| --- | --- |
| Frontend | Vue 2, TypeScript, Vuex, Vuetify 2 |
| Backend | Node.js, Express 5, Mongoose |
| Database | MongoDB |
| HTTP | Axios |
| Tests | Node.js built-in test runner, GitHub Actions |

## Requirements

- Node.js 20+
- npm
- MongoDB 6+ configured as a replica set (required for atomic sales and cancellations)

## Local setup

### 1. Backend configuration

```bash
cd backend
npm ci
```

Copy `backend/.env.example` to `backend/.env` and set:

- `MONGO_URI`: your MongoDB connection string
- `JWT_SECRET`: a unique random secret of at least 32 characters
- `ADMIN_EMAIL`: the first administrator email
- `ADMIN_PASSWORD`: a unique password of at least 14 characters

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The first administrator is created once when the backend starts. Existing administrator passwords are never overwritten by the bootstrap process. Keep the environment file private and never commit it.

Start the API:

```bash
npm run dev
```

The API listens on port 5000 by default. Health checks are available at `/health` and `/health/ready`.

### 2. Frontend configuration

From the repository root:

```bash
npm ci
```

Copy the root `.env.example` to `.env`. Set `VUE_APP_API_URL` to the backend origin (for local development, `http://localhost:5000`).

Start the Vue application:

```bash
npm run serve
```

The frontend is available at `http://localhost:8080`. Sign in using the administrator credentials configured for the backend.

## Authentication and access

- API routes under `/api` require a signed bearer token, except `/api/auth/login`.
- Passwords are stored as salted scrypt hashes; plaintext passwords are never stored.
- Access tokens use HS256 and expire after eight hours.
- Login attempts are rate-limited per process and IP.
- Admin-only operations include destructive delete actions.
- The frontend stores the access token in session storage and clears it on an unauthorized response.

For production, terminate TLS at a trusted reverse proxy, use a secrets manager, configure a distributed rate limiter/WAF, rotate secrets deliberately, and use secure operational monitoring. The included in-memory login limiter is a baseline for a single backend process, not a substitute for distributed edge protection.

## Sales and stock integrity

The API calculates sale totals from the current product price; client-provided totals are ignored. Stock deduction uses a conditional database update so concurrent sales cannot both consume the same remaining units. Failed sale persistence triggers a compensating stock update. Cancelling a sale retains the financial record and restores the sold quantity.

Each sale stores the unit sale price and, when configured, the unit cost at the time of sale. Historical sales without a cost snapshot report profit as unavailable; the application does not invent historical costs or assume a fixed margin.

The current stock workflow uses conditional writes and compensation. For financial production use, run MongoDB as a replica set and move sale creation/cancellation to multi-document transactions, then verify recovery behavior with integration tests against a real replica set.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Authenticate and receive an access token |
| GET | `/api/auth/me` | Return the current authenticated user |
| GET/POST | `/api/products` | List/create products |
| GET/PUT/DELETE | `/api/products/:id` | Read/update/delete a product (delete: admin) |
| GET/POST | `/api/customers` | List/create customers |
| GET/PUT/DELETE | `/api/customers/:id` | Read/update/delete a customer (delete: admin) |
| GET/POST | `/api/sales` | List/create sales |
| PUT/DELETE | `/api/sales/:id` | Update payment/date or cancel a sale (cancel: admin) |
| GET | `/api/reports/daily` | Current-day sales |
| GET | `/api/reports/weekly` | Current-week sales |
| GET | `/api/reports/monthly` | Current-month sales; `?prev=1` for previous month |
| GET | `/api/reports/top-sellers` | Top-selling products for the current month |
| GET | `/api/reports/low-stock` | Products with five or fewer units |

## Quality checks

```bash
cd backend && npm ci && npm test
cd .. && npm ci && npm run build
```

GitHub Actions runs backend tests and the frontend production build for pull requests and improvement branches.

## Security status

This is a portfolio project, not a certified production point-of-sale system. Before handling real customer or financial data, complete a security review, verify backups and restore drills, configure TLS and secrets management, and run end-to-end tests against the actual deployment topology.

## License

No root-level LICENSE file is included. Check the intended license before redistribution.
