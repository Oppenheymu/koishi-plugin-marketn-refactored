<template>
  <section :class="['market-secret-archive', { 'is-ready': ready, 'is-copy-ready': copyReady }]">
    <header class="market-secret-archive__header">
      <code>{{ t('marketPage.easter.archive.path') }}</code>
      <span>{{ ready ? t('marketPage.easter.archive.recovered') : t('marketPage.easter.archive.recovering') }}</span>
    </header>

    <div class="market-secret-archive__visual">
      <koishi-eye-splash
        class="market-secret-archive__animation"
        @ready="ready = true"
        @complete="copyReady = true"
      ></koishi-eye-splash>
    </div>

    <div class="market-secret-archive__record">
      <dl class="market-secret-archive__meta archive-meta-reveal" style="animation-delay: 0.15s">
        <div>
          <dt>{{ t('marketPage.easter.archive.koishiVersion') }}</dt>
          <dd>{{ koishiVersion || t('marketPage.easter.archive.unknown') }}</dd>
        </div>
        <div>
          <dt>{{ t('marketPage.easter.archive.recordedAt') }}</dt>
          <dd>{{ recordedAt }}</dd>
        </div>
        <div>
          <dt>{{ t('marketPage.easter.archive.marketIndex') }}</dt>
          <dd>{{ t('marketPage.easter.archive.plugins', { count: formattedMarketCount }) }}</dd>
        </div>
      </dl>

      <article class="market-secret-archive__copy">
        <k-markdown
          v-for="(paragraph, index) in paragraphs"
          :key="index"
          class="market-secret-archive__paragraph archive-copy-reveal"
          :style="{ animationDelay: `${0.2 + index * 0.24}s` }"
          :source="paragraph"
        ></k-markdown>
      </article>

      <div
        class="market-secret-archive__source archive-copy-reveal"
        :style="{ animationDelay: `${0.3 + paragraphs.length * 0.24}s` }"
      >
        <span>{{ t('marketPage.easter.archive.sourceLabel') }}</span>
        <code>{{ t('marketPage.easter.archive.source') }}</code>
      </div>

      <p
        class="market-secret-archive__declaration archive-copy-reveal"
        :style="{ animationDelay: `${0.57 + paragraphs.length * 0.24}s` }"
      >
        {{ declaration }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMarketNextI18n } from '../../shared/i18n'
import KoishiEyeSplash from './koishi-eye-splash.vue'

const props = defineProps<{
  koishiVersion?: string,
  marketCount: number,
  recordedAt: string,
}>()

const { t, locale } = useMarketNextI18n()
const ready = ref(false)
const copyReady = ref(false)

const blocks = computed(() => t('marketPage.easter.secretSearch')
  .split(/\r?\n\s*\r?\n/)
  .map(block => block.trim())
  .filter(Boolean))

const paragraphs = computed(() => blocks.value.slice(0, -1))

const declaration = computed(() => {
  const value = blocks.value.at(-1) || ''
  return value.replace(/^\*\*(.*)\*\*$/s, '$1')
})

const formattedMarketCount = computed(() => props.marketCount.toLocaleString(locale.value))
</script>

<style lang="scss" src="./market-secret-archive.scss"></style>
