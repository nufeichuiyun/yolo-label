import { fabric } from 'fabric'

// --- 坐标相关 ---
export interface Point {
  x: number
  y: number
}

export interface ImageBounds {
  left: number        // bgImage.left — canvas 坐标中图像左上角 x
  top: number         // bgImage.top — canvas 坐标中图像左上角 y
  scaleX: number      // bgImage.scaleX
  scaleY: number      // bgImage.scaleY
  originalWidth: number   // 原始图像像素宽度
  originalHeight: number  // 原始图像像素高度
}

export interface RectBounds {
  left: number
  top: number
  width: number
  height: number
}

// Fabric.js v5 的 pathOffset 未导出，扩展接口
export interface FabricPolygonExt extends fabric.Polygon {
  pathOffset: Point
  _baseStrokeWidth?: number
}

export interface FabricRectExt extends fabric.Rect {
  _baseStrokeWidth?: number
  categoryId?: number
  annotationId?: number
}

export interface FabricObjectExt extends fabric.Object {
  _baseStrokeWidth?: number
  categoryId?: number
  annotationId?: number
}

// --- YOLO 格式 ---
export type YOLORect = [number, number, number, number]  // [x_center, y_center, w, h]
export type YOLOPolygon = [number, number][]              // [[x, y], ...]

// --- 绘制模式 ---
export type DrawingMode = 'detection' | 'segmentation'

// --- Hook 回调 ---
export interface DrawingCallbacks {
  onDrawingComplete: (fabricObject: fabric.Object) => void
  onSave: () => Promise<void>
}

export interface ResetHandle {
  reset: () => void
}

// --- 预加载缓存 ---
export interface ImageCacheEntry {
  element: HTMLImageElement
  lastAccess: number
}
