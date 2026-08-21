import type { Ref } from 'vue'
import { store } from '@koishijs/client'
import { scanSensitiveConfig } from '../../../src/shared/bundle-idents'
import type { BundleInstallMember } from '../../../src/shared/bundle'
import { getMarketObject } from '../../market/state'

// bundle-install 对话框的成员展示辅助：市场元信息、安装文案、风险标签等，
// 依赖 i18n 的 t/locale 由 useBundleInstall 传入
export interface MemberInfoContext {
  t: (key: string, ...args: any[]) => string
  locale: Ref<string>
}

export function useMemberInfo(input: MemberInfoContext) {
  const { t, locale } = input

  function memberInfo(name: string) {
    return getMarketObject(name)
  }

  function getPackageDescription(name: string) {
    const data = memberInfo(name)
    const description = data?.manifest?.description || data?.package?.description
    if (typeof description === 'string') return description
    if (description && typeof description === 'object') {
      const preferred = locale.value.toLowerCase().startsWith('zh')
        ? ['zh-CN', 'zh', 'en-US', 'en']
        : ['en-US', 'en', 'zh-CN', 'zh']
      for (const key of preferred) {
        const text = description[key]
        if (text) return text
      }
      return Object.values(description).find(Boolean)
    }
  }

  function getInstalledText(name: string) {
    const dep = store.dependencies?.[name]
    if (dep?.resolved) return t('bundle.members.installed', { version: dep.resolved })
    if (store.packages?.[name]) return t('bundle.members.loaded', { version: store.packages[name].package.version })
    return t('bundle.members.notInstalled')
  }

  function versionMeta(member: BundleInstallMember) {
    return store.registry?.[member.package]?.[member.version]
  }

  function riskTags(member: BundleInstallMember) {
    const data = memberInfo(member.package)
    const tags: Array<{ label: string, type: string }> = []
    if (!data) tags.push({ label: t('bundle.members.marketMissing'), type: 'warning' })
    if (data?.verified) tags.push({ label: t('bundle.members.verified'), type: 'success' })
    if (data?.insecure) tags.push({ label: t('bundle.members.insecure'), type: 'danger' })
    if ((data as any)?.deprecated || versionMeta(member)?.deprecated) tags.push({ label: t('bundle.members.deprecated'), type: 'danger' })
    if (data?.manifest?.preview) tags.push({ label: t('bundle.members.preview'), type: 'warning' })
    if (data?.portable) tags.push({ label: t('bundle.members.portable'), type: 'info' })
    if (hasPreset(member)) tags.push({ label: t('bundle.members.hasPreset'), type: 'warning' })
    return tags
  }

  function hasPreset(member: BundleInstallMember) {
    return !!member.config && Object.keys(member.config).length > 0
  }

  function sensitiveFields(member: BundleInstallMember) {
    return scanSensitiveConfig(member.config)
  }

  function formatConfig(value: unknown) {
    return JSON.stringify(value ?? {}, null, 2)
  }

  return {
    memberInfo,
    getPackageDescription,
    getInstalledText,
    versionMeta,
    riskTags,
    hasPreset,
    sensitiveFields,
    formatConfig,
  }
}
