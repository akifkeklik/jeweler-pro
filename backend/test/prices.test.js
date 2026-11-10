const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const pricesRouter = require("../routes/prices");

const today = new Date();
const todayText = `${String(today.getUTCDate()).padStart(2, "0")}.${String(today.getUTCMonth() + 1).padStart(2, "0")}.${today.getUTCFullYear()}`;
const tcmbXml = `
<Tarih_Date Tarih="${todayText}">
  <Currency Kod="USD">
    <ForexBuying>34.1234</ForexBuying>
    <ForexSelling>34.5678</ForexSelling>
  </Currency>
  <Currency Kod="EUR">
    <ForexBuying>37.1111</ForexBuying>
    <ForexSelling>37.2222</ForexSelling>
  </Currency>
  <Currency Kod="GBP">
    <ForexBuying>43.0000</ForexBuying>
    <ForexSelling>43.5000</ForexSelling>
  </Currency>
  <Currency Kod="AUD">
    <ForexBuying>22.0000</ForexBuying>
    <ForexSelling>22.5000</ForexSelling>
  </Currency>
</Tarih_Date>`;

test("TCMB price fetch uses a timeout and returns normalized currency values", async () => {
  const originalEnvTimeout = process.env.TCMB_TIMEOUT_MS;
  delete process.env.TCMB_TIMEOUT_MS;
  const originalGet = axios.get;
  let requestUrl;
  let requestConfig;

  axios.get = async (url, config) => {
    requestUrl = url;
    requestConfig = config;
    return { data: tcmbXml };
  };

  try {
    const currencies = await pricesRouter.getTcmbCurrencies();

    assert.equal(requestUrl, "https://www.tcmb.gov.tr/kurlar/today.xml");
    assert.equal(requestConfig.timeout, 8000);
    assert.deepEqual(currencies[0], {
      currency: "USD/TL",
      buyPrice: "34.1234",
      sellPrice: "34.5678",
    });
    assert.equal(currencies.length, 4);
  } finally {
    axios.get = originalGet;
    if (originalEnvTimeout !== undefined) {
      process.env.TCMB_TIMEOUT_MS = originalEnvTimeout;
    } else {
      delete process.env.TCMB_TIMEOUT_MS;
    }
  }
});

test("TCMB price fetch skips malformed currency values", async () => {
  const originalGet = axios.get;
  const originalError = console.error;
  console.error = () => {};
  axios.get = async () => ({
    data: `<Tarih_Date Tarih="${todayText}"><Currency Kod="USD"><ForexBuying>invalid</ForexBuying><ForexSelling>34.5</ForexSelling></Currency></Tarih_Date>`,
  });

  try {
    assert.deepEqual(await pricesRouter.getTcmbCurrencies(), []);
  } finally {
    axios.get = originalGet;
    console.error = originalError;
  }
});

test("TCMB provider failures return an empty result without throwing", async () => {
  const originalGet = axios.get;
  const originalError = console.error;
  console.error = () => {};
  axios.get = async () => {
    throw new Error("provider unavailable");
  };

  try {
    assert.deepEqual(await pricesRouter.getTcmbCurrencies(), []);
  } finally {
    axios.get = originalGet;
    console.error = originalError;
  }
});
