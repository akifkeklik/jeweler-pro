const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Immutable stock movement (stok hareketi). Every change to a product's
 * stock or to a metal pool is one document; balances (Product.stock,
 * MetalStock) are projections updated in the same transaction and can be
 * recomputed from these movements (inventory reconciliation).
 *
 * Signed deltas: positive = into stock, negative = out of stock.
 *   quantity  pieces (products)
 *   weightMg  gross weight in mg
 *   fineMg    fine metal content in mg (metal pools / gram items)
 *   costMinor change of the inventory cost pool in kuruş (null = unknown cost)
 */
const MOVEMENT_TYPES = [
  'opening', 'opening_migration', 'purchase', 'purchase_cancel',
  'sale', 'sale_cancel', 'sale_return',
  'adjustment', 'revaluation', 'scrap_purchase', 'transfer_in', 'transfer_out',
  'transfer_return', 'purchase_return',
  // Moves units booked to a wrong branch into the owning branch (stock ownership recovery).
  'ownership_reclass',
];

const stockMovementSchema = new mongoose.Schema({
  businessId: { type: String, required: true, trim: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  itemType: { type: String, required: true, enum: ['product', 'metal'], immutable: true },
  productId: { type: Number, ref: 'Product', default: undefined, immutable: true },
  metal: { type: String, enum: ['XAU', 'XAG', undefined], default: undefined, immutable: true },
  purity: { type: Number, default: undefined, immutable: true },
  movementType: { type: String, required: true, enum: MOVEMENT_TYPES, immutable: true },
  quantity: { type: Number, default: 0, validate: Number.isSafeInteger, immutable: true },
  weightMg: { type: Number, default: 0, validate: Number.isSafeInteger, immutable: true },
  fineMg: { type: Number, default: 0, validate: Number.isSafeInteger, immutable: true },
  costMinor: { type: Number, default: null, validate: (v) => v === null || Number.isSafeInteger(v), immutable: true },
  balanceAfter: { type: Number, default: undefined, immutable: true },
  reference: {
    kind: { type: String, trim: true },
    id: { type: String, trim: true },
  },
  reason: { type: String, trim: true, maxlength: 300, default: undefined, immutable: true },
  externalKey: { type: String, trim: true, default: undefined, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  correlationId: { type: String, trim: true, default: undefined, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  versionKey: false,
});

stockMovementSchema.index({ businessId: 1, productId: 1, createdAt: 1 });
stockMovementSchema.index({ businessId: 1, branch: 1, createdAt: -1 });
stockMovementSchema.index({ businessId: 1, itemType: 1, metal: 1, purity: 1, branch: 1 });
stockMovementSchema.index({ businessId: 1, 'reference.kind': 1, 'reference.id': 1 });
stockMovementSchema.index({ businessId: 1, externalKey: 1 }, { unique: true, partialFilterExpression: { externalKey: { $type: 'string' } } });

stockMovementSchema.plugin(tenantGuard);

module.exports = mongoose.model('StockMovement', stockMovementSchema);
module.exports.MOVEMENT_TYPES = MOVEMENT_TYPES;
