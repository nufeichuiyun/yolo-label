import type { Point, ImageBounds, RectBounds } from '../types'
import { DEDUP_DISTANCE_THRESHOLD } from './constants'

export function clampYOLO(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getImageRect(bounds: ImageBounds) {
  const w = bounds.originalWidth * bounds.scaleX
  const h = bounds.originalHeight * bounds.scaleY
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.left + w,
    bottom: bounds.top + h,
  }
}

export function isRectCompletelyOutsideImage(rect: RectBounds, bounds: ImageBounds): boolean {
  const img = getImageRect(bounds)
  const rectRight = rect.left + rect.width
  const rectBottom = rect.top + rect.height
  return rectRight <= img.left || rect.left >= img.right ||
         rectBottom <= img.top || rect.top >= img.bottom
}

export function clipRectToImageBounds(rect: RectBounds, bounds: ImageBounds): RectBounds | null {
  const img = getImageRect(bounds)
  const clippedLeft = Math.max(rect.left, img.left)
  const clippedTop = Math.max(rect.top, img.top)
  const clippedRight = Math.min(rect.left + rect.width, img.right)
  const clippedBottom = Math.min(rect.top + rect.height, img.bottom)
  const w = clippedRight - clippedLeft
  const h = clippedBottom - clippedTop
  if (w <= 0 || h <= 0) return null
  return { left: clippedLeft, top: clippedTop, width: w, height: h }
}

export function clipPolygonToImageBounds(points: Point[], bounds: ImageBounds): Point[] {
  const img = getImageRect(bounds)

  // 标准 Sutherland-Hodgman 算法：逐边裁剪
  // 每条边只判断该边方向的 inside/outside，不做正交方向的范围限制
  // （正交方向由后续的边裁剪处理）
  const clipEdge = (pts: Point[], isInside: (p: Point) => boolean, intersect: (p1: Point, p2: Point) => Point): Point[] => {
    if (pts.length === 0) return []
    const result: Point[] = []
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i]
      const p2 = pts[(i + 1) % pts.length]
      const p1In = isInside(p1)
      const p2In = isInside(p2)

      if (p1In && p2In) {
        // 两点都在内侧，保留 p2
        result.push(p2)
      } else if (p1In && !p2In) {
        // p1 在内，p2 在外，添加交点
        result.push(intersect(p1, p2))
      } else if (!p1In && p2In) {
        // p1 在外，p2 在内，添加交点和 p2
        result.push(intersect(p1, p2))
        result.push(p2)
      }
      // 两点都在外侧：不添加任何点
    }
    return result
  }

  let clipped = [...points]

  // 上边界
  clipped = clipEdge(clipped,
    p => p.y >= img.top,
    (p1, p2) => {
      const t = (img.top - p1.y) / (p2.y - p1.y)
      return { x: p1.x + t * (p2.x - p1.x), y: img.top }
    }
  )
  // 下边界
  clipped = clipEdge(clipped,
    p => p.y <= img.bottom,
    (p1, p2) => {
      const t = (img.bottom - p1.y) / (p2.y - p1.y)
      return { x: p1.x + t * (p2.x - p1.x), y: img.bottom }
    }
  )
  // 左边界
  clipped = clipEdge(clipped,
    p => p.x >= img.left,
    (p1, p2) => {
      const t = (img.left - p1.x) / (p2.x - p1.x)
      return { x: img.left, y: p1.y + t * (p2.y - p1.y) }
    }
  )
  // 右边界
  clipped = clipEdge(clipped,
    p => p.x <= img.right,
    (p1, p2) => {
      const t = (img.right - p1.x) / (p2.x - p1.x)
      return { x: img.right, y: p1.y + t * (p2.y - p1.y) }
    }
  )

  // 去重
  const cleaned: Point[] = []
  for (const p of clipped) {
    const isDup = cleaned.some(existing => {
      const dx = existing.x - p.x
      const dy = existing.y - p.y
      return Math.sqrt(dx * dx + dy * dy) < DEDUP_DISTANCE_THRESHOLD
    })
    if (!isDup) cleaned.push(p)
  }
  return cleaned
}

export function getLineImageBoundaryIntersection(
  p1: Point, p2: Point, bounds: ImageBounds
): Point | null {
  const img = getImageRect(bounds)
  const p2Inside = p2.x > img.left && p2.x < img.right && p2.y > img.top && p2.y < img.bottom
  if (p2Inside) return null

  const intersections: Array<Point & { t: number }> = []

  if ((p1.y < img.top && p2.y >= img.top) || (p1.y >= img.top && p2.y < img.top)) {
    const t = (img.top - p1.y) / (p2.y - p1.y)
    if (t > 0 && t <= 1) {
      const x = p1.x + t * (p2.x - p1.x)
      if (x >= img.left && x <= img.right) intersections.push({ x, y: img.top, t })
    }
  }
  if ((p1.y < img.bottom && p2.y >= img.bottom) || (p1.y >= img.bottom && p2.y < img.bottom)) {
    const t = (img.bottom - p1.y) / (p2.y - p1.y)
    if (t > 0 && t <= 1) {
      const x = p1.x + t * (p2.x - p1.x)
      if (x >= img.left && x <= img.right) intersections.push({ x, y: img.bottom, t })
    }
  }
  if ((p1.x < img.left && p2.x >= img.left) || (p1.x >= img.left && p2.x < img.left)) {
    const t = (img.left - p1.x) / (p2.x - p1.x)
    if (t > 0 && t <= 1) {
      const y = p1.y + t * (p2.y - p1.y)
      if (y >= img.top && y <= img.bottom) intersections.push({ x: img.left, y, t })
    }
  }
  if ((p1.x < img.right && p2.x >= img.right) || (p1.x >= img.right && p2.x < img.right)) {
    const t = (img.right - p1.x) / (p2.x - p1.x)
    if (t > 0 && t <= 1) {
      const y = p1.y + t * (p2.y - p1.y)
      if (y >= img.top && y <= img.bottom) intersections.push({ x: img.right, y, t })
    }
  }

  if (intersections.length === 0) return null
  intersections.sort((a, b) => a.t - b.t)
  return { x: intersections[0].x, y: intersections[0].y }
}
