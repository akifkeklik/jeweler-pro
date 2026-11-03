const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    weight: { type: Number, min: 0 },
    unit: String,
    price: { type: Number, min: 0 },
    currency: { type: String, default: "TRY" },
    barcode: String,
    description: String,
    categoryId: { type: Number, ref: "Category" },
    materialId: { type: Number, ref: "Material" },
    stock: { type: Number, default: 0, min: 0 }
}, { timestamps: true, _id: false });

function generate6DigitId() {
    return Math.floor(100000 + Math.random() * 900000);
}

// Mongoose validates documents before running pre-save hooks.
// Generate the required ID during validation so new products can be saved.
productSchema.pre("validate", async function () {
    if (!this.isNew || this._id != null) return;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = generate6DigitId();
        const exists = await mongoose.models.Product.exists({ _id: candidate });
        if (!exists) {
            this._id = candidate;
            return;
        }
    }

    throw new Error("Could not allocate a unique product ID after 10 attempts");
});

module.exports = mongoose.model("Product", productSchema);
