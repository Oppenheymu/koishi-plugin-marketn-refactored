<template>
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
</template>

<script lang="ts" setup>
import type { BundleInstallMember } from '../../../src/shared/bundle'
import { useMarketNextI18n } from '../../i18n'

defineOptions({ inheritAttrs: false })

defineProps<{
  member: BundleInstallMember
  memberJsonErrors: Record<string, string>
  sensitiveFields: (member: BundleInstallMember) => string[]
  formatConfig: (value: unknown) => string
  onJsonInput: (member: BundleInstallMember, value: string) => void
  getMemberKey: (member: BundleInstallMember) => string
  hasPreset: (member: BundleInstallMember) => boolean
}>()

const { t } = useMarketNextI18n()
</script>
