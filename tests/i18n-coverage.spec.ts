/**
 * Translation coverage guard.
 *
 *  1. Every message exists in all eight languages, is non-empty and uses the
 *     same {placeholders} as the Turkish source.
 *  2. Sentences are actually translated (not copied from English/Turkish).
 *  3. Every key referenced from source code exists in the catalog.
 *  4. No registered route component (or shared component) renders
 *     user-facing text that bypasses the translation system.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { messageTree } from '@/i18n/messages';
import { LANGUAGES } from '@/i18n/languages';
import { lookup, lookupNode } from '@/i18n';
import { project } from '@/i18n/messages/define';

const SRC = path.resolve(__dirname, '../src');

type Tree = { [k: string]: readonly string[] | Tree };

function flatten(tree: Tree, prefix = ''): Array<[string, readonly string[]]> {
  return Object.entries(tree).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return Array.isArray(v) ? [[key, v as readonly string[]] as [string, readonly string[]]] : flatten(v as Tree, key);
  });
}

const entries = flatten(messageTree as unknown as Tree);
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');

/** Files that no route or component imports (kept as-is, excluded from scans). */
const DEAD_FILES = [
  'components/LineChart.vue',
  'components/dashboard/CurrencyPrices.vue',
  'components/dashboard/GoldPrices.vue',
  'components/dashboard/NewJewelryPrices.vue',
  'components/dashboard/OldJewelryPrices.vue',
  'components/dashboard/SalesChart.vue',
  'components/dashboard/StatsCards.vue',
];

function walk(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return ext.test(e.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const vueFiles = walk(SRC, /\.vue$/).filter((f) => !DEAD_FILES.includes(rel(f)));
const codeFiles = walk(SRC, /\.(vue|ts|js)$/).filter((f) => !DEAD_FILES.includes(rel(f)) && !rel(f).startsWith('i18n/messages/'));

/** Values that are legitimately identical to English in that language. */
const SAME_AS_SOURCE = new Set([
  'settings.users.module [fr]', 'market.instruments [fr]', 'products.hammaddeMaden [es]',
  'products.urunAciklamasiNotlar [fr]', 'finance.p0StokP1 [es]',
  // "Transfer" is the same word in Turkish, English and German.
  'transfers.transferP0P1P2 [en]', 'transfers.transferP0P1P2 [de]',
]);

/** Proper nouns that keep Turkish letters in every language (coin names). */
const PROPER_NOUNS = new Set(['market.instrument.RESAT_ALTIN']);

describe('message catalog', () => {
  it('has thousands of entries across the application', () => {
    expect(entries.length).toBeGreaterThan(900);
  });

  it('defines every message in all eight languages with matching placeholders', () => {
    const problems: string[] = [];
    for (const [key, values] of entries) {
      if (values.length !== LANGUAGES.length) problems.push(`${key}: ${values.length} languages`);
      values.forEach((value, i) => {
        if (typeof value !== 'string' || !value.trim()) problems.push(`${key} [${LANGUAGES[i]}] is empty`);
        if (placeholders(value) !== placeholders(values[0])) problems.push(`${key} [${LANGUAGES[i]}] placeholders differ`);
        if (value === key) problems.push(`${key} [${LANGUAGES[i]}] equals its key`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('translates sentences instead of copying another language', () => {
    const copied: string[] = [];
    for (const [key, v] of entries) {
      const [tr, en, ...rest] = v;
      rest.forEach((value, i) => {
        const lang = LANGUAGES[i + 2];
        const words = value.replace(/\{\w+\}/g, '').trim();
        const sentence = words.length > 14 && /\s/.test(words) && /[a-z]{4}/.test(words);
        if (sentence && (value === en || value === tr) && !SAME_AS_SOURCE.has(`${key} [${lang}]`)) copied.push(`${key} [${lang}]`);
      });
      const enWords = en.replace(/\{\w+\}/g, '').trim();
      if (enWords.length > 14 && /\s/.test(enWords) && en === tr && !SAME_AS_SOURCE.has(`${key} [en]`)) copied.push(`${key} [en]`);
    }
    expect(copied).toEqual([]);
  });

  it('never contains Turkish-only letters outside the Turkish catalog', () => {
    const leaks: string[] = [];
    for (const [key, v] of entries) {
      if (PROPER_NOUNS.has(key)) continue;
      v.slice(1).forEach((value, i) => {
        if (/[ğşıİĞŞ]/.test(value)) leaks.push(`${key} [${LANGUAGES[i + 1]}]: ${value}`);
      });
    }
    expect(leaks).toEqual([]);
  });
});

describe('generated locale catalogs', () => {
  it('src/i18n/locales/*.json match the message source (run `node scripts/build-locales.mjs`)', () => {
    LANGUAGES.forEach((language, index) => {
      const file = path.join(SRC, 'i18n', 'locales', `${language}.json`);
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(onDisk, `${language}.json is stale`).toEqual(project(messageTree as never, index));
    });
  });
});

describe('source references', () => {
  const STATIC_KEY = /(?:\$t|\bt|\$te|\bte|tOptional)\(\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_:/-]+)+)'/g;
  const DYNAMIC_KEY = /(?:\$t|\bt|tOptional)\(\s*`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*)\.\$\{/g;

  it('references only keys that exist in the catalog', () => {
    const missing: string[] = [];
    for (const file of codeFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(STATIC_KEY)) {
        const key = m[1];
        if (!/^(common|shell|nav|roles|toast|confirm|units|errors|status|purity|payment|palettes|settings|permissions|ledger|auth|dashboard|market|sales|products|customers|reports|finance|transfers|pos|calculator)\./.test(key)) continue;
        if (lookup('tr', key) === undefined) missing.push(`${rel(file)}: ${key}`);
      }
      for (const m of src.matchAll(DYNAMIC_KEY)) {
        if (lookupNode('tr', m[1]) === undefined) missing.push(`${rel(file)}: ${m[1]}.*`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/* ------------------------------------------------------------------ scanner */

// Brand names, units, symbols and codes that are intentionally not translated.
const ALLOWED_TEXT = new Set([
  '©   JEWELER PRO •', 'POS:',
  'JEWELER', 'PRO', 'JEWELER PRO', 'POS', 'IP', 'TRY', 'USD / TRY', 'EUR / TRY', 'Ctrl+B', 'ID', 'XAU', 'XAG', 'gr', 'g',
]);

function templateOf(src: string): string {
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  return start >= 0 && end > start ? src.slice(start + 10, end) : '';
}

function scriptOf(src: string): string {
  const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}

function textNodes(template: string): string[] {
  const withoutComments = template.replace(/<!--[\s\S]*?-->/g, '');
  const found: string[] = [];
  const tag = /<\/?[a-zA-Z][\w-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  let pos = 0;
  for (const m of withoutComments.matchAll(tag)) {
    found.push(withoutComments.slice(pos, m.index));
    pos = (m.index || 0) + m[0].length;
  }
  found.push(withoutComments.slice(pos));
  return found
    .map((t) => t.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').trim())
    .filter((t) => /\p{L}{2,}/u.test(t))
    .filter((t) => !ALLOWED_TEXT.has(t) && !/^mdi-[a-z0-9-]+$/.test(t));
}

function staticAttributes(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/(?<![:@\w-])(placeholder|title|aria-label|label|alt)="([^"]*)"/g)) {
    if (/\p{L}{2,}/u.test(m[2]) && !ALLOWED_TEXT.has(m[2].trim())) out.push(`${m[1]}="${m[2]}"`);
  }
  return out;
}

/** Turkish string literals in scripts that are not data codes or log messages. */
const DATA_LITERALS = new Set([
  'kredi kartı', 'altın', 'Merkez Şube - Kapalıçarşı', 'has altın', 'Tümü',
]);

function turkishScriptLiterals(script: string): string[] {
  const code = script
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/console\.(?:log|warn|error|info)\([^)]*\)/g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = m[2];
    if (/[çşğüöıÇŞĞÜÖİ]/.test(value) && !DATA_LITERALS.has(value) && !/^[a-z ]+$/.test(value.replace(/[çşğüöı]/g, 'a'))) out.push(value);
  }
  return out;
}

describe('no hard-coded user-facing text', () => {
  it('scans every reachable component', () => {
    expect(vueFiles.length).toBeGreaterThan(15);
  });

  for (const file of vueFiles) {
    it(`${rel(file)} routes all visible text through i18n`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const template = templateOf(src);
      expect({ text: textNodes(template), attributes: staticAttributes(template), script: turkishScriptLiterals(scriptOf(src)) })
        .toEqual({ text: [], attributes: [], script: [] });
    });
  }

  it('the router, services and store emit no Turkish user-facing literals', () => {
    const offenders: string[] = [];
    for (const file of codeFiles.filter((f) => /\.(ts|js)$/.test(f))) {
      if (/services[\\/]settings\.ts$/.test(file)) continue; // default business identity is sample data
      if (/i18n[\\/]languages\.ts$/.test(file)) continue; // native language names are intentionally untranslated
      for (const lit of turkishScriptLiterals(fs.readFileSync(file, 'utf8'))) offenders.push(`${rel(file)}: ${lit}`);
    }
    expect(offenders).toEqual([]);
  });
});
