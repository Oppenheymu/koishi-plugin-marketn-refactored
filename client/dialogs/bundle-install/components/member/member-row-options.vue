<template>
  <div class="member-options" v-if="member.selected" @click.stop>
    <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
    <el-checkbox
      v-if="member.conflict === 'other-config'"
      v-model="member.move"
    >{{ t('bundle.members.moveConfig') }}</el-checkbox>
    <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
  </div>
</template>

<script lang="ts" setup>
import type { BundleInstallMember } from '../../../../../src/shared/bundle'
import { useMarketNextI18n } from '../../../../i18n'

defineOptions({ inheritAttrs: false })

defineProps<{
  member: BundleInstallMember
  hasPreset: (member: BundleInstallMember) => boolean
}>()

const { t } = useMarketNextI18n()
</script>
