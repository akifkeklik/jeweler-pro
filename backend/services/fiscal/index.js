/**
 * Fiscal document providers (e-Arşiv fatura / e-Fatura / ÖKC).
 *
 * Jeweler Pro does NOT issue legal tax documents itself. In Turkey they are
 * issued through a GİB-authorised private integrator (özel entegratör) or a
 * new-generation cash register (yeni nesil ÖKC). This module is the seam
 * where such a provider is plugged in; see docs/FISCAL_INTEGRATION.md.
 *
 * A provider implements:
 *   name                      string, e.g. 'manual', '<integrator>'
 *   issue(document) → Promise<{ status, documentNo?, documentUrl?, issuedAt?, message? }>
 *       status: 'issued' | 'not_issued' | 'failed'
 *   cancel(documentNo, reason) → Promise<{ status, message? }>
 *
 * `document` is built by buildFiscalDocument(): seller, buyer, lines with
 * KDV breakdown, totals — everything an integrator API needs, in kuruş.
 */
const { maskNationalId } = require('../../utils/identity');

/** Default provider: records that the legal document is issued outside the app. */
const manualProvider = Object.freeze({
  name: 'manual',
  async issue() {
    return { status: 'not_issued', message: 'Yasal belge (e-Arşiv / ÖKC fişi) uygulama dışında düzenlenir.' };
  },
  async cancel() {
    return { status: 'not_issued', message: 'Yasal belge uygulama dışında iptal edilir.' };
  },
});

const providers = new Map([[manualProvider.name, manualProvider]]);

/** Registers an integrator adapter (called once at start-up by its module). */
function registerProvider(provider) {
  for (const key of ['name', 'issue', 'cancel']) {
    if (!provider || !provider[key]) throw new TypeError(`Fiscal provider eksik alan: ${key}`);
  }
  providers.set(provider.name, provider);
}

/** FISCAL_PROVIDER selects the adapter; unknown names fail loudly at start-up. */
function getProvider(name = process.env.FISCAL_PROVIDER || 'manual') {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Tanımsız FISCAL_PROVIDER: ${name}`);
  return provider;
}

/**
 * Provider-neutral document of a sale (VAT-inclusive retail sale).
 * Amounts are integers in kuruş; the buyer id is passed through in full
 * because the integrator legally needs it, and masked in `display`.
 */
function buildFiscalDocument({ sale, profile, customer }) {
  const lines = (sale.lines || []).map((l) => ({
    name: l.productName,
    quantity: l.quantity,
    totalMinor: l.totalMinor,
    vatClass: l.vat?.vatClass || null,
    vatRateBp: l.vat?.rateBp ?? null,
    vatMinor: l.vat?.vatMinor ?? null,
    taxableGrossMinor: l.vat?.taxableGrossMinor ?? null,
  }));
  return {
    type: 'retail_sale',
    reference: { kind: 'Sale', id: String(sale._id) },
    issuedFor: sale.date,
    seller: {
      name: profile.companyName,
      taxOffice: profile.taxOffice,
      taxNumber: profile.taxNumber,
      address: profile.address,
      mersisNo: profile.mersisNo || undefined,
    },
    buyer: {
      name: customer?.name || sale.identification?.customerName || null,
      taxNumber: customer?.taxNumber || null,
      identityType: customer?.identityType || null,
      identityNumber: customer?.identityNumber || null,
      display: customer?.identityNumber ? maskNationalId(customer.identityNumber) : null,
    },
    lines,
    totals: {
      totalMinor: sale.totalMinor,
      discountMinor: sale.discountMinor || 0,
      vatMinor: sale.vatMinor ?? null,
    },
    currency: 'TRY',
  };
}

module.exports = { registerProvider, getProvider, buildFiscalDocument, manualProvider };
