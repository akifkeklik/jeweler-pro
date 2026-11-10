<template>
  <v-dialog
    :model-value="state.open"
    max-width="420"
    :aria-label="state.title || $t('confirm.title')"
    @update:model-value="(v) => !v && cancel()"
  >
    <v-card class="jp-confirm" data-testid="confirm-dialog">
      <div class="jp-confirm__body">
        <div class="jp-confirm__icon" :class="`tone-${state.tone || 'default'}`" aria-hidden="true">
          <v-icon size="18">{{ icon }}</v-icon>
        </div>
        <div class="jp-confirm__copy">
          <h2 class="jp-confirm__title">{{ state.title || $t('confirm.title') }}</h2>
          <p class="jp-confirm__message">{{ state.message }}</p>
          <label v-if="state.inputLabel" class="jp-confirm__field">
            <span>{{ state.inputLabel }}</span>
            <input
              ref="field"
              v-model="state.value"
              type="text"
              maxlength="200"
              data-testid="confirm-input"
              @keydown.enter.prevent="state.value.trim() && accept()"
            />
          </label>
        </div>
      </div>
      <div class="jp-confirm__actions">
        <v-btn size="small" class="jp-btn-ghost" data-testid="confirm-cancel" @click="cancel">
          {{ state.cancelLabel || $t('common.cancel') }}
        </v-btn>
        <v-btn
          size="small"
          :class="state.tone === 'danger' ? 'jp-btn-danger' : 'jp-primary'"
          :disabled="Boolean(state.inputLabel) && !state.value.trim()"
          data-testid="confirm-accept"
          @click="accept"
        >
          {{ state.confirmLabel || $t('common.confirm') }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script>
import { confirmState, settleConfirm } from '@/services/confirm';

export default {
  name: 'ConfirmHost',
  computed: {
    state() {
      return confirmState;
    },
    icon() {
      return { danger: 'mdi-alert-octagon-outline', warning: 'mdi-alert-outline' }[this.state.tone] || 'mdi-help-circle-outline';
    },
  },
  watch: {
    'state.open'(open) {
      if (open && this.state.inputLabel) this.$nextTick(() => this.$refs.field?.focus());
    },
  },
  methods: {
    accept() {
      settleConfirm(true);
    },
    cancel() {
      settleConfirm(false);
    },
  },
};
</script>

<style scoped>
.jp-confirm {
  padding: 0 !important;
}
.jp-confirm__body {
  display: flex;
  gap: 12px;
  padding: 16px 16px 12px;
}
.jp-confirm__icon {
  width: 34px;
  height: 34px;
  border-radius: var(--jp-radius-sm);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--jp-gold-subtle);
  color: var(--jp-primary);
}
.jp-confirm__icon.tone-danger {
  background: var(--jp-danger-bg);
  color: var(--jp-danger);
}
.jp-confirm__icon.tone-warning {
  background: var(--jp-warning-bg);
  color: var(--jp-warning);
}
.jp-confirm__title {
  margin: 0 0 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}
.jp-confirm__message {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--jp-text-muted);
}
.jp-confirm__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--jp-text-muted);
}
.jp-confirm__field input {
  height: 34px;
  width: 100%;
}
.jp-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 14px;
}
</style>
