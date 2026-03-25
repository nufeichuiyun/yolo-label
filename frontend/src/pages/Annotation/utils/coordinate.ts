import { fabric } from 'fabric'
import type { Point, ImageBounds, YOLORect, YOLOPolygon, FabricPolygonExt } from '../types'

/**
 * 从 Fabric 背景图对象提取 ImageBounds。
 */
export function getImageBounds(bgImage: fabric.Image): ImageBounds {
  return {
    left: bgImage.left || 0,
    top: bgImage.top || 0,
    scaleX: bgImage.scaleX || 1,
    scaleY: bgImage.scaleY || 1,
    originalWidth: bgImage.width || 0,
    originalHeight: bgImage.height || 0,
  }
}

/**
 * Canvas 逻辑坐标 → 原始图像像素坐标。
 * 减去背景图偏移 (margin)，再除以缩放比例。
 */
export function canvasToImage(point: Point, bounds: ImageBounds): Point {
  return {
    x: (point.x - bounds.left) / bounds.scaleX,
    y: (point.y - bounds.top) / bounds.scaleY,
  }
}

/**
 * 图像像素坐标 → YOLO 归一化坐标 [0,1]。
 */
export function imageToYOLO(point: Point, imgW: number, imgH: number): Point {
  return {
    x: point.x / imgW,
    y: point.y / imgH,
  }
}

/**
 * YOLO 归一化坐标 → Canvas 逻辑坐标（反向）。
 */
export function yoloToCanvas(point: Point, bounds: ImageBounds): Point {
  return {
    x: point.x * bounds.originalWidth * bounds.scaleX + bounds.left,
    y: point.y * bounds.originalHeight * bounds.scaleY + bounds.top,
  }
}

/**
 * Fabric.js 矩形 → YOLO 格式 [x_center, y_center, w, h]。
 * 返回 null 表示退化标注（零面积）。
 */
export function rectToYOLO(rect: fabric.Rect, bounds: ImageBounds): YOLORect | null {
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

  // 确保正值
  let normLeft = actualLeft
  let normTop = actualTop
  let normW = displayWidth
  let normH = displayHeight

  if (normW < 0) { normLeft += normW; normW = Math.abs(normW) }
  if (normH < 0) { normTop += normH; normH = Math.abs(normH) }

  // canvas → image
  const imgTopLeft = canvasToImage({ x: normLeft, y: normTop }, bounds)
  const imgBottomRight = canvasToImage({ x: normLeft + normW, y: normTop + normH }, bounds)

  // image → yolo (归一化)
  const yoloTL = imageToYOLO(imgTopLeft, bounds.originalWidth, bounds.originalHeight)
  const yoloBR = imageToYOLO(imgBottomRight, bounds.originalWidth, bounds.originalHeight)

  const w = yoloBR.x - yoloTL.x
  const h = yoloBR.y - yoloTL.y
  const xc = yoloTL.x + w / 2
  const yc = yoloTL.y + h / 2

  // 退化检查
  if (w <= 0 || h <= 0) return null

  return [xc, yc, w, h]
}

/**
 * Fabric.js 多边形 → YOLO 格式顶点数组。
 * 返回 null 表示退化标注（不足 3 个顶点）。
 */
export function polygonToYOLO(polygon: fabric.Polygon, bounds: ImageBounds): YOLOPolygon | null {
  const points = polygon.points || []
  const pathOffset = (polygon as unknown as FabricPolygonExt).pathOffset || { x: 0, y: 0 }
  const transformMatrix = polygon.calcTransformMatrix()

  const yoloPoints: YOLOPolygon = points.map((point) => {
    const localX = point.x - pathOffset.x
    const localY = point.y - pathOffset.y
    const canvasPoint = fabric.util.transformPoint(
      { x: localX, y: localY } as any,
      transformMatrix
    )
    const imgPt = canvasToImage({ x: canvasPoint.x, y: canvasPoint.y }, bounds)
    const yoloPt = imageToYOLO(imgPt, bounds.originalWidth, bounds.originalHeight)
    return [yoloPt.x, yoloPt.y]
  })

  if (yoloPoints.length < 3) return null
  return yoloPoints
}
