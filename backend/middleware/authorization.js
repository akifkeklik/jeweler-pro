/**
 * Role + custom-permission authorization.
 * PERMISSION_CATALOG is the single source of truth; the frontend loads it via
 * GET /api/users/metadata and the effective permission list from /api/auth/me.
 */
const PERMISSION_CATALOG = Object.freeze([
  { id: 'dashboard:read', group: 'Genel', label: 'Gösterge paneli görüntüleme' },
  { id: 'prices:read', group: 'Genel', label: 'Canlı piyasa ve altın kotasyonları' },
  { id: 'catalog:read', group: 'Katalog & Stok', label: 'Ürün, kategori ve malzeme görüntüleme' },
  { id: 'catalog:write', group: 'Katalog & Stok', label: 'Ürün, kategori ve malzeme ekleme/düzenleme' },
  { id: 'catalog:delete', group: 'Katalog & Stok', label: 'Katalogdan ürün silme / arşivleme' },
  { id: 'customers:read', group: 'Müşteriler', label: 'Müşteri ve cari hesap görüntüleme' },
  { id: 'customers:write', group: 'Müşteriler', label: 'Müşteri ekleme/düzenleme' },
  { id: 'customers:delete', group: 'Müşteriler', label: 'Müşteri silme / arşivleme' },
  { id: 'sales:read', group: 'Satış', label: 'Satış kayıtlarını görüntüleme' },
  { id: 'sales:write', group: 'Satış', label: 'POS satış / fatura oluşturma' },
  { id: 'sales:cancel', group: 'Satış', label: 'Geçmiş satışı iptal etme' },
  { id: 'cash:read', group: 'Kasa', label: 'Kasa hareketlerini görüntüleme' },
  { id: 'cash:write', group: 'Kasa', label: 'Tahsilat / ödeme kaydı' },
  { id: 'cash:closing', group: 'Kasa', label: 'Gün sonu kapanışı (Z raporu)' },
  { id: 'accounts:manage', group: 'Kasa', label: 'Cari açılış bakiyesi (devir) ve müşteri kredi limiti' },
  { id: 'reports:read', group: 'Raporlar', label: 'Finansal raporlar ve ciro' },
  { id: 'purchases:read', group: 'Alım & Tedarik', label: 'Tedarikçi, alış ve tedarikçi cari görüntüleme' },
  { id: 'purchases:write', group: 'Alım & Tedarik', label: 'Tedarikçi tanımlama, alış ve tedarikçi ödemesi' },
  { id: 'inventory:adjust', group: 'Katalog & Stok', label: 'Stok sayım düzeltmesi ve maliyet düzeltmesi' },
  { id: 'ledger:read', group: 'Yönetim', label: 'Muhasebe defteri, stok değerlemesi ve mutabakat' },
  { id: 'transfers:read', group: 'Şube Transferleri', label: 'Şubeler arası transferleri görüntüleme' },
  { id: 'transfers:write', group: 'Şube Transferleri', label: 'Transfer taslağı oluşturma, sevk etme ve iptal' },
  { id: 'transfers:approve', group: 'Şube Transferleri', label: 'Transfer onayı/reddi ve teslim farkı kapatma' },
  { id: 'transfers:receive', group: 'Şube Transferleri', label: 'Gelen transferi teslim alma' },
  { id: 'pos:read', group: 'POS & Banka', label: 'POS işlemleri, komisyon ve hesap kesimlerini görüntüleme' },
  { id: 'pos:settle', group: 'POS & Banka', label: 'POS hesap kesimi (banka yatışı) kaydetme' },
  { id: 'pos:configure', group: 'POS & Banka', label: 'POS sağlayıcıları ve komisyon oranlarını yönetme' },
  { id: 'audit:read', group: 'Yönetim', label: 'Denetim kayıtlarını inceleme' },
  { id: 'users:read', group: 'Yönetim', label: 'Personel listesini görüntüleme' },
  { id: 'users:write', group: 'Yönetim', label: 'Personel oluşturma, düzenleme ve yetkilendirme' },
  { id: 'users:delete', group: 'Yönetim', label: 'Personel hesabını kalıcı silme' },
]);

const ALL_PERMISSIONS = Object.freeze(PERMISSION_CATALOG.map((p) => p.id));

const ROLE_PERMISSIONS = Object.freeze({
  admin: ALL_PERMISSIONS,
  manager: Object.freeze([
    'dashboard:read',
    'prices:read',
    'catalog:read',
    'catalog:write',
    'customers:read',
    'customers:write',
    'sales:read',
    'sales:write',
    'sales:cancel',
    'cash:read',
    'cash:write',
    'accounts:manage',
    'reports:read',
    'purchases:read',
    'purchases:write',
    'inventory:adjust',
    'ledger:read',
    'transfers:read',
    'transfers:write',
    'transfers:approve',
    'transfers:receive',
    'pos:read',
    'pos:settle',
  ]),
  staff: Object.freeze([
    'dashboard:read',
    'prices:read',
    'catalog:read',
    'catalog:write',
    'customers:read',
    'customers:write',
    'sales:read',
    'sales:write',
    'cash:read',
    'cash:write',
    'reports:read',
    'transfers:read',
    'transfers:receive',
  ]),
});

const ROLE_DEFINITIONS = Object.freeze([
  { id: 'admin', label: 'Yönetici (Tam Yetki)', rank: 3 },
  { id: 'manager', label: 'Şube Müdürü', rank: 2 },
  { id: 'staff', label: 'Vezne & Satış Personeli', rank: 1 },
]);

function roleRank(role) {
  return ROLE_DEFINITIONS.find((r) => r.id === role)?.rank || 0;
}

function sanitizePermissionList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p) => typeof p === 'string' && ALL_PERMISSIONS.includes(p)))];
}

function getEffectivePermissions(user) {
  if (!user) return [];
  const rolePermissions = ROLE_PERMISSIONS[user.role] || [];
  const custom = sanitizePermissionList(user.customPermissions || []);
  // Preserve catalog order so the UI renders a stable list.
  const granted = new Set([...rolePermissions, ...custom]);
  return ALL_PERMISSIONS.filter((p) => granted.has(p));
}

function hasPermission(user, permission) {
  return getEffectivePermissions(user).includes(permission);
}

function requirePermission(permission) {
  if (!ALL_PERMISSIONS.includes(permission)) {
    throw new Error(`Tanımsız yetki: ${permission}`);
  }
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmuyor', code: 'FORBIDDEN', permission });
    }
    return next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmuyor', code: 'FORBIDDEN' });
    }
    return next();
  };
}

/**
 * Rejects requests that explicitly target another business through the
 * `X-Business-Id` header or a `businessId` query parameter. A `businessId`
 * in a request BODY is never trusted and is stripped server-side
 * (utils/crudOperations PROTECTED_FIELDS, services build from tenantContext),
 * so it does not need to be refused here.
 */
function requireSameBusiness(req, res, next) {
  const userBusinessId = req.user?.businessId;
  const targetBusinessId = req.headers['x-business-id'] || req.query?.businessId;
  if (targetBusinessId && targetBusinessId !== userBusinessId) {
    return res.status(403).json({ error: 'Farklı bir işletmenin verilerine erişim yetkiniz bulunmuyor', code: 'FORBIDDEN' });
  }
  return next();
}

function validateNumericId(req, res, next) {
  if (!/^[1-9]\d*$/.test(req.params.id || '')) {
    return res.status(400).json({ error: 'Geçersiz ID formatı', code: 'INVALID_ID' });
  }
  return next();
}

module.exports = {
  PERMISSION_CATALOG,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_DEFINITIONS,
  roleRank,
  sanitizePermissionList,
  getEffectivePermissions,
  hasPermission,
  requirePermission,
  requireRole,
  requireSameBusiness,
  validateNumericId,
};
