# 💍 Jeweler Pro

Modern kuyumcu yönetim sistemi: müşteri, ürün, satış ve raporlama süreçlerini tek bir arayüzden yönetmenizi sağlar.

**Öne Çıkanlar**
- **Müşteri Yönetimi:** ekleme, düzenleme, listeleme
- **Ürün Yönetimi:** fiyat hesaplama, stok takibi
- **Satış İşlemleri:** satış kayıtları ve özetler
- **Dashboard:** anlık istatistik ve grafikler
- **Raporlar:** günlük, haftalık, aylık raporlar

---

## Teknolojiler
- **Frontend:** Vue 2, Vue Router 3, Vuex 3, TypeScript (class-based), Vuetify 2, Chart.js, Axios
- **Backend:** Node.js, Express 5, Mongoose 8, CORS, body-parser
- **Veritabanı:** MongoDB

Not: Proje Vue 2 tabanlıdır (paketlerde `vue@^2.6.14` kullanılıyor).

---

## Dizin Yapısı
- [src/](src) — Uygulama kaynak kodu (Vue bileşenleri, sayfalar, store, router)
- [backend/](backend) — Express API ve Mongoose modelleri
- [public/](public) — Statik dosyalar (ör. Prices.json)
- [package.json](package.json) — Frontend bağımlılık ve scriptleri
- [backend/server.js](backend/server.js) — API sunucusu başlangıç dosyası

---

## Kurulum
1) Depoyu klonlayın
```bash
git clone https://github.com/akifkeklik/jeweler-pro.git
cd jeweler-pro
```

2) Backend bağımlılıkları
```bash
cd backend
npm install
```

3) Frontend bağımlılıkları
```bash
cd ..

```

---

## Geliştirme ve Çalıştırma
İki ayrı terminal kullanın:

- Backend (varsayılan: http://localhost:5000)
```bash
node backend/server.js
```

- Frontend (varsayılan: http://localhost:8080)
```bash
npm run serve
```

Frontend, API istekleri için backend taban URL’sine bağlanır.

---

## Konfigürasyon
- **MongoDB bağlantısı:** `backend/server.js` içinde varsayılan olarak `mongodb://127.0.0.1:27017/kuyumcu_pro_official` kullanılır.
- **Port:** Backend `5000` portunda çalışır; frontend Vue CLI varsayılanı `8080`.

İhtiyaç halinde bu değerleri `backend/server.js` içerisinden güncelleyebilirsiniz.

---

## API Kısa Liste
- `GET /api/summary` — Dashboard özet kartları
- `CRUD /api/materials` — Hammadde
- `CRUD /api/categories` — Kategori
- `CRUD /api/products` — Ürün
- `CRUD /api/customers` — Müşteri
- `CRUD /api/sales` — Satış
- `GET /api/prices` — Döviz ve fiyatlar (TCMB + DB)
- `GET /api/reports/daily|weekly|monthly` — Raporlar

Detaylar için [backend/server.js](backend/server.js) dosyasına göz atabilirsiniz.

---

## Veri ve Dosyalar
- [public/Prices.json](public/Prices.json) — Fiyatlarla ilgili statik JSON dosyası
- Dashboard bileşenleri: [src/components/dashboard/](src/components/dashboard) — Kur, altın ve fiyat grafikleri

---

## Katkıda Bulunma
- Fork oluşturun ve yeni bir branch açın (`feature/xyz`)
- Değişiklikleri commit edin ve push’layın
- Pull Request açarak açıklayın

---

## Lisans
Tüm Hakları Saklıdır.
🤝 Katkıda Bulunma  
