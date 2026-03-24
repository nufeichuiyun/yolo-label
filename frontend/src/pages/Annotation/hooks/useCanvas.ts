import { useEffect, useRef, useCallback, useState } from 'react'
import { fabric } from 'fabric'
import { CANVAS_INITIAL_WIDTH, CANVAS_INITIAL_HEIGHT, MIN_STROKE_WIDTH } from '../utils/constants'

interface UseCanvasOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>
}

interface UseCanvasReturn {
  canvas: fabric.Canvas | null
  dpr: number
  /** 更新 canvas CSS 尺寸和 backstore 尺寸。DPR 自动处理。 */
  setCanvasSize: (cssWidth: number, cssHeight: number) => void
  reset: () => void
}

/**
 * 监听 devicePixelRatio 变化（浏览器缩放时触发）。
 * 每次 DPR 变化后重新注册 listener（因为 query string 本身变了）。
 */
function watchDPR(callback: () => void): () => void {
  let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  const handler = () => {
    callback()
    mql.removeEventListener('change', handler)
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mql.addEventListener('change', handler)
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}

export function useCanvas({ canvasRef }: UseCanvasOptions): UseCanvasReturn {
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)

  const setCanvasSize = useCallback((cssWidth: number, cssHeight: number) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const currentDpr = window.devicePixelRatio || 1

    // CSS 尺寸（页面布局）
    canvas.setDimensions({ width: cssWidth, height: cssHeight })
    // Backstore 尺寸（物理像素，修复 DPR 偏移）
    canvas.setDimensions(
      { width: cssWidth * currentDpr, height: cssHeight * currentDpr },
      { backstoreOnly: true }
    )
  }, [])

  // 创建 canvas
  useEffect(() => {
    if (!canvasRef.current || fabricCanvasRef.current) return

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: CANVAS_INITIAL_WIDTH,
      height: CANVAS_INITIAL_HEIGHT,
      stopContextMenu: true,
      selection: true,
      uniformScaling: false,
    })

    // 初始 DPR 校准
    const currentDpr = window.devicePixelRatio || 1
    canvas.setDimensions(
      { width: CANVAS_INITIAL_WIDTH * currentDpr, height: CANVAS_INITIAL_HEIGHT * currentDpr },
      { backstoreOnly: true }
    )

    // before:render — 描边宽度按 zoom 反比
    canvas.on('before:render', () => {
      const zoom = canvas.getZoom() || 1
      canvas.getObjects().forEach((obj) => {
        if (obj.type === 'rect' || obj.type === 'polygon') {
          const base = (obj as any)._baseStrokeWidth ?? 2
          const newStrokeWidth = Math.max(MIN_STROKE_WIDTH, base / zoom)
          if (obj.type === 'rect') {
            obj.set({ strokeWidth: newStrokeWidth, strokeUniform: true, objectCaching: false } as any, false)
          } else {
            obj.set('strokeWidth', newStrokeWidth, false)
          }
          ;(obj as any)._baseStrokeWidth = base
        }
      })
    })

    fabricCanvasRef.current = canvas

    return () => {
      canvas.dispose()
      fabricCanvasRef.current = null
    }
  }, [canvasRef])

  // 监听 DPR 变化
  useEffect(() => {
    const cleanup = watchDPR(() => {
      const newDpr = window.devicePixelRatio || 1
      setDpr(newDpr)

      const canvas = fabricCanvasRef.current
      if (!canvas) return

      // 重新校准 backstore
      const cssWidth = canvas.getWidth()
      const cssHeight = canvas.getHeight()
      canvas.setDimensions(
        { width: cssWidth * newDpr, height: cssHeight * newDpr },
        { backstoreOnly: true }
      )
      canvas.renderAll()
    })

    return cleanup
  }, [])

  const reset = useCallback(() => {
    // canvas 实例持续存在，不需要重置
  }, [])

  return {
    canvas: fabricCanvasRef.current,
    dpr,
    setCanvasSize,
    reset,
  }
}
