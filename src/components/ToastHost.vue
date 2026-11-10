<template>
  <div class="jp-toast-region" role="region" :aria-label="$t('toast.region')">
    <transition-group name="jp-toast" tag="div" class="jp-toast-stack">
      <div
        v-for="item in notifications"
        :key="item.id"
        class="jp-toast"
        :class="`jp-toast--${item.type}`"
        :role="item.type === 'error' ? 'alert' : 'status'"
        :aria-live="item.type === 'error' ? 'assertive' : 'polite'"
        data-testid="toast"
        :data-type="item.type"
        @mouseenter="hold(item.id)"
        @mouseleave="release(item.id)"
        @focusin="hold(item.id)"
        @focusout="release(item.id)"
      >
        <v-icon size="16" class="jp-toast__icon" aria-hidden="true">{{ icons[item.type] }}</v-icon>
        <span class="jp-toast__message">{{ item.message }}</span>
        <span v-if="item.count > 1" class="jp-toast__count" :aria-label="$t('toast.repeated', { count: item.count })">×{{ item.count }}</span>
        <button
          type="button"
          class="jp-toast__close"
          :aria-label="$t('common.dismiss')"
          :title="$t('common.dismiss')"
          @click="dismiss(item.id)"
        >
          <v-icon size="14">mdi-close</v-icon>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script>
export default {
  name: 'ToastHost',
  data() {
    return {
      icons: {
        success: 'mdi-check-circle',
        error: 'mdi-alert-circle',
        warning: 'mdi-alert',
        info: 'mdi-information',
      },
    };
  },
  computed: {
    notifications() {
      return this.$store.state.notifications?.notifications || [];
    },
  },
  methods: {
    dismiss(id) {
      this.$store.dispatch('notifications/removeNotification', id);
    },
    hold(id) {
      this.$store.dispatch('notifications/holdNotification', id);
    },
    release(id) {
      this.$store.dispatch('notifications/releaseNotification', id);
    },
  },
};
</script>

<style scoped>
.jp-toast-region {
  position: fixed;
  inset-block-end: 16px;
  inset-inline-end: 16px;
  z-index: 3000;
  pointer-events: none;
  width: min(360px, calc(100vw - 32px));
}

.jp-toast-stack {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.jp-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 8px 7px 12px;
  border-radius: var(--jp-radius-control);
  border: 1px solid var(--jp-border-light);
  border-inline-start: 3px solid var(--toast-accent);
  background: var(--jp-surface-elevated);
  color: var(--jp-text-emphasis);
  box-shadow: var(--jp-shadow-md);
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.35;
}

.jp-toast--success { --toast-accent: var(--jp-success); }
.jp-toast--error { --toast-accent: var(--jp-danger); }
.jp-toast--warning { --toast-accent: var(--jp-warning); }
.jp-toast--info { --toast-accent: var(--jp-info); }

.jp-toast__icon {
  color: var(--toast-accent) !important;
  flex-shrink: 0;
}

.jp-toast__message {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.jp-toast__count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--jp-text-muted);
}

.jp-toast__close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--jp-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard);
}

.jp-toast__close:hover,
.jp-toast__close:focus-visible {
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
}

/* Motion: opacity + transform only, never layout properties. */
.jp-toast-enter-active {
  transition: opacity var(--jp-motion-base) var(--jp-ease-decelerate), transform var(--jp-motion-base) var(--jp-ease-decelerate);
}
.jp-toast-leave-active {
  transition: opacity var(--jp-motion-fast) var(--jp-ease-accelerate), transform var(--jp-motion-fast) var(--jp-ease-accelerate);
  position: absolute;
  inset-inline: 0;
}
.jp-toast-move {
  transition: transform var(--jp-motion-base) var(--jp-ease-standard);
}
.jp-toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.jp-toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
