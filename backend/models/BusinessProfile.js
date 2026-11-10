const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Business profile (işletme profili): one document per business.
 *
 * Holds the legal identity printed on receipts/invoices and the
 * business-specific fiscal and compliance rules. It lives on the server so
 * every device of the business prints the same, audited data (it used to be
 * kept in each browser's localStorage).
 */
const businessProfileSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // = businessId
  businessId: { type: String, required: true, trim: true, immutable: true, unique: true },
  companyName: { type: String, trim: true, default: '', maxlength: 200 },
  authorizedPerson: { type: String, trim: true, default: '', maxlength: 120 },
  taxOffice: { type: String, trim: true, default: '', maxlength: 120 },
  taxNumber: { type: String, trim: true, default: '', maxlength: 11 },
  mersisNo: { type: String, trim: true, default: '', maxlength: 16 },
  phone: { type: String, trim: true, default: '', maxlength: 40 },
  email: { type: String, trim: true, default: '', maxlength: 254 },
  address: { type: String, trim: true, default: '', maxlength: 500 },
  receiptFooter: { type: String, trim: true, default: '', maxlength: 500 },
  vat: {
    // Off until the business's mali müşavir has confirmed the rules in domain/vat.js.
    enabled: { type: Boolean, default: false },
    standardRateBp: { type: Number, default: 2000, min: 0, max: 10000, validate: Number.isSafeInteger },
    approvedBy: { type: String, trim: true, default: '', maxlength: 120 },
    approvedAt: { type: Date, default: null },
  },
  compliance: {
    // MASAK customer identification threshold for a single transaction (kuruş).
    // null = not configured (no enforcement); set it with the compliance officer.
    identificationThresholdMinor: { type: Number, default: null, min: 0, validate: (v) => v === null || Number.isSafeInteger(v) },
    // Version of the KVKK notice (aydınlatma metni) shown to customers.
    kvkkNoticeVersion: { type: String, trim: true, default: '', maxlength: 40 },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

businessProfileSchema.plugin(tenantGuard);

module.exports = mongoose.model('BusinessProfile', businessProfileSchema);
