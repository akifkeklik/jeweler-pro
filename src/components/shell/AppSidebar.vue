<template>
  <!--
    Three behaviours (Settings → Appearance):
      pinned    full width; toggling animates the drawer and content together
      hover     64px rail that overlays to full width after a short hover
                intent — the content area never moves on hover
      collapsed 64px rail with tooltips
    Labels stay mounted and fade, so expanding never flickers or re-lays out.
  -->
  <v-navigation-drawer
    v-model="open"
    :permanent="!isMobile"
    :temporary="isMobile"
    :rail="rail"
    :expand-on-hover="!isMobile && sidebarMode === 'hover'"
    :open-delay="120"
    :close-delay="160"
    :rail-width="64"
    :width="248"
    :aria-label="$t('nav.title')"
    class="jeweler-sidebar"
    :class="{ 'is-collapsed': !expanded, 'is-expanded': expanded }"
    data-testid="sidebar"
    :data-expanded="expanded ? 'true' : 'false'"
    @update:rail="$emit('rail-hover', $event)"
  >
    <router-link to="/dashboard" class="brand-lockup" @click="$emit('navigate')">
      <span class="brand-mark" aria-hidden="true">
        <v-icon size="18">mdi-diamond-stone</v-icon>
      </span>
      <span class="brand-text-wrap jp-fade-label">
        <span class="brand-name">JEWELER <span>PRO</span></span>
        <span class="brand-caption">{{ $t('shell.caption') }}</span>
      </span>
    </router-link>

    <div class="sidebar-search jp-fade-label" :aria-hidden="!expanded">
      <v-icon size="15">mdi-magnify</v-icon>
      <input
        ref="searchInput"
        v-model.trim="search"
        type="search"
        :tabindex="expanded ? 0 : -1"
        :placeholder="$t('nav.search')"
        :aria-label="$t('nav.search')"
      />
      <kbd v-if="!search">/</kbd>
      <button v-else type="button" class="clear-search-btn" :aria-label="$t('common.clear')" @click="search = ''">
        <v-icon size="12">mdi-close</v-icon>
      </button>
    </div>

    <nav class="nav-scroll-area">
      <div v-for="group in groups" :key="group.key" class="nav-group">
        <div class="nav-label">
          <span class="jp-fade-label">{{ group.label }}</span>
        </div>
        <div class="nav-list">
          <v-tooltip
            v-for="item in group.items"
            :key="item.path"
            :text="item.title"
            location="end"
            :disabled="expanded"
            :open-delay="300"
            :aria-label="item.title"
          >
            <template #activator="{ props: tip }">
              <router-link
                v-bind="tip"
                :to="item.path"
                class="nav-link-btn"
                :class="{ 'nav-link-active': isActive(item.path) }"
                :aria-current="isActive(item.path) ? 'page' : undefined"
                @click="$emit('navigate')"
              >
                <span class="nav-icon-box"><v-icon size="18">{{ item.icon }}</v-icon></span>
                <span class="nav-item-text jp-fade-label">{{ item.title }}</span>
                <span v-if="item.badgeKey" class="nav-badge jp-fade-label">{{ $t(item.badgeKey) }}</span>
              </router-link>
            </template>
          </v-tooltip>
        </div>
      </div>
      <p v-if="search && !groups.length" class="nav-empty jp-fade-label">{{ $t('nav.noResults') }}</p>
    </nav>

    <div class="sidebar-bottom">
      <v-tooltip :text="$t('nav.items.settings')" location="end" :disabled="expanded" :open-delay="300" :aria-label="$t('nav.items.settings')">
        <template #activator="{ props: tip }">
          <router-link
            v-bind="tip"
            to="/settings"
            class="nav-link-btn"
            :class="{ 'nav-link-active': isActive('/settings') }"
            :aria-current="isActive('/settings') ? 'page' : undefined"
            @click="$emit('navigate')"
          >
            <span class="nav-icon-box"><v-icon size="18">mdi-cog-outline</v-icon></span>
            <span class="nav-item-text jp-fade-label">{{ $t('nav.items.settings') }}</span>
          </router-link>
        </template>
      </v-tooltip>

      <v-tooltip v-if="!isMobile" :text="toggleLabel + ' (Ctrl+B)'" location="end" :disabled="expanded" :open-delay="300" :aria-label="toggleLabel">
        <template #activator="{ props: tip }">
          <button
            v-bind="tip"
            type="button"
            class="sidebar-collapse-toggle-btn"
            aria-keyshortcuts="Control+B"
            :aria-expanded="sidebarMode === 'pinned' ? 'true' : 'false'"
            data-testid="sidebar-toggle"
            @click="$emit('toggle')"
          >
            <span class="nav-icon-box toggle-icon" :class="{ flipped: sidebarMode !== 'pinned' }">
              <v-icon size="16">mdi-chevron-double-left</v-icon>
            </span>
            <span class="toggle-text jp-fade-label">{{ toggleLabel }}</span>
            <kbd class="toggle-kbd jp-fade-label" aria-hidden="true">Ctrl+B</kbd>
          </button>
        </template>
      </v-tooltip>

      <div class="profile-row">
        <div class="profile-avatar" :title="userName">{{ initials }}</div>
        <div class="profile-copy jp-fade-label">
          <strong>{{ userName }}</strong>
          <span><span class="status-dot" aria-hidden="true"></span>{{ roleLabel }}</span>
        </div>
        <v-btn
          icon
          size="small"
          variant="text"
          class="profile-logout jp-fade-label"
          :tabindex="expanded ? 0 : -1"
          :title="$t('shell.logout')"
          :aria-label="$t('shell.logout')"
          @click="$emit('logout')"
        >
          <v-icon size="16">mdi-logout</v-icon>
        </v-btn>
      </div>
    </div>
  </v-navigation-drawer>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { authState } from '@/services/authSession';
import type { SidebarMode } from '@/services/settings';
import { isActivePath, NAV_GROUPS, searchNavGroups, visibleNavGroups } from '@/services/navigation';

/**
 * The navigation drawer: brand, menu search, permission-filtered menu,
 * sidebar toggle and the signed-in user. The shell (App.vue) owns its state
 * (open, rail, expanded) and the keyboard shortcuts.
 */
export default defineComponent({
  name: 'AppSidebar',
  props: {
    modelValue: { type: Boolean, default: true },
    isMobile: { type: Boolean, default: false },
    rail: { type: Boolean, default: false },
    expanded: { type: Boolean, default: true },
    sidebarMode: { type: String as PropType<SidebarMode>, default: 'pinned' },
    toggleLabel: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'rail-hover', 'toggle', 'navigate', 'logout'],
  data: () => ({ search: '' }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    groups() {
      // Depends on the reactive session, so the menu follows login/role changes.
      const visible = visibleNavGroups(NAV_GROUPS, authState.user?.permissions || [], (key) => this.$t(key));
      return searchNavGroups(visible, this.search);
    },
    userName(): string {
      return authState.user?.name || authState.user?.email || '';
    },
    roleLabel(): string {
      const role = authState.user?.role;
      return role ? this.$t(`roles.${role}`) : '';
    },
    initials(): string {
      return this.userName
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toLocaleUpperCase())
        .join('') || 'JP';
    },
  },
  methods: {
    isActive(path: string) {
      return isActivePath(this.$route.path, path);
    },
    /** Focuses the menu search (the "/" shortcut). */
    focusSearch() {
      (this.$refs.searchInput as HTMLInputElement | undefined)?.focus();
    },
  },
});
</script>

<style scoped src="@/styles/sidebar.css"></style>
