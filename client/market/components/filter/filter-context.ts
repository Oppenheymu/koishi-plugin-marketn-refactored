import type { InjectionKey } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import type { useFilter } from './use-filter'

export interface FilterContext {
  filter: ReturnType<typeof useFilter>
  props: { modelValue: string[]; data?: SearchObject[] }
}

/** filter 面板子组件共享的上下文（useFilter 结果 + props），经 provide/inject 下发。 */
export const filterContextKey: InjectionKey<FilterContext> = Symbol('filter')
