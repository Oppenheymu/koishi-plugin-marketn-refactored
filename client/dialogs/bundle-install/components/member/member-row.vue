<template>
  <section
    :class="['bundle-member', required ? 'required' : 'optional', { selected: member.selected }]"
    :role="required ? undefined : 'checkbox'"
    :aria-checked="required ? undefined : String(member.selected)"
    :tabindex="required ? undefined : 0"
    @click="onToggle"
    @keydown.enter.prevent="onToggle"
    @keydown.space.prevent="onToggle"
  >
    <member-row-main v-bind="props"></member-row-main>
    <member-row-options v-bind="props"></member-row-options>
    <member-row-warnings v-bind="props"></member-row-warnings>
    <member-row-editor v-bind="props"></member-row-editor>
  </section>
</template>

<script lang="ts" setup>
import type { BundleInstallMember } from '../../../../../src/shared/bundle'
import MemberRowEditor from './member-row-editor.vue'
import MemberRowMain from './member-row-main.vue'
import MemberRowOptions from './member-row-options.vue'
import MemberRowWarnings from './member-row-warnings.vue'

const props = defineProps<{
  member: BundleInstallMember
  required: boolean
  memberJsonErrors: Record<string, string>
  memberCategory: (name: string) => string
  formatShortname: (name: string) => string
  riskTags: (member: BundleInstallMember) => Array<{ label: string, type: string }>
  getInstalledText: (name: string) => string
  getPackageDescription: (name: string) => string | undefined
  hasPreset: (member: BundleInstallMember) => boolean
  sensitiveFields: (member: BundleInstallMember) => string[]
  formatConfig: (value: unknown) => string
  onJsonInput: (member: BundleInstallMember, value: string) => void
  getMemberKey: (member: BundleInstallMember) => string
  toggleMember: (member: BundleInstallMember) => void
}>()

function onToggle() {
  if (!props.required) props.toggleMember(props.member)
}
</script>
