const mongoose = require("mongoose");

const PriceSchema = new mongoose.Schema({
    type: { type: String, required: true },   // örn: "Altın", "USD"
    buy: { type: Number, required: true },    // alış fiyatı
    sell: { type: Number, required: true },   // satış fiyatı
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Price", PriceSchema);
