import { afterEach, describe, expect, it, vi } from 'vitest'
import apiClient from '../client'
import { modelsApi } from '../models'
import type { InternalAxiosRequestConfig } from 'axios'

const originalAdapter = apiClient.defaults.adapter

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  vi.unstubAllGlobals()
})

describe('read-only model classes', () => {
  it('uses authenticated GET without requesting model reparsing', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
    const requests: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = async config => {
      requests.push(config)
      return { data: { classes: ['cat', 'dog'] }, status: 200, statusText: 'OK', headers: {}, config }
    }
    expect(await modelsApi.getClasses(42)).toEqual({ classes: ['cat', 'dog'] })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('/api/models/42/classes')
    expect(requests[0].method).toBe('get')
    expect(requests[0].headers.Authorization).toBe('Bearer test-token')
    expect(requests[0].params).toBeUndefined()
  })

  it('preserves missing metadata and its guidance without retrying a parser', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
    const data = { classes: [], message: '请由可信超级管理员重新上传模型' }
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      data, status: 200, statusText: 'OK', headers: {}, config,
    }))
    apiClient.defaults.adapter = adapter
    expect(await modelsApi.getClasses(42)).toEqual(data)
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(adapter.mock.calls[0][0].params).toBeUndefined()
  })
})
