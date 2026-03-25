import { useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import { message } from 'antd'
import type { Point, ImageBounds, DrawingMode } from '../types'
import {
  RECT_BASE_STROKE_WIDTH,
  POLYGON_BASE_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
} from '../utils/constants'
import { getImageBounds } from '../utils/coordinate'
import {
  clipPolygonToImageBounds,
  getLineImageBoundaryIntersection,
  isRectCompletelyOutsideImage,
  clipRectToImageBounds,
} from '../utils/clipping'
import type { Category } from '../../../api/categories'
import type { Project } from '../../../api/projects'

// ---------- Options ----------

interface UseDrawingOptions {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>
  /** 从外部传入的 refs，避免闭包问题 */
  categoriesRef: React.MutableRefObject<Category[]>
  selectedCategoryRef: React.MutableRefObject<number | null>
  projectRef: React.MutableRefObject<Project | null>
  /** 保存标注回调 */
  saveCurrentAnnotationsRef: React.MutableRefObject<(() => Promise<void>) | null>
  /** 选中顶点索引 ref（来自 useSelection） */
  selectedVertexIndexRef: React.MutableRefObject<number | null>
  /** 创建多边形控制点函数（来自 useSelection） */
  createPolygonControls: (
    polygon: fabric.Polygon,
    options: {
      canvas: fabric.Canvas
      categoryColor: string
      isSegmentation: boolean
      enableEdgeControls?: boolean
      selectedVertexIndexRef?: React.MutableRefObject<number | null>
      onModified?: () => void
      onRebuildControls?: (poly: fabric.Polygon) => void
    }
  ) => void
  /** 右键平移状态 ref（来自 useZoomPan） */
  isPanningRef: React.MutableRefObject<boolean>
}

// ---------- Return ----------

interface UseDrawingReturn {
  // --- Refs（供外部 hooks 读取状态） ---
  isDrawingRef: React.MutableRefObject<boolean>
  startPointRef: React.MutableRefObject<Point | null>
  rectRef: React.MutableRefObject<fabric.Rect | null>
  isDrawingPolygonRef: React.MutableRefObject<boolean>
  polygonPointsRef: React.MutableRefObject<Point[]>
  polygonRef: React.MutableRefObject<fabric.Polygon | null>
  polygonLineRef: React.MutableRefObject<fabric.Line | null>
  polygonPointMarkersRef: React.MutableRefObject<fabric.Circle[]>
  crosshairHLineRef: React.MutableRefObject<fabric.Line | null>
  crosshairVLineRef: React.MutableRefObject<fabric.Line | null>
  updateCrosshairNativeRef: React.MutableRefObject<((e: MouseEvent) => void) | null>
  crosshairUpdateRequestRef: React.MutableRefObject<number | null>

  // --- 函数 ---
  updatePreviewPolygon: () => void
  updatePointMarkers: () => void
  finishPolygonDrawing: () => void
  removeLastPolygonPoint: () => void
  cancelPolygonDrawing: () => void
  hideCrosshair: () => void
  /**
   * 更新十字辅助线位置（使用原生鼠标事件）。
   * 需要在 canvas 创建后被 setupCrosshair 初始化。
   */
  setupCrosshair: (canvas: fabric.Canvas) => void
  /**
   * 处理 mouse:move 中的绘制逻辑（矩形预览 + 多边形临时线段 + 预览）。
   * 由 index.tsx 在 canvas 的 mouse:move 事件中调用。
   */
  handleDrawingMouseMove: (e: fabric.IEvent<MouseEvent>) => void
  /**
   * 处理 mouse:down 中的绘制逻辑。
   * 由 index.tsx 在 canvas 的 mouse:down 事件中调用。
   * 返回 true 表示已处理（调用方不应继续）。
   */
  handleDrawingMouseDown: (e: fabric.IEvent<MouseEvent>, hadActiveAnnotation: boolean) => boolean
  /**
   * 处理 mouse:up 中的绘制逻辑（完成矩形等）。
   * 返回 true 表示已处理。
   */
  handleDrawingMouseUp: (e?: fabric.IEvent<MouseEvent>) => boolean
  /**
   * 双击完成多边形
   */
  handleDblClick: () => void
  /** 恢复十字线（取消选中时调用） */
  restoreCrosshairFromLastEvent: () => void
  /** 重置所有绘制状态 */
  reset: () => void
}

// ---------- Helper: 获取 ImageBounds ----------

function getBoundsFromCanvas(canvas: fabric.Canvas): ImageBounds | null {
  const bgImage = canvas.backgroundImage as fabric.Image
  if (!bgImage || !bgImage.width || !bgImage.height) return null
  return getImageBounds(bgImage)
}

// ========== Hook ==========

export function useDrawing(options: UseDrawingOptions): UseDrawingReturn {
  const {
    canvasRef,
    categoriesRef,
    selectedCategoryRef,
    projectRef,
    saveCurrentAnnotationsRef,
    selectedVertexIndexRef,
    createPolygonControls,
    isPanningRef,
  } = options

  // --- 矩形绘制 ---
  const isDrawingRef = useRef(false)
  const startPointRef = useRef<Point | null>(null)
  const rectRef = useRef<fabric.Rect | null>(null)

  // --- 多边形绘制 ---
  const isDrawingPolygonRef = useRef(false)
  const polygonPointsRef = useRef<Point[]>([])
  const polygonRef = useRef<fabric.Polygon | null>(null)
  const polygonLineRef = useRef<fabric.Line | null>(null)
  const polygonPointMarkersRef = useRef<fabric.Circle[]>([])

  // --- 十字辅助线 ---
  const crosshairHLineRef = useRef<fabric.Line | null>(null)
  const crosshairVLineRef = useRef<fabric.Line | null>(null)
  const updateCrosshairNativeRef = useRef<((e: MouseEvent) => void) | null>(null)
  const crosshairUpdateRequestRef = useRef<number | null>(null)
  // 存储最后一次鼠标事件
  const lastMouseEventRef = useRef<MouseEvent | null>(null)

  // ========== 辅助函数 ==========

  /** 获取类别颜色 */
  const getCategoryColor = useCallback((): string => {
    const categoryId = selectedCategoryRef.current
    const cats = categoriesRef.current
    if (!categoryId) return '#FF0000'
    return cats.find(c => c.id === categoryId)?.color || '#FF0000'
  }, [categoriesRef, selectedCategoryRef])

  /** 获取指定类别 ID 的颜色 */
  const getCategoryColorById = useCallback((categoryId: number): string => {
    return categoriesRef.current.find(c => c.id === categoryId)?.color || '#FF0000'
  }, [categoriesRef])

  /** 判断当前是否为实例分割模式 */
  const isSegmentation = useCallback((): boolean => {
    const proj = projectRef.current
    return (proj?.annotation_type || 'detection') === 'segmentation'
  }, [projectRef])

  /** 获取当前标注模式 */
  const getAnnotationType = useCallback((): DrawingMode => {
    const proj = projectRef.current
    return (proj?.annotation_type as DrawingMode) || 'detection'
  }, [projectRef])

  // ========== 十字辅助线 ==========

  const hideCrosshair = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (crosshairHLineRef.current) {
      canvas.remove(crosshairHLineRef.current)
      crosshairHLineRef.current = null
    }
    if (crosshairVLineRef.current) {
      canvas.remove(crosshairVLineRef.current)
      crosshairVLineRef.current = null
    }
    canvas.renderAll()
  }, [canvasRef])

  const setupCrosshair = useCallback((canvas: fabric.Canvas) => {
    const updateCrosshairNative = (e: MouseEvent) => {
      lastMouseEventRef.current = e

      if (crosshairUpdateRequestRef.current !== null) {
        cancelAnimationFrame(crosshairUpdateRequestRef.current)
      }

      crosshairUpdateRequestRef.current = requestAnimationFrame(() => {
        // 平移时不更新
        if (isPanningRef.current && e.buttons === 2) {
          return
        }

        // 有选中对象时隐藏（正在绘制的矩形除外）
        const activeObject = canvas.getActiveObject()
        if (activeObject && (activeObject.type === 'rect' || activeObject.type === 'polygon')) {
          if (isDrawingRef.current && rectRef.current && activeObject === rectRef.current) {
            // 正在绘制中，继续显示十字辅助线
          } else {
            hideCrosshair()
            crosshairUpdateRequestRef.current = null
            return
          }
        }

        if (!canvas || !canvas.backgroundImage) {
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }

        // 实例分割项目不显示十字线
        if (isSegmentation()) {
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }

        const bgImage = canvas.backgroundImage as fabric.Image

        let pointerX: number
        let pointerY: number
        try {
          const pointer = canvas.getPointer(e as any)
          pointerX = pointer.x
          pointerY = pointer.y
        } catch {
          const canvasElement = canvas.getElement()
          const rect = canvasElement.getBoundingClientRect()
          const scaleX = canvas.width! / rect.width
          const scaleY = canvas.height! / rect.height
          const x = (e.clientX - rect.left) * scaleX
          const y = (e.clientY - rect.top) * scaleY
          const vpt = canvas.viewportTransform
          if (vpt) {
            const invertedVpt = fabric.util.invertTransform(vpt)
            const transformed = fabric.util.transformPoint({ x, y }, invertedVpt)
            pointerX = transformed.x
            pointerY = transformed.y
          } else {
            pointerX = x
            pointerY = y
          }
        }

        // 图片边界
        const imageLeft = bgImage.left || 0
        const imageTop = bgImage.top || 0
        const imageWidth = bgImage.width! * (bgImage.scaleX || 1)
        const imageHeight = bgImage.height! * (bgImage.scaleY || 1)
        const imageRight = imageLeft + imageWidth
        const imageBottom = imageTop + imageHeight

        const isInsideImage = pointerX >= imageLeft && pointerX <= imageRight &&
                              pointerY >= imageTop && pointerY <= imageBottom

        if (!isInsideImage) {
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }

        // 横线
        const hLineY = Math.max(imageTop, Math.min(imageBottom, pointerY))

        if (crosshairHLineRef.current) {
          crosshairHLineRef.current.set({
            x1: imageLeft, y1: hLineY,
            x2: imageRight, y2: hLineY,
            stroke: '#333', strokeWidth: 2, strokeDashArray: [5, 5], opacity: 0.8,
          })
          crosshairHLineRef.current.setCoords()
        } else {
          const hLine = new fabric.Line([imageLeft, hLineY, imageRight, hLineY], {
            stroke: '#333', strokeWidth: 2, strokeDashArray: [5, 5], opacity: 0.8,
            selectable: false, evented: false, excludeFromExport: true,
          })
          canvas.add(hLine)
          crosshairHLineRef.current = hLine
        }

        // 竖线
        const vLineX = Math.max(imageLeft, Math.min(imageRight, pointerX))

        if (crosshairVLineRef.current) {
          crosshairVLineRef.current.set({
            x1: vLineX, y1: imageTop,
            x2: vLineX, y2: imageBottom,
            stroke: '#333', strokeWidth: 2, strokeDashArray: [5, 5], opacity: 0.8,
          })
          crosshairVLineRef.current.setCoords()
        } else {
          const vLine = new fabric.Line([vLineX, imageTop, vLineX, imageBottom], {
            stroke: '#333', strokeWidth: 2, strokeDashArray: [5, 5], opacity: 0.8,
            selectable: false, evented: false, excludeFromExport: true,
          })
          canvas.add(vLine)
          crosshairVLineRef.current = vLine
        }

        // 确保十字线在底层
        if (crosshairHLineRef.current) canvas.sendToBack(crosshairHLineRef.current)
        if (crosshairVLineRef.current) canvas.sendToBack(crosshairVLineRef.current)

        canvas.renderAll()
        crosshairUpdateRequestRef.current = null
      })
    }

    updateCrosshairNativeRef.current = updateCrosshairNative
  }, [canvasRef, hideCrosshair, isPanningRef, isSegmentation])

  // 提供给 selection:cleared 使用的恢复十字线函数
  const restoreCrosshairFromLastEvent = useCallback(() => {
    if (lastMouseEventRef.current && updateCrosshairNativeRef.current) {
      updateCrosshairNativeRef.current(lastMouseEventRef.current)
    }
  }, [])

  // ========== 多边形预览 ==========

  const updatePreviewPolygon = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !isDrawingPolygonRef.current || polygonPointsRef.current.length < 2) return

    const currentSelectedCategory = selectedCategoryRef.current
    if (!currentSelectedCategory) return

    const categoryColor = getCategoryColor()
    const points = polygonPointsRef.current

    const minX = Math.min(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    const localPoints = points.map(p => ({ x: p.x - minX, y: p.y - minY }))

    // 移除旧的预览多边形
    if (polygonRef.current) {
      canvas.remove(polygonRef.current)
      polygonRef.current = null
    }

    const previewPolygon = new fabric.Polygon(localPoints, {
      left: minX,
      top: minY,
      fill: 'rgba(255, 0, 0, 0.1)',
      stroke: categoryColor,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    })

    canvas.add(previewPolygon)
    polygonRef.current = previewPolygon
    canvas.renderAll()
  }, [canvasRef, selectedCategoryRef, getCategoryColor])

  const updatePointMarkers = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !isDrawingPolygonRef.current) return

    const currentSelectedCategory = selectedCategoryRef.current
    if (!currentSelectedCategory) return

    const categoryColor = getCategoryColor()
    const points = polygonPointsRef.current

    // 移除旧的顶点标记
    polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
    polygonPointMarkersRef.current = []

    // 为每个顶点创建标记
    const zoom = canvas.getZoom()
    const invZoom = 1 / zoom
    points.forEach(point => {
      const marker = new fabric.Circle({
        left: point.x,
        top: point.y,
        radius: 4,
        fill: categoryColor,
        stroke: '#fff',
        strokeWidth: 1,
        scaleX: invZoom,
        scaleY: invZoom,
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      })
      canvas.add(marker)
      polygonPointMarkersRef.current.push(marker)
    })

    canvas.renderAll()
  }, [canvasRef, selectedCategoryRef, getCategoryColor])

  // ========== 取消多边形 ==========

  const cancelPolygonDrawing = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (polygonRef.current) { canvas.remove(polygonRef.current); polygonRef.current = null }
    if (polygonLineRef.current) { canvas.remove(polygonLineRef.current); polygonLineRef.current = null }
    polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
    polygonPointMarkersRef.current = []

    isDrawingPolygonRef.current = false
    polygonPointsRef.current = []
    canvas.selection = true
    canvas.getObjects().forEach((obj: any) => { obj.selectable = true })
    canvas.renderAll()
  }, [canvasRef])

  // ========== 完成多边形 ==========

  const finishPolygonDrawing = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !isDrawingPolygonRef.current || polygonPointsRef.current.length < 3) return

    const bounds = getBoundsFromCanvas(canvas)
    if (!bounds) { cancelPolygonDrawing(); return }

    let points = [...polygonPointsRef.current]
    points = clipPolygonToImageBounds(points, bounds)

    if (points.length < 3) {
      message.warning('多边形与图片没有有效交集，请确保多边形与图片边界有交叉')
      cancelPolygonDrawing()
      return
    }

    const currentSelectedCategory = selectedCategoryRef.current
    if (!currentSelectedCategory) {
      message.warning('请先选择类别')
      cancelPolygonDrawing()
      return
    }

    const categoryColor = getCategoryColorById(currentSelectedCategory)
    const isSeg = isSegmentation()

    const minX = Math.min(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    const localPoints = points.map(p => ({ x: p.x - minX, y: p.y - minY }))

    // 移除预览对象
    if (polygonRef.current) { canvas.remove(polygonRef.current); polygonRef.current = null }
    if (polygonLineRef.current) { canvas.remove(polygonLineRef.current); polygonLineRef.current = null }
    polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
    polygonPointMarkersRef.current = []

    // 创建最终多边形
    const polygonBaseStroke = POLYGON_BASE_STROKE_WIDTH
    const polygon = new fabric.Polygon(localPoints, {
      left: minX,
      top: minY,
      fill: 'transparent',
      stroke: categoryColor,
      strokeWidth: Math.max(MIN_STROKE_WIDTH, polygonBaseStroke / (canvas.getZoom() || 1)),
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      lockUniScaling: true,
      lockMovementX: isSeg,
      lockMovementY: isSeg,
    })
    ;(polygon as any)._baseStrokeWidth = polygonBaseStroke

    const baseOpts = {
      canvas,
      categoryColor,
      isSegmentation: isSeg,
      enableEdgeControls: true,
      selectedVertexIndexRef,
      onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
    }
    createPolygonControls(polygon, {
      ...baseOpts,
      onRebuildControls: (poly: fabric.Polygon) => createPolygonControls(poly, baseOpts),
    })

    ;(polygon as any).categoryId = currentSelectedCategory

    canvas.add(polygon)
    canvas.renderAll()

    // 重置绘制状态
    isDrawingPolygonRef.current = false
    polygonPointsRef.current = []
    canvas.selection = true
    canvas.getObjects().forEach((obj: any) => { obj.selectable = true })

    // 自动保存
    if (saveCurrentAnnotationsRef.current) {
      saveCurrentAnnotationsRef.current().catch(error => {
        console.error('完成多边形绘制后保存失败:', error)
        message.error('保存标注失败，请手动保存')
      })
    } else {
      setTimeout(() => {
        if (saveCurrentAnnotationsRef.current) {
          saveCurrentAnnotationsRef.current().catch(error => {
            console.error('完成多边形绘制后保存失败:', error)
            message.error('保存标注失败，请手动保存')
          })
        }
      }, 100)
    }
  }, [
    canvasRef, selectedCategoryRef, getCategoryColorById, isSegmentation,
    cancelPolygonDrawing, createPolygonControls, selectedVertexIndexRef,
    saveCurrentAnnotationsRef,
  ])

  // ========== 删除最后一个多边形顶点 ==========

  const removeLastPolygonPoint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !isDrawingPolygonRef.current || polygonPointsRef.current.length === 0) return

    polygonPointsRef.current.pop()

    if (polygonPointsRef.current.length === 0) {
      // 直接调用 cancel 的逻辑
      if (polygonRef.current) { canvas.remove(polygonRef.current); polygonRef.current = null }
      if (polygonLineRef.current) { canvas.remove(polygonLineRef.current); polygonLineRef.current = null }
      polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
      polygonPointMarkersRef.current = []
      isDrawingPolygonRef.current = false
      canvas.selection = true
      canvas.getObjects().forEach((obj: any) => { obj.selectable = true })
      canvas.renderAll()
      return
    }

    // 移除旧的预览和标记
    if (polygonRef.current) { canvas.remove(polygonRef.current); polygonRef.current = null }
    if (polygonLineRef.current) { canvas.remove(polygonLineRef.current); polygonLineRef.current = null }
    polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
    polygonPointMarkersRef.current = []

    const categoryColor = getCategoryColor()
    const points = polygonPointsRef.current

    const zoom = canvas.getZoom()
    const invZoom = 1 / zoom
    if (points.length >= 2 && categoryColor) {
      const minX = Math.min(...points.map(p => p.x))
      const minY = Math.min(...points.map(p => p.y))
      const localPoints = points.map(p => ({ x: p.x - minX, y: p.y - minY }))

      const previewPolygon = new fabric.Polygon(localPoints, {
        left: minX, top: minY,
        fill: 'rgba(255, 0, 0, 0.1)',
        stroke: categoryColor, strokeWidth: 2,
        selectable: false, evented: false,
      })
      canvas.add(previewPolygon)
      polygonRef.current = previewPolygon

      points.forEach(point => {
        const marker = new fabric.Circle({
          left: point.x, top: point.y,
          radius: 4, fill: categoryColor, stroke: '#fff', strokeWidth: 1,
          scaleX: invZoom, scaleY: invZoom,
          selectable: false, evented: false, originX: 'center', originY: 'center',
        })
        canvas.add(marker)
        polygonPointMarkersRef.current.push(marker)
      })
    } else if (points.length === 1 && categoryColor) {
      const point = points[0]
      const marker = new fabric.Circle({
        left: point.x, top: point.y,
        radius: 4, fill: categoryColor, stroke: '#fff', strokeWidth: 1,
        scaleX: invZoom, scaleY: invZoom,
        selectable: false, evented: false, originX: 'center', originY: 'center',
      })
      canvas.add(marker)
      polygonPointMarkersRef.current.push(marker)
    }

    canvas.renderAll()
  }, [canvasRef, getCategoryColor])

  // ========== mouse:move 中的绘制逻辑 ==========

  const handleDrawingMouseMove = useCallback((e: fabric.IEvent<MouseEvent>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // 多边形临时线段 + 预览
    if (isDrawingPolygonRef.current && polygonPointsRef.current.length > 0) {
      const pointer = canvas.getPointer(e.e)
      const lastPoint = polygonPointsRef.current[polygonPointsRef.current.length - 1]

      if (polygonLineRef.current) {
        canvas.remove(polygonLineRef.current)
        polygonLineRef.current = null
      }

      const categoryColor = getCategoryColor()
      const line = new fabric.Line([lastPoint.x, lastPoint.y, pointer.x, pointer.y], {
        stroke: categoryColor, strokeWidth: 1, strokeDashArray: [5, 5],
        selectable: false, evented: false,
      })
      canvas.add(line)
      polygonLineRef.current = line

      // 更新预览多边形（包含鼠标当前位置）
      if (polygonPointsRef.current.length >= 2) {
        const tempPoints = [...polygonPointsRef.current, { x: pointer.x, y: pointer.y }]
        const minX = Math.min(...tempPoints.map(p => p.x))
        const minY = Math.min(...tempPoints.map(p => p.y))
        const localPoints = tempPoints.map(p => ({ x: p.x - minX, y: p.y - minY }))

        if (polygonRef.current) {
          canvas.remove(polygonRef.current)
          polygonRef.current = null
        }

        const previewPolygon = new fabric.Polygon(localPoints, {
          left: minX, top: minY,
          fill: 'rgba(255, 0, 0, 0.1)',
          stroke: categoryColor, strokeWidth: 2,
          selectable: false, evented: false,
        })
        canvas.add(previewPolygon)
        polygonRef.current = previewPolygon
      }

      canvas.renderAll()
      return
    }

    // 矩形预览
    if (!isDrawingRef.current || !startPointRef.current || !rectRef.current) return
    const pointer = canvas.getPointer(e.e)
    const width = Math.abs(pointer.x - startPointRef.current.x)
    const height = Math.abs(pointer.y - startPointRef.current.y)
    rectRef.current.set({
      width,
      height,
      left: Math.min(pointer.x, startPointRef.current.x),
      top: Math.min(pointer.y, startPointRef.current.y),
    })
    canvas.renderAll()
  }, [canvasRef, getCategoryColor])

  // ========== mouse:down 中的绘制逻辑 ==========

  const handleDrawingMouseDown = useCallback((
    e: fabric.IEvent<MouseEvent>,
    hadActiveAnnotation: boolean,
  ): boolean => {
    const canvas = canvasRef.current
    if (!canvas) return false

    // 如果正在绘制矩形，第二次点击完成画框
    if (isDrawingRef.current && startPointRef.current && rectRef.current) {
      const pointer = canvas.getPointer(e.e)
      const width = Math.abs(pointer.x - startPointRef.current.x)
      const height = Math.abs(pointer.y - startPointRef.current.y)
      rectRef.current.set({
        width, height,
        left: Math.min(pointer.x, startPointRef.current.x),
        top: Math.min(pointer.y, startPointRef.current.y),
      })
      canvas.renderAll()

      // 矩形太小则删除
      if (rectRef.current.width! < 5 || rectRef.current.height! < 5) {
        canvas.remove(rectRef.current)
        rectRef.current = null
      } else {
        rectRef.current.set({ selectable: true, evented: true })
        canvas.renderAll()

        // 裁剪矩形到图片边界内
        const annotationType = getAnnotationType()
        if (annotationType === 'detection' && rectRef.current) {
          const rect = rectRef.current
          const bounds = getBoundsFromCanvas(canvas)

          if (bounds) {
            if (isRectCompletelyOutsideImage(
              { left: rect.left || 0, top: rect.top || 0, width: rect.width || 0, height: rect.height || 0 },
              bounds
            )) {
              canvas.remove(rect)
              rectRef.current = null
              canvas.renderAll()
              isDrawingRef.current = false
              startPointRef.current = null
              canvas.selection = true
              return true
            }

            const clipped = clipRectToImageBounds(
              { left: rect.left || 0, top: rect.top || 0, width: (rect.width || 0) * (rect.scaleX || 1), height: (rect.height || 0) * (rect.scaleY || 1) },
              bounds
            )
            if (clipped) {
              const origLeft = rect.left || 0
              const origTop = rect.top || 0
              const origW = (rect.width || 0) * (rect.scaleX || 1)
              const origH = (rect.height || 0) * (rect.scaleY || 1)
              const needsClip = clipped.left > origLeft || clipped.top > origTop ||
                                clipped.width < origW || clipped.height < origH
              if (needsClip) {
                rect.set({
                  left: clipped.left, top: clipped.top,
                  width: clipped.width, height: clipped.height,
                  scaleX: 1, scaleY: 1, originX: 'left', originY: 'top',
                })
                rect.setCoords()
                canvas.renderAll()
              }
            }
          }
        }

        // 保存
        if (saveCurrentAnnotationsRef.current) {
          saveCurrentAnnotationsRef.current().catch(error => {
            console.error('完成矩形绘制后保存失败:', error)
          })
        } else {
          setTimeout(() => {
            saveCurrentAnnotationsRef.current?.().catch(error => {
              console.error('完成矩形绘制后保存失败:', error)
            })
          }, 100)
        }
      }

      // 恢复状态
      canvas.selection = true
      isDrawingRef.current = false
      startPointRef.current = null
      rectRef.current = null
      return true
    }

    // 正在绘制多边形 — 添加顶点
    if (isDrawingPolygonRef.current) {
      const pointer = canvas.getPointer(e.e)
      let newPoint = { x: pointer.x, y: pointer.y }

      // 如果不是第一个点，检查点击位置是否超出图片边界
      if (polygonPointsRef.current.length > 0) {
        const lastPoint = polygonPointsRef.current[polygonPointsRef.current.length - 1]
        const bounds = getBoundsFromCanvas(canvas)

        if (bounds) {
          const imgRect = {
            left: bounds.left,
            top: bounds.top,
            right: bounds.left + bounds.originalWidth * bounds.scaleX,
            bottom: bounds.top + bounds.originalHeight * bounds.scaleY,
          }
          const isOutside = newPoint.x < imgRect.left || newPoint.x > imgRect.right ||
                            newPoint.y < imgRect.top || newPoint.y > imgRect.bottom

          if (isOutside) {
            const intersection = getLineImageBoundaryIntersection(lastPoint, newPoint, bounds)
            if (intersection) {
              newPoint = intersection
            }
          }
        }
      }

      polygonPointsRef.current.push(newPoint)

      // 移除旧临时线段
      if (polygonLineRef.current) {
        canvas.remove(polygonLineRef.current)
        polygonLineRef.current = null
      }

      // 更新预览和标记
      if (polygonPointsRef.current.length >= 2) {
        updatePreviewPolygon()
        updatePointMarkers()
      } else {
        updatePointMarkers()
      }

      canvas.renderAll()
      return true
    }

    // 获取点击位置
    const pointer = canvas.getPointer(e.e)
    const annotationType = getAnnotationType()

    // 点击空白区域时，如果有选中的标注则取消选择
    if (!e.target || e.target === canvas.backgroundImage) {
      if (hadActiveAnnotation) {
        canvas.discardActiveObject()
        canvas.renderAll()
        return true
      }
    }

    // 检查是否点击了标注对象
    const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
    const objects = canvas.getObjects().filter((obj: fabric.Object) => annotationTypes.includes(obj.type!))
    let clickedObject: fabric.Object | null = null

    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i]
      if (obj.type === 'rect') {
        const rect = obj as fabric.Rect
        const rectLeft = rect.left || 0
        const rectTop = rect.top || 0
        const rectWidth = rect.width || 0
        const rectHeight = rect.height || 0
        if (pointer.x >= rectLeft && pointer.x <= rectLeft + rectWidth &&
            pointer.y >= rectTop && pointer.y <= rectTop + rectHeight) {
          clickedObject = rect
          break
        }
      } else if (obj.type === 'polygon') {
        const polygon = obj as fabric.Polygon
        if (polygon.containsPoint(pointer as any)) {
          clickedObject = polygon
          break
        }
      }
    }

    const target = canvas.findTarget(e.e, false) as fabric.Object | null
    const isTargetAnnotation = target && annotationTypes.includes(target.type!)

    const objectToSelect = clickedObject || (isTargetAnnotation ? target : null)
    if (objectToSelect) {
      canvas.selection = true
      objectToSelect.set({ selectable: true, evented: true })
      canvas.setActiveObject(objectToSelect)
      canvas.renderAll()
      return true
    }

    // 如果有选中标注，点击空白取消选择
    if (!clickedObject && !isTargetAnnotation && hadActiveAnnotation) {
      canvas.discardActiveObject()
      canvas.renderAll()
      return true
    }

    // 开始绘制
    const currentSelectedCategory = selectedCategoryRef.current
    if (currentSelectedCategory === null || currentSelectedCategory === undefined) {
      message.warning('请先选择类别')
      return true
    }

    if (annotationType === 'segmentation') {
      // 开始绘制多边形
      canvas.selection = false
      canvas.getObjects().forEach((obj: any) => { obj.selectable = false })
      isDrawingPolygonRef.current = true
      polygonPointsRef.current = [{ x: pointer.x, y: pointer.y }]

      const categoryColor = getCategoryColorById(currentSelectedCategory)
      const invZoom = 1 / canvas.getZoom()
      const firstMarker = new fabric.Circle({
        left: pointer.x, top: pointer.y,
        radius: 4, fill: categoryColor, stroke: '#fff', strokeWidth: 1,
        scaleX: invZoom, scaleY: invZoom,
        selectable: false, evented: false, originX: 'center', originY: 'center',
      })
      canvas.add(firstMarker)
      polygonPointMarkersRef.current.push(firstMarker)
      canvas.renderAll()
    } else {
      // 开始绘制矩形
      canvas.selection = false
      isDrawingRef.current = true
      startPointRef.current = { x: pointer.x, y: pointer.y }

      const categoryColor = getCategoryColorById(currentSelectedCategory)
      const rectBaseStroke = RECT_BASE_STROKE_WIDTH
      const rect = new fabric.Rect({
        left: pointer.x, top: pointer.y,
        width: 0, height: 0,
        fill: 'transparent',
        stroke: categoryColor,
        strokeWidth: Math.max(MIN_STROKE_WIDTH, rectBaseStroke / (canvas.getZoom() || 1)),
        strokeUniform: true,
        objectCaching: false,
        selectable: false, evented: false,
      })
      ;(rect as any)._baseStrokeWidth = rectBaseStroke

      // 重写 _setObjectScale 保持线宽
      const originalSetObjectScale = (rect as any)._setObjectScale
      if (originalSetObjectScale) {
        (rect as any)._setObjectScale = function(scaleX: number, scaleY: number, by: string) {
          const result = originalSetObjectScale.call(this, scaleX, scaleY, by)
          if (this.type === 'rect' && this.canvas) {
            const base = (this as any)._baseStrokeWidth ?? 2
            this.set({ strokeWidth: Math.max(MIN_STROKE_WIDTH, base / this.canvas.getZoom()), strokeUniform: true })
          }
          return result
        }
      }
      rect.set({ uniformScaling: false, lockUniScaling: false, lockRotation: true })
      ;(rect as any).categoryId = currentSelectedCategory
      canvas.add(rect)
      rectRef.current = rect
    }

    return true
  }, [
    canvasRef, selectedCategoryRef, getAnnotationType, getCategoryColorById,
    updatePreviewPolygon, updatePointMarkers, saveCurrentAnnotationsRef,
  ])

  // ========== mouse:up 中的绘制逻辑 ==========

  const handleDrawingMouseUp = useCallback((_e?: fabric.IEvent<MouseEvent>): boolean => {
    const canvas = canvasRef.current
    if (!canvas) return false

    // 如果正在绘制矩形（两次点击模式），鼠标抬起不做完成处理
    if (isDrawingRef.current) return true

    // 检查当前活动的矩形对象是否完全在图片外（移动或修改后松开鼠标时）
    const activeObject = canvas.getActiveObject()
    if (activeObject && activeObject.type === 'rect') {
      const rect = activeObject as fabric.Rect
      const annotationType = getAnnotationType()

      if (annotationType === 'detection') {
        const bounds = getBoundsFromCanvas(canvas)

        if (bounds) {
          const rectBounds = {
            left: rect.left || 0,
            top: rect.top || 0,
            width: (rect.width || 0) * (rect.scaleX || 1),
            height: (rect.height || 0) * (rect.scaleY || 1),
          }

          if (isRectCompletelyOutsideImage(rectBounds, bounds)) {
            const annotationId = (rect as any).annotationId
            canvas.remove(rect)
            canvas.renderAll()

            if (annotationId !== undefined && annotationId !== null) {
              saveCurrentAnnotationsRef.current?.().catch(error => {
                console.error('删除超出边界的矩形后保存失败:', error)
              })
            }
            return true
          }
        }
      }
    }

    return false
  }, [canvasRef, getAnnotationType, saveCurrentAnnotationsRef])

  // ========== 双击完成多边形 ==========

  const handleDblClick = useCallback(() => {
    if (isDrawingPolygonRef.current && polygonPointsRef.current.length >= 3) {
      finishPolygonDrawing()
    }
  }, [finishPolygonDrawing])

  // ========== 鼠标移出画布时隐藏十字线 ==========
  // （由 index.tsx 在 mouse:out 事件中调用 hideCrosshair）

  // ========== reset ==========

  const reset = useCallback(() => {
    const canvas = canvasRef.current

    // 清除矩形绘制状态
    if (canvas && rectRef.current) {
      canvas.remove(rectRef.current)
    }
    isDrawingRef.current = false
    startPointRef.current = null
    rectRef.current = null

    // 清除多边形绘制状态
    if (canvas) {
      if (polygonRef.current) canvas.remove(polygonRef.current)
      if (polygonLineRef.current) canvas.remove(polygonLineRef.current)
      polygonPointMarkersRef.current.forEach(marker => canvas.remove(marker))
    }
    isDrawingPolygonRef.current = false
    polygonPointsRef.current = []
    polygonRef.current = null
    polygonLineRef.current = null
    polygonPointMarkersRef.current = []

    // 清除十字辅助线
    if (canvas) {
      if (crosshairHLineRef.current) canvas.remove(crosshairHLineRef.current)
      if (crosshairVLineRef.current) canvas.remove(crosshairVLineRef.current)
    }
    crosshairHLineRef.current = null
    crosshairVLineRef.current = null
    if (crosshairUpdateRequestRef.current !== null) {
      cancelAnimationFrame(crosshairUpdateRequestRef.current)
      crosshairUpdateRequestRef.current = null
    }
  }, [canvasRef])

  return {
    // Refs
    isDrawingRef,
    startPointRef,
    rectRef,
    isDrawingPolygonRef,
    polygonPointsRef,
    polygonRef,
    polygonLineRef,
    polygonPointMarkersRef,
    crosshairHLineRef,
    crosshairVLineRef,
    updateCrosshairNativeRef,
    crosshairUpdateRequestRef,

    // 函数
    updatePreviewPolygon,
    updatePointMarkers,
    finishPolygonDrawing,
    removeLastPolygonPoint,
    cancelPolygonDrawing,
    hideCrosshair,
    setupCrosshair,
    handleDrawingMouseMove,
    handleDrawingMouseDown,
    handleDrawingMouseUp,
    handleDblClick,
    restoreCrosshairFromLastEvent,
    reset,
  }
}
