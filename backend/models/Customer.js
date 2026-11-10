const mongoose = require("mongoose");
const tenantGuard = require("./plugins/tenantGuard");
const { isValidIdentityNumber, IDENTITY_TYPES } = require("../utils/identity");

// Document saves only (update validators run in query context and cannot see
// identityType; routes/customers.js validates those explicitly).
const identityNumberValid = function identityNumberValid(value) {
    if (value === undefined || value === null || value === "") return true;
    if (this instanceof mongoose.Query) return true;
    return isValidIdentityNumber(this.identityType, value);
};

/**
 * Customer (cari hesap), tenant scoped.
 *
 * Balances are projections of the customer's receivable ledger accounts and
 * are written ONLY by the ledger service, in the same transaction as the
 * journal entry. Sign convention (kept from earlier versions):
 *   balanceTry  > 0  the business owes the customer (customer credit)
 *   balanceTry  < 0  the customer owes the business (debt)
 * Exact values: balanceTryMinor (kuruş) and balanceGoldMg (mg fine gold);
 * balanceTry / balanceGold are the same values in TRY / grams for display.
 */
const customerSchema = new mongoose.Schema({
    _id: { type: Number, required: true },
    businessId: { type: String, required: true, trim: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    email: String,
    address: String,
    customerType: { type: String, enum: ["bireysel", "kurumsal"], default: "bireysel" },
    balanceTry: { type: Number, default: 0 },
    balanceGold: { type: Number, default: 0 },
    balanceTryMinor: { type: Number, default: 0, validate: Number.isSafeInteger },
    balanceGoldMg: { type: Number, default: 0, validate: Number.isSafeInteger },
    // Maximum debt (TRY). 0 = no limit configured (see BUSINESS_RULES.md).
    creditLimit: { type: Number, default: 0, min: 0 },
    taxNumber: { type: String, trim: true },
    taxOffice: { type: String, trim: true },
    // Identification (MASAK kimlik tespiti). Never returned in list views
    // unmasked (routes/customers.js); only set when the customer presents
    // an identity document.
    identityType: { type: String, enum: [...IDENTITY_TYPES, null], default: null },
    identityNumber: { type: String, trim: true, default: null, validate: { validator: identityNumberValid, message: "Kimlik numarası geçersiz" } },
    identityVerifiedAt: { type: Date, default: null },
    // KVKK: which notice version the customer was informed with, and when.
    kvkkNoticeVersion: { type: String, trim: true, default: null, maxlength: 40 },
    kvkkNoticeAt: { type: Date, default: null },
    marketingConsent: { type: Boolean, default: false },
    anonymizedAt: { type: Date, default: null },
    notes: { type: String },
    isArchived: { type: Boolean, default: false, index: true }
}, { timestamps: true, _id: false });

function generateId() {
    return Math.floor(10000000 + Math.random() * 90000000);
}

// Mongoose validation runs before pre-save middleware; assign the required
// numeric ID in pre-validate so a new document passes required-field checks.
customerSchema.pre("validate", async function () {
    if (!this.isNew || this._id != null) return;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = generateId();
        const exists = await mongoose.models.Customer.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' });
        if (!exists) {
            this._id = candidate;
            return;
        }
    }

    throw new Error("Could not allocate a unique customer ID after 10 attempts");
});

customerSchema.plugin(tenantGuard);

module.exports = mongoose.model("Customer", customerSchema);
