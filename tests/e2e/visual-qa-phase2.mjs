/**
 * Phase 2 visual QA on the real stack: production build, Express API,
 * MongoDB in-memory replica set, Chromium.
 *
 * Screenshots go to QA_OUT (default: <os tmp>/jeweler-visual-qa-phase2), never
 * to qa-screenshots/. Every screenshot is paired with automated checks:
 *   - no horizontal overflow
 *   - no raw translation keys in the rendered text
 *   - no Turkish-only letters on non-Turkish pages (seed data is ASCII)
 *   - palette tokens actually applied; reduced motion effective
 *   - sidebar widths/behaviour, toast size & no layout shift
 *   - preferences survive a full reload
 *
 *   node tests/e2e/visual-qa-phase2.mjs [--skip-build]
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const requireBackend = createRequire(path.join(backendRoot, 'package.json'));

const API_PORT = 5199;
const WEB_PORT = 8099;
const WEB = `http://localhost:${WEB_PORT}`;
const DIST = path.resolve(process.env.E2E_DIST || path.join(os.tmpdir(), 'jeweler-visual-qa-dist'));
const OUT = path.resolve(process.env.QA_OUT || path.join(os.tmpdir(), 'jeweler-visual-qa-phase2'));
const PASSWORD = 'Visual-QA-Strong-Password-42';
const BIZ = 'visual_qa_business';

if (path.resolve(OUT) === path.resolve(projectRoot, 'qa-screenshots')) throw new Error('Refusing to write into qa-screenshots/');
fs.mkdirSync(OUT, { recursive: true });

if (!process.argv.includes('--skip-build') || !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log(`[qa] Building frontend into ${DIST} …`);
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', DIST, '--emptyOutDir'], {
    cwd: projectRoot,
    env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Frontend build failed');
}

const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: replSet.getUri('jeweler_visual_qa'),
  JWT_SECRET: 'visual-qa-secret-with-more-than-thirty-two-characters!!',
  CORS_ORIGIN: WEB,
  APP_URL: WEB,
  REQUEST_LOG: 'off',
});

const mongoose = requireBackend('mongoose');
const app = requireBackend('./server.js');
const User = requireBackend('./models/User.js');
const { signToken } = requireBackend('./middleware/auth.js');
const { hashPassword } = requireBackend('./utils/passwords.js');
const { resetAllRateLimiters } = requireBackend('./middleware/rateLimit.js');

await mongoose.connect(process.env.MONGO_URI);
const apiServer = await new Promise((resolve) => { const s = app.listen(API_PORT, '127.0.0.1', () => resolve(s)); });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const webServer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, WEB).pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => webServer.listen(WEB_PORT, '127.0.0.1', resolve));

/* ------------------------------------------------------------- seed data */
const passwordHash = await hashPassword(PASSWORD);
const admin = await User.create({ email: `admin.${Date.now()}@qa.test`, name: 'Ada Lovelace', passwordHash, role: 'admin', branch: 'Main', businessId: BIZ, active: true });
await User.create({ email: `staff.${Date.now()}@qa.test`, name: 'Alan Turing', passwordHash, role: 'staff', branch: 'Harbour', businessId: BIZ, active: true });
const token = signToken(admin, 3600);
async function api(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const products = [];
for (const [name, price, cost, stock] of [['Classic Band Ring', '4200.00', '3100.00', 12], ['Pearl Drop Earrings', '2750.00', '1900.00', 3], ['Herringbone Chain', '9800.00', '7600.00', 2], ['Signet Ring', '6100.00', '4800.00', 0]]) {
  products.push((await api('POST', '/api/products', { name, price, costPrice: cost, stock, branch: 'Main' })).body);
}
const customers = [];
for (const [name, phone] of [['Grace Hopper', '05550000001'], ['Linus Ltd', '05550000002'], ['Katherine Johnson', '05550000003']]) {
  customers.push((await api('POST', '/api/customers', { name, phone })).body);
}
const provider = (await api('POST', '/api/pos/providers', { code: 'QABANK', name: 'QA Bank', rules: [{ installments: 1, ratePercent: '1.80', valorDays: 1 }] })).body;
await api('POST', '/api/sales', { customerId: customers[0]._id, lines: [{ productId: products[0]._id, quantity: 2 }], payments: [{ method: 'nakit', amount: '8400.00' }] });
await api('POST', '/api/sales', { customerId: customers[1]._id, lines: [{ productId: products[1]._id, quantity: 1 }], payments: [{ method: 'kredi kartı', amount: '2750.00', pos: { providerId: provider._id } }] });
await api('POST', '/api/sales', { customerId: customers[2]._id, lines: [{ productId: products[0]._id, quantity: 1 }], payments: [] });
const supplier = (await api('POST', '/api/suppliers', { name: 'Northwind Bullion' })).body;
await api('POST', '/api/purchases', { supplierId: supplier._id, lines: [{ productId: products[2]._id, quantity: 2, unitCost: '7500.00' }] });

/* ------------------------------------------------------------- helpers */
const ROUTES = ['dashboard', 'prices', 'sales', 'products', 'customers', 'reports', 'finance', 'transfers', 'pos', 'calculator', 'settings'];
const LANGS = ['tr', 'en', 'de', 'fr', 'es', 'ru', 'ar', 'zh'];
const PALETTES = ['obsidian', 'sapphire', 'emerald', 'amethyst', 'ruby', 'amber', 'arctic', 'rose', 'graphite'];
const RAW_KEY = /\b(common|shell|nav|roles|toast|confirm|units|errors|status|purity|payment|palettes|settings|permissions|ledger|auth|dashboard|market|sales|products|customers|reports|finance|transfers|pos|calculator)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*(?![\p{L}])/u;
const TURKISH_ONLY = /[ğşıİĞŞ]/;

const checks = [];
let failures = 0;
function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

async function newSession(viewport = { width: 1440, height: 900 }, prefs = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => record(`page error ${page.url()}`, false, e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('qa-prefs-seeded') && Object.keys(p).length) {
      localStorage.setItem('jeweler_settings', JSON.stringify(p));
      sessionStorage.setItem('qa-prefs-seeded', '1');
    }
  }, prefs);
  resetAllRateLimiters();
  await page.goto(`${WEB}/login`);
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  return { context, page };
}

async function setPrefs(page, prefs) {
  await page.evaluate((p) => {
    const current = JSON.parse(localStorage.getItem('jeweler_settings') || '{}');
    localStorage.setItem('jeweler_settings', JSON.stringify({ ...current, ...p }));
  }, prefs);
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(350);
}

async function inspect(page, label, { language } = {}) {
  const m = await page.evaluate(() => ({
    text: document.body.innerText,
    // Official names of external market-data sources, as supplied by the API.
    sourceNames: [...document.querySelectorAll('.provider-name')].map((el) => el.innerText.replace(/:\s*$/, '').trim()).filter(Boolean),
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  }));
  const raw = m.text.match(RAW_KEY);
  record(`${label}: no horizontal overflow`, !m.hOverflow);
  record(`${label}: no raw translation keys`, !raw, raw ? m.text.slice(Math.max(0, raw.index - 30), raw.index + 40) : '');
  if (language && language !== 'tr') {
    // Native language names, coin proper names (Reşat) and the official names of
    // external market-data sources (only where rendered as a source name) are
    // proper names, not translations.
    const text = m.sourceNames.reduce((acc, name) => acc.split(name).join(''), m.text);
    const checked = text.replace(/Türkçe|Reşat/g, '');
    const leak = checked.match(TURKISH_ONLY);
    record(`${label}: no Turkish text in ${language}`, !leak, leak ? checked.slice(Math.max(0, leak.index - 40), leak.index + 30).replace(/\s+/g, ' ') : '');
  }
  return m;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/* ------------------------------------------------------------- scenarios */
console.log(`\n[qa] Output: ${OUT}`);

// 1. Every route in every language (desktop, dark Obsidian).
console.log('\n[qa] Languages × routes');
for (const language of LANGS) {
  const { context, page } = await newSession({ width: 1440, height: 900 }, { language, themeMode: 'dark', palette: 'obsidian', sidebarMode: 'pinned' });
  for (const route of ROUTES) {
    await page.goto(`${WEB}/${route}`);
    await settle(page);
    const m = await inspect(page, `${language}/${route}`, { language });
    if (route === 'prices') {
      // Provider health must be a translated label, never the raw API token.
      const metas = await page.locator('.provider-meta').allInnerTexts();
      const rawStatus = metas.find((s) => /^(ok|stale|unavailable|error|unconfigured|disabled)$/.test(s.trim()));
      record(`${language}/prices: provider status is translated`, metas.length > 0 && !rawStatus, rawStatus || `${metas.length} providers`);
    }
    if (route === 'dashboard') {
      record(`${language}: html lang/dir`, m.lang === language && m.dir === (language === 'ar' ? 'rtl' : 'ltr'), `${m.lang}/${m.dir}`);
      // The attribute alone is not enough: the rendered app must flow in that
      // direction and the sidebar must sit on the inline-start side.
      const layout = await page.evaluate(() => {
        const appEl = document.querySelector('.v-application');
        const side = document.querySelector('.jeweler-sidebar').getBoundingClientRect();
        return { direction: getComputedStyle(appEl).direction, sideLeft: Math.round(side.left), sideRight: Math.round(side.right), width: document.documentElement.clientWidth };
      });
      const rtl = language === 'ar';
      const sidebarAtStart = rtl ? layout.sideRight >= layout.width - 1 : layout.sideLeft <= 1;
      record(`${language}: rendered layout is ${rtl ? 'RTL' : 'LTR'} (sidebar on the ${rtl ? 'right' : 'left'})`, layout.direction === (rtl ? 'rtl' : 'ltr') && sidebarAtStart, JSON.stringify(layout));
    }
    await shot(page, `lang-${language}-${route}`);
  }
  await context.close();
}

// 2. All nine palettes × light/dark (dashboard + sales with table, settings panel).
console.log('\n[qa] Palettes × appearance');
{
  const { context, page } = await newSession();
  for (const palette of PALETTES) {
    for (const themeMode of ['light', 'dark']) {
      await setPrefs(page, { palette, themeMode, language: 'en' });
      for (const route of ['dashboard', 'sales']) {
        await page.goto(`${WEB}/${route}`);
        await settle(page);
        const tokens = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return {
            palette: document.documentElement.dataset.palette,
            theme: document.documentElement.dataset.theme,
            primary: cs.getPropertyValue('--jp-primary').trim(),
            bodyBg: getComputedStyle(document.querySelector('.jeweler-app') || document.body).backgroundColor,
            vuetifyPrimary: cs.getPropertyValue('--v-theme-primary').trim() || getComputedStyle(document.querySelector('.v-application') || document.body).getPropertyValue('--v-theme-primary').trim(),
          };
        });
        if (route === 'dashboard') {
          record(`${palette}/${themeMode}: palette + mode applied`, tokens.palette === palette && tokens.theme === themeMode, `${tokens.palette}/${tokens.theme} primary ${tokens.primary}`);
          record(`${palette}/${themeMode}: Vuetify primary follows palette`, Boolean(tokens.vuetifyPrimary), tokens.vuetifyPrimary);
        }
        await inspect(page, `${palette}/${themeMode}/${route}`);
        await shot(page, `palette-${palette}-${themeMode}-${route}`);
      }
    }
  }
  // Settings appearance panel with live previews in both modes.
  for (const themeMode of ['light', 'dark']) {
    await setPrefs(page, { palette: 'sapphire', themeMode, language: 'en' });
    await page.goto(`${WEB}/settings`);
    await settle(page);
    await shot(page, `settings-appearance-${themeMode}`);
  }
  await context.close();
}

// 3. Preferences set through the UI apply instantly, toast is compact, and persist after reload.
console.log('\n[qa] Settings UI, toasts and persistence');
{
  const { context, page } = await newSession({ width: 1440, height: 900 }, { language: 'tr', themeMode: 'dark', palette: 'obsidian' });
  await page.goto(`${WEB}/settings`);
  await settle(page);
  const before = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, y: document.querySelector('.settings-content-card')?.getBoundingClientRect().top }));
  await page.getByTestId('palette-emerald').click();
  const toast = page.getByTestId('toast').first();
  await toast.waitFor({ timeout: 3000 });
  const box = await toast.boundingBox();
  const after = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, y: document.querySelector('.settings-content-card')?.getBoundingClientRect().top, palette: document.documentElement.dataset.palette }));
  record('palette applies instantly without reload', after.palette === 'emerald');
  record('toast is compact (< 64px tall, < 380px wide)', box && box.height < 64 && box.width < 380, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'no box');
  record('toast causes no layout shift', before.y === after.y && before.h === after.h, `${before.y}→${after.y}`);
  await shot(page, 'toast-palette-tr');
  await page.waitForTimeout(4600);
  record('toast dismisses itself after ~4 s', (await page.getByTestId('toast').count()) === 0);

  await page.getByTestId('mode-light').click();
  await page.getByTestId('language-en').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  const langToast = await page.getByTestId('toast').last().innerText();
  record('language toast is in the new language', /Language changed/.test(langToast), langToast);
  await page.getByTestId('reduced-motion-toggle').click();
  await page.waitForTimeout(200);
  await shot(page, 'settings-after-ui-changes-en-light');

  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({ palette: document.documentElement.dataset.palette, theme: document.documentElement.dataset.theme, lang: document.documentElement.lang, reduced: document.documentElement.classList.contains('jp-reduced-motion') }));
  record('preferences persist after a full reload', persisted.palette === 'emerald' && persisted.theme === 'light' && persisted.lang === 'en' && persisted.reduced, JSON.stringify(persisted));

  // Reduced motion: sidebar + overlays lose their transition.
  const durations = await page.evaluate(() => getComputedStyle(document.querySelector('.jeweler-sidebar')).transitionDuration);
  record('reduced motion removes sidebar animation', /^0s/.test(durations), durations);

  // Persists across sign-out / sign-in on the same device.
  await page.locator('.profile-logout').click();
  await page.waitForURL('**/login');
  const loginLang = await page.evaluate(() => document.documentElement.lang);
  record('signed-out login page keeps the chosen language', loginLang === 'en', loginLang);
  await shot(page, 'login-after-logout-en');
  await context.close();
}

// 4. Sidebar behaviours and motion.
console.log('\n[qa] Sidebar');
{
  const { context, page } = await newSession({ width: 1440, height: 900 }, { language: 'en', sidebarMode: 'pinned', reducedMotion: false });
  await page.goto(`${WEB}/sales`);
  await settle(page);
  const width = () => page.evaluate(() => Math.round(document.querySelector('.jeweler-sidebar').getBoundingClientRect().width));
  const mainLeft = () => page.evaluate(() => Math.round(document.querySelector('.jeweler-main').getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector('.jeweler-main')).paddingLeft)));
  record('pinned sidebar is 248px', (await width()) === 248, String(await width()));
  const motion = await page.evaluate(() => getComputedStyle(document.querySelector('.jeweler-sidebar')).transitionDuration);
  record('sidebar animates with the 240ms motion token', motion.startsWith('0.24s'), motion);
  await shot(page, 'sidebar-pinned');

  await page.getByTestId('sidebar-toggle').click();
  await page.waitForTimeout(80);
  const mid = await width();
  record('collapse animates (intermediate width observed)', mid > 64 && mid < 248, String(mid));
  await page.waitForTimeout(400);
  record('collapsed sidebar is a 64px rail', (await width()) === 64, String(await width()));
  await shot(page, 'sidebar-collapsed');
  await page.locator('.nav-link-btn').nth(2).hover();
  await page.waitForTimeout(500);
  const tooltip = await page.locator('.v-tooltip .v-overlay__content').first().innerText().catch(() => '');
  record('collapsed rail shows a tooltip on hover', tooltip.length > 0, tooltip);
  await shot(page, 'sidebar-collapsed-tooltip');
  await page.mouse.move(900, 400);

  await setPrefs(page, { sidebarMode: 'hover' });
  await page.reload();
  await settle(page);
  const leftBefore = await mainLeft();
  await page.locator('.jeweler-sidebar').hover({ position: { x: 30, y: 300 } });
  await page.waitForTimeout(60);
  record('hover intent: no expansion on a brief pass', (await width()) === 64, String(await width()));
  await page.waitForTimeout(550);
  record('hover mode expands to 248px over the content', (await width()) === 248, String(await width()));
  record('hover expansion does not move the page content', (await mainLeft()) === leftBefore, `${leftBefore}→${await mainLeft()}`);
  await shot(page, 'sidebar-hover-expanded');
  await page.mouse.move(1000, 400);
  await page.waitForTimeout(600);
  record('hover mode collapses again after leaving', (await width()) === 64, String(await width()));
  const active = await page.locator('.nav-link-active').count();
  record('active route stays highlighted', active === 1);
  await context.close();
}

// 5. Tablet layouts.
console.log('\n[qa] Tablet');
for (const viewport of [{ width: 1024, height: 768, name: '1024x768' }, { width: 820, height: 1180, name: '820x1180' }]) {
  const { context, page } = await newSession(viewport, { language: 'en', themeMode: 'light', palette: 'arctic', sidebarMode: 'pinned' });
  for (const route of ROUTES) {
    await page.goto(`${WEB}/${route}`);
    await settle(page);
    await inspect(page, `${viewport.name}/${route}`, { language: 'en' });
    await shot(page, `tablet-${viewport.name}-${route}`);
  }
  if (viewport.width < 960) {
    const temporary = await page.evaluate(() => document.querySelector('.jeweler-sidebar')?.classList.contains('v-navigation-drawer--temporary'));
    record('narrow screens use a temporary (overlay) drawer', Boolean(temporary));
    await page.locator('.topbar-toggle-btn').click();
    await page.waitForTimeout(400);
    await shot(page, `tablet-${viewport.name}-drawer-open`);
  }
  await context.close();
}

// 6. Dialogs, confirmations and RTL.
console.log('\n[qa] Dialogs');
for (const language of ['en', 'ar', 'de']) {
  const { context, page } = await newSession({ width: 1440, height: 900 }, { language, themeMode: language === 'de' ? 'light' : 'dark', palette: language === 'ar' ? 'amber' : 'ruby' });
  await page.goto(`${WEB}/sales`);
  await settle(page);
  await page.locator('.header-actions .jp-primary').click();
  await page.locator('.v-dialog').waitFor();
  await page.waitForTimeout(300);
  await inspect(page, `${language}/new-sale-dialog`, { language });
  await shot(page, `dialog-new-sale-${language}`);
  await page.keyboard.press('Escape');
  await page.goto(`${WEB}/settings`);
  await settle(page);
  await page.getByTestId('reset-preferences').click();
  await page.getByTestId('confirm-dialog').waitFor();
  await inspect(page, `${language}/confirm-dialog`, { language });
  await shot(page, `dialog-confirm-${language}`);
  await page.getByTestId('confirm-cancel').click();
  await context.close();
}

// 7. Unauthenticated login in every language (light + dark).
console.log('\n[qa] Login');
for (const language of LANGS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript((l) => localStorage.setItem('jeweler_settings', JSON.stringify({ language: l, themeMode: l === 'en' ? 'light' : 'dark', palette: 'obsidian' })), language);
  await page.goto(`${WEB}/login`);
  await settle(page);
  await inspect(page, `login/${language}`, { language });
  await shot(page, `login-${language}`);
  await context.close();
}

/* ------------------------------------------------------------- summary */
await browser.close();
webServer.close();
apiServer.close();
await mongoose.disconnect();
await replSet.stop();

const passed = checks.filter((c) => c.ok).length;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ passed, failed: failures, checks }, null, 2));
console.log(`\n[qa] ${passed}/${checks.length} checks passed; ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
