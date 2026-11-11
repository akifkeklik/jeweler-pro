/**
 * Jeweler Pro API server.
 * The HTTP server starts only after MongoDB has connected successfully.
 */
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");
const { authenticate } = require("./middleware/auth");
const { requireSameBusiness } = require("./middleware/authorization");
const { createApiRateLimit } = require("./middleware/apiRateLimit");
const authRouter = require("./routes/auth");
const usersRouter = require("./routes/users");
const bootstrapAdmin = require("./scripts/bootstrapAdmin");
const migrateAuthData = require("./scripts/migrateAuthData");
const migrateFinancialData = require("./scripts/migrateFinancialData");
const { planFinancialMigration } = require("./scripts/migrationPlan");
const emailService = require("./services/emailService");
const bootstrapPrices = require("./scripts/bootstrapPrices");
const bootstrapCatalog = require("./scripts/bootstrapCatalog");
const marketDataWorker = require("./services/marketDataWorker");
const { validateRuntimeConfig, parseTrustProxy } = require("./config/runtimeConfig");
const { resolveEnvironment, canonicalizeProcessEnvironment } = require("./config/environment");
const { corsOriginCallback } = require("./config/origins");
const { verifyTransactionSupport, redactConnectionString } = require("./config/databaseCapabilities");

const materialsRouter = require("./routes/materials");
const categoriesRouter = require("./routes/categories");
const productsRouter = require("./routes/products");
const customersRouter = require("./routes/customers");
const salesRouter = require("./routes/sales");
const dashboardRouter = require("./routes/dashboard");
const reportsRouter = require("./routes/reports");
const pricesRouter = require("./routes/prices");
const auditRouter = require("./routes/audit");
const cashRouter = require("./routes/cash");
const suppliersRouter = require("./routes/suppliers");
const purchasesRouter = require("./routes/purchases");
const inventoryRouter = require("./routes/inventory");
const ledgerRouter = require("./routes/ledger");
const transfersRouter = require("./routes/transfers");
const branchesRouter = require("./routes/branches");
const posRouter = require("./routes/pos");
const businessProfileRouter = require("./routes/businessProfile");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/kuyumcu_pro_official?replicaSet=rs0";
// Read lazily so start-up always uses the validated, current environment.
const mongoUri = () => process.env.MONGO_URI || DEFAULT_MONGO_URI;

app.disable("x-powered-by");
// Express derives error-page verbosity from its "env" setting; give it the
// canonical value (" Production " → "production", unsupported → strict).
app.set("env", resolveEnvironment().strict ? "production" : resolveEnvironment().name);
// Never `true` (trust every hop): see config/runtimeConfig.js parseTrustProxy().
const trustProxySetting = parseTrustProxy(process.env.TRUST_PROXY);
app.set("trust proxy", trustProxySetting.error ? false : trustProxySetting.value);
// Security headers via helmet. This is a JSON API: nothing may be framed,
// embedded or executed from its responses.
app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "same-site" },
  // HSTS only matters behind TLS; the reverse proxy may also set it.
  strictTransportSecurity: resolveEnvironment().strict ? { maxAge: 15552000, includeSubDomains: true } : false,
}));
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({
  // Canonical origin comparison shared with the CSRF guards (config/origins.js).
  origin: corsOriginCallback,
  credentials: true,
  optionsSuccessStatus: 200,
}));

// Keep request bodies bounded to reduce memory-exhaustion risk. The API
// only accepts JSON; 1 MB is far above any legitimate payload.
const BODY_LIMIT = /^\d+(kb|mb)$/i.test(String(process.env.BODY_LIMIT || "")) ? process.env.BODY_LIMIT : "1mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(cookieParser());
app.use(requestLogger);

// Outer bound for every API request (targeted limiters still apply inside).
app.use("/api", createApiRateLimit());
app.use("/api/auth", authRouter);
app.use("/api", authenticate);
// Requests that explicitly target another business (header, body or query)
// are refused before any route runs; queries are tenant-scoped regardless.
app.use("/api", requireSameBusiness);
app.use("/api/users", usersRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/sales", salesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/audit", auditRouter);
app.use("/api/cash", cashRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/ledger", ledgerRouter);
app.use("/api/transfers", transfersRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/pos", posRouter);
app.use("/api/business-profile", businessProfileRouter);

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
    environment: resolveEnvironment().name,
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint bulunamadı",
    code: "ENDPOINT_NOT_FOUND",
    path: req.path,
    method: req.method,
  });
});

app.use(errorHandler);

let server;

/**
 * Refuses to start on an unsafe/incomplete configuration (hard errors in
 * production, JWT_SECRET everywhere). Returns true when start-up may proceed.
 */
function checkRuntimeConfig(env = process.env, logger = console) {
  const result = validateRuntimeConfig(env);
  for (const warning of result.warnings) logger.warn(`[config] UYARI: ${warning}`);
  if (result.errors.length) {
    logger.error(`[config] Güvensiz veya eksik yapılandırma (${result.environment}); sunucu başlatılmadı:`);
    for (const error of result.errors) logger.error(`  - ${error}`);
    return { ok: false, ...result };
  }
  app.set("trust proxy", result.trustProxy);
  // One canonical NODE_ENV for every module and dependency from here on.
  canonicalizeProcessEnvironment();
  app.set("env", result.environment);
  return { ok: true, ...result };
}

/**
 * Production never migrates financial data implicitly: start-up only runs a
 * read-only dry run and refuses to start while work is pending, unless
 * MIGRATION_AUTO_APPLY=true. Apply with `node scripts/migrate.js --apply
 * --confirm-backup` after taking a backup (OPERATIONS.md). Other
 * environments keep migrating automatically (idempotent).
 */
async function runStartupMigration(config, env = process.env, logger = console) {
  if (config.production && env.MIGRATION_AUTO_APPLY !== "true") {
    const plan = await planFinancialMigration();
    if (plan.pending || plan.blocking) {
      logger.error(`[migrate] Bekleyen finansal veri aktarımı var: ${JSON.stringify({ tenancy: plan.tenancy, products: plan.products, customers: plan.customers, issues: plan.issues.map((i) => `${i.type}:${i.count}`) })}`);
      const error = new Error("Bekleyen veri aktarımı var; yedek alıp `node scripts/migrate.js --apply --confirm-backup` çalıştırın");
      error.name = "MigrationPendingError";
      throw error;
    }
    return { applied: false, plan };
  }
  return { applied: true, report: await migrateFinancialData() };
}

async function startServer() {
  const config = checkRuntimeConfig();
  if (!config.ok) {
    process.exitCode = 1;
    return null;
  }
  const uri = mongoUri();
  try {
    await mongoose.connect(uri);
    // Security invariants depend on transactions: refuse production start-up
    // on a deployment that cannot provide them (dev/test: warning only).
    await verifyTransactionSupport(mongoose.connection, { required: config.production });
    await migrateAuthData();
    await runStartupMigration(config);
    await bootstrapAdmin();
    await bootstrapPrices();
    await bootstrapCatalog();
    console.log("MongoDB veritabanına bağlandı");

    marketDataWorker.start();

    server = app.listen(PORT, () => {
      console.log(`Jeweler Pro API listening on port ${PORT}`);
    });

    return server;
  } catch (error) {
    const reason = error?.name === "TransactionSupportError"
      ? "MongoDB üretim gereksinimlerini karşılamıyor"
      : error?.name === "MigrationPendingError"
        ? "Üretimde veri aktarımı otomatik uygulanmaz"
        : error?.name === "MigrationBlockedError"
          ? "Veri aktarımı yinelenen kayıtlar nedeniyle engellendi (hiçbir veri değiştirilmedi)"
          : "MongoDB bağlantısı veya başlangıç adımları başarısız oldu";
    console.error(`${reason}; HTTP sunucusu başlatılmadı:`, redactConnectionString(error?.message, uri));
    process.exitCode = 1;
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    return null;
  }
}

async function shutdown(signal) {
  console.log(`${signal} alındı; sunucu kapatılıyor...`);
  marketDataWorker.stop();

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
      // Let in-flight password-reset e-mails finish (and clean up on failure).
      await emailService.flushPendingDeliveries();
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
module.exports.checkRuntimeConfig = checkRuntimeConfig;
module.exports.runStartupMigration = runStartupMigration;
