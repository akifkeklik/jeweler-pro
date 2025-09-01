const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = 5000;

// -------------------- MIDDLEWARE --------------------
app.use(cors());
app.use(bodyParser.json());

// -------------------- MONGODB BAĞLANTISI --------------------
mongoose
    .connect("mongodb://127.0.0.1:27017/kuyumcu_pro_official", {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(() => console.log("✅ MongoDB kuyumcu_pro_official veritabanına bağlandı"))
    .catch((err) => console.error("❌ MongoDB bağlantı hatası:", err));

// -------------------- MODELLER --------------------
const Material = require("./models/Material");
const Category = require("./models/Category");
const Product = require("./models/Product");
const Customer = require("./models/Customer");
const Sale = require("./models/Sale");
const Setting = require("./models/Setting");

// -------------------- ENDPOINTLER --------------------

// ===== MATERIALS =====
app.get("/api/materials", async (req, res) => {
    try {
        res.json(await Material.find());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/materials", async (req, res) => {
    try {
        const newMaterial = new Material(req.body);
        await newMaterial.save();
        res.json(newMaterial);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/materials/:id", async (req, res) => {
    try {
        const updated = await Material.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Hammadde bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/materials/:id", async (req, res) => {
    try {
        const deleted = await Material.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Hammadde bulunamadı" });
        res.json({ message: "Hammadde silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CATEGORIES =====
app.get("/api/categories", async (req, res) => {
    try {
        res.json(await Category.find());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/categories", async (req, res) => {
    try {
        const newCategory = new Category(req.body);
        await newCategory.save();
        res.json(newCategory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/categories/:id", async (req, res) => {
    try {
        const updated = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Kategori bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/categories/:id", async (req, res) => {
    try {
        const deleted = await Category.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Kategori bulunamadı" });
        res.json({ message: "Kategori silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== PRODUCTS =====
app.get("/api/products", async (req, res) => {
    try {
        const products = await Product.find().populate("categoryId").populate("materialId");
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/products", async (req, res) => {
    try {
        const newProduct = new Product(req.body);
        await newProduct.save();
        res.json(newProduct);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/products/:id", async (req, res) => {
    try {
        const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Ürün bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/products/:id", async (req, res) => {
    try {
        const deleted = await Product.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Ürün bulunamadı" });
        res.json({ message: "Ürün silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CUSTOMERS =====
app.get("/api/customers", async (req, res) => {
    try {
        res.json(await Customer.find());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/customers", async (req, res) => {
    try {
        const newCustomer = new Customer(req.body);
        await newCustomer.save();
        res.json(newCustomer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/customers/:id", async (req, res) => {
    try {
        const updated = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Müşteri bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/customers/:id", async (req, res) => {
    try {
        const deleted = await Customer.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Müşteri bulunamadı" });
        res.json({ message: "Müşteri silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== SALES =====
app.get("/api/sales", async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate("customerId", "name")
            .populate("productId", "name");

        const mapped = sales.map((s) => ({
            _id: s._id,
            customerName: s.customerId ? s.customerId.name : null,
            productName: s.productId ? s.productId.name : null,
            quantity: s.quantity,
            totalPrice: s.totalPrice,
            paymentMethod: s.paymentMethod,
            date: s.date,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        }));

        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/sales", async (req, res) => {
    try {
        const newSale = new Sale(req.body);
        await newSale.save();
        res.json(newSale);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/sales/:id", async (req, res) => {
    try {
        const updated = await Sale.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Satış bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/sales/:id", async (req, res) => {
    try {
        const deleted = await Sale.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Satış bulunamadı" });
        res.json({ message: "Satış silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ===== PRICES =====

app.get("/api/prices", async (req, res) => {
    try {
        // TCMB’den XML verisini al
        const tcmbRes = await axios.get("https://www.tcmb.gov.tr/kurlar/today.xml");
        const tcmbData = await xml2js.parseStringPromise(tcmbRes.data);

        // Fonksiyon: İstenen döviz kurunu bul
        const getRate = (code) => {
            const curr = tcmbData.Tarih_Date.Currency.find(c => c.$.Kod === code);
            if (!curr) return null;
            return {
                tur: `${code}/TL`,
                alis: parseFloat(curr.ForexBuying[0]).toFixed(4),
                satis: parseFloat(curr.ForexSelling[0]).toFixed(4),
            };
        };

        // Dövizler
        const dovizFiyatlari = [
            getRate("USD"),
            getRate("EUR"),
            getRate("GBP"),
            getRate("AUD"),
        ].filter(item => item !== null);

        // JSON çıktısı
        res.json({ dovizFiyatlari });

    } catch (err) {
        console.error("Prices API hata:", err.message);
        res.status(500).json({ error: "Fiyatlar alınamadı" });
    }
});

// -------------------- TEST --------------------
app.get("/", (req, res) => {
    res.send("Backend kuyumcu_pro_official veritabanı ile çalışıyor 🚀");
});

// -------------------- SUNUCU --------------------
app.listen(PORT, () => {
    console.log(`✅ Backend http://localhost:${PORT} adresinde çalışıyor`);
});
