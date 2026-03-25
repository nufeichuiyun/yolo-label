import { useRef, useCallback } from 'react'
import { fabric } from 'fabric'
import { message } from 'antd'
import { annotationsApi } from '../../../api/annotations'
import { Category } from '../../../api/categories'
import { Image } from '../../../api/images'
import { rectToYOLO, polygonToYOLO, getImageBounds, yoloToCanvas } from '../utils/coordinate'
import { clampYOLO, clipRectToImageBounds, clipPolygonToImageBounds } from '../utils/clipping'
import { createAnnotationRect, createAnnotationPolygon } from '../utils/fabricObjects'
import type { ImageBounds, YOLORect, YOLOPolygon } from '../types'

interface UseAnnotationsOptions {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>
  imageBoundsRef: React.MutableRefObject<ImageBounds | null>
  imageRef: React.MutableRefObject<Image | null>
  imageIdRef: React.MutableRefObject<string | undefined>  // 闭包安全的 imageId
  categoriesRef: React.MutableRefObject<Category[]>
  projectRef: React.MutableRefObject<any>
  selectedVertexIndexRef: React.MutableRefObject<number | null>
  saveCurrentAnnotationsRef: React.MutableRefObject<(() => Promise<void>) | null>
  createPolygonControls: (polygon: fabric.Polygon, options: any) => void
  onStatsUpdate: () => void
}

interface UseAnnotationsReturn {
  annotationsRef: React.MutableRefObject<any[]>
  savingRef: React.MutableRefObject<boolean>
  saveCurrentAnnotations: () => Promise<void>
  drawExistingAnnotations: (
    canvas: fabric.Canvas,
    annotations: any[],
    categories: Category[],
    originalImgWidth: number,
    originalImgHeight: number,
    scale: number,
    annotationType?: string
  ) => void
  addAnnotation: (fabricObject: fabric.Object) => void
  reset: () => void
}

export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
  const {
    canvasRef, imageBoundsRef, imageRef, imageIdRef, categoriesRef, projectRef,
    selectedVertexIndexRef, saveCurrentAnnotationsRef, createPolygonControls, onStatsUpdate,
  } = options

  const annotationsRef = useRef<any[]>([])
  const savingRef = useRef(false)

  /**
   * 保存当前标注到后端。使用新的 coordinate + clipping 模块。
   * 关键修复：所有 YOLO 坐标在保存前 clamp 到 [0, 1]。
   *
   * 注意：保留原文件的竞态保护逻辑（busy-wait + imageId 一致性检查），
   * 使用 annotationsApi.create() 的正确接口格式（bbox/polygon，非 bbox_data）。
   */
  const saveCurrentAnnotations = useCallback(async () => {
    // 竞态保护：如果正在保存，等待完成（最多 5 秒）
    if (savingRef.current) {
      let waitCount = 0
      while (savingRef.current && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      if (savingRef.current) return
    }

    const canvas = canvasRef.current
    const image = imageRef.current
    const imageId = imageIdRef.current
    const categories = categoriesRef.current
    const project = projectRef.current

    if (!canvas || !image || !imageId || !categories.length) return
    // imageId 一致性检查
    if (image.id !== Number(imageId)) return

    savingRef.current = true

    try {
      // 二次检查
      if (!canvasRef.current || canvasRef.current !== canvas) return
      if (imageIdRef.current !== imageId) return

      // 确保 canvas 当前显示的是目标图片，避免在图片切换过程中误保存
      const canvasImageId = (canvas as any)._currentImageId
      if (canvasImageId != null && canvasImageId !== image.id) return

      const bgImage = canvas.backgroundImage as fabric.Image
      if (!bgImage) return
      const bounds = getImageBounds(bgImage)

      // project 未加载时不保存，防止 annotationType 误判导致清空标注
      if (!project) return

      const annotationType = project.annotation_type || 'detection'
      const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
      const objects = canvas.getObjects().filter(obj =>
        annotationTypes.includes(obj.type!) && (obj as any).categoryId != null
      )

      // 安全阀：canvas 上有标注对象但类型不匹配时（例如有 polygon 但查找 rect），
      // 说明 annotationType 可能错误，禁止保存以防清空已有标注
      if (objects.length === 0) {
        const allAnnotationObjects = canvas.getObjects().filter(obj =>
          ['rect', 'polygon'].includes(obj.type!) && (obj as any).categoryId != null
        )
        if (allAnnotationObjects.length > 0) return // 有标注但类型不匹配，跳过
      }

      const annotationData = objects
        .map((obj) => {
          const categoryId = (obj as any).categoryId
          if (obj.type === 'rect' && annotationType === 'detection') {
            const yolo = rectToYOLO(obj as fabric.Rect, bounds)
            if (!yolo) return null
            // Bug 3 修复：clamp 到 [0, 1]
            const [xc, yc, w, h] = yolo.map(clampYOLO) as YOLORect
            if (w <= 0 || h <= 0) return null
            return {
              category_id: categoryId,
              bbox: { x_center: xc, y_center: yc, width: w, height: h },
            }
          } else if (obj.type === 'polygon' && annotationType === 'segmentation') {
            const yoloPoints = polygonToYOLO(obj as fabric.Polygon, bounds)
            if (!yoloPoints) return null
            const clampedPoints: YOLOPolygon = yoloPoints.map(([x, y]) => [clampYOLO(x), clampYOLO(y)])
            if (clampedPoints.length < 3) return null
            return {
              category_id: categoryId,
              polygon: { points: clampedPoints },
            }
          }
          return null
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      // 使用 annotationsApi.create（正确的 API 接口）
      const savedAnnotations = await annotationsApi.create(Number(imageId), annotationData as any)

      // 保存成功后，更新 canvas 上标注对象的 annotationId
      if (savedAnnotations?.length) {
        const canvasObjects = canvas.getObjects().filter(obj => annotationTypes.includes(obj.type!))
        savedAnnotations.forEach((savedAnn, index) => {
          if (index < canvasObjects.length) {
            ;(canvasObjects[index] as any).annotationId = savedAnn.id
          }
        })
      }

      onStatsUpdate()
    } catch (error: any) {
      console.error('保存标注失败:', error)
      message.error('保存标注失败: ' + (error.response?.data?.detail || error.message || '未知错误'))
      throw error
    } finally {
      savingRef.current = false
    }
  }, [canvasRef, imageRef, imageIdRef, categoriesRef, projectRef, onStatsUpdate])

  // 将 save 函数存到 ref，供其他 hooks 通过 ref 调用
  saveCurrentAnnotationsRef.current = saveCurrentAnnotations

  /**
   * 绘制已有标注到 canvas。
   * 从原文件的 drawExistingAnnotations 提取，使用新的 yoloToCanvas。
   */
  const drawExistingAnnotations = useCallback((
    canvas: fabric.Canvas,
    annotations: any[],
    categories: Category[],
    originalImgWidth: number,
    originalImgHeight: number,
    scale: number,
    annotationType: string = 'detection'
  ) => {
    // 清除已保存的标注对象
    const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
    const savedObjects = canvas.getObjects().filter(obj =>
      annotationTypes.includes(obj.type!) && (obj as any).annotationId != null
    )
    savedObjects.forEach(obj => canvas.remove(obj))

    if (!annotations.length || !categories.length) {
      canvas.renderAll()
      return
    }

    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage) {
      canvas.renderAll()
      return
    }

    const bounds = getImageBounds(bgImage)
    const zoom = canvas.getZoom() || 1

    annotations.forEach((ann) => {
      try {
        const annotationData = JSON.parse(ann.bbox_data)
        const category = categories.find(c => c.id === ann.category_id)
        if (!category) return

        const color = category.color || '#FF0000'

        if (annotationType === 'segmentation') {
          let points = annotationData.points || annotationData.polygon?.points
          if (!points || points.length < 3) return

          // YOLO → canvas 坐标
          let canvasPoints = (points as number[][]).map(([x, y]) =>
            yoloToCanvas({ x, y }, bounds)
          )

          // 自动裁切超出图像边界的多边形
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
          if (hasOutOfBounds) {
            canvasPoints = clipPolygonToImageBounds(canvasPoints, bounds)
            if (canvasPoints.length < 3) return
          }

          const polygon = createAnnotationPolygon({
            points: canvasPoints,
            color,
            zoom,
            isSegmentation: true,
            annotationId: ann.id,
            categoryId: ann.category_id,
          })

          createPolygonControls(polygon, {
            canvas,
            categoryColor: color,
            isSegmentation: true,
            enableEdgeControls: true,
            selectedVertexIndexRef,
            onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            onRebuildControls: (poly: fabric.Polygon) => createPolygonControls(poly, {
              canvas,
              categoryColor: color,
              isSegmentation: true,
              enableEdgeControls: true,
              selectedVertexIndexRef,
              onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            }),
          })

          polygon.setCoords()
          canvas.add(polygon)
        } else {
          // Detection — 矩形
          const { x_center, y_center, width, height } = annotationData
          if (x_center == null || y_center == null || width == null || height == null) return

          const topLeft = yoloToCanvas(
            { x: x_center - width / 2, y: y_center - height / 2 },
            bounds
          )
          const bottomRight = yoloToCanvas(
            { x: x_center + width / 2, y: y_center + height / 2 },
            bounds
          )

          // 自动裁切超出图像边界的矩形
          let rectLeft = topLeft.x
          let rectTop = topLeft.y
          let rectWidth = bottomRight.x - topLeft.x
          let rectHeight = bottomRight.y - topLeft.y
          const clippedRect = clipRectToImageBounds(
            { left: rectLeft, top: rectTop, width: rectWidth, height: rectHeight },
            bounds
          )
          if (!clippedRect) return // 完全在图像外
          if (clippedRect.left !== rectLeft || clippedRect.top !== rectTop ||
              clippedRect.width !== rectWidth || clippedRect.height !== rectHeight) {
            rectLeft = clippedRect.left
            rectTop = clippedRect.top
            rectWidth = clippedRect.width
            rectHeight = clippedRect.height
          }

          const rect = createAnnotationRect({
            left: rectLeft,
            top: rectTop,
            width: rectWidth,
            height: rectHeight,
            color,
            zoom,
            annotationId: ann.id,
            categoryId: ann.category_id,
          })

          canvas.add(rect)
        }
      } catch (e) {
        console.error('绘制标注失败:', e)
      }
    })

    canvas.renderAll()

    // 自动裁切仅影响当前显示，不主动保存。
    // 用户下次编辑标注时会通过 onModified 回调自然保存裁切后的结果。
  }, [createPolygonControls, selectedVertexIndexRef, saveCurrentAnnotationsRef])

  const addAnnotation = useCallback((fabricObject: fabric.Object) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.add(fabricObject)
    canvas.renderAll()
    // 自动保存
    saveCurrentAnnotations().catch(() => {})
  }, [canvasRef, saveCurrentAnnotations])

  const reset = useCallback(() => {
    annotationsRef.current = []
  }, [])

  return {
    annotationsRef,
    savingRef,
    saveCurrentAnnotations,
    drawExistingAnnotations,
    addAnnotation,
    reset,
  }
}
