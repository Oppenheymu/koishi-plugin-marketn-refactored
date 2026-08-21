<template>
  <!-- latest -->
  <k-comment v-if="updateAvailable && !global.static">
    <p>{{ t('extensions.messages.outdatedPrefix') }}<router-link to="/dependencies">{{ t('extensions.actions.goDependencies') }}</router-link>{{ t('extensions.messages.outdatedSuffix') }}</p>
  </k-comment>

  <!-- deprecated -->
  <k-comment v-if="versions?.[dep?.resolved]?.deprecated" type="danger">
    <p>{{ t('extensions.messages.deprecated', { reason: versions[dep.resolved].deprecated }) }}</p>
  </k-comment>

  <!-- external -->
  <k-comment type="warning" v-if="local && !local.workspace && store.dependencies && !store.dependencies[name]">
    <p>{{ t('extensions.messages.externalLocal') }}</p>
  </k-comment>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { global, store } from '@koishijs/client'
import { useMarketNextI18n } from '../../i18n'
import { versionContextKey } from './version-context'

const { t } = useMarketNextI18n()
const { updateAvailable, versions, dep, local, name } = inject(versionContextKey)!
</script>
