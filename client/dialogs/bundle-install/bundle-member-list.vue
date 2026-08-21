<template>
  <div class="bundle-member-list">
    <member-row
      v-for="member in members"
      :key="member.package + ':' + member.plugin"
      :member="member"
      :required="required"
      :member-json-errors="memberJsonErrors"
      :member-category="memberCategory"
      :format-shortname="formatShortname"
      :risk-tags="riskTags"
      :get-installed-text="getInstalledText"
      :get-package-description="getPackageDescription"
      :has-preset="hasPreset"
      :sensitive-fields="sensitiveFields"
      :format-config="formatConfig"
      :on-json-input="onJsonInput"
      :get-member-key="getMemberKey"
      :toggle-member="toggleMember"
    ></member-row>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { BundleInstallMember } from '../../../src/shared/bundle'
import { bundleContextKey } from './bundle-context'
import MemberRow from './member-row.vue'

defineProps<{ members: BundleInstallMember[], required?: boolean }>()

const {
  memberJsonErrors, memberCategory, formatShortname, riskTags, getInstalledText,
  getPackageDescription, hasPreset, sensitiveFields, formatConfig, onJsonInput,
  getMemberKey, toggleMember,
} = inject(bundleContextKey)!
</script>
