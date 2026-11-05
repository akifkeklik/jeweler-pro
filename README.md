# Jeweler Pro

Jeweler Pro is a jewelry-business management application built with Vue 2, Vuetify, Node.js, Express and MongoDB. It brings product, customer, sales, inventory, pricing and reporting workflows into one interface.

## Features

- Product, category and material management
- Customer records
- Sales with server-side price calculation and stock validation
- Sale cancellation with stock restoration
- Sales snapshots for unit price and (when configured) unit cost
- Daily, weekly and monthly sales reports
- Low-stock and top-selling product reports
- TCMB currency data and jewelry price views

## Technology

| Area | Technologies |
| --- | --- |
| Frontend | Vue 2, TypeScript, Vuex, Vuetify |
| Backend | Node.js, Express 5, Mongoose |
| Database | MongoDB |
| HTTP client | Axios |
| Tests | Node.js built-in test runner, GitHub Actions |

## Requirements

- Node.js 20+
- npm
- MongoDB

## Setup

Run the backend and frontend in separate terminals.

### Backend

```bash
cd backend
npm ci
```

Create `backend/.env` based on `backend/.env.example`:

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/kuyumcu_pro_official
CORS_ORIGIN=http://localhost:8080
```

Start the API:

```bash
npm run dev
```

### Frontend

From the repository root:

```bash
npm ci
```

Create a root `.env` file:

```env
VUE_APP_API_URL=http://localhost:5000/api
VUE_APP_API_TIMEOUT=30000
```

Start the Vue app:

```bash
npm run serve
```

The frontend is available at `http://localhost:8080`; the API listens on port 5000.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/sales` | List sales with customer and product display names |
| POST | `/api/sales` | Create a sale using the current product price and available stock |
| PUT | `/api/sales/:id` | Update payment method and sale date |
| DELETE | `/api/sales/:id` | Cancel a sale and restore its stock; the record is retained |
| GET | `/api/reports/daily` | Current-day sales |
| GET | `/api/reports/weekly` | Current-week sales |
| GET | `/api/reports/monthly` | Current-month sales; add `?prev=1` for the previous month |
| GET | `/api/reports/top-sellers` | Top-selling products for the current month |
| GET | `/api/reports/low-stock` | Products with five or fewer units |

## Sales and profit data

The API calculates sale totals from the product price stored in MongoDB. A client-provided `totalPrice` is never trusted. Stock is decremented with a conditional database update, so two concurrent requests cannot both sell the same remaining units.

Each new sale stores the unit price and the product's `costPrice` at the time of sale. Configure `costPrice` on products to calculate gross profit. Older sales without a cost snapshot return `kar: null`; the application intentionally does not invent historical costs or use a fixed percentage. Cancelling a sale retains its record and returns its quantity to stock.

The stock update and sale write use compensating updates if the second operation fails. For production-grade financial workloads, run MongoDB as a replica set and move this workflow to a multi-document transaction before handling real transactions.

## Security and deployment status

This is a portfolio/development project, not a production-ready point-of-sale system. Authentication, role-based access control, audit trails, encrypted backups, operational monitoring and a formal data-retention policy are not yet implemented. Do not expose the API publicly or store real customer data until these controls and deployment configuration have been reviewed.

## Quality checks

```bash
cd backend && npm ci && npm test
cd .. && npm ci && npm run build
```

GitHub Actions runs backend tests and a frontend production build on pushes to the improvement branches and pull requests targeting `main`.

## License

No root-level LICENSE file is included. Check the intended license before redistributing the project.
