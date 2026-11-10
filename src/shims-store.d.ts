import type { Store } from 'vuex';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

// `this.$store`, `this.$router` and `this.$route` in Options API components
// (see the Vuex 4 and Vue Router TypeScript guides).
declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $store: Store<unknown>;
    $router: Router;
    $route: RouteLocationNormalizedLoaded;
  }
}
