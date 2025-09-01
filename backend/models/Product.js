const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    name: { type: String, required: true },
    weight: Number,
    unit: String,
    price: Number,
    currency: { type: String, default: "TRY" },
    barcode: String,
    description: String,
    categoryId: { type: Number, ref: "Category" },
    materialId: { type: Number, ref: "Material" },
    stock: { type: Number, default: 0 }
}, { timestamps: true, _id: false });

// 6 haneli ID üretici
function generate6DigitId() {
    return Math.floor(100000 + Math.random() * 900000);
}

productSchema.pre("save", async function (next) {
    if (!this._id) {
        let newId;
        let exists = true;
        while (exists) {
            newId = generate6DigitId();
            exists = await mongoose.models.Product.exists({ _id: newId });
        }
        this._id = newId;
    }
    next();
});

module.exports = mongoose.model("Product", productSchema);
