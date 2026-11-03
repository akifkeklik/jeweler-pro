const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
    {
        _id: { type: Number, required: true },
        customerId: { type: Number, ref: "Customer", required: true },
        productId: { type: Number, ref: "Product", required: true },
        quantity: { type: Number, default: 1, min: 1 },
        totalPrice: { type: Number, required: true, min: 0 },
        paymentMethod: {
            type: String,
            enum: ["nakit", "kredi kartı", "havale"],
            default: "nakit",
        },
        date: { type: Date, required: true, default: Date.now },
    },
    { timestamps: true, _id: false }
);

function generate8DigitId() {
    return Math.floor(10000000 + Math.random() * 90000000);
}

// Validation runs before pre-save middleware, so assign the required ID here.
saleSchema.pre("validate", async function () {
    if (!this.isNew || this._id != null) return;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = generate8DigitId();
        const exists = await mongoose.models.Sale.exists({ _id: candidate });
        if (!exists) {
            this._id = candidate;
            return;
        }
    }

    throw new Error("Could not allocate a unique sale ID after 10 attempts");
});

module.exports = mongoose.model("Sale", saleSchema);
