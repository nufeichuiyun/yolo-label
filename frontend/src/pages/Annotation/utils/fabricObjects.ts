import { fabric } from 'fabric'
import { RECT_BASE_STROKE_WIDTH, POLYGON_BASE_STROKE_WIDTH, MIN_STROKE_WIDTH } from './constants'
import type { Point } from '../types'

export interface CreateRectParams {
  left: number
  top: number
  width: number
  height: number
  color: string
  zoom?: number
  annotationId?: number
  categoryId?: number
}

export function createAnnotationRect(params: CreateRectParams): fabric.Rect {
  const { left, top, width, height, color, zoom = 1, annotationId, categoryId } = params
  const rect = new fabric.Rect({
    left,
    top,
    width,
    height,
    fill: 'transparent',
    stroke: color,
    strokeWidth: Math.max(MIN_STROKE_WIDTH, RECT_BASE_STROKE_WIDTH / zoom),
    strokeUniform: true,
    objectCaching: false,
    selectable: true,
    evented: true,
    hasBorders: true,
    hasControls: true,
    lockRotation: true,
    lockUniScaling: true,
  })
  ;(rect as any)._baseStrokeWidth = RECT_BASE_STROKE_WIDTH
  if (annotationId !== undefined) (rect as any).annotationId = annotationId
  if (categoryId !== undefined) (rect as any).categoryId = categoryId
  return rect
}

export interface CreatePolygonParams {
  points: Point[]
  color: string
  zoom?: number
  isSegmentation?: boolean
  annotationId?: number
  categoryId?: number
}

export function createAnnotationPolygon(params: CreatePolygonParams): fabric.Polygon {
  const { points, color, zoom = 1, isSegmentation = false, annotationId, categoryId } = params

  // 计算边界框
  const minX = Math.min(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y))

  // 转换为局部坐标
  const localPoints = points.map(p => ({ x: p.x - minX, y: p.y - minY }))

  const polygon = new fabric.Polygon(localPoints, {
    left: minX,
    top: minY,
    fill: 'transparent',
    stroke: color,
    strokeWidth: Math.max(MIN_STROKE_WIDTH, POLYGON_BASE_STROKE_WIDTH / zoom),
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: false,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    lockUniScaling: true,
    lockMovementX: isSegmentation,
    lockMovementY: isSegmentation,
  })

  // 修复 Fabric.js Polygon 坐标漂移：_setPositionDimensions 会引入 0.5px 偏移。
  // 创建后读回第一个顶点的实际 canvas 坐标，与目标坐标对比，调整 left/top 补偿。
  const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
  const tm = polygon.calcTransformMatrix()
  const actual = fabric.util.transformPoint(
    { x: (polygon.points![0].x - pathOffset.x), y: (polygon.points![0].y - pathOffset.y) } as any,
    tm
  )
  const dx = points[0].x - actual.x
  const dy = points[0].y - actual.y
  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
    polygon.set({ left: (polygon.left || 0) + dx, top: (polygon.top || 0) + dy })
    polygon.setCoords()
  }

  ;(polygon as any)._baseStrokeWidth = POLYGON_BASE_STROKE_WIDTH
  if (annotationId !== undefined) (polygon as any).annotationId = annotationId
  if (categoryId !== undefined) (polygon as any).categoryId = categoryId
  return polygon
}

export function createTempLine(points: [number, number, number, number], color: string): fabric.Line {
  return new fabric.Line(points, {
    stroke: color,
    strokeWidth: 2,
    selectable: false,
    evented: false,
    strokeDashArray: [5, 5],
  })
}

export function createVertexCircle(point: Point, color: string, radius: number = 5): fabric.Circle {
  return new fabric.Circle({
    left: point.x - radius,
    top: point.y - radius,
    radius,
    fill: color,
    stroke: '#fff',
    strokeWidth: 2,
    selectable: false,
    evented: false,
    originX: 'left',
    originY: 'top',
  })
}
