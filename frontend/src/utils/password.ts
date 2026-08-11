export function validatePassword(password?: string): Promise<void> {
  if (!password) {
    return Promise.resolve()
  }
  if (Array.from(password).length < 6) {
    return Promise.reject(new Error('密码至少需要 6 个字符'))
  }
  if (new TextEncoder().encode(password).length > 72) {
    return Promise.reject(new Error('密码的 UTF-8 编码不能超过 72 字节'))
  }
  return Promise.resolve()
}

export function getApiErrorMessage(error: any, fallback: string): string {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
    return detail[0].msg.replace(/^Value error,\s*/, '')
  }
  return fallback
}
