# 💍 Jeweler Pro

Modern kuyumcu yönetim sistemi. Müşteri, ürün, satış ve raporlama işlemlerini kolayca yönetmek için geliştirilmiştir.

🚀 Özellikler

👥 Müşteri Yönetimi (ekleme, düzenleme, listeleme)  

📦 Ürün Yönetimi (fiyat hesaplama, stok takibi)  

💰 Satış İşlemleri  

📊 Dashboard ile hızlı özetler  

📑 Raporlama ekranları  

⚙️ Ayarlar sayfası  

🔗 Veriler MongoDB veritabanından API aracılığıyla alınır  

---

🛠 Kullanılan Teknolojiler  

🎨 Frontend  

- Vue.js 3 – UI framework  
- Vue Router – Sayfa yönlendirme  
- Vuex – State management  
- Vuetify – UI component kütüphanesi  
- Chart.js – Grafikler ve raporlamalar için  
- Axios – API istekleri  

⚙️ Backend  

- Node.js – Çalışma ortamı  
- Express.js – RESTful API geliştirme  
- Mongoose – MongoDB ODM  
- Middleware: CORS, body-parser  

🗄️ Veritabanı  

- MongoDB – Verilerin saklandığı NoSQL veritabanı  

🔧 Diğer Araçlar  

- npm – Paket yönetimi  
- dotenv – Ortam değişkenleri  
- ESLint – Kod standartları  

---

⚙️ Kurulum  

1. Depoyu Klonla  
```bash
git clone https://github.com/akifkeklik/jeweler-pro.git
cd jeweler-pro
```

2. Backend Kurulumu  
```bash
cd backend
npm install
node server.js
```

📌 Backend varsayılan olarak **http://localhost:5000** adresinde çalışır.  

3. Frontend Kurulumu  
```bash
cd ../
npm install
npm run serve
```

📌 Frontend varsayılan olarak **http://localhost:8080** adresinde çalışır.  

---

🔑 Ortam Değişkenleri  

Backend için `backend/.env` dosyası oluşturun:  

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/jewelerpro
JWT_SECRET=supersecretkey
```

---

🗄️ Veritabanı Kullanımı  

- Tüm müşteri, ürün, satış ve rapor verileri MongoDB’de tutulur.  
- Backend, mongoose ile veritabanına bağlanır.  
- Frontend tarafı verileri REST API üzerinden çeker.  

📌 Örnek Veri Akışı:  
- Kullanıcı frontend’den ürün ekler  
- İstek backend API’sine gönderilir (`/api/products`)  
- Backend, veriyi MongoDB’ye kaydeder  
- Listeleme yapıldığında veriler doğrudan veritabanından okunur  

---

🤝 Katkıda Bulunma  

- Bu projeyi forklayın  
- Yeni bir branch açın (`git checkout -b feature/yenilik`)  
- Commit atın (`git commit -m 'Yeni özellik eklendi'`)  
- Push edin (`git push origin feature/yenilik`)  
- Pull Request açın  

---

📜 Lisans  

Tüm Hakları saklıdır.  
