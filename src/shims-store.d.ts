import type { Store } from 'vuex';

// `this.$store` in Options API components (see the Vuex 4 TypeScript guide).
declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $store: Store<unknown>;
  }
}
