import { ref } from 'vue'
import type { SearchObject } from '@koishijs/registry'

export const active = ref('')

export const showManual = ref(false)
export const showConfirm = ref(false)
export const showInstallHistory = ref(false)
export const showEnvironmentVersions = ref(false)
export const expandedDependency = ref('')
export const activeBundle = ref<SearchObject>()

export type BundleMemberCleanupTarget = {
  package: string
  plugin: string
}

export const pendingBundleUninstalls = ref<Record<string, {
  members: string[]
  cleanup: boolean
  configs?: BundleMemberCleanupTarget[]
}>>({})
