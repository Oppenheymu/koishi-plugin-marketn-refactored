<template>
  <div class="member-row">
    <el-checkbox v-if="!required" :model-value="member.selected" @click.stop @change="toggleMember(member)" class="member-check"></el-checkbox>
    <div :class="['member-icon', 'cat-' + memberCategory(member.package)]">
      <market-icon :name="'outline:' + memberCategory(member.package)"></market-icon>
    </div>
    <div class="member-main">
      <div class="member-line">
        <span class="member-name">{{ formatShortname(member.package) }}</span>
        <span class="member-version">{{ member.version }}</span>
        <span
          v-for="tag in riskTags(member)"
          :key="tag.label"
          :class="['member-risk', tag.type]"
        >{{ tag.label }}</span>
      </div>
      <div class="member-sub">
        <span class="member-fullname">{{ member.package }}</span>
        <span class="dot">·</span>
        <span>{{ getInstalledText(member.package) }}</span>
      </div>
      <p v-if="getPackageDescription(member.package)" class="member-desc">
        {{ getPackageDescription(member.package) }}
      </p>
    </div>
    <div v-if="required" class="member-side">
      <span class="member-required-pill">
        <k-icon name="lock"></k-icon>
        {{ t('bundle.members.requiredPill') }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { BundleInstallMember } from '../../../../../src/shared/bundle'
import MarketIcon from '../../../../market/icons'
import { useMarketNextI18n } from '../../../../i18n'

defineOptions({ inheritAttrs: false })

defineProps<{
  member: BundleInstallMember
  required: boolean
  memberCategory: (name: string) => string
  formatShortname: (name: string) => string
  riskTags: (member: BundleInstallMember) => Array<{ label: string, type: string }>
  getInstalledText: (name: string) => string
  getPackageDescription: (name: string) => string | undefined
  toggleMember: (member: BundleInstallMember) => void
}>()

const { t } = useMarketNextI18n()
</script>
