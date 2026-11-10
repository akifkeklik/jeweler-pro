import { defineMessages } from '../define';

const P = (tr: string, en: string, de: string, fr: string, es: string, ru: string, ar: string, zh: string) => [tr, en, de, fr, es, ru, ar, zh] as const;

// [tr, en, de, fr, es, ru, ar, zh]
export default defineMessages({
  eyebrow: P('İşletme yönetim kokpiti', 'Business cockpit', 'Unternehmenscockpit', 'Cockpit de l’entreprise', 'Panel de la empresa', 'Панель управления бизнесом', 'لوحة قيادة النشاط', '经营驾驶舱'),
  title: P('Genel bakış', 'Overview', 'Überblick', 'Vue d’ensemble', 'Resumen', 'Обзор', 'نظرة عامة', '概览'),
  quickSale: P('Hızlı satış', 'Quick sale', 'Schnellverkauf', 'Vente rapide', 'Venta rápida', 'Быстрая продажа', 'بيع سريع', '快速销售'),
  summaryFailed: P('İşletme özeti alınamadı.', 'The business summary could not be loaded.', 'Die Übersicht konnte nicht geladen werden.', 'Impossible de charger le résumé.', 'No se pudo cargar el resumen.', 'Не удалось загрузить сводку.', 'تعذر تحميل ملخص النشاط.', '无法加载经营概要。'),
  kpi: {
    revenue: P('Toplam ciro', 'Total revenue', 'Gesamtumsatz', 'Chiffre d’affaires', 'Facturación total', 'Общая выручка', 'إجمالي الإيرادات', '总营业额'),
    profit: P('Brüt kâr', 'Gross profit', 'Bruttogewinn', 'Marge brute', 'Beneficio bruto', 'Валовая прибыль', 'إجمالي الربح', '毛利'),
    quantity: P('Satılan adet', 'Units sold', 'Verkaufte Stück', 'Unités vendues', 'Unidades vendidas', 'Продано единиц', 'الوحدات المباعة', '销售件数'),
    customers: P('Aktif müşteri', 'Active customers', 'Aktive Kunden', 'Clients actifs', 'Clientes activos', 'Активные клиенты', 'العملاء النشطون', '活跃客户'),
    profitIncomplete: P('Maliyet verisi eksik ürünler olduğu için kâr hesaplanamıyor.', 'Profit is unavailable because some products lack cost data.', 'Gewinn nicht verfügbar, da Kostendaten fehlen.', 'Marge indisponible : coûts manquants.', 'Beneficio no disponible por falta de costes.', 'Прибыль недоступна: нет себестоимости.', 'الربح غير متاح لنقص بيانات التكلفة.', '部分产品缺少成本，无法计算利润。'),
  },
  ticker: P('Canlı piyasa', 'Live market', 'Live-Markt', 'Marché en direct', 'Mercado en vivo', 'Онлайн-рынок', 'السوق المباشر', '实时行情'),
  waitingMarket: P('Piyasa verisi bekleniyor…', 'Waiting for market data…', 'Warte auf Marktdaten…', 'En attente des cours…', 'Esperando datos de mercado…', 'Ожидание рыночных данных…', 'بانتظار بيانات السوق…', '等待行情数据…'),
  marketOffline: P('Piyasa verileri çevrimdışı.', 'Market data is offline.', 'Marktdaten offline.', 'Cours hors ligne.', 'Datos de mercado sin conexión.', 'Рыночные данные недоступны.', 'بيانات السوق غير متصلة.', '行情数据离线。'),
  allRates: P('Tüm kurlar', 'All rates', 'Alle Kurse', 'Tous les cours', 'Todas las cotizaciones', 'Все курсы', 'كل الأسعار', '全部行情'),
  quickActions: P('Hızlı işlemler', 'Quick actions', 'Schnellaktionen', 'Actions rapides', 'Acciones rápidas', 'Быстрые действия', 'إجراءات سريعة', '快捷操作'),
  actions: {
    sale: P('Hızlı satış (POS)', 'Quick sale (POS)', 'Schnellverkauf (POS)', 'Vente rapide (TPE)', 'Venta rápida (TPV)', 'Быстрая продажа (POS)', 'بيع سريع (نقطة بيع)', '快速销售（POS）'),
    saleSub: P('Yeni satış belgesi oluştur', 'Create a new sale', 'Neuen Verkauf anlegen', 'Créer une vente', 'Crear una venta', 'Оформить продажу', 'إنشاء عملية بيع', '新建销售单'),
    products: P('Ürün ve stok', 'Products & stock', 'Produkte & Bestand', 'Produits & stock', 'Productos y stock', 'Товары и остатки', 'المنتجات والمخزون', '产品与库存'),
    productsSub: P('Envanter yönetimi', 'Inventory management', 'Bestandsverwaltung', 'Gestion de l’inventaire', 'Gestión de inventario', 'Управление запасами', 'إدارة المخزون', '库存管理'),
    customers: P('Müşteri cari', 'Customer accounts', 'Kundenkonten', 'Comptes clients', 'Cuentas de clientes', 'Счета клиентов', 'حسابات العملاء', '客户往来'),
    customersSub: P('Hesap ve bakiye takibi', 'Accounts and balances', 'Konten und Salden', 'Comptes et soldes', 'Cuentas y saldos', 'Счета и сальдо', 'الحسابات والأرصدة', '账户与余额'),
    calculator: P('Gram ve ayar', 'Grams & karats', 'Gramm & Karat', 'Grammes & carats', 'Gramos y quilates', 'Граммы и пробы', 'الغرامات والعيارات', '克重与成色'),
    calculatorSub: P('Hızlı altın hesabı', 'Quick gold calculation', 'Schnelle Goldberechnung', 'Calcul rapide de l’or', 'Cálculo rápido de oro', 'Быстрый расчёт золота', 'حساب الذهب السريع', '快速黄金计算'),
  },
  lowStock: P('Kritik envanter', 'Low stock', 'Niedriger Bestand', 'Stock critique', 'Stock crítico', 'Низкий остаток', 'مخزون منخفض', '低库存'),
  stockLink: P('Stoklar', 'Stock', 'Bestand', 'Stock', 'Stock', 'Остатки', 'المخزون', '库存'),
  lowStockHint: P('Kritik stok seviyesinde', 'At critical level', 'Kritischer Bestand', 'Niveau critique', 'Nivel crítico', 'Критический уровень', 'مستوى حرج', '处于临界水平'),
  remaining: P('Kalan: {count}', 'Left: {count}', 'Rest: {count}', 'Reste : {count}', 'Quedan: {count}', 'Осталось: {count}', 'المتبقي: {count}', '剩余：{count}'),
  noLowStock: P('Kritik seviyede ürün bulunmuyor.', 'No products are at a critical level.', 'Keine Produkte auf kritischem Niveau.', 'Aucun produit en niveau critique.', 'Ningún producto en nivel crítico.', 'Нет товаров с критическим остатком.', 'لا توجد منتجات بمستوى حرج.', '没有处于临界库存的产品。'),
  recentSales: P('Son satış hareketleri', 'Recent sales', 'Letzte Verkäufe', 'Ventes récentes', 'Ventas recientes', 'Последние продажи', 'أحدث المبيعات', '最近销售'),
  allSales: P('Tüm satışlar', 'All sales', 'Alle Verkäufe', 'Toutes les ventes', 'Todas las ventas', 'Все продажи', 'كل المبيعات', '全部销售'),
  colPayment: P('Ödeme', 'Payment', 'Zahlung', 'Paiement', 'Pago', 'Оплата', 'الدفع', '付款'),
  noSales: P('Kayıtlı satış hareketi bulunamadı.', 'No sales recorded yet.', 'Noch keine Verkäufe erfasst.', 'Aucune vente enregistrée.', 'Aún no hay ventas.', 'Продаж пока нет.', 'لا توجد مبيعات مسجلة.', '暂无销售记录。'),
});
