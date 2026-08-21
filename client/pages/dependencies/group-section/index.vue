<template>
  <section :class="['deps-group', group.key, { collapsed: group.collapsed }]">
    <header
      :class="['deps-group-header', { collapsible: group.collapsible }]"
      :role="group.collapsible ? 'button' : undefined"
      :tabindex="group.collapsible ? 0 : undefined"
      :aria-expanded="group.collapsible ? String(!group.collapsed) : undefined"
      @click="group.collapsible && toggleGroup(group.key)"
      @keydown.enter.prevent="group.collapsible && toggleGroup(group.key)"
      @keydown.space.prevent="group.collapsible && toggleGroup(group.key)"
    >
      <div>
        <h2>
          <market-icon :name="group.icon"></market-icon>
          <span>{{ group.label }}</span>
        </h2>
        <p>{{ group.description }}</p>
      </div>
      <div class="deps-group-side">
        <span class="deps-group-count">{{ group.items.length }}</span>
        <market-icon
          v-if="group.collapsible"
          :class="['deps-group-chevron', { collapsed: group.collapsed }]"
          name="asc"
        ></market-icon>
      </div>
    </header>
    <div v-if="!group.collapsed" class="deps-grid">
      <template v-if="depsLayout === 'list'">
        <div class="deps-list-header">
          <span class="col-icon"></span>
          <span class="col-name">{{ t('common.labels.name') }}</span>
          <span class="col-version">{{ t('common.labels.installed') }}</span>
          <span class="col-latest">{{ t('common.labels.latest') }}</span>
          <span class="col-actions">{{ t('common.labels.operation') }}</span>
        </div>
      </template>
      <dependency-card
        v-for="item in group.items"
        :key="item.name"
        :name="item.name"
        :kind="item.kind"
        :list-mode="depsLayout === 'list'"
      ></dependency-card>
    </div>
  </section>
</template>

<script setup lang="ts">

import { useMarketNextI18n } from '../../../i18n'
import { MarketIcon } from '../../../market'
// DependencyCard is built by a separate task (components/dependency-card/card.vue).
// It replaces the old package.vue component; contract: props { name, kind, listMode }.
import DependencyCard from '../dependency-card/card/index.vue'
import type { DependencyGroup } from '../composables/use-groups'
import type { ItemKind } from '../composables/use-classify'

defineProps<{
  group: DependencyGroup
  depsLayout: 'grid' | 'list'
  toggleGroup: (key: ItemKind) => void
}>()

const { t } = useMarketNextI18n()

</script>

<style scoped src="./index.scss" lang="scss"></style>
