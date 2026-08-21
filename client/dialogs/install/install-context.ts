import type { InjectionKey } from 'vue'
import type { useInstall } from './use-install'

export type InstallContext = ReturnType<typeof useInstall>

/** install 对话框子组件共享的 useInstall 上下文。 */
export const installContextKey: InjectionKey<InstallContext> = Symbol('install')
