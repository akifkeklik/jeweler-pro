<template>
  <div class="biz-profile">
    <p class="biz-note">{{ $t('settings.business.serverNote') }}</p>
    <p v-if="loadError" class="biz-error" role="alert">{{ loadError }}</p>
    <p v-else-if="!isAdmin" class="biz-note">{{ $t('settings.business.adminOnly') }}</p>

    <form class="biz-form" @submit.prevent="save">
      <div class="biz-grid">
        <div v-for="field in fields" :key="field.key" class="biz-group">
          <label class="biz-label" :for="`biz-${field.key}`">
            {{ $t(`settings.business.${field.key}`) }}<span v-if="field.required"> *</span>
          </label>
          <input
            :id="`biz-${field.key}`"
            v-model.trim="profile[field.key]"
            :type="field.type || 'text'"
            class="biz-input"
            :class="{ tabular: field.mono }"
            :required="field.required"
            :disabled="!isAdmin || loading"
            :inputmode="field.mono ? 'numeric' : undefined"
          />
        </div>
      </div>

      <h3 class="biz-section">{{ $t('settings.business.vatTitle') }}</h3>
      <p class="biz-note">{{ $t('settings.business.vatHint') }}</p>
      <div class="biz-grid">
        <label class="biz-check">
          <input v-model="profile.vat.enabled" type="checkbox" :disabled="!isAdmin || loading" />
          {{ $t('settings.business.vatEnabled') }}
        </label>
        <div class="biz-group">
          <label class="biz-label" for="biz-vat-rate">{{ $t('settings.business.vatRate') }}</label>
          <input id="biz-vat-rate" v-model.number="vatRatePercent" type="number" min="0" max="100" step="1" class="biz-input tabular" :disabled="!isAdmin || loading" />
        </div>
        <div class="biz-group">
          <label class="biz-label" for="biz-vat-approver">{{ $t('settings.business.vatApprovedBy') }}</label>
          <input id="biz-vat-approver" v-model.trim="profile.vat.approvedBy" type="text" class="biz-input" :disabled="!isAdmin || loading" />
        </div>
      </div>

      <h3 class="biz-section">{{ $t('settings.business.complianceTitle') }}</h3>
      <p class="biz-note">{{ $t('settings.business.identificationHint') }}</p>
      <div class="biz-grid">
        <div class="biz-group">
          <label class="biz-label" for="biz-id-threshold">{{ $t('settings.business.identificationThreshold') }}</label>
          <input id="biz-id-threshold" v-model="thresholdText" type="text" inputmode="decimal" class="biz-input tabular" :disabled="!isAdmin || loading" />
        </div>
        <div class="biz-group">
          <label class="biz-label" for="biz-kvkk">{{ $t('settings.business.kvkkNoticeVersion') }}</label>
          <input id="biz-kvkk" v-model.trim="profile.compliance.kvkkNoticeVersion" type="text" class="biz-input" :disabled="!isAdmin || loading" />
        </div>
      </div>

      <p v-if="saveError" class="biz-error" role="alert">{{ saveError }}</p>
      <div v-if="isAdmin" class="biz-actions">
        <v-btn size="small" type="submit" class="jp-primary" :loading="saving" :disabled="loading">
          <v-icon start size="14">mdi-content-save-outline</v-icon>
          {{ $t('settings.business.save') }}
        </v-btn>
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="revert">{{ $t('settings.business.revert') }}</v-btn>
      </div>
    </form>
  </div>
</template>

<script>
import { t } from '@/i18n';
import { emptyProfile, fetchBusinessProfile, saveBusinessProfile } from '@/services/businessProfile';

const FIELDS = [
  { key: 'companyName', required: true },
  { key: 'authorizedPerson' },
  { key: 'taxOffice' },
  { key: 'taxNumber', mono: true },
  { key: 'mersisNo', mono: true },
  { key: 'phone', type: 'tel', mono: true },
  { key: 'email', type: 'email' },
  { key: 'address' },
  { key: 'receiptFooter' },
];

const clone = (value) => JSON.parse(JSON.stringify(value));

export default {
  name: 'BusinessProfileSettings',
  props: {
    isAdmin: { type: Boolean, default: false },
  },
  emits: ['saved'],
  data() {
    return {
      fields: FIELDS,
      profile: emptyProfile(),
      original: emptyProfile(),
      thresholdText: '',
      loading: true,
      saving: false,
      loadError: '',
      saveError: '',
    };
  },
  computed: {
    vatRatePercent: {
      get() { return this.profile.vat.standardRateBp / 100; },
      set(value) { this.profile.vat.standardRateBp = Math.round((Number(value) || 0) * 100); },
    },
  },
  async mounted() {
    await this.load();
  },
  methods: {
    apply(profile) {
      this.profile = clone(profile);
      this.original = clone(profile);
      const threshold = profile.compliance.identificationThreshold;
      this.thresholdText = threshold === null || threshold === undefined ? '' : String(threshold);
    },
    async load() {
      this.loading = true;
      this.loadError = '';
      try {
        this.apply(await fetchBusinessProfile({ force: true }));
      } catch (error) {
        this.loadError = error?.message || t('settings.business.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    async save() {
      this.saving = true;
      this.saveError = '';
      try {
        const text = this.thresholdText.trim().replace(',', '.');
        this.profile.compliance.identificationThreshold = text === '' ? null : text;
        const saved = await saveBusinessProfile(this.profile);
        this.apply(saved);
        this.$store.dispatch('notifications/showSuccess', t('settings.toasts.businessSaved'));
        this.$emit('saved', saved);
      } catch (error) {
        const fields = Array.isArray(error?.data?.fields) ? error.data.fields.map((f) => f.message).join(' · ') : '';
        this.saveError = [error?.message || t('errors.operationFailed'), fields].filter(Boolean).join(' — ');
      } finally {
        this.saving = false;
      }
    },
    revert() {
      this.apply(this.original);
      this.saveError = '';
      this.$store.dispatch('notifications/showInfo', t('settings.toasts.businessReverted'));
    },
  },
};
</script>

<style scoped>
.biz-form { display: flex; flex-direction: column; gap: 10px; }
.biz-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
@media (max-width: 720px) { .biz-grid { grid-template-columns: minmax(0, 1fr); } }
.biz-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.biz-label { font-size: 11.5px; font-weight: 600; color: var(--jp-text-muted); }
.biz-input { width: 100%; height: 34px; }
.biz-input:disabled { opacity: 0.6; }
.biz-section { font-size: 13px; font-weight: 700; color: var(--jp-text-emphasis); margin: 12px 0 0; }
.biz-note { font-size: 11.5px; color: var(--jp-text-subtle); margin: 0; }
.biz-error { font-size: 12px; color: var(--jp-danger, #d14343); margin: 0; }
.biz-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.biz-actions { display: flex; gap: 8px; margin-top: 8px; }
</style>
