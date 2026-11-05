/**
 * Jeweler Pro API server.
 * The HTTP server starts only after MongoDB has connected successfully.
 */
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");

const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");
const { authenticate } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const bootstrapAdmin = require("./scripts/bootstrapAdmin");

const materialsRouter = require("./routes/materials");
const categoriesRouter = require("./routes/categories");
const productsRouter = require("./routes/products");
const customersRouter = require("./routes/customers");
const salesRouter = require("./routes/sales");
const dashboardRouter = require("./routes/dashboard");
const reportsRouter = require("./routes/reports");
const pricesRouter = require("./routes/prices");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/kuyumcu_pro_official?replicaSet=rs0";

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:8080,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
}));

// Keep request bodies bounded to reduce memory-exhaustion risk.
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use(requestLogger);

app.use("/api/auth", authRouter);
app.use("/api", authenticate);
app.use("/api/materials", materialsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/sales", salesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/prices", pricesRouter);

app.get("/health", (req, res) => {
  res.json({
    status: mongoose.connection.readyState === 1 ? "OK" : "STARTING",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/health/ready", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? "READY" : "NOT_READY",
    database: ready ? "connected" : "disconnected",
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "Jeweler Pro API",
    version: "1.0.0",
    status: "Running",
    environment: process.env.NODE_ENV || "development",
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint bulunamadı",
    path: req.path,
    method: req.method,
  });
});

app.use(errorHandler);

let server;

async function startServer() {
  try {
    if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
      throw new Error("JWT_SECRET en az 32 karakter olmalıdır");
    }
    await mongoose.connect(MONGO_URI);
    await bootstrapAdmin();
    console.log("MongoDB veritabanına bağlandı");

    server = app.listen(PORT, () => {
      console.log(`Jeweler Pro API listening on port ${PORT}`);
    });

    return server;
  } catch (error) {
    console.error("MongoDB bağlantısı kurulamadı; HTTP sunucusu başlatılmadı:", error.message);
    process.exitCode = 1;
    return null;
  }
}

async function shutdown(signal) {
  console.log(`${signal} alındı; sunucu kapatılıyor...`);

  const closeDatabase = async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  };

  if (!server) {
    await closeDatabase();
    return;
  }

  server.close(async () => {
    try {
      await closeDatabase();
      console.log("HTTP ve MongoDB bağlantıları kapatıldı");
    } catch (error) {
      console.error("Kapatma sırasında hata oluştu:", error.message);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
