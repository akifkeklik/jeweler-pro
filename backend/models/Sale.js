const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
    {
        _id: { type: Number, required: true }, // 8 haneli ID

        // Müşteri ve Ürün Number olacak!
        customerId: { type: Number, ref: "Customer", required: true },
        productId: { type: Number, ref: "Product", required: true },

        quantity: { type: Number, default: 1 },
        totalPrice: { type: Number, required: true },
        paymentMethod: {
            type: String,
            enum: ["nakit", "kredi kartı", "havale"],
            default: "nakit",
        },
        date: { type: Date, default: Date.now },
    },
    { timestamps: true, _id: false }
);

// 🔹 8 haneli ID üretici
function generate8DigitId() {
    return Math.floor(10000000 + Math.random() * 90000000);
}

saleSchema.pre("save", async function (next) {
    if (!this._id) {
        let newId;
        let exists = true;
        while (exists) {
            newId = generate8DigitId();
            exists = await mongoose.models.Sale.exists({ _id: newId });
        }
        this._id = newId;
    }
    next();
});

module.exports = mongoose.model("Sale", saleSchema);
