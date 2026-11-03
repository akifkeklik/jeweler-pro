# Jeweler Pro

Jeweler Pro is a jewelry-business management application with a Vue 2 frontend and an Express/MongoDB backend. It brings customer, product, sales, inventory, pricing, and reporting workflows into one interface.

## Features

- Customer and product management
- Sales records and inventory tracking
- Material and category management
- Dashboard statistics and business reports
- Pricing and exchange-rate views

## Technology

| Area | Technologies |
| --- | --- |
| Frontend | Vue 2, TypeScript, Vuex, Vuetify |
| Backend | Node.js, Express 5, Mongoose |
| Database | MongoDB |
| HTTP client | Axios |

## Requirements

- Node.js and npm
- MongoDB

## Setup

Run the backend and frontend in separate terminals.

### 1. Backend

```bash
cd backend
npm install
```

Create `backend/.env` using `backend/.env.example` as a reference:

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

The backend listens on `http://localhost:5000`. The health endpoint is `/health`.

### 2. Frontend

From the repository root:

```bash
npm install
```

Create a root `.env` file:

```env
VUE_APP_API_URL=http://localhost:5000/api
VUE_APP_API_TIMEOUT=30000
```

Start the Vue development server:

```bash
npm run serve
```

The frontend is available at `http://localhost:8080`.

## API routes

- `/api/materials`
- `/api/categories`
- `/api/products`
- `/api/customers`
- `/api/sales`
- `/api/dashboard`
- `/api/reports`
- `/api/prices`

## Development scripts

Backend:

```bash
npm run dev
npm start
npm test
```

Frontend:

```bash
npm run serve
npm run build
```

## Security status

This repository is an educational development project. The current API routes do not yet enforce user authentication or role-based authorization. The sales endpoints also need server-side price calculation and atomic inventory reconciliation; they currently must not be used as a source of truth for real transactions. Do not expose the backend to the public internet or use it with real customer data until these controls have been implemented and tested.

## Notes

This repository is an educational development project. Configure MongoDB and environment variables for your own environment before running it. Do not commit real credentials or local `.env` files.
