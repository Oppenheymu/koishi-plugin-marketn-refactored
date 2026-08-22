<template>
  <section class="local-package-panel" :aria-busy="busy">
    <input
      ref="fileInput"
      class="local-package-input"
      type="file"
      accept=".tgz,application/gzip,application/x-gzip"
      @change="onFileInput"
    >
    <div
      :class="['local-package-dropzone', { dragging, busy, ready: !!preview, failed: !!error }]"
      role="button"
      tabindex="0"
      :aria-disabled="busy"
      @click="openFilePicker"
      @keydown.enter.prevent="openFilePicker"
      @keydown.space.prevent="openFilePicker"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <template v-if="preview">
        <div class="local-package-preview-icon" aria-hidden="true">
          <market-icon name="file-archive"></market-icon>
        </div>
        <div class="local-package-preview-main">
          <div class="local-package-preview-heading">
            <strong>{{ preview.name }}</strong>
            <span class="local-package-operation">
              {{ t(`operations.manual.operation.${preview.operation}`) }}
            </span>
          </div>
          <div class="local-package-version-change">
            <span>{{ preview.currentVersion || t('operations.manual.notInstalled') }}</span>
            <k-icon name="arrow-right"></k-icon>
            <strong>{{ preview.version }}</strong>
          </div>
          <p v-if="preview.description">{{ preview.description }}</p>
          <div class="local-package-meta">
            <span>{{ preview.filename }}</span>
            <span>{{ formatBytes(preview.size) }}</span>
            <span>SHA-256 {{ preview.hash.slice(0, 12) }}</span>
          </div>
        </div>
      </template>
      <template v-else-if="uploading">
        <div class="local-package-upload-icon uploading" aria-hidden="true">
          <k-icon name="market-next:upload"></k-icon>
        </div>
        <strong>{{ t('operations.manual.uploading') }}</strong>
        <span class="local-package-filename">{{ selectedFilename }}</span>
        <el-progress :percentage="uploadProgress" :stroke-width="8" :show-text="false"></el-progress>
        <small>{{ formatBytes(uploadedBytes) }} / {{ formatBytes(selectedSize) }}</small>
      </template>
      <template v-else>
        <div class="local-package-upload-icon" aria-hidden="true">
          <k-icon name="market-next:upload"></k-icon>
        </div>
        <strong>{{ t('operations.manual.dropTitle') }}</strong>
        <span>{{ t('operations.manual.dropHint') }}</span>
        <small>{{ t('operations.manual.dropLimit') }}</small>
      </template>
    </div>

    <p class="local-package-status" aria-live="polite">
      <span v-if="error" class="local-package-error" role="alert">{{ error }}</span>
      <span v-else-if="uploading">{{ t('operations.manual.uploading') }} {{ uploadProgress }}%</span>
    </p>

    <k-comment v-if="preview?.scripts.length" type="warning" class="local-package-script-warning">
      <p>{{ t('operations.manual.scriptWarning', { scripts: preview.scripts.join(', ') }) }}</p>
    </k-comment>
  </section>
</template>

<script lang="ts" setup>
import type { LocalPackageUploadPreview } from 'koishi-plugin-marketn-refactored'
import { ref } from 'vue'
import { useMarketNextI18n } from '../i18n'
import MarketIcon from '../market/icons'

const props = defineProps<{
  busy: boolean
  error: string
  preview?: LocalPackageUploadPreview
  selectedFilename: string
  selectedSize: number
  uploadedBytes: number
  uploading: boolean
  uploadProgress: number
}>()

const emit = defineEmits<{
  error: [message: string]
  select: [file: File]
}>()

const { t } = useMarketNextI18n()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
let dragDepth = 0

function openFilePicker() {
  if (props.busy) return
  fileInput.value?.click()
}

function onFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) emit('select', file)
}

function onDragEnter() {
  if (props.busy) return
  dragDepth++
  dragging.value = true
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}

function onDrop(event: DragEvent) {
  dragDepth = 0
  dragging.value = false
  if (props.busy) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length !== 1) {
    emit('error', t('operations.manual.singleFile'))
    return
  }
  emit('select', files[0])
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MiB`
}
</script>

<style lang="scss" scoped src="./local-package-upload.scss"></style>
