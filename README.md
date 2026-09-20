# Jeweler Pro

A modern and intuitive management platform designed to help jewelry businesses streamline their daily operations and move their business processes into the digital environment.

Jeweler Pro provides a centralized solution for managing customers, products, sales, inventory, pricing, and business reports — all through a clean and easy-to-use interface.

## Overview

Jeweler Pro allows you to manage the core operations of a jewelry business from a single dashboard.

With the application, you can:

- Manage customers, products, and sales
- Track inventory and product prices
- Monitor daily and monthly business performance
- View sales and operational reports
- Access up-to-date exchange rates through the CBRT integration

The goal is simple: **make jewelry business management faster, easier, and more organized.**

## Quick Start

### Backend

#### Windows

```bat
cd backend
npm install
copy .env.example .env
npm run dev
macOS / Linux
cd backend
npm install
cp .env.example .env
npm run dev
Frontend

From the project root:

Windows
npm install
copy .env.example .env
npm run serve
macOS / Linux
npm install
cp .env.example .env
npm run serve

Once the application is running:

Frontend: http://localhost:8080
Backend API: http://localhost:5000/api
Environment Variables
Backend

Create a .env file inside the backend directory:

MONGO_URI=mongodb://127.0.0.1:27017/kuyumcu_pro_official
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:8080
Frontend

Create a .env file in the project root:

VUE_APP_API_URL=http://localhost:5000/api
VUE_APP_API_TIMEOUT=30000
VUE_APP_ENV=development
Features
Customer Management

Manage customer records and keep customer information organized in one place.

Product Management

Create, update, and manage jewelry products with detailed product information.

Sales Management

Record and manage sales transactions while keeping business operations centralized.

Inventory & Price Tracking

Monitor inventory levels and keep track of product prices efficiently.

Dashboard

Get a quick overview of key business metrics through a centralized dashboard.

Reports

Analyze business performance with daily and monthly reports.

Exchange Rate Integration

Integrates with the Central Bank of the Republic of Türkiye (CBRT) to retrieve exchange rate information.

Tech Stack
Frontend
Vue 2
Vuex
TypeScript
Vuetify
Backend
Node.js
Express
Mongoose
Database
MongoDB
Project Structure
Jeweler-Pro/
├── backend/
│   ├── ...
│   └── .env.example
│
├── ...
├── .env.example
└── package.json
Getting Started

Before running the project, make sure you have the following installed:

Node.js
npm
MongoDB

After configuring the environment variables, start the backend and frontend separately using the commands described above.

Purpose

Jeweler Pro was built to simplify the management of jewelry businesses by bringing essential business operations together in a single, centralized platform.

Instead of dealing with complicated workflows and disconnected tools, businesses can manage their daily operations through a simple and efficient interface.

License

This project is intended for educational and development purposes.


Bu sürüm **README.md'ye direkt yapıştırılabilecek** şekilde hazırlanmıştır.
