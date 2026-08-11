import 'fabric'

declare module 'fabric' {
  namespace fabric {
    interface Polygon {
      _setPositionDimensions(options?: Record<string, unknown>): void
    }

    interface Control {
      pointIndex?: number
    }
  }
}
