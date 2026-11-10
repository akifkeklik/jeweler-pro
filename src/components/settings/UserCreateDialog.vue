<template>
  <v-dialog v-model="open" max-width="520" persistent>
    <v-card class="jp-modal-card">
      <div class="dialog-header">
        <v-icon class="mr-2" size="18">mdi-account-plus</v-icon>
        <span>{{ $t('settings.users.newUserTitle') }}</span>
        <v-spacer></v-spacer>
        <v-btn icon size="x-small" variant="text" :aria-label="$t('common.close')" @click="open = false"><v-icon size="16">mdi-close</v-icon></v-btn>
      </div>
      <v-card-text>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <form @submit.prevent="submit">
          <div class="form-group mb-3">
            <label class="form-label" for="nu-name">{{ $t('settings.users.fullName') }} *</label>
            <input id="nu-name" v-model.trim="form.name" required type="text" :placeholder="$t('settings.users.fullNamePlaceholder')" class="settings-input-full" />
          </div>
          <div class="form-group mb-3">
            <label class="form-label" for="nu-email">{{ $t('settings.business.email') }} *</label>
            <input id="nu-email" v-model.trim="form.email" required type="email" class="settings-input-full" />
          </div>
          <div class="form-group mb-3">
            <label class="form-label" for="nu-pwd">{{ $t('settings.users.initialPassword') }} *</label>
            <input id="nu-pwd" v-model="form.password" required :minlength="minLength" type="password" autocomplete="new-password" class="settings-input-full" />
          </div>
          <div class="settings-grid-2 mb-3">
            <div class="form-group">
              <label class="form-label" for="nu-role">{{ $t('settings.users.systemRole') }} *</label>
              <select id="nu-role" v-model="form.role" class="settings-select-full" data-testid="new-user-role">
                <option v-for="r in assignableRoles" :key="r.id" :value="r.id">{{ roleLabel(r.id, r.label) }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="nu-branch">{{ $t('settings.users.assignedBranch') }}</label>
              <input id="nu-branch" v-model.trim="form.branch" type="text" class="settings-input-full" :disabled="!isAdmin" :title="isAdmin ? '' : $t('settings.users.ownBranchOnly')" />
            </div>
          </div>
          <div class="form-group mb-3">
            <span class="form-label">{{ $t('settings.users.extraPermissions') }} <span class="setting-hint">{{ $t('settings.users.extraHint') }}</span></span>
            <div class="permissions-checkbox-grid">
              <label
                v-for="p in extraPermissions"
                :key="p.id"
                class="perm-checkbox-item"
                :class="{ 'perm-disabled': !assignable(p.id) }"
                :title="assignable(p.id) ? p.id : $t('settings.users.cannotDelegate')"
              >
                <input v-model="form.customPermissions" type="checkbox" class="styled-checkbox" :value="p.id" :disabled="!assignable(p.id)" />
                <span>{{ permissionLabel(p.id, p.label) }}</span>
              </label>
            </div>
          </div>
          <div class="dialog-actions-row">
            <v-btn variant="text" size="small" @click="open = false">{{ $t('common.cancel') }}</v-btn>
            <v-btn size="small" type="submit" class="jp-primary" :loading="saving">{{ $t('settings.users.saveUser') }}</v-btn>
          </div>
        </form>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { authState } from '@/services/authSession';
import { t } from '@/i18n';
import {
  extraPermissionsFor,
  isAssignable,
  MIN_PASSWORD_LENGTH,
  permissionLabel,
  roleLabel,
  withoutRolePermissions,
  type UserMetadata,
} from '@/services/settingsView';

const emptyForm = (branch = '') => ({ name: '', email: '', password: '', role: 'staff', branch, customPermissions: [] as string[] });

/** Creates a staff account; a manager can only create staff in their own branch (enforced by the API). */
export default defineComponent({
  name: 'UserCreateDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    metadata: { type: Object as PropType<UserMetadata | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ form: emptyForm(), error: '', saving: false, minLength: MIN_PASSWORD_LENGTH }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    isAdmin(): boolean {
      return authState.user?.role === 'admin';
    },
    assignableRoles() {
      const metadata = this.metadata;
      if (!metadata) return [];
      return metadata.roles.filter((r) => metadata.assignableRoles.includes(r.id));
    },
    extraPermissions() {
      return extraPermissionsFor(this.metadata, this.form.role);
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value) return;
      this.form = emptyForm(authState.user?.branch || '');
      this.error = '';
    },
  },
  methods: {
    roleLabel,
    permissionLabel(id: string, fallback?: string) {
      return permissionLabel(id, fallback, this.metadata?.permissions || []);
    },
    assignable(id: string) {
      return isAssignable(this.metadata, id);
    },
    async submit() {
      if (this.form.password.length < MIN_PASSWORD_LENGTH) {
        this.error = t('settings.users.passwordTooShort');
        return;
      }
      this.saving = true;
      this.error = '';
      try {
        await apiService.post('/api/users', {
          ...this.form,
          customPermissions: withoutRolePermissions(this.metadata, this.form.role, this.form.customPermissions),
        });
        this.open = false;
        this.$store.dispatch('notifications/showSuccess', t('settings.users.created'));
        this.$emit('saved');
      } catch (err) {
        this.error = (err as Error)?.message || t('errors.operationFailed');
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>
<style scoped src="@/styles/permission-picker.css"></style>
