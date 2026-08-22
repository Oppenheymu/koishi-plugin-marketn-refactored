<template>
  <el-dialog
    :model-value="!!activeBundle"
    append-to-body
    align-center
    :class="['bundle-install-panel', modeClass]"
    width="min(880px, calc(100vw - 24px))"
    destroy-on-close
    @update:model-value="close"
  >
    <template #header>
      <div class="bundle-hero">
        <div class="bundle-hero-icon">
          <k-icon name="cube"></k-icon>
        </div>
        <div class="bundle-hero-text">
          <div class="bundle-hero-title">
            <span>{{ title }}</span>
            <span class="bundle-badge">
              <market-icon name="file-archive"></market-icon>
              {{ t('bundle.label') }}
            </span>
          </div>
          <div v-if="activeBundle" class="bundle-hero-meta">
            <span>{{ activeBundle.package.name }}</span>
            <span class="dot">·</span>
            <span>{{ bundleVersion }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-if="activeBundle">
      <div v-if="loading" class="bundle-loading">
        <span class="bundle-loading-spinner"></span>
        {{ t('bundle.loading') }}
      </div>
      <k-comment v-else-if="error" type="danger">
        <p>{{ error }}</p>
      </k-comment>

      <template v-else-if="bundle">
        <p v-if="bundle.description" class="bundle-description">{{ bundle.description }}</p>

        <!-- Stats row: visual progress + counts -->
        <div class="bundle-stats">
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ selectedMembers.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.selected', { count: selectedMembers.length, total: members.length }) }}</span>
            <div class="bundle-stat-bar"><div class="bundle-stat-fill" :style="{ width: progressPercent + '%' }"></div></div>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ presetList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.presets') }}</span>
          </div>
          <div class="bundle-stat">
            <span class="bundle-stat-num">{{ moveList.length }}</span>
            <span class="bundle-stat-label">{{ t('bundle.stats.moved') }}</span>
          </div>
        </div>

        <k-comment v-if="validationErrors.length" type="danger">
          <p v-for="item in validationErrors" :key="item">{{ item }}</p>
        </k-comment>
        <k-comment v-if="validationWarnings.length" type="warning">
          <p v-for="item in validationWarnings" :key="item">{{ item }}</p>
        </k-comment>

        <!-- Global Bulk Operations Row -->
        <div class="bundle-bulk-row" v-if="selectedMembers.length">
          <span class="bulk-label">{{ t('bundle.bulk.label') }}</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(true)">{{ t('bundle.bulk.createAll') }}</button>
          <span class="bundle-section-spacer">|</span>
          <button class="bundle-section-action" @click="batchSetCreateConfig(false)">{{ t('bundle.bulk.skipAll') }}</button>
          <template v-if="selectedMembers.some(m => hasPreset(m))">
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(true)">{{ t('bundle.bulk.enablePresets') }}</button>
            <span class="bundle-section-spacer">|</span>
            <button class="bundle-section-action" @click="batchSetUsePreset(false)">{{ t('bundle.bulk.disablePresets') }}</button>
          </template>
        </div>

        <!-- Required members section -->
        <template v-if="requiredMembers.length">
          <div class="bundle-section-title">
            <k-icon name="check-full"></k-icon>
            {{ t('bundle.members.required') }} <span class="bundle-section-count">{{ requiredMembers.length }}</span>
          </div>
          <div class="bundle-member-list">
            <section
              v-for="member in requiredMembers"
              :key="member.package + ':' + member.plugin"
              :class="['bundle-member required', { selected: member.selected }]"
            >
              <div class="member-row">
                <div :class="['member-icon', 'cat-' + memberCategory(member.package)]">
                  <market-icon :name="'outline:' + memberCategory(member.package)"></market-icon>
                </div>
                <div class="member-main">
                  <div class="member-line">
                    <span class="member-name">{{ formatShortname(member.package) }}</span>
                    <span class="member-version">{{ member.version }}</span>
                    <span
                      v-for="tag in riskTags(member)"
                      :key="tag.label"
                      :class="['member-risk', tag.type]"
                    >{{ tag.label }}</span>
                  </div>
                  <div class="member-sub">
                    <span class="member-fullname">{{ member.package }}</span>
                    <span class="dot">·</span>
                    <span>{{ getInstalledText(member.package) }}</span>
                  </div>
                  <p v-if="getPackageDescription(member.package)" class="member-desc">
                    {{ getPackageDescription(member.package) }}
                  </p>
                </div>
                <div class="member-side">
                  <span class="member-required-pill">
                    <k-icon name="lock"></k-icon>
                    {{ t('bundle.members.requiredPill') }}
                  </span>
                </div>
              </div>

              <div class="member-options" v-if="member.selected" @click.stop>
                <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
                <el-checkbox
                  v-if="member.conflict === 'other-config'"
                  v-model="member.move"
                >{{ t('bundle.members.moveConfig') }}</el-checkbox>
                <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
              </div>

              <!-- Conflict Warning Comments -->
              <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.config') }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.sameGroup') }}</p>
              </k-comment>

              <!-- Sensitive fields in-place editing -->
              <div v-if="member.selected && member.usePreset && sensitiveFields(member).length" class="sensitive-fields-editor" @click.stop>
                <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
                <div class="editor-grid">
                  <div v-for="field in sensitiveFields(member)" :key="field" class="editor-field-row">
                    <span class="field-label">{{ field }}:</span>
                    <el-input
                      size="small"
                      v-model="member.config[field]"
                      :placeholder="t('bundle.editor.placeholder', { field })"
                      show-password
                    ></el-input>
                  </div>
                </div>
              </div>

              <details v-if="hasPreset(member) && member.selected" class="member-config" @click.stop>
                <summary>{{ t('bundle.editor.viewPreset') }}</summary>
                <div class="json-editor-container">
                  <textarea
                    class="raw-json-editor"
                    :value="formatConfig(member.config)"
                    @input="onJsonInput(member, $event.target.value)"
                    rows="8"
                  ></textarea>
                  <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
                    {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
                  </div>
                </div>
              </details>
            </section>
          </div>
        </template>

        <!-- Optional members section -->
        <template v-if="optionalMembers.length">
          <div class="bundle-section-title">
            <k-icon name="info-full"></k-icon>
            {{ t('bundle.members.optional') }} <span class="bundle-section-count">{{ optionalMembers.length }}</span>
            <button class="bundle-section-action" @click="toggleAllOptional">
              {{ allOptionalSelected ? t('bundle.members.optionalToggleNone') : t('bundle.members.optionalToggleAll') }}
            </button>
          </div>
          <div class="bundle-member-list">
            <section
              v-for="member in optionalMembers"
              :key="member.package + ':' + member.plugin"
              :class="['bundle-member optional', { selected: member.selected }]"
              role="checkbox"
              :aria-checked="String(member.selected)"
              tabindex="0"
              @click="toggleMember(member)"
              @keydown.enter.prevent="toggleMember(member)"
              @keydown.space.prevent="toggleMember(member)"
            >
              <div class="member-row">
                <el-checkbox :model-value="member.selected" @click.stop @change="toggleMember(member)" class="member-check"></el-checkbox>
                <div :class="['member-icon', 'cat-' + memberCategory(member.package)]">
                  <market-icon :name="'outline:' + memberCategory(member.package)"></market-icon>
                </div>
                <div class="member-main">
                  <div class="member-line">
                    <span class="member-name">{{ formatShortname(member.package) }}</span>
                    <span class="member-version">{{ member.version }}</span>
                    <span
                      v-for="tag in riskTags(member)"
                      :key="tag.label"
                      :class="['member-risk', tag.type]"
                    >{{ tag.label }}</span>
                  </div>
                  <div class="member-sub">
                    <span class="member-fullname">{{ member.package }}</span>
                    <span class="dot">·</span>
                    <span>{{ getInstalledText(member.package) }}</span>
                  </div>
                  <p v-if="getPackageDescription(member.package)" class="member-desc">
                    {{ getPackageDescription(member.package) }}
                  </p>
                </div>
              </div>

              <div class="member-options" v-if="member.selected" @click.stop>
                <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
                <el-checkbox
                  v-if="member.conflict === 'other-config'"
                  v-model="member.move"
                >{{ t('bundle.members.moveConfig') }}</el-checkbox>
                <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
              </div>

              <!-- Conflict Warning Comments -->
              <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.config') }}</p>
              </k-comment>

              <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
                <p>{{ t('bundle.conflict.sameGroup') }}</p>
              </k-comment>

              <!-- Sensitive fields in-place editing -->
              <div v-if="member.selected && member.usePreset && sensitiveFields(member).length" class="sensitive-fields-editor" @click.stop>
                <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
                <div class="editor-grid">
                  <div v-for="field in sensitiveFields(member)" :key="field" class="editor-field-row">
                    <span class="field-label">{{ field }}:</span>
                    <el-input
                      size="small"
                      v-model="member.config[field]"
                      :placeholder="t('bundle.editor.placeholder', { field })"
                      show-password
                    ></el-input>
                  </div>
                </div>
              </div>

              <details v-if="hasPreset(member) && member.selected" class="member-config" @click.stop>
                <summary>{{ t('bundle.editor.viewPreset') }}</summary>
                <div class="json-editor-container">
                  <textarea
                    class="raw-json-editor"
                    :value="formatConfig(member.config)"
                    @input="onJsonInput(member, $event.target.value)"
                    rows="8"
                  ></textarea>
                  <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
                    {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
                  </div>
                </div>
              </details>
            </section>
          </div>
        </template>

        <!-- Diff: visualized -->
        <div class="bundle-diff">
          <div class="bundle-diff-title">{{ t('bundle.diff.title') }}</div>
          <div class="bundle-diff-grid">
            <div class="bundle-diff-cell">
              <div class="bundle-diff-head"><k-icon name="cube"></k-icon> {{ t('bundle.diff.install') }} <strong>{{ installList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in installList" :key="item" class="bundle-diff-tag install">{{ item }}</span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="configList.length || presetList.length">
              <div class="bundle-diff-head"><k-icon name="settings"></k-icon> {{ t('bundle.diff.config') }} <strong>{{ configList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in configList" :key="item" :class="['bundle-diff-tag config', { 'with-preset': presetList.includes(item) }]">
                  {{ item }}
                  <span v-if="presetList.includes(item)" class="preset-marker">{{ t('bundle.diff.preset') }}</span>
                </span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="moveList.length">
              <div class="bundle-diff-head"><k-icon name="arrow-right"></k-icon> {{ t('bundle.diff.move') }} <strong>{{ moveList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in moveList" :key="item" class="bundle-diff-tag move">{{ item }}</span>
              </div>
            </div>
            <div class="bundle-diff-cell" v-if="skippedConfigList.length">
              <div class="bundle-diff-head"><k-icon name="info-full"></k-icon> {{ t('bundle.diff.skip') }} <strong>{{ skippedConfigList.length }}</strong></div>
              <div class="bundle-diff-tags">
                <span v-for="item in skippedConfigList" :key="item" class="bundle-diff-tag skip">{{ item }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
        {{ t('bundle.actions.install') }} <span v-if="selectedMembers.length" class="footer-count">({{ selectedMembers.length }})</span>
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">

import { computed, reactive, ref, watch } from 'vue'
import { message, send, socket, store, useConfig, useContext } from '@koishijs/client'
import type { Registry } from '@koishijs/registry'
import {
  BundleInstallMember,
  BundleInstallResult,
  PluginBundleManifest,
  hasBundleKeyword,
  parseBundleManifest,
  validateBundleManifest,
} from '../../src/shared/bundle'
import {
  scanSensitiveConfig,
  getBundleGroupIdent,
} from '../../src/shared/bundle-idents'
import {
  activeBundle,
  getBundleMemberConfigState,
  installProgressState,
  prepareInstallFallbackRetry,
  resetInstallFallbackState,
  type InstallOptions,
} from '../shared/operations'
import { resolveCategory } from '../market/utils'
import MarketIcon from '../market/icons'
import { satisfies } from 'semver'
import { getFrontendMode } from '../shared/plugin-config'
import { useMarketNextI18n } from '../shared/i18n'
import { getMarketObject, loadMarketObjects } from '../market/state'

const loading = ref(false)
const installing = ref(false)
const error = ref('')
const registry = ref<Registry>()
const bundle = ref<PluginBundleManifest>()
const resolvedBundleVersion = ref('')
const members = reactive<BundleInstallMember[]>([])
const ctx = useContext()
const config = useConfig()
const { t, locale } = useMarketNextI18n()

const frontendMode = computed(() => getFrontendMode(config.value))
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

const title = computed(() => activeBundle.value?.shortname || activeBundle.value?.package.name || t('bundle.label'))
const bundleVersion = computed(() => resolvedBundleVersion.value || activeBundle.value?.package.version || '')
const validation = computed(() => {
  if (!activeBundle.value || !bundle.value) return { valid: false, errors: [], warnings: [] }
  return validateBundleManifest(activeBundle.value.package.name, bundle.value, {
    keyword: hasBundleKeyword(activeBundle.value.package.keywords),
  })
})
const validationErrors = computed(() => validation.value.errors)
const validationWarnings = computed(() => validation.value.warnings)
const selectedMembers = computed(() => members.filter(member => member.selected))
const requiredMembers = computed(() => members.filter(m => m.required))
const optionalMembers = computed(() => members.filter(m => !m.required))
const progressPercent = computed(() => members.length ? Math.round(selectedMembers.value.length / members.length * 100) : 0)
const allOptionalSelected = computed(() => optionalMembers.value.length > 0 && optionalMembers.value.every(m => m.selected))

function toggleAllOptional() {
  const target = !allOptionalSelected.value
  for (const m of optionalMembers.value) m.selected = target
}

function memberCategory(name: string) {
  const data = getMarketObject(name)
  return resolveCategory(data?.category)
}

function formatShortname(name: string) {
  const shortname = getMarketObject(name)?.shortname
  if (shortname && shortname !== name) return shortname
  if (name.startsWith('@koishijs/plugin-')) return name.slice('@koishijs/plugin-'.length)
  if (name.startsWith('koishi-plugin-')) return name.slice('koishi-plugin-'.length)
  const scoped = name.match(/^@([^/]+)\/koishi-plugin-(.+)$/)
  if (scoped) return `@${scoped[1]}/${scoped[2]}`
  return name
}
const installList = computed(() => {
  if (!activeBundle.value) return []
  return [
    `${activeBundle.value.package.name}@${bundleVersion.value}`,
    ...selectedMembers.value.map(member => `${member.package}@${member.version}`),
  ]
})
const configList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && !member.move)
  .map(member => member.plugin))
const moveList = computed(() => selectedMembers.value
  .filter(member => member.move)
  .map(member => member.plugin))
const presetList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && member.usePreset && !member.move)
  .map(member => member.plugin))
const skippedConfigList = computed(() => selectedMembers.value
  .filter(member => !member.createConfig && !member.move)
  .map(member => member.plugin))

const memberJsonErrors = reactive<Record<string, string>>({})

function getMemberKey(member: BundleInstallMember) {
  return `${member.package}:${member.plugin}`
}

function onJsonInput(member: BundleInstallMember, value: string) {
  const key = getMemberKey(member)
  try {
    const parsed = JSON.parse(value)
    member.config = parsed
    delete memberJsonErrors[key]
  } catch (err) {
    memberJsonErrors[key] = (err as Error).message
  }
}

const canInstall = computed(() => {
  return !!activeBundle.value 
    && !!bundle.value 
    && validation.value.valid 
    && selectedMembers.value.length > 0 
    && !loading.value
    && Object.keys(memberJsonErrors).length === 0
})

watch(activeBundle, async (value) => {
  error.value = ''
  registry.value = undefined
  bundle.value = undefined
  resolvedBundleVersion.value = ''
  members.splice(0)
  Object.keys(memberJsonErrors).forEach(key => delete memberJsonErrors[key])
  if (!value) return
  loading.value = true
  try {
    const data = await send('market/package', value.package.name) as Registry
    if (!data?.versions) {
      error.value = t('bundle.messages.noMetadata')
      return
    }
    registry.value = data
    const remoteEntry = data.versions?.[value.package.version]
      ? [value.package.version, data.versions[value.package.version]] as const
      : Object.entries(data.versions ?? {})[0]
    if (!remoteEntry) {
      error.value = t('bundle.messages.noMetadata')
      return
    }
    const [remoteVersion, remote] = remoteEntry
    const parsed = parseBundleManifest(remote?.koishi?.bundle)
    if (!parsed) {
      error.value = t('bundle.messages.noManifest')
      return
    }
    resolvedBundleVersion.value = remoteVersion
    bundle.value = parsed
    void loadMarketObjects(parsed.members.map(member => member.package)).catch(error => {
      console.error('[market-next] failed to load bundle member metadata', error)
    })
    const groupKey = `group:${getBundleGroupIdent(value.package.name)}`
    for (const member of parsed.members) {
      const state = getBundleMemberConfigState(ctx, member, groupKey)
      const hasConfig = !!(state.group.length || state.external.length)
      const conflictType = state.group.length ? 'same-group' : state.external.length ? 'other-config' : undefined
      
      const dep = store.dependencies?.[member.package]
      const isMismatch = dep?.resolved && !satisfies(dep.resolved, member.version, { includePrerelease: true })
      
      members.push({
        ...member,
        selected: !!member.required || (!!dep && !isMismatch),
        createConfig: !hasConfig && conflictType !== 'same-group',
        usePreset: !hasConfig && !!member.config && Object.keys(member.config).length > 0,
        move: false,
        conflict: conflictType || (isMismatch ? 'package-mismatch' : undefined),
      })
    }
    const names = parsed.members.map(member => member.package).filter(name => !store.registry?.[name])
    if (names.length) {
      const result = await (send('market/registry', names) ?? Promise.resolve(undefined)).catch(() => undefined)
      if (result) store.registry = { ...store.registry, ...result }
    }
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : t('bundle.messages.loadFailed')
  } finally {
    loading.value = false
  }
}, { immediate: true })

function memberInfo(name: string) {
  return getMarketObject(name)
}

function getPackageDescription(name: string) {
  const data = memberInfo(name)
  const description = data?.manifest?.description || data?.package?.description
  if (typeof description === 'string') return description
  if (description && typeof description === 'object') {
    const preferred = locale.value.toLowerCase().startsWith('zh')
      ? ['zh-CN', 'zh', 'en-US', 'en']
      : ['en-US', 'en', 'zh-CN', 'zh']
    for (const key of preferred) {
      const text = description[key]
      if (text) return text
    }
    return Object.values(description).find(Boolean)
  }
}

function formatUser(user: any) {
  if (!user) return ''
  if (typeof user === 'string') return user
  return user.name || user.username || user.email || ''
}

function getAuthor(name: string) {
  return formatUser(memberInfo(name)?.package?.author)
}

function getMaintainer(name: string) {
  return formatUser(memberInfo(name)?.package?.maintainers?.[0])
}

function getInstalledText(name: string) {
  const dep = store.dependencies?.[name]
  if (dep?.resolved) return t('bundle.members.installed', { version: dep.resolved })
  if (store.packages?.[name]) return t('bundle.members.loaded', { version: store.packages[name].package.version })
  return t('bundle.members.notInstalled')
}

function versionMeta(member: BundleInstallMember) {
  return store.registry?.[member.package]?.[member.version]
}

function riskTags(member: BundleInstallMember) {
  const data = memberInfo(member.package)
  const tags: Array<{ label: string, type: string }> = []
  if (!data) tags.push({ label: t('bundle.members.marketMissing'), type: 'warning' })
  if (data?.verified) tags.push({ label: t('bundle.members.verified'), type: 'success' })
  if (data?.insecure) tags.push({ label: t('bundle.members.insecure'), type: 'danger' })
  if (data?.deprecated || versionMeta(member)?.deprecated) tags.push({ label: t('bundle.members.deprecated'), type: 'danger' })
  if (data?.manifest?.preview) tags.push({ label: t('bundle.members.preview'), type: 'warning' })
  if (data?.portable) tags.push({ label: t('bundle.members.portable'), type: 'info' })
  if (hasPreset(member)) tags.push({ label: t('bundle.members.hasPreset'), type: 'warning' })
  return tags
}

function hasPreset(member: BundleInstallMember) {
  return !!member.config && Object.keys(member.config).length > 0
}

function sensitiveFields(member: BundleInstallMember) {
  return scanSensitiveConfig(member.config)
}

function formatConfig(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function toggleMember(member: BundleInstallMember) {
  member.selected = !member.selected
}

function close() {
  if (installing.value) return
  activeBundle.value = undefined
}

function batchSetCreateConfig(value: boolean) {
  for (const m of selectedMembers.value) {
    if (m.conflict !== 'same-group') {
      m.createConfig = value
      if (!value) {
        m.usePreset = false
      }
    }
  }
}

function batchSetUsePreset(value: boolean) {
  for (const m of selectedMembers.value) {
    if (hasPreset(m) && m.createConfig && !m.move) {
      m.usePreset = value
    }
  }
}

async function confirmInstall() {
  if (!activeBundle.value || !bundle.value || installing.value) return
  installing.value = true

  installProgressState.title = t('bundle.messages.installing')
  installProgressState.logs = []
  installProgressState.status = 'running'
  installProgressState.visible = true
  installProgressState.selfUpdate = false
  installProgressState.environmentRestore = false
  resetInstallFallbackState()
  installProgressState.logs.push({
    type: 'stdout',
    line: t('bundle.messages.submitted'),
  })

  const request = {
    package: activeBundle.value!.package.name,
    version: bundleVersion.value,
    bundle: bundle.value!,
    members: members.map(member => ({
      ...member,
      createConfig: member.createConfig || !!member.move,
    })),
  }

  const runInstall = async (options?: InstallOptions) => {
    installing.value = true
    let disconnectedBeforeResponse = false
    let resolveDisconnected: (value: undefined) => void
    const disconnected = new Promise<undefined>((resolve) => {
      resolveDisconnected = resolve
    })
    const dispose = watch(socket, (value, previous) => {
      if (value || !previous) return
      disconnectedBeforeResponse = true
      resolveDisconnected(undefined)
      dispose()
    })
    const waitTimer = setTimeout(() => {
      if (installProgressState.status !== 'running') return
      installProgressState.logs.push({
        type: 'stdout',
        line: t('bundle.messages.waiting'),
      })
    }, 8000)
    try {
      const task = send('market/install-bundle', request, undefined, options ?? {}) as Promise<BundleInstallResult> | undefined
      const result = await Promise.race([task ?? Promise.resolve(undefined), disconnected])
      if (disconnectedBeforeResponse) {
        installProgressState.status = 'error'
        reportInstallError(t('bundle.messages.disconnected'))
        return undefined
      }
      if (result?.code) {
        installProgressState.status = 'error'
        reportInstallError(t('bundle.messages.exitCode', { code: result.code }))
        await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
        return result.code
      }
      installProgressState.status = 'success'
      const moved = result?.moved?.length ? t('bundle.messages.moved', { count: result.moved.length }) : ''
      const skipped = result?.skipped?.length ? t('bundle.messages.skipped', { count: result.skipped.length }) : ''
      message.success(t('bundle.messages.completed', { moved, skipped }))
      activeBundle.value = undefined
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
      installing.value = false
    }
  }

  try {
    await runInstall()
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallError(formatInstallError(err))
  }
}

function reportInstallError(detail: string) {
  const text = detail || t('bundle.messages.unknownError')
  installProgressState.logs.push({
    type: 'stderr',
    line: t('bundle.messages.installFailed', { detail: text }),
  })
  message.error(t('bundle.messages.installFailed', { detail: text }))
}

function formatInstallError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as any
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
  }
  return String(error || t('bundle.messages.unknownError'))
}

</script>

<style lang="scss" src="./bundle-install.scss"></style>
