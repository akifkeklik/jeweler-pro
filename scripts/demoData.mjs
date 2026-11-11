/**
 * Realistic demo data for a fresh business: profile, gram-priced and fixed
 * price products, customers, a POS provider and a handful of sales (one on
 * account). Used by `npm run demo` and `npm run screenshots`. No real
 * customer data.
 *
 * `api(method, path, body)` must call the API as the business admin.
 */
export const DEMO_BRANCH = 'Kapalıçarşı';
export const DEMO_HAS_PRICE = '3250.00'; // has-gold price per gram (manual: no live feed needed)

export async function seedDemoData(api, { branch = DEMO_BRANCH, hasPrice = DEMO_HAS_PRICE } = {}) {
  await api('PUT', '/api/business-profile', {
    companyName: 'Demo Kuyumculuk Ltd. Şti.', authorizedPerson: 'Demo Yönetici', taxOffice: 'Fatih', taxNumber: '1234567890',
    phone: '0212 000 00 00', email: 'info@demo.test', address: 'Kapalıçarşı, Fatih / İstanbul', receiptFooter: 'Bizi tercih ettiğiniz için teşekkür ederiz.',
  });
  const product = (body) => api('POST', '/api/products', { branch, ...body });
  const bilezik = await product({ name: '22 Ayar Burma Bilezik', pricingMode: 'gram', metal: 'XAU', karat: 22, weight: '10.000', laborType: 'milyem', laborValue: '35', costPrice: '30500.00', stock: 8, barcode: '8690000000011' });
  const kolye = await product({ name: '14 Ayar Zincir Kolye', pricingMode: 'gram', metal: 'XAU', karat: 14, weight: '6.500', laborType: 'per_gram', laborValue: '250.00', costPrice: '12800.00', stock: 5, barcode: '8690000000028' });
  const tektas = await product({ name: 'Pırlanta Tektaş Yüzük 0.30 ct', price: '42500.00', costPrice: '31000.00', stock: 3, barcode: '8690000000035' });
  const kupe = await product({ name: 'Gümüş Damla Küpe', price: '1850.00', costPrice: '900.00', stock: 14, barcode: '8690000000042' });
  const alyans = await product({ name: 'Klasik Alyans (çift)', price: '18900.00', costPrice: '14200.00', stock: 2, barcode: '8690000000059' });
  await product({ name: 'Ata Lira Kolye Ucu', price: '24750.00', costPrice: '22100.00', stock: 1, barcode: '8690000000066' });

  const customer = (name, phone) => api('POST', '/api/customers', { name, phone });
  const ayse = await customer('Ayşe Yılmaz', '0532 111 22 33');
  const mehmet = await customer('Mehmet Demir', '0533 444 55 66');
  const zeynep = await customer('Zeynep Kaya', '0542 777 88 99');
  const elif = await customer('Elif Şahin', '0555 123 45 67');
  const provider = await api('POST', '/api/pos/providers', { code: 'DEMOBANK', name: 'Demo Bank POS', rules: [{ installments: 1, ratePercent: '1.80', valorDays: 1 }] });

  const manualPrices = { XAU: hasPrice };
  const sale = (customerId, lines, payments) => api('POST', '/api/sales', { customerId, lines, payments, manualPrices });
  const quoteTotal = async (customerId, lines) => (await api('POST', '/api/sales/quote', { customerId, lines, manualPrices })).total.toFixed(2);
  for (const [c, lines, method] of [
    [ayse, [{ productId: bilezik._id, quantity: 1 }], 'nakit'],
    [mehmet, [{ productId: tektas._id, quantity: 1 }], 'kredi kartı'],
    [zeynep, [{ productId: kolye._id, quantity: 1 }, { productId: kupe._id, quantity: 2 }], 'havale'],
    [elif, [{ productId: alyans._id, quantity: 1 }], 'nakit'],
    [ayse, [{ productId: kupe._id, quantity: 1 }], 'kredi kartı'],
  ]) {
    const amount = await quoteTotal(c._id, lines);
    await sale(c._id, lines, [{ method, amount, ...(method === 'kredi kartı' ? { pos: { providerId: provider._id } } : {}) }]);
  }
  await sale(mehmet._id, [{ productId: bilezik._id, quantity: 1 }], []); // on account (open balance)
}
