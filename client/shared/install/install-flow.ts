import { type Awaitable, type Dict, message, receive, send, socket } from '@koishijs/client'
import { reactive, watch } from 'vue'
import { translate } from '../../i18n'
import { extractErrorMessage } from '../error'
import { active } from '../ui/dialogs'
import { formatEndpoint } from './registry-status'
import type { InstallFallbackCandidate } from '../../../src/shared/types'

interface LogLine {
  type: 'stdout' | 'stderr'
  line: string
}

export interface InstallOptions {
  installEndpoint?: string
}

export const MARKET_NEXT_PACKAGE = 'koishi-plugin-marketn-refactored'

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

receive('market/install-log', (log: LogLine) => {
  if (installProgressState.status === 'running') {
    installProgressState.logs.push(log)
  }
})

export interface InstallMessages {
  loadingText?: string
  successText?: string
  errorText?: string
  timeoutText?: string
  waitingText?: string
  selfUpdate?: boolean
  skipCallbackOnDisconnect?: boolean
  allowDisconnectSuccess?: boolean
}

export function pushInstallLog(line: string, type: LogLine['type'] = 'stdout') {
  installProgressState.logs.push({ type, line })
}

export function resetInstallFallbackState() {
  installProgressState.fallbackCandidate = undefined
  installProgressState.fallbackRunning = false
  installProgressState.fallbackUsed = false
  installProgressState.retryFallback = undefined
}

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

export function reportInstallRequestError(error: unknown, messages: InstallMessages) {
  const detail = extractErrorMessage(error) ?? String(error || 'unknown error')
  const isTimeout = detail === 'timeout'
  pushInstallLog(translate('operations.progress.requestFailed', { detail }), 'stderr')
  message.error(isTimeout
    ? messages.timeoutText ?? translate('operations.progress.installTimeout')
    : `${messages.errorText ?? translate('operations.progress.installError')}${detail ? ` ${detail}` : ''}`)
}

function isSelfUpdate(override: Dict<string>) {
  return Object.prototype.hasOwnProperty.call(override, MARKET_NEXT_PACKAGE)
}

/** 监听 socket 断开并返回可竞速的 promise（install 与 environment restore 共用）。 */
export function createSocketDisconnectTracker() {
  let resolveDisconnected: (value: number) => void
  const disconnected = new Promise<number>((resolve) => {
    resolveDisconnected = resolve
  })
  let flag = false
  const dispose = watch(socket, (value, previous) => {
    if (value || !previous) return
    flag = true
    resolveDisconnected(0)
    dispose()
  })
  return {
    disconnected,
    get disconnectedBeforeResponse() {
      return flag
    },
    dispose,
  }
}

async function runInstallFlow(
  override: Dict<string>,
  forced: boolean | undefined,
  callback: (() => Awaitable<void>) | undefined,
  messages: InstallMessages,
  selfUpdate: boolean,
  options?: InstallOptions,
) {
  const tracker = createSocketDisconnectTracker()
  const waitTimer = setTimeout(() => {
    if (installProgressState.status !== 'running') return
    pushInstallLog(messages.waitingText ?? (selfUpdate
      ? translate('operations.progress.waitingSelf')
      : translate('operations.progress.waitingDependencies')))
  }, 8000)
  try {
    const task = send('market/install', override, forced, options ?? {}) ?? Promise.resolve(1)
    const code = await Promise.race([task, tracker.disconnected])
    if (tracker.disconnectedBeforeResponse && !selfUpdate && !messages.allowDisconnectSuccess) {
      installProgressState.status = 'error'
      pushInstallLog(translate('operations.progress.disconnected'), 'stderr')
      message.warning(translate('operations.progress.disconnectedShort'))
      return undefined
    }
    if (code) {
      installProgressState.status = 'error'
      message.error(messages.errorText ?? translate('operations.progress.installError'))
      if (!tracker.disconnectedBeforeResponse) await prepareInstallFallbackRetry(
        (nextOptions) => runInstallFlow(override, forced, callback, messages, selfUpdate, nextOptions),
        options?.installEndpoint,
      )
      return code
    }
    installProgressState.status = 'success'
    const shouldSkipCallback = selfUpdate
      && tracker.disconnectedBeforeResponse
      && messages.skipCallbackOnDisconnect !== false
    if (!shouldSkipCallback) {
      try {
        await callback?.()
      } catch (error) {
        if (!tracker.disconnectedBeforeResponse) throw error
        console.warn(error)
      }
    }
    if (tracker.disconnectedBeforeResponse && !socket.value) {
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
    tracker.dispose()
  }
}

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

  try {
    active.value = ''
    await runInstallFlow(override, forced, callback, messages, selfUpdate)
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallRequestError(err, messages)
  }
}
