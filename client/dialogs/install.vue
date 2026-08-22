<template>
  <el-dialog :model-value="!!active" @update:model-value="closePanel" :class="['install-panel', modeClass]" destroy-on-close>
    <!-- 头部:包名(本地形态带标记) + 目标版本下拉(每项带红黄绿点) -->
    <template v-if="active" #header="{ titleId, titleClass }">
      <span :id="titleId" :class="titleClass">
        {{ active + (localSelection ? ` (${t('dependencyCard.current.local')})` : '') }}
      </span>
      <el-select
        v-if="data"
        v-model="selectVersion"
        class="market-version-select"
        :disabled="localSelection"
        :popper-class="versionPopperClass"
      >
        <el-option v-for="({ result }, version) in data" :key="version" :value="version">
          {{ version }}
          <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
          <span :class="[result, 'theme-color', 'dot-hint']"></span>
        </el-option>
      </el-select>
    </template>

    <!-- 警示区:弃用/不安全(红)、跨大版本升级(黄)、registry 拉取状态、已装但版本异常的修复提示 -->
    <k-comment class="danger" v-if="danger" type="danger">{{ danger }}</k-comment>
    <k-comment class="warning" v-if="warning" type="warning">{{ warning }}</k-comment>

    <div v-if="!data && active && !localSelection">
      <k-comment :type="registryStatus?.error ? 'danger' : 'info'">{{ registryStatusText }}</k-comment>
    </div>

    <k-comment v-if="store.dependencies?.[active] && !current" type="danger">
      {{ t('operations.install.installErrorHint') }}
    </k-comment>

    <!-- peer 兼容性表格:每个 peer 期望范围 vs 实际版本,不兼容的可就地改选版本 -->
    <el-scrollbar v-if="data?.[version] && Object.keys(data[version].peers).length" class="peer-table-scroll">
      <table class="peer-table">
        <colgroup>
          <col class="peer-name-col">
          <col class="peer-range-col">
          <col class="peer-current-col">
          <col class="peer-status-col">
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('operations.install.peerName') }}</th>
            <th>{{ t('operations.install.peerRange') }}</th>
            <th>{{ t('operations.install.peerCurrent') }}</th>
            <th>{{ t('operations.install.peerAvailability') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(peer, name) in data[version].peers" :key="name">
            <td class="text-left">{{ name }}</td>
            <td>{{ peer.request }}</td>
            <td>
              <span class="wrapper" v-if="shouldShowPeerVersionSelect(peer, name)">
                <span class="shadow">{{ getVersion(name) || t('operations.install.select') }}</span>
                <el-select
                  class="frameless market-version-select"
                  :model-value="getVersion(name)"
                  :popper-class="versionPopperClass"
                  @update:model-value="setVersion(name, $event)"
                >
                    <el-option value="">{{ t('dependencyCard.actions.remove') }}</el-option>
                  <el-option v-for="(_, version) in store.registry[name]" :key="version" :value="version">
                    {{ version }}
                    <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
                    <!-- <span :class="[result, 'theme-color', 'dot-hint']"></span> -->
                  </el-option>
                </el-select>
              </span>
              <span v-else class="peer-version" :class="{ workspace: !!getWorkspaceVersion(name), missing: !getPeerResolvedVersion(peer, name) }">
                {{ getPeerResolvedVersion(peer, name) || t('operations.confirm.notInstalled') }}
                <template v-if="getWorkspaceVersion(name)">{{ t('dependencyCard.current.workspace') }}</template>
              </span>
            </td>
            <td :class="['theme-color', peer.result]">
              <span class="inline-flex items-center gap-1">
                <k-icon :name="getResultIcon(peer.result)"></k-icon>
                {{ getResultText(peer, name) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </el-scrollbar>

    <!-- 操作栏:左侧批量模式开关;右侧按形态给 配置/移除/添加/卸载/安装-更新-修复 按钮 -->
    <template v-if="active && !global.static" #footer>
      <div class="left">
        <el-checkbox v-model="bulkMode">
          {{ t('operations.install.bulkMode') }}
          <k-hint>
            {{ t('operations.install.bulkModeHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button v-if="local" type="primary" @click="configure()">{{ t('dependencyCard.actions.configure') }}</el-button>
        <template v-if="localSelection">
          <el-button v-if="showRemoveButton" @click="installDep('', true)" type="danger">{{ t('operations.install.remove') }}</el-button>
          <el-button v-else-if="workspace" @click="installDep(workspace)" type="success">{{ t('operations.install.add') }}</el-button>
        </template>
        <template v-else-if="data">
          <el-button v-if="showRemoveButton" @click="requestRemove()" type="danger">{{ t('operations.install.uninstall') }}</el-button>
          <el-button :type="result" @click="installDep(version)" :disabled="unchanged">
            {{ current ? t('operations.install.update') : store.dependencies?.[active] ? t('operations.install.repair') : t('operations.install.install') }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>

  <!-- 卸载询问弹窗:是否连带移除插件配置,可记住选择 -->
  <el-dialog v-model="showRemoveDialog" class="market-remove-dialog" destroy-on-close>
    {{ t('operations.install.removeConfigQuestion') }}
    <template #footer>
      <div class="left">
        <el-checkbox v-model="saveChoice">
          {{ t('operations.install.rememberChoice') }}
          <k-hint>
            {{ t('operations.install.rememberChoiceHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button type="danger" @click="installDep('', false, true)">{{ t('operations.install.delete') }}</el-button>
        <el-button type="primary" @click="installDep('', false, false)">{{ t('operations.install.keep') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 合包卸载对话框:普通卸载遇到合包目标时转交到这里 -->
  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="bundleUninstallTarget"
    :record="bundleUninstallRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
/**
 * @file 依赖安装/卸载面板(市场条目与依赖卡片共用的版本选择对话框)。
 *
 * 打开条件是 shared/plugin-config 的 active ref 有值(包名)。面板内:
 * 头部选目标版本,主体用 analyzeVersions 展示该版本 peerDependencies 的
 * 兼容性表格(每个 peer 可手动改选版本),底部按钮执行安装/更新/修复/卸载。
 * 卸载目标若是合包,转交 bundle-uninstall 对话框按成员粒度处理。
 *
 * 关键设计:
 * - 批量(bulk)模式下所有变更只写入共享 override 暂存,由 confirm.vue 统一
 *   应用;非批量模式直接以本地 versions 映射调 install();
 * - 版本初始值优先级:待应用 override > 当前依赖的 request > registry 首个;
 *   peer 的 registry 元数据按需增量拉取(market/registry)。
 */

import { computed, ref, watch, reactive } from 'vue'
import { Dict, global, message, send, store, useContext, useConfig } from '@koishijs/client'
import { analyzeVersions, createLocalBundleRecord, ensureInstalledConfig, getConfigWriter, getRegistryStatus, getRegistryStatusText, install, PeerInfo, ResultType } from '../shared/operations'
import { active, getBulkMode, getBundleRecords, getFrontendMode, getPendingOverrides, getRemoveConfig, getWritableBundleRecords, patchMarketNextConfig, patchMarketNextData } from '../shared/plugin-config'
import { parse } from 'semver'
import { isBundlePackageName } from '../../src/shared/bundle'
import { isLocalDependency } from '../../src/shared/dependency-source'
import BundleUninstall from './bundle-uninstall.vue'
import { useMarketNextI18n } from '../shared/i18n'
import { getMarketObject } from '../market/state'

const ctx = useContext()
const config = useConfig()
const { t } = useMarketNextI18n()
const frontendMode = computed(() => getFrontendMode(config.value))
/** 前端外观模式对应的根 class,主题适配用。 */
const modeClass = computed(() => `market-mode-${frontendMode.value}`)
/** 版本下拉弹层的 class(带主题模式前缀)。 */
const versionPopperClass = computed(() => `market-version-popper ${modeClass.value}`)

/** 卸载询问弹窗里"记住我的选择"勾选状态。 */
const saveChoice = ref(false)
/** "卸载时是否移除插件配置"询问弹窗开关。 */
const showRemoveDialog = ref(false)
/** 合包卸载对话框开关(install 面板里的卸载会转交给它)。 */
const showBundleUninstallDialog = ref(false)
/** 合包卸载对话框的目标包名。 */
const bundleUninstallTarget = ref('')

/** 批量模式开关:读取配置,写入时同步改本地配置对象并持久化。 */
const bulkMode = computed({
  get: () => getBulkMode(config.value),
  set: (value: boolean) => {
    if (config.value.market) config.value.market.bulkMode = value
    void patchMarketNextConfig({ bulkMode: value })
  },
})

/**
 * 面板的统一执行入口:安装指定版本 / 传空串则卸载。
 *
 * - 批量模式(workspace 包除外):只把目标写入共享 override(与现状一致时
 *   反而删除该项,支持撤销),关面板返回,由 confirm.vue 统一应用;
 * - 卸载(checkConfig)且目标在 koishi.yml 有配置节点、用户又没保存过
 *   "移除配置"偏好时,弹询问对话框,由用户选择后递归回来执行;
 * - 真正执行:把 version 记入本地 versions 映射后调 install()。成功回调里
 *   为新装包补配置节点、按选择移除配置、卸载时顺带清掉合包记录。
 */
function installDep(version: string, checkConfig = false, removeConfig = false) {
  const target = active.value
  if (!target) return

  // workspace packages don't need to be installed
  if (bulkMode.value && !workspace.value) {
    const override = getPendingOverrides()
    if (dep.value?.resolved === version || !version && !dep.value) {
      delete override[target]
    } else {
      override[target] = version
    }
    void patchMarketNextData({ override: { ...override } })
    active.value = ''
    return
  }

  // 1. The plugin is to be removed.
  // 2. The plugin has config entries.
  // 3. `removeConfig` is not set.
  if (checkConfig && getConfigWriter(ctx)?.get(target)?.length) {
    const savedRemoveConfig = getRemoveConfig(config.value)
    if (typeof savedRemoveConfig !== 'boolean') {
      showRemoveDialog.value = true
      return
    } else {
      removeConfig = savedRemoveConfig
    }
  }

  if (saveChoice.value) {
    if (config.value.market) config.value.market.removeConfig = removeConfig
    void patchMarketNextConfig({ removeConfig })
  }
  saveChoice.value = false
  showRemoveDialog.value = false

  versions[target] = version
  return install(versions, async () => {
    if (workspace.value) return
    if (version) {
      for (const key in versions) {
        await ensureInstalledConfig(ctx, key, key !== target)
      }
    } else if (removeConfig) {
      getConfigWriter(ctx)?.remove(target)
    }
    if (!version) {
      const records = getWritableBundleRecords(config.value)
      delete records[target]
      const saved = await patchMarketNextData({ bundleRecords: records })
      if (!saved) message.warning(t('operations.confirm.saveBundleFailed'))
    }
  })
}

/** 当前目标包选中版本的读写代理(写入 versions 映射)。 */
const version = computed({
  get: () => versions[active.value],
  set: (value) => versions[active.value] = value,
})

/** 头部版本下拉的双向绑定(与 version 同源)。 */
const selectVersion = computed({
  get: () => version.value,
  set(value) {
    version.value = value
  },
})

/** 非批量模式的本地覆盖映射:包名 → 版本(目标包 + 需要调整的 peer)。 */
const versions = reactive<Dict<string>>({})

/** 覆盖清单来源:批量模式取共享 override,非批量模式取本地 versions。 */
function getOverride() {
  return bulkMode.value ? getPendingOverrides() : versions
}

/** 读某 peer 在覆盖清单里选定的版本。 */
function getVersion(name: string) {
  const override = getOverride()
  return override[name]
}

/** 写 peer 版本;空串(移除)时从清单删掉该项,避免产生"卸载"语义。 */
function setVersion(name: string, version: string) {
  const override = getOverride()
  if (version) {
    override[name] = version
  } else {
    delete override[name]
  }
}

/** peer 行是否展示版本下拉:registry 无数据或本地包选择时不可选;已在清单中或检测不兼容(danger)时才需要手动改选。 */
function shouldShowPeerVersionSelect(peer: PeerInfo, name: string) {
  if (!store.registry?.[name] || isLocalPackageSelection(name)) return false
  if (name in getOverride()) return true
  return peer.result === 'danger'
}

/** peer 实际生效版本的查找顺序:覆盖清单 > workspace > analyze 结果 > 依赖表 > 本地包。 */
function getPeerResolvedVersion(peer: PeerInfo, name: string) {
  return getVersion(name)
    || getWorkspaceVersion(name)
    || peer.resolved
    || store.dependencies?.[name]?.resolved
    || store.packages?.[name]?.package.version
}

/** 主按钮禁用条件:选中版本在 registry 无数据,或与当前依赖的 request 一致且已解析安装。 */
const unchanged = computed(() => {
  return !data.value?.[version.value]
    || version.value === store.dependencies?.[active.value]?.request && !!store.dependencies?.[active.value]?.resolved
})

/** 当前目标包的依赖条目 / 已解析版本 / 本地已加载包。 */
const dep = computed(() => store.dependencies?.[active.value])
const current = computed(() => store.dependencies?.[active.value]?.resolved)
const local = computed(() => store.packages?.[active.value])
/** 卸载目标为合包时用于回放的记录视图:持久化记录优先,缺则本地推导。 */
const bundleUninstallRecord = computed(() => {
  const target = bundleUninstallTarget.value
  if (!target || !isBundlePackageName(target)) return
  return getBundleRecords(config.value)[target] || createLocalBundleRecord(target)
})

/** 是否展示"卸载"按钮:已安装,或批量模式下已有待应用的安装项。 */
const showRemoveButton = computed(() => {
  return current.value || store.dependencies?.[active.value] || bulkMode.value && getPendingOverrides()[active.value]
})

/** 目标包的 workspace 版本(非 workspace 包为 undefined)。 */
const workspace = computed(() => getWorkspaceVersion(active.value))
/** 当前选择是否"本地形态"(本地依赖/workspace/仅本地加载):无 registry 可比,面板切换为精简形态。 */
const localSelection = computed(() => isLocalPackageSelection(active.value))

/** 判定某包是否本地形态:本地安装依赖、workspace 包,或不在依赖表但在 packages 里。 */
function isLocalPackageSelection(name: string) {
  if (!name) return false
  const dependency = store.dependencies?.[name]
  return isLocalDependency(dependency)
    || !!getWorkspaceVersion(name)
    || !dependency && !!store.packages?.[name]
}

/**
 * 卸载入口:目标是合包(有记录或本地可推导)时关掉本面板、转交
 * bundle-uninstall 对话框按成员处理;普通包走 installDep('', true)。
 */
function requestRemove() {
  const target = active.value
  const record = target && (getBundleRecords(config.value)[target] || createLocalBundleRecord(target))
  if (target && record) {
    bundleUninstallTarget.value = target
    active.value = ''
    showBundleUninstallDialog.value = true
    return
  }
  installDep('', true)
}

/** 查询某包的 workspace 版本:依赖表与 packages 各查一遍(两处都可能记录 workspace 标记)。 */
function getWorkspaceVersion(name: string) {
  // workspace plugins:     dependencies ? packages √
  // workspace non-plugins: dependencies √ packages ×
  if (store.dependencies?.[name]?.workspace) {
    return store.dependencies?.[name]?.resolved
  }
  if (store.packages?.[name]?.workspace) {
    return store.packages?.[name]?.package.version
  }
}

/** peer 兼容性分析结果(analyzeVersions):各版本的 peers 明细与总体红黄绿。本地形态选择返回 undefined。 */
const data = computed(() => {
  if (!active.value || localSelection.value) return
  return analyzeVersions(active.value, getVersion)
})

/** 目标包 registry 元数据的拉取状态对象(loading/失败原因)。 */
const registryStatus = computed(() => getRegistryStatus(active.value))

/** 拉取状态的用户可读文案(加载中/超时/404/网络错误等)。 */
const registryStatusText = computed(() => getRegistryStatusText(active.value))

/** 红色警告:选中版本已弃用,或市场条目标记为不安全(insecure)。 */
const danger = computed(() => {
  if (localSelection.value) return
  const deprecated = store.registry?.[active.value]?.[version.value]?.deprecated
  if (deprecated) return t('operations.install.deprecated', { reason: deprecated })
  if (getMarketObject(active.value)?.insecure) {
    return t('operations.install.insecure')
  }
})

/** 黄色警告:跨大版本(0.x 时代跨 minor)升级提示。 */
const warning = computed(() => {
  if (!version.value || !current.value || localSelection.value) return
  try {
    const source = parse(current.value)
    const target = parse(version.value)
    if (source.major !== target.major || !source.major && source.minor !== target.minor) {
      return t('operations.install.majorWarning')
    }
  } catch {}
})

/** 主按钮的颜色类型:版本分析结果,叠加 deprecated/insecure 与跨版本警告取更严重者。 */
const result = computed(() => {
  if (!version.value || !data.value?.[version.value]) return
  const { result } = data.value[version.value]
  if (result === 'danger' || danger.value) return 'danger'
  if (result === 'warning' || warning.value) return 'warning'
  return result
})

/** 是否需要拉取某包的 registry 元数据:本地无缓存、非本地形态选择、且当前没有在途请求。 */
function shouldFetchRegistry(name: string) {
  return !store.registry?.[name]
    && !isLocalPackageSelection(name)
    && !getRegistryStatus(name)?.loading
}

/**
 * peer 变化时:补拉缺失的 peer registry 元数据;非批量模式下重建本地
 * versions——清掉已不在 peer 列表的选择,给 warning/danger 的 peer
 * 默认选 registry 首个版本。
 */
watch(() => data.value?.[version.value]?.peers, async (peers) => {
  if (!peers) return
  const names = Object.keys(peers).filter(shouldFetchRegistry)
  let registry: typeof store.registry = {}
  if (names.length) {
    try {
      registry = await send('market/registry', names)
    } catch (error) {
      console.error(error)
    }
  }
  Object.assign(registry, store.registry)
  if (bulkMode.value) return

  // rebuild versions
  for (const name of Object.keys(versions)) {
    if (name === active.value) continue
    if (name in peers) continue
    delete versions[name]
  }
  for (const name in peers) {
    if (!registry[name]) continue
    const { result } = peers[name]
    if (result !== 'warning' && result !== 'danger') continue
    versions[name] = Object.keys(registry[name])[0]
  }
})

/** 面板打开时初始化目标版本:待应用 override > 当前依赖 request > registry 首个版本;无缓存时先拉 registry 再取首个版本。 */
watch(active, async (name) => {
  if (!name) return

  version.value = getPendingOverrides()[active.value]
    || store.dependencies?.[active.value]?.request
    || Object.keys(store.registry?.[name] || {})[0]

  if (shouldFetchRegistry(name)) {
    try {
      const registry = await send('market/registry', [name])
      const versions = registry?.[active.value] || store.registry?.[active.value]
      if (versions) version.value = Object.keys(versions)[0]
    } catch (error) {
      console.error(error)
    }
  }
}, { immediate: true })

/** 本地包"配置插件"按钮:为其在 koishi.yml 补建配置节点后关面板。 */
function configure() {
  getConfigWriter(ctx)?.ensure(active.value)
  closePanel()
}

/** 关闭面板:清空 active。 */
function closePanel() {
  active.value = ''
}

/** peer 检查结论的图标:蓝 info / 黄叹号 / 红叉 / 绿勾。 */
function getResultIcon(type: ResultType) {
  switch (type) {
    case 'primary': return 'info-full'
    case 'warning': return 'exclamation-full'
    case 'danger': return 'times-full'
    case 'success': return 'check-full'
  }
}

/** peer 检查结论的文案:结合"是否已在覆盖清单/是否已装"区分 待安装/待更新/待移除/已下载/不兼容/未下载/可选 等状态。 */
function getResultText(peer: PeerInfo, name: string) {
  const isOverriden = name in getOverride()
  const isInstalled = store.packages ? !!store.packages[name] : !!store.dependencies?.[name]
  switch (peer.result) {
    case 'primary': return isOverriden ? t('operations.install.waitingRemove') : t('operations.install.optional')
    case 'danger': return peer.resolved ? t('operations.install.incompatible') : isOverriden ? t('operations.install.waitingRemove') : t('operations.install.notDownloaded')
    case 'success': return isOverriden ? isInstalled ? t('operations.install.waitingUpdate') : t('operations.install.waitingInstall') : t('operations.install.downloaded')
  }
}

</script>

<style lang="scss" src="./install.scss"></style>
