import { message } from '@koishijs/client'
import { extractErrorMessage } from '../../shared/error'
import { installProgressState } from '../../shared/install/install-flow'
import { resolveCategory } from '../../market/utils'
import { getMarketObject } from '../../market/state'
export { formatPackageDisplayName as formatShortname } from '../../market/utils/format'

type Translate = (key: string, params?: Record<string, unknown>) => string

export function memberCategory(name: string) {
  const data = getMarketObject(name)
  return resolveCategory(data?.category)
}

export function reportInstallError(t: Translate, detail: string) {
  const text = detail || t('bundle.messages.unknownError')
  installProgressState.logs.push({
    type: 'stderr',
    line: t('bundle.messages.installFailed', { detail: text }),
  })
  message.error(t('bundle.messages.installFailed', { detail: text }))
}

export function formatInstallError(t: Translate, error: unknown) {
  return extractErrorMessage(error) ?? (error ? String(error) : t('bundle.messages.unknownError'))
}
