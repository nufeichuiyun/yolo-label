import { describe, it, expect } from 'vitest'
import {
  canvasToImage,
  imageToYOLO,
  yoloToCanvas,
} from '../coordinate'
import type { ImageBounds, Point } from '../../types'

describe('canvasToImage', () => {
  const bounds: ImageBounds = {
    left: 50, top: 30, scaleX: 0.5, scaleY: 0.5,
    originalWidth: 1920, originalHeight: 1080,
  }

  it('converts canvas point to image pixel coordinates', () => {
    const result = canvasToImage({ x: 50, y: 30 }, bounds)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
  })

  it('converts canvas center to correct image coordinates', () => {
    const result = canvasToImage({ x: 530, y: 300 }, bounds)
    expect(result.x).toBeCloseTo(960)
    expect(result.y).toBeCloseTo(540)
  })

  it('handles points outside image bounds (negative image coords)', () => {
    const result = canvasToImage({ x: 0, y: 0 }, bounds)
    expect(result.x).toBeCloseTo(-100)
    expect(result.y).toBeCloseTo(-60)
  })
})

describe('imageToYOLO', () => {
  it('normalizes image coordinates to [0,1]', () => {
    const result = imageToYOLO({ x: 960, y: 540 }, 1920, 1080)
    expect(result.x).toBeCloseTo(0.5)
    expect(result.y).toBeCloseTo(0.5)
  })

  it('handles origin (0,0)', () => {
    const result = imageToYOLO({ x: 0, y: 0 }, 1920, 1080)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
  })

  it('handles full extent', () => {
    const result = imageToYOLO({ x: 1920, y: 1080 }, 1920, 1080)
    expect(result.x).toBeCloseTo(1)
    expect(result.y).toBeCloseTo(1)
  })
})

describe('yoloToCanvas', () => {
  const bounds: ImageBounds = {
    left: 50, top: 30, scaleX: 0.5, scaleY: 0.5,
    originalWidth: 1920, originalHeight: 1080,
  }

  it('converts YOLO normalized coords back to canvas', () => {
    const result = yoloToCanvas({ x: 0.5, y: 0.5 }, bounds)
    expect(result.x).toBeCloseTo(530)
    expect(result.y).toBeCloseTo(300)
  })

  it('round-trips with canvasToImage + imageToYOLO', () => {
    const original: Point = { x: 200, y: 150 }
    const imgPt = canvasToImage(original, bounds)
    const yolo = imageToYOLO(imgPt, bounds.originalWidth, bounds.originalHeight)
    const back = yoloToCanvas(yolo, bounds)
    expect(back.x).toBeCloseTo(original.x)
    expect(back.y).toBeCloseTo(original.y)
  })
})
