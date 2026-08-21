<template>
  <el-dialog
    v-model="visible"
    append-to-body
    :class="['bundle-uninstall-dialog', modeClass]"
    :title="title || t('bundle.actions.uninstall')"
    width="min(760px, calc(100vw - 24px))"
    destroy-on-close
  >
    <bundle-body v-if="packageName"></bundle-body>
    <template v-else>
      <k-comment type="warning">
        <p>{{ t('bundle.messages.noDependency') }}</p>
      </k-comment>
    </template>

    <template #footer>
      <bundle-footer></bundle-footer>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { useMarketNextI18n } from '../../i18n'
import { bundleUninstallContextKey } from './bundle-uninstall-context'
import { useBundleUninstall, type BundleUninstallProps } from './use-uninstall'
import BundleBody from './bundle-body.vue'
import BundleFooter from './bundle-footer.vue'

const props = defineProps<BundleUninstallProps>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const { t } = useMarketNextI18n()

const ctx = useBundleUninstall(props, emit)
provide(bundleUninstallContextKey, ctx)
const { visible, modeClass, packageName } = ctx
</script>

<style scoped src="./index.scss" lang="scss"></style>
