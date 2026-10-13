import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from '../baseUrl'

describe('API 部署地址', () => {
  const location = { protocol: 'http:', hostname: 'example.test' }
  it('同源配置覆盖生产端口', () => expect(resolveApiBaseUrl('/', false, location)).toBe(''))
  it('保留分离部署兼容性', () => expect(resolveApiBaseUrl(undefined, false, location)).toBe('http://example.test:8000'))
  it('开发环境默认走代理', () => expect(resolveApiBaseUrl(undefined, true, location)).toBe(''))
  it('支持指定 HTTPS 地址', () => expect(resolveApiBaseUrl('https://api.example.test/', false, location)).toBe('https://api.example.test'))
})
