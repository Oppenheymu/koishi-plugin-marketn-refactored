<template>
  <el-scrollbar ref="root">
    <div class="market-search-row">
      <market-search ref="searchBox" v-model="words"></market-search>
    </div>
    <market-list
      v-model="words"
      :data="visibleData"
      visibility-prepared
      :gravatar="marketGravatar"
      :debug="!!store.market.debug"
      @debug="updateClientDebug"
      @update:page="scrollToTop">
      <template #header="{ hasFilter, all, packages }">
        <market-list-header :has-filter="hasFilter" :all="all" :packages="packages"></market-list-header>
      </template>
      <template #action="data">
        <market-action-button :data="data"></market-action-button>
      </template>
    </market-list>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { router, store } from '@koishijs/client'
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { MarketList, MarketSearch } from '../../../market'
import { marketPageContextKey } from '../composables/use-market-page'
import MarketActionButton from './market-action-button.vue'
import MarketListHeader from './market-list-header.vue'

const page = inject(marketPageContextKey)!
const { words, visibleData, marketGravatar, clientDebug, updateClientDebug } = page
const root = ref()
const searchBox = ref<{ focus?: () => void }>()

function scrollToTop() {
  root.value?.scrollTo(0, 0)
}

function onSearchShortcut(event: KeyboardEvent) {
  if (router.currentRoute.value?.path !== '/market') return
  if (event.key.toLowerCase() !== 'k') return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  searchBox.value?.focus?.()
}

onMounted(() => window.addEventListener('keydown', onSearchShortcut))
onUnmounted(() => window.removeEventListener('keydown', onSearchShortcut))
</script>
