/**
 * Message definition helpers.
 *
 * Every message is an 8-tuple in the fixed order of LANGUAGES:
 *   [tr, en, de, fr, es, ru, ar, zh]
 * Keeping all languages side by side makes a missing translation a type error
 * (wrong tuple length) and keeps terminology reviewable per message.
 */
export type L = readonly [string, string, string, string, string, string, string, string];

export interface MessageTree {
  readonly [key: string]: L | MessageTree;
}

export function defineMessages<T extends MessageTree>(tree: T): T {
  return tree;
}

export type Catalog = { [key: string]: string | Catalog };

export function project(tree: MessageTree, index: number): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = Array.isArray(value) ? (value as unknown as string[])[index] : project(value as MessageTree, index);
  }
  return out;
}
