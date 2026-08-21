<template>
  <section class="snapshot-detail">
    <div v-if="previewLoading" class="environment-state">{{ t('environment.readingPreview') }}</div>
    <div v-else-if="previewError" class="environment-state error">{{ previewError }}</div>
    <template v-else-if="preview">
      <header class="preview-header">
        <div>
          <span class="preview-eyebrow">{{ t('environment.targetEnvironment') }}</span>
          <h3>{{ preview.snapshot.current ? t('environment.currentEnvironment') : formatDate(preview.snapshot.createdAt) }}</h3>
          <p>{{ sourceText(preview.snapshot.source) }} · {{ t('environment.dependencies', { count: preview.snapshot.dependencyCount }) }}</p>
        </div>
        <div class="preview-summary">
          <span class="changed">{{ t('environment.changedCount', { count: changedCount }) }}</span>
          <span>{{ t('environment.unchangedCount', { count: unchangedCount }) }}</span>
          <span v-if="preview.unsupportedCount" class="blocked">{{ t('environment.unsupportedCount', { count: preview.unsupportedCount }) }}</span>
        </div>
      </header>

      <k-comment type="warning" class="scope-warning">
        {{ t('environment.scopeWarning') }}
      </k-comment>

      <diff-list :changes="orderedChanges" />
    </template>
    <div v-else class="environment-state">{{ t('environment.selectSnapshot') }}</div>
  </section>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
import { environmentContextKey } from './environment-context'
import DiffList from './diff-list.vue'

const { t, preview, previewLoading, previewError, changedCount, unchangedCount, orderedChanges, sourceText, formatDate } = inject(environmentContextKey)!
</script>
