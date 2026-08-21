import { type Context, store } from '@koishijs/client'
import { requestEnsureConfig } from '../../market/api'

export interface ClientConfigWriter {
  get(name: string): any[] | undefined
  ensure(name: string, silent?: boolean): void
  remove(name: string): void
}

export function getConfigWriter(ctx: Context) {
  return ctx.get('configWriter') as ClientConfigWriter | undefined
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForInstalledPackage(name: string) {
  for (let index = 0; index < 40; index++) {
    if (store.packages?.[name]) return
    await sleep(250)
  }
}

async function waitForInstalledConfig(ctx: Context, name: string) {
  for (let index = 0; index < 40; index++) {
    if (getConfigWriter(ctx)?.get(name)?.length) return true
    await sleep(250)
  }
  return false
}

export async function ensureInstalledConfig(ctx: Context, name: string, silent = true) {
  if (!name || !getConfigWriter(ctx)) return
  await (requestEnsureConfig(name) ?? Promise.resolve(false)).catch(console.error)
  await waitForInstalledPackage(name)
  if (await waitForInstalledConfig(ctx, name)) return
  const configWriter = getConfigWriter(ctx)
  if (!configWriter || configWriter.get(name)?.length) return
  configWriter.ensure(name, silent)
}

export async function ensureInstalledConfigs(ctx: Context, names: string[], silent = true) {
  await Promise.all(names.map(name => ensureInstalledConfig(ctx, name, silent)))
}
