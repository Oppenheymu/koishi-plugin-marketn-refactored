<template>
  <div class="bundle-section-title">
    <k-icon :name="required ? 'check-full' : 'info-full'"></k-icon>
    {{ t(required ? 'bundle.members.required' : 'bundle.members.optional') }} <span class="bundle-section-count">{{ members.length }}</span>
    <button v-if="!required" class="bundle-section-action" @click="toggleAllOptional">
      {{ allOptionalSelected ? t('bundle.members.optionalToggleNone') : t('bundle.members.optionalToggleAll') }}
    </button>
  </div>
  <bundle-member-list :members="members" :required="required"></bundle-member-list>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { BundleInstallMember } from '../../../../src/shared/bundle'
import { useMarketNextI18n } from '../../../i18n'
  import { bundleContextKey } from '../logic/bundle-context'
import BundleMemberList from './bundle-member-list.vue'

defineProps<{ members: BundleInstallMember[], required?: boolean }>()

const { t } = useMarketNextI18n()
const { allOptionalSelected, toggleAllOptional } = inject(bundleContextKey)!
</script>
