// vuex 4 ships its types under ./types, but its package.json "exports" map
// hides them from moduleResolution "bundler"; re-export them explicitly.
declare module 'vuex' {
  export * from 'vuex/types/index.d.ts';
}

