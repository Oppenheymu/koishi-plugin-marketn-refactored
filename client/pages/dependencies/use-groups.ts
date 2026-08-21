import { computed } from 'vue'
import type { Ref } from 'vue'
import { getCollapsedGroups, patchMarketNextData } from '../../lib/data-store'
import { useMarketNextI18n } from '../../i18n'
import type { DependencyItem, FilterKey, ItemKind } from './useClassify'

export interface DependencyGroup {
  key: ItemKind
  label: string
  description: string
  icon: string
  items: DependencyItem[]
  collapsed: boolean
  collapsible: boolean
}

export function useGroups(items: Ref<DependencyItem[]>, keyword: Ref<string>, filter: Ref<FilterKey>) {
  const { t } = useMarketNextI18n()

  const groupMeta = computed<Record<ItemKind, Omit<DependencyGroup, 'items' | 'collapsed' | 'collapsible'>>>(() => ({
    pending: { key: 'pending', label: t('dependencies.groups.pending.label'), icon: 'tag', description: t('dependencies.groups.pending.description') },
    bundle: { key: 'bundle', label: t('dependencies.groups.bundle.label'), icon: 'file-archive', description: t('dependencies.groups.bundle.description') },
    updatable: { key: 'updatable', label: t('dependencies.groups.updatable.label'), icon: 'asc', description: t('dependencies.groups.updatable.description') },
    ignored: { key: 'ignored', label: t('dependencies.groups.ignored.label'), icon: 'installed', description: t('dependencies.groups.ignored.description') },
    'check-disabled': { key: 'check-disabled', label: t('dependencies.groups.checkDisabled.label'), icon: 'installed', description: t('dependencies.groups.checkDisabled.description') },
    unconfigured: { key: 'unconfigured', label: t('dependencies.groups.unconfigured.label'), icon: 'preview', description: t('dependencies.groups.unconfigured.description') },
    invalid: { key: 'invalid', label: t('dependencies.groups.invalid.label'), icon: 'insecure', description: t('dependencies.groups.invalid.description') },
    error: { key: 'error', label: t('dependencies.groups.error.label'), icon: 'insecure', description: t('dependencies.groups.error.description') },
    local: { key: 'local', label: t('dependencies.groups.local.label'), icon: 'file-archive', description: t('dependencies.groups.local.description') },
    manual: { key: 'manual', label: t('dependencies.groups.manual.label'), icon: 'search', description: t('dependencies.groups.manual.description') },
    installed: { key: 'installed', label: t('dependencies.groups.installed.label'), icon: 'installed', description: t('dependencies.groups.installed.description') },
  }))

  const groupOrder: ItemKind[] = ['pending', 'bundle', 'unconfigured', 'updatable', 'ignored', 'check-disabled', 'invalid', 'error', 'local', 'manual', 'installed']

  const collapseEnabled = computed(() => filter.value === 'all' && !keyword.value.trim())

  function getDefaultCollapsed(key: ItemKind) {
    return key === 'unconfigured' || key === 'ignored'
  }

  function isGroupCollapsed(key: ItemKind) {
    if (!collapseEnabled.value) return false
    return getCollapsedGroups()[key] ?? getDefaultCollapsed(key)
  }

  function toggleGroup(key: ItemKind) {
    const groups = {
      ...getCollapsedGroups(),
      [key]: !isGroupCollapsed(key),
    }
    void patchMarketNextData({ collapsedGroups: groups })
  }

  const visibleGroups = computed<DependencyGroup[]>(() => {
    const word = keyword.value.trim().toLowerCase()
    const buckets = Object.fromEntries(groupOrder.map(key => [key, [] as DependencyItem[]])) as Record<ItemKind, DependencyItem[]>
    for (const item of items.value) {
      if (filter.value === 'pending' && !item.pending) continue
      if (!item.pending) {
        if (filter.value === 'manual' && !item.manual) continue
        if (!['all', 'pending', 'manual'].includes(filter.value) && item.kind !== filter.value) continue
      }
      if (word && !item.name.toLowerCase().includes(word)) continue
      buckets[item.kind].push(item)
    }
    return groupOrder
      .map(key => ({
        ...groupMeta.value[key]!,
        items: buckets[key]!,
        collapsed: isGroupCollapsed(key),
        collapsible: collapseEnabled.value,
      }))
      .filter(group => group.items.length)
  })

  return {
    groupMeta,
    groupOrder,
    visibleGroups,
    toggleGroup,
  }
}
