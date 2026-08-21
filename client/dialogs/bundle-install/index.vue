<template>
  <el-dialog
    :model-value="!!activeBundle"
    append-to-body
    align-center
    :class="['bundle-install-panel', modeClass]"
    width="min(880px, calc(100vw - 24px))"
    destroy-on-close
    @update:model-value="close"
  >
    <template #header>
      <bundle-hero></bundle-hero>
    </template>

    <template v-if="activeBundle">
      <bundle-status></bundle-status>
      <bundle-stats v-if="bundle"></bundle-stats>
      <bundle-bulk-row v-if="selectedMembers.length"></bundle-bulk-row>
      <bundle-member-section v-if="requiredMembers.length" :members="requiredMembers" required></bundle-member-section>
      <bundle-member-section v-if="optionalMembers.length" :members="optionalMembers"></bundle-member-section>
      <bundle-diff v-if="bundle"></bundle-diff>
    </template>

    <template #footer>
      <bundle-footer></bundle-footer>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { provide } from 'vue'
  import { useBundleInstall } from './logic/use-bundle-install'
  import { bundleContextKey } from './logic/bundle-context'
  import BundleBulkRow from './components/bundle-bulk-row.vue'
  import BundleDiff from './components/bundle-diff.vue'
  import BundleFooter from './components/bundle-footer.vue'
  import BundleHero from './components/bundle-hero.vue'
  import BundleMemberSection from './components/bundle-member-section.vue'
  import BundleStats from './components/bundle-stats.vue'
  import BundleStatus from './components/bundle-status.vue'

const ctx = useBundleInstall()
provide(bundleContextKey, ctx)
const { activeBundle, bundle, modeClass, close, selectedMembers, requiredMembers, optionalMembers } = ctx
</script>

<style src="./index.scss" lang="scss"></style>
