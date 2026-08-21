import { type Context, useI18n } from '@koishijs/client'
import zhCommon from './zh-CN/common.yml'
import enCommon from './en-US/common.yml'
import zhDependencies from './zh-CN/dependencies.yml'
import enDependencies from './en-US/dependencies.yml'
import zhMarketPage from './zh-CN/market-page.yml'
import enMarketPage from './en-US/market-page.yml'
import zhOperations from './zh-CN/operations.yml'
import enOperations from './en-US/operations.yml'
import zhDependencyCard from './zh-CN/dependency-card.yml'
import enDependencyCard from './en-US/dependency-card.yml'
import zhExtensions from './zh-CN/extensions.yml'
import enExtensions from './en-US/extensions.yml'
import zhBundle from './zh-CN/bundle.yml'
import enBundle from './en-US/bundle.yml'
import zhEnvironment from './zh-CN/environment.yml'
import enEnvironment from './en-US/environment.yml'
import zhMarket from './zh-CN/market.yml'
import enMarket from './en-US/market.yml'
import {
  ensureLocaleNamespace,
  installLocaleNamespaceGuard,
  type LocaleMessageComposer,
} from './runtime'

const namespace = 'marketNext'
const localeMessages = {
  'zh-CN': {
    common: zhCommon,
    dependencies: zhDependencies,
    marketPage: zhMarketPage,
    operations: zhOperations,
    dependencyCard: zhDependencyCard,
    extensions: zhExtensions,
    bundle: zhBundle,
    environment: zhEnvironment,
    market: zhMarket,
  },
  'en-US': {
    common: enCommon,
    dependencies: enDependencies,
    marketPage: enMarketPage,
    operations: enOperations,
    dependencyCard: enDependencyCard,
    extensions: enExtensions,
    bundle: enBundle,
    environment: enEnvironment,
    market: enMarket,
  },
}

type Composer = ReturnType<typeof useI18n>['t']

interface GlobalComposer {
  t: Composer
  getLocaleMessage: LocaleMessageComposer['getLocaleMessage']
  mergeLocaleMessage: LocaleMessageComposer['mergeLocaleMessage']
  setLocaleMessage: LocaleMessageComposer['setLocaleMessage']
}

let globalComposer: GlobalComposer | undefined

function ensureMarketNextI18n(composer: GlobalComposer) {
  return ensureLocaleNamespace(composer, namespace, localeMessages)
}

export function registerMarketNextI18n(ctx: Context) {
  const composer = ctx.$i18n.i18n.global as unknown as GlobalComposer
  globalComposer = composer
  installLocaleNamespaceGuard(composer, namespace, localeMessages)
}

export function useMarketNextI18n() {
  const composer = useI18n({ useScope: 'global' }) as unknown as GlobalComposer & ReturnType<typeof useI18n>
  globalComposer = composer
  installLocaleNamespaceGuard(composer, namespace, localeMessages)
  const { t: baseT, locale } = composer
  const t = (key: string, ...args: any[]) => (baseT as any)(`${namespace}.${key}`, ...args)
  return { t, locale }
}

export function translate(key: string, ...args: any[]) {
  if (!globalComposer) return key
  ensureMarketNextI18n(globalComposer)
  return (globalComposer.t as any)(`${namespace}.${key}`, ...args)
}
