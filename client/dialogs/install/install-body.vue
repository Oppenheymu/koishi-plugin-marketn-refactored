<template>
  <k-comment class="danger" v-if="danger" type="danger">{{ danger }}</k-comment>
  <k-comment class="warning" v-if="warning" type="warning">{{ warning }}</k-comment>

  <div v-if="!data && active && !localSelection">
    <k-comment :type="registryStatus?.error ? 'danger' : 'info'">{{ registryStatusText }}</k-comment>
  </div>

  <k-comment v-if="store.dependencies?.[active] && !current" type="danger">
    {{ t('operations.install.installErrorHint') }}
  </k-comment>

  <peer-table
    :data="data"
    :version="version"
    :current="current"
    :version-popper-class="versionPopperClass"
    :get-version="getVersion"
    :set-version="setVersion"
    :should-show-peer-version-select="shouldShowPeerVersionSelect"
    :get-peer-resolved-version="getPeerResolvedVersion"
    :get-workspace-version="getWorkspaceVersion"
    :get-result-icon="getResultIcon"
    :get-result-text="getResultText"
  ></peer-table>
</template>

<script setup lang="ts">
import { store } from '@koishijs/client'
import { inject } from 'vue'
import PeerTable from './peer-table.vue'
import { installContextKey } from './install-context'

const { t, active, data, current, danger, warning, registryStatus, registryStatusText, localSelection, version, versionPopperClass, getVersion, setVersion, shouldShowPeerVersionSelect, getPeerResolvedVersion, getWorkspaceVersion, getResultIcon, getResultText } = inject(installContextKey)!
</script>
