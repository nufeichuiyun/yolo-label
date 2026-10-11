import { useEffect, useRef, useState } from 'react'
import { loadProtectedImage, ImageContentLoader } from './utils/protectedImage'

export function ProtectedImage({ id, alt, getContent }: {
  id: number
  alt: string
  getContent: ImageContentLoader
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    const target = imageRef.current
    const dispose = loadProtectedImage(id, image => {
      if (target) target.src = image.src
    }, () => setFailed(true), getContent)
    return () => {
      if (target) target.removeAttribute('src')
      dispose()
    }
  }, [id, getContent])

  return <img ref={imageRef} alt={failed ? `${alt}（无权访问或加载失败）` : alt} />
}
