<template>
  <k-layout main="darker" :class="['page-market', modeClass]" menu="market">
    <template #left>
      <el-scrollbar>
        <market-filter v-model="words" :data="visibleData"></market-filter>
      </el-scrollbar>
    </template>

    <market-loading
      v-if="marketLoading"
      :endpoint="loadingEndpoint"
      :slow="loadingSlow"
      :timeout="loadingTimeout"
      :auto-route="loadingAutoRoute">
    </market-loading>

    <market-result-list v-else-if="data.length"></market-result-list>

    <market-error
      v-else
       :registry="marketSnapshot?.registry || loadingEndpoint"
       :reason="marketSnapshot?.error">
    </market-error>
  </k-layout>
</template>

<script setup lang="ts">

import { computed, ref } from 'vue'
import { getMarketSnapshotData, marketSnapshot } from '../../market/state'
import { MarketFilter } from '../../market'
import { useMarketPage } from './composables/use-market-page'
import MarketError from './components/market-error.vue'
import MarketLoading from './components/market-loading.vue'
import MarketResultList from './components/market-result-list.vue'

const page = useMarketPage()

const { words, visibleData, modeClass, marketLoading, loadingEndpoint, loadingSlow, loadingTimeout, loadingAutoRoute } = page
const data = computed(() => Object.values(getMarketSnapshotData()))

</script>

<style scoped src="./index.scss" lang="scss"></style>
