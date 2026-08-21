import {
  getMarketNextConfig,
  hasOwn,
  type MarketSilentCustomRule,
  type MarketSilentDateRule,
  type MarketSilentRecentRule,
  type MarketSilentRule,
  type MarketSilentStatusRule,
} from './market-config'

interface SilentConfig {
  market?: {
    marketSilentStatusRules?: MarketSilentStatusRule[]
    marketSilentDateRules?: MarketSilentDateRule[]
    marketSilentRecentRules?: MarketSilentRecentRule[]
    marketSilentCustomRules?: MarketSilentCustomRule[]
    marketSilentRules?: MarketSilentRule[]
    marketSilentFilters?: string
  }
}

export function getMarketSilentFilters(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) {
    return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : []).join('\n')
  }
  if (hasNewSilentRuleConfig(pluginConfig)) {
    return structuredSilentRulesToFilters(pluginConfig).join('\n')
  }
  if (hasOwn(pluginConfig, 'marketSilentFilters')) {
    return String(pluginConfig.marketSilentFilters ?? '')
  }
  return ''
}

export function getMarketSilentRules(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : [])
  if (hasNewSilentRuleConfig(pluginConfig)) return structuredSilentRulesToFilters(pluginConfig)
  return []
}

function hasNewSilentRuleConfig(config?: Record<string, any>) {
  return hasConfiguredSilentRules(config?.marketSilentStatusRules)
    || hasConfiguredSilentRules(config?.marketSilentDateRules)
    || hasConfiguredSilentRules(config?.marketSilentRecentRules)
    || hasConfiguredSilentRules(config?.marketSilentCustomRules)
}

function hasConfiguredSilentRules(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function structuredSilentRulesToFilters(config?: SilentConfig['market']) {
  return [
    ...statusRulesToFilters(config?.marketSilentStatusRules ?? []),
    ...dateRulesToFilters(config?.marketSilentDateRules ?? []),
    ...recentRulesToFilters(config?.marketSilentRecentRules ?? []),
    ...customRulesToFilters(config?.marketSilentCustomRules ?? []),
  ]
}

function statusRulesToFilters(rules: MarketSilentStatusRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.target)
    .map(rule => `is:${rule.target}`)
}

function dateRulesToFilters(rules: MarketSilentDateRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && rule.relation && isDateString(rule.date))
    .map((rule) => `${rule.field}:${rule.relation === 'before' ? '<' : '>'}${rule.date}`)
}

function recentRulesToFilters(rules: MarketSilentRecentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && Number.isFinite(rule.days) && rule.days! > 0)
    .map(rule => `${rule.field}:within:${Math.floor(rule.days!)}`)
}

function customRulesToFilters(rules: MarketSilentCustomRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => String(rule.query ?? '').trim())
    .filter(Boolean)
}

function isDateString(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

function rulesToSilentFilters(rules: MarketSilentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => ruleToSilentFilter(rule))
    .filter(Boolean)
}

function ruleToSilentFilter(rule: MarketSilentRule) {
  const value = String(rule.value ?? '').trim()
  const date = String(rule.date ?? value).trim()
  const days = rule.days == null ? value : String(rule.days)
  const query = String(rule.query ?? value).trim()
  switch (rule.type) {
    case 'preview': return 'is:preview'
    case 'insecure': return 'is:insecure'
    case 'bundle': return 'is:bundle'
    case 'created-before': return isDateString(date) ? `created:<${date}` : ''
    case 'created-after': return isDateString(date) ? `created:>${date}` : ''
    case 'updated-before': return isDateString(date) ? `updated:<${date}` : ''
    case 'updated-after': return isDateString(date) ? `updated:>${date}` : ''
    case 'created-within': return isPositiveInteger(days) ? `created:within:${Math.floor(Number(days))}` : ''
    case 'updated-within': return isPositiveInteger(days) ? `updated:within:${Math.floor(Number(days))}` : ''
    case 'custom':
    default:
      return query
  }
}

function isPositiveInteger(value?: string) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && Math.floor(number) === number
}
