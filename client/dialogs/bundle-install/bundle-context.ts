import type { InjectionKey } from 'vue'
import type { useBundleInstall } from './use-bundle-install'

export type BundleInstallContext = ReturnType<typeof useBundleInstall>

/** bundle-install 对话框子组件共享的 useBundleInstall 上下文。 */
export const bundleContextKey: InjectionKey<BundleInstallContext> = Symbol('bundle-install')
