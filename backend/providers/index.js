const TcmbProvider = require('./tcmbProvider');
const GenelparaProvider = require('./genelparaProvider');
const ConfiguredHttpProvider = require('./configuredHttpProvider');
const BistProvider = require('./bistProvider');

const providers = [
  new TcmbProvider(),
  new GenelparaProvider(),
  new ConfiguredHttpProvider({
    id: 'hasfiyat',
    name: 'Hasfiyat (Kapalıçarşı Altın API)',
    envUrl: 'HASFIYAT_API_URL',
    envKey: 'HASFIYAT_API_KEY',
    termsUrl: 'https://altinapi.hasfiyat.com',
    priority: 5,
  }),
  new ConfiguredHttpProvider({
    id: 'nadir-doviz',
    name: 'Nadir Döviz',
    envUrl: 'NADIR_DOVIZ_API_URL',
    envKey: 'NADIR_DOVIZ_API_KEY',
    termsUrl: 'https://www.nadirdoviz.com.tr/',
    priority: 6,
  }),
  new ConfiguredHttpProvider({
    id: 'izko',
    name: 'İzmir Kuyumcular Odası',
    envUrl: 'IZKO_API_URL',
    envKey: 'IZKO_API_KEY',
    termsUrl: 'https://www.izko.org.tr/',
    priority: 7,
  }),
  new ConfiguredHttpProvider({
    id: 'investing',
    name: 'Investing.com',
    envUrl: 'INVESTING_API_URL',
    envKey: 'INVESTING_API_KEY',
    termsUrl: 'https://www.investing.com/',
    priority: 8,
  }),
  new BistProvider(),
];

module.exports = providers;
