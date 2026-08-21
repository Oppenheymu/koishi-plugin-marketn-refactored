<template>
  <span class="wrapper" v-if="shouldShowSelect">
    <span class="shadow">{{ version || t('operations.install.select') }}</span>
    <el-select
      class="frameless market-version-select"
      :model-value="version"
      :popper-class="versionPopperClass"
      @update:model-value="setVersion(name, $event)"
    >
      <el-option value="">{{ t('dependencyCard.actions.remove') }}</el-option>
      <el-option v-for="(_, v) in versions" :key="v" :value="v">
        {{ v }}
        <template v-if="v === current">{{ t('dependencyCard.actions.current') }}</template>
      </el-option>
    </el-select>
  </span>
  <span v-else class="peer-version" :class="{ workspace: !!workspaceVersion, missing: !resolvedVersion }">
    {{ resolvedVersion || t('operations.confirm.notInstalled') }}
    <template v-if="workspaceVersion">{{ t('dependencyCard.current.workspace') }}</template>
  </span>
</template>

<script lang="ts" setup>
import { type Dict, store } from '@koishijs/client'
import { useMarketNextI18n } from '../../i18n'

const { t } = useMarketNextI18n()

defineProps<{
  name: string
  version: string | undefined
  current?: string
  versionPopperClass: string
  versions: Dict<unknown> | undefined
  shouldShowSelect: boolean
  resolvedVersion: string | undefined
  workspaceVersion: string | undefined
  setVersion: (name: string, version: string) => void
}>()
</script>
