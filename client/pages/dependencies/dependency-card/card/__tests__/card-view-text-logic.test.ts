import { describe, expect, it } from 'vitest'
import { resolveCardDetailText, type CardDetailState } from '../logic/card-view-text-logic'

function state(overrides: Partial<CardDetailState> = {}): CardDetailState {
  return {
    pendingRemove: false,
    pending: false,
    hasDependency: false,
    localDependency: false,
    dependencyInvalid: false,
    hasLocal: false,
    bundlePackage: false,
    unconfigured: false,
    hasError: false,
    hasData: true,
    updateCheckDisabled: false,
    ignoredUpdate: false,
    updatable: false,
    ...overrides,
  }
}

function messages(ignoredUpdate = '') {
  return {
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${params.version}` : key,
    registryStatus: () => 'registry-status',
    ignoredUpdate: () => ignoredUpdate,
  }
}

describe('resolveCardDetailText', () => {
  it('preserves pending and local priority', () => {
    expect(resolveCardDetailText(state({ pending: true, hasDependency: true }), messages()))
      .toBe('dependencyCard.detail.pendingApply')
    expect(resolveCardDetailText(state({ localDependency: true }), messages()))
      .toBe('dependencyCard.detail.localDiscovered')
    expect(resolveCardDetailText(state({ localDependency: true, hasDependency: true, dependencyBound: false }), messages()))
      .toBe('dependencyCard.detail.localUnbound')
  })

  it('handles invalid, bundle, and configuration states', () => {
    expect(resolveCardDetailText(state({ dependencyInvalid: true }), messages()))
      .toBe('dependencyCard.detail.unsupported')
    expect(resolveCardDetailText(state({ bundlePackage: true, hasLocal: true }), messages()))
      .toBe('dependencyCard.detail.bundle')
    expect(resolveCardDetailText(state({ unconfigured: true }), messages()))
      .toBe('dependencyCard.detail.unconfigured')
  })

  it('uses registry status and update-specific messages', () => {
    expect(resolveCardDetailText(state({ hasError: true }), messages())).toBe('registry-status')
    expect(resolveCardDetailText(state({ hasData: false }), messages())).toBe('registry-status')
    expect(resolveCardDetailText(state({ updateCheckDisabled: true }), messages()))
      .toBe('dependencyCard.detail.checkDisabled')
    expect(resolveCardDetailText(state({ ignoredUpdate: true }), messages('ignored-by-policy')))
      .toBe('ignored-by-policy')
    expect(resolveCardDetailText(state({ updatable: true, latestVersion: '2.0.0' }), messages()))
      .toBe('dependencyCard.detail.foundUpdate:2.0.0')
  })
})
