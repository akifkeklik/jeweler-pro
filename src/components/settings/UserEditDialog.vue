<template>
  <v-dialog v-model="open" max-width="520" persistent>
    <v-card class="jp-modal-card">
      <div class="dialog-header">
        <v-icon class="mr-2" size="18">mdi-account-edit</v-icon>
        <span>{{ $t('settings.users.editUserTitle') }}</span>
        <v-spacer></v-spacer>
        <v-btn icon size="x-small" variant="text" :aria-label="$t('common.close')" @click="open = false"><v-icon size="16">mdi-close</v-icon></v-btn>
      </div>
      <v-card-text>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <form @submit.prevent="submit">
          <div class="form-group mb-3">
            <label class="form-label" for="eu-name">{{ $t('settings.users.fullName') }}</label>
            <input id="eu-name" v-model.trim="form.name" required type="text" class="settings-input-full" />
          </div>
          <div class="form-group mb-3">
            <label class="form-label" for="eu-email">{{ $t('settings.users.emailFixed') }}</label>
            <input id="eu-email" :value="form.email" disabled type="email" class="settings-input-full" />
          </div>
          <div class="settings-grid-2 mb-3">
            <div class="form-group">
              <label class="form-label" for="eu-role">{{ $t('settings.users.systemRole') }}</label>
              <select id="eu-role" v-model="form.role" :disabled="!isAdmin || isSelf" class="settings-select-full">
                <option v-for="r in (metadata ? metadata.roles : [])" :key="r.id" :value="r.id">{{ roleLabel(r.id, r.label) }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="eu-branch">{{ $t('settings.users.assignedBranch') }}</label>
              <input id="eu-branch" v-model.trim="form.branch" type="text" class="settings-input-full" :disabled="!isAdmin" />
            </div>
          </div>
          <div v-if="!isSelf" class="form-group mb-3">
            <label class="form-label" for="eu-pwd">{{ $t('settings.users.newPassword') }}</label>
            <input id="eu-pwd" v-model="form.newPassword" :minlength="minLength" type="password" autocomplete="new-password" :placeholder="$t('settings.users.newPasswordPlaceholder')" class="settings-input-full" />
          </div>
          <div v-if="!isSelf" class="form-group mb-3">
            <span class="form-label">{{ $t('settings.users.extraPermissions') }} <span class="setting-hint">{{ $t('settings.users.extraHint') }}</span></span>
            <div class="permissions-checkbox-grid">
              <label
                v-for="p in extraPermissions"
                :key="p.id"
                class="perm-checkbox-item"
                :class="{ 'perm-disabled': !assignable(p.id) }"
                :title="assignable(p.id) ? p.id : $t('settings.users.cannotDelegate')"
              >
                <!-- A permission the actor cannot grant stays removable if the user already has it. -->
                <input
                  v-model="form.customPermissions"
                  type="checkbox"
                  class="styled-checkbox"
                  :value="p.id"
                  :disabled="!assignable(p.id) && !form.customPermissions.includes(p.id)"
                />
                <span>{{ permissionLabel(p.id, p.label) }}</span>
              </label>
            </div>
          </div>
          <div class="dialog-actions-row">
            <v-btn variant="text" size="small" @click="open = false">{{ $t('common.cancel') }}</v-btn>
            <v-btn size="small" type="submit" class="jp-primary" :loading="saving">{{ $t('common.saveChanges') }}</v-btn>
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
  type ManagedUser,
  type UserMetadata,
} from '@/services/settingsView';

interface UserUpdate { name: string; customPermissions?: string[]; branch?: string; role?: string; password?: string }

const formFrom = (u: ManagedUser | null) => ({
  id: u?.id || '',
  name: u?.name || '',
  email: u?.email || '',
  role: u?.role || 'staff',
  branch: u?.branch || '',
  customPermissions: [...(u?.customPermissions || [])],
  newPassword: '',
});

/**
 * Edits a user. Only admins change role and branch; nobody changes their own
 * role, permissions or password here (the security tab owns the latter).
 */
export default defineComponent({
  name: 'UserEditDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    user: { type: Object as PropType<ManagedUser | null>, default: null },
    metadata: { type: Object as PropType<UserMetadata | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ form: formFrom(null), error: '', saving: false, minLength: MIN_PASSWORD_LENGTH }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    isAdmin(): boolean {
      return authState.user?.role === 'admin';
    },
    isSelf(): boolean {
      return this.form.id === authState.user?.id;
    },
    extraPermissions() {
      return extraPermissionsFor(this.metadata, this.form.role);
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value) return;
      this.form = formFrom(this.user);
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
      this.error = '';
      const payload: UserUpdate = { name: this.form.name };
      if (!this.isSelf) payload.customPermissions = withoutRolePermissions(this.metadata, this.form.role, this.form.customPermissions);
      if (this.isAdmin) {
        payload.branch = this.form.branch;
        if (!this.isSelf) payload.role = this.form.role;
      }
      if (this.form.newPassword) {
        if (this.form.newPassword.length < MIN_PASSWORD_LENGTH) {
          this.error = t('settings.users.passwordTooShort');
          return;
        }
        payload.password = this.form.newPassword;
      }
      this.saving = true;
      try {
        await apiService.put(`/api/users/${this.form.id}`, payload);
        this.open = false;
        this.$store.dispatch('notifications/showSuccess', t('settings.users.updated'));
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
