import { useEffect } from 'react'

export interface KeyboardActions {
  navigatePrev: () => void
  navigateNext: () => void
  deleteSelected: () => void
  finishDrawing: () => void
  cancelDrawing: () => void
  removeLastPoint: () => void
  isDrawingPolygon: () => boolean
}

/**
 * 快捷键处理 hook。副作用 hook，无返回值。
 */
export function useKeyboard(actions: KeyboardActions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框内，不处理快捷键
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault()
          actions.navigatePrev()
          break
        case 'd':
          e.preventDefault()
          actions.navigateNext()
          break
        case 'delete':
        case 'backspace':
          e.preventDefault()
          actions.deleteSelected()
          break
        case 'enter':
          if (actions.isDrawingPolygon()) {
            e.preventDefault()
            actions.finishDrawing()
          }
          break
        case 'escape':
          e.preventDefault()
          actions.cancelDrawing()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actions])
}
