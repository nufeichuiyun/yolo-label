import { useRef, useCallback, useEffect } from 'react'
import { PRELOAD_COUNT, IMAGE_CACHE_MAX } from '../utils/constants'
import type { ImageBounds } from '../types'
import { imagesApi, Image } from '../../../api/images'

export function useImageLoader() {
  const imageBoundsRef = useRef<ImageBounds | null>(null)
  // Cache only authenticated responses, scoped to this mounted annotation page.
  const cache = useRef(new Map<number, Blob>())
  const pending = useRef(new Map<number, AbortController>())

  const getContent = useCallback(async (id: number, signal?: AbortSignal) => {
    const cached = cache.current.get(id)
    if (cached) {
      cache.current.delete(id)
      cache.current.set(id, cached)
      return cached
    }
    return imagesApi.content(id, signal)
  }, [])

  const preloadAdjacentImages = useCallback((currentIndex: number, imageList: Image[]) => {
    // Retire preloads from the previous image before starting the next batch.
    pending.current.forEach(controller => controller.abort())
    pending.current.clear()
    for (let offset = -PRELOAD_COUNT; offset <= PRELOAD_COUNT; offset++) {
      if (offset === 0) continue
      const image = imageList[currentIndex + offset]
      if (!image || cache.current.has(image.id)) continue
      const controller = new AbortController()
      pending.current.set(image.id, controller)
      void imagesApi.content(image.id, controller.signal).then(blob => {
        if (controller.signal.aborted) return
        cache.current.set(image.id, blob)
        while (cache.current.size > IMAGE_CACHE_MAX) {
          cache.current.delete(cache.current.keys().next().value!)
        }
      }).catch(() => {
        // A preload may fail permission checks; never fall back to a public path.
      }).finally(() => {
        if (pending.current.get(image.id) === controller) pending.current.delete(image.id)
      })
    }
  }, [])

  useEffect(() => () => {
    pending.current.forEach(controller => controller.abort())
    pending.current.clear()
    cache.current.clear()
  }, [])

  return { imageBoundsRef, getContent, preloadAdjacentImages }
}
