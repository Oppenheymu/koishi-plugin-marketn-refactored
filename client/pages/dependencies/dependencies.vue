<template>
  <k-layout main="page-deps" :class="[modeClass, layoutClass]" menu="dependencies">
    <!-- 顶部工具栏:过滤下拉 / 预发布屏蔽 / 布局切换 / 搜索框 / 分类计数摘要 -->
    <div class="deps-toolbar">
      <div class="deps-toolbar-row">
        <el-select v-model="filter" size="small" class="deps-filter-select">
          <el-option
            v-for="option in filterOptions"
            :key="option.value"
            :value="option.value"
            :label="option.label + (option.count ? ' (' + option.count + ')' : '')"
          >
            <span class="deps-filter-option">
              <market-icon :name="option.icon"></market-icon>
              <span>{{ option.label }}</span>
              <span v-if="option.count" class="deps-filter-count">({{ option.count }})</span>
            </span>
          </el-option>
        </el-select>
        <button
          :class="['deps-filter', 'deps-prerelease-toggle', { active: prereleaseBlocked }]"
          @click="togglePrereleaseFilter"
        >
          <market-icon name="tag"></market-icon>
          <span>{{ t('dependencies.toolbar.blockPreview') }}</span>
        </button>
        <button
          class="deps-filter deps-layout-toggle"
          @click="toggleLayout"
          :title="depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView')"
        >
          <svg v-if="depsLayout === 'grid'" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
            <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor">
            <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
          </svg>
          <span>{{ depsLayout === 'grid' ? t('dependencies.toolbar.listView') : t('dependencies.toolbar.gridView') }}</span>
        </button>
        <div class="deps-search">
          <el-input ref="searchInput" v-model="keyword" clearable :placeholder="t('dependencies.toolbar.searchPlaceholder')"></el-input>
        </div>
        <div class="deps-summary">
          <span v-if="summary.pending" class="primary">{{ t('dependencies.filters.pending') }} {{ summary.pending }}</span>
          <span v-if="summary.updatable" class="success">{{ t('dependencies.filters.updatable') }} {{ summary.updatable }}</span>
          <span v-if="summary.unconfigured" class="warning">{{ t('dependencies.filters.unconfigured') }} {{ summary.unconfigured }}</span>
          <span v-if="summary.errors" class="danger">{{ t('dependencies.filters.error') }} {{ summary.errors }}</span>
          <span v-if="summary.invalid" class="warning">{{ t('dependencies.filters.invalid') }} {{ summary.invalid }}</span>
          <span v-if="refreshing" class="loading">{{ t('dependencies.toolbar.loading') }}</span>
        </div>
      </div>
    </div>

    <!-- 依赖分组列表:每组可折叠头 + 卡片网格(列表布局时先渲染表头) -->
    <el-scrollbar class="body-container">
      <div class="deps-content" :class="{ pending: summary.pending }">
        <template v-if="visibleGroups.length">
          <section v-for="group in visibleGroups" :key="group.key" :class="['deps-group', group.key, { collapsed: group.collapsed }]">
            <header
              :class="['deps-group-header', { collapsible: group.collapsible }]"
              :role="group.collapsible ? 'button' : undefined"
              :tabindex="group.collapsible ? 0 : undefined"
              :aria-expanded="group.collapsible ? String(!group.collapsed) : undefined"
              @click="group.collapsible && toggleGroup(group.key)"
              @keydown.enter.prevent="group.collapsible && toggleGroup(group.key)"
              @keydown.space.prevent="group.collapsible && toggleGroup(group.key)"
            >
              <div>
                <h2>
                  <market-icon :name="group.icon"></market-icon>
                  <span>{{ group.label }}</span>
                </h2>
                <p>{{ group.description }}</p>
              </div>
              <div class="deps-group-side">
                <span class="deps-group-count">{{ group.items.length }}</span>
                <market-icon
                  v-if="group.collapsible"
                  :class="['deps-group-chevron', { collapsed: group.collapsed }]"
                  name="asc"
                ></market-icon>
              </div>
            </header>
            <div v-if="!group.collapsed" class="deps-grid">
              <template v-if="depsLayout === 'list'">
                <div class="deps-list-header">
                  <span class="col-icon"></span>
                  <span class="col-name">{{ t('common.labels.name') }}</span>
                  <span class="col-version">{{ t('common.labels.installed') }}</span>
                  <span class="col-latest">{{ t('common.labels.latest') }}</span>
                  <span class="col-actions">{{ t('common.labels.operation') }}</span>
                </div>
              </template>
              <package-view
                v-for="item in group.items"
                :key="item.name"
                :name="item.name"
                :kind="item.kind"
                :list-mode="depsLayout === 'list'"
              ></package-view>
            </div>
          </section>
        </template>
        <k-empty v-else>{{ t('dependencies.empty') }}</k-empty>
      </div>
    </el-scrollbar>
  </k-layout>

  <!-- 底部批量应用栏:有待应用变更时浮出,确认动作转交 confirm.vue -->
  <div v-if="summary.pending" :class="['deps-apply-bar', modeClass]">
    <div>
      <strong>{{ t('dependencies.apply.count', { count: summary.pending }) }}</strong>
      <span>{{ t('dependencies.apply.description') }}</span>
    </div>
    <div class="deps-apply-actions">
      <el-button @click="clearChanges">{{ t('dependencies.apply.discard') }}</el-button>
      <el-button type="primary" @click="showConfirm = true">{{ t('dependencies.apply.apply') }}</el-button>
    </div>
  </div>

  <!-- 手动添加依赖对话框(本地包上传 / registry 查询两个页签) -->
  <manual-install/>
</template>

<script lang="ts" setup>
/**
 * @file 依赖管理页面(/dependencies 路由主体)。
 *
 * 汇总展示宿主全部依赖,逐包分类后按固定顺序分组成卡片墙;支持过滤下拉、
 * 预发布屏蔽开关、网格/列表布局切换、Ctrl+K 聚焦搜索与分组折叠记忆。
 * 存在待应用变更时底部浮出批量应用栏(确认动作交给全局 confirm.vue)。
 *
 * 拆分:包名全集与元数据预取在 use-dependency-names,分类与计数在
 * use-dependency-classify,分组/过滤视图在 use-dependency-groups,
 * classify 状态机与基础判定在 dependency-helpers。
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message, router, useConfig, useContext } from '@koishijs/client'
import { useMarketNextI18n } from '../../shared/i18n'
import { getDepsLayout, getFrontendMode, getLatestVersion, getMarketNextConfig, getPendingOverrides, getWritableMarketNextPolicy, patchMarketNextConfig, patchMarketNextData } from '../../shared/plugin-config'
import { showConfirm } from '../../shared/operations'
import ManualInstall from './manual.vue'
import PackageView from './package.vue'
import MarketIcon from '../../market/icons'
import { getUpdatePolicy } from './dependency-helpers'
import { useDependencyNames } from './use-dependency-names'
import { useDependencyClassify } from './use-dependency-classify'
import { useDependencyGroups, type FilterKey } from './use-dependency-groups'

const config = useConfig()
const ctx = useContext()
const { t } = useMarketNextI18n()
/** 搜索关键字 / 当前过滤项 / 搜索框引用(Ctrl+K 聚焦用)。 */
const keyword = ref('')
const filter = ref<FilterKey>('all')
const searchInput = ref<{ focus?: () => void }>()
const frontendMode = computed(() => getFrontendMode(config.value))
const depsLayout = computed(() => getDepsLayout(config.value))
/** 前端外观模式与布局对应的根 class。 */
const modeClass = computed(() => `market-mode-${frontendMode.value}`)
const layoutClass = computed(() => `deps-layout-${depsLayout.value}`)

const { names, disposeNamesWatcher } = useDependencyNames(ctx, config)
const { items, updates, prereleaseBlocked, summary, refreshing } = useDependencyClassify(ctx, config, names)
const { filterOptions, toggleGroup, visibleGroups } = useDependencyGroups(items, summary, keyword, filter, t)

/** 注册/注销全局 Ctrl+K 搜索快捷键。 */
onMounted(() => {
  window.addEventListener('keydown', onSearchShortcut)
})

onBeforeUnmount(() => {
  disposeNamesWatcher()
  window.removeEventListener('keydown', onSearchShortcut)
})

/** Ctrl/Cmd+K:仅在依赖页路由上拦截并聚焦搜索框。 */
function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/dependencies') return
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  searchInput.value?.focus?.()
}

/** 网格/列表布局切换:同时写本地配置对象与插件配置持久化。 */
function toggleLayout() {
  if (!config.value.market) config.value.market = {}
  const next = depsLayout.value === 'grid' ? 'list' : 'grid'
  config.value.market.depsLayout = next
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) pluginConfig.depsLayout = next
  patchMarketNextConfig({ depsLayout: next })
}

/** 丢弃全部待应用变更(底部应用栏"放弃")。 */
function clearChanges() {
  const override = getPendingOverrides()
  for (const key of Object.keys(override)) delete override[key]
  void patchMarketNextData({ override: { ...override } })
}

/** 切换"屏蔽预发布版本"策略并持久化;保存失败时回滚本地状态。 */
async function togglePrereleaseFilter() {
  const policy = getWritableMarketNextPolicy(config.value)
  const previous = !!policy.updateIgnorePrerelease
  policy.updateIgnorePrerelease = !previous
  const saved = await patchMarketNextConfig({ updateIgnorePrerelease: policy.updateIgnorePrerelease })
  if (!saved) {
    policy.updateIgnorePrerelease = previous
    message.error(t('common.messages.saveFailed'))
  }
}

/** 页级"全部升级"动作:把每个可更新包的最新版暂存进 override,待批量确认。 */
ctx.action('dependencies.upgrade', {
  disabled: () => !updates.value.length,
  async action() {
    for (const name of updates.value) {
      const version = getLatestVersion(name, getUpdatePolicy(config.value))
      if (!version) continue
      getPendingOverrides()[name] = version
    }
    void patchMarketNextData({ override: { ...getPendingOverrides() } })
  },
})

</script>

<style lang="scss" src="./dependencies.scss"></style>
