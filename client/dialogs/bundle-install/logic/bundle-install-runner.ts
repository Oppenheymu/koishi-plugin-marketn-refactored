import { type Ref, watch } from 'vue'
import { message, send, socket } from '@koishijs/client'
import type { BundleInstallRequest, BundleInstallResult } from '../../../../src/shared/bundle'
import { activeBundle } from '../../../shared/ui/dialogs'
import {
  installProgressState,
  type InstallOptions,
  prepareInstallFallbackRetry,
} from '../../../shared/install/install-flow'
import { reportInstallError } from './helpers'

/** 执行套装安装请求：断线竞速、退出码处理与回退端点重试（自 useBundleInstall 拆出）。 */
export async function runBundleInstall(
  t: (key: string, ...args: any[]) => string,
  request: BundleInstallRequest,
  options: InstallOptions | undefined,
  installing: Ref<boolean>,
) {
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
      reportInstallError(t, t('bundle.messages.disconnected'))
      return undefined
    }
    if (result?.code) {
      installProgressState.status = 'error'
      reportInstallError(t, t('bundle.messages.exitCode', { code: result.code }))
      await prepareInstallFallbackRetry(() => runBundleInstall(t, request, options, installing), options?.installEndpoint)
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
