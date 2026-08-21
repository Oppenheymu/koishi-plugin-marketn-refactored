import type { InjectionKey } from 'vue'
import type { useEnvironment } from './use-environment'

export type EnvironmentContext = ReturnType<typeof useEnvironment>

/** environment-versions 对话框子组件共享的 useEnvironment 上下文。 */
export const environmentContextKey: InjectionKey<EnvironmentContext> = Symbol('environment-versions')
