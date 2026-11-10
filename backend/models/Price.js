const mongoose = require("mongoose");

const PriceSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    buy: {
      type: Number,
      required: true,
      min: 0,
    },
    sell: {
      type: Number,
      required: true,
      min: 0,
    },
    last: {
      type: Number,
      min: 0,
    },
    currency: {
      type: String,
      default: "TRY",
      uppercase: true,
      trim: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    priceType: {
      type: String,
      enum: ["live", "indicative", "cached", "manual"],
      default: "live",
      index: true,
    },
    isStale: {
      type: Boolean,
      default: false,
      index: true,
    },
    sourceTimestamp: {
      type: Date,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
    changeRate: {
      type: Number,
      default: 0,
    },
    spread: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound index for querying recent prices per symbol
PriceSchema.index({ symbol: 1, createdAt: -1 });
PriceSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.models.Price || mongoose.model("Price", PriceSchema);

