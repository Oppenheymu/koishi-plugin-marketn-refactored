/**
 * @file 前端偏好(渲染模式/依赖页布局)读取器(shared/plugin-config 域)。
 */

import { getMarketNextConfig } from './config'
import type { FrontendMode, LayoutMode } from './config'

/** 校验前端模式取值,非法输入返回 undefined(由调用方回退默认值)。 */
function normalizeFrontendMode(value: unknown): FrontendMode | undefined {
  return value === 'polished' || value === 'performance' ? value : undefined
}

/**
 * 当前前端渲染模式。数据源是 store 里的插件配置(参数 config 仅为兼容
 * 既有调用签名,不参与判定),未配置或插件未安装时默认 performance。
 */
export function getFrontendMode(config?: { market?: { frontendMode?: FrontendMode } }): FrontendMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return normalizeFrontendMode(pluginConfig.frontendMode) ?? 'performance'
  return 'performance'
}

/** 依赖页布局:读取插件配置,默认 grid。 */
export function getDepsLayout(config?: { market?: { depsLayout?: LayoutMode } }): LayoutMode {
  const pluginConfig = getMarketNextConfig()
  if (pluginConfig) return pluginConfig.depsLayout === 'list' ? 'list' : 'grid'
  return 'grid'
}
