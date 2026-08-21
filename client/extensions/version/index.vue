<template>
  <version-navigation></version-navigation>
  <version-comments></version-comments>
  <version-dialogs></version-dialogs>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { useVersion } from './use-version'
import { versionContextKey } from './version-context'
import VersionComments from './version-comments.vue'
import VersionDialogs from './version-dialogs.vue'
import VersionNavigation from './version-navigation.vue'

const ctx = useVersion()
provide(versionContextKey, ctx)
</script>
