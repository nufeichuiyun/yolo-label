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
  type Edge = 'top' | 'bottom' | 'left' | 'right'

  const clipEdge = (pts: Point[], edge: Edge): Point[] => {
    const result: Point[] = []
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i]
      const p2 = pts[(i + 1) % pts.length]
      let p1Inside = false
      let p2Inside = false

      if (edge === 'top')    { p1Inside = p1.y >= img.top;    p2Inside = p2.y >= img.top }
      if (edge === 'bottom') { p1Inside = p1.y <= img.bottom; p2Inside = p2.y <= img.bottom }
      if (edge === 'left')   { p1Inside = p1.x >= img.left;   p2Inside = p2.x >= img.left }
      if (edge === 'right')  { p1Inside = p1.x <= img.right;  p2Inside = p2.x <= img.right }

      let intersection: Point | null = null

      if (edge === 'top' && ((p1.y < img.top && p2.y >= img.top) || (p1.y >= img.top && p2.y < img.top))) {
        const t = (img.top - p1.y) / (p2.y - p1.y)
        if (t > 0 && t <= 1) {
          const x = p1.x + t * (p2.x - p1.x)
          if (x >= img.left && x <= img.right) intersection = { x, y: img.top }
        }
      } else if (edge === 'bottom' && ((p1.y < img.bottom && p2.y >= img.bottom) || (p1.y >= img.bottom && p2.y < img.bottom))) {
        const t = (img.bottom - p1.y) / (p2.y - p1.y)
        if (t > 0 && t <= 1) {
          const x = p1.x + t * (p2.x - p1.x)
          if (x >= img.left && x <= img.right) intersection = { x, y: img.bottom }
        }
      } else if (edge === 'left' && ((p1.x < img.left && p2.x >= img.left) || (p1.x >= img.left && p2.x < img.left))) {
        const t = (img.left - p1.x) / (p2.x - p1.x)
        if (t > 0 && t <= 1) {
          const y = p1.y + t * (p2.y - p1.y)
          if (y >= img.top && y <= img.bottom) intersection = { x: img.left, y }
        }
      } else if (edge === 'right' && ((p1.x < img.right && p2.x >= img.right) || (p1.x >= img.right && p2.x < img.right))) {
        const t = (img.right - p1.x) / (p2.x - p1.x)
        if (t > 0 && t <= 1) {
          const y = p1.y + t * (p2.y - p1.y)
          if (y >= img.top && y <= img.bottom) intersection = { x: img.right, y }
        }
      }

      if (p1Inside) result.push(p1)
      if (intersection) result.push(intersection)
    }
    return result
  }

  let clipped = [...points]
  clipped = clipEdge(clipped, 'top')
  clipped = clipEdge(clipped, 'bottom')
  clipped = clipEdge(clipped, 'left')
  clipped = clipEdge(clipped, 'right')

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
