import type { InjectionKey } from 'vue'
import type { useVersion } from './use-version'

export type VersionContext = ReturnType<typeof useVersion>

/** version 区块子组件共享的 useVersion 上下文。 */
export const versionContextKey: InjectionKey<VersionContext> = Symbol('version')
