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

    <div class="member-options" v-if="member.selected" @click.stop>
      <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
      <el-checkbox
        v-if="member.conflict === 'other-config'"
        v-model="member.move"
      >{{ t('bundle.members.moveConfig') }}</el-checkbox>
      <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
    </div>

    <!-- Conflict Warning Comments -->
    <k-comment v-if="member.conflict === 'package-mismatch' && member.selected" type="danger" class="member-warning" @click.stop>
      <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
    </k-comment>

    <k-comment v-if="member.conflict === 'other-config' && member.selected" type="warning" class="member-warning" @click.stop>
      <p>{{ t('bundle.conflict.config') }}</p>
    </k-comment>

    <k-comment v-if="member.conflict === 'same-group' && member.selected" type="info" class="member-warning" @click.stop>
      <p>{{ t('bundle.conflict.sameGroup') }}</p>
    </k-comment>

    <!-- Sensitive fields in-place editing -->
    <div v-if="member.selected && member.usePreset && sensitiveFields(member).length" class="sensitive-fields-editor" @click.stop>
      <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
      <div class="editor-grid">
        <div v-for="field in sensitiveFields(member)" :key="field" class="editor-field-row">
          <span class="field-label">{{ field }}:</span>
          <el-input
            size="small"
            v-model="member.config[field]"
            :placeholder="t('bundle.editor.placeholder', { field })"
            show-password
          ></el-input>
        </div>
      </div>
    </div>

    <details v-if="hasPreset(member) && member.selected" class="member-config" @click.stop>
      <summary>{{ t('bundle.editor.viewPreset') }}</summary>
      <div class="json-editor-container">
        <textarea
          class="raw-json-editor"
          :value="formatConfig(member.config)"
          @input="onJsonInput(member, $event.target.value)"
          rows="8"
        ></textarea>
        <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
          {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
        </div>
      </div>
    </details>
  </section>
</template>

<script lang="ts" setup>
import { store } from '@koishijs/client'
import type { BundleInstallMember } from '../../../src/shared/bundle'
import MarketIcon from '../../market/icons'
import { useMarketNextI18n } from '../../i18n'

const { t } = useMarketNextI18n()

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
