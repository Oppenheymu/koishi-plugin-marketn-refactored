/** 从任意错误值提取人类可读信息；无法提取时返回 undefined（install-flow 与 bundle 安装弹窗共用）。 */
export function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error || undefined
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; error?: unknown }
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
  }
  return undefined
}
