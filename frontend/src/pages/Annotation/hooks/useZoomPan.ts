import { useEffect, useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../utils/constants'

interface UseZoomPanOptions {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>
  isDrawingRef: React.MutableRefObject<boolean>         // 来自 useDrawing
  isDrawingPolygonRef: React.MutableRefObject<boolean>  // 来自 useDrawing
}

interface UseZoomPanReturn {
  isPanningRef: React.MutableRefObject<boolean>
  lastPanPointRef: React.MutableRefObject<{ x: number; y: number } | null>
  constrainImagePosition: (canvas: fabric.Canvas) => void
  reset: () => void
}

export function useZoomPan(options: UseZoomPanOptions): UseZoomPanReturn {
  const { canvasRef } = options
  const isPanningRef = useRef(false)
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * 约束图像位置，防止图像完全移出画布。
   * 直接复制原文件 3255-3299 逻辑。注意：bgImage.left 不乘以 zoom，
   * 因为 Fabric.js v5 的背景图 left/top 是固定 margin，不受视口变换影响。
   */
  const constrainImagePosition = useCallback((canvas: fabric.Canvas) => {
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height) return

    const zoom = canvas.getZoom()
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0]
    const canvasWidth = canvas.width || 0
    const canvasHeight = canvas.height || 0

    const bgImageWidth = bgImage.width * (bgImage.scaleX || 1)
    const bgImageHeight = bgImage.height * (bgImage.scaleY || 1)
    const imageDisplayWidth = bgImageWidth * zoom
    const imageDisplayHeight = bgImageHeight * zoom
    const bgImageLeft = bgImage.left || 0
    const bgImageTop = bgImage.top || 0

    // 图片在屏幕上的实际左上角：bgImageLeft * zoom + vpt[4]
    // （Fabric.js 中背景图的 left/top 会被 zoom 缩放）
    let imageScreenLeft = bgImageLeft * zoom + vpt[4]
    let imageScreenTop = bgImageTop * zoom + vpt[5]

    if (imageDisplayWidth <= canvasWidth) {
      // 图片比画布小，不允许移出画布
      imageScreenLeft = Math.max(0, Math.min(imageScreenLeft, canvasWidth - imageDisplayWidth))
    } else {
      // 图片比画布大，确保画布区域始终被图片覆盖
      imageScreenLeft = Math.min(0, Math.max(imageScreenLeft, canvasWidth - imageDisplayWidth))
    }

    if (imageDisplayHeight <= canvasHeight) {
      imageScreenTop = Math.max(0, Math.min(imageScreenTop, canvasHeight - imageDisplayHeight))
    } else {
      imageScreenTop = Math.min(0, Math.max(imageScreenTop, canvasHeight - imageDisplayHeight))
    }

    vpt[4] = imageScreenLeft - bgImageLeft * zoom
    vpt[5] = imageScreenTop - bgImageTop * zoom
    canvas.setViewportTransform(vpt)
  }, [])

  // 注册滚轮缩放
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseWheel = (opt: fabric.IEvent<WheelEvent>) => {
      const e = opt.e
      e.preventDefault()
      e.stopPropagation()

      // 绘制过程中禁止缩放
      if (options.isDrawingRef.current || options.isDrawingPolygonRef.current) return

      const delta = e.deltaY
      let zoom = canvas.getZoom()

      // 计算最小缩放
      const bgImage = canvas.backgroundImage as fabric.Image
      let minZoom = MIN_ZOOM
      if (bgImage && bgImage.width && bgImage.height) {
        const imgW = bgImage.width * (bgImage.scaleX || 1)
        const imgH = bgImage.height * (bgImage.scaleY || 1)
        const canvasEffW = canvas.getWidth() * 0.9
        const canvasEffH = canvas.getHeight() * 0.9
        minZoom = Math.max(canvasEffW / imgW, canvasEffH / imgH, MIN_ZOOM)
      }

      if (delta < 0) {
        zoom = Math.min(zoom + ZOOM_STEP, MAX_ZOOM)
      } else {
        zoom = Math.max(zoom - ZOOM_STEP, minZoom)
      }

      // 注意：使用 getPointer(e) 不带第二参数，与原文件一致
      const pointer = canvas.getPointer(e)
      canvas.zoomToPoint(new fabric.Point(pointer.x, pointer.y), zoom)
      constrainImagePosition(canvas)
    }

    canvas.on('mouse:wheel', handleMouseWheel as any)
    return () => {
      canvas.off('mouse:wheel', handleMouseWheel as any)
    }
  }, [canvasRef, constrainImagePosition])

  const reset = useCallback(() => {
    isPanningRef.current = false
    lastPanPointRef.current = null
    const canvas = canvasRef.current
    if (canvas) {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    }
  }, [canvasRef])

  return {
    isPanningRef,
    lastPanPointRef,
    constrainImagePosition,
    reset,
  }
}
