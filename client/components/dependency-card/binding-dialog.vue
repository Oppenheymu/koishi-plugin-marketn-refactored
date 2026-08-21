<template>
  <el-dialog
    v-model="showLocalBindingDialog"
    append-to-body
    align-center
    :class="['market-dialog', 'market-dialog--small', 'dep-local-binding-dialog', modeClass]"
    destroy-on-close
  >
    <template #header>{{ t('dependencyCard.localBinding.title') }}</template>
    <div class="dep-local-binding-body">
      <p>{{ t('dependencyCard.localBinding.description', { name: displayName }) }}</p>
      <k-comment type="warning">{{ t('dependencyCard.localBinding.note') }}</k-comment>
    </div>
    <template #footer>
      <el-button @click="showLocalBindingDialog = false">{{ t('dependencyCard.localBinding.cancel') }}</el-button>
      <el-button type="primary" :loading="bindingLocal" @click="confirmLocalBinding">{{ t('dependencyCard.localBinding.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useMarketNextI18n } from '../../i18n'

const showLocalBindingDialog = defineModel<boolean>('showLocalBindingDialog', { required: true })

defineProps<{
  modeClass: string
  displayName: string
  bindingLocal: boolean
  confirmLocalBinding: () => void
}>()

const { t } = useMarketNextI18n()
</script>
