<template>
  <el-scrollbar v-if="data?.[version] && Object.keys(data[version].peers).length" class="peer-table-scroll">
    <table class="peer-table">
      <colgroup>
        <col class="peer-name-col"><col class="peer-range-col"><col class="peer-current-col"><col class="peer-status-col">
      </colgroup>
      <thead>
        <tr>
          <th>{{ t('operations.install.peerName') }}</th>
          <th>{{ t('operations.install.peerRange') }}</th>
          <th>{{ t('operations.install.peerCurrent') }}</th>
          <th>{{ t('operations.install.peerAvailability') }}</th>
        </tr>
      </thead>
      <tbody>
        <peer-row
          v-for="(peer, name) in data[version].peers"
          :key="name"
          :peer="peer"
          :name="name"
          :current="current"
          :version-popper-class="versionPopperClass"
          :get-version="getVersion"
          :set-version="setVersion"
          :should-show-peer-version-select="shouldShowPeerVersionSelect"
          :get-peer-resolved-version="getPeerResolvedVersion"
          :get-workspace-version="getWorkspaceVersion"
          :get-result-icon="getResultIcon"
          :get-result-text="getResultText">
        </peer-row>
      </tbody>
    </table>
  </el-scrollbar>
</template>

<script lang="ts" setup>
import { type Dict } from '@koishijs/client'
import { useMarketNextI18n } from '../../i18n'
import type { AnalyzeResult, PeerInfo, ResultType } from '../../shared/install/analyze-versions'
import PeerRow from './peer-row.vue'

const { t } = useMarketNextI18n()

defineProps<{
  data: Dict<AnalyzeResult> | undefined
  version: string
  current?: string
  versionPopperClass: string
  getVersion: (name: string) => string
  setVersion: (name: string, version: string) => void
  shouldShowPeerVersionSelect: (peer: PeerInfo, name: string) => boolean
  getPeerResolvedVersion: (peer: PeerInfo, name: string) => string | undefined
  getWorkspaceVersion: (name: string) => string | undefined
  getResultIcon: (type: ResultType) => string | undefined
  getResultText: (peer: PeerInfo, name: string) => string | undefined
}>()

</script>
