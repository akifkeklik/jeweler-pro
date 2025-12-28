const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const axios = require('axios');
const xml2js = require('xml2js');
const Price = require('../models/prices');

/**
 * Get TCMB (Turkish Central Bank) currencies
 */
async function getTcmbCurrencies() {
  try {
    const response = await axios.get('https://www.tcmb.gov.tr/kurlar/today.xml');
    const data = await xml2js.parseStringPromise(response.data);

    const codes = ['USD', 'EUR', 'GBP', 'AUD'];
    return codes
      .map((code) => {
        const curr = data.Tarih_Date.Currency.find((c) => c.$.Kod === code);
        if (!curr) return null;
        return {
          currency: `${code}/TL`,
          buyPrice: parseFloat(curr.ForexBuying[0]).toFixed(4),
          sellPrice: parseFloat(curr.ForexSelling[0]).toFixed(4),
        };
      })
      .filter((c) => c !== null);
  } catch (err) {
    console.error('⚠️ TCMB verisi alınamadı:', err.message);
    return [];
  }
}

/**
 * Get all prices (TCMB + DB prices)
 */
router.get('/', asyncHandler(async (req, res) => {
  const tcmbPrices = await getTcmbCurrencies();
  const dbPrices = await Price.find();

  res.json({
    timestamp: new Date().toISOString(),
    currencies: tcmbPrices,
    prices: dbPrices,
  });
}));

/**
 * Get TCMB currencies only
 */
router.get('/tcmb', asyncHandler(async (req, res) => {
  const tcmbPrices = await getTcmbCurrencies();
  res.json(tcmbPrices);
}));

/**
 * Get database prices only
 */
router.get('/database', asyncHandler(async (req, res) => {
  const dbPrices = await Price.find();
  res.json(dbPrices);
}));

module.exports = router;
