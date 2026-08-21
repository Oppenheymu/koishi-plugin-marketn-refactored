<template>
  <el-scrollbar v-if="data?.[version] && Object.keys(data[version].peers).length" class="peer-table-scroll">
    <table class="peer-table">
      <colgroup>
        <col class="peer-name-col">
        <col class="peer-range-col">
        <col class="peer-current-col">
        <col class="peer-status-col">
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
        <tr v-for="(peer, name) in data[version].peers" :key="name">
          <td class="text-left">{{ name }}</td>
          <td>{{ peer.request }}</td>
          <td>
            <span class="wrapper" v-if="shouldShowPeerVersionSelect(peer, name)">
              <span class="shadow">{{ getVersion(name) || t('operations.install.select') }}</span>
              <el-select
                class="frameless market-version-select"
                :model-value="getVersion(name)"
                :popper-class="versionPopperClass"
                @update:model-value="setVersion(name, $event)"
              >
                  <el-option value="">{{ t('dependencyCard.actions.remove') }}</el-option>
                <el-option v-for="(_, version) in store.registry[name]" :key="version" :value="version">
                  {{ version }}
                  <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
                  <!-- <span :class="[result, 'theme-color', 'dot-hint']"></span> -->
                </el-option>
              </el-select>
            </span>
            <span v-else class="peer-version" :class="{ workspace: !!getWorkspaceVersion(name), missing: !getPeerResolvedVersion(peer, name) }">
              {{ getPeerResolvedVersion(peer, name) || t('operations.confirm.notInstalled') }}
              <template v-if="getWorkspaceVersion(name)">{{ t('dependencyCard.current.workspace') }}</template>
            </span>
          </td>
          <td :class="['theme-color', peer.result]">
            <span class="inline-flex items-center gap-1">
              <k-icon :name="getResultIcon(peer.result)"></k-icon>
              {{ getResultText(peer, name) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </el-scrollbar>
</template>

<script lang="ts" setup>
import { type Dict, store } from '@koishijs/client'
import { useMarketNextI18n } from '../../i18n'
import type { AnalyzeResult, PeerInfo, ResultType } from '../../lib/analyze-versions'

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
