import type { SearchObject, User } from '@koishijs/registry'
import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

function md5Hex(input: string) {
  return bytesToHex(md5(utf8ToBytes(input)))
}

const usersCache = new WeakMap<SearchObject, User[]>()

export function getUsers(data: SearchObject) {
  const cached = usersCache.get(data)
  if (cached) return cached
  const result: Record<string, User> = {}
  for (const user of data.package.contributors ?? []) {
    const key = getUserKey(user)
    if (!key) continue
    result[key] ||= user
  }
  const users = !data.package.maintainers.some(user => result[getUserKey(user)])
    ? data.package.maintainers.map(user => ({
      ...user,
      name: user.name || user.username,
    }))
    : Object.values(result)
  usersCache.set(data, users)
  return users
}

export function getUserKey(user: User) {
  return user.email || user.username || user.name
}

export interface AvatarCandidate {
  url: string
  source: string
  cacheKey: string
}

function isHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isImageUrl(value?: string) {
  return !!value && /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value)
}

function normalizeHttpBase(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.origin}${path}`.replace(/\/+$/, '').replace(/\/avatar$/i, '')
  } catch {
    return ''
  }
}

function getGravatarBases(gravatar?: string) {
  const bases = [
    normalizeHttpBase(gravatar),
    'https://cravatar.cn',
    'https://www.cravatar.cn',
    'https://s.gravatar.com',
    'https://www.gravatar.com',
    'https://gravatar.com',
  ].filter(Boolean) as string[]
  return bases.filter((base, index) => bases.indexOf(base) === index)
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function getEmailHash(user: User) {
  if (!user.email) return ''
  return md5Hex(user.email.trim().toLowerCase())
}

export function normalizeAvatarUrl(url: string) {
  try {
    return new URL(url).toString()
  } catch {
    return url
  }
}

export function createAvatarUrlCacheKey(url: string) {
  return `url:${md5Hex(normalizeAvatarUrl(url))}`
}

function createGravatarUrls(hash: string, gravatar?: string) {
  if (!hash) return []
  const urls: string[] = []
  for (const base of getGravatarBases(gravatar)) {
    urls.push(`${base}/avatar/${hash}.png?d=404`)
  }
  return urls
}

function createNpmAvatarUrl(hash: string) {
  const upstream = `https://s.gravatar.com/avatar/${hash}.png?size=100&default=404`
  return `https://www.npmjs.com/npm-avatar/${toBase64Url(upstream)}`
}

function baseAvatarCandidates(user: User, gravatar?: string): AvatarCandidate[] {
  const hash = getEmailHash(user)
  const fallbackKey = hash
    ? `gravatar:${hash}`
    : `user:${md5Hex(getUserKey(user) || JSON.stringify(user) || 'anonymous')}`
  const candidates: AvatarCandidate[] = []
  const avatar = (user as User & { avatar?: string, url?: string }).avatar
  if (avatar?.trim() && (isHttpUrl(avatar) || avatar.trim().startsWith('data:'))) {
    const normalized = avatar.trim()
    candidates.push({ url: normalized, source: 'explicit', cacheKey: createAvatarUrlCacheKey(normalized) })
  }
  const url = (user as User & { avatar?: string, url?: string }).url
  if (isHttpUrl(url) && isImageUrl(url)) candidates.push({ url: url!, source: 'url', cacheKey: createAvatarUrlCacheKey(url!) })
  for (const url of createGravatarUrls(hash, gravatar)) {
    candidates.push({ url, source: 'gravatar', cacheKey: fallbackKey })
  }
  if (hash) {
    candidates.push({ url: createNpmAvatarUrl(hash), source: 'npm-avatar', cacheKey: fallbackKey })
  }
  return candidates.filter((candidate, index, array) => {
    return array.findIndex(item => item.url === candidate.url && item.cacheKey === candidate.cacheKey) === index
  })
}

export function getUserAvatarCandidates(user: User, gravatar?: string): AvatarCandidate[] {
  return baseAvatarCandidates(user, gravatar)
}
