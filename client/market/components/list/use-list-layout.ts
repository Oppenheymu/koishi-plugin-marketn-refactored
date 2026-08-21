import { onMounted, onUnmounted, ref } from 'vue'

/** 列表布局测量与滚动监听绑定（自 useVirtualScroll 拆出）：列数/行高/滚动宿主探测。 */
export function useListLayout(onScroll: () => void) {
  const header = ref<HTMLElement>()
  const list = ref<HTMLElement>()
  const columns = ref(1)
  const rowHeight = ref(224)
  let scrollParent: HTMLElement | Window = window
  let resizeObserver: ResizeObserver | undefined = undefined
  let observedList: HTMLElement | undefined = undefined
  let observedHeader: HTMLElement | undefined = undefined
  let listTop = 0

  function getScrollParent() {
    return list.value?.closest('.el-scrollbar')?.querySelector('.el-scrollbar__wrap') as HTMLElement || window
  }

  function bindList() {
    if (!list.value) return
    if (observedList === list.value && scrollParent) return
    removeScrollListener()
    if (observedList) resizeObserver?.unobserve(observedList)
    if (observedHeader) resizeObserver?.unobserve(observedHeader)
    observedList = list.value
    observedHeader = header.value
    scrollParent = getScrollParent()
    resizeObserver?.observe(observedList)
    if (observedHeader) resizeObserver?.observe(observedHeader)
    addScrollListener()
  }

  function addScrollListener() {
    scrollParent?.addEventListener('scroll', onScroll, { passive: true })
  }

  function removeScrollListener() {
    scrollParent?.removeEventListener('scroll', onScroll)
  }

  function getListTop() {
    if (!list.value || !scrollParent) return 0
    const listRect = list.value.getBoundingClientRect()
    if (scrollParent instanceof Window) return listRect.top + window.scrollY
    const scrollRect = scrollParent.getBoundingClientRect()
    return listRect.top - scrollRect.top + scrollParent.scrollTop
  }

  function measureLayout() {
    if (!list.value) return
    const style = getComputedStyle(list.value)
    const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 16
    const width = list.value.clientWidth
    const nextColumns = Math.max(1, Math.floor((width + gap) / (336 + gap)))
    const card = list.value.querySelector<HTMLElement>('.market-package')
    const nextRowHeight = (card?.offsetHeight || 202) + gap
    const nextListTop = getListTop()
    if (columns.value !== nextColumns) columns.value = nextColumns
    if (rowHeight.value !== nextRowHeight) rowHeight.value = nextRowHeight
    if (listTop !== nextListTop) listTop = nextListTop
  }

  onMounted(() => {
    resizeObserver = new ResizeObserver(() => {
      measureLayout()
      onScroll()
    })
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    removeScrollListener()
  })

  return {
    header,
    list,
    columns,
    rowHeight,
    bindList,
    measureLayout,
    getScrollParent: () => scrollParent,
    getListTop: () => listTop,
  }
}
