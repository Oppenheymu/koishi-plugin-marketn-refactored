import type { InjectionKey } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { useMarketNextI18n } from '../../i18n'

export const categories = [
  'adapter',
  'general',
  'extension',
  'webui',
  'manage',
  'preset',
  'image',
  'media',
  'tool',
  'life',
  'ai',
  'meme',
  'game',
  'gametool',
]

export function resolveCategory(name?: string) {
  if (categories.includes(name!)) return name
  return 'other'
}

export interface MarketConfig {
  installed?(data: SearchObject): boolean
  portable?: boolean
}

export const kConfig = Symbol('market.config') as InjectionKey<MarketConfig>

export function useMarketI18n() {
  const { t: baseT, locale } = useMarketNextI18n()
  const t = (key: string, ...args: any[]) => baseT(`market.${key}`, ...args)
  return { t, locale }
}
