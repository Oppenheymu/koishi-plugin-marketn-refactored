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
    <!-- 头部 hero:图标 + 合包标题(带 bundle 徽标) + 包名/版本 -->
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
      <!-- 加载/错误态:清单拉取中转圈,失败展示红色错误 -->
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

    <!-- 底部操作栏:取消 / 安装(带勾选数,不可用时禁用) -->
    <template #footer>
      <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
        {{ t('bundle.actions.install') }} <span v-if="selectedMembers.length" class="footer-count">({{ selectedMembers.length }})</span>
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * @file 合包(bundle)安装对话框。
 *
 * 打开条件是 shared/operations 的 activeBundle ref 有值(市场页点开合包条目)。
 * 拉取 registry 元数据解析目标版本的 koishi.bundle 清单,把成员分成
 * 必装/可选两组逐个勾选;每个成员可决定 是否创建配置/使用预置配置/把组外
 * 配置移入分组,并展示与本地现状的三类冲突(same-group/other-config/
 * package-mismatch)。底部以 diff 网格汇总安装/配置/移动/跳过清单。
 *
 * 关键设计:
 * - 不走 shared 的 install(),单独调 market/bundle-install RPC,但复用
 *   installProgressState 进度面板,并自带同样的 socket 断连竞态处理
 *   (watch(socket) 构造 disconnected Promise 与任务 race)与 fallback
 *   镜像重试(prepareInstallFallbackRetry);
 * - 清单校验复用 src/shared/bundle 的 validateBundleManifest,错误阻断
 *   安装、警告仅提示;敏感字段用 scanSensitiveConfig 识别后单独成行编辑。
 */

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
} from '../../../src/shared/bundle'
import {
  scanSensitiveConfig,
  getBundleGroupIdent,
} from '../../../src/shared/bundle-idents'
import {
  activeBundle,
  getBundleMemberConfigState,
  installProgressState,
  prepareInstallFallbackRetry,
  resetInstallFallbackState,
  type InstallOptions,
} from '../../shared/operations'
import { resolveCategory, formatShortname } from '../../market/utils'
import MarketIcon from '../../market/icons'
import { satisfies } from 'semver'
import { getFrontendMode } from '../../shared/plugin-config'
import { useMarketNextI18n } from '../../shared/i18n'
import { getMarketObject, loadMarketObjects } from '../../market/state'

/** 清单加载中 / 安装执行中 / 加载错误文案。 */
const loading = ref(false)
const installing = ref(false)
const error = ref('')
/** 合包的 registry 元数据(market/package 拉取)。 */
const registry = ref<Registry>()
/** 解析出的合包清单。 */
const bundle = ref<PluginBundleManifest>()
/** 实际解析到清单的合包版本(registry 里可能没有条目自带版本,取首个)。 */
const resolvedBundleVersion = ref('')
/** 成员勾选状态列表(直接被模板双向绑定修改)。 */
const members = reactive<BundleInstallMember[]>([])
const ctx = useContext()
const config = useConfig()
const { t, locale } = useMarketNextI18n()

const frontendMode = computed(() => getFrontendMode(config.value))
/** 前端外观模式对应的根 class,主题适配用。 */
const modeClass = computed(() => `market-mode-${frontendMode.value}`)

/** 对话框标题:市场条目短名 > 包名 > 兜底文案。 */
const title = computed(() => activeBundle.value?.shortname || activeBundle.value?.package.name || t('bundle.label'))
/** 展示的合包版本:已解析的 registry 版本优先。 */
const bundleVersion = computed(() => resolvedBundleVersion.value || activeBundle.value?.package.version || '')
/** 清单校验结果(errors 阻断安装,warning 仅提示)。 */
const validation = computed(() => {
  if (!activeBundle.value || !bundle.value) return { valid: false, errors: [], warnings: [] }
  return validateBundleManifest(activeBundle.value.package.name, bundle.value, {
    keyword: hasBundleKeyword(activeBundle.value.package.keywords),
  })
})
const validationErrors = computed(() => validation.value.errors)
const validationWarnings = computed(() => validation.value.warnings)
/** 勾选的成员 / 必装成员 / 可选成员。 */
const selectedMembers = computed(() => members.filter(member => member.selected))
const requiredMembers = computed(() => members.filter(m => m.required))
const optionalMembers = computed(() => members.filter(m => !m.required))
/** 勾选进度百分比(头部统计条)。 */
const progressPercent = computed(() => members.length ? Math.round(selectedMembers.value.length / members.length * 100) : 0)
/** 可选成员是否已全选(驱动"全选/全不选"按钮文案)。 */
const allOptionalSelected = computed(() => optionalMembers.value.length > 0 && optionalMembers.value.every(m => m.selected))

/** 一键切换全部可选成员的勾选状态。 */
function toggleAllOptional() {
  const target = !allOptionalSelected.value
  for (const m of optionalMembers.value) m.selected = target
}

/** 成员分类图标:取市场元数据的 category,无数据由 resolveCategory 兜底。 */
function memberCategory(name: string) {
  const data = getMarketObject(name)
  return resolveCategory(data?.category)
}
/** diff"将安装"清单:合包自身@版本 + 各勾选成员@版本范围。 */
const installList = computed(() => {
  if (!activeBundle.value) return []
  return [
    `${activeBundle.value.package.name}@${bundleVersion.value}`,
    ...selectedMembers.value.map(member => `${member.package}@${member.version}`),
  ]
})
/** diff"将配置"清单:勾选建配置且不涉及移动的成员插件键。 */
const configList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && !member.move)
  .map(member => member.plugin))
/** diff"将移动"清单:勾选把组外已有配置移入分组的成员插件键。 */
const moveList = computed(() => selectedMembers.value
  .filter(member => member.move)
  .map(member => member.plugin))
/** diff"预置配置"清单:建配置且启用预置的成员插件键。 */
const presetList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && member.usePreset && !member.move)
  .map(member => member.plugin))
/** diff"跳过配置"清单:既不建配置也不移动的成员插件键。 */
const skippedConfigList = computed(() => selectedMembers.value
  .filter(member => !member.createConfig && !member.move)
  .map(member => member.plugin))

/** 各成员预置配置 JSON 编辑报错,key 为 getMemberKey。 */
const memberJsonErrors = reactive<Record<string, string>>({})

/** 成员的稳定 key:包名:插件键。 */
function getMemberKey(member: BundleInstallMember) {
  return `${member.package}:${member.plugin}`
}

/** 预置配置 JSON 就地编辑:解析成功写回 member.config 并清错,失败记录错误文案(阻断安装)。 */
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

/** 安装按钮可用条件:有目标与清单、校验通过、至少勾选一个成员、非加载中且无 JSON 编辑错误。 */
const canInstall = computed(() => {
  return !!activeBundle.value
    && !!bundle.value
    && validation.value.valid
    && selectedMembers.value.length > 0
    && !loading.value
    && Object.keys(memberJsonErrors).length === 0
})

/**
 * 打开/切换合包时的加载流程:清空旧状态 → 拉取 registry → 取条目版本对应
 * (缺则首个)的 koishi.bundle 清单 → 并行拉成员的市场元数据 → 逐成员计算
 * 与本地现状的冲突并生成初始勾选:
 * - conflict:组内已有配置为 same-group,组外有配置为 other-config,
 *   已装版本不满足成员范围为 package-mismatch;
 * - selected:必装恒真;可选成员默认已装且版本满足才勾;
 * - createConfig/usePreset:无任何已有配置时默认开;
 * 最后补拉缺失成员的 registry 元数据供版本徽标等使用。
 */
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

/** 取成员的市场元数据对象(loadMarketObjects 缓存)。 */
function memberInfo(name: string) {
  return getMarketObject(name)
}

/** 成员描述:优先 manifest/package 的描述字段,多语言对象按当前 locale 挑选。 */
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

/** 成员安装状态文案:依赖表已解析为"已安装",仅 packages 有为"已加载",否则"未安装"。 */
function getInstalledText(name: string) {
  const dep = store.dependencies?.[name]
  if (dep?.resolved) return t('bundle.members.installed', { version: dep.resolved })
  if (store.packages?.[name]) return t('bundle.members.loaded', { version: store.packages[name].package.version })
  return t('bundle.members.notInstalled')
}

/** 成员对应版本的 registry 元数据(弃用标记等)。 */
function versionMeta(member: BundleInstallMember) {
  return store.registry?.[member.package]?.[member.version]
}

/** 成员风险标签集合:市场缺失/官方认证/不安全/弃用/预览版/便携/含预置配置。 */
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

/** 成员是否携带非空预置配置。 */
function hasPreset(member: BundleInstallMember) {
  return !!member.config && Object.keys(member.config).length > 0
}

/** 成员预置配置里的敏感字段名列表(token/secret 等,scanSensitiveConfig 判定)。 */
function sensitiveFields(member: BundleInstallMember) {
  return scanSensitiveConfig(member.config)
}

/** 预置配置查看器的 JSON 展示文本(空对象兜底)。 */
function formatConfig(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

/** 切换成员勾选(可选成员整行/复选框共用入口)。 */
function toggleMember(member: BundleInstallMember) {
  member.selected = !member.selected
}

/** 关闭对话框:安装进行中禁止关闭,清空 activeBundle。 */
function close() {
  if (installing.value) return
  activeBundle.value = undefined
}

/** 批量设置"创建配置":same-group 冲突的成员不可建;关闭时连带关掉预置配置。 */
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

/** 批量设置"使用预置配置":仅对有预置、建配置且不涉及移动的成员生效。 */
function batchSetUsePreset(value: boolean) {
  for (const m of selectedMembers.value) {
    if (hasPreset(m) && m.createConfig && !m.move) {
      m.usePreset = value
    }
  }
}

/**
 * 确认安装:先点亮进度面板,组装 BundleInstallRequest(move 的成员视同
 * createConfig),再调 market/bundle-install。断连竞态处理与 shared 的
 * install() 同构(watch(socket) race + 8 秒等待提示),但合包安装导致
 * 重启的情况较少,断连一律按失败处理;非零退出码时准备 fallback 镜像
 * 重试。成功后弹出 moved/skipped 统计并关闭对话框。
 */
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

/** 安装失败统一上报:stderr 日志行 + toast。 */
function reportInstallError(detail: string) {
  const text = detail || t('bundle.messages.unknownError')
  installProgressState.logs.push({
    type: 'stderr',
    line: t('bundle.messages.installFailed', { detail: text }),
  })
  message.error(t('bundle.messages.installFailed', { detail: text }))
}

/** 把抛出的错误归一成可展示字符串(Error/字符串/{message} 逐级尝试)。 */
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

<style lang="scss" src="./index.scss"></style>
