import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

const root = resolve(import.meta.dirname, '..')
const errors = []

function report(message) {
  errors.push(message)
}

function flatten(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map([[prefix, value]])
  }
  const result = new Map()
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    for (const [childPath, childValue] of flatten(child, path)) {
      result.set(childPath, childValue)
    }
  }
  return result
}

function placeholders(value) {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort()
}

async function readYaml(relativePath) {
  const path = resolve(root, relativePath)
  try {
    return load(await readFile(path, 'utf8')) ?? {}
  } catch (error) {
    report(`${relativePath}: ${error.message}`)
    return {}
  }
}

async function checkLocalePair(relativePath, otherPath) {
  const [left, right] = await Promise.all([readYaml(relativePath), readYaml(otherPath)])
  const leftLeaves = flatten(left)
  const rightLeaves = flatten(right)
  const leftKeys = [...leftLeaves.keys()].sort()
  const rightKeys = [...rightLeaves.keys()].sort()
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
    const missingRight = leftKeys.filter((key) => !rightLeaves.has(key))
    const missingLeft = rightKeys.filter((key) => !leftLeaves.has(key))
    if (missingRight.length) report(`${otherPath} missing: ${missingRight.join(', ')}`)
    if (missingLeft.length) report(`${relativePath} missing: ${missingLeft.join(', ')}`)
  }
  for (const key of leftKeys) {
    if (!rightLeaves.has(key)) continue
    const leftPlaceholders = placeholders(leftLeaves.get(key))
    const rightPlaceholders = placeholders(rightLeaves.get(key))
    if (JSON.stringify(leftPlaceholders) !== JSON.stringify(rightPlaceholders)) {
      report(`${relativePath} and ${otherPath} placeholder mismatch at ${key}`)
    }
  }
}

async function checkClientLocales() {
  const namespaceByFile = {
    'common.yml': 'common',
    'dependencies.yml': 'dependencies',
    'market-page.yml': 'marketPage',
    'operations.yml': 'operations',
    'dependency-card.yml': 'dependencyCard',
    'extensions.yml': 'extensions',
    'bundle.yml': 'bundle',
    'environment.yml': 'environment',
    'market.yml': 'market',
  }
  const zhDir = resolve(root, 'client/i18n/zh-CN')
  const enDir = resolve(root, 'client/i18n/en-US')
  const [zhFiles, enFiles] = await Promise.all([readdir(zhDir), readdir(enDir)])
  const files = [...new Set([...zhFiles, ...enFiles])].filter((file) => file.endsWith('.yml')).sort()
  const index = await readFile(resolve(root, 'client/i18n/index.ts'), 'utf8')
  for (const file of files) {
    const namespace = namespaceByFile[file]
    if (!namespace) {
      report(`client/i18n/${file}: missing namespace mapping`)
      continue
    }
    const zhPath = `client/i18n/zh-CN/${file}`
    const enPath = `client/i18n/en-US/${file}`
    if (!zhFiles.includes(file)) report(`${zhPath} is missing`)
    if (!enFiles.includes(file)) report(`${enPath} is missing`)
    if (!index.includes(`./zh-CN/${file}`) || !index.includes(`./en-US/${file}`)) {
      report(`${file}: both locale imports must be registered in client/i18n/index.ts`)
    }
    if (!index.includes(`    ${namespace}:`)) {
      report(`${file}: namespace ${namespace} must be registered in client/i18n/index.ts`)
    }
    if (zhFiles.includes(file) && enFiles.includes(file)) await checkLocalePair(zhPath, enPath)
  }
}

async function checkNodeLocales() {
  for (const name of ['message.yml', 'schema.yml']) {
    await checkLocalePair(`src/node/locales/zh-CN/${name}`, `src/node/locales/en-US/${name}`)
  }
}

await Promise.all([checkClientLocales(), checkNodeLocales()])

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('i18n check passed')
}
