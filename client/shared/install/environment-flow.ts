import { message } from '@koishijs/client'
import { translate } from '../../i18n'
import { showEnvironmentVersions } from '../ui/dialogs'
import {
  type InstallOptions,
  installProgressState,
  createSocketDisconnectTracker,
  prepareInstallFallbackRetry,
  pushInstallLog,
  reportInstallRequestError,
  resetInstallFallbackState,
} from './install-flow'
import { requestEnvironmentSnapshotApply } from '../../market/api'

/** 环境快照恢复流程：market/environment-snapshot-apply + 断线/回退端点处理。 */
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
    const tracker = createSocketDisconnectTracker()
    const waitTimer = setTimeout(() => {
      if (installProgressState.status === 'running') {
        pushInstallLog(translate('operations.progress.environmentWaiting'))
      }
    }, 8000)
    try {
      const task = requestEnvironmentSnapshotApply(id, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, tracker.disconnected])
      if (tracker.disconnectedBeforeResponse && !selfUpdate) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.environmentDisconnected'), 'stderr')
        message.warning(translate('operations.progress.environmentDisconnectedShort'))
        return
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(translate('operations.progress.environmentError'))
        if (!tracker.disconnectedBeforeResponse) await prepareInstallFallbackRetry(runRestore, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      message.success(tracker.disconnectedBeforeResponse
        ? translate('operations.progress.environmentSubmitted')
        : translate('operations.progress.environmentSuccess'))
      return 0
    } finally {
      clearTimeout(waitTimer)
      tracker.dispose()
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
