/**
 * The Vuetify plugin registers only the components the templates use
 * (tree-shaking, src/plugins/vuetify.ts). An unregistered <v-*> tag would
 * silently render as an unknown element in production — this test fails
 * instead, naming the component to add.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(__dirname, '../src');

function vueFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return vueFiles(full);
    return e.name.endsWith('.vue') ? [full] : [];
  });
}

const pascal = (tag: string) => tag.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

function registeredComponents(): Set<string> {
  const plugin = fs.readFileSync(path.join(src, 'plugins', 'vuetify.ts'), 'utf8');
  const block = plugin.match(/const components = \{([\s\S]*?)\};/);
  if (!block) throw new Error('src/plugins/vuetify.ts must declare `const components = { … }`');
  const names = block[1].split(',').map((s) => s.trim()).filter(Boolean);
  // Each registered name must also be imported from vuetify/components.
  const imported = plugin.match(/import \{([^}]*)\} from 'vuetify\/components';/);
  const importedNames = new Set((imported?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const name of names) expect(importedNames.has(name), `${name} is registered but not imported`).toBe(true);
  return new Set(names);
}

describe('Vuetify component registration', () => {
  it('every <v-*> tag used by a reachable template is registered', () => {
    const registered = registeredComponents();
    // layouts/default.vue is a dead Vuetify-2 leftover (not imported anywhere).
    const files = vueFiles(src).filter((f) => !f.includes(`${path.sep}layouts${path.sep}`));
    const used = new Map<string, string>();
    for (const file of files) {
      const template = fs.readFileSync(file, 'utf8').split('<script')[0];
      for (const m of template.matchAll(/<(v-[a-z-]+)/g)) used.set(pascal(m[1]), path.relative(src, file));
    }
    expect(used.size).toBeGreaterThan(10);
    const missing = [...used.entries()].filter(([name]) => !registered.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });
});
