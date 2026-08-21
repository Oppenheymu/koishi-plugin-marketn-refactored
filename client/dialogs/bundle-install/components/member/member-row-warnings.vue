<template>
  <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
    <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
  </k-comment>

  <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
    <p>{{ t('bundle.conflict.config') }}</p>
  </k-comment>

  <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
    <p>{{ t('bundle.conflict.sameGroup') }}</p>
  </k-comment>
</template>

<script lang="ts" setup>
import { store } from '@koishijs/client'
import type { BundleInstallMember } from '../../../../../src/shared/bundle'
import { useMarketNextI18n } from '../../../../i18n'

defineOptions({ inheritAttrs: false })

defineProps<{
  member: BundleInstallMember
}>()

const { t } = useMarketNextI18n()
</script>
