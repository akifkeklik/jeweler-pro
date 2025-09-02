Jeweler Pro 💍

Modern kuyumcu yönetim sistemi. Müşteri, ürün, satış ve raporlama işlemlerini kolayca yönetmek için geliştirilmiştir.

🚀 Özellikler

Müşteri yönetimi (ekleme, düzenleme, listeleme)

Ürün yönetimi (fiyat hesaplama, stok takibi)

Satış işlemleri

Dashboard ile hızlı özetler

Raporlama ekranları

Ayarlar sayfası

Veriler tamamen MongoDB veritabanından gelir ve API aracılığıyla frontend’e iletilir.

📂 Proje Yapısı
.
├── backend/         # Node.js + Express backend
│   ├── models/      # MongoDB modelleri
│   ├── server.js    # Backend giriş noktası
│   ├── package.json # Backend bağımlılıkları
│
├── src/             # Vue.js frontend
│   ├── components/  # Vue bileşenleri
│   ├── layouts/     # Layout dosyaları
│   ├── pages/       # Sayfalar (Dashboard, Products, Reports, Settings, Sales, Customers)
│   ├── store/       # Vuex store
│   ├── router/      # Vue Router
│   ├── App.vue
│   └── main.js
│
└── README.md

⚙️ Kurulum
1. Depoyu Klonla
git clone https://github.com/akifkeklik/jeweler-pro.git
cd jeweler-pro

2. Backend Kurulumu
cd backend
npm install
npm start


📌 Backend varsayılan olarak http://localhost:5000 adresinde çalışır.

3. Frontend Kurulumu
cd ../
npm install
npm run serve


📌 Frontend varsayılan olarak http://localhost:8080 adresinde çalışır.

📦 Gereksinimler

Node.js 18+

npm 9+

MongoDB
