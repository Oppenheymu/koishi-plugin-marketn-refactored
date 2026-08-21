<template>
  <el-dialog :model-value="!!active" @update:model-value="closePanel" :class="['install-panel', modeClass]" destroy-on-close>
    <template v-if="active" #header="{ titleId, titleClass }">
      <span :id="titleId" :class="titleClass">
        {{ active + (localSelection ? ` (${t('dependencyCard.current.local')})` : '') }}
      </span>
      <el-select
        v-if="data"
        v-model="selectVersion"
        class="market-version-select"
        :disabled="localSelection"
        :popper-class="versionPopperClass"
      >
        <el-option v-for="({ result }, version) in data" :key="version" :value="version">
          {{ version }}
          <template v-if="version === current">{{ t('dependencyCard.actions.current') }}</template>
          <span :class="[result, 'theme-color', 'dot-hint']"></span>
        </el-option>
      </el-select>
    </template>

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

    <template v-if="active && !global.static" #footer>
      <div class="left">
        <el-checkbox v-model="bulkMode">
          {{ t('operations.install.bulkMode') }}
          <k-hint>
            {{ t('operations.install.bulkModeHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button v-if="local" type="primary" @click="configure()">{{ t('dependencyCard.actions.configure') }}</el-button>
        <template v-if="localSelection">
          <el-button v-if="showRemoveButton" @click="installDep('', true)" type="danger">{{ t('operations.install.remove') }}</el-button>
          <el-button v-else-if="workspace" @click="installDep(workspace)" type="success">{{ t('operations.install.add') }}</el-button>
        </template>
        <template v-else-if="data">
          <el-button v-if="showRemoveButton" @click="requestRemove()" type="danger">{{ t('operations.install.uninstall') }}</el-button>
          <el-button :type="result" @click="installDep(version)" :disabled="unchanged">
            {{ current ? t('operations.install.update') : store.dependencies?.[active] ? t('operations.install.repair') : t('operations.install.install') }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="showRemoveDialog" class="market-remove-dialog" destroy-on-close>
    {{ t('operations.install.removeConfigQuestion') }}
    <template #footer>
      <div class="left">
        <el-checkbox v-model="saveChoice">
          {{ t('operations.install.rememberChoice') }}
          <k-hint>
            {{ t('operations.install.rememberChoiceHint') }}
          </k-hint>
        </el-checkbox>
      </div>
      <div class="right">
        <el-button type="danger" @click="installDep('', false, true)">{{ t('operations.install.delete') }}</el-button>
        <el-button type="primary" @click="installDep('', false, false)">{{ t('operations.install.keep') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="bundleUninstallTarget"
    :record="bundleUninstallRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
import { global, store } from '@koishijs/client'
import BundleUninstall from '../bundle-uninstall/index.vue'
import PeerTable from './peer-table.vue'
import { useInstall } from './use-install'

const {
  t,
  active,
  modeClass,
  versionPopperClass,
  data,
  selectVersion,
  current,
  danger,
  warning,
  registryStatus,
  registryStatusText,
  bulkMode,
  local,
  localSelection,
  showRemoveButton,
  workspace,
  requestRemove,
  result,
  unchanged,
  installDep,
  configure,
  showRemoveDialog,
  saveChoice,
  showBundleUninstallDialog,
  bundleUninstallTarget,
  bundleUninstallRecord,
  version,
  getVersion,
  setVersion,
  shouldShowPeerVersionSelect,
  getPeerResolvedVersion,
  getWorkspaceVersion,
  getResultIcon,
  getResultText,
} = useInstall()
</script>

<style src="./index.scss" lang="scss"></style>
