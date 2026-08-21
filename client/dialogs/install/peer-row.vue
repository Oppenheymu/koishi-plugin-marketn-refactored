<template>
  <tr>
    <td class="text-left">{{ name }}</td>
    <td>{{ peer.request }}</td>
    <td>
      <peer-version-cell
        :name="name"
        :version="getVersion(name)"
        :current="current"
        :version-popper-class="versionPopperClass"
        :versions="store.registry[name]"
        :should-show-select="shouldShowPeerVersionSelect(peer, name)"
        :resolved-version="getPeerResolvedVersion(peer, name)"
        :workspace-version="getWorkspaceVersion(name)"
        :set-version="setVersion">
      </peer-version-cell>
    </td>
    <td :class="['theme-color', peer.result]">
      <span class="inline-flex items-center gap-1">
        <k-icon :name="getResultIcon(peer.result)"></k-icon>
        {{ getResultText(peer, name) }}
      </span>
    </td>
  </tr>
</template>

<script lang="ts" setup>
import { store } from '@koishijs/client'
import type { PeerInfo, ResultType } from '../../shared/install/analyze-versions'
import PeerVersionCell from './peer-version-cell.vue'

defineProps<{
  peer: PeerInfo
  name: string
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
