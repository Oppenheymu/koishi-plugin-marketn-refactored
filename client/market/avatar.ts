/**
 * @file 用户头像的候选生成、多源回退与前端缓存(market 域)。
 *
 * 模块职责:
 * - 为每个条目作者生成有序的头像候选列表:显式 avatar 字段 → 个人主页
 *  url(仅图片后缀)→ 各 gravatar 镜像(含用户自配的 cravatar 等国内源)
 *  → npm 官方头像代理,逐个回退直到一个能显示;
 * - 成功/失败双缓存:成功结果(base64)缓存 24h,失败的源缓存 10min,
 *  避免同一损坏 URL 反复请求;实际抓取经 market/avatar RPC 由服务端代理,
 *  绕过浏览器 CORS/防盗链限制。
 *
 * 关键设计:
 * - gravatar URL 带 d=404:头像不存在时返回 404 而非默认占位图,这样
 *  <img> 的 error 事件才能触发回退到下一候选;
 * - pendingAvatarRequests 按 cacheKey 单飞,并发渲染的同一头像只发一次请求;
 * - 失败缓存用 ref(响应式),写入后 UI 立即切换到下一候选。
 *
 * 消费方:package.vue(经 utils.ts 转出口)。
 */

import { send } from '@koishijs/client'
import type { User } from '@koishijs/registry'
import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { ref } from 'vue'
import { getUserKey } from './users'

/** 字符串 → md5 十六进制(gravatar 哈希与缓存 key 都用它)。 */
function md5Hex(input: string) {
  return bytesToHex(md5(utf8ToBytes(input)))
}

/** 单个头像候选:url 为实际地址,source 标识来源,cacheKey 对应缓存条目。 */
export interface AvatarCandidate {
  url: string
  source: string
  cacheKey: string
}

/** 是否合法的 http(s) 绝对地址。 */
function isHttpUrl(value?: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 是否以图片扩展名结尾(忽略 query/hash)。 */
function isImageUrl(value?: string) {
  return !!value && /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value)
}

/**
 * 把用户配置的 gravatar 地址归一成 API base:
 * 仅接受 http(s);去掉尾斜杠与多余的 /avatar 路径段。
 */
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

/**
 * gravatar base 列表:用户自配源最优先(通常是 cravatar 等可达镜像),
 * 之后是内置镜像与官方源;去重保序。
 */
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

/** 字符串 → base64url(无填充),用于 npm 头像代理的编码参数。 */
function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** gravatar 身份哈希:邮箱 trim + 小写后的 md5;无邮箱返回空串。 */
function getEmailHash(user: User) {
  if (!user.email) return ''
  return md5Hex(user.email.trim().toLowerCase())
}

/** 显式 URL 类候选的缓存 key:对归一化后的 URL 取 md5。 */
function createAvatarUrlCacheKey(url: string) {
  return `url:${md5Hex(normalizeAvatarUrl(url))}`
}

/**
 * 生成各 gravatar base 下的头像 URL。d=404 让"无头像"返回 404,
 * 从而触发 <img> onerror 进入下一候选,而不是显示陌生人占位图。
 */
function createGravatarUrls(hash: string, gravatar?: string) {
  if (!hash) return []
  const urls: string[] = []
  for (const base of getGravatarBases(gravatar)) {
    urls.push(`${base}/avatar/${hash}.png?d=404`)
  }
  return urls
}

/** npm 官方头像代理地址(把 s.gravatar.com 的请求包进 npmjs.com,借其缓存)。 */
function createNpmAvatarUrl(hash: string) {
  const upstream = `https://s.gravatar.com/avatar/${hash}.png?size=100&default=404`
  return `https://www.npmjs.com/npm-avatar/${toBase64Url(upstream)}`
}

/**
 * 组装某用户的完整候选链(顺序即回退顺序):
 * 1. manifest 里显式声明的 avatar(http(s) 或 data: URI);
 * 2. 个人主页 url,但仅当它本身是图片地址;
 * 3. 各 gravatar 镜像;
 * 4. npm 官方头像代理。
 * 最后按 url+cacheKey 去重。
 */
function baseAvatarCandidates(user: User, gravatar?: string): AvatarCandidate[] {
  const hash = getEmailHash(user)
  // gravatar 哈希候选共享的缓存 key;无邮箱时退化为 user key 的哈希
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

/** getUserAvatarCandidates 的导出版本(与 baseAvatarCandidates 等价)。 */
export function getUserAvatarCandidates(user: User, gravatar?: string): AvatarCandidate[] {
  return baseAvatarCandidates(user, gravatar)
}

/** 成功缓存条目:data 为 base64 正文,type 为 MIME,cachedAt 用于 TTL 判定。 */
type AvatarCacheEntry = {
  data: string
  type: string
  cachedAt: number
}

/** 失败缓存条目:只记时间,TTL 内不再尝试该源。 */
type AvatarFailureEntry = {
  failedAt: number
}

/** 成功缓存 TTL:24 小时。 */
const AVATAR_CACHE_TTL = 1000 * 60 * 60 * 24
/** 失败缓存 TTL:10 分钟(短暂记住坏源,过一会儿允许重试)。 */
const AVATAR_FAILURE_TTL = 1000 * 60 * 10
/** 两个缓存各自的最大条目数(超出按最新优先裁剪)。 */
const AVATAR_CACHE_MAX = 256
const AVATAR_FAILURE_MAX = 256
/** 成功缓存:普通对象(读取方都是命令式调用,无需响应式)。 */
const avatarCache: Record<string, AvatarCacheEntry> = {}
/** 失败缓存:ref 包裹,写入后依赖它的 computed 立即重算切到下一候选。 */
const avatarFailureCache = ref<Record<string, AvatarFailureEntry>>({})
/** 进行中的抓取任务,按 cacheKey 单飞去重。 */
const pendingAvatarRequests = new Map<string, Promise<string>>()

/** URL 归一化(补全协议相对地址等),失败原样返回。 */
function normalizeAvatarUrl(url: string) {
  try {
    return new URL(url).toString()
  } catch {
    return url
  }
}

/** 是否 data: 内联 URI(已自带内容,无需也不应走缓存/RPC)。 */
function isDataUrl(value: string) {
  return value.startsWith('data:')
}

/** 预留的持久化读取钩子(当前为空操作)。 */
function readAvatarCache() {
}

/**
 * 裁剪成功缓存:丢弃过期条目后按 cachedAt 从新到旧保留 AVATAR_CACHE_MAX 条。
 * 实现为先筛选排序得到白名单,再全量重建对象。
 */
function pruneAvatarCache() {
  const now = Date.now()
  const entries = Object.entries(avatarCache)
    .filter(([, entry]) => now - entry.cachedAt < AVATAR_CACHE_TTL)
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, AVATAR_CACHE_MAX)
  for (const key of Object.keys(avatarCache)) delete avatarCache[key]
  Object.assign(avatarCache, Object.fromEntries(entries))
}

/** 裁剪失败缓存:同 pruneAvatarCache,按 failedAt 从新到旧保留上限条数。 */
function pruneAvatarFailureCache() {
  const now = Date.now()
  avatarFailureCache.value = Object.fromEntries(Object.entries(avatarFailureCache.value)
    .filter(([, entry]) => now - entry.failedAt < AVATAR_FAILURE_TTL)
    .sort((a, b) => b[1].failedAt - a[1].failedAt)
    .slice(0, AVATAR_FAILURE_MAX))
}

/** 缓存 key 净化:非常规字符替换为 -,长度截到 128,空 key 退化为 md5。 */
function normalizeAvatarCacheKey(key: string) {
  return key.replace(/[^0-9A-Za-z:@._-]/g, '-').slice(0, 128) || createAvatarUrlCacheKey(key)
}

/** 写入成功缓存,同时清掉该 key 的失败标记并裁剪两个缓存。 */
function cacheAvatar(cacheKey: string, entry: AvatarCacheEntry) {
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  delete avatarFailureCache.value[key]
  avatarCache[key] = entry
  pruneAvatarCache()
  pruneAvatarFailureCache()
}

/** 记录一次抓取失败(data: URI 无失败语义,跳过)。 */
export function cacheAvatarFailure(cacheKey: string) {
  if (isDataUrl(cacheKey)) return
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  avatarFailureCache.value = {
    ...avatarFailureCache.value,
    [key]: { failedAt: Date.now() },
  }
  pruneAvatarFailureCache()
}

/** 某缓存 key 是否处于失败冷却期(过期条目顺手清除)。 */
export function isAvatarFailureCached(cacheKey: string) {
  if (isDataUrl(cacheKey)) return false
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarFailureCache.value[key]
  if (!entry) return false
  if (Date.now() - entry.failedAt >= AVATAR_FAILURE_TTL) {
    delete avatarFailureCache.value[key]
    return false
  }
  return true
}

/** 读成功缓存并拼成 data: URI;无缓存或已过期返回 undefined。 */
function getCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarCache[key]
  if (!entry) return
  if (Date.now() - entry.cachedAt >= AVATAR_CACHE_TTL) {
    delete avatarCache[key]
    return
  }
  return `data:${entry.type};base64,${entry.data}`
}

/** 沿候选链逐个查成功缓存,返回第一个命中(都不命中返回 undefined)。 */
export function getCachedAvatarFromCandidates(candidates: AvatarCandidate[]) {
  for (const candidate of candidates) {
    const cached = getCachedAvatar(candidate.cacheKey)
    if (cached) return cached
  }
}

/**
 * 抓取并缓存指定 URL 的头像:先查本地缓存与单飞表,都没命中才发
 * market/avatar RPC 让服务端代理抓取。成功写入缓存并返回 data: URI,
 * 失败按 cacheFailure 标记决定是否记录失败(浏览器已显示成功时传 false)。
 */
export async function fetchAndCacheAvatar(cacheKey: string, url: string, cacheFailure = true) {
  if (isDataUrl(url)) return url
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const sourceUrl = normalizeAvatarUrl(url)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pending = pendingAvatarRequests.get(key)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key, sourceUrl) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    if (cacheFailure) cacheAvatarFailure(key)
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(key)
  })
  pendingAvatarRequests.set(key, task)
  return task
}

/**
 * 只按 cacheKey 取头像(不带 url):服务端可能在自己那侧已有该 key 的
 * 缓存,RPC 会直接回放;适合空闲期"预水合"场景(package.vue 的
 * hydrateCachedAvatars)。失败不记录(留待真正渲染时再判定)。
 */
export async function fetchCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pendingKey = `cache:${key}`
  const pending = pendingAvatarRequests.get(pendingKey)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(pendingKey)
  })
  pendingAvatarRequests.set(pendingKey, task)
  return task
}
