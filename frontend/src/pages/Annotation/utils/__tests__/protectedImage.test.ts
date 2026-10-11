import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadProtectedImage } from '../protectedImage'

class FakeImage {
  static instances: FakeImage[] = []
  src = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { FakeImage.instances.push(this) }
}

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve))
const content = new Blob(['image'], { type: 'image/png' })

beforeEach(() => {
  FakeImage.instances = []
  vi.stubGlobal('window', { Image: FakeImage })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('protected image lifecycle', () => {
  it('retains the decoded image until consumer disposal and revokes exactly once', async () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    const dispose = loadProtectedImage(1, onLoad, onError, async () => content)
    await flush()
    const image = FakeImage.instances[0]
    expect(image.src).toBe('blob:private-image')
    image.onload!()
    expect(onLoad).toHaveBeenCalledWith(image)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    dispose()
    dispose()
    expect(image.src).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:private-image')
    expect(onError).not.toHaveBeenCalled()
  })

  it('aborts a pending request and ignores a response arriving after navigation', async () => {
    let resolve!: (blob: Blob) => void
    let signal: AbortSignal | undefined
    const onLoad = vi.fn()
    const onError = vi.fn()
    const dispose = loadProtectedImage(1, onLoad, onError, (_id, requestSignal) => {
      signal = requestSignal
      return new Promise<Blob>(done => { resolve = done })
    })
    dispose()
    expect(signal?.aborted).toBe(true)
    resolve(content)
    await flush()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(onLoad).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('suppresses an old decode callback after switching images', async () => {
    const oldLoaded = vi.fn()
    const newLoaded = vi.fn()
    const disposeOld = loadProtectedImage(1, oldLoaded, vi.fn(), async () => content)
    await flush()
    const oldCallback = FakeImage.instances[0].onload!
    disposeOld()
    const disposeNew = loadProtectedImage(2, newLoaded, vi.fn(), async () => content)
    await flush()
    oldCallback()
    FakeImage.instances[1].onload!()
    expect(oldLoaded).not.toHaveBeenCalled()
    expect(newLoaded).toHaveBeenCalledTimes(1)
    disposeNew()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('releases the URL on decode failure and reports the failure once', async () => {
    const onError = vi.fn()
    const dispose = loadProtectedImage(1, vi.fn(), onError, async () => content)
    await flush()
    const callback = FakeImage.instances[0].onerror!
    callback()
    callback()
    dispose()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('does not allocate a URL for a denied or failed request', async () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    const error = new Error('403')
    const dispose = loadProtectedImage(1, onLoad, onError, async () => { throw error })
    await flush()
    await flush()
    expect(onError).toHaveBeenCalledWith(error)
    expect(onLoad).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    dispose()
  })
})
