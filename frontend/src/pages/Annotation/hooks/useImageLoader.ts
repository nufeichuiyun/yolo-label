import { useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import { message } from 'antd'
import { PRELOAD_COUNT, IMAGE_CACHE_MAX, IMAGE_LOAD_TIMEOUT } from '../utils/constants'
import type { ImageBounds, ImageCacheEntry } from '../types'
import { getImageBounds } from '../utils/coordinate'
import { Image } from '../../../api/images'

interface UseImageLoaderOptions {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>
  setCanvasSize: (cssWidth: number, cssHeight: number) => void
  onImageLoaded: (bounds: ImageBounds, originalWidth: number, originalHeight: number, scale: number) => void
  getApiBaseUrl: () => string
}

interface UseImageLoaderReturn {
  loadImage: (image: Image) => void
  preloadAdjacentImages: (currentIndex: number, imageList: Image[]) => void
  imageBoundsRef: React.MutableRefObject<ImageBounds | null>
  isLoadingRef: React.MutableRefObject<boolean>
  reset: () => void
}

function encodeImagePath(filepath: string, apiBaseUrl: string): string {
  const pathParts = filepath.split('/').filter(part => part)
  const encodedParts = pathParts.map(part => encodeURIComponent(part))
  return `${apiBaseUrl}/uploads/${encodedParts.join('/')}`
}

export function useImageLoader(options: UseImageLoaderOptions): UseImageLoaderReturn {
  const { canvasRef, setCanvasSize, onImageLoaded, getApiBaseUrl } = options

  const imageBoundsRef = useRef<ImageBounds | null>(null)
  const isLoadingRef = useRef(false)

  // LRU 图片预加载缓存
  const imageCache = useRef<Map<string, ImageCacheEntry>>(new Map())
  const accessOrder = useRef<string[]>([])

  const touchCache = useCallback((key: string) => {
    accessOrder.current = accessOrder.current.filter(k => k !== key)
    accessOrder.current.push(key)
  }, [])

  const evictIfNeeded = useCallback(() => {
    while (imageCache.current.size > IMAGE_CACHE_MAX && accessOrder.current.length > 0) {
      const oldest = accessOrder.current.shift()!
      const entry = imageCache.current.get(oldest)
      if (entry) {
        entry.element.src = ''  // 释放引用
        imageCache.current.delete(oldest)
      }
    }
  }, [])

  const preloadAdjacentImages = useCallback((currentIndex: number, imageList: Image[]) => {
    const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()

    for (let i = -PRELOAD_COUNT; i <= PRELOAD_COUNT; i++) {
      if (i === 0) continue
      const idx = currentIndex + i
      if (idx < 0 || idx >= imageList.length) continue
      const img = imageList[idx]
      const key = String(img.id)

      if (!imageCache.current.has(key)) {
        const el = new window.Image()
        el.crossOrigin = 'anonymous'
        el.onerror = () => imageCache.current.delete(key)
        el.src = encodeImagePath(img.filepath, apiBaseUrl)
        imageCache.current.set(key, { element: el, lastAccess: Date.now() })
        accessOrder.current.push(key)
      }
    }
    evictIfNeeded()
  }, [getApiBaseUrl, evictIfNeeded])

  const loadImage = useCallback((image: Image) => {
    const canvas = canvasRef.current
    if (!canvas) return

    isLoadingRef.current = true
    const key = String(image.id)
    const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()
    const imgUrl = encodeImagePath(image.filepath, apiBaseUrl)

    message.loading({ content: '正在加载图片...', key: 'loading-image' })
    const loadTimeout = setTimeout(() => {
      message.destroy('loading-image')
      message.error(`图片加载超时: ${image.filename}`, 5)
      isLoadingRef.current = false
    }, IMAGE_LOAD_TIMEOUT)

    // 检查缓存
    const cached = imageCache.current.get(key)
    if (cached && cached.element.complete && cached.element.naturalWidth > 0) {
      touchCache(key)
    }

    const loadingImageId = image.id
    ;(canvas as any)._currentImageId = loadingImageId

    fabric.Image.fromURL(imgUrl, (img) => {
      clearTimeout(loadTimeout)
      message.destroy('loading-image')

      if (!canvasRef.current || (canvasRef.current as any)._currentImageId !== loadingImageId) {
        isLoadingRef.current = false
        return
      }

      if (!img || !img.width || !img.height) {
        message.error(`图片加载失败: ${image.filename}`, 10)
        isLoadingRef.current = false
        return
      }

      const maxWidth = Math.min(window.innerWidth - 100, 1600)
      const maxHeight = Math.min(window.innerHeight - 200, 1000)
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1)

      const marginX = Math.max(50, img.width * scale * 0.05)
      const marginY = Math.max(50, img.height * scale * 0.05)
      const canvasWidth = img.width * scale + 2 * marginX
      const canvasHeight = img.height * scale + 2 * marginY

      setCanvasSize(canvasWidth, canvasHeight)

      // 清除旧的标注对象（canvas 复用）
      canvas.getObjects().forEach(obj => canvas.remove(obj))

      // 设置背景图
      canvas.setBackgroundImage(img, () => {
        canvas.renderAll()

        const bounds = getImageBounds(img)
        imageBoundsRef.current = bounds
        onImageLoaded(bounds, img.width!, img.height!, scale)
        isLoadingRef.current = false
      }, {
        left: marginX,
        top: marginY,
        scaleX: scale,
        scaleY: scale,
        crossOrigin: 'anonymous',
      } as any)
    }, { crossOrigin: 'anonymous' })
  }, [canvasRef, setCanvasSize, onImageLoaded, getApiBaseUrl, touchCache])

  const reset = useCallback(() => {
    imageBoundsRef.current = null
    isLoadingRef.current = false
  }, [])

  return {
    loadImage,
    preloadAdjacentImages,
    imageBoundsRef,
    isLoadingRef,
    reset,
  }
}
