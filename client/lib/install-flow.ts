import { type Awaitable, type Dict, message, receive, send, socket } from '@koishijs/client'
import { reactive, watch } from 'vue'
import { translate } from '../i18n'
import { active, showEnvironmentVersions } from './dialogs'
import { formatEndpoint } from './registry-status'
import type { InstallFallbackCandidate } from '../../src/shared/types'

export interface LogLine {
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

interface InstallMessages {
  loadingText?: string
  successText?: string
  errorText?: string
  timeoutText?: string
  waitingText?: string
  selfUpdate?: boolean
  skipCallbackOnDisconnect?: boolean
  allowDisconnectSuccess?: boolean
}

function pushInstallLog(line: string, type: LogLine['type'] = 'stdout') {
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

function reportInstallRequestError(error: unknown, messages: InstallMessages) {
  const detail = formatInstallError(error)
  const isTimeout = detail === 'timeout'
  pushInstallLog(translate('operations.progress.requestFailed', { detail }), 'stderr')
  message.error(isTimeout
    ? messages.timeoutText ?? translate('operations.progress.installTimeout')
    : `${messages.errorText ?? translate('operations.progress.installError')}${detail ? ` ${detail}` : ''}`)
}

function isSelfUpdate(override: Dict<string>) {
  return Object.prototype.hasOwnProperty.call(override, MARKET_NEXT_PACKAGE)
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

  const runInstall = async (options?: InstallOptions) => {
    let resolveDisconnected: (value: number) => void
    const disconnected = new Promise<number>((resolve) => {
      resolveDisconnected = resolve
    })
    let disconnectedBeforeResponse = false
    const dispose = watch(socket, (value, previous) => {
      if (value || !previous) return
      disconnectedBeforeResponse = true
      resolveDisconnected(0)
      dispose()
    })
    const waitTimer = setTimeout(() => {
      if (installProgressState.status !== 'running') return
      pushInstallLog(messages.waitingText ?? (selfUpdate
        ? translate('operations.progress.waitingSelf')
        : translate('operations.progress.waitingDependencies')))
    }, 8000)
    try {
      const task = send('market/install', override, forced, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (disconnectedBeforeResponse && !selfUpdate && !messages.allowDisconnectSuccess) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.disconnected'), 'stderr')
        message.warning(translate('operations.progress.disconnectedShort'))
        return undefined
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(messages.errorText ?? translate('operations.progress.installError'))
        if (!disconnectedBeforeResponse) await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      const shouldSkipCallback = selfUpdate
        && disconnectedBeforeResponse
        && messages.skipCallbackOnDisconnect !== false
      if (!shouldSkipCallback) {
        try {
          await callback?.()
        } catch (error) {
          if (!disconnectedBeforeResponse) throw error
          console.warn(error)
        }
      }
      if (disconnectedBeforeResponse && !socket.value) {
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
    active.value = ''
    await runInstall()
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallRequestError(err, messages)
  }
}

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
    let resolveDisconnected: (value: number) => void
    const disconnected = new Promise<number>((resolve) => {
      resolveDisconnected = resolve
    })
    let disconnectedBeforeResponse = false
    const dispose = watch(socket, (value, previous) => {
      if (value || !previous) return
      disconnectedBeforeResponse = true
      resolveDisconnected(0)
      dispose()
    })
    const waitTimer = setTimeout(() => {
      if (installProgressState.status === 'running') {
        pushInstallLog(translate('operations.progress.environmentWaiting'))
      }
    }, 8000)
    try {
      const task = send('market/environment-snapshot-apply', id, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (disconnectedBeforeResponse && !selfUpdate) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.environmentDisconnected'), 'stderr')
        message.warning(translate('operations.progress.environmentDisconnectedShort'))
        return
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(translate('operations.progress.environmentError'))
        if (!disconnectedBeforeResponse) await prepareInstallFallbackRetry(runRestore, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      message.success(disconnectedBeforeResponse
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
