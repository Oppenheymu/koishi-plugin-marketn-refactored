<template>
  <ignore-dialog
    v-model:showIgnoreDialog="card.showIgnoreDialog"
    v-model:ignorePackagePermanently="card.ignorePackagePermanently"
    v-model:ignoreDurationPreset="card.ignoreDurationPreset"
    v-model:ignoreCustomDays="card.ignoreCustomDays"
    v-model:ignoreCount="card.ignoreCount"
    :modeClass="card.modeClass"
    :displayName="card.displayName"
    :latestVersion="card.latestVersion"
    :ignoreSaving="card.ignoreSaving"
    :confirmIgnoreUpdate="card.confirmIgnoreUpdate"
  ></ignore-dialog>

  <binding-dialog
    v-model:showLocalBindingDialog="card.showLocalBindingDialog"
    :modeClass="card.modeClass"
    :displayName="card.displayName"
    :bindingLocal="card.bindingLocal"
    :confirmLocalBinding="card.confirmLocalBinding"
  ></binding-dialog>

  <bundle-uninstall
    v-model="card.showBundleUninstallDialog"
    :package-name="props.name"
    :record="card.bundleRecord"
  ></bundle-uninstall>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import BundleUninstall from '../../../../../dialogs/bundle-uninstall/index.vue'
import BindingDialog from '../../dialogs/binding-dialog.vue'
import IgnoreDialog from '../../dialogs/ignore-dialog.vue'
  import { cardContextKey } from '../logic/use-card'

const { card, props } = inject(cardContextKey)!
</script>
