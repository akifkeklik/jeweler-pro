/**
 * 💍 Jeweler Pro - Backend Server
 * Clean Code Architecture with Modular Routes & Middleware
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

// Middleware imports
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const materialsRouter = require('./routes/materials');
const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const customersRouter = require('./routes/customers');
const salesRouter = require('./routes/sales');
const dashboardRouter = require('./routes/dashboard');
const reportsRouter = require('./routes/reports');
const pricesRouter = require('./routes/prices');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/kuyumcu_pro_official';

// ============================================
// ============= MIDDLEWARE SETUP =============
// ============================================

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8080', 'http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Request logging
app.use(requestLogger);

// ============================================
// ========== DATABASE CONNECTION =============
// ============================================

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ MongoDB veritabanına bağlandı'))
  .catch((err) => {
    console.error('❌ MongoDB bağlantı hatası:', err.message);
    process.exit(1);
  });

// ============================================
// =========== ROUTE REGISTRATION =============
// ============================================

// API Routes
app.use('/api/materials', materialsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/sales', salesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/prices', pricesRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Jeweler Pro API',
    version: '1.0.0',
    status: 'Running',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ============================================
// ========== 404 ERROR HANDLING ==============
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint bulunamadı',
    path: req.path,
    method: req.method,
  });
});

// ============================================
// ========== GLOBAL ERROR HANDLER ============
// ============================================

app.use(errorHandler);

// ============================================
// ============= SERVER STARTUP ===============
// ============================================

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                 💍 Jeweler Pro API                  ║
║                  Clean Code Edition                 ║
╚══════════════════════════════════════════════════════╝

✅ Server başlatıldı: http://localhost:${PORT}
🗄️  Database: ${MONGO_URI.split('/').pop()}
🌍 Environment: ${process.env.NODE_ENV || 'development'}

📡 Endpoints:
   • GET/POST   /api/materials     - Hammaddeler
   • GET/POST   /api/categories    - Kategoriler
   • GET/POST   /api/products      - Ürünler
   • GET/POST   /api/customers     - Müşteriler
   • GET/POST   /api/sales         - Satışlar
   • GET/POST   /api/prices        - Fiyatlar & Döviz
   • GET        /api/dashboard     - Dashboard İstatistikleri
   • GET        /api/reports       - Raporlar

🛑 Sunucuyu durdurmak için: CTRL+C
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM alındı, sunucu kapatılıyor...');
  server.close(() => {
    console.log('Sunucu kapatıldı');
    mongoose.connection.close(false, () => {
      console.log('MongoDB bağlantısı kapatıldı');
      process.exit(0);
    });
  });
});

module.exports = app;
