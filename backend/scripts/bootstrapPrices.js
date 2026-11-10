const Price = require('../models/Price');
const marketDataWorker = require('../services/marketDataWorker');

/**
 * Bootstraps initial real market prices into MongoDB Price collection.
 * Strictly avoids inserting fake 0 or hardcoded prices.
 */
async function bootstrapPrices() {
  try {
    const count = await Price.countDocuments();
    if (count > 0) {
      return;
    }

    console.log('MongoDB Price koleksiyonu başlatılıyor: Canlı piyasa kotasyonları alınıyor...');
    const result = await marketDataWorker.poll();
    const quoteCount = result?.preferredQuotes?.length || 0;
    console.log(`İlk piyasa fiyatları yüklendi (${quoteCount} kotasyon).`);
  } catch (err) {
    console.warn('Piyasa verisi ilk yükleme uyarısı:', err.message);
  }
}

module.exports = bootstrapPrices;
