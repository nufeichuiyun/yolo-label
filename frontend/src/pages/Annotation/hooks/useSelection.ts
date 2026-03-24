import { useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import type { Point, ImageBounds } from '../types'
import {
  VERTEX_HIT_RADIUS,
  EDGE_HIT_RADIUS,
  MIN_STROKE_WIDTH,
  RECT_BASE_STROKE_WIDTH,
  POLYGON_BASE_STROKE_WIDTH,
} from '../utils/constants'
import { getImageBounds } from '../utils/coordinate'
import {
  clipRectToImageBounds,
  clipPolygonToImageBounds,
  isRectCompletelyOutsideImage,
} from '../utils/clipping'
import type { Category } from '../../../api/categories'
import type { Project } from '../../../api/projects'

// ---------- Options ----------

interface UseSelectionOptions {
  categoriesRef: React.MutableRefObject<Category[]>
  projectRef: React.MutableRefObject<Project | null>
  saveCurrentAnnotationsRef: React.MutableRefObject<(() => Promise<void>) | null>
  /** 来自 useDrawing */
  isDrawingRef: React.MutableRefObject<boolean>
  /** 隐藏十字辅助线（来自 useDrawing） */
  hideCrosshair: () => void
  /** 恢复十字辅助线（selection:cleared 时调用） */
  restoreCrosshairFromLastEvent?: () => void
}

// ---------- Return ----------

interface UseSelectionReturn {
  hasActiveAnnotationRef: React.MutableRefObject<boolean>
  hasActivePolygonRef: React.MutableRefObject<boolean>
  selectedVertexIndexRef: React.MutableRefObject<number | null>

  /** 射线法点在多边形内检测 */
  isPointInPolygon: (point: Point, polygonPoints: Point[]) => boolean
  /**
   * 为多边形创建顶点和边控制点（支持拖拽顶点、边中点添加顶点）。
   * 增删顶点后需调用 onRebuildControls 重新应用控制点。
   * 也被 useAnnotations 的 drawExistingAnnotations 使用。
   */
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
  /**
   * 注册 selection / object 事件到 canvas。
   * 由 index.tsx 在 canvas 创建后调用。
   */
  bindSelectionEvents: (canvas: fabric.Canvas) => void
  /**
   * 处理多边形选中时的顶点/边点击检测（在 mouse:down 中调用）。
   * 返回 true 表示已处理（添加了顶点或选中了顶点）。
   */
  handlePolygonHitTest: (
    canvas: fabric.Canvas,
    polygon: fabric.Polygon,
    pointer: Point,
  ) => boolean
  /** 重置选择状态 */
  reset: () => void
}

// ---------- Helper ----------

function getBoundsFromCanvas(canvas: fabric.Canvas): ImageBounds | null {
  const bgImage = canvas.backgroundImage as fabric.Image
  if (!bgImage || !bgImage.width || !bgImage.height) return null
  return getImageBounds(bgImage)
}

function getAnnotationType(projectRef: React.MutableRefObject<Project | null>): string {
  return projectRef.current?.annotation_type || 'detection'
}

// ========== Hook ==========

export function useSelection(options: UseSelectionOptions): UseSelectionReturn {
  const {
    categoriesRef,
    projectRef,
    saveCurrentAnnotationsRef,
    isDrawingRef,
    hideCrosshair,
    restoreCrosshairFromLastEvent,
  } = options

  const hasActiveAnnotationRef = useRef(false)
  const hasActivePolygonRef = useRef(false)
  const selectedVertexIndexRef = useRef<number | null>(null)

  // ========== isPointInPolygon ==========

  const isPointInPolygon = useCallback((point: Point, polygonPoints: Point[]): boolean => {
    if (polygonPoints.length < 3) return false

    let inside = false
    const { x, y } = point

    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const xi = polygonPoints[i].x
      const yi = polygonPoints[i].y
      const xj = polygonPoints[j].x
      const yj = polygonPoints[j].y

      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
      if (intersect) inside = !inside
    }

    return inside
  }, [])

  // ========== createPolygonControls ==========

  const createPolygonControls = useCallback((
    polygon: fabric.Polygon,
    opts: {
      canvas: fabric.Canvas
      categoryColor: string
      isSegmentation: boolean
      enableEdgeControls?: boolean
      selectedVertexIndexRef?: React.MutableRefObject<number | null>
      onModified?: () => void
      onRebuildControls?: (poly: fabric.Polygon) => void
    }
  ) => {
    const {
      canvas,
      categoryColor,
      isSegmentation: _isSegmentation,
      enableEdgeControls = true,
      selectedVertexIndexRef: vertexIndexRef,
      onModified,
    } = opts
    void _isSegmentation // kept in opts signature for API compatibility

    polygon.controls = {}
    const polygonPoints = polygon.points || []

    // --- 顶点控制点 ---
    polygonPoints.forEach((_point: any, index: number) => {
      const controlName = `point${index}`
      const control = new fabric.Control({
        x: 0.5,
        y: 0.5,
        actionHandler: (_eventData: any, _transformData: any, x: number, y: number) => {
          // 限制到图片边界内
          const bgImage = canvas.backgroundImage as fabric.Image
          if (bgImage && bgImage.width && bgImage.height) {
            const imageLeft = bgImage.left || 0
            const imageTop = bgImage.top || 0
            const imageWidth = bgImage.width * (bgImage.scaleX || 1)
            const imageHeight = bgImage.height * (bgImage.scaleY || 1)
            x = Math.max(imageLeft, Math.min(imageLeft + imageWidth, x))
            y = Math.max(imageTop, Math.min(imageTop + imageHeight, y))
          }

          const transformMatrix = polygon.calcTransformMatrix()
          const localPoint = fabric.util.transformPoint(
            { x, y } as any,
            fabric.util.invertTransform(transformMatrix)
          )
          const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const pointX = localPoint.x + pathOffset.x
          const pointY = localPoint.y + pathOffset.y

          const polygonPointsArray = polygon.points || []
          const anchorIndex = index === 0 && polygonPointsArray.length > 1 ? 1 : 0
          const anchorPoint = polygonPointsArray[anchorIndex]
          if (!anchorPoint) return true

          const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const anchorLocalX = anchorPoint.x - oldPathOffset.x
          const anchorLocalY = anchorPoint.y - oldPathOffset.y
          const oldTransformMatrix = polygon.calcTransformMatrix()
          const anchorAbsolute = fabric.util.transformPoint(
            { x: anchorLocalX, y: anchorLocalY },
            oldTransformMatrix
          )

          if (polygonPointsArray[index]) {
            polygonPointsArray[index].x = pointX
            polygonPointsArray[index].y = pointY
          }
          polygon.set({ points: polygonPointsArray })
          polygon._setPositionDimensions({})
          ;(polygon as any).dirty = true
          if ((polygon as any)._setPath) delete (polygon as any)._setPath

          const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const newAnchorLocalX = anchorPoint.x - newPathOffset.x
          const newAnchorLocalY = anchorPoint.y - newPathOffset.y
          const newTransformMatrix = polygon.calcTransformMatrix()
          const newAnchorAbsolute = fabric.util.transformPoint(
            { x: newAnchorLocalX, y: newAnchorLocalY },
            newTransformMatrix
          )
          const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
          const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
          if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
            polygon.set({
              left: (polygon.left || 0) + deltaX,
              top: (polygon.top || 0) + deltaY,
            })
            polygon.setCoords()
          }
          polygon.setCoords()
          canvas.renderAll()
          onModified?.()
          return true
        },
        actionName: 'modifyPolygon',
        pointIndex: index,
        render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
          ctx.save()
          const isSelected = vertexIndexRef?.current === index
          ctx.fillStyle = categoryColor
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = isSelected ? 3 : 2
          const radius = isSelected ? 7 : 5
          ctx.beginPath()
          ctx.arc(left, top, radius, 0, 2 * Math.PI)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        },
        cursorStyle: 'move',
      })

      control.positionHandler = function(_dim: any, _finalMatrix: any, fabricObject: fabric.Object) {
        const poly = fabricObject as fabric.Polygon
        const pt = poly.points?.[index]
        if (!pt) return { x: 0, y: 0 }
        const pathOffset = (poly as any).pathOffset || { x: 0, y: 0 }
        const pointLocalX = pt.x - pathOffset.x
        const pointLocalY = pt.y - pathOffset.y
        const cvs = (fabricObject as any).canvas
        const vpt = cvs?.viewportTransform
        const objMatrix = (fabricObject as fabric.Polygon).calcTransformMatrix()
        const screenMatrix = (vpt && vpt.length >= 6 && fabric.util.multiplyTransformMatrices)
          ? fabric.util.multiplyTransformMatrices(vpt, objMatrix)
          : objMatrix
        return fabric.util.transformPoint({ x: pointLocalX, y: pointLocalY }, screenMatrix)
      }

      polygon.controls[controlName] = control
    })

    // --- 边中点控制点（用于添加顶点） ---
    if (enableEdgeControls && polygonPoints.length >= 3) {
      polygonPoints.forEach((_point: any, index: number) => {
        const nextIndex = (index + 1) % polygonPoints.length
        const p1 = polygonPoints[index]
        const p2 = polygonPoints[nextIndex]
        if (!p1 || !p2) return

        const controlName = `edge${index}`
        const control = new fabric.Control({
          x: 0.5,
          y: 0.5,
          actionHandler: () => true,
          actionName: 'addPolygonVertex',
          render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
            ctx.save()
            ctx.fillStyle = '#fff'
            ctx.strokeStyle = categoryColor
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(left, top, 4, 0, 2 * Math.PI)
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          },
          cursorStyle: 'crosshair',
        })

        control.positionHandler = function(_dim: any, _finalMatrix: any, fabricObject: fabric.Object) {
          const poly = fabricObject as fabric.Polygon
          const pts = poly.points || []
          const pA = pts[index]
          const pB = pts[nextIndex]
          if (!pA || !pB) return { x: 0, y: 0 }
          const pathOffset = (poly as any).pathOffset || { x: 0, y: 0 }
          const midX = (pA.x + pB.x) / 2 - pathOffset.x
          const midY = (pA.y + pB.y) / 2 - pathOffset.y
          const cvs = (fabricObject as any).canvas
          const vpt = cvs?.viewportTransform
          const objMatrix = (fabricObject as fabric.Polygon).calcTransformMatrix()
          const screenMatrix = (vpt && vpt.length >= 6 && fabric.util.multiplyTransformMatrices)
            ? fabric.util.multiplyTransformMatrices(vpt, objMatrix)
            : objMatrix
          return fabric.util.transformPoint({ x: midX, y: midY }, screenMatrix)
        }

        polygon.controls[controlName] = control
      })
    }

    // 重写 containsPoint 使用射线法
    polygon.containsPoint = function(point: fabric.Point): boolean {
      const pts = this.points || []
      if (pts.length < 3) return false
      const po = (this as any).pathOffset || { x: 0, y: 0 }
      const tm = this.calcTransformMatrix()
      const canvasPts = pts.map((p: any) => {
        const px = p.x - po.x
        const py = p.y - po.y
        return fabric.util.transformPoint({ x: px, y: py }, tm)
      })
      return isPointInPolygon(point, canvasPts)
    }
  }, [isPointInPolygon])

  // ========== 处理选中样式（selection:created / selection:updated 的通用逻辑） ==========

  const applySelectionStyle = useCallback((
    canvas: fabric.Canvas,
    activeObject: fabric.Object,
  ) => {
    hideCrosshair()
    const zoom = canvas.getZoom() || 1

    if (activeObject.type === 'rect') {
      hasActiveAnnotationRef.current = true
      const base = (activeObject as any)._baseStrokeWidth ?? RECT_BASE_STROKE_WIDTH
      activeObject.set({
        uniformScaling: false,
        lockUniScaling: false,
        lockRotation: true,
        strokeWidth: Math.max(MIN_STROKE_WIDTH, base / zoom),
        strokeUniform: true,
        objectCaching: false,
        cornerColor: '#1890ff',
        cornerStrokeColor: '#ffffff',
        cornerSize: 12,
        transparentCorners: false,
      })
      ;(activeObject as any)._baseStrokeWidth = base
      // 隐藏旋转锚点
      activeObject.controls = {
        ...(activeObject.controls || {}),
        mtr: new fabric.Control({ visible: false }),
      }
    } else if (activeObject.type === 'polygon') {
      const polygon = activeObject as fabric.Polygon
      hasActivePolygonRef.current = true
      hasActiveAnnotationRef.current = true

      const polyBase = (polygon as any)._baseStrokeWidth ?? POLYGON_BASE_STROKE_WIDTH
      const isSeg = getAnnotationType(projectRef) === 'segmentation'

      polygon.set({
        strokeWidth: Math.max(MIN_STROKE_WIDTH, polyBase / zoom),
        hasControls: true,
        hasBorders: false,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        lockUniScaling: true,
        lockMovementX: isSeg,
        lockMovementY: isSeg,
      })
      ;(polygon as any)._baseStrokeWidth = polyBase

      const selCategoryColor = (polygon as any).categoryId
        ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
        : '#FF0000'

      const selBaseOpts = {
        canvas,
        categoryColor: selCategoryColor,
        isSegmentation: isSeg,
        enableEdgeControls: true,
        selectedVertexIndexRef,
        onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
      }
      createPolygonControls(polygon, {
        ...selBaseOpts,
        onRebuildControls: (poly) => createPolygonControls(poly, selBaseOpts),
      })
    }

    canvas.renderAll()
  }, [
    hideCrosshair, projectRef, categoriesRef,
    createPolygonControls, selectedVertexIndexRef, saveCurrentAnnotationsRef,
  ])

  // ========== bindSelectionEvents ==========

  const bindSelectionEvents = useCallback((canvas: fabric.Canvas) => {
    // selection:created
    canvas.on('selection:created', (e: fabric.IEvent<MouseEvent>) => {
      if (isDrawingRef.current) return
      const activeObject = (e as any).selected?.[0] || canvas.getActiveObject()
      if (activeObject) applySelectionStyle(canvas, activeObject)
    })

    // selection:cleared
    canvas.on('selection:cleared', () => {
      setTimeout(() => {
        hasActivePolygonRef.current = false
        hasActiveAnnotationRef.current = false
        selectedVertexIndexRef.current = null
        restoreCrosshairFromLastEvent?.()
      }, 0)
    })

    // selection:updated
    canvas.on('selection:updated', (e: fabric.IEvent<MouseEvent>) => {
      if (isDrawingRef.current) return
      const activeObject = (e as any).selected?.[0] || canvas.getActiveObject()
      if (activeObject) applySelectionStyle(canvas, activeObject)
    })

    // object:scaling
    canvas.on('object:scaling', (e: fabric.IEvent<MouseEvent>) => {
      const obj = e.target
      if (obj && obj.type === 'rect' && obj.canvas) {
        const rect = obj as fabric.Rect
        const base = (rect as any)._baseStrokeWidth ?? RECT_BASE_STROKE_WIDTH
        rect.set({
          strokeWidth: Math.max(MIN_STROKE_WIDTH, base / obj.canvas.getZoom()),
          strokeUniform: true,
        }, false)
        rect.setCoords()
      }
    })

    // object:moving
    canvas.on('object:moving', (e: fabric.IEvent<MouseEvent>) => {
      const obj = e.target
      if (obj && obj.type === 'rect' && obj.canvas) {
        const rect = obj as fabric.Rect
        const base = (rect as any)._baseStrokeWidth ?? RECT_BASE_STROKE_WIDTH
        const want = Math.max(MIN_STROKE_WIDTH, base / obj.canvas.getZoom())
        if (Math.abs((rect.strokeWidth || 0) - want) > 0.01 || !rect.strokeUniform) {
          rect.set({ strokeWidth: want, strokeUniform: true })
        }
      }
    })

    // object:modified
    canvas.on('object:modified', (e: fabric.IEvent<MouseEvent>) => {
      const obj = e.target
      if (!obj) return

      if (obj.type === 'rect' && obj.canvas) {
        handleRectModified(canvas, obj as fabric.Rect)
        return
      }

      if (obj.type === 'polygon') {
        handlePolygonModified(canvas, obj as fabric.Polygon)
      }
    })
  }, [applySelectionStyle, isDrawingRef, restoreCrosshairFromLastEvent])

  // ========== object:modified — rect ==========

  const handleRectModified = useCallback((canvas: fabric.Canvas, rect: fabric.Rect) => {
    const base = (rect as any)._baseStrokeWidth ?? RECT_BASE_STROKE_WIDTH
    rect.set({
      strokeWidth: Math.max(MIN_STROKE_WIDTH, base / canvas.getZoom()),
      strokeUniform: true,
    })

    // 规范化矩形
    const scaleX = rect.scaleX || 1
    const scaleY = rect.scaleY || 1
    const originX = rect.originX || 'left'
    const originY = rect.originY || 'top'
    const baseWidth = rect.width || 0
    const baseHeight = rect.height || 0
    const displayWidth = baseWidth * scaleX
    const displayHeight = baseHeight * scaleY

    let actualLeft = rect.left || 0
    let actualTop = rect.top || 0

    if (originX === 'center') actualLeft -= displayWidth / 2
    else if (originX === 'right') actualLeft -= displayWidth
    if (originY === 'center') actualTop -= displayHeight / 2
    else if (originY === 'bottom') actualTop -= displayHeight

    const needsNormalize = displayWidth < 0 || displayHeight < 0

    if (needsNormalize) {
      let normalizedLeft = actualLeft
      let normalizedTop = actualTop
      let normalizedWidth = displayWidth
      let normalizedHeight = displayHeight

      if (normalizedWidth < 0) { normalizedLeft += normalizedWidth; normalizedWidth = Math.abs(normalizedWidth) }
      if (normalizedHeight < 0) { normalizedTop += normalizedHeight; normalizedHeight = Math.abs(normalizedHeight) }

      rect.set({
        left: normalizedLeft, top: normalizedTop,
        width: normalizedWidth, height: normalizedHeight,
        scaleX: 1, scaleY: 1, originX: 'left', originY: 'top',
      })
      rect.setCoords()
      canvas.renderAll()

      // 重新计算显示坐标
      actualLeft = normalizedLeft
      actualTop = normalizedTop
    }

    // 只在目标检测模式下裁剪
    const annotationType = getAnnotationType(projectRef)
    if (annotationType !== 'detection') {
      const annotationId = (rect as any).annotationId
      if (annotationId !== undefined && annotationId !== null) {
        saveCurrentAnnotationsRef.current?.().catch(error => {
          console.error('矩形修改后保存失败:', error)
        })
      }
      return
    }

    const bounds = getBoundsFromCanvas(canvas)
    if (!bounds) return

    // 获取规范化后的矩形边界
    const rectScaleX = rect.scaleX || 1
    const rectScaleY = rect.scaleY || 1
    const rectDisplayW = (rect.width || 0) * rectScaleX
    const rectDisplayH = (rect.height || 0) * rectScaleY
    let rectLeft = rect.left || 0
    let rectTop = rect.top || 0

    const rectOriginX = rect.originX || 'left'
    const rectOriginY = rect.originY || 'top'
    if (rectOriginX === 'center') rectLeft -= rectDisplayW / 2
    else if (rectOriginX === 'right') rectLeft -= rectDisplayW
    if (rectOriginY === 'center') rectTop -= rectDisplayH / 2
    else if (rectOriginY === 'bottom') rectTop -= rectDisplayH

    const rectBounds = { left: rectLeft, top: rectTop, width: rectDisplayW, height: rectDisplayH }

    // 检查完全超出
    if (isRectCompletelyOutsideImage(rectBounds, bounds)) {
      const annotationId = (rect as any).annotationId
      canvas.remove(rect)
      canvas.renderAll()

      if (annotationId !== undefined && annotationId !== null) {
        saveCurrentAnnotationsRef.current?.().catch(error => {
          console.error('删除超出边界的矩形后保存失败:', error)
        })
      }
      return
    }

    // 裁剪
    const clipped = clipRectToImageBounds(rectBounds, bounds)
    if (clipped) {
      const needsClip = clipped.left > rectBounds.left || clipped.top > rectBounds.top ||
                        clipped.width < rectBounds.width || clipped.height < rectBounds.height
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

    // 保存
    const annotationId = (rect as any).annotationId
    if (annotationId !== undefined && annotationId !== null) {
      saveCurrentAnnotationsRef.current?.().catch(error => {
        console.error('矩形修改后保存失败:', error)
      })
    }
  }, [projectRef, saveCurrentAnnotationsRef])

  // ========== object:modified — polygon ==========

  const handlePolygonModified = useCallback((canvas: fabric.Canvas, polygon: fabric.Polygon) => {
    const points = polygon.points || []
    if (points.length < 3) return

    const bounds = getBoundsFromCanvas(canvas)
    if (!bounds) {
      saveCurrentAnnotationsRef.current?.().catch(error => {
        console.error('多边形修改后保存失败:', error)
      })
      return
    }

    const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
    const transformMatrix = polygon.calcTransformMatrix()

    const canvasPoints = points.map((point: any) => {
      const pointLocalX = point.x - pathOffset.x
      const pointLocalY = point.y - pathOffset.y
      return fabric.util.transformPoint(
        { x: pointLocalX, y: pointLocalY },
        transformMatrix
      )
    })

    // 检查是否有顶点在图像边界外（需要裁剪）
    const imgRect = {
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.originalWidth * bounds.scaleX,
      bottom: bounds.top + bounds.originalHeight * bounds.scaleY,
    }
    const hasOutOfBounds = canvasPoints.some(p =>
      p.x < imgRect.left - 0.5 || p.x > imgRect.right + 0.5 ||
      p.y < imgRect.top - 0.5 || p.y > imgRect.bottom + 0.5
    )

    if (!hasOutOfBounds) {
      // 所有点都在边界内，直接保存，不做裁剪重建
      saveCurrentAnnotationsRef.current?.().catch(error => {
        console.error('多边形修改后保存失败:', error)
      })
      return
    }

    const clippedCanvasPoints = clipPolygonToImageBounds(canvasPoints, bounds)

    if (clippedCanvasPoints.length < 3) {
      console.warn('多边形裁剪后点数不足，保持原样')
      saveCurrentAnnotationsRef.current?.().catch(error => {
        console.error('多边形修改后保存失败:', error)
      })
      return
    }

    const pointsChanged = true // 已确认有越界点，裁剪后一定有变化

    if (pointsChanged) {
      const invertedMatrix = fabric.util.invertTransform(transformMatrix)
      const clippedLocalPoints = clippedCanvasPoints.map(canvasPoint => {
        const localPoint = fabric.util.transformPoint(canvasPoint, invertedMatrix)
        return { x: localPoint.x + pathOffset.x, y: localPoint.y + pathOffset.y }
      })

      polygon.set({ points: clippedLocalPoints })
      polygon._setPositionDimensions({})
      ;(polygon as any).dirty = true
      if ((polygon as any)._setPath) delete (polygon as any)._setPath

      const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }

      if (Math.abs(newPathOffset.x - pathOffset.x) > 0.001 ||
          Math.abs(newPathOffset.y - pathOffset.y) > 0.001) {
        // 保持多边形绝对位置不变
        const firstPointOld = points[0]
        const firstPointOldLocalX = firstPointOld.x - pathOffset.x
        const firstPointOldLocalY = firstPointOld.y - pathOffset.y
        const firstPointOldAbsolute = fabric.util.transformPoint(
          { x: firstPointOldLocalX, y: firstPointOldLocalY },
          transformMatrix
        )

        const firstPointNew = clippedLocalPoints[0]
        const firstPointNewLocalX = firstPointNew.x - newPathOffset.x
        const firstPointNewLocalY = firstPointNew.y - newPathOffset.y
        const newTransformMatrix = polygon.calcTransformMatrix()
        const firstPointNewAbsolute = fabric.util.transformPoint(
          { x: firstPointNewLocalX, y: firstPointNewLocalY },
          newTransformMatrix
        )

        const adjustDeltaX = firstPointOldAbsolute.x - firstPointNewAbsolute.x
        const adjustDeltaY = firstPointOldAbsolute.y - firstPointNewAbsolute.y

        if (Math.abs(adjustDeltaX) > 0.001 || Math.abs(adjustDeltaY) > 0.001) {
          polygon.set({
            left: (polygon.left || 0) + adjustDeltaX,
            top: (polygon.top || 0) + adjustDeltaY,
          })
        }
      }

      polygon.setCoords()
      canvas.renderAll()
    }

    saveCurrentAnnotationsRef.current?.().catch(error => {
      console.error('多边形修改后保存失败:', error)
    })
  }, [saveCurrentAnnotationsRef])

  // ========== handlePolygonHitTest ==========

  const handlePolygonHitTest = useCallback((
    canvas: fabric.Canvas,
    polygon: fabric.Polygon,
    pointer: Point,
  ): boolean => {
    const points = polygon.points || []
    const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
    const transformMatrix = polygon.calcTransformMatrix()
    const zoom = canvas.getZoom() || 1
    const vertexHitRadius = VERTEX_HIT_RADIUS / zoom
    const edgeHitRadius = EDGE_HIT_RADIUS / zoom
    const VERTEX_CLOSE_THRESHOLD = 10 / zoom

    // 先检查边（添加顶点）
    let hitEdge: number | null = null
    let hitVertex: number | null = null

    if (points.length >= 3) {
      for (let i = 0; i < points.length; i++) {
        const nextI = (i + 1) % points.length
        const p1 = points[i]
        const p2 = points[nextI]
        const local1 = { x: p1.x - pathOffset.x, y: p1.y - pathOffset.y }
        const local2 = { x: p2.x - pathOffset.x, y: p2.y - pathOffset.y }
        const canvas1 = fabric.util.transformPoint(local1, transformMatrix)
        const canvas2 = fabric.util.transformPoint(local2, transformMatrix)
        const distToP1 = Math.sqrt((pointer.x - canvas1.x) ** 2 + (pointer.y - canvas1.y) ** 2)
        const distToP2 = Math.sqrt((pointer.x - canvas2.x) ** 2 + (pointer.y - canvas2.y) ** 2)
        if (distToP1 < VERTEX_CLOSE_THRESHOLD || distToP2 < VERTEX_CLOSE_THRESHOLD) continue

        const segDx = canvas2.x - canvas1.x
        const segDy = canvas2.y - canvas1.y
        const lenSq = segDx * segDx + segDy * segDy
        const t = lenSq <= 0 ? 0 : Math.max(0, Math.min(1,
          ((pointer.x - canvas1.x) * segDx + (pointer.y - canvas1.y) * segDy) / lenSq))
        const closestX = canvas1.x + t * segDx
        const closestY = canvas1.y + t * segDy
        const dist = Math.sqrt((pointer.x - closestX) ** 2 + (pointer.y - closestY) ** 2)
        if (dist < edgeHitRadius) {
          hitEdge = i
          break
        }
      }
    }

    if (hitEdge === null) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        const localX = p.x - pathOffset.x
        const localY = p.y - pathOffset.y
        const canvasPt = fabric.util.transformPoint({ x: localX, y: localY }, transformMatrix)
        const dx = pointer.x - canvasPt.x
        const dy = pointer.y - canvasPt.y
        if (Math.sqrt(dx * dx + dy * dy) <= vertexHitRadius) {
          hitVertex = i
          break
        }
      }
    }

    selectedVertexIndexRef.current = hitVertex
    canvas.renderAll()

    if (hitEdge !== null) {
      // 在边上添加顶点
      const anchorPoint = points[hitEdge]
      const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
      const anchorLocalX = anchorPoint.x - oldPathOffset.x
      const anchorLocalY = anchorPoint.y - oldPathOffset.y
      const anchorAbsolute = fabric.util.transformPoint(
        { x: anchorLocalX, y: anchorLocalY },
        transformMatrix
      )

      const invMatrix = fabric.util.invertTransform(transformMatrix)
      const localPoint = fabric.util.transformPoint(pointer as any, invMatrix)
      const newX = localPoint.x + pathOffset.x
      const newY = localPoint.y + pathOffset.y
      const polygonPointsArray = [...(polygon.points || [])]
      polygonPointsArray.splice(hitEdge + 1, 0, { x: newX, y: newY })

      polygon.set({ points: polygonPointsArray })
      polygon._setPositionDimensions({})
      ;(polygon as any).dirty = true
      if ((polygon as any)._setPath) delete (polygon as any)._setPath

      const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
      const newAnchorLocalX = anchorPoint.x - newPathOffset.x
      const newAnchorLocalY = anchorPoint.y - newPathOffset.y
      const newTransformMatrix = polygon.calcTransformMatrix()
      const newAnchorAbsolute = fabric.util.transformPoint(
        { x: newAnchorLocalX, y: newAnchorLocalY },
        newTransformMatrix
      )
      const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
      const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
      if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
        polygon.set({
          left: (polygon.left || 0) + deltaX,
          top: (polygon.top || 0) + deltaY,
        })
      }
      polygon.setCoords()

      const edgeCategoryColor = (polygon as any).categoryId
        ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
        : '#FF0000'
      const edgeIsSeg = getAnnotationType(projectRef) === 'segmentation'
      const edgeBaseOpts = {
        canvas,
        categoryColor: edgeCategoryColor,
        isSegmentation: edgeIsSeg,
        enableEdgeControls: true,
        selectedVertexIndexRef,
        onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
      }
      selectedVertexIndexRef.current = null
      createPolygonControls(polygon, {
        ...edgeBaseOpts,
        onRebuildControls: (poly) => createPolygonControls(poly, edgeBaseOpts),
      })
      canvas.renderAll()
      saveCurrentAnnotationsRef.current?.().catch(() => {})
      return true
    }

    // 如果只是选中了顶点（用于 Delete 删除），返回 false 让事件继续传播
    return false
  }, [categoriesRef, projectRef, createPolygonControls, selectedVertexIndexRef, saveCurrentAnnotationsRef])

  // ========== reset ==========

  const reset = useCallback(() => {
    hasActiveAnnotationRef.current = false
    hasActivePolygonRef.current = false
    selectedVertexIndexRef.current = null
  }, [])

  return {
    hasActiveAnnotationRef,
    hasActivePolygonRef,
    selectedVertexIndexRef,
    isPointInPolygon,
    createPolygonControls,
    bindSelectionEvents,
    handlePolygonHitTest,
    reset,
  }
}
