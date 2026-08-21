<template>
  <el-dialog
    v-model="showManual"
    append-to-body
    align-center
    class="manual-panel local-package-dialog"
    destroy-on-close
    width="min(680px, calc(100vw - 24px))"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
  >
    <template #header>{{ t('operations.manual.title') }}</template>

    <el-tabs v-model="mode" class="manual-tabs">
      <el-tab-pane name="local">
        <template #label>
          <span class="manual-tab-label">
            <market-icon name="file-archive"></market-icon>
            <span>{{ t('operations.manual.localTab') }}</span>
          </span>
        </template>
        <local-package-upload
          :busy="busy"
          :error="uploadError"
          :preview="preview"
          :selected-filename="selectedFilename"
          :selected-size="selectedSize"
          :uploaded-bytes="uploadedBytes"
          :uploading="uploading"
          :upload-progress="uploadProgress"
          @error="setError"
          @select="uploadFile"
        ></local-package-upload>
      </el-tab-pane>

      <el-tab-pane name="registry" :disabled="busy">
        <template #label>
          <span class="manual-tab-label">
            <k-icon name="cube"></k-icon>
            <span>{{ t('operations.manual.registryTab') }}</span>
          </span>
        </template>
        <div class="registry-panel">
          <k-comment type="warning">
            <p>
              {{ t('operations.manual.hint') }}
              <router-link to="/market">{{ t('operations.manual.market') }}</router-link>
              {{ t('operations.manual.hintAfter') }}
            </p>
          </k-comment>
          <el-input
            v-model="name"
            clearable
            :aria-invalid="!!registryError"
            :class="{ invalid: !!registryError }"
            :placeholder="t('operations.manual.placeholder')"
            @keydown.enter.stop.prevent="onRegistryEnter"
          ></el-input>
          <p class="registry-status" aria-live="polite">
            <span v-if="registryLoading">{{ t('operations.manual.registryLoading') }}</span>
            <span v-else-if="registryError" class="error" role="alert">{{ registryError }}</span>
          </p>
          <dl v-if="remote" class="registry-preview">
            <div>
              <dt>{{ t('operations.manual.latest') }}</dt>
              <dd>{{ remote['dist-tags']?.latest }}</dd>
            </div>
            <div>
              <dt>{{ t('operations.manual.description') }}</dt>
              <dd>{{ remote.description || '-' }}</dd>
            </div>
          </dl>
        </div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div :class="['manual-footer', { 'manual-footer--local': mode === 'local' }]">
        <template v-if="mode === 'local'">
          <el-button v-if="preview || uploadError" :disabled="busy" @click="reset()">
            {{ t('operations.manual.chooseAnother') }}
          </el-button>
          <span class="manual-footer-spacer"></span>
          <el-button :disabled="committing" @click="showManual = false">
            {{ t('operations.manual.cancel') }}
          </el-button>
          <el-button type="primary" :loading="committing" :disabled="!preview || busy" @click="installPackage">
            {{ confirmText }}
          </el-button>
        </template>
        <template v-else>
          <span class="manual-footer-spacer"></span>
          <el-button @click="showManual = false">{{ t('operations.manual.cancel') }}</el-button>
          <el-button type="primary" :disabled="registryInvalid" @click="onRegistryEnter">
            {{ t('operations.manual.confirm') }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import type { Registry } from '@koishijs/registry'
import { useDebounceFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import LocalPackageUpload from '../local-package-upload/index.vue'
import MarketIcon from '../../market/icons'
import { useLocalPackageUpload } from '../local-package-upload/use-local-package-upload'
import { useMarketNextI18n } from '../../i18n'
import { getPendingOverrides, patchMarketNextData } from '../../shared/config/data-store'
import { addManual } from '../../shared/install/analyze-versions'
import { showManual } from '../../shared/ui/dialogs'

type ManualMode = 'local' | 'registry'

const { t } = useMarketNextI18n()
const mode = ref<ManualMode>('local')
const name = ref('')
const remote = ref<Registry>()
const registryLoading = ref(false)
const registryError = ref('')
let registryRequest = 0

const {
  busy,
  committing,
  confirmText,
  installPackage,
  preview,
  reset,
  selectedFilename,
  selectedSize,
  setError,
  uploadError,
  uploadFile,
  uploadProgress,
  uploadedBytes,
  uploading,
} = useLocalPackageUpload(t, () => {
  showManual.value = false
})

const registryInvalid = computed(() => {
  const query = name.value.trim()
  return !query
    || registryLoading.value
    || !!registryError.value
    || remote.value?.name !== query
    || !remote.value?.['dist-tags']?.latest
})

const fetchRemote = useDebounceFn(async (query: string, request: number) => {
  try {
    const data = await addManual(query)
    if (request !== registryRequest || query !== name.value.trim()) return
    remote.value = data
  } catch (error) {
    if (request !== registryRequest || query !== name.value.trim()) return
    console.warn(error)
    registryError.value = t('operations.manual.registryLookupFailed')
  } finally {
    if (request === registryRequest) registryLoading.value = false
  }
}, 500)

watch(name, (value) => {
  const query = value.trim()
  const request = ++registryRequest
  remote.value = undefined
  registryError.value = ''
  registryLoading.value = !!query
  if (query) void fetchRemote(query, request)
})

watch(mode, (value, previous) => {
  if (previous === 'local' && value !== 'local') void reset(true)
})

watch(showManual, (visible) => {
  if (visible) return
  void reset(true)
  resetRegistry()
  mode.value = 'local'
})

function onRegistryEnter() {
  if (registryInvalid.value || !remote.value) return
  const packageName = remote.value.name
  const latest = remote.value['dist-tags']?.latest
  if (!latest) return
  const override = getPendingOverrides()
  override[packageName] = latest
  void patchMarketNextData({ override: { ...override } })
  showManual.value = false
}

function resetRegistry() {
  registryRequest++
  name.value = ''
  remote.value = undefined
  registryLoading.value = false
  registryError.value = ''
}
</script>

<style scoped src="./index.scss" lang="scss"></style>
