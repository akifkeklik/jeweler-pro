# Jeweler Pro

Kuyumcu işletmeleri için hızlı, sade ve güvenilir yönetim.

## Öz

Müşteri, ürün, satış ve raporları tek ekrandan yönet; stok ve fiyatları takip et; günlük/aylık performansı gör.

## Hızlı Başlangıç

```bat
:: Backend (Windows CMD)
cd backend
npm install
copy .env.example .env
npm run dev

:: Frontend (Windows CMD)
cd ..
npm install
copy .env.example .env
npm run serve
```

macOS/Linux için:

```bash
# Backend
cd backend
npm install
cp .env.example .env
npm run dev

# Frontend
cd ..
npm install
cp .env.example .env
npm run serve
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:5000/api

## Ortam Değişkenleri

Backend (`backend/.env`):

```env
MONGO_URI=mongodb://127.0.0.1:27017/kuyumcu_pro_official
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:8080
```

Frontend (`.env`):

```env
VUE_APP_API_URL=http://localhost:5000/api
VUE_APP_API_TIMEOUT=30000
VUE_APP_ENV=development
```

## Özellikler

- Müşteri, Ürün, Satış CRUD
- Stok ve fiyat takibi
- Dashboard özetleri
- Günlük/Aylık raporlar
- TCMB döviz kurları entegrasyonu

## Teknolojiler

Vue 2, Vuex, TypeScript, Vuetify • Node.js, Express, Mongoose • MongoDB

---

Kullanımı kolay, performansı hızlı. Sorunuz olursa yazın; birlikte çözeriz.
