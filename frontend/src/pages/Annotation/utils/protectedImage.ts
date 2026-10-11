import { imagesApi } from '../../../api/images'

export type ImageContentLoader = (id: number, signal?: AbortSignal) => Promise<Blob>

// Every consumer owns its request and object URL until disposal. Cancellation also
// suppresses late fetch/decode callbacks when navigating between images.
export function loadProtectedImage(
  id: number,
  onLoad: (image: HTMLImageElement) => void,
  onError: (error: unknown) => void,
  getContent: ImageContentLoader = imagesApi.content,
): () => void {
  const controller = new AbortController()
  let element: HTMLImageElement | undefined
  let objectUrl: string | undefined
  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    controller.abort()
    if (element) {
      element.onload = null
      element.onerror = null
      element.src = ''
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }

  void getContent(id, controller.signal).then(blob => {
    if (disposed) return
    objectUrl = URL.createObjectURL(blob)
    element = new window.Image()
    element.onload = () => {
      if (!disposed && element) onLoad(element)
    }
    element.onerror = () => {
      if (disposed) return
      dispose()
      onError(new Error('图片解码失败'))
    }
    element.src = objectUrl
  }).catch(error => {
    if (disposed) return
    dispose()
    onError(error)
  })

  return dispose
}
