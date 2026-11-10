/**
 * Generates src/i18n/locales/<lang>.json from the side-by-side message source
 * (src/i18n/messages). Turkish ships in the main bundle; the other languages are
 * lazily loaded chunks, so adding languages does not grow the entry bundle.
 *
 *   node scripts/build-locales.mjs          # regenerate
 *   node scripts/build-locales.mjs --check  # fail if the JSON is out of date
 *
 * tests/i18n-coverage.spec.ts runs the same comparison, so a stale catalog
 * fails the test suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'src', 'i18n', 'locales');
const LANGUAGES = ['tr', 'en', 'de', 'fr', 'es', 'ru', 'ar', 'zh'];

const bundled = await build({
  entryPoints: [path.join(root, 'src', 'i18n', 'messages', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const tmp = path.join(outDir, `.messages-${process.pid}.mjs`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(tmp, bundled.outputFiles[0].text);
let tree;
try {
  ({ messageTree: tree } = await import(pathToFileURL(tmp).href));
} finally {
  fs.rmSync(tmp, { force: true });
}

function project(node, index) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = Array.isArray(value) ? value[index] : project(value, index);
  }
  return out;
}

const check = process.argv.includes('--check');
let stale = 0;
LANGUAGES.forEach((language, index) => {
  const file = path.join(outDir, `${language}.json`);
  const json = `${JSON.stringify(project(tree, index), null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) {
      stale += 1;
      console.error(`stale: ${path.relative(root, file)}`);
    }
  } else {
    fs.writeFileSync(file, json);
  }
});
if (check && stale) process.exit(1);
console.log(check ? 'locale catalogs are up to date' : `wrote ${LANGUAGES.length} locale catalogs to ${path.relative(root, outDir)}`);
