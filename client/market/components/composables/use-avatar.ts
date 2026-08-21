import { computed, onUnmounted, ref, watch } from 'vue'
import type { SearchObject, User } from '@koishijs/registry'
import { cacheAvatarFailure, fetchAndCacheAvatar, fetchCachedAvatar, getCachedAvatarFromCandidates, getUserAvatarCandidates, getUserKey, getUsers, isAvatarFailureCached } from '../../utils'

export function useAvatar(props: { data: SearchObject, gravatar?: string }) {
  const avatars = ref<Record<string, string>>({})
  const avatarCursor = ref<Record<string, number>>({})
  const avatarTasks = new Map<string, Promise<unknown>>()
  let avatarHydrationTask = 0

  type MarketUser = User

  interface AvatarView {
    key: string
    user: MarketUser
    label: string
    initial: string
    src: string
    candidates: ReturnType<typeof getUserAvatarCandidates>
    signature: string
    candidate?: ReturnType<typeof getUserAvatarCandidates>[number]
    cached: boolean
  }

  const avatarViews = computed<AvatarView[]>(() => {
    return (getUsers(props.data) as User[]).map((user, index) => {
      const candidates = getUserAvatarCandidates(user, props.gravatar)
      const key = getAvatarIdentity(user, candidates, index)
      const cached = avatars.value[key] || getCachedAvatarFromCandidates(candidates)
      const candidate = cached ? undefined : getAvatarSource(key, candidates)
      return {
        key,
        user,
        label: user.name || user.username || user.email || key,
        initial: getAvatarInitial(user),
        src: cached || candidate?.url || '',
        candidates,
        signature: getAvatarSignature(candidates),
        candidate,
        cached: !!cached,
      }
    })
  })

  function getAvatarIdentity(user: MarketUser, candidates: ReturnType<typeof getUserAvatarCandidates>, index: number) {
    return getUserKey(user) || candidates[0]?.cacheKey || `${props.data.package.name}:${index}`
  }

  function getAvatarSignature(candidates: ReturnType<typeof getUserAvatarCandidates>) {
    return candidates.map(candidate => `${candidate.cacheKey}\n${candidate.source}\n${candidate.url}`).join('\n---\n')
  }

  function getAvatarInitial(user: MarketUser) {
    return (user.name || user.username || user.email || '?').trim().slice(0, 1).toUpperCase() || '?'
  }

  function getAvatarSource(key: string, candidates: ReturnType<typeof getUserAvatarCandidates>) {
    if (!candidates.length) return
    const start = Math.max(0, avatarCursor.value[key] || 0)
    for (let index = start; index < candidates.length; index++) {
      const candidate = candidates[index]!
      if (!isAvatarSourceFailed(candidate)) return candidate
    }
    return
  }

  function isAvatarSourceFailed(candidate: ReturnType<typeof getUserAvatarCandidates>[number]) {
    return isAvatarFailureCached(getAvatarSourceKey(candidate))
  }

  function getAvatarSourceKey(candidate: ReturnType<typeof getUserAvatarCandidates>[number]) {
    return `${candidate.cacheKey}:${candidate.url}`
  }

  function handleAvatarRenderError(view: AvatarView) {
    const candidate = view.candidate
    if (!candidate) return
    cacheAvatarFailure(getAvatarSourceKey(candidate))
    const currentIndex = Math.max(0, view.candidates.findIndex(item => item.url === candidate.url && item.cacheKey === candidate.cacheKey))
    avatarCursor.value = { ...avatarCursor.value, [view.key]: currentIndex + 1 }
    const cached = getCachedAvatarFromCandidates(view.candidates)
    if (cached) avatars.value = { ...avatars.value, [view.key]: cached }
  }

  function handleAvatarRenderLoad(view: AvatarView) {
    if (!view.candidate) return
    const taskKey = `${view.key}:${view.signature}:${view.candidate.url}`
    if (avatarTasks.has(taskKey)) return
    const task = fetchAndCacheAvatar(view.candidate.cacheKey, view.candidate.url, false)
      .finally(() => {
        avatarTasks.delete(taskKey)
      })
    avatarTasks.set(taskKey, task)
  }

  function hydrateCachedAvatars() {
    avatarHydrationTask = 0
    for (const view of avatarViews.value) {
      if (!view.candidates.length || view.cached) continue
      const first = view.candidates[0]!
      const taskKey = `${view.key}:${view.signature}:cache`
      if (avatarTasks.has(taskKey)) continue
      const task = fetchCachedAvatar(first.cacheKey)
        .then((src) => {
          const current = avatarViews.value.some(item => {
            return item.key === view.key && item.signature === view.signature && !item.src
          })
          if (!current) return
          if (src) avatars.value = { ...avatars.value, [view.key]: src }
        })
        .finally(() => {
          avatarTasks.delete(taskKey)
        })
      avatarTasks.set(taskKey, task)
    }
  }

  function scheduleAvatarHydration() {
    cancelAvatarHydration()
    const idle = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    }).requestIdleCallback
    if (idle) {
      avatarHydrationTask = idle(hydrateCachedAvatars, { timeout: 700 })
    } else {
      avatarHydrationTask = window.setTimeout(hydrateCachedAvatars, 120)
    }
  }

  function cancelAvatarHydration() {
    if (!avatarHydrationTask) return
    const idle = (window as typeof window & {
      cancelIdleCallback?: (handle: number) => void
    }).cancelIdleCallback
    if (idle) idle(avatarHydrationTask)
    else clearTimeout(avatarHydrationTask)
    avatarHydrationTask = 0
  }

  watch(() => [props.data.package.name, props.gravatar], () => {
    cancelAvatarHydration()
    avatarCursor.value = {}
    avatarTasks.clear()
    avatars.value = {}
  })

  watch(() => avatarViews.value.map(view => `${view.key}:${view.signature}:${view.src ? '1' : '0'}`), () => {
    scheduleAvatarHydration()
  }, { immediate: true })

  onUnmounted(() => {
    cancelAvatarHydration()
    avatarTasks.clear()
  })

  return { avatarViews, handleAvatarRenderError, handleAvatarRenderLoad }
}
