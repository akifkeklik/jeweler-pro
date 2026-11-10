const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Bulk precious-metal inventory pool per branch, metal and purity
 * (scrap / hurda, bullion bought from suppliers). Projection of the metal
 * StockMovements; never negative.
 */
const metalStockSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${businessId}|${branch}|${metal}|${purity}`
  businessId: { type: String, required: true, trim: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  metal: { type: String, required: true, enum: ['XAU', 'XAG'], immutable: true },
  purity: { type: Number, required: true, min: 1, max: 10000, validate: Number.isSafeInteger, immutable: true },
  weightMg: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  fineMg: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  costPoolMinor: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  // Reserved by approved inter-branch transfers (never more than on hand).
  reservedWeightMg: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  reservedFineMg: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  updatedAt: { type: Date, default: null },
}, { versionKey: false, collection: 'metal_stocks', strict: 'throw' });

metalStockSchema.index({ businessId: 1, branch: 1 });
metalStockSchema.statics.idFor = (businessId, branch, metal, purity) => `${businessId}|${branch}|${metal}|${purity}`;

metalStockSchema.plugin(tenantGuard, { compositeId: true });

module.exports = mongoose.model('MetalStock', metalStockSchema);
