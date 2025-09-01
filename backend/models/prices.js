const mongoose = require("mongoose");

const priceSchema = new mongoose.Schema({
    tur: { type: String, required: true },   // Örn: Altın/ONS, USD/TL, Çeyrek
    alis: { type: Number, required: true },
    satis: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Price", priceSchema);
z