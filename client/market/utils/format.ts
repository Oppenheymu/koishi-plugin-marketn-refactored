import { getMarketObject } from '../state/lookup'

/** 包名的展示名：优先 shortname，其次去掉 koishi 插件前缀（依赖卡片与 bundle 安装成员共用）。 */
export function formatPackageDisplayName(name: string) {
  const shortname = getMarketObject(name)?.shortname
  if (shortname && shortname !== name) return shortname
  if (name.startsWith('@koishijs/plugin-')) return name.slice('@koishijs/plugin-'.length)
  if (name.startsWith('koishi-plugin-')) return name.slice('koishi-plugin-'.length)
  const scoped = name.match(/^@([^/]+)\/koishi-plugin-(.+)$/)
  if (scoped) return `@${scoped[1]}/${scoped[2]}`
  return name
}
