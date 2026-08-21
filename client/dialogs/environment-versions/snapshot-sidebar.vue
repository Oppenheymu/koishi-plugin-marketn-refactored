<template>
  <aside class="snapshot-sidebar">
    <div class="snapshot-heading">
      <span>{{ t('environment.snapshots') }}</span>
      <span>{{ snapshots.length }}</span>
    </div>
    <div class="snapshot-list">
      <button
        v-for="snapshot in snapshots"
        :key="snapshot.id"
        type="button"
        :class="['snapshot-row', { active: snapshot.id === selectedId, current: snapshot.current }]"
        @click="selectSnapshot(snapshot.id)"
      >
        <span class="snapshot-icon">
          <market-icon :name="snapshot.current ? 'verified' : 'file-archive'"></market-icon>
        </span>
        <span class="snapshot-main">
          <strong>{{ snapshot.current ? t('environment.currentEnvironment') : t('environment.savedEnvironment') }}</strong>
          <span>{{ formatDate(snapshot.createdAt) }}</span>
          <small>{{ sourceText(snapshot.source) }} · {{ t('environment.dependencies', { count: snapshot.dependencyCount }) }}</small>
        </span>
        <span v-if="snapshot.current" class="current-pill">{{ t('environment.current') }}</span>
      </button>

      <div v-if="loading && !snapshots.length" class="environment-state">{{ t('environment.reading') }}</div>
      <div v-else-if="loadError && !snapshots.length" class="environment-state error">{{ loadError }}</div>
      <div v-else-if="!snapshots.length" class="environment-state">{{ t('environment.empty') }}</div>
    </div>
  </aside>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import MarketIcon from '../../market/icons'
import { environmentContextKey } from './environment-context'

const { t, loading, snapshots, loadError, selectedId, selectSnapshot, formatDate, sourceText } = inject(environmentContextKey)!
</script>
