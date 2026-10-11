import { afterEach, describe, expect, it, vi } from 'vitest'
import apiClient from '../client'
import { imagesApi } from '../images'
import type { InternalAxiosRequestConfig } from 'axios'

const originalAdapter = apiClient.defaults.adapter

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  vi.unstubAllGlobals()
})

describe('authenticated image content', () => {
  it('uses the shared Bearer header and blob response without exposing credentials in the URL', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
    const blob = new Blob(['image bytes'], { type: 'image/png' })
    const requests: InternalAxiosRequestConfig[] = []
    apiClient.defaults.adapter = async config => {
      requests.push(config)
      return { data: blob, status: 200, statusText: 'OK', headers: {}, config }
    }
    const controller = new AbortController()
    expect(await imagesApi.content(42, controller.signal)).toBe(blob)
    expect(requests[0].url).toBe('/api/images/42/content')
    expect(requests[0].headers.Authorization).toBe('Bearer test-token')
    expect(requests[0].params).toBeUndefined()
    expect(requests[0].responseType).toBe('blob')
    expect(requests[0].signal).toBe(controller.signal)
  })

  it('rejects a denied response without retrying an anonymous static path', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
    const adapter = vi.fn(async () => {
      throw { response: { status: 403 } }
    })
    apiClient.defaults.adapter = adapter
    await expect(imagesApi.content(42)).rejects.toMatchObject({ response: { status: 403 } })
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(adapter.mock.calls[0]).toBeDefined()
  })
})
