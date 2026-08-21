import { router } from '@koishijs/client'
import { computed, onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'

export function useRouteSync(words: Ref<string[]>) {
  const prompt = computed(() => words.value.filter(w => w).join(' '))

  watch(router.currentRoute, (value) => {
    if (value.path !== '/market') return
    const { keyword } = value.query
    if (keyword === prompt.value) return
    words.value = Array.isArray(keyword) ? keyword as string[] : (keyword || '').split(' ')
    words.value = words.value.map(w => w.toLowerCase())
    if (words.value[words.value.length - 1]) words.value.push('')
  }, { immediate: true, deep: true })

  let routeSyncTimer: ReturnType<typeof setTimeout>

  watch(prompt, (value) => {
    clearTimeout(routeSyncTimer)
    routeSyncTimer = setTimeout(() => {
      const { keyword: _, ...rest } = router.currentRoute.value.query
      if (value === (router.currentRoute.value.query.keyword || '')) return
      if (value) {
        router.replace({ query: { keyword: value, ...rest } })
      } else {
        router.replace({ query: rest })
      }
    }, 180)
  }, { deep: true })

  onUnmounted(() => {
    clearTimeout(routeSyncTimer)
  })
}
