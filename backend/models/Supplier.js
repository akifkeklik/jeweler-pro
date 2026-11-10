const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Supplier (tedarikçi) master data, tenant scoped.
 * balanceTryMinor is a projection of the supplier's payable ledger account:
 * positive = we owe the supplier. It is never written directly by clients.
 */
const supplierSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  phone: { type: String, trim: true, maxlength: 40 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  address: { type: String, trim: true, maxlength: 400 },
  taxNumber: { type: String, trim: true, maxlength: 20 },
  taxOffice: { type: String, trim: true, maxlength: 120 },
  notes: { type: String, trim: true, maxlength: 1000 },
  balanceTryMinor: { type: Number, default: 0, validate: Number.isSafeInteger },
  isArchived: { type: Boolean, default: false, index: true },
}, { timestamps: true, _id: false });

supplierSchema.index({ businessId: 1, name: 1 });

supplierSchema.pre('validate', async function assignId() {
  if (!this.isNew || this._id != null) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = Math.floor(10000000 + Math.random() * 90000000);
    if (!(await mongoose.models.Supplier.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' }))) {
      this._id = candidate;
      return;
    }
  }
  throw new Error('Could not allocate a unique supplier ID after 10 attempts');
});

supplierSchema.plugin(tenantGuard);

module.exports = mongoose.model('Supplier', supplierSchema);
