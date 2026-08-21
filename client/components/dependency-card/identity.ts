import { isBundlePackageName } from '../../../src/shared/bundle'
import { resolveCategory } from '../../market/utils/categories'
import { getMarketObject } from '../../market/state/lookup'

export interface DependencyIdentity {
  label: string
  icon: string
  color: string
}

export function isPluginPackage(name: string) {
  return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name) || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name)
}

export function formatPackageDisplayName(name: string) {
  const shortname = getMarketObject(name)?.shortname
  if (shortname && shortname !== name) return shortname
  if (name.startsWith('@koishijs/plugin-')) return name.slice('@koishijs/plugin-'.length)
  if (name.startsWith('koishi-plugin-')) return name.slice('koishi-plugin-'.length)
  const scoped = name.match(/^@([^/]+)\/koishi-plugin-(.+)$/)
  if (scoped) return `@${scoped[1]}/${scoped[2]}`
  return name
}

export function pickDescription(value: unknown, locale: string) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const object = value as Record<string, unknown>
  const preferred = locale.toLowerCase().startsWith('zh')
    ? ['zh-CN', 'zh', 'en-US', 'en']
    : ['en-US', 'en', 'zh-CN', 'zh']
  for (const key of preferred) {
    const text = object[key]
    if (typeof text === 'string' && text.trim()) return text.trim()
  }
  const fallback = Object.values(object).find(item => typeof item === 'string' && item.trim())
  return typeof fallback === 'string' ? fallback.trim() : ''
}

export const identityMap = {
  adapter: { label: 'dependencyCard.identity.adapter', icon: 'solid:adapter', color: '#4d8df7' },
  database: { label: 'dependencyCard.identity.database', icon: 'solid:tool', color: '#21a67a' },
  webui: { label: 'dependencyCard.identity.webui', icon: 'solid:webui', color: '#8b6cf6' },
  core: { label: 'dependencyCard.identity.core', icon: 'solid:core', color: '#d89b32' },
  general: { label: 'dependencyCard.identity.general', icon: 'solid:general', color: '#6b8cff' },
  extension: { label: 'dependencyCard.identity.extension', icon: 'solid:extension', color: '#5c9ded' },
  manage: { label: 'dependencyCard.identity.manage', icon: 'solid:manage', color: '#26a0a7' },
  preset: { label: 'dependencyCard.identity.preset', icon: 'solid:preset', color: '#9b74df' },
  image: { label: 'dependencyCard.identity.image', icon: 'solid:image', color: '#d66aa8' },
  media: { label: 'dependencyCard.identity.media', icon: 'solid:media', color: '#3e9fbb' },
  tool: { label: 'dependencyCard.identity.tool', icon: 'solid:tool', color: '#54966f' },
  life: { label: 'dependencyCard.identity.life', icon: 'solid:life', color: '#8da44b' },
  ai: { label: 'dependencyCard.identity.ai', icon: 'solid:ai', color: '#b66be8' },
  meme: { label: 'dependencyCard.identity.meme', icon: 'solid:meme', color: '#d98445' },
  game: { label: 'dependencyCard.identity.game', icon: 'solid:game', color: '#df6b5f' },
  gametool: { label: 'dependencyCard.identity.gametool', icon: 'solid:gametool', color: '#c77745' },
  bundle: { label: 'dependencyCard.identity.bundle', icon: 'file-archive', color: '#9b74df' },
  other: { label: 'dependencyCard.identity.other', icon: 'solid:other', color: '#778294' },
} satisfies Record<string, DependencyIdentity>

export function resolveIdentity(name: string): DependencyIdentity {
  if (isBundlePackageName(name)) return identityMap.bundle
  const data = getMarketObject(name)
  const category = resolveCategory(data?.category)
  const normalized = name.toLowerCase()
  if (/adapter[-/]/.test(normalized) || normalized.includes('adapter-')) return identityMap.adapter
  if (/database|sqlite|mysql|mongo|postgres|redis/.test(normalized)) return identityMap.database
  if (/console|config|insight|market|status|telemetry/.test(normalized)) return identityMap.webui
  if (/loader|server|koishi$|core|sandbox/.test(normalized)) return identityMap.core
  if (/command|schedule|cron|help|echo|logger|locales/.test(normalized)) return identityMap.general
  if (/chatluna|openai|ai|llm|gpt|claude|gemini/.test(normalized)) return identityMap.ai
  if (/image|canvas|puppeteer|screenshot/.test(normalized)) return identityMap.image
  if (/rss|media|music|video|bilibili|news/.test(normalized)) return identityMap.media
  if (/game|chess|mahjong/.test(normalized)) return identityMap.game
  return identityMap[(category ?? 'other') as keyof typeof identityMap] ?? identityMap.other
}
