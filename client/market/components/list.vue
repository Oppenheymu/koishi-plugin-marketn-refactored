<template>
  <div v-if="$slots.header" ref="header" class="market-list-header">
    <slot name="header" v-bind="{ all, packages, hasFilter: hasFilter(modelValue) }"></slot>
  </div>
  <template v-if="packages.length">
    <div ref="list" :class="['package-list', { settled }]">
      <div v-if="topSpacer" class="virtual-spacer" :style="{ height: topSpacer + 'px' }"></div>
      <market-package
        v-for="data in renderedPackages"
        :key="data.package.name"
        class="k-card"
        :data="data"
        :gravatar="gravatar"
        @query="onQuery"
      >
        <template #action>
          <slot name="action" v-bind="data"></slot>
        </template>
      </market-package>
      <div v-if="bottomSpacer" class="virtual-spacer" :style="{ height: bottomSpacer + 'px' }"></div>
    </div>
    <div v-if="hasMore" ref="sentinel" class="load-more">
      <el-button text @click="loadMore">{{ t('marketPage.list.loadMore') }}</el-button>
    </div>
    <div v-else class="load-complete">
      {{ t('marketPage.list.complete', { count: packages.length }) }}
    </div>
  </template>
  <k-empty v-else>
    {{ t('marketPage.list.empty') }}
  </k-empty>
</template>

<script lang="ts" setup>

import { inject } from 'vue'
import type { SearchObject } from '@koishijs/registry'
import { hasFilter, kConfig } from '../utils'
import MarketPackage from './package.vue'
import { useMarketNextI18n } from '../../i18n'
import { useVirtualScroll } from './use-virtual-scroll'

const props = defineProps<{
  modelValue: string[],
  data: SearchObject[],
  installed?: (data: SearchObject) => boolean,
  gravatar?: string,
  debug?: boolean,
  visibilityPrepared?: boolean,
}>()

const { t } = useMarketNextI18n()

const emit = defineEmits(['update:modelValue', 'update:page', 'debug'])

const config = inject(kConfig, {})

const {
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
} = useVirtualScroll(props, emit, config)

function onQuery(word: string) {
  const words = props.modelValue.slice()
  if (!words[words.length - 1]) words.pop()
  if (!words.includes(word)) words.push(word)
  words.push('')
  emit('update:modelValue', words)
}

</script>

<style scoped src="./list.scss" lang="scss"></style>
