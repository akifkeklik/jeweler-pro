const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
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
const Price = require("./models/prices");

// ==================================================
// ================ CRUD ENDPOINTLERI ===============
// ==================================================

// ==== Dashboard Özet Kartları ====
app.get("/api/summary", async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate("customerId", "name")
            .populate("productId", "name");

        const totalRevenue = sales.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
        const totalProfit = sales.reduce((sum, s) => sum + Math.round((s.totalPrice || 0) * 0.2), 0);
        const totalQuantity = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

        const uniqueCustomers = new Set(sales.map(s => s.customerId?._id?.toString()));
        const totalCustomers = uniqueCustomers.size;

        res.json({
            totalRevenue,
            totalProfit,
            totalQuantity,
            totalCustomers
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================================================
// ================== TEST SERVER ===================
// ==================================================
app.get("/", (req, res) => {
    res.send("Backend kuyumcu_pro_official veritabanı ile çalışıyor 🚀");
});

// -------------------- SUNUCU --------------------
app.listen(PORT, () => {
    console.log(`✅ Backend http://localhost:${PORT} adresinde çalışıyor`);
});


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
            date: new Date(s.date).toLocaleString("tr-TR"),
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
        let body = { ...req.body };

        if (body.date && typeof body.date === "string") {
            const [day, month, yearAndTime] = body.date.split(".");
            const [year, time] = yearAndTime.split(" ");
            body.date = new Date(`${year}-${month}-${day}T${time}:00`);
        }

        const newSale = new Sale(body);
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

// ===== PRICES (DB + TCMB) =====
app.get("/api/prices", async (req, res) => {
    try {
        const dovizFiyatlari = await getTcmbCurrencies();
        const prices = await Price.find();
        res.json({ dovizFiyatlari, fiyatlar: prices });
    } catch (err) {
        res.status(500).json({ error: "Fiyatlar alınamadı" });
    }
});
app.post("/api/prices", async (req, res) => {
    try {
        const newPrice = new Price(req.body);
        await newPrice.save();
        res.json(newPrice);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put("/api/prices/:id", async (req, res) => {
    try {
        const updated = await Price.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: "Fiyat bulunamadı" });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/prices/:id", async (req, res) => {
    try {
        const deleted = await Price.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Fiyat bulunamadı" });
        res.json({ message: "Fiyat silindi" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ---------------- REPORT ENDPOINTS ----------------
const moment = require("moment");

// === Günlük Rapor ===
// === Günlük Rapor ===
app.get("/api/reports/daily", async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate("productId", "name")
            .populate("customerId", "name");

        const today = moment().format("DD.MM.YYYY");

        const dailySales = sales.filter(s => {
            const saleDate = moment(s.date).format("DD.MM.YYYY");
            return saleDate === today;
        });

        res.json(dailySales.map(s => ({
            _id: s._id,
            productName: s.productId ? s.productId.name : null,
            customerName: s.customerId ? s.customerId.name : null,
            quantity: s.quantity,
            totalPrice: s.totalPrice,
            kar: Math.round(s.totalPrice * 0.2),
            date: moment(s.date).format("DD.MM.YYYY")
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Haftalık Rapor ===
app.get("/api/reports/weekly", async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate("productId", "name")
            .populate("customerId", "name");

        const startOfWeek = moment().startOf("week");
        const endOfWeek = moment().endOf("week");

        const weeklySales = sales.filter(s => {
            const saleDate = moment(s.date);
            return saleDate.isBetween(startOfWeek, endOfWeek, null, "[]");
        });

        res.json(weeklySales.map(s => ({
            _id: s._id,
            productName: s.productId ? s.productId.name : null,
            customerName: s.customerId ? s.customerId.name : null,
            quantity: s.quantity,
            totalPrice: s.totalPrice,
            kar: Math.round(s.totalPrice * 0.2),
            date: moment(s.date).format("DD.MM.YYYY")
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Aylık Rapor ===
app.get("/api/reports/monthly", async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate("productId", "name")
            .populate("customerId", "name");

        const startOfMonth = moment().startOf("month");
        const endOfMonth = moment().endOf("month");

        const monthlySales = sales.filter(s => {
            const saleDate = moment(s.date);
            return saleDate.isBetween(startOfMonth, endOfMonth, null, "[]");
        });

        res.json(monthlySales.map(s => ({
            _id: s._id,
            productName: s.productId ? s.productId.name : null,
            customerName: s.customerId ? s.customerId.name : null,
            quantity: s.quantity,
            totalPrice: s.totalPrice,
            kar: Math.round(s.totalPrice * 0.2),
            date: moment(s.date).format("DD.MM.YYYY")
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// En Çok Satılanlar (Bu Ay)
app.get("/api/reports/top-sellers", async (req, res) => {
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);

        const sales = await Sale.aggregate([
            { $match: { date: { $gte: start, $lte: now } } },
            {
                $group: {
                    _id: "$productName",
                    adet: { $sum: "$quantity" },
                    ciro: { $sum: "$totalPrice" },
                    kar: { $sum: { $multiply: ["$totalPrice", 0.2] } }
                }
            },
            { $sort: { adet: -1 } },
            { $limit: 10 }
        ]);

        const mapped = sales.map(s => ({
            urun: s._id,
            adet: s.adet,
            ciro: s.ciro,
            kar: s.kar
        }));

        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Az Kalan Stok
app.get("/api/reports/low-stock", async (req, res) => {
    try {
        const products = await Product.find({ stock: { $lte: 5 } });

        const mapped = products.map(p => ({
            isim: p.name,
            stok: p.stock
        }));

        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================================================
// ================= HELPER FONK. ===================
// ==================================================
async function getTcmbCurrencies() {
    try {
        const res = await axios.get("https://www.tcmb.gov.tr/kurlar/today.xml");
        const data = await xml2js.parseStringPromise(res.data);

        const codes = ["USD", "EUR", "GBP", "AUD"];
        return codes
            .map((code) => {
                const curr = data.Tarih_Date.Currency.find((c) => c.$.Kod === code);
                if (!curr) return null;
                return {
                    tur: `${code}/TL`,
                    alis: parseFloat(curr.ForexBuying[0]).toFixed(4),
                    satis: parseFloat(curr.ForexSelling[0]).toFixed(4),
                };
            })
            .filter((c) => c !== null);
    } catch (err) {
        console.error("TCMB verisi alınamadı:", err);
        return [];
    }
}

// ==================================================
// ================== TEST SERVER ===================
// ==================================================
app.get("/", (req, res) => {
    res.send("Backend kuyumcu_pro_official veritabanı ile çalışıyor 🚀");
});

// -------------------- SUNUCU --------------------
app.listen(PORT, () => {
    console.log(`✅ Backend http://localhost:${PORT} adresinde çalışıyor`);
});
