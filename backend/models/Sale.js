const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
  {
    _id: { type: Number, required: true },
    customerId: { type: Number, ref: "Customer", required: true },
    productId: { type: Number, ref: "Product", required: true },
    quantity: { type: Number, default: 1, min: 1, validate: Number.isSafeInteger },
    totalPrice: { type: Number, required: true, min: 0 },
    unitPriceAtSale: { type: Number, min: 0 },
    // Null means the cost was not captured; historical profit must not be guessed.
    unitCostAtSale: { type: Number, min: 0, default: null },
    status: { type: String, enum: ["completed", "cancelled"], default: "completed", index: true },
    cancelledAt: { type: Date, default: null },
    paymentMethod: {
      type: String,
      enum: ["nakit", "kredi kartı", "havale"],
      default: "nakit",
    },
    date: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, _id: false }
);

saleSchema.index({ date: -1, status: 1 });
saleSchema.index({ productId: 1, date: -1 });

function generate8DigitId() {
  return Math.floor(10000000 + Math.random() * 90000000);
}

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
