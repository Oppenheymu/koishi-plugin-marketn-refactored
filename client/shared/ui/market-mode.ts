import { computed } from 'vue'
import { getFrontendMode } from '../config/market-config'

/** 市场前端模式（performance/polished）的展示派生：多个弹窗与页面共用。 */
export function useMarketModeClass() {
  const frontendMode = computed(() => getFrontendMode())
  const modeClass = computed(() => `market-mode-${frontendMode.value}`)
  const versionPopperClass = computed(() => `market-version-popper ${modeClass.value}`)
  return { frontendMode, modeClass, versionPopperClass }
}
