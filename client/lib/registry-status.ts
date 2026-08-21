import { type Dict, store } from '@koishijs/client'
import { translate } from '../i18n'
import type { RegistryStatus } from 'koishi-plugin-marketn-refactored'

type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

export function getRegistryStatus(name: string) {
  return (store as MarketStore).registryStatus?.[name]
}

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

export function formatEndpoint(endpoint: string) {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}
