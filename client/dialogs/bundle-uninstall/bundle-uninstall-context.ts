import type { InjectionKey } from 'vue'
import type { useBundleUninstall } from './use-uninstall'

export type BundleUninstallContext = ReturnType<typeof useBundleUninstall>

/** bundle-uninstall 对话框子组件共享的 useBundleUninstall 上下文。 */
export const bundleUninstallContextKey: InjectionKey<BundleUninstallContext> = Symbol('bundle-uninstall')
