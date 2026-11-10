<template>
  <div class="jp-page-shell settings-page-shell">
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('settings.eyebrow') }}</div>
          <h1 class="page-title">
            <v-icon size="20" class="title-icon">mdi-cog-outline</v-icon>
            {{ $t('settings.title') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :title="$t('settings.resetDefaultsHint')" data-testid="reset-preferences" @click="resetToDefaults">
          <v-icon start size="14">mdi-restore</v-icon>
          {{ $t('settings.resetDefaults') }}
        </v-btn>
      </div>
    </div>

    <div class="settings-workspace-layout">
      <nav class="settings-tabs-sidebar jp-card" role="tablist" :aria-label="$t('settings.title')">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-nav-item"
          :class="{ active: currentTab === tab.id }"
          :aria-selected="currentTab === tab.id ? 'true' : 'false'"
          :data-testid="`settings-tab-${tab.id}`"
          @click="currentTab = tab.id"
        >
          <v-icon size="16" class="tab-icon">{{ tab.icon }}</v-icon>
          <span class="tab-text">
            <strong>{{ $t(`settings.tabs.${tab.id}.title`) }}</strong>
            <small>{{ $t(`settings.tabs.${tab.id}.subtitle`) }}</small>
          </span>
        </button>
      </nav>

      <section class="settings-content-card jp-card" role="tabpanel">
        <!-- APPEARANCE & LANGUAGE -->
        <div v-if="currentTab === 'appearance'" class="tab-pane" data-testid="appearance-panel">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.appearance.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.appearance.subtitle') }}</p>
          </header>

          <div class="pref-row">
            <div class="pref-label">
              <span class="setting-title">{{ $t('settings.appearance.mode') }}</span>
              <span v-if="settings.themeMode === 'system'" class="setting-hint">
                {{ $t('settings.appearance.systemHint', { mode: $t(`settings.appearance.${resolvedMode}`) }) }}
              </span>
            </div>
            <div class="segmented" role="radiogroup" :aria-label="$t('settings.appearance.mode')">
              <button
                v-for="item in modeOptions"
                :key="item.value"
                type="button"
                role="radio"
                class="segmented-btn"
                :class="{ selected: settings.themeMode === item.value }"
                :aria-checked="settings.themeMode === item.value ? 'true' : 'false'"
                :data-testid="`mode-${item.value}`"
                @click="setMode(item.value)"
              >
                <v-icon size="15">{{ item.icon }}</v-icon>
                <span>{{ $t(`settings.appearance.${item.value}`) }}</span>
              </button>
            </div>
          </div>

          <div class="pref-block">
            <div class="pref-label">
              <span class="setting-title">{{ $t('settings.appearance.palette') }}</span>
              <span class="setting-hint">{{ $t('settings.appearance.paletteHint') }}</span>
            </div>
            <div class="palette-grid" role="radiogroup" :aria-label="$t('settings.appearance.palette')">
              <button
                v-for="p in paletteCards"
                :key="p.id"
                type="button"
                role="radio"
                class="palette-card"
                :class="{ selected: settings.palette === p.id }"
                :aria-checked="settings.palette === p.id ? 'true' : 'false'"
                :aria-label="$t(`palettes.${p.id}.name`)"
                :data-testid="`palette-${p.id}`"
                @click="setPalette(p.id)"
              >
                <!-- Miniature of the real UI rendered from the palette's own tokens. -->
                <span class="palette-preview" :style="{ background: p.c.bg, borderColor: p.c.border }" aria-hidden="true">
                  <span class="pv-sidebar" :style="{ background: p.c.surface, borderColor: p.c.border }">
                    <span class="pv-dot" :style="{ background: p.c.primary }"></span>
                    <span class="pv-line" :style="{ background: p.c.textSubtle }"></span>
                    <span class="pv-line active" :style="{ background: p.c.primary }"></span>
                    <span class="pv-line" :style="{ background: p.c.textSubtle }"></span>
                  </span>
                  <span class="pv-main">
                    <span class="pv-card" :style="{ background: p.c.card, borderColor: p.c.border }">
                      <span class="pv-text" :style="{ background: p.c.text }"></span>
                      <span class="pv-text short" :style="{ background: p.c.textMuted }"></span>
                      <span class="pv-bars">
                        <span :style="{ background: p.c.primary, height: '70%' }"></span>
                        <span :style="{ background: p.c.secondary, height: '45%' }"></span>
                        <span :style="{ background: p.c.accent, height: '90%' }"></span>
                      </span>
                    </span>
                    <span class="pv-button" :style="{ background: p.c.primary }"></span>
                  </span>
                </span>
                <span class="palette-meta">
                  <strong>{{ $t(`palettes.${p.id}.name`) }}</strong>
                  <small>{{ $t(`palettes.${p.id}.tagline`) }}</small>
                </span>
                <v-icon v-if="settings.palette === p.id" size="16" class="palette-check">mdi-check-circle</v-icon>
              </button>
            </div>
          </div>

          <div class="pref-block">
            <div class="pref-label">
              <span class="setting-title">{{ $t('settings.appearance.language') }}</span>
              <span class="setting-hint">{{ $t('settings.appearance.languageHint') }}</span>
            </div>
            <div class="language-grid" role="radiogroup" :aria-label="$t('settings.appearance.language')">
              <button
                v-for="option in languages"
                :key="option.value"
                type="button"
                role="radio"
                class="lang-btn"
                :lang="option.value"
                :class="{ selected: settings.language === option.value }"
                :aria-checked="settings.language === option.value ? 'true' : 'false'"
                :data-testid="`language-${option.value}`"
                @click="setLanguage(option.value)"
              >
                <span>{{ option.native }}</span>
                <v-icon v-if="settings.language === option.value" size="14" class="lang-check">mdi-check</v-icon>
              </button>
            </div>
          </div>

          <div class="pref-row motion-row">
            <div class="pref-label">
              <span id="motion-label" class="setting-title">{{ $t('settings.appearance.motion') }}</span>
              <span class="setting-hint">{{ $t('settings.appearance.motionDescription') }}</span>
              <span v-if="systemReducedMotion" class="setting-hint system-note">
                <v-icon size="12">mdi-information-outline</v-icon>
                {{ $t('settings.appearance.motionSystem') }}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              class="jp-switch"
              :class="{ on: settings.reducedMotion }"
              :aria-checked="settings.reducedMotion ? 'true' : 'false'"
              aria-labelledby="motion-label"
              data-testid="reduced-motion-toggle"
              @click="setReducedMotion(!settings.reducedMotion)"
            >
              <span class="jp-switch-thumb"></span>
            </button>
          </div>

          <div class="settings-grid-2 pref-block">
            <div class="form-group">
              <label class="form-label" for="pref-density">{{ $t('settings.appearance.density') }}</label>
              <select id="pref-density" :value="settings.density" class="settings-select-full" @change="setPreference('density', $event.target.value)">
                <option value="comfortable">{{ $t('settings.appearance.comfortable') }}</option>
                <option value="compact">{{ $t('settings.appearance.compact') }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="pref-sidebar">{{ $t('settings.appearance.sidebar') }}</label>
              <select id="pref-sidebar" :value="settings.sidebarMode" class="settings-select-full" data-testid="sidebar-mode" @change="setPreference('sidebarMode', $event.target.value)">
                <option value="pinned">{{ $t('settings.appearance.sidebarPinned') }}</option>
                <option value="hover">{{ $t('settings.appearance.sidebarHover') }}</option>
                <option value="collapsed">{{ $t('settings.appearance.sidebarCollapsed') }}</option>
              </select>
              <small class="form-subtext">{{ $t('settings.appearance.sidebarHint') }}</small>
            </div>
          </div>
        </div>

        <!-- REGIONAL FORMATS -->
        <div v-else-if="currentTab === 'regional'" class="tab-pane">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.regional.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.regional.subtitle') }}</p>
          </header>
          <div class="settings-grid-2">
            <div class="form-group">
              <label class="form-label" for="pref-date">{{ $t('settings.regional.dateFormat') }}</label>
              <select id="pref-date" :value="settings.dateFormat" class="settings-select-full" @change="setPreference('dateFormat', $event.target.value)">
                <option value="locale">{{ $t('settings.regional.locale') }}</option>
                <option value="iso">{{ $t('settings.regional.iso') }}</option>
                <option value="day-month-year">{{ $t('settings.regional.dayMonthYear') }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="pref-number">{{ $t('settings.regional.numberFormat') }}</label>
              <select id="pref-number" :value="settings.numberFormat" class="settings-select-full" @change="setPreference('numberFormat', $event.target.value)">
                <option value="locale">{{ $t('settings.regional.locale') }}</option>
                <option value="western">{{ $t('settings.regional.western') }}</option>
              </select>
            </div>
          </div>
          <div class="format-preview-strip mt-3" data-testid="format-preview">
            <span class="preview-label">{{ $t('settings.regional.preview') }}</span>
            <span>{{ $t('settings.regional.previewDate') }}: <strong class="tabular">{{ $date(previewNow, 'long') }} · {{ $time(previewNow) }}</strong></span>
            <span>{{ $t('settings.regional.previewMoney') }}: <strong class="tabular">{{ $money(1234567.89) }}</strong></span>
            <span>{{ $t('settings.regional.previewWeight') }}: <strong class="tabular">{{ $weight(12.345, 3) }}</strong></span>
          </div>
        </div>

        <!-- BUSINESS -->
        <div v-else-if="currentTab === 'business'" class="tab-pane">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.business.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.business.subtitle') }}</p>
          </header>
          <BusinessProfileSettings :is-admin="isAdmin" />
        </div>

        <!-- USERS -->
        <div v-else-if="currentTab === 'users'" class="tab-pane tab-pane-wide">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.users.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.users.subtitle') }}</p>
          </header>

          <div class="account-info-grid">
            <div class="info-tile">
              <span class="tile-label">{{ $t('settings.users.profile') }}</span>
              <strong class="tile-val">{{ userName }}</strong>
            </div>
            <div class="info-tile">
              <span class="tile-label">{{ $t('settings.users.email') }}</span>
              <strong class="tile-val">{{ userEmail }}</strong>
            </div>
            <div class="info-tile">
              <span class="tile-label">{{ $t('settings.users.role') }}</span>
              <strong class="tile-val">{{ roleLabel(userRole) }}</strong>
            </div>
            <div class="info-tile">
              <span class="tile-label">{{ $t('settings.users.session') }}</span>
              <strong class="tile-val"><span class="live-dot mr-1"></span>{{ sessionTypeLabel }}</strong>
            </div>
          </div>

          <div class="permissions-card mt-4" data-testid="my-permissions">
            <span class="setting-title">{{ $t('settings.users.myPermissions') }}</span>
            <div class="badge-wrap mt-2">
              <span v-for="p in myPermissions" :key="p" class="jp-badge jp-badge-neutral" :title="p">{{ permissionLabel(p) }}</span>
              <span v-if="!myPermissions.length" class="setting-hint">{{ $t('settings.users.noPermissions') }}</span>
            </div>
          </div>

          <div v-if="metadata" class="permissions-card mt-4" data-testid="permission-matrix">
            <span class="setting-title">{{ $t('settings.users.matrix') }}</span>
            <div class="table-wrap mt-2">
              <table class="jp-enterprise-table">
                <thead>
                  <tr>
                    <th>{{ $t('settings.users.module') }}</th>
                    <th v-for="role in metadata.roles" :key="role.id" class="text-center col-role">{{ roleLabel(role.id, role.label) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="perm in metadata.permissions" :key="perm.id">
                    <td>
                      {{ permissionLabel(perm.id, perm.label) }}
                      <span class="perm-id">{{ perm.id }}</span>
                    </td>
                    <td v-for="role in metadata.roles" :key="role.id" class="text-center">
                      <v-icon
                        v-if="role.permissions.includes(perm.id)"
                        size="16"
                        class="ok-icon"
                        :aria-label="$t('settings.users.granted')"
                      >mdi-check-circle</v-icon>
                      <v-icon v-else size="16" class="no-icon" :aria-label="$t('settings.users.denied')">mdi-minus-circle-outline</v-icon>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="can('users:read')" class="user-management-card mt-4" data-testid="user-management">
            <div class="card-head">
              <div>
                <span class="setting-title">{{ $t('settings.users.staff') }}</span>
                <p class="setting-hint mb-0">{{ $t('settings.users.staffHint') }}</p>
              </div>
              <div class="card-head-actions">
                <v-btn size="x-small" variant="text" :loading="loadingUsers" @click="fetchUsers">
                  <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
                </v-btn>
                <v-btn v-if="can('users:write')" size="small" class="jp-primary" data-testid="add-user" @click="openAddUserModal">
                  <v-icon size="14" class="mr-1">mdi-account-plus</v-icon>{{ $t('settings.users.addUser') }}
                </v-btn>
              </div>
            </div>
            <div class="table-wrap">
              <table class="jp-enterprise-table">
                <thead>
                  <tr>
                    <th>{{ $t('settings.users.colUser') }}</th>
                    <th>{{ $t('settings.users.colRole') }}</th>
                    <th>{{ $t('settings.users.colBranch') }}</th>
                    <th>{{ $t('settings.users.colExtra') }}</th>
                    <th>{{ $t('common.status') }}</th>
                    <th class="text-right col-actions">{{ $t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in usersList" :key="u.id">
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar-sm">{{ getUserInitials(u.name || u.email) }}</div>
                        <div>
                          <strong class="d-block">{{ u.name || $t('settings.users.unnamed') }}</strong>
                          <span class="cell-sub">{{ u.email }}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="jp-badge" :class="u.role === 'admin' ? 'jp-badge-warning' : u.role === 'manager' ? 'jp-badge-info' : 'jp-badge-neutral'">
                        {{ roleLabel(u.role) }}
                      </span>
                    </td>
                    <td class="cell-sub">{{ u.branch || '—' }}</td>
                    <td>
                      <div v-if="u.customPermissions && u.customPermissions.length" class="badge-wrap">
                        <span v-for="cp in u.customPermissions.slice(0, 2)" :key="cp" class="jp-badge jp-badge-neutral" :title="cp">{{ permissionLabel(cp) }}</span>
                        <span v-if="u.customPermissions.length > 2" class="jp-badge jp-badge-neutral">+{{ u.customPermissions.length - 2 }}</span>
                      </div>
                      <span v-else class="cell-sub">{{ $t('settings.users.defaultRolePerms') }}</span>
                    </td>
                    <td>
                      <span class="jp-badge" :class="u.active ? 'jp-badge-success' : 'jp-badge-danger'">
                        {{ u.active ? $t('common.active') : $t('common.inactive') }}
                      </span>
                    </td>
                    <td class="text-right">
                      <div class="row-actions" :data-testid="`user-actions-${u.email}`">
                        <v-btn
                          v-if="can('users:write') && (u.id === user.id || canManageUser(u))"
                          icon size="x-small" variant="text"
                          :title="$t('settings.users.editTitle')" :aria-label="$t('settings.users.editTitle')"
                          @click="openEditUser(u)"
                        ><v-icon size="14">mdi-pencil-outline</v-icon></v-btn>
                        <v-btn
                          v-if="can('users:write') && u.id !== user.id && canManageUser(u) && u.active"
                          icon size="x-small" variant="text"
                          :title="$t('settings.users.sendReset')" :aria-label="$t('settings.users.sendReset')"
                          @click="sendResetLink(u)"
                        ><v-icon size="14">mdi-email-lock-outline</v-icon></v-btn>
                        <v-btn
                          v-if="can('users:write') && u.id !== user.id && canManageUser(u)"
                          icon size="x-small" variant="text"
                          :title="$t('settings.users.revokeAll')" :aria-label="$t('settings.users.revokeAll')"
                          @click="revokeUserSessions(u)"
                        ><v-icon size="14">mdi-logout-variant</v-icon></v-btn>
                        <v-btn
                          v-if="can('users:write') && u.id !== user.id && canManageUser(u)"
                          icon size="x-small" variant="text"
                          :class="u.active ? 'warn-action' : 'ok-action'"
                          :title="u.active ? $t('settings.users.deactivate') : $t('settings.users.activate')"
                          :aria-label="u.active ? $t('settings.users.deactivate') : $t('settings.users.activate')"
                          @click="toggleUserStatus(u)"
                        ><v-icon size="14">{{ u.active ? 'mdi-account-off-outline' : 'mdi-account-check-outline' }}</v-icon></v-btn>
                        <v-btn
                          v-if="can('users:delete') && u.id !== user.id && canManageUser(u) && !u.active"
                          icon size="x-small" variant="text" class="danger-action"
                          :title="$t('settings.users.deleteForever')" :aria-label="$t('settings.users.deleteForever')"
                          @click="confirmDeleteUser(u)"
                        ><v-icon size="14">mdi-delete-outline</v-icon></v-btn>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!usersList.length && !loadingUsers">
                    <td colspan="6" class="empty-state-cell">{{ $t('settings.users.empty') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="can('audit:read')" class="audit-log-card mt-4">
            <div class="card-head">
              <div>
                <span class="setting-title">{{ $t('settings.users.audit') }}</span>
                <p class="setting-hint mb-0">{{ $t('settings.users.auditHint') }}</p>
              </div>
              <v-btn size="x-small" variant="text" :loading="loadingAuditLogs" @click="fetchAuditLogs">
                <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
              </v-btn>
            </div>
            <div class="table-wrap audit-table-wrap">
              <table class="jp-enterprise-table">
                <thead>
                  <tr>
                    <th class="col-time">{{ $t('settings.users.auditTime') }}</th>
                    <th>{{ $t('settings.users.auditAction') }}</th>
                    <th>{{ $t('settings.users.auditResource') }}</th>
                    <th>{{ $t('settings.users.auditResourceId') }}</th>
                    <th>{{ $t('settings.users.auditCorrelation') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="log in auditLogs" :key="log._id">
                    <td class="tabular cell-sub">{{ $dateTime(log.createdAt, true) }}</td>
                    <td><span class="jp-badge jp-badge-info">{{ log.action }}</span></td>
                    <td>{{ log.resourceType }}</td>
                    <td class="tabular cell-sub">#{{ log.resourceId }}</td>
                    <td class="tabular cell-sub">{{ log.correlationId ? log.correlationId.slice(0, 12) + '…' : '—' }}</td>
                  </tr>
                  <tr v-if="!auditLogs.length">
                    <td colspan="5" class="empty-state-cell">{{ $t('settings.users.auditEmpty') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- SECURITY -->
        <div v-else-if="currentTab === 'security'" class="tab-pane tab-pane-wide">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.security.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.security.subtitle') }}</p>
          </header>

          <div class="password-update-card">
            <span class="setting-title">{{ $t('settings.security.changePassword') }}</span>
            <p class="setting-hint mb-3">{{ $t('settings.security.policy') }}</p>
            <form @submit.prevent="changePassword">
              <div class="settings-grid-3">
                <div class="form-group">
                  <label class="form-label" for="pwd-current">{{ $t('settings.security.current') }} *</label>
                  <input id="pwd-current" v-model="password.current" required type="password" class="pwd-input settings-input-full" autocomplete="current-password" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="pwd-next">{{ $t('settings.security.next') }} *</label>
                  <input id="pwd-next" v-model="password.next" required minlength="12" type="password" :placeholder="$t('settings.security.minLength')" class="pwd-input settings-input-full" autocomplete="new-password" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="pwd-confirm">{{ $t('settings.security.confirm') }} *</label>
                  <input id="pwd-confirm" v-model="password.confirm" required minlength="12" type="password" class="pwd-input settings-input-full" autocomplete="new-password" />
                </div>
              </div>
              <p v-if="passwordError" class="pwd-error-msg mt-2" role="alert">
                <v-icon size="14" class="mr-1">mdi-alert-circle</v-icon>{{ passwordError }}
              </p>
              <div class="mt-3">
                <v-btn
                  size="small" type="submit" class="jp-primary" :loading="passwordLoading"
                  :disabled="!password.current || password.next.length < 12 || password.next !== password.confirm"
                >
                  <v-icon start size="14">mdi-lock-reset</v-icon>{{ $t('settings.security.changePassword') }}
                </v-btn>
              </div>
            </form>
          </div>

          <div class="session-security-card mt-4">
            <span class="setting-title">{{ $t('settings.security.sessionInfo') }}</span>
            <div class="session-meta-row mt-2">
              <div class="meta-item">
                <span class="meta-label">{{ $t('settings.security.sessionType') }}</span>
                <span class="meta-val">{{ sessionTypeLabel }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('settings.security.sessionExpiry') }}</span>
                <span class="meta-val tabular">{{ sessionExpiryLabel }}</span>
              </div>
            </div>

            <span class="setting-title mt-4 d-block">{{ $t('settings.security.devices') }}</span>
            <div class="table-wrap mt-2" data-testid="active-sessions">
              <table class="jp-enterprise-table">
                <thead>
                  <tr>
                    <th>{{ $t('settings.security.colDevice') }}</th>
                    <th>IP</th>
                    <th>{{ $t('settings.security.colType') }}</th>
                    <th>{{ $t('settings.security.colLastUsed') }}</th>
                    <th class="text-right col-narrow"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in sessions" :key="s.id">
                    <td :title="s.userAgent">
                      {{ describeUserAgent(s.userAgent) }}
                      <span v-if="s.current" class="jp-badge jp-badge-success ml-1">{{ $t('settings.security.thisDevice') }}</span>
                    </td>
                    <td class="tabular cell-sub">{{ s.ip || '—' }}</td>
                    <td class="cell-sub">{{ s.persistent ? $t('settings.security.rememberMe') : $t('settings.security.browser') }}</td>
                    <td class="tabular cell-sub">{{ $dateTime(s.lastUsedAt) }}</td>
                    <td class="text-right">
                      <v-btn v-if="!s.current" size="x-small" variant="text" class="danger-action" @click="revokeSession(s)">{{ $t('settings.security.endSession') }}</v-btn>
                    </td>
                  </tr>
                  <tr v-if="!sessions.length && !loadingSessions">
                    <td colspan="5" class="empty-state-cell">{{ $t('settings.security.noSessions') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-3 d-flex flex-wrap ga-2">
              <v-btn size="small" class="jp-btn-danger" data-testid="logout-this-device" @click="terminateAllSessions">
                <v-icon start size="14">mdi-logout-variant</v-icon>{{ $t('settings.security.logoutHere') }}
              </v-btn>
              <v-btn size="small" class="jp-secondary" data-testid="logout-all-devices" @click="logoutEverywhere">
                <v-icon start size="14">mdi-devices</v-icon>{{ $t('settings.security.logoutEverywhere') }}
              </v-btn>
            </div>
          </div>
        </div>

        <!-- MARKET -->
        <div v-else-if="currentTab === 'market'" class="tab-pane">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.market.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.market.subtitle') }}</p>
          </header>
          <div class="card-head">
            <span class="setting-title">{{ $t('settings.market.providers') }}</span>
            <v-btn size="x-small" variant="text" :loading="loadingProviders" @click="refreshMarketProviders">
              <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
            </v-btn>
          </div>
          <div class="providers-grid">
            <div v-for="p in marketProviders" :key="p.id" class="provider-box">
              <div class="provider-header">
                <span class="status-indicator-dot" :class="p.status === 'ok' ? 'ok' : p.status === 'stale' ? 'warn' : 'err'"></span>
                <strong>{{ p.name }}</strong>
                <span class="jp-badge ml-auto" :class="p.status === 'ok' ? 'jp-badge-success' : p.status === 'stale' ? 'jp-badge-warning' : 'jp-badge-neutral'">
                  {{ p.status === 'ok' ? $t('settings.market.quotes', { count: p.quoteCount }) : p.status === 'stale' ? $t('common.stale') : $t('settings.market.notConfigured') }}
                </span>
              </div>
              <p class="setting-hint mt-1 mb-0">{{ providerDescription(p.id) }}</p>
            </div>
            <p v-if="!marketProviders.length && !loadingProviders" class="setting-hint">{{ $t('common.noData') }}</p>
          </div>
          <div class="settings-grid-2 mt-4">
            <div class="form-group">
              <label class="form-label" for="pref-refresh">{{ $t('settings.market.autoRefresh') }}</label>
              <select id="pref-refresh" :value="settings.marketAutoRefresh" class="settings-select-full" @change="setPreference('marketAutoRefresh', Number($event.target.value))">
                <option :value="15">{{ $t('settings.market.every', { count: 15 }) }}</option>
                <option :value="30">{{ $t('settings.market.every', { count: 30 }) }} ({{ $t('settings.market.recommended') }})</option>
                <option :value="60">{{ $t('settings.market.every', { count: 60 }) }}</option>
                <option :value="0">{{ $t('settings.market.manual') }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SYSTEM -->
        <div v-else class="tab-pane">
          <header class="section-title-wrap">
            <h2 class="pane-title">{{ $t('settings.system.title') }}</h2>
            <p class="pane-subtitle">{{ $t('settings.system.subtitle') }}</p>
          </header>
          <div class="settings-grid-2">
            <div class="form-group">
              <label class="form-label" for="pref-lowstock">{{ $t('settings.system.lowStock') }}</label>
              <input id="pref-lowstock" :value="settings.lowStockThreshold" type="number" min="1" max="50" class="settings-input-full tabular" @change="setPreference('lowStockThreshold', Number($event.target.value))" />
              <small class="form-subtext">{{ $t('settings.system.lowStockHint') }}</small>
            </div>
            <div class="form-group">
              <label class="form-label" for="pref-toast">{{ $t('settings.system.toastDuration') }}</label>
              <select id="pref-toast" :value="settings.toastDuration" class="settings-select-full" @change="setPreference('toastDuration', Number($event.target.value))">
                <option v-for="ms in [3000, 4000, 5000, 6000]" :key="ms" :value="ms">{{ $t('units.seconds', { count: ms / 1000 }) }}</option>
              </select>
              <small class="form-subtext">{{ $t('settings.system.toastHint') }}</small>
            </div>
          </div>
          <div class="mt-3">
            <v-btn size="small" class="jp-secondary" data-testid="test-toast" @click="triggerTestToast">
              <v-icon start size="14">mdi-bell-outline</v-icon>{{ $t('settings.system.testToast') }}
            </v-btn>
          </div>

          <div class="system-health-card mt-4">
            <div class="card-head">
              <span class="setting-title">{{ $t('settings.system.health') }}</span>
              <v-btn size="x-small" variant="text" :loading="healthChecking" @click="checkSystemHealth">
                <v-icon start size="12">mdi-refresh</v-icon>{{ $t('common.refresh') }}
              </v-btn>
            </div>
            <div class="health-meta-grid">
              <div class="health-box">
                <span class="health-label">{{ $t('settings.system.api') }}</span>
                <span class="health-val" :class="health.reachable ? 'text-ok' : 'text-bad'">
                  <span class="live-dot mr-1" :class="{ 'dot-bad': !health.reachable }"></span>
                  {{ health.reachable === null ? $t('settings.system.unknown') : health.reachable ? $t('settings.system.online') : $t('settings.system.unreachable') }}
                </span>
              </div>
              <div class="health-box">
                <span class="health-label">{{ $t('settings.system.database') }}</span>
                <span class="health-val">{{ health.database === 'connected' ? $t('settings.system.connected') : health.database || $t('settings.system.unknown') }}</span>
              </div>
              <div class="health-box">
                <span class="health-label">{{ $t('settings.system.uptime') }}</span>
                <span class="health-val tabular">{{ uptimeLabel }}</span>
              </div>
            </div>
          </div>

          <div class="cache-cleanup-card mt-4">
            <span class="setting-title">{{ $t('settings.system.cache') }}</span>
            <p class="setting-hint mt-1 mb-2">{{ $t('settings.system.cacheHint') }}</p>
            <v-btn size="small" class="jp-secondary" @click="clearAppCache">
              <v-icon start size="14">mdi-broom</v-icon>{{ $t('settings.system.clearCache') }}
            </v-btn>
          </div>
        </div>
      </section>
    </div>

    <!-- NEW USER -->
    <v-dialog v-model="showAddUserModal" max-width="520" persistent>
      <v-card class="jp-modal-card">
        <div class="dialog-header">
          <v-icon class="mr-2" size="18">mdi-account-plus</v-icon>
          <span>{{ $t('settings.users.newUserTitle') }}</span>
          <v-spacer></v-spacer>
          <v-btn icon size="x-small" variant="text" :aria-label="$t('common.close')" @click="showAddUserModal = false"><v-icon size="16">mdi-close</v-icon></v-btn>
        </div>
        <v-card-text>
          <p v-if="userFormError" class="form-error" role="alert">{{ userFormError }}</p>
          <form @submit.prevent="saveNewUser">
            <div class="form-group mb-3">
              <label class="form-label" for="nu-name">{{ $t('settings.users.fullName') }} *</label>
              <input id="nu-name" v-model.trim="newUser.name" required type="text" :placeholder="$t('settings.users.fullNamePlaceholder')" class="settings-input-full" />
            </div>
            <div class="form-group mb-3">
              <label class="form-label" for="nu-email">{{ $t('settings.business.email') }} *</label>
              <input id="nu-email" v-model.trim="newUser.email" required type="email" class="settings-input-full" />
            </div>
            <div class="form-group mb-3">
              <label class="form-label" for="nu-pwd">{{ $t('settings.users.initialPassword') }} *</label>
              <input id="nu-pwd" v-model="newUser.password" required minlength="12" type="password" autocomplete="new-password" class="settings-input-full" />
            </div>
            <div class="settings-grid-2 mb-3">
              <div class="form-group">
                <label class="form-label" for="nu-role">{{ $t('settings.users.systemRole') }} *</label>
                <select id="nu-role" v-model="newUser.role" class="settings-select-full" data-testid="new-user-role">
                  <option v-for="r in assignableRoleOptions" :key="r.id" :value="r.id">{{ roleLabel(r.id, r.label) }}</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="nu-branch">{{ $t('settings.users.assignedBranch') }}</label>
                <input id="nu-branch" v-model.trim="newUser.branch" type="text" class="settings-input-full" :disabled="!isAdmin" :title="isAdmin ? '' : $t('settings.users.ownBranchOnly')" />
              </div>
            </div>
            <div class="form-group mb-3">
              <span class="form-label">{{ $t('settings.users.extraPermissions') }} <span class="setting-hint">{{ $t('settings.users.extraHint') }}</span></span>
              <div class="permissions-checkbox-grid">
                <label
                  v-for="p in extraPermissionsFor(newUser.role)"
                  :key="p.id"
                  class="perm-checkbox-item"
                  :class="{ 'perm-disabled': !isAssignable(p.id) }"
                  :title="isAssignable(p.id) ? p.id : $t('settings.users.cannotDelegate')"
                >
                  <input v-model="newUser.customPermissions" type="checkbox" class="styled-checkbox" :value="p.id" :disabled="!isAssignable(p.id)" />
                  <span>{{ permissionLabel(p.id, p.label) }}</span>
                </label>
              </div>
            </div>
            <div class="dialog-actions-row">
              <v-btn variant="text" size="small" @click="showAddUserModal = false">{{ $t('common.cancel') }}</v-btn>
              <v-btn size="small" type="submit" class="jp-primary" :loading="userFormLoading">{{ $t('settings.users.saveUser') }}</v-btn>
            </div>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- EDIT USER -->
    <v-dialog v-model="showEditUserModal" max-width="520" persistent>
      <v-card class="jp-modal-card">
        <div class="dialog-header">
          <v-icon class="mr-2" size="18">mdi-account-edit</v-icon>
          <span>{{ $t('settings.users.editUserTitle') }}</span>
          <v-spacer></v-spacer>
          <v-btn icon size="x-small" variant="text" :aria-label="$t('common.close')" @click="showEditUserModal = false"><v-icon size="16">mdi-close</v-icon></v-btn>
        </div>
        <v-card-text>
          <p v-if="userFormError" class="form-error" role="alert">{{ userFormError }}</p>
          <form @submit.prevent="saveEditUser">
            <div class="form-group mb-3">
              <label class="form-label" for="eu-name">{{ $t('settings.users.fullName') }}</label>
              <input id="eu-name" v-model.trim="editUser.name" required type="text" class="settings-input-full" />
            </div>
            <div class="form-group mb-3">
              <label class="form-label" for="eu-email">{{ $t('settings.users.emailFixed') }}</label>
              <input id="eu-email" :value="editUser.email" disabled type="email" class="settings-input-full" />
            </div>
            <div class="settings-grid-2 mb-3">
              <div class="form-group">
                <label class="form-label" for="eu-role">{{ $t('settings.users.systemRole') }}</label>
                <select id="eu-role" v-model="editUser.role" :disabled="!isAdmin || editUser.id === user.id" class="settings-select-full">
                  <option v-for="r in (metadata ? metadata.roles : [])" :key="r.id" :value="r.id">{{ roleLabel(r.id, r.label) }}</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="eu-branch">{{ $t('settings.users.assignedBranch') }}</label>
                <input id="eu-branch" v-model.trim="editUser.branch" type="text" class="settings-input-full" :disabled="!isAdmin" />
              </div>
            </div>
            <div v-if="editUser.id !== user.id" class="form-group mb-3">
              <label class="form-label" for="eu-pwd">{{ $t('settings.users.newPassword') }}</label>
              <input id="eu-pwd" v-model="editUser.newPassword" minlength="12" type="password" autocomplete="new-password" :placeholder="$t('settings.users.newPasswordPlaceholder')" class="settings-input-full" />
            </div>
            <div v-if="editUser.id !== user.id" class="form-group mb-3">
              <span class="form-label">{{ $t('settings.users.extraPermissions') }} <span class="setting-hint">{{ $t('settings.users.extraHint') }}</span></span>
              <div class="permissions-checkbox-grid">
                <label
                  v-for="p in extraPermissionsFor(editUser.role)"
                  :key="p.id"
                  class="perm-checkbox-item"
                  :class="{ 'perm-disabled': !isAssignable(p.id) }"
                  :title="isAssignable(p.id) ? p.id : $t('settings.users.cannotDelegate')"
                >
                  <input
                    v-model="editUser.customPermissions"
                    type="checkbox"
                    class="styled-checkbox"
                    :value="p.id"
                    :disabled="!isAssignable(p.id) && !editUser.customPermissions.includes(p.id)"
                  />
                  <span>{{ permissionLabel(p.id, p.label) }}</span>
                </label>
              </div>
            </div>
            <div class="dialog-actions-row">
              <v-btn variant="text" size="small" @click="showEditUserModal = false">{{ $t('common.cancel') }}</v-btn>
              <v-btn size="small" type="submit" class="jp-primary" :loading="userFormLoading">{{ $t('common.saveChanges') }}</v-btn>
            </div>
          </form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import apiService from '@/services/api';
import { authState, clearSession, hasPermission, logout as authLogout, logoutAllDevices } from '@/services/authSession';
import marketPriceService from '@/services/marketPriceService';
import { confirmAction } from '@/services/confirm';
import BusinessProfileSettings from '@/components/settings/BusinessProfileSettings.vue';
import { languageOptions, t, tOptional, dateTime, n } from '@/i18n';
import { PALETTES } from '@/theme/palettes';
import { themeState, resolveMode } from '@/theme';

const TABS = [
  { id: 'appearance', icon: 'mdi-palette-outline' },
  { id: 'regional', icon: 'mdi-earth' },
  { id: 'business', icon: 'mdi-domain' },
  { id: 'users', icon: 'mdi-shield-account-outline' },
  { id: 'security', icon: 'mdi-lock-outline' },
  { id: 'market', icon: 'mdi-chart-line' },
  { id: 'system', icon: 'mdi-bell-ring-outline' },
];

function notify(store, type, message) {
  store.dispatch(`notifications/show${type}`, message);
}

export default {
  name: 'SettingsPage',
  components: { BusinessProfileSettings },
  data() {
    return {
      currentTab: 'appearance',
      passwordError: '',
      passwordLoading: false,
      healthChecking: false,
      loadingProviders: false,
      marketProviders: [],
      auditLogs: [],
      loadingAuditLogs: false,
      usersList: [],
      loadingUsers: false,
      showAddUserModal: false,
      showEditUserModal: false,
      userFormLoading: false,
      userFormError: '',
      newUser: { name: '', email: '', password: '', role: 'staff', branch: '', customPermissions: [] },
      editUser: { id: '', name: '', email: '', role: 'staff', branch: '', customPermissions: [], newPassword: '' },
      // Roles and the permission catalog come from the backend
      // (GET /api/users/metadata) so the UI never drifts from enforcement.
      metadata: null,
      permissionCatalog: [],
      sessions: [],
      loadingSessions: false,
      health: { reachable: null, database: '', uptime: null },
      password: { current: '', next: '', confirm: '' },
      languages: languageOptions,
      previewNow: new Date(),
      modeOptions: [
        { value: 'light', icon: 'mdi-white-balance-sunny' },
        { value: 'dark', icon: 'mdi-weather-night' },
        { value: 'system', icon: 'mdi-monitor' },
      ],
    };
  },
  computed: {
    settings() {
      return this.$store.state.settings;
    },
    visibleTabs() {
      return TABS;
    },
    resolvedMode() {
      return themeState.mode || resolveMode(this.settings.themeMode);
    },
    systemReducedMotion() {
      return themeState.systemReducedMotion;
    },
    paletteCards() {
      const mode = this.resolvedMode;
      return PALETTES.map((p) => ({ id: p.id, c: p[mode] }));
    },
    user() {
      return authState.user || {};
    },
    userName() {
      return this.user.name || this.user.email || '';
    },
    userEmail() {
      return this.user.email || '';
    },
    userRole() {
      return this.user.role || '';
    },
    isAdmin() {
      return this.userRole === 'admin';
    },
    myPermissions() {
      return this.user.permissions || [];
    },
    assignableRoleOptions() {
      if (!this.metadata) return [];
      return this.metadata.roles.filter((r) => this.metadata.assignableRoles.includes(r.id));
    },
    sessionTypeLabel() {
      if (!authState.accessToken) return '—';
      return authState.persistent ? this.$t('settings.security.persistent') : this.$t('settings.security.browserSession');
    },
    sessionExpiryLabel() {
      return authState.sessionExpiresAt ? this.$dateTime(authState.sessionExpiresAt) : '—';
    },
    uptimeLabel() {
      if (!Number.isFinite(this.health.uptime)) return '—';
      const seconds = Math.floor(this.health.uptime);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${n(h)}h ${n(m)}m`;
    },
  },
  mounted() {
    this.checkSystemHealth();
    this.refreshMarketProviders();
    this.fetchSessions();
    this.fetchPermissionCatalog();
    if (this.can('users:read')) {
      this.fetchMetadata();
      this.fetchUsers();
    }
    if (this.can('audit:read')) this.fetchAuditLogs();
  },
  methods: {
    can(permission) {
      return hasPermission(permission);
    },

    /* ---------------------------------------------------------- preferences */
    setPreference(key, value) {
      if (this.settings[key] === value) return;
      this.$store.dispatch('settings/setPreference', { key, value });
      notify(this.$store, 'Success', t('settings.toasts.saved'));
    },
    setMode(value) {
      if (this.settings.themeMode === value) return;
      this.$store.dispatch('settings/setPreference', { key: 'themeMode', value });
      const key = { light: 'modeLight', dark: 'modeDark', system: 'modeSystem' }[value];
      notify(this.$store, 'Success', t(`settings.toasts.${key}`));
    },
    setPalette(id) {
      if (this.settings.palette === id) return;
      this.$store.dispatch('settings/setPreference', { key: 'palette', value: id });
      notify(this.$store, 'Success', t('settings.toasts.palette', { name: t(`palettes.${id}.name`) }));
    },
    async setLanguage(language) {
      if (this.settings.language === language) return;
      await this.$store.dispatch('settings/setPreference', { key: 'language', value: language });
      // Dispatched after the switch, so the confirmation is in the new language.
      notify(this.$store, 'Success', t('settings.toasts.language'));
    },
    setReducedMotion(enabled) {
      this.$store.dispatch('settings/setPreference', { key: 'reducedMotion', value: enabled });
      notify(this.$store, 'Success', t(enabled ? 'settings.toasts.motionOn' : 'settings.toasts.motionOff'));
    },
    async resetToDefaults() {
      const ok = await confirmAction({ message: t('settings.resetConfirm'), confirmLabel: t('common.reset') });
      if (!ok) return;
      this.$store.dispatch('settings/reset');
      notify(this.$store, 'Success', t('settings.toasts.reset'));
    },
    triggerTestToast() {
      notify(this.$store, 'Success', t('settings.toasts.test'));
    },

    /* ----------------------------------------------------------- labels */
    roleLabel(roleId, fallback) {
      return roleId ? tOptional(`roles.${roleId}`, fallback || roleId) : '—';
    },
    permissionLabel(permissionId, fallback) {
      const catalog = this.metadata?.permissions || this.permissionCatalog;
      const serverLabel = fallback || catalog.find((p) => p.id === permissionId)?.label || permissionId;
      return tOptional(`permissions.${permissionId}`, serverLabel);
    },
    providerDescription(id) {
      return tOptional(`settings.market.descriptions.${id}`, t('settings.market.descriptions.generic'));
    },
    describeUserAgent(ua) {
      if (!ua) return t('settings.security.unknownDevice');
      const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : t('settings.security.genericBrowser');
      const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
      return os ? `${browser} · ${os}` : browser;
    },
    getUserInitials(str) {
      if (!str) return 'JP';
      const parts = str.trim().split(/[\s@._-]+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toLocaleUpperCase();
      return str.slice(0, 2).toLocaleUpperCase();
    },
    formatAuditTime(iso) {
      return dateTime(iso, true);
    },

    /* ----------------------------------------------------------- users */
    canManageUser(u) {
      if (this.isAdmin) return true;
      return u.role === 'staff' && u.branch === this.user.branch;
    },
    isAssignable(permissionId) {
      return Boolean(this.metadata?.assignablePermissions?.includes(permissionId));
    },
    rolePermissions(roleId) {
      return this.metadata?.roles?.find((r) => r.id === roleId)?.permissions || [];
    },
    extraPermissionsFor(roleId) {
      // Custom permissions are additive, so only list what the role lacks.
      const fromRole = this.rolePermissions(roleId);
      return (this.metadata?.permissions || []).filter((p) => !fromRole.includes(p.id));
    },
    withoutRolePermissions(roleId, list) {
      const fromRole = this.rolePermissions(roleId);
      return (list || []).filter((p) => !fromRole.includes(p));
    },
    async fetchPermissionCatalog() {
      try {
        const res = await apiService.get('/api/auth/permission-catalog');
        this.permissionCatalog = res.permissions || [];
      } catch {
        this.permissionCatalog = [];
      }
    },
    async fetchMetadata() {
      try {
        this.metadata = await apiService.get('/api/users/metadata');
      } catch (err) {
        this.metadata = null;
        console.warn('Permission metadata unavailable:', err);
      }
    },
    async fetchUsers() {
      this.loadingUsers = true;
      try {
        const res = await apiService.get('/api/users');
        this.usersList = res.data || [];
      } catch (err) {
        console.warn('Users fetch error:', err);
      } finally {
        this.loadingUsers = false;
      }
    },
    openAddUserModal() {
      this.newUser = {
        name: '',
        email: '',
        password: '',
        role: 'staff',
        branch: this.user.branch || '',
        customPermissions: [],
      };
      this.userFormError = '';
      this.showAddUserModal = true;
    },
    async saveNewUser() {
      if (this.newUser.password.length < 12) {
        this.userFormError = t('settings.users.passwordTooShort');
        return;
      }
      this.userFormLoading = true;
      this.userFormError = '';
      try {
        await apiService.post('/api/users', {
          ...this.newUser,
          customPermissions: this.withoutRolePermissions(this.newUser.role, this.newUser.customPermissions),
        });
        this.showAddUserModal = false;
        notify(this.$store, 'Success', t('settings.users.created'));
        await this.fetchUsers();
      } catch (err) {
        this.userFormError = err.message || t('errors.operationFailed');
      } finally {
        this.userFormLoading = false;
      }
    },
    openEditUser(u) {
      this.editUser = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        branch: u.branch || '',
        customPermissions: [...(u.customPermissions || [])],
        newPassword: '',
      };
      this.userFormError = '';
      this.showEditUserModal = true;
    },
    async saveEditUser() {
      this.userFormError = '';
      const isSelf = this.editUser.id === this.user.id;
      const payload = { name: this.editUser.name };
      if (!isSelf) payload.customPermissions = this.withoutRolePermissions(this.editUser.role, this.editUser.customPermissions);
      if (this.isAdmin) {
        payload.branch = this.editUser.branch;
        if (!isSelf) payload.role = this.editUser.role;
      }
      if (this.editUser.newPassword) {
        if (this.editUser.newPassword.length < 12) {
          this.userFormError = t('settings.users.passwordTooShort');
          return;
        }
        payload.password = this.editUser.newPassword;
      }
      this.userFormLoading = true;
      try {
        await apiService.put(`/api/users/${this.editUser.id}`, payload);
        this.showEditUserModal = false;
        notify(this.$store, 'Success', t('settings.users.updated'));
        await this.fetchUsers();
      } catch (err) {
        this.userFormError = err.message || t('errors.operationFailed');
      } finally {
        this.userFormLoading = false;
      }
    },
    async toggleUserStatus(u) {
      const nextStatus = !u.active;
      const name = u.name || u.email;
      const ok = await confirmAction({
        message: t(nextStatus ? 'settings.users.confirmActivate' : 'settings.users.confirmDeactivate', { name }),
        tone: nextStatus ? 'default' : 'warning',
        confirmLabel: t(nextStatus ? 'settings.users.activate' : 'settings.users.deactivate'),
      });
      if (!ok) return;
      try {
        await apiService.patch(`/api/users/${u.id}/status`, { active: nextStatus });
        await this.fetchUsers();
        notify(this.$store, 'Success', t(nextStatus ? 'settings.users.activated' : 'settings.users.deactivated'));
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
      }
    },
    async confirmDeleteUser(u) {
      const ok = await confirmAction({
        message: t('settings.users.confirmDelete', { name: u.name || u.email }),
        tone: 'danger',
        confirmLabel: t('settings.users.deleteForever'),
      });
      if (!ok) return;
      try {
        await apiService.delete(`/api/users/${u.id}`);
        this.usersList = this.usersList.filter((item) => item.id !== u.id);
        notify(this.$store, 'Success', t('settings.users.deleted'));
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
      }
    },
    async revokeUserSessions(u) {
      const ok = await confirmAction({ message: t('settings.users.confirmRevoke', { name: u.name || u.email }), tone: 'warning' });
      if (!ok) return;
      try {
        await apiService.post(`/api/users/${u.id}/sessions/revoke`);
        notify(this.$store, 'Success', t('settings.users.sessionsRevoked'));
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
      }
    },
    async sendResetLink(u) {
      const ok = await confirmAction({ message: t('settings.users.confirmReset', { email: u.email }) });
      if (!ok) return;
      try {
        await apiService.post(`/api/users/${u.id}/password-reset`);
        notify(this.$store, 'Success', t('settings.users.resetSent'));
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
      }
    },
    async fetchAuditLogs() {
      this.loadingAuditLogs = true;
      try {
        const data = await apiService.get('/api/audit?limit=25');
        this.auditLogs = data || [];
      } catch {
        this.auditLogs = [];
      } finally {
        this.loadingAuditLogs = false;
      }
    },

    /* ----------------------------------------------------------- sessions */
    async fetchSessions() {
      this.loadingSessions = true;
      try {
        const res = await apiService.get('/api/auth/sessions');
        this.sessions = res.data || [];
      } catch {
        this.sessions = [];
      } finally {
        this.loadingSessions = false;
      }
    },
    async revokeSession(s) {
      const ok = await confirmAction({ message: t('settings.security.confirmEndSession'), tone: 'warning' });
      if (!ok) return;
      try {
        await apiService.delete(`/api/auth/sessions/${s.id}`);
        notify(this.$store, 'Success', t('settings.security.sessionEnded'));
        await this.fetchSessions();
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
      }
    },
    async changePassword() {
      this.passwordError = '';
      if (this.password.next !== this.password.confirm) {
        this.passwordError = t('settings.security.mismatch');
        return;
      }
      if (this.password.next.length < 12) {
        this.passwordError = t('settings.users.passwordTooShort');
        return;
      }
      this.passwordLoading = true;
      try {
        await apiService.post('/api/auth/password', {
          currentPassword: this.password.current,
          newPassword: this.password.next,
        });
        this.password = { current: '', next: '', confirm: '' };
        // The server revoked every session (including this one): sign in again.
        clearSession();
        notify(this.$store, 'Success', t('settings.security.changed'));
        this.$router.replace('/login');
      } catch (error) {
        this.passwordError = error.message || t('settings.security.changeFailed');
      } finally {
        this.passwordLoading = false;
      }
    },
    async terminateAllSessions() {
      await authLogout();
      this.$router.replace('/login');
    },
    async logoutEverywhere() {
      const ok = await confirmAction({ message: t('settings.security.confirmEverywhere'), tone: 'warning', confirmLabel: t('settings.security.logoutEverywhere') });
      if (!ok) return;
      try {
        await logoutAllDevices();
      } catch (err) {
        notify(this.$store, 'Error', err.message || t('errors.operationFailed'));
        return;
      }
      this.$router.replace('/login');
    },

    /* ----------------------------------------------------------- system */
    async refreshMarketProviders() {
      this.loadingProviders = true;
      try {
        const state = await marketPriceService.loadPrices(false);
        this.marketProviders = state.providers || [];
      } catch {
        this.marketProviders = marketPriceService.getState().providers || [];
      } finally {
        this.loadingProviders = false;
      }
    },
    async checkSystemHealth() {
      this.healthChecking = true;
      try {
        const res = await apiService.get('/health');
        this.health = {
          reachable: Boolean(res && res.status),
          database: res?.database || (res?.status === 'OK' ? 'connected' : ''),
          uptime: Number(res?.uptime),
        };
      } catch {
        // Report the real state instead of a reassuring placeholder.
        this.health = { reachable: false, database: '', uptime: null };
      } finally {
        this.healthChecking = false;
      }
    },
    clearAppCache() {
      try {
        sessionStorage.clear();
        notify(this.$store, 'Success', t('settings.toasts.cacheCleared'));
      } catch (err) {
        console.warn(err);
      }
    },
  },
};
</script>

<style scoped>
.settings-page-shell {
  gap: 8px;
}
.title-icon {
  color: var(--jp-primary);
}
.settings-workspace-layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  align-items: start;
}
@media (max-width: 959px) {
  .settings-workspace-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .settings-tabs-sidebar {
    flex-direction: row !important;
    overflow-x: auto;
    position: static !important;
  }
  .tab-nav-item {
    flex: 0 0 auto;
    width: auto !important;
  }
  .tab-text small {
    display: none;
  }
}

/* Tabs */
.settings-tabs-sidebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px !important;
  position: sticky;
  top: 8px;
}
.tab-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-radius: var(--jp-radius-sm);
  cursor: pointer;
  text-align: start;
  color: var(--jp-text-muted);
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard);
}
.tab-nav-item:hover {
  background: var(--jp-surface-card-hover);
  color: var(--jp-text-emphasis);
}
.tab-nav-item:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: -2px;
}
.tab-nav-item.active {
  background: var(--jp-gold-subtle);
  color: var(--jp-text-emphasis);
}
.tab-nav-item.active .tab-icon {
  color: var(--jp-primary) !important;
}
.tab-icon {
  color: var(--jp-text-subtle);
  flex-shrink: 0;
}
.tab-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tab-text strong {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.25;
}
.tab-text small {
  font-size: 10.5px;
  color: var(--jp-text-subtle);
  line-height: 1.25;
}

/* Content */
.settings-content-card {
  padding: 16px 20px !important;
  min-width: 0;
}
.tab-pane {
  max-width: 880px;
}
.tab-pane-wide {
  max-width: none;
}
.section-title-wrap {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--jp-border);
}
.pane-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: var(--jp-text-emphasis);
  margin: 0 0 2px;
}
.pane-subtitle {
  font-size: 12px;
  color: var(--jp-text-muted);
  margin: 0;
}
.setting-title {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}
.setting-hint {
  display: block;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--jp-text-muted);
}
.system-note {
  display: flex;
  gap: 4px;
  align-items: flex-start;
  margin-top: 4px;
  color: var(--jp-info);
}
.pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--jp-border-soft);
}
.pref-block {
  padding: 14px 0;
  border-bottom: 1px solid var(--jp-border-soft);
}
.pref-block > .pref-label {
  margin-bottom: 10px;
}
.pref-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* Segmented control */
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: var(--jp-radius-control);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  flex-shrink: 0;
}
.segmented-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--jp-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard);
}
.segmented-btn:hover {
  color: var(--jp-text-emphasis);
}
.segmented-btn.selected {
  background: var(--jp-surface-card);
  color: var(--jp-text-emphasis);
  box-shadow: var(--jp-shadow-control);
}
.segmented-btn.selected .v-icon {
  color: var(--jp-primary);
}
.segmented-btn:focus-visible,
.palette-card:focus-visible,
.lang-btn:focus-visible,
.jp-switch:focus-visible {
  outline: 2px solid var(--jp-primary);
  outline-offset: 2px;
}

/* Palette grid */
.palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.palette-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-md);
  background: var(--jp-surface-card);
  cursor: pointer;
  text-align: start;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard);
}
.palette-card:hover {
  border-color: var(--jp-border-light);
  box-shadow: var(--jp-shadow-sm);
}
.palette-card.selected {
  border-color: var(--jp-primary);
  box-shadow: 0 0 0 1px var(--jp-primary);
}
.palette-check {
  position: absolute;
  top: 12px;
  inset-inline-end: 12px;
  color: var(--jp-primary) !important;
  background: var(--jp-surface-card);
  border-radius: 50%;
}
.palette-preview {
  display: flex;
  height: 68px;
  border-radius: 6px;
  border: 1px solid;
  overflow: hidden;
}
.pv-sidebar {
  width: 26%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 5px;
  border-inline-end: 1px solid;
}
.pv-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.pv-line {
  height: 3px;
  border-radius: 2px;
  opacity: 0.5;
}
.pv-line.active {
  opacity: 1;
}
.pv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
}
.pv-card {
  flex: 1;
  border: 1px solid;
  border-radius: 4px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pv-text {
  height: 3px;
  width: 60%;
  border-radius: 2px;
}
.pv-text.short {
  width: 38%;
}
.pv-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 3px;
}
.pv-bars span {
  flex: 1;
  border-radius: 2px 2px 0 0;
}
.pv-button {
  height: 7px;
  width: 42%;
  border-radius: 3px;
  align-self: flex-end;
}
.palette-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 2px 2px;
}
.palette-meta strong {
  font-size: 12px;
  color: var(--jp-text-emphasis);
}
.palette-meta small {
  font-size: 10.5px;
  color: var(--jp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Languages */
.language-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 6px;
}
.lang-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-card);
  color: var(--jp-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard), background-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.lang-btn:hover {
  border-color: var(--jp-border-light);
  background: var(--jp-surface-card-hover);
}
.lang-btn.selected {
  border-color: var(--jp-primary);
  background: var(--jp-gold-subtle);
  color: var(--jp-text-emphasis);
}
.lang-check {
  color: var(--jp-primary) !important;
}

/* Switch */
.jp-switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid var(--jp-input-border);
  background: var(--jp-surface-muted);
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.jp-switch-thumb {
  position: absolute;
  top: 2px;
  inset-inline-start: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--jp-text-muted);
  transition: transform var(--jp-motion-fast) var(--jp-ease-standard), background-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.jp-switch.on {
  background: var(--jp-primary);
  border-color: var(--jp-primary);
}
.jp-switch.on .jp-switch-thumb {
  transform: translateX(18px);
  background: var(--jp-on-primary);
}
[dir='rtl'] .jp-switch.on .jp-switch-thumb {
  transform: translateX(-18px);
}

/* Forms */
.settings-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.settings-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 720px) {
  .settings-grid-2,
  .settings-grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
  .pref-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.form-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--jp-text-muted);
}
.form-subtext {
  font-size: 11px;
  color: var(--jp-text-subtle);
}
.settings-input-full,
.settings-select-full {
  width: 100%;
  height: 34px;
}
.settings-input-full:disabled {
  opacity: 0.6;
}
.form-actions-row,
.dialog-actions-row {
  display: flex;
  gap: 8px;
}
.dialog-actions-row {
  justify-content: flex-end;
  margin-top: 16px;
}
.form-error,
.pwd-error-msg {
  display: flex;
  align-items: center;
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-danger-bg);
  border: 1px solid var(--jp-danger-border);
  color: var(--jp-danger);
  font-size: 12px;
}

.format-preview-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  font-size: 12px;
  color: var(--jp-text-muted);
}
.format-preview-strip strong {
  color: var(--jp-text-emphasis);
}
.preview-label {
  font-weight: 700;
  color: var(--jp-primary);
  text-transform: uppercase;
  font-size: 10.5px;
  letter-spacing: 0.6px;
  align-self: center;
}

/* Users / tables */
.account-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
}
.info-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  min-width: 0;
}
.tile-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--jp-text-muted);
}
.tile-val {
  font-size: 12.5px;
  color: var(--jp-text-emphasis);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
}
.badge-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.card-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
}
.audit-table-wrap {
  max-height: 320px;
  overflow-y: auto;
}
.col-role {
  width: 120px;
}
.col-actions {
  width: 150px;
}
.col-time {
  width: 150px;
}
.col-narrow {
  width: 90px;
}
.perm-id {
  margin-inline-start: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--jp-text-subtle);
}
.ok-icon {
  color: var(--jp-success) !important;
}
.no-icon {
  color: var(--jp-text-subtle) !important;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-avatar-sm {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--jp-surface-elevated);
  color: var(--jp-text-emphasis);
  font-size: 10.5px;
  font-weight: 700;
  flex-shrink: 0;
}
.cell-sub {
  font-size: 11.5px;
  color: var(--jp-text-muted);
}
.row-actions {
  display: inline-flex;
  gap: 2px;
}
.warn-action {
  color: var(--jp-warning) !important;
}
.ok-action {
  color: var(--jp-success) !important;
}
.danger-action {
  color: var(--jp-danger) !important;
}
.empty-state-cell {
  text-align: center;
  padding: 18px !important;
  color: var(--jp-text-muted) !important;
}
.permissions-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
}
.perm-checkbox-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11.5px;
  color: var(--jp-text);
  cursor: pointer;
}
.perm-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Security, market, system */
.session-meta-row,
.health-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.meta-item,
.health-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.meta-label,
.health-label {
  font-size: 11px;
  color: var(--jp-text-muted);
}
.meta-val,
.health-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--jp-text-emphasis);
  display: flex;
  align-items: center;
}
.text-ok {
  color: var(--jp-success) !important;
}
.text-bad {
  color: var(--jp-danger) !important;
}
.dot-bad {
  background: var(--jp-danger) !important;
  box-shadow: none !important;
}
.providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}
.provider-box {
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--jp-text-emphasis);
}
.status-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-indicator-dot.ok {
  background: var(--jp-success);
}
.status-indicator-dot.warn {
  background: var(--jp-warning);
}
.status-indicator-dot.err {
  background: var(--jp-text-subtle);
}
</style>
