import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import type { MarketConfig } from '../../utils'
import { getFiltered, getSortedPrepared, getVisible } from '../../utils'
import { useListLayout } from './use-list-layout'

export function useVirtualScroll(
  props: { modelValue: string[], data: SearchObject[], debug?: boolean, visibilityPrepared?: boolean },
  emit: (event: 'update:page' | 'debug', ...args: any[]) => void,
  config: MarketConfig,
) {
  const all = shallowRef<SearchObject[]>([])

  const packages = shallowRef<SearchObject[]>([])

  const batchSize = computed(() => {
    for (const word of props.modelValue) {
      if (word.startsWith('limit:')) {
        const size = parseInt(word.slice(6))
        if (size) return size
      }
    }
    return 24
  })

  const sentinel = ref<HTMLElement>()
  const visible = ref(batchSize.value)
  const startIndex = ref(0)
  const endIndex = ref(batchSize.value)
  const topSpacer = ref(0)
  const bottomSpacer = ref(0)
  let observer: IntersectionObserver | undefined = undefined
  let frame = 0
  let filterFrame = 0
  let settledTimer = 0
  let lastVirtualDebugAt = 0
  let debugState = {
    timings: {} as Record<string, number>,
    total: 0,
    matched: 0,
    visible: 0,
    rendered: 0,
  }

  const layout = useListLayout(scheduleVirtual)
  const { header, list, columns, rowHeight, bindList, measureLayout } = layout

  const loadedPackages = computed(() => packages.value.slice(0, visible.value))

  const renderedPackages = computed(() => loadedPackages.value.slice(startIndex.value, endIndex.value))

  const hasMore = computed(() => visible.value < packages.value.length)

  const settled = ref(false)

  function markSettled() {
    clearTimeout(settledTimer)
    settledTimer = window.setTimeout(() => { settled.value = true }, 700)
  }

  watch(() => packages.value, () => { settled.value = false; markSettled() })

  function updateObserver() {
    if (!observer || !sentinel.value) return
    observer.disconnect()
    if (hasMore.value) observer.observe(sentinel.value)
  }

  function loadMore() {
    if (!hasMore.value) return
    visible.value = Math.min(visible.value + batchSize.value, packages.value.length)
    nextTick(() => {
      updateObserver()
      updateVirtual()
    })
  }

  function resetVisible(scroll = true) {
    visible.value = batchSize.value
    if (scroll) emit('update:page', 1)
    startIndex.value = 0
    endIndex.value = batchSize.value
    topSpacer.value = 0
    bottomSpacer.value = 0
    nextTick(() => {
      bindList()
      measureLayout()
      updateObserver()
      updateVirtual()
    })
  }

  watch(() => props.modelValue.join('\n'), () => resetVisible(), { deep: true })

  watch(() => [props.data, props.modelValue.join('\n')] as const, () => {
    schedulePackageUpdate()
  }, { immediate: true })

  watch(() => packages.value.length, () => {
    visible.value = Math.min(Math.max(visible.value, batchSize.value), packages.value.length || batchSize.value)
    nextTick(() => {
      bindList()
      measureLayout()
      updateObserver()
      updateVirtual()
    })
  })

  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { rootMargin: '240px 0px' })
    resetVisible(false)
  })

  onUnmounted(() => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
    cancelAnimationFrame(filterFrame)
    clearTimeout(settledTimer)
  })

  function schedulePackageUpdate() {
    cancelAnimationFrame(filterFrame)
    filterFrame = requestAnimationFrame(() => {
      const start = props.debug ? performance.now() : 0
      const visible = props.visibilityPrepared ? props.data : getVisible(props.data, props.modelValue)
      const filtered = getFiltered(visible, props.modelValue, config)
      const sortedAt = props.debug ? performance.now() : 0
      all.value = visible
      packages.value = getSortedPrepared(filtered, props.modelValue, config)
      if (props.debug) {
        emitDebug({
          timings: {
            frontendFilter: sortedAt - start,
            frontendSort: performance.now() - sortedAt,
          },
          total: visible.length,
          matched: packages.value.length,
        })
      }
    })
  }

  function scheduleVirtual() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(updateVirtual)
  }

  function updateVirtual() {
    if (!list.value) return
    const start = props.debug ? performance.now() : 0

    const scrollParent = layout.getScrollParent()
    const scrollTop = scrollParent instanceof Window ? window.scrollY : scrollParent.scrollTop
    const viewportHeight = scrollParent instanceof Window ? window.innerHeight : scrollParent.clientHeight
    const offset = Math.max(0, scrollTop - layout.getListTop())
    const totalRows = Math.ceil(loadedPackages.value.length / columns.value)
    const overscan = 3
    const startRow = Math.max(0, Math.floor(offset / rowHeight.value) - overscan)
    const visibleRows = Math.ceil(viewportHeight / rowHeight.value) + overscan * 2
    const endRow = Math.min(totalRows, startRow + visibleRows)

    const nextStartIndex = startRow * columns.value
    const nextEndIndex = Math.min(loadedPackages.value.length, endRow * columns.value)
    const nextTopSpacer = startRow * rowHeight.value
    const nextBottomSpacer = Math.max(0, (totalRows - endRow) * rowHeight.value)
    if (startIndex.value !== nextStartIndex) startIndex.value = nextStartIndex
    if (endIndex.value !== nextEndIndex) endIndex.value = nextEndIndex
    if (topSpacer.value !== nextTopSpacer) topSpacer.value = nextTopSpacer
    if (bottomSpacer.value !== nextBottomSpacer) bottomSpacer.value = nextBottomSpacer

    const loadedHeight = layout.getListTop() + totalRows * rowHeight.value
    if (hasMore.value && scrollTop + viewportHeight > loadedHeight - rowHeight.value * 4) {
      loadMore()
    }
    if (props.debug) {
      const now = performance.now()
      if (now - lastVirtualDebugAt < 250) return
      lastVirtualDebugAt = now
      emitDebug({
        timings: {
          frontendVirtual: now - start,
        },
        visible: loadedPackages.value.length,
        rendered: renderedPackages.value.length,
      })
    }
  }

  function emitDebug(value: Partial<typeof debugState>) {
    debugState = {
      ...debugState,
      ...value,
      timings: {
        ...debugState.timings,
        ...value.timings,
      },
    }
    emit('debug', debugState)
  }

  return {
    all,
    packages,
    header,
    sentinel,
    list,
    renderedPackages,
    hasMore,
    settled,
    topSpacer,
    bottomSpacer,
    loadMore,
  }
}
