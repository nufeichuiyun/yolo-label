import { describe, it, expect } from 'vitest'
import { clipRectToImageBounds, clipPolygonToImageBounds, clampYOLO, isRectCompletelyOutsideImage } from '../clipping'
import type { ImageBounds, RectBounds, Point } from '../../types'

const bounds: ImageBounds = {
  left: 50, top: 30, scaleX: 1, scaleY: 1,
  originalWidth: 800, originalHeight: 600,
}
// 图像在 canvas 中占据 [50, 30] → [850, 630]

describe('clipRectToImageBounds', () => {
  it('returns rect unchanged if fully inside', () => {
    const rect: RectBounds = { left: 100, top: 100, width: 200, height: 150 }
    expect(clipRectToImageBounds(rect, bounds)).toEqual(rect)
  })
  it('clips rect that extends past right edge', () => {
    const rect: RectBounds = { left: 800, top: 100, width: 200, height: 100 }
    const result = clipRectToImageBounds(rect, bounds)!
    expect(result.left).toBe(800)
    expect(result.width).toBe(50)
    expect(result.height).toBe(100)
  })
  it('returns null if rect is completely outside', () => {
    expect(clipRectToImageBounds({ left: 900, top: 100, width: 100, height: 100 }, bounds)).toBeNull()
  })
  it('clips rect extending past all edges', () => {
    const result = clipRectToImageBounds({ left: 0, top: 0, width: 1000, height: 800 }, bounds)!
    expect(result.left).toBe(50)
    expect(result.top).toBe(30)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })
})

describe('isRectCompletelyOutsideImage', () => {
  it('returns false if rect overlaps image', () => {
    expect(isRectCompletelyOutsideImage({ left: 100, top: 100, width: 200, height: 150 }, bounds)).toBe(false)
  })
  it('returns true if rect is completely outside', () => {
    expect(isRectCompletelyOutsideImage({ left: 900, top: 100, width: 100, height: 100 }, bounds)).toBe(true)
  })
})

describe('clipPolygonToImageBounds', () => {
  it('returns polygon unchanged if fully inside', () => {
    const points: Point[] = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }]
    expect(clipPolygonToImageBounds(points, bounds).length).toBe(3)
  })
  it('clips triangle that extends beyond right edge', () => {
    const points: Point[] = [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 500, y: 300 }]
    const result = clipPolygonToImageBounds(points, bounds)
    result.forEach(p => {
      expect(p.x).toBeLessThanOrEqual(850 + 0.01)
      expect(p.x).toBeGreaterThanOrEqual(50 - 0.01)
    })
    expect(result.length).toBeGreaterThanOrEqual(3)
  })
  it('returns empty or small array for polygon completely outside', () => {
    const points: Point[] = [{ x: 900, y: 700 }, { x: 1000, y: 700 }, { x: 950, y: 800 }]
    expect(clipPolygonToImageBounds(points, bounds).length).toBeLessThan(3)
  })
})

describe('clampYOLO', () => {
  it('clamps values to [0, 1]', () => {
    expect(clampYOLO(-0.1)).toBe(0)
    expect(clampYOLO(0.5)).toBe(0.5)
    expect(clampYOLO(1.2)).toBe(1)
  })
})
