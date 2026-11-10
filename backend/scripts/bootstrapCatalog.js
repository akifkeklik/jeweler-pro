const Category = require('../models/Category');
const Material = require('../models/Material');
const User = require('../models/User');

const DEFAULT_CATEGORIES = [
  'Bilezik',
  'Yüzük & Tektaş',
  'Kolye & Zincir',
  'Küpe',
  'Alyans',
  'Yatırımlık Altın & Sikke',
  'Pırlanta & Mücevher',
  'Gümüş Takı & Aksesuar',
];

const DEFAULT_MATERIALS = [
  '24 Ayar Has Altın (0.995)',
  '22 Ayar Altın (0.916)',
  '18 Ayar Altın (0.750)',
  '14 Ayar Altın (0.585)',
  '925 Ayar Gümüş (0.925)',
  'Pırlanta / Değerli Taş',
];

/**
 * Seeds the default catalogue once per business (every business that has a
 * user account), so a newly onboarded tenant starts with the same defaults.
 */
async function bootstrapCatalog() {
  try {
    const businessIds = (await User.distinct('businessId')).filter(Boolean);
    for (const businessId of businessIds) {
      const categoryCount = await Category.countDocuments({ businessId });
      if (categoryCount === 0) {
        for (const name of DEFAULT_CATEGORIES) {
          await Category.create({ name, businessId });
        }
        console.log(`Varsayılan kuyumcu kategorileri oluşturuldu (${businessId}).`);
      }

      const materialCount = await Material.countDocuments({ businessId });
      if (materialCount === 0) {
        for (const name of DEFAULT_MATERIALS) {
          await Material.create({ name, businessId });
        }
        console.log(`Varsayılan hammadde ve maden tanımları oluşturuldu (${businessId}).`);
      }
    }
  } catch (err) {
    console.warn('Katalog ilk yükleme uyarısı:', err.message);
  }
}

module.exports = bootstrapCatalog;

