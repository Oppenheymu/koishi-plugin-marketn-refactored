/**
 * @file client 侧安装/环境恢复编排与合包（bundle）记录工具（shared 域）。
 *
 * 模块职责:
 * - `install` / `applyEnvironmentSnapshot`:依赖安装与环境快照回滚的完整前端编排,
 *   覆盖进度面板状态机、socket 断连竞态处理、自更新（本插件自身被更新）特判、
 *   安装失败后的备选 registry 端点重试（fallback）;
 * - 合包记录族函数:在没有服务端持久化记录时,从 registry 元数据或本地安装状态
 *   重建 BundleRecordView,供卸载/管理对话框回放当时的安装选择;
 * - `analyzeVersions`:peerDependencies 兼容性扫描,驱动依赖卡片的红/黄/绿状态。
 *
 * 关键设计:
 * - 安装期间 Koishi 可能重启导致 console socket 断开:以 watch(socket) 构造
 *   disconnected Promise 与 RPC 任务 race,自更新场景把"断连"视作已提交而非失败;
 * - installProgressState 是唯一的进度面板状态源,install-log 广播只在其处于
 *   running 状态时追加,避免上一轮残留日志混入。
 */

import { Awaitable, Context, Dict, loading, message, receive, send, socket, store, valueMap } from '@koishijs/client'
import type { Registry, SearchObject } from '@koishijs/registry'
import type { RegistryStatus } from 'koishi-plugin-marketn-refactored'
import { compare, satisfies } from 'semver'
import { reactive, ref, watch } from 'vue'
import { active } from './plugin-config'
import { translate } from './i18n'
import {
  getBundleGroupIdent,
  getPluginShortname,
} from '../../src/shared/bundle-idents'
import {
  isBundlePackageName,
  parseBundleManifest,
  type PluginBundleManifest,
  type PluginBundleRecord,
} from '../../src/shared/bundle'

/** 依赖/peer 检查结论的展示级别:success 绿 / warning 黄 / danger 红 / primary 蓝(仅提示)。 */
export type ResultType = 'success' | 'warning' | 'danger' | 'primary'

/**
 * configWriter 服务的最小接口声明(@koishijs/plugin-config 暴露的客户端配置读写器)。
 * 这里只依赖用到的三个方法,避免对插件内部类型的硬依赖。
 */
export interface ClientConfigWriter {
  get(name: string): any[] | undefined
  ensure(name: string, silent?: boolean): void
  remove(name: string): void
}

/** 取当前上下文的 configWriter 服务;未安装 config 插件时为 undefined。 */
export function getConfigWriter(ctx: Context) {
  return ctx.get('configWriter') as ClientConfigWriter | undefined
}

interface AnalyzeResult {
  peers: Dict<PeerInfo>
  result: ResultType
}

/** 单个 peer 依赖的检查结果:request 为期望范围,resolved 为宿主实际版本。 */
export interface PeerInfo {
  request: string
  resolved: string
  result: ResultType
}

/**
 * 逐版本扫描某个包的 peerDependencies 兼容性。
 *
 * 数据源优先级:运行中插件的真实 registry(store.registry,含未发布版本)>
 * 手动添加的 manualDeps。每个 peer 的已装版本依次尝试 getVersion 回调、
 * store.dependencies、store.packages 三处;optional peer 缺失时只标 primary
 * (蓝,提示而非报错)。任一 peer danger 则整版本 danger,deprecated 版本直接 danger。
 *
 * @param name 包名
 * @param getVersion 自定义版本查询(依赖页传入以覆盖默认查找顺序)
 */
export function analyzeVersions(name: string, getVersion: (name: string) => string): Dict<AnalyzeResult> {
  const versions = store.registry?.[name] || manualDeps[name]?.versions
  if (!versions) return
  return valueMap(versions, (item) => {
    const peers = valueMap({ ...item.peerDependencies }, (request, name) => {
      const resolved = (getVersion ? getVersion(name) : null)
        ?? store.dependencies[name]?.resolved
        ?? store.packages?.[name]?.package.version
      const result: ResultType = !resolved
        ? item.peerDependenciesMeta?.[name]?.optional ? 'primary' : 'danger'
        : satisfies(resolved, request, { includePrerelease: true }) ? 'success' : 'danger'
      return { request, resolved, result } as PeerInfo
    })
    let result: 'success' | 'warning' | 'danger' = 'success'
    for (const peer of Object.values(peers)) {
      if (peer.result === 'danger') {
        result = 'danger'
        break
      }
      if (peer.result === 'warning') {
        result = 'warning'
      }
    }
    if (item.deprecated) result = 'danger'
    return { peers, result }
  })
}

/** 手动添加(搜索未收录包)后缓存在前端的 registry 元数据,key 为包名。 */
const manualDeps = reactive<Dict<Registry>>({})

/** store 上由本插件注入的运行时 registry 状态通道(非官方 store 字段的窄化声明)。 */
type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

/** 读取某包的 registry 拉取状态(loading/失败原因/重试次数),供依赖卡片展示。 */
export function getRegistryStatus(name: string) {
  return (store as MarketStore).registryStatus?.[name]
}

/** 把 registry 状态翻译成用户可读文案:进行中/超时/404/网络错误等各占一条 i18n。 */
export function getRegistryStatusText(name: string) {
  const status = getRegistryStatus(name)
  if (!status || status.loading) {
    return translate('dependencyCard.registry.loading', {
      endpoint: status?.endpoint ? ` (${formatEndpoint(status.endpoint)})` : '',
      attempts: status?.attempts ? `, ${translate('dependencyCard.registry.attempts', { count: status.attempts })}` : '',
    })
  }
  const endpoint = status.endpoint ? ` (${formatEndpoint(status.endpoint)})` : ''
  switch (status.reason) {
    case 'timeout':
      return translate('dependencyCard.registry.timeout', { endpoint })
    case 'not-found':
      return translate('dependencyCard.registry.notFound', { endpoint })
    case 'network':
      return translate('dependencyCard.registry.network', { endpoint })
    case 'invalid':
      return translate('dependencyCard.registry.invalid', { endpoint })
    case 'http':
      return translate('dependencyCard.registry.http', { endpoint })
    default:
      return translate('dependencyCard.registry.unknown', { endpoint, error: status.error ? `: ${status.error}` : '' })
  }
}

/** 端点 URL 只展示 host 部分;解析失败(相对路径等)原样返回。 */
function formatEndpoint(endpoint: string) {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

/**
 * 手动添加一个包:拉取 registry 元数据,按版本号降序排序后缓存进 manualDeps。
 * 排序保证依赖卡片默认展示最新版本在前的选择列表。
 */
export async function addManual(name: string) {
  const data = await send('market/package', name) as Registry
  if (!data?.versions) throw new Error(`failed to fetch package metadata: ${name}`)
  data.versions = Object.fromEntries(Object.entries(data.versions).sort((a, b) => compare(b[0], a[0])))
  return manualDeps[name] = data
}

// ---- 全局对话框开关与跨组件共享的轻量状态 ----

/** "手动添加依赖"对话框开关。 */
export const showManual = ref(false)
/** 通用确认对话框开关(删除依赖等危险操作)。 */
export const showConfirm = ref(false)
/** 安装历史对话框开关。 */
export const showInstallHistory = ref(false)
/** 环境版本快照对话框开关。 */
export const showEnvironmentVersions = ref(false)
/** 依赖列表当前展开的条目包名(展开才显示 peer 明细)。 */
export const expandedDependency = ref('')
/** 市场条目弹层当前展示的合包对象。 */
export const activeBundle = ref<SearchObject>()

/** 合包成员卸载清理的目标标识(包名 + 插件键二选一即可定位)。 */
export type BundleMemberCleanupTarget = {
  package: string
  plugin: string
}

/**
 * 待处理的合包成员卸载队列:key 为合包包名,value 为该合包下待卸载的成员
 * plugin 键列表与"是否顺带清理配置"标记。卸载流程先收集到这里,等用户在
 * 确认对话框里拍板后再统一执行。
 */
export const pendingBundleUninstalls = ref<Record<string,{
  members: string[]
  cleanup: boolean
  configs?: BundleMemberCleanupTarget[]
}>>({})

/** PluginBundleRecord 的前端视图形态:fallback=true 表示非持久化记录、由本地状态推导。 */
export type BundleRecordView = PluginBundleRecord & {
  fallback?: boolean
}

/**
 * 从清单构造合包记录视图(无本地安装状态时的"理想形态"):所有成员默认
 * selected、skipped,installedAt 为 0,标记 fallback 供 UI 与真实记录区分。
 */
function createBundleRecordFromManifest(packageName: string, version = '', bundle?: PluginBundleManifest, fallback = true): BundleRecordView | undefined {
  if (!isBundlePackageName(packageName)) return
  return {
    package: packageName,
    version,
    label: bundle?.label || getPluginShortname(packageName),
    groupKey: `group:${getBundleGroupIdent(packageName)}`,
    installedAt: 0,
    fallback,
    members: (bundle?.members ?? []).map(member => ({
      ...member,
      selected: true,
      installedByBundle: false,
      skipped: true,
    })),
  }
}

/**
 * 从本地安装状态推导合包记录:读取 store.packages / store.dependencies 里
 * 已装合包的 package.json,解析 koishi.bundle 字段后交给
 * createBundleRecordFromManifest 生成视图(fallback=false,版本取已装版本)。
 * 合包未装或清单为空时返回 undefined。
 */
export function createLocalBundleRecord(packageName: string): BundleRecordView | undefined {
  if (!isBundlePackageName(packageName)) return
  const local = store.packages?.[packageName]
  const dep = store.dependencies?.[packageName]
  if (!local && !dep) return
  const bundle = parseBundleManifest((local?.package as any)?.koishi?.bundle)
  if (!bundle?.members.length) return
  return createBundleRecordFromManifest(packageName, dep?.resolved ?? local?.package.version ?? '', bundle)
}

/**
 * 由 koishi.yml 的分组路径反查合包包名:优先查持久化安装记录的 groupKey,
 * 否则遍历本地已装包,用本地清单推导的分组标识逐一比对。
 *
 * @param groupPath 形如 "group:pa-xxx" 或 "pa-xxx"
 * @param records 服务端下发的合包安装记录(MarketDataStore 持久化的那份)
 */
export function resolveBundlePackageFromGroup(groupPath?: string, records: Dict<PluginBundleRecord> = {}) {
  if (!groupPath) return
  const groupKey = groupPath.startsWith('group:') ? groupPath : `group:${groupPath}`
  const byRecord = Object.values(records).find(record => record?.groupKey === groupKey)
  if (byRecord?.package) return byRecord.package
  const names = new Set([
    ...Object.keys(store.dependencies ?? {}),
    ...Object.keys(store.packages ?? {}),
  ])
  return [...names].find((name) => {
    const record = createLocalBundleRecord(name)
    return !!record && getBundleGroupIdent(name) === groupPath.replace(/^group:/, '')
  })
}

/** 由分组路径取合包记录视图:先反查包名,持久化记录优先,缺则本地推导。 */
export function resolveBundleRecordFromGroup(groupPath?: string, records: Dict<PluginBundleRecord> = {}) {
  const packageName = resolveBundlePackageFromGroup(groupPath, records)
  if (!packageName) return
  return records[packageName] || createLocalBundleRecord(packageName)
}

/** 去掉分组路径的 group: 前缀,统一成裸分组标识再比较。 */
function normalizeGroupPath(path?: string) {
  return path?.replace(/^group:/, '')
}

/** 判断配置节点是否位于指定合包分组下(两侧都做前缀归一)。 */
function isBundleGroupPath(path: string | undefined, groupKey: string | undefined) {
  if (!path || !groupKey) return false
  return normalizeGroupPath(path) === normalizeGroupPath(groupKey)
}

/**
 * 统计某合包成员当前在 koishi.yml 里的配置节点分布。
 *
 * configWriter 以包名和插件键两种键都可能查到节点,先按 path/id 去重,再按
 * 父节点是否位于合包分组拆成 group(组内)与 external(组外)两组——卸载清理
 * 与"移动进分组"都以这个划分为准。
 */
export function getBundleMemberConfigState(ctx: Context, member: BundleMemberCleanupTarget, groupKey?: string) {
  const configWriter = getConfigWriter(ctx)
  const nodes = [
    ...(configWriter?.get(member.package) ?? []),
    ...(member.plugin ? configWriter?.get(member.plugin) ?? [] : []),
  ]
  const unique = new Map<string, any>()
  for (const node of nodes) {
    if (!node) continue
    unique.set(node.path || node.id, node)
  }
  const entries = [...unique.values()]
  const getParentPath = (node: any) => node.parent?.path || node.parent?.id
  return {
    all: entries,
    group: entries.filter(node => isBundleGroupPath(getParentPath(node), groupKey)),
    external: entries.filter(node => !isBundleGroupPath(getParentPath(node), groupKey)),
  }
}

/**
 * 拉取合包的完整记录视图:向服务端要 registry 元数据,取"本地已装版本对应的
 * 清单"(装的不是最新版时不能拿最新版清单充数),解析失败或清单为空时逐步
 * 回退到本地推导。任何网络异常都吞掉并走回退路径。
 */
export async function fetchBundleRecord(packageName: string): Promise<BundleRecordView | undefined> {
  if (!isBundlePackageName(packageName)) return
  const registry = await (send('market/package', packageName) ?? Promise.resolve(undefined)).catch((error) => {
    console.warn(error)
    return undefined
  }) as Registry | undefined
  if (!registry?.versions) return createLocalBundleRecord(packageName)
  const targetVersion = store.dependencies?.[packageName]?.resolved ?? store.packages?.[packageName]?.package.version
  const entry = targetVersion && registry.versions?.[targetVersion]
    ? [targetVersion, registry.versions[targetVersion]] as const
    : Object.entries(registry.versions ?? {})[0]
  if (!entry) return createLocalBundleRecord(packageName)
  const [version, remote] = entry
  const bundle = parseBundleManifest((remote as any)?.koishi?.bundle)
  if (!bundle?.members.length) return createLocalBundleRecord(packageName)
  return createBundleRecordFromManifest(packageName, version, bundle)
}

/** 安装日志行:type 区分 stdout/stderr 以便进度面板着色。 */
export interface LogLine {
  type: 'stdout' | 'stderr'
  line: string
}

/** 备选安装端点候选:主端点失败后提示用户可切换的 registry 镜像。 */
interface InstallFallbackCandidate {
  endpoint: string
  label: string
  reason: string
}

/** 安装附加选项:installEndpoint 指定用哪个 registry 端点装(fallback 重试时用)。 */
export interface InstallOptions {
  installEndpoint?: string
}

/** 本插件自身的包名:override 里出现它即视为"自更新"场景。 */
export const MARKET_NEXT_PACKAGE = 'koishi-plugin-marketn-refactored'

/**
 * 安装进度面板的唯一状态源。status 是面板的状态机:
 * idle(隐藏) → running(安装中) → success/error(终态,展示重试/关闭按钮)。
 * selfUpdate 标记本次是否在更新本插件自身(成功后宿主会重启);
 * environmentRestore 标记是环境快照回滚而非普通安装。
 */
export const installProgressState = reactive({
  visible: false,
  status: 'idle', // 'idle' | 'running' | 'success' | 'error'
  logs: [] as LogLine[],
  title: '',
  selfUpdate: false,
  environmentRestore: false,
  fallbackCandidate: undefined as InstallFallbackCandidate | undefined,
  fallbackRunning: false,
  fallbackUsed: false,
  retryFallback: undefined as undefined | (() => Promise<void>),
})

// 服务端转发的包管理器输出:仅在安装进行中追加,防止上一轮日志混入
receive('market/install-log', (log: LogLine) => {
  if (installProgressState.status === 'running') {
    installProgressState.logs.push(log)
  }
})

/** 安装回调的文案覆盖项:各入口(市场/依赖页/环境回滚)传入自己的标题与提示。 */
interface InstallMessages {
  loadingText?: string
  successText?: string
  errorText?: string
  timeoutText?: string
  waitingText?: string
  /** 本次是否自更新(缺省时由 override 内容推断)。 */
  selfUpdate?: boolean
  /** 自更新断连时是否跳过 callback(默认跳过:宿主即将重启,回调无意义)。 */
  skipCallbackOnDisconnect?: boolean
  /** 非自更新场景断连是否按成功处理(默认不)。 */
  allowDisconnectSuccess?: boolean
}

/** 向进度面板追加一条本地生成的日志(i18n 文案在此处格式化)。 */
function pushInstallLog(line: string, type: LogLine['type'] = 'stdout') {
  installProgressState.logs.push({ type, line })
}

/** 每次新的安装/回滚开始前清空 fallback 相关状态,保证重试提示只出现一次。 */
export function resetInstallFallbackState() {
  installProgressState.fallbackCandidate = undefined
  installProgressState.fallbackRunning = false
  installProgressState.fallbackUsed = false
  installProgressState.retryFallback = undefined
}

/**
 * 安装失败后准备 fallback 重试:向服务端查询备选 registry 端点,有候选则在
 * 进度面板记录日志并挂上 retryFallback 回调(用户点"使用镜像重试"时执行)。
 * fallbackUsed/retryFallback 已存在时直接返回——同一次安装只提示一次。
 *
 * @param run 实际执行安装的闭包(携带 override 等上下文)
 * @param failedEndpoint 刚才失败了的端点(服务端据此避开它选候选)
 */
export async function prepareInstallFallbackRetry(run: (options?: InstallOptions) => Promise<number | undefined>, failedEndpoint?: string) {
  if (installProgressState.fallbackUsed || installProgressState.retryFallback) return
  const candidate = await (send('market/install-fallback-candidate', failedEndpoint) ?? Promise.resolve(undefined)).catch((error) => {
    console.warn(error)
    return undefined
  }) as InstallFallbackCandidate | undefined
  if (!candidate?.endpoint) return
  installProgressState.fallbackCandidate = candidate
  pushInstallLog(translate('operations.progress.fallbackLog', {
    endpoint: candidate.label || formatEndpoint(candidate.endpoint),
  }))
  installProgressState.retryFallback = async () => {
    if (installProgressState.fallbackRunning || installProgressState.fallbackUsed) return
    installProgressState.fallbackRunning = true
    installProgressState.fallbackUsed = true
    installProgressState.fallbackCandidate = undefined
    installProgressState.status = 'running'
    pushInstallLog(translate('operations.progress.fallbackConfirmed', { endpoint: candidate.endpoint }))
    try {
      const code = await run({ installEndpoint: candidate.endpoint })
      if (code) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.fallbackFailed', { code }), 'stderr')
      }
    } finally {
      installProgressState.fallbackRunning = false
      installProgressState.retryFallback = undefined
    }
  }
}

/** 把任意抛出的错误归一成可展示的字符串:Error/字符串/{message}/{error} 逐级尝试。 */
function formatInstallError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as any
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
  }
  return String(error || 'unknown error')
}

/** 安装 RPC 本身失败(请求都没发成功)时的统一上报:日志 + toast,超时有专属文案。 */
function reportInstallRequestError(error: unknown, messages: InstallMessages) {
  const detail = formatInstallError(error)
  const isTimeout = detail === 'timeout'
  pushInstallLog(translate('operations.progress.requestFailed', { detail }), 'stderr')
  message.error(isTimeout
    ? messages.timeoutText ?? translate('operations.progress.installTimeout')
    : `${messages.errorText ?? translate('operations.progress.installError')}${detail ? ` ${detail}` : ''}`)
}

/** 自更新判定:覆盖清单里含有本插件包名(哪怕是卸载它)就算。 */
function isSelfUpdate(override: Dict<string>) {
  return Object.prototype.hasOwnProperty.call(override, MARKET_NEXT_PACKAGE)
}

/**
 * 构造与 socket 断连竞态的 disconnected Promise:宿主重启断线时以退出码 0
 * 结束 race,让上层统一走"断连分支"处理;返回的 state 供上层读取是否断连。
 */
function createDisconnectRace() {
  let resolveDisconnected: (value: number) => void
  const disconnected = new Promise<number>((resolve) => {
    resolveDisconnected = resolve
  })
  const state = { disconnectedBeforeResponse: false }
  const dispose = watch(socket, (value, previous) => {
    if (value || !previous) return
    state.disconnectedBeforeResponse = true
    resolveDisconnected(0)
    dispose()
  })
  return { disconnected, state, dispose }
}

/**
 * 依赖安装的完整前端编排:重置面板状态 → 调 market/install RPC → 处理
 * 断连竞态与退出码 → 成功时执行回调并弹 toast,失败时准备 fallback 重试。
 *
 * 断连竞态:自更新会让宿主重启、console socket 掉线。用 watch(socket) 构造
 * disconnected Promise 与 RPC 任务 race——socket 先掉线且非自更新时按失败
 * 处理(普通安装不应导致重启);自更新时按"已提交"处理,toast 文案也换成
 * 提交版,并默认跳过 callback(宿主马上重启,回调没有意义)。
 *
 * 8 秒未响应时追加"仍在等待"日志,给用户进度感知。
 *
 * @param override 覆盖清单:包名 → 版本请求(空串表示卸载)
 * @param callback 安装成功后的回调(通常触发列表刷新)
 * @param forced 是否强制安装(忽略版本比较,服务端语义)
 * @param messages 文案覆盖项
 * @returns 成功返回 0,失败返回退出码,请求失败/断连返回 undefined
 */
export async function install(override: Dict<string>, callback?: () => Awaitable<void>, forced?: boolean, messages: InstallMessages = {}) {
  const selfUpdate = messages.selfUpdate ?? isSelfUpdate(override)
  resetInstallFallbackState()
  installProgressState.title = messages.loadingText ?? (selfUpdate
    ? translate('operations.progress.selfUpdateTitle')
    : translate('operations.progress.dependencyTitle'))
  installProgressState.logs = []
  installProgressState.status = 'running'
  installProgressState.selfUpdate = selfUpdate
  installProgressState.environmentRestore = false
  installProgressState.visible = true
  pushInstallLog(translate('operations.progress.submitted'))
  if (selfUpdate) {
    pushInstallLog(translate('operations.progress.selfSubmitted'))
  }

  const runInstall = async (options?: InstallOptions) => {
    // socket 断开时以退出码 0 结束 race:让上层逻辑统一走"断连分支"处理
    const { disconnected, state, dispose } = createDisconnectRace()
    const waitTimer = setTimeout(() => {
      if (installProgressState.status !== 'running') return
      pushInstallLog(messages.waitingText ?? (selfUpdate
        ? translate('operations.progress.waitingSelf')
        : translate('operations.progress.waitingDependencies')))
    }, 8000)
    try {
      const task = send('market/install', override, forced, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (state.disconnectedBeforeResponse && !selfUpdate && !messages.allowDisconnectSuccess) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.disconnected'), 'stderr')
        message.warning(translate('operations.progress.disconnectedShort'))
        return undefined
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(messages.errorText ?? translate('operations.progress.installError'))
        // 只有真实拿到失败退出码(而非断连)才值得换镜像重试
        if (!state.disconnectedBeforeResponse) await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      const shouldSkipCallback = selfUpdate
        && state.disconnectedBeforeResponse
        && messages.skipCallbackOnDisconnect !== false
      if (!shouldSkipCallback) {
        try {
          await callback?.()
        } catch (error) {
          // 断连后的回调异常不再向上抛:安装本身已成功,刷列表失败只告警
          if (!state.disconnectedBeforeResponse) throw error
          console.warn(error)
        }
      }
      if (state.disconnectedBeforeResponse && !socket.value) {
        message.success(messages.successText ?? (selfUpdate
          ? translate('operations.progress.selfSubmittedSuccess')
          : translate('operations.progress.dependenciesSubmittedSuccess')))
      } else {
        message.success(messages.successText ?? (selfUpdate
          ? translate('operations.progress.selfSuccessToast')
          : translate('operations.progress.successToast')))
      }
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
    }
  }

  try {
    // 收起市场条目弹层,避免安装期间残留过期的版本信息
    active.value = ''
    await runInstall()
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallRequestError(err, messages)
  }
}

/**
 * 环境快照回滚的前端编排:结构与 install 基本一致,差异点——
 * 调用的是 market/environment-snapshot-apply;environmentRestore 标记为 true
 * 让进度面板展示回滚专属文案;任何断连(除自更新)都按失败处理,不提供
 * allowDisconnectSuccess 逃生门。
 */
export async function applyEnvironmentSnapshot(id: string, selfUpdate = false) {
  resetInstallFallbackState()
  showEnvironmentVersions.value = false
  installProgressState.title = translate('operations.progress.environmentTitle')
  installProgressState.logs = []
  installProgressState.status = 'running'
  installProgressState.selfUpdate = false
  installProgressState.environmentRestore = true
  installProgressState.visible = true
  pushInstallLog(translate('operations.progress.environmentPreparing'))

  const runRestore = async (options?: InstallOptions) => {
    // 同 install:断连以 0 码结束 race,由上层区分"重启中"与"真失败"
    const { disconnected, state, dispose } = createDisconnectRace()
    const waitTimer = setTimeout(() => {
      if (installProgressState.status === 'running') {
        pushInstallLog(translate('operations.progress.environmentWaiting'))
      }
    }, 8000)
    try {
      const task = send('market/environment-snapshot-apply', id, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (state.disconnectedBeforeResponse && !selfUpdate) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.environmentDisconnected'), 'stderr')
        message.warning(translate('operations.progress.environmentDisconnectedShort'))
        return
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(translate('operations.progress.environmentError'))
        if (!state.disconnectedBeforeResponse) await prepareInstallFallbackRetry(runRestore, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      message.success(state.disconnectedBeforeResponse
        ? translate('operations.progress.environmentSubmitted')
        : translate('operations.progress.environmentSuccess'))
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
    }
  }

  try {
    await runRestore()
  } catch (error) {
    console.error(error)
    installProgressState.status = 'error'
    reportInstallRequestError(error, {
      errorText: translate('operations.progress.environmentErrorTitle'),
      timeoutText: translate('operations.progress.environmentTimeout'),
    })
  }
}

/** 简易 sleep:轮询等待用。 */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 轮询等待包出现在 store.packages(最多 40×250ms = 10s),安装落库即返回。 */
async function waitForInstalledPackage(name: string) {
  for (let index = 0; index < 40; index++) {
    if (store.packages?.[name]) return
    await sleep(250)
  }
}

/** 轮询等待插件配置节点出现(configWriter 能查到即算),超时返回 false。 */
async function waitForInstalledConfig(ctx: Context, name: string) {
  for (let index = 0; index < 40; index++) {
    if (getConfigWriter(ctx)?.get(name)?.length) return true
    await sleep(250)
  }
  return false
}

/**
 * 确保已安装插件在 koishi.yml 里有配置节点:先请服务端 ensure-config(权威
 * 路径,会把保存的旧配置找回来),轮询等它生效;等不到再退回客户端
 * configWriter.ensure 兜底建一个空配置。批量安装后统一调用。
 */
export async function ensureInstalledConfig(ctx: Context, name: string, silent = true) {
  if (!name || !getConfigWriter(ctx)) return
  await (send('market/ensure-config', name) ?? Promise.resolve(false)).catch(console.error)
  await waitForInstalledPackage(name)
  if (await waitForInstalledConfig(ctx, name)) return
  const configWriter = getConfigWriter(ctx)
  if (!configWriter || configWriter.get(name)?.length) return
  configWriter.ensure(name, silent)
}

/** 批量版 ensureInstalledConfig:并行等待一组插件的配置就绪。 */
export async function ensureInstalledConfigs(ctx: Context, names: string[], silent = true) {
  await Promise.all(names.map(name => ensureInstalledConfig(ctx, name, silent)))
}
