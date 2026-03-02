import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout, Button, Space, message } from 'antd'
const { Header, Content, Footer, Sider } = Layout
import { ArrowLeftOutlined } from '@ant-design/icons'
import { fabric } from 'fabric'
import { imagesApi, Image } from '../api/images'
import { categoriesApi, Category } from '../api/categories'
import { annotationsApi } from '../api/annotations'
import { statsApi, ProjectStats, TaskStats } from '../api/stats'
import { projectsApi, Project } from '../api/projects'
import { tasksApi, Task } from '../api/tasks'
import './Annotation.css'

// 动态获取API地址
const getApiBaseUrl = () => {
  // 在开发环境中，使用相对路径，让Vite代理处理
  // 这样静态文件请求也会通过Vite代理到后端
  if (import.meta.env.DEV) {
    return ''  // 返回空字符串，使用相对路径
  }
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol
    const hostname = window.location.hostname
    return `${protocol}//${hostname}:8000`
  }
  return 'http://localhost:8000'
}

export default function Annotation() {
  const { projectId, imageId } = useParams<{ projectId: string; imageId: string }>()
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const [image, setImage] = useState<Image | null>(null)
  const [project, setProject] = useState<Project | null>(null) // 项目信息
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [annotations, setAnnotations] = useState<any[]>([])
  const [allImages, setAllImages] = useState<Image[]>([]) // 所有图片列表
  const [stats, setStats] = useState<ProjectStats | null>(null) // 项目统计信息
  const [currentTask, setCurrentTask] = useState<Task | null>(null) // 当前图片所属的任务包
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null) // 任务包统计信息
  const [previewImages, setPreviewImages] = useState<Image[]>([]) // 预览图片列表
  const [categoryCounts, setCategoryCounts] = useState<Record<number, number>>({}) // 每个类别在当前图片中的数量
  // 使用ref存储最新的annotations和categories，避免闭包问题
  const annotationsRef = useRef<any[]>([])
  const categoriesRef = useRef<Category[]>([])
  const projectRef = useRef<Project | null>(null) // 存储项目信息，避免闭包问题
  // 用于绘制矩形的状态
  const isDrawingRef = useRef<boolean>(false)
  const startPointRef = useRef<{ x: number; y: number } | null>(null)
  const rectRef = useRef<fabric.Rect | null>(null)
  // 用于绘制多边形的状态
  const isDrawingPolygonRef = useRef<boolean>(false)
  const polygonPointsRef = useRef<{ x: number; y: number }[]>([])
  const polygonRef = useRef<fabric.Polygon | null>(null) // 预览多边形
  const polygonLineRef = useRef<fabric.Line | null>(null) // 临时线段，显示当前绘制中的线段
  const polygonPointMarkersRef = useRef<fabric.Circle[]>([]) // 顶点标记
  // 十字辅助线
  const crosshairHLineRef = useRef<fabric.Line | null>(null) // 横线
  const crosshairVLineRef = useRef<fabric.Line | null>(null) // 竖线
  const updateCrosshairNativeRef = useRef<((e: MouseEvent) => void) | null>(null) // 存储十字线更新函数引用
  const crosshairUpdateRequestRef = useRef<number | null>(null) // 用于 requestAnimationFrame
  const updateCategoryCountsRef = useRef<(() => void) | null>(null) // 存储类别计数更新函数引用
  // 保存锁，防止并发保存
  const savingRef = useRef<boolean>(false)
  // 导航锁，防止快速连续切换
  const navigatingRef = useRef<boolean>(false)
  // 用于平移的状态
  const isPanningRef = useRef<boolean>(false)
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null)
  // 用于存储saveCurrentAnnotations函数的ref，避免循环依赖
  const saveCurrentAnnotationsRef = useRef<(() => Promise<void>) | null>(null)
  // 用于区分右键单击和拖动的状态
  const rightMouseDownPointRef = useRef<{ x: number; y: number; time: number } | null>(null)
  // 存储最后一次鼠标事件，用于在取消选中时重新显示十字辅助线
  const lastMouseEventRef = useRef<MouseEvent | null>(null)
  const RIGHT_CLICK_THRESHOLD = 5 // 像素阈值，小于此值认为是单击
  const RIGHT_CLICK_TIME_THRESHOLD = 200 // 时间阈值（毫秒），小于此值认为是单击
  // 存储removeLastPolygonPoint函数的ref
  const removeLastPolygonPointRef = useRef<(() => void) | null>(null)
  // 存储其他函数的ref，确保在bindMouseDownHandler中能访问
  const getLineImageBoundaryIntersectionRef = useRef<((p1: { x: number; y: number }, p2: { x: number; y: number }) => { x: number; y: number } | null) | null>(null)
  const updatePreviewPolygonRef = useRef<(() => void) | null>(null)
  const updatePointMarkersRef = useRef<(() => void) | null>(null)
  // 用于跟踪当前是否有选中的多边形
  const hasActivePolygonRef = useRef<boolean>(false)
  // 用于跟踪当前是否有选中的标注（矩形或多边形），点击空白时用于取消选择
  const hasActiveAnnotationRef = useRef<boolean>(false)
  // 用于跟踪当前选中的顶点索引（用于 Delete 删除顶点）
  const selectedVertexIndexRef = useRef<number | null>(null)

  // 更新预览图片列表（当前图片前后各5张）
  const updatePreviewImages = useCallback((images: Image[], currentImageId: number) => {
    const currentIndex = images.findIndex(img => img.id === currentImageId)
    if (currentIndex === -1) {
      setPreviewImages([])
      return
    }
    
    const previewCount = 5 // 前后各5张
    const startIndex = Math.max(0, currentIndex - previewCount)
    const endIndex = Math.min(images.length, currentIndex + previewCount + 1)
    setPreviewImages(images.slice(startIndex, endIndex))
  }, [])

  const loadImage = useCallback(async () => {
    if (!imageId) return
    try {
      const data = await imagesApi.get(Number(imageId))
      setImage(data)
    } catch (error) {
      message.error('加载图片失败')
    }
  }, [imageId])

  const loadCategories = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await categoriesApi.list(Number(projectId))
      setCategories(data)
      categoriesRef.current = data // 更新ref
      // 如果有类别且当前没有选中，自动选择第一个
      // 使用ref获取selectedCategory，避免依赖项导致无限循环
      if (data.length > 0 && selectedCategoryRef.current === null) {
        setSelectedCategory(data[0].id)
      }
    } catch (error) {
      message.error('加载类别失败')
    }
  }, [projectId]) // 移除selectedCategory依赖，使用ref获取

  const loadAnnotations = useCallback(async () => {
    if (!imageId) return
    try {
      console.log('开始加载标注，imageId:', imageId)
      const data = await annotationsApi.getImageAnnotations(Number(imageId))
      console.log('加载标注成功，imageId:', imageId, '标注数量:', data.length, '标注数据:', data)
      setAnnotations(data)
      annotationsRef.current = data // 更新ref
    } catch (error) {
      console.error('加载标注失败，imageId:', imageId, '错误:', error)
      // 忽略错误，可能是还没有标注
      setAnnotations([])
      annotationsRef.current = []
    }
  }, [imageId])

  // 防止重复加载的锁
  const loadingAllImagesRef = useRef<boolean>(false)
  
  const loadAllImages = useCallback(async () => {
    if (!projectId) return
    
    // 如果正在加载，跳过
    if (loadingAllImagesRef.current) {
      console.log('loadAllImages跳过：正在加载中')
      return
    }
    
    loadingAllImagesRef.current = true
    
    try {
      const data = await imagesApi.list(Number(projectId), 0, 10000)
      // 确保图片列表按ID排序（后端已排序，这里再次确认）
      const sortedImages = [...data.items].sort((a, b) => a.id - b.id)
      setAllImages(sortedImages)
      // 不在这里更新预览列表，由useEffect统一处理，避免重复调用
      console.log('加载图片列表完成，数量:', sortedImages.length)
    } catch (error) {
      console.error('加载图片列表失败:', error)
    } finally {
      loadingAllImagesRef.current = false
    }
  }, [projectId])

  const loadStats = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await statsApi.getProjectStats(Number(projectId))
      setStats(data)
    } catch (error) {
      console.error('加载统计信息失败:', error)
    }
  }, [projectId])

  const loadCurrentTask = useCallback(async () => {
    if (!imageId) return
    try {
      const task = await tasksApi.getImageTask(Number(imageId))
      setCurrentTask(task)
      
      // 如果找到了任务包，加载任务包的统计信息
      if (task) {
        try {
          const stats = await statsApi.getTaskStats(task.id)
          setTaskStats(stats)
        } catch (error) {
          console.error('加载任务包统计信息失败:', error)
        }
      } else {
        setTaskStats(null)
      }
    } catch (error) {
      console.error('加载任务包信息失败:', error)
      setCurrentTask(null)
      setTaskStats(null)
    }
  }, [imageId])

  const loadProject = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await projectsApi.get(Number(projectId))
      setProject(data)
      projectRef.current = data // 同时更新ref
    } catch (error) {
      console.error('加载项目信息失败:', error)
      message.error('加载项目信息失败')
    }
  }, [projectId])


  // 将canvas坐标转换为YOLO格式（支持矩形和多边形）
  // 注意：对象的坐标是canvas上的坐标，需要转换为原图坐标
  // 检查矩形是否完全在图片外（在画布内但在图片外）
  const isRectCompletelyOutsideImage = useCallback((rect: fabric.Rect, canvas: fabric.Canvas): boolean => {
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height) {
      return false
    }
    
    // 获取图片边界
    const imageLeft = bgImage.left || 0
    const imageTop = bgImage.top || 0
    const imageWidth = bgImage.width * (bgImage.scaleX || 1)
    const imageHeight = bgImage.height * (bgImage.scaleY || 1)
    const imageRight = imageLeft + imageWidth
    const imageBottom = imageTop + imageHeight
    
    // 获取矩形的实际边界框
    const scaleX = rect.scaleX || 1
    const scaleY = rect.scaleY || 1
    const originX = rect.originX || 'left'
    const originY = rect.originY || 'top'
    const baseWidth = rect.width || 0
    const baseHeight = rect.height || 0
    const displayWidth = baseWidth * scaleX
    const displayHeight = baseHeight * scaleY
    
    // 根据原点计算实际显示的左上角坐标
    let actualLeft = rect.left || 0
    let actualTop = rect.top || 0
    
    if (originX === 'center') {
      actualLeft = actualLeft - displayWidth / 2
    } else if (originX === 'right') {
      actualLeft = actualLeft - displayWidth
    }
    
    if (originY === 'center') {
      actualTop = actualTop - displayHeight / 2
    } else if (originY === 'bottom') {
      actualTop = actualTop - displayHeight
    }
    
    const rectLeft = actualLeft
    const rectTop = actualTop
    const rectRight = actualLeft + displayWidth
    const rectBottom = actualTop + displayHeight
    
    // 检查矩形是否完全在图片外
    const isCompletelyOutside = rectRight <= imageLeft || rectLeft >= imageRight ||
                               rectBottom <= imageTop || rectTop >= imageBottom
    
    return isCompletelyOutside
  }, [])

  const convertToYOLO = useCallback((obj: fabric.Object, canvas: fabric.Canvas, originalImgWidth: number, originalImgHeight: number) => {
    // 获取背景图片信息（用于计算正确的缩放和偏移）
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage) {
      console.warn('convertToYOLO: 背景图片不存在，使用fallback计算')
      // Fallback: 使用canvas尺寸
      const canvasWidth = canvas.width || originalImgWidth
      const canvasHeight = canvas.height || originalImgHeight
      const scaleX = canvasWidth / originalImgWidth
      const scaleY = canvasHeight / originalImgHeight
      
      if (obj.type === 'rect') {
        const rect = obj as fabric.Rect
        const originalLeft = rect.left! / scaleX
        const originalTop = rect.top! / scaleY
        const originalWidth = rect.width! / scaleX
        const originalHeight = rect.height! / scaleY
        
        const left = originalLeft / originalImgWidth
        const top = originalTop / originalImgHeight
        const width = originalWidth / originalImgWidth
        const height = originalHeight / originalImgHeight
        const x_center = left + width / 2
        const y_center = top + height / 2
        
        return { x_center, y_center, width, height }
      } else if (obj.type === 'polygon') {
        const polygon = obj as fabric.Polygon
        const points = polygon.points || []
        const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
        const transformMatrix = polygon.calcTransformMatrix()
        const normalizedPoints = points.map((point) => {
          const localX = point.x - pathOffset.x
          const localY = point.y - pathOffset.y
          const canvasPoint = fabric.util.transformPoint(
            { x: localX, y: localY },
            transformMatrix
          )
          const originalX = canvasPoint.x / scaleX
          const originalY = canvasPoint.y / scaleY
          const normalizedX = originalX / originalImgWidth
          const normalizedY = originalY / originalImgHeight
          return [normalizedX, normalizedY]
        })
        return { points: normalizedPoints }
      }
      return null
    }
    
    // 使用背景图片的缩放比例和偏移（与drawExistingAnnotations保持一致）
    const bgImageScaleX = bgImage.scaleX || 1
    const bgImageScaleY = bgImage.scaleY || 1
    const bgImageLeft = bgImage.left || 0
    const bgImageTop = bgImage.top || 0
    
    if (obj.type === 'rect') {
      // 矩形框：转换为bbox格式
      const rect = obj as fabric.Rect
      
      // 规范化矩形坐标：确保width和height都是正数
      // 考虑缩放和原点
      const scaleX = rect.scaleX || 1
      const scaleY = rect.scaleY || 1
      const originX = rect.originX || 'left'
      const originY = rect.originY || 'top'
      const baseWidth = rect.width || 0
      const baseHeight = rect.height || 0
      const displayWidth = baseWidth * scaleX
      const displayHeight = baseHeight * scaleY
      
      // 根据原点计算实际显示的左上角坐标
      let actualLeft = rect.left || 0
      let actualTop = rect.top || 0
      
      if (originX === 'center') {
        actualLeft = actualLeft - displayWidth / 2
      } else if (originX === 'right') {
        actualLeft = actualLeft - displayWidth
      }
      
      if (originY === 'center') {
        actualTop = actualTop - displayHeight / 2
      } else if (originY === 'bottom') {
        actualTop = actualTop - displayHeight
      }
      
      // 规范化：确保width和height都是正数
      let normalizedLeft = actualLeft
      let normalizedTop = actualTop
      let normalizedWidth = displayWidth
      let normalizedHeight = displayHeight
      
      if (normalizedWidth < 0) {
        normalizedLeft = normalizedLeft + normalizedWidth
        normalizedWidth = Math.abs(normalizedWidth)
      }
      
      if (normalizedHeight < 0) {
        normalizedTop = normalizedTop + normalizedHeight
        normalizedHeight = Math.abs(normalizedHeight)
      }
      
      // canvas坐标减去背景图片偏移，得到相对于背景图片的坐标
      const relativeX = normalizedLeft - bgImageLeft
      const relativeY = normalizedTop - bgImageTop
      
      // 转换为原图坐标（除以缩放比例）
      const originalLeft = relativeX / bgImageScaleX
      const originalTop = relativeY / bgImageScaleY
      const originalWidth = normalizedWidth / bgImageScaleX
      const originalHeight = normalizedHeight / bgImageScaleY
      
      // 归一化
      const left = originalLeft / originalImgWidth
      const top = originalTop / originalImgHeight
      const width = originalWidth / originalImgWidth
      const height = originalHeight / originalImgHeight
      const x_center = left + width / 2
      const y_center = top + height / 2
      
      return { x_center, y_center, width, height }
    } else if (obj.type === 'polygon') {
      // 多边形：转换为polygon格式
      const polygon = obj as fabric.Polygon
      const points = polygon.points || []
      const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
      const transformMatrix = polygon.calcTransformMatrix()
      
      // 将canvas坐标转换为归一化的原图坐标
      // polygon.points 使用 pathOffset，需通过 transformMatrix 得到正确的 canvas 坐标
      const normalizedPoints = points.map((point) => {
        const localX = point.x - pathOffset.x
        const localY = point.y - pathOffset.y
        const canvasPoint = fabric.util.transformPoint(
          { x: localX, y: localY },
          transformMatrix
        )
        const canvasX = canvasPoint.x
        const canvasY = canvasPoint.y
        
        // 减去背景图片偏移，得到相对于背景图片的坐标
        const relativeX = canvasX - bgImageLeft
        const relativeY = canvasY - bgImageTop
        
        // 转换为原图坐标（除以缩放比例）
        const originalX = relativeX / bgImageScaleX
        const originalY = relativeY / bgImageScaleY
        
        // 归一化
        const normalizedX = originalX / originalImgWidth
        const normalizedY = originalY / originalImgHeight
        
        return [normalizedX, normalizedY]
      })
      
      return { points: normalizedPoints }
    }
    
    return null
  }, [])

  // 更新预览多边形
  const updatePreviewPolygon = useCallback(() => {
    if (!fabricCanvasRef.current || !isDrawingPolygonRef.current || polygonPointsRef.current.length < 2) {
      return
    }
    
    const canvas = fabricCanvasRef.current
    const points = polygonPointsRef.current
    const currentSelectedCategory = selectedCategoryRef.current
    const currentCategories = categoriesRef.current
    
    if (!currentSelectedCategory) {
      return
    }
    
    const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
    
    // 计算多边形的边界框
    const minX = Math.min(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    
    // 将点坐标转换为相对于多边形左上角的局部坐标
    const localPoints = points.map(p => ({
      x: p.x - minX,
      y: p.y - minY
    }))
    
    // 移除旧的预览多边形
    if (polygonRef.current) {
      canvas.remove(polygonRef.current)
      polygonRef.current = null
    }
    
    // 创建新的预览多边形
    const previewPolygon = new fabric.Polygon(localPoints, {
      left: minX,
      top: minY,
      fill: 'rgba(255, 0, 0, 0.1)', // 半透明填充
      stroke: categoryColor,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    })
    
    canvas.add(previewPolygon)
    polygonRef.current = previewPolygon
    canvas.renderAll()
  }, []) // 使用ref获取categories，不需要依赖项
  
  // 更新顶点标记
  const updatePointMarkers = useCallback(() => {
    if (!fabricCanvasRef.current || !isDrawingPolygonRef.current) {
      return
    }
    
    const canvas = fabricCanvasRef.current
    const points = polygonPointsRef.current
    const currentSelectedCategory = selectedCategoryRef.current
    const currentCategories = categoriesRef.current
    
    if (!currentSelectedCategory) {
      return
    }
    
    const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
    
    // 移除旧的顶点标记
    polygonPointMarkersRef.current.forEach(marker => {
      canvas.remove(marker)
    })
    polygonPointMarkersRef.current = []
    
    // 为每个顶点创建标记
    points.forEach((point, index) => {
      const marker = new fabric.Circle({
        left: point.x,
        top: point.y,
        radius: 4,
        fill: categoryColor,
        stroke: '#fff',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      })
      canvas.add(marker)
      polygonPointMarkersRef.current.push(marker)
    })
    
    canvas.renderAll()
  }, []) // 使用ref获取categories，不需要依赖项
  
  // 计算线段与图片边界的交点（返回距离p1最近的交点）
  const getLineImageBoundaryIntersection = useCallback((
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ): { x: number; y: number } | null => {
    if (!fabricCanvasRef.current) {
      return null
    }
    
    const canvas = fabricCanvasRef.current
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height) {
      return null
    }
    
    // 获取图片在canvas中的边界
    // 注意：canvas.getPointer()返回的坐标已经考虑了视口变换
    // bgImage的坐标是相对于canvas的，所以直接使用即可
    const imageLeft = bgImage.left || 0
    const imageTop = bgImage.top || 0
    const imageWidth = bgImage.width * (bgImage.scaleX || 1)
    const imageHeight = bgImage.height * (bgImage.scaleY || 1)
    const imageRight = imageLeft + imageWidth
    const imageBottom = imageTop + imageHeight
    
    console.log('计算交点，图片边界:', { imageLeft, imageTop, imageRight, imageBottom })
    console.log('bgImage信息:', { left: bgImage.left, top: bgImage.top, width: bgImage.width, height: bgImage.height, scaleX: bgImage.scaleX, scaleY: bgImage.scaleY })
    console.log('线段:', { p1, p2 })
    console.log('canvas信息:', { width: canvas.width, height: canvas.height, zoom: canvas.getZoom(), viewportTransform: canvas.viewportTransform })
    
    // 检查p2是否在图片内（使用严格的小于等于，不包括边界）
    // 注意：如果p2正好在边界上，也认为在图片内
    const p2Inside = p2.x > imageLeft && p2.x < imageRight && p2.y > imageTop && p2.y < imageBottom
    console.log('p2是否在图片内（严格）:', p2Inside, 'p2位置:', p2, '边界检查:', {
      xLeft: p2.x > imageLeft,
      xRight: p2.x < imageRight,
      yTop: p2.y > imageTop,
      yBottom: p2.y < imageBottom,
      xInRange: p2.x >= imageLeft && p2.x <= imageRight,
      yInRange: p2.y >= imageTop && p2.y <= imageBottom
    })
    
    // 如果p2在图片内（不包括边界），不需要计算交点
    if (p2Inside) {
      console.log('p2在图片内，不需要计算交点')
      return null
    }
    
    // 如果p2在图片外或正好在边界上，计算交点
    console.log('p2在图片外或边界上，开始计算交点')
    
    // 收集所有交点
    const intersections: Array<{ x: number; y: number; t: number }> = []
    
    // 检查与上边界的交点
    if ((p1.y < imageTop && p2.y >= imageTop) || (p1.y >= imageTop && p2.y < imageTop)) {
      const t = (imageTop - p1.y) / (p2.y - p1.y)
      if (t > 0 && t <= 1) {
        const x = p1.x + t * (p2.x - p1.x)
        if (x >= imageLeft && x <= imageRight) {
          intersections.push({ x, y: imageTop, t })
        }
      }
    }
    
    // 检查与下边界的交点
    if ((p1.y < imageBottom && p2.y >= imageBottom) || (p1.y >= imageBottom && p2.y < imageBottom)) {
      const t = (imageBottom - p1.y) / (p2.y - p1.y)
      if (t > 0 && t <= 1) {
        const x = p1.x + t * (p2.x - p1.x)
        if (x >= imageLeft && x <= imageRight) {
          intersections.push({ x, y: imageBottom, t })
        }
      }
    }
    
    // 检查与左边界的交点
    if ((p1.x < imageLeft && p2.x >= imageLeft) || (p1.x >= imageLeft && p2.x < imageLeft)) {
      const t = (imageLeft - p1.x) / (p2.x - p1.x)
      if (t > 0 && t <= 1) {
        const y = p1.y + t * (p2.y - p1.y)
        if (y >= imageTop && y <= imageBottom) {
          intersections.push({ x: imageLeft, y, t })
        }
      }
    }
    
    // 检查与右边界的交点
    if ((p1.x < imageRight && p2.x >= imageRight) || (p1.x >= imageRight && p2.x < imageRight)) {
      const t = (imageRight - p1.x) / (p2.x - p1.x)
      if (t > 0 && t <= 1) {
        const y = p1.y + t * (p2.y - p1.y)
        if (y >= imageTop && y <= imageBottom) {
          intersections.push({ x: imageRight, y, t })
        }
      }
    }
    
    // 如果没有交点，返回null
    if (intersections.length === 0) {
      return null
    }
    
    // 返回距离p1最近的交点（t值最小的）
    intersections.sort((a, b) => a.t - b.t)
    const nearestIntersection = intersections[0]
    return { x: nearestIntersection.x, y: nearestIntersection.y }
  }, [])
  
  // 裁剪多边形到图片范围内
  const clipPolygonToImageBounds = useCallback((points: { x: number; y: number }[]): { x: number; y: number }[] => {
    if (!fabricCanvasRef.current || !imageRef.current) {
      return points
    }
    
    const canvas = fabricCanvasRef.current
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height) {
      return points
    }
    
    // 获取图片在canvas中的边界（考虑缩放）
    const imageLeft = bgImage.left || 0
    const imageTop = bgImage.top || 0
    const imageWidth = bgImage.width * (bgImage.scaleX || 1)
    const imageHeight = bgImage.height * (bgImage.scaleY || 1)
    const imageRight = imageLeft + imageWidth
    const imageBottom = imageTop + imageHeight
    
    // 使用Sutherland-Hodgman算法裁剪多边形
    // 按顺序裁剪每条边：上、下、左、右
    let clippedPoints = [...points]
    
    // 裁剪函数：保留在边界内的点和与边界的交点
    const clipEdge = (
      points: { x: number; y: number }[],
      edge: 'top' | 'bottom' | 'left' | 'right'
    ): { x: number; y: number }[] => {
      const result: { x: number; y: number }[] = []
      
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i]
        const p2 = points[(i + 1) % points.length]
        
        let p1Inside = false
        let p2Inside = false
        
        // 判断点是否在边界内
        if (edge === 'top') {
          p1Inside = p1.y >= imageTop
          p2Inside = p2.y >= imageTop
        } else if (edge === 'bottom') {
          p1Inside = p1.y <= imageBottom
          p2Inside = p2.y <= imageBottom
        } else if (edge === 'left') {
          p1Inside = p1.x >= imageLeft
          p2Inside = p2.x >= imageLeft
        } else if (edge === 'right') {
          p1Inside = p1.x <= imageRight
          p2Inside = p2.x <= imageRight
        }
        
        // 计算交点（即使两个点都在边界外，只要线段与边界相交，也要添加交点）
        let intersection: { x: number; y: number } | null = null
        
        // 检查线段是否与边界相交
        let intersects = false
        let t = 0
        
        if (edge === 'top') {
          // 线段是否跨越上边界
          if ((p1.y < imageTop && p2.y >= imageTop) || (p1.y >= imageTop && p2.y < imageTop)) {
            t = (imageTop - p1.y) / (p2.y - p1.y)
            if (t > 0 && t <= 1) {
              const x = p1.x + t * (p2.x - p1.x)
              // 检查交点是否在边界范围内
              if (x >= imageLeft && x <= imageRight) {
                intersects = true
                intersection = { x, y: imageTop }
              }
            }
          }
        } else if (edge === 'bottom') {
          if ((p1.y < imageBottom && p2.y >= imageBottom) || (p1.y >= imageBottom && p2.y < imageBottom)) {
            t = (imageBottom - p1.y) / (p2.y - p1.y)
            if (t > 0 && t <= 1) {
              const x = p1.x + t * (p2.x - p1.x)
              if (x >= imageLeft && x <= imageRight) {
                intersects = true
                intersection = { x, y: imageBottom }
              }
            }
          }
        } else if (edge === 'left') {
          if ((p1.x < imageLeft && p2.x >= imageLeft) || (p1.x >= imageLeft && p2.x < imageLeft)) {
            t = (imageLeft - p1.x) / (p2.x - p1.x)
            if (t > 0 && t <= 1) {
              const y = p1.y + t * (p2.y - p1.y)
              if (y >= imageTop && y <= imageBottom) {
                intersects = true
                intersection = { x: imageLeft, y }
              }
            }
          }
        } else if (edge === 'right') {
          if ((p1.x < imageRight && p2.x >= imageRight) || (p1.x >= imageRight && p2.x < imageRight)) {
            t = (imageRight - p1.x) / (p2.x - p1.x)
            if (t > 0 && t <= 1) {
              const y = p1.y + t * (p2.y - p1.y)
              if (y >= imageTop && y <= imageBottom) {
                intersects = true
                intersection = { x: imageRight, y }
              }
            }
          }
        }
        
        // 如果p1在边界内，添加p1
        if (p1Inside) {
          result.push(p1)
        }
        // 如果有交点，添加交点
        if (intersection) {
          result.push(intersection)
        }
        // 注意：p2会在下一次循环中作为p1处理，所以这里不需要添加p2
      }
      
      return result
    }
    
    // 依次裁剪四条边
    clippedPoints = clipEdge(clippedPoints, 'top')
    clippedPoints = clipEdge(clippedPoints, 'bottom')
    clippedPoints = clipEdge(clippedPoints, 'left')
    clippedPoints = clipEdge(clippedPoints, 'right')
    
    // 移除重复的点（距离很近的点）
    const cleanedPoints: { x: number; y: number }[] = []
    const DISTANCE_THRESHOLD = 1 // 像素阈值
    
    for (let i = 0; i < clippedPoints.length; i++) {
      const p = clippedPoints[i]
      const isDuplicate = cleanedPoints.some(existing => {
        const dx = existing.x - p.x
        const dy = existing.y - p.y
        return Math.sqrt(dx * dx + dy * dy) < DISTANCE_THRESHOLD
      })
      
      if (!isDuplicate) {
        cleanedPoints.push(p)
      }
    }
    
    // 至少需要3个点才能形成多边形
    if (cleanedPoints.length < 3) {
      return points // 如果裁剪后点数不足，返回原始点
    }
    
    return cleanedPoints
  }, [])
  
  // 判断点是否在多边形内部（使用射线法）
  const isPointInPolygon = useCallback((point: { x: number; y: number }, polygonPoints: { x: number; y: number }[]): boolean => {
    if (polygonPoints.length < 3) {
      return false
    }
    
    let inside = false
    const x = point.x
    const y = point.y
    
    // 射线法：从点向右发射一条水平射线，计算与多边形边界的交点数量
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const xi = polygonPoints[i].x
      const yi = polygonPoints[i].y
      const xj = polygonPoints[j].x
      const yj = polygonPoints[j].y
      
      // 检查射线是否与边相交
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
      if (intersect) {
        inside = !inside
      }
    }
    
    return inside
  }, [])
  
  /**
   * 为多边形创建顶点和边控制点（支持拖拽顶点、边中点添加顶点）
   * 增删顶点后需调用 onRebuildControls 重新应用控制点
   */
  const createPolygonControls = useCallback((
    polygon: fabric.Polygon,
    options: {
      canvas: fabric.Canvas
      categoryColor: string
      isSegmentation: boolean
      enableEdgeControls?: boolean  // 是否显示边中点控制点（用于添加顶点）
      selectedVertexIndexRef?: React.MutableRefObject<number | null>  // 用于顶点选中样式
      onModified?: () => void
      onRebuildControls?: (poly: fabric.Polygon) => void
    }
  ) => {
    const { canvas, categoryColor, isSegmentation, enableEdgeControls = true, selectedVertexIndexRef, onModified, onRebuildControls } = options
    polygon.controls = {}
    
    const polygonPoints = polygon.points || []
    
    // 顶点控制点
    polygonPoints.forEach((point: any, index: number) => {
      const controlName = `point${index}`
      const control = new fabric.Control({
        x: 0.5,
        y: 0.5,
        actionHandler: (eventData: any, transformData: any, x: number, y: number) => {
          const bgImage = canvas.backgroundImage as fabric.Image
          if (bgImage && bgImage.width && bgImage.height) {
            const imageLeft = bgImage.left || 0
            const imageTop = bgImage.top || 0
            const imageWidth = bgImage.width * (bgImage.scaleX || 1)
            const imageHeight = bgImage.height * (bgImage.scaleY || 1)
            x = Math.max(imageLeft, Math.min(imageLeft + imageWidth, x))
            y = Math.max(imageTop, Math.min(imageTop + imageHeight, y))
          }
          
          const transformMatrix = polygon.calcTransformMatrix()
          const localPoint = fabric.util.transformPoint({ x, y } as any, fabric.util.invertTransform(transformMatrix))
          const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const pointX = localPoint.x + pathOffset.x
          const pointY = localPoint.y + pathOffset.y
          
          const polygonPointsArray = polygon.points || []
          let anchorIndex = index === 0 && polygonPointsArray.length > 1 ? 1 : 0
          const anchorPoint = polygonPointsArray[anchorIndex]
          if (!anchorPoint) return true
          
          const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const anchorLocalX = anchorPoint.x - oldPathOffset.x
          const anchorLocalY = anchorPoint.y - oldPathOffset.y
          const oldTransformMatrix = polygon.calcTransformMatrix()
          const anchorAbsolute = fabric.util.transformPoint(
            { x: anchorLocalX, y: anchorLocalY },
            oldTransformMatrix
          )
          
          if (polygonPointsArray[index]) {
            polygonPointsArray[index].x = pointX
            polygonPointsArray[index].y = pointY
          }
          polygon.set({ points: polygonPointsArray })
          polygon._setPositionDimensions({})
          ;(polygon as any).dirty = true
          if ((polygon as any)._setPath) delete (polygon as any)._setPath
          
          const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const newAnchorLocalX = anchorPoint.x - newPathOffset.x
          const newAnchorLocalY = anchorPoint.y - newPathOffset.y
          const newTransformMatrix = polygon.calcTransformMatrix()
          const newAnchorAbsolute = fabric.util.transformPoint(
            { x: newAnchorLocalX, y: newAnchorLocalY },
            newTransformMatrix
          )
          const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
          const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
          if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
            polygon.set({
              left: (polygon.left || 0) + deltaX,
              top: (polygon.top || 0) + deltaY
            })
            polygon.setCoords()
          }
          polygon.setCoords()
          canvas.renderAll()
          onModified?.()
          return true
        },
        actionName: 'modifyPolygon',
        pointIndex: index,
        render: (ctx: CanvasRenderingContext2D, left: number, top: number, styleOverride: any) => {
          ctx.save()
          const isSelected = selectedVertexIndexRef?.current === index
          ctx.fillStyle = categoryColor
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = isSelected ? 3 : 2
          const radius = isSelected ? 7 : 5
          ctx.beginPath()
          ctx.arc(left, top, radius, 0, 2 * Math.PI)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        },
        cursorStyle: 'move',
      })
      
      control.positionHandler = function(dim: any, _finalMatrix: any, fabricObject: fabric.Object) {
        const poly = fabricObject as fabric.Polygon
        const pt = poly.points?.[index]
        if (!pt) return { x: 0, y: 0 }
        const pathOffset = (poly as any).pathOffset || { x: 0, y: 0 }
        const pointLocalX = pt.x - pathOffset.x
        const pointLocalY = pt.y - pathOffset.y
        const cvs = (fabricObject as any).canvas
        const vpt = cvs?.viewportTransform
        const objMatrix = (fabricObject as fabric.Polygon).calcTransformMatrix()
        const screenMatrix = (vpt && vpt.length >= 6 && fabric.util.multiplyTransformMatrices)
          ? fabric.util.multiplyTransformMatrices(vpt, objMatrix)
          : objMatrix
        return fabric.util.transformPoint({ x: pointLocalX, y: pointLocalY }, screenMatrix)
      }
      
      polygon.controls[controlName] = control
    })
    
    // 边中点控制点（用于添加顶点）
    if (enableEdgeControls && polygonPoints.length >= 3) {
      polygonPoints.forEach((point: any, index: number) => {
        const nextIndex = (index + 1) % polygonPoints.length
        const p1 = polygonPoints[index]
        const p2 = polygonPoints[nextIndex]
        if (!p1 || !p2) return
        
        const controlName = `edge${index}`
        const control = new fabric.Control({
          x: 0.5,
          y: 0.5,
          // 不在 actionHandler 中插入顶点（拖动会多次触发），改为在 mouse:down 中检测边点击并插入
          actionHandler: () => true,
          actionName: 'addPolygonVertex',
          render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
            ctx.save()
            ctx.fillStyle = '#fff'
            ctx.strokeStyle = categoryColor
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(left, top, 4, 0, 2 * Math.PI)
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          },
          cursorStyle: 'crosshair',
        })
        
        control.positionHandler = function(dim: any, _finalMatrix: any, fabricObject: fabric.Object) {
          const poly = fabricObject as fabric.Polygon
          const pts = poly.points || []
          const pA = pts[index]
          const pB = pts[nextIndex]
          if (!pA || !pB) return { x: 0, y: 0 }
          const pathOffset = (poly as any).pathOffset || { x: 0, y: 0 }
          const midX = (pA.x + pB.x) / 2 - pathOffset.x
          const midY = (pA.y + pB.y) / 2 - pathOffset.y
          const cvs = (fabricObject as any).canvas
          const vpt = cvs?.viewportTransform
          const objMatrix = (fabricObject as fabric.Polygon).calcTransformMatrix()
          const screenMatrix = (vpt && vpt.length >= 6 && fabric.util.multiplyTransformMatrices)
            ? fabric.util.multiplyTransformMatrices(vpt, objMatrix)
            : objMatrix
          return fabric.util.transformPoint({ x: midX, y: midY }, screenMatrix)
        }
        
        polygon.controls[controlName] = control
      })
    }
    
    polygon.containsPoint = function(point: fabric.Point): boolean {
      const points = this.points || []
      if (points.length < 3) return false
      const pathOffset = (this as any).pathOffset || { x: 0, y: 0 }
      const transformMatrix = this.calcTransformMatrix()
      const canvasPoints = points.map((p: any) => {
        const px = p.x - pathOffset.x
        const py = p.y - pathOffset.y
        return fabric.util.transformPoint({ x: px, y: py }, transformMatrix)
      })
      return isPointInPolygon(point, canvasPoints)
    }
  }, [isPointInPolygon])
  
  // 完成多边形绘制
  const finishPolygonDrawing = useCallback(() => {
    if (!fabricCanvasRef.current || !isDrawingPolygonRef.current || polygonPointsRef.current.length < 3) {
      return
    }
    
    const canvas = fabricCanvasRef.current
    let points = [...polygonPointsRef.current] // 复制数组
    
    // 裁剪多边形到图片范围内
    points = clipPolygonToImageBounds(points)
    
    // 如果裁剪后点数不足，说明多边形与图片没有交集或交集太小
    if (points.length < 3) {
      message.warning('多边形与图片没有有效交集，请确保多边形与图片边界有交叉')
      cancelPolygonDrawing()
      return
    }
    
    const currentSelectedCategory = selectedCategoryRef.current
    const currentCategories = categoriesRef.current
    
    if (!currentSelectedCategory) {
      message.warning('请先选择类别')
      cancelPolygonDrawing()
      return
    }
    
    const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
    
    // 获取项目类型，如果是实例分割，禁用整体移动
    const currentProject = projectRef.current || project
    const annotationType = currentProject?.annotation_type || 'detection'
    const isSegmentation = annotationType === 'segmentation'
    
    // 计算多边形的边界框
    const minX = Math.min(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    
    // 将点坐标转换为相对于多边形左上角的局部坐标
    const localPoints = points.map(p => ({
      x: p.x - minX,
      y: p.y - minY
    }))
    
    // 移除预览多边形、临时线段和顶点标记
    if (polygonRef.current) {
      canvas.remove(polygonRef.current)
      polygonRef.current = null
    }
    if (polygonLineRef.current) {
      canvas.remove(polygonLineRef.current)
      polygonLineRef.current = null
    }
    polygonPointMarkersRef.current.forEach(marker => {
      canvas.remove(marker)
    })
    polygonPointMarkersRef.current = []
    
    // 创建最终的多边形对象（线宽按 zoom 反比，放大时保持视觉线宽不变）
    const polygonBaseStroke = 2
    const polygon = new fabric.Polygon(localPoints, {
      left: minX,
      top: minY,
      fill: 'transparent',
      stroke: categoryColor,
      strokeWidth: Math.max(0.5, polygonBaseStroke / (canvas.getZoom() || 1)),
      selectable: true,
      evented: true,
      // 禁用缩放和旋转
      hasControls: true, // 启用控制点显示（用于显示自定义顶点控制点）
      hasBorders: false, // 隐藏矩形包络线
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      lockUniScaling: true,
      lockMovementX: isSegmentation, // 实例分割时禁用X方向移动
      lockMovementY: isSegmentation, // 实例分割时禁用Y方向移动
    })
    ;(polygon as any)._baseStrokeWidth = polygonBaseStroke
    
    const baseOpts = {
      canvas,
      categoryColor,
      isSegmentation,
      enableEdgeControls: true,
      selectedVertexIndexRef,
      onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
    }
    createPolygonControls(polygon, {
      ...baseOpts,
      onRebuildControls: (poly: fabric.Polygon) => createPolygonControls(poly, baseOpts),
    })
    
    // 在多边形上存储类别ID
    ;(polygon as any).categoryId = currentSelectedCategory
    
    // 添加多边形到canvas
    canvas.add(polygon)
    canvas.renderAll()
    
    // 重置绘制状态
    isDrawingPolygonRef.current = false
    polygonPointsRef.current = []
    canvas.selection = true
    // 恢复所有对象的选择功能
    canvas.getObjects().forEach((obj: any) => {
      obj.selectable = true
    })
    
    // 自动保存标注
    console.log('完成多边形绘制，准备保存，saveCurrentAnnotationsRef.current:', !!saveCurrentAnnotationsRef.current)
    if (saveCurrentAnnotationsRef.current) {
      console.log('调用保存函数')
      saveCurrentAnnotationsRef.current().catch(error => {
        console.error('完成多边形绘制后保存失败:', error)
        message.error('保存标注失败，请手动保存')
      })
    } else {
      console.warn('saveCurrentAnnotationsRef.current 为 null，无法保存，稍后重试')
      // 延迟一下再尝试保存，等待ref被设置
      setTimeout(() => {
        if (saveCurrentAnnotationsRef.current) {
          saveCurrentAnnotationsRef.current().catch(error => {
            console.error('完成多边形绘制后保存失败:', error)
            message.error('保存标注失败，请手动保存')
          })
        } else {
          console.error('saveCurrentAnnotationsRef.current 仍然为 null，无法保存')
        }
      }, 100)
    }
  }, [clipPolygonToImageBounds, createPolygonControls]) // 移除saveCurrentAnnotations依赖，避免循环依赖
  
  // 删除多边形的最后一个顶点
  const removeLastPolygonPoint = useCallback(() => {
    if (!fabricCanvasRef.current || !isDrawingPolygonRef.current || polygonPointsRef.current.length === 0) {
      return
    }
    
    const canvas = fabricCanvasRef.current
    
    // 删除最后一个点
    polygonPointsRef.current.pop()
    
    // 如果点数为0，取消绘制
    if (polygonPointsRef.current.length === 0) {
      // 直接调用cancelPolygonDrawing的逻辑，避免循环依赖
      if (polygonRef.current) {
        canvas.remove(polygonRef.current)
        polygonRef.current = null
      }
      if (polygonLineRef.current) {
        canvas.remove(polygonLineRef.current)
        polygonLineRef.current = null
      }
      polygonPointMarkersRef.current.forEach(marker => {
        canvas.remove(marker)
      })
      polygonPointMarkersRef.current = []
      isDrawingPolygonRef.current = false
      canvas.selection = true
      // 恢复所有对象的选择功能
      canvas.getObjects().forEach((obj: any) => {
        obj.selectable = true
      })
      canvas.renderAll()
      return
    }
    
    // 移除旧的预览和标记
    if (polygonRef.current) {
      canvas.remove(polygonRef.current)
      polygonRef.current = null
    }
    if (polygonLineRef.current) {
      canvas.remove(polygonLineRef.current)
      polygonLineRef.current = null
    }
    
    // 移除最后一个顶点标记
    if (polygonPointMarkersRef.current.length > 0) {
      const lastMarker = polygonPointMarkersRef.current.pop()
      if (lastMarker) {
        canvas.remove(lastMarker)
      }
    }
    
    // 更新预览（直接调用函数逻辑，避免依赖）
    if (polygonPointsRef.current.length >= 2) {
      const currentSelectedCategory = selectedCategoryRef.current
      const currentCategories = categoriesRef.current || []
      const points = polygonPointsRef.current
      
      if (currentSelectedCategory && currentCategories && currentCategories.length > 0) {
        const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
        const minX = Math.min(...points.map(p => p.x))
        const minY = Math.min(...points.map(p => p.y))
        const localPoints = points.map(p => ({
          x: p.x - minX,
          y: p.y - minY
        }))
        
        const previewPolygon = new fabric.Polygon(localPoints, {
          left: minX,
          top: minY,
          fill: 'rgba(255, 0, 0, 0.1)',
          stroke: categoryColor,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        })
        canvas.add(previewPolygon)
        polygonRef.current = previewPolygon
        
        // 更新顶点标记
        points.forEach((point) => {
          const marker = new fabric.Circle({
            left: point.x,
            top: point.y,
            radius: 4,
            fill: categoryColor,
            stroke: '#fff',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            originX: 'center',
            originY: 'center',
          })
          canvas.add(marker)
          polygonPointMarkersRef.current.push(marker)
        })
      }
    } else if (polygonPointsRef.current.length === 1) {
      // 只有一个点时，只显示点标记
      const currentSelectedCategory = selectedCategoryRef.current
      const currentCategories = categoriesRef.current || []
      if (currentSelectedCategory && currentCategories && currentCategories.length > 0) {
        const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
        const point = polygonPointsRef.current[0]
        const marker = new fabric.Circle({
          left: point.x,
          top: point.y,
          radius: 4,
          fill: categoryColor,
          stroke: '#fff',
          strokeWidth: 1,
          selectable: false,
          evented: false,
          originX: 'center',
          originY: 'center',
        })
        canvas.add(marker)
        polygonPointMarkersRef.current.push(marker)
      }
    }
    
    canvas.renderAll()
  }, []) // 使用ref获取函数和状态，不需要依赖项
  
  // 更新ref，使handleNativeMouseUp和bindMouseDownHandler能访问到最新的函数
  useEffect(() => {
    removeLastPolygonPointRef.current = removeLastPolygonPoint
    getLineImageBoundaryIntersectionRef.current = getLineImageBoundaryIntersection
    updatePreviewPolygonRef.current = updatePreviewPolygon
    updatePointMarkersRef.current = updatePointMarkers
  }, [removeLastPolygonPoint, getLineImageBoundaryIntersection, updatePreviewPolygon, updatePointMarkers])
  
  // 取消多边形绘制
  const cancelPolygonDrawing = useCallback(() => {
    if (!fabricCanvasRef.current) return
    
    const canvas = fabricCanvasRef.current
    
    // 移除预览多边形、临时线段和顶点标记
    if (polygonRef.current) {
      canvas.remove(polygonRef.current)
      polygonRef.current = null
    }
    if (polygonLineRef.current) {
      canvas.remove(polygonLineRef.current)
      polygonLineRef.current = null
    }
    polygonPointMarkersRef.current.forEach(marker => {
      canvas.remove(marker)
    })
    polygonPointMarkersRef.current = []
    
    // 重置绘制状态
    isDrawingPolygonRef.current = false
    polygonPointsRef.current = []
    canvas.selection = true
    // 恢复所有对象的选择功能
    canvas.getObjects().forEach((obj: any) => {
      obj.selectable = true
    })
    canvas.renderAll()
  }, [])

  // 使用ref存储最新的状态，避免闭包问题
  const imageRef = useRef<Image | null>(null)
  const imageIdRef = useRef<string | undefined>(undefined)
  const selectedCategoryRef = useRef<number | null>(null)
  
  useEffect(() => {
    imageRef.current = image
    imageIdRef.current = imageId
    selectedCategoryRef.current = selectedCategory
  }, [image, imageId, selectedCategory])

  // 保存当前图片的标注（在切换图片时调用）
  const saveCurrentAnnotations = useCallback(async (): Promise<void> => {
    console.log('saveCurrentAnnotations 被调用')
    // 如果正在保存，等待完成（确保保存完成）
    if (savingRef.current) {
      console.log('保存等待：已有保存操作正在进行，等待完成')
      // 等待当前保存完成，最多等待5秒
      let waitCount = 0
      while (savingRef.current && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      if (savingRef.current) {
        console.warn('保存等待超时')
      }
      // 等待完成后，如果当前图片的标注还没保存，再次尝试保存
      if (fabricCanvasRef.current && imageRef.current && imageIdRef.current) {
        const currentImageId = imageIdRef.current
        const currentImage = imageRef.current
        if (currentImage.id === Number(currentImageId)) {
          // 继续执行保存逻辑
        } else {
          console.log('等待完成后，图片已切换，跳过保存')
          return
        }
      } else {
        console.log('等待完成后，缺少必要参数，跳过保存')
        return
      }
    }
    
    if (!fabricCanvasRef.current || !imageRef.current || !imageIdRef.current) {
      console.log('保存跳过：缺少必要参数')
      return
    }

    // 设置保存锁
    savingRef.current = true
    
    try {
      const currentCanvas = fabricCanvasRef.current
      const currentImage = imageRef.current
      const currentImageId = imageIdRef.current
      const currentSelectedCategory = selectedCategoryRef.current
      
      // 验证imageId是否匹配
      if (currentImage.id !== Number(currentImageId)) {
        console.warn('保存跳过：imageId不匹配', {
          imageId: currentImage.id,
          currentImageId: currentImageId
        })
        return
      }
      
      console.log('准备保存当前图片的标注，imageId:', currentImageId)
      
      // 再次检查canvas是否还存在（防止在保存过程中被清理）
      if (!fabricCanvasRef.current || fabricCanvasRef.current !== currentCanvas) {
        console.warn('保存时canvas已被清理或引用失效，取消保存')
        return
      }
      
      // 再次检查imageId是否匹配
      if (currentImage.id !== Number(currentImageId) || imageIdRef.current !== currentImageId) {
        console.warn('保存时imageId不匹配，取消保存', {
          imageId: currentImage.id,
          currentImageId: currentImageId,
          imageIdRef: imageIdRef.current
        })
        return
      }
    
      // 获取项目类型（使用ref避免闭包问题）
      const currentProject = projectRef.current || project
      const annotationType = currentProject?.annotation_type || 'detection'
      console.log('保存时项目类型检查:', {
        projectRef: projectRef.current?.annotation_type,
        projectState: project?.annotation_type,
        finalAnnotationType: annotationType,
        projectId: currentProject?.id
      })
      
      // 根据项目类型获取不同类型的标注对象
      const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
      const allCanvasObjects = currentCanvas.getObjects()
      const objects = allCanvasObjects.filter((obj) => annotationTypes.includes(obj.type))
      console.log('保存时对象检查:', {
        项目类型: annotationType,
        期望的对象类型: annotationTypes,
        canvas对象总数: allCanvasObjects.length,
        canvas对象类型列表: allCanvasObjects.map(obj => ({ type: obj.type, categoryId: (obj as any).categoryId })),
        匹配的对象数量: objects.length,
        匹配的对象详情: objects.map(obj => ({ type: obj.type, categoryId: (obj as any).categoryId }))
      })
      
      // 检查每个标注对象是否有类别ID（对象本身的categoryId或当前选中的类别）
      const objectsWithCategory = objects.filter((obj) => {
        const objCategoryId = (obj as any).categoryId
        return objCategoryId !== undefined && objCategoryId !== null
      })
      
      // 如果所有标注对象都没有类别ID，且当前也没有选中类别，不保存
      if (objects.length > 0 && objectsWithCategory.length === 0 && !currentSelectedCategory) {
        console.log('保存跳过：有标注对象但所有对象都没有类别ID，且当前也没有选中类别')
        console.log('标注对象详情:', objects.map((obj, idx) => ({
          index: idx,
          type: obj.type,
          categoryId: (obj as any).categoryId,
          hasCategoryId: (obj as any).categoryId !== undefined && (obj as any).categoryId !== null
        })))
        return
      }

      // 获取原图尺寸（从image对象或背景图片）
      const canvasBgImage = currentCanvas.backgroundImage as fabric.Image
      const originalImgWidth = currentImage.width || canvasBgImage?.width || currentCanvas.width!
      const originalImgHeight = currentImage.height || canvasBgImage?.height || currentCanvas.height!
      
      // 将所有标注对象转换为保存格式（包括已保存和未保存的）
      // 同时过滤掉完全在图片外的标注框
      const annotationData = objects
        .filter((obj) => {
          // 对于矩形框，检查是否完全在图片外
          if (obj.type === 'rect' && annotationType === 'detection') {
            const rect = obj as fabric.Rect
            const isOutside = isRectCompletelyOutsideImage(rect, currentCanvas)
            if (isOutside) {
              console.log('保存时过滤：矩形完全在图片外，跳过保存', {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
              })
              // 从canvas中删除这个标注框
              currentCanvas.remove(obj)
              currentCanvas.renderAll()
              return false
            }
          }
          return true
        })
        .map((obj) => {
          const yoloData = convertToYOLO(obj, currentCanvas, originalImgWidth, originalImgHeight)
          // 使用标注对象上存储的类别ID，如果没有则使用当前选中的类别
          const categoryId = (obj as any).categoryId || currentSelectedCategory
          
          console.log('保存标注对象:', {
            type: obj.type,
            objCategoryId: (obj as any).categoryId,
            currentSelectedCategory: currentSelectedCategory,
            finalCategoryId: categoryId
          })
          
          // 根据项目类型返回不同的数据格式
          if (annotationType === 'segmentation') {
            return {
              category_id: categoryId,
              polygon: yoloData, // 多边形数据
            }
          } else {
            return {
              category_id: categoryId,
              bbox: yoloData, // 矩形框数据
            }
          }
        })
        .filter(item => item.category_id !== null)

      console.log('准备保存的标注数据:', JSON.stringify(annotationData, null, 2))

      // 即使没有标注框，也要保存（清空标注）
      try {
        console.log('========== 开始保存标注 ==========')
        console.log('imageId:', currentImageId)
        console.log('标注数据:', JSON.stringify(annotationData, null, 2))
        console.log('标注数量:', annotationData.length)
        
        const savedAnnotations = await annotationsApi.create(Number(currentImageId), annotationData)
        console.log('========== 保存完成 ==========')
        console.log('保存返回的标注数据:', savedAnnotations)
        console.log('保存的标注数量:', savedAnnotations.length)
        
        // 保存成功后，更新canvas上标注对象的annotationId（如果还没有的话）
        if (savedAnnotations && savedAnnotations.length > 0) {
          const canvasObjects = currentCanvas.getObjects().filter((obj) => annotationTypes.includes(obj.type))
          console.log('更新canvas上标注对象的annotationId，canvas对象数量:', canvasObjects.length, '保存的标注数量:', savedAnnotations.length)
          
          // 为每个canvas对象匹配对应的保存后的标注ID
          // 注意：这里假设顺序一致，但实际上可能需要根据位置或其他特征匹配
          savedAnnotations.forEach((savedAnn, index) => {
            if (index < canvasObjects.length) {
              const obj = canvasObjects[index]
              const currentAnnotationId = (obj as any).annotationId
              if (!currentAnnotationId || currentAnnotationId !== savedAnn.id) {
                console.log(`更新标注对象 ${index} 的annotationId: ${currentAnnotationId} -> ${savedAnn.id}`)
                ;(obj as any).annotationId = savedAnn.id
              }
            }
          })
        }
        
        // 只更新统计，不重新加载标注（避免清除canvas上的标注框）
        loadStats()
        // 更新任务包统计（重新加载当前图片的任务包信息）
        if (currentImageId) {
          try {
            const task = await tasksApi.getImageTask(Number(currentImageId))
            if (task) {
              const stats = await statsApi.getTaskStats(task.id)
              setTaskStats(stats)
              setCurrentTask(task)
            }
          } catch (error) {
            console.error('更新任务包统计失败:', error)
          }
        }
      } catch (error: any) {
        console.error('========== 保存失败 ==========')
        console.error('imageId:', currentImageId)
        console.error('错误:', error)
        console.error('错误详情:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status
        })
        console.error('============================')
        message.error('保存标注失败: ' + (error.response?.data?.detail || error.message || '未知错误'))
        throw error // 抛出错误，让调用者知道保存失败
      }
    } finally {
      // 释放保存锁
      savingRef.current = false
    }
  }, [convertToYOLO, loadStats, isRectCompletelyOutsideImage])
  
  // 更新saveCurrentAnnotationsRef的useEffect
  useEffect(() => {
    saveCurrentAnnotationsRef.current = saveCurrentAnnotations
  }, [saveCurrentAnnotations])

  // 导航到上一张或下一张图片
  const navigateToImage = useCallback(async (direction: 'prev' | 'next') => {
    // 如果正在导航，忽略本次请求
    if (navigatingRef.current) {
      console.log('导航跳过：已有导航操作正在进行')
      return
    }
    
    if (allImages.length === 0 || !imageId || !projectId) return
    
    // 设置导航锁
    navigatingRef.current = true
    
    try {
      // 记录当前imageId
      const currentImageId = imageId
      
      // 先保存当前图片的标注，必须等待完成
      try {
        console.log('导航前保存标注，imageId:', currentImageId)
        
        // 等待所有保存操作完成
        while (savingRef.current) {
          console.log('等待保存完成，savingRef:', savingRef.current)
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        
        // 保存当前图片（确保最新状态已保存）
        await saveCurrentAnnotations()
        
        // 再次等待保存完成
        while (savingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        
        console.log('保存完成，准备切换图片')
        
        // 检查imageId是否还是原来的（防止在保存过程中又切换了）
        if (imageIdRef.current !== currentImageId) {
          console.warn('保存过程中imageId已变化，取消导航', {
            before: currentImageId,
            after: imageIdRef.current
          })
          return
        }
      } catch (error) {
        console.error('保存失败，但继续切换图片', error)
      }
      
      const currentIndex = allImages.findIndex(img => img.id === Number(imageId))
      if (currentIndex === -1) {
        return
      }
      
      let targetIndex: number
      if (direction === 'prev') {
        targetIndex = currentIndex - 1
        if (targetIndex < 0) {
          // 在提示之前先保存标注
          try {
            await saveCurrentAnnotations()
            while (savingRef.current) {
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          } catch (error) {
            console.error('保存标注失败:', error)
          }
          message.info('已经是第一张图片')
          return
        }
      } else {
        targetIndex = currentIndex + 1
        if (targetIndex >= allImages.length) {
          // 在提示之前先保存标注
          try {
            await saveCurrentAnnotations()
            while (savingRef.current) {
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          } catch (error) {
            console.error('保存标注失败:', error)
          }
          message.info('已经是最后一张图片')
          return
        }
      }
      
      // 再次检查imageId是否还是原来的
      if (imageIdRef.current !== currentImageId) {
        console.warn('导航前imageId已变化，取消导航', {
          before: currentImageId,
          after: imageIdRef.current
        })
        return
      }
      
      const targetImage = allImages[targetIndex]
      console.log('切换到图片:', targetImage.id, '从:', currentImageId)
      navigate(`/projects/${projectId}/annotate/${targetImage.id}`)
    } finally {
      // 延迟释放导航锁，确保导航完成
      setTimeout(() => {
        navigatingRef.current = false
      }, 300)
    }
  }, [allImages, imageId, projectId, navigate, saveCurrentAnnotations])

  // 当projectId变化时，加载项目级别的数据（图片列表、统计、类别、项目信息）
  useEffect(() => {
    if (projectId) {
      // 只在projectId变化时加载，避免重复加载
      console.log('projectId变化，加载项目数据，projectId:', projectId)
      loadProject()
      loadAllImages()
      loadStats()
      loadCategories()
    }
  }, [projectId, loadProject, loadAllImages, loadStats, loadCategories])

  // 当imageId变化时，加载当前图片的数据
  useEffect(() => {
    if (!imageId || !projectId) return
    
    console.log('imageId变化，加载新图片数据，imageId:', imageId)
    
    // 记录旧的imageId和图片，用于保存
    const oldImageId = imageIdRef.current
    const oldImage = imageRef.current
    const targetImageId = imageId // 保存目标imageId，避免闭包问题
    
    // 更新imageIdRef，确保后续操作使用最新的imageId
    imageIdRef.current = imageId
    
    // 异步处理：先保存旧图片的标注，然后加载新图片
    const handleImageChange = async () => {
      // 检查imageId是否还是目标imageId（防止在异步操作过程中又切换了）
      if (imageIdRef.current !== targetImageId) {
        console.warn('imageId已变化，取消加载，目标:', targetImageId, '当前:', imageIdRef.current)
        return
      }
      
      // 如果有旧的canvas和图片，先保存标注
      if (fabricCanvasRef.current && oldImage && oldImageId && oldImageId !== targetImageId) {
        try {
          console.log('imageId变化，先保存旧图片的标注，oldImageId:', oldImageId, 'newImageId:', targetImageId)
          
          // 临时保存当前状态
          const tempImageIdRef = imageIdRef.current
          const tempImageRef = imageRef.current
          
          // 临时恢复旧的状态，用于保存
          imageIdRef.current = oldImageId
          imageRef.current = oldImage
          
          // 保存旧图片的标注
          await saveCurrentAnnotations()
          
          // 恢复新的状态
          imageIdRef.current = tempImageIdRef
          imageRef.current = tempImageRef
          
          // 再次检查imageId是否还是目标imageId
          if (imageIdRef.current !== targetImageId) {
            console.warn('保存过程中imageId又变化了，取消加载新图片')
            return
          }
        } catch (error) {
          console.error('保存旧图片标注失败:', error)
          // 即使保存失败，也继续加载新图片
        }
      }
      
      // 再次检查imageId是否还是目标imageId
      if (imageIdRef.current !== targetImageId) {
        console.warn('保存后imageId已变化，取消加载新图片')
        return
      }
      
      // 重置当前图片相关的状态
      setImage(null)
      setAnnotations([])
      annotationsRef.current = [] // 同时更新ref
      
      // 清理旧的canvas（在保存完成后）
      if (fabricCanvasRef.current) {
        try {
          console.log('清理旧canvas（imageId变化）')
          fabricCanvasRef.current.dispose()
        } catch (error) {
          console.error('清理canvas时出错:', error)
        }
        fabricCanvasRef.current = null
      }
      // 清理十字线ref
      crosshairHLineRef.current = null
      crosshairVLineRef.current = null
      updateCrosshairNativeRef.current = null
      
      // 再次检查imageId是否还是目标imageId
      if (imageIdRef.current !== targetImageId) {
        console.warn('清理过程中imageId又变化了，取消加载新图片')
        return
      }
      
      // 加载当前图片的数据
      loadImage().catch(error => {
        console.error('加载图片失败:', error)
        message.error('加载图片失败')
      })
      loadAnnotations().catch(error => {
        console.error('加载标注失败:', error)
      })
      loadCurrentTask().catch(error => {
        console.error('加载任务包失败:', error)
      })
    }
    
    handleImageChange()
    
  }, [imageId, projectId, loadImage, loadAnnotations, loadCurrentTask, saveCurrentAnnotations])

  // 键盘快捷键处理（添加防抖，防止快速切换）
  useEffect(() => {
    let lastKeyTime = 0
    const DEBOUNCE_TIME = 300 // 300ms防抖
    
    const handleKeyPress = (e: KeyboardEvent) => {
      // 如果用户在输入框中，不处理快捷键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // 如果正在导航，忽略按键
      if (navigatingRef.current) {
        return
      }
      
      // 防抖：如果距离上次按键时间太短，忽略
      const now = Date.now()
      if (now - lastKeyTime < DEBOUNCE_TIME) {
        console.log('按键防抖，忽略快速按键')
        return
      }
      lastKeyTime = now
      
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        navigateToImage('prev')
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        navigateToImage('next')
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (fabricCanvasRef.current) {
          const activeObject = fabricCanvasRef.current.getActiveObject()
          if (activeObject?.type === 'rect') {
            fabricCanvasRef.current.remove(activeObject)
            fabricCanvasRef.current.discardActiveObject()
            fabricCanvasRef.current.renderAll()
            saveCurrentAnnotationsRef.current?.().catch(() => {})
          } else if (activeObject?.type === 'polygon') {
            const polygon = activeObject as fabric.Polygon
            const points = polygon.points || []
            const idx = selectedVertexIndexRef.current
            
            // 若已选中顶点且顶点数>3，则删除该顶点；否则删除整个多边形
            if (idx !== null && idx >= 0 && idx < points.length && points.length > 3) {
              const anchorIndex = idx === 0 ? 1 : 0
              const anchorPoint = points[anchorIndex]
              const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
              const transformMatrix = polygon.calcTransformMatrix()
              const anchorLocalX = anchorPoint.x - oldPathOffset.x
              const anchorLocalY = anchorPoint.y - oldPathOffset.y
              const anchorAbsolute = fabric.util.transformPoint(
                { x: anchorLocalX, y: anchorLocalY },
                transformMatrix
              )
              const newPoints = points.filter((_, i) => i !== idx)
              polygon.set({ points: newPoints })
              polygon._setPositionDimensions({})
              ;(polygon as any).dirty = true
              if ((polygon as any)._setPath) delete (polygon as any)._setPath
              const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
              const newAnchorLocalX = anchorPoint.x - newPathOffset.x
              const newAnchorLocalY = anchorPoint.y - newPathOffset.y
              const newTransformMatrix = polygon.calcTransformMatrix()
              const newAnchorAbsolute = fabric.util.transformPoint(
                { x: newAnchorLocalX, y: newAnchorLocalY },
                newTransformMatrix
              )
              const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
              const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
              if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
                polygon.set({
                  left: (polygon.left || 0) + deltaX,
                  top: (polygon.top || 0) + deltaY
                })
              }
              polygon.setCoords()
              selectedVertexIndexRef.current = null
              
              const delCategoryColor = (polygon as any).categoryId
                ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
                : '#FF0000'
              const delIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
              const delBaseOpts = {
                canvas: fabricCanvasRef.current!,
                categoryColor: delCategoryColor,
                isSegmentation: delIsSeg,
                enableEdgeControls: true,
                selectedVertexIndexRef,
                onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
              }
              createPolygonControls(polygon, {
                ...delBaseOpts,
                onRebuildControls: (poly) => createPolygonControls(poly, delBaseOpts),
              })
              fabricCanvasRef.current.renderAll()
              saveCurrentAnnotationsRef.current?.().catch(() => {})
            } else {
              fabricCanvasRef.current.remove(activeObject)
              fabricCanvasRef.current.discardActiveObject()
              fabricCanvasRef.current.renderAll()
              selectedVertexIndexRef.current = null
              saveCurrentAnnotationsRef.current?.().catch(() => {})
            }
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // 如果正在绘制矩形，按 ESC 取消
        if (isDrawingRef.current && fabricCanvasRef.current) {
          console.log('按下ESC，取消矩形绘制')
          if (rectRef.current) {
            fabricCanvasRef.current.remove(rectRef.current)
            rectRef.current = null
          }
          isDrawingRef.current = false
          startPointRef.current = null
          fabricCanvasRef.current.selection = true
          fabricCanvasRef.current.renderAll()
        } else if (isDrawingPolygonRef.current) {
          // 已有至少3个点时，ESC 完成多边形；否则取消
          if (polygonPointsRef.current.length >= 3) {
            finishPolygonDrawing()
          } else {
            cancelPolygonDrawing()
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (fabricCanvasRef.current && isDrawingPolygonRef.current && polygonPointsRef.current.length >= 3) {
          // 完成多边形绘制
          finishPolygonDrawing()
        } else if (isDrawingPolygonRef.current) {
          // 取消绘制
          cancelPolygonDrawing()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [allImages, imageId, projectId, navigateToImage, saveCurrentAnnotations, createPolygonControls, project])

  // 当图片列表或当前图片ID变化时，更新预览列表
  useEffect(() => {
    if (allImages.length > 0 && imageId) {
      updatePreviewImages(allImages, Number(imageId))
    }
  }, [allImages, imageId, updatePreviewImages])

  // 声明drawExistingAnnotations函数，以便在useEffect中使用
  const drawExistingAnnotations = useCallback((
    canvas: fabric.Canvas,
    annotations: any[],
    categories: Category[],
    originalImgWidth: number,
    originalImgHeight: number,
    scale: number,
    annotationType: string = 'detection'
  ) => {
    console.log('========== 开始绘制已有标注 ==========')
    console.log('标注数量:', annotations.length)
    console.log('类别数量:', categories.length)
    console.log('原图尺寸:', { width: originalImgWidth, height: originalImgHeight })
    console.log('缩放比例:', scale)
    console.log('Canvas尺寸:', { width: canvas.width, height: canvas.height })
    console.log('标注类型:', annotationType)
    
    // 根据标注类型清除已保存的标注对象（有annotationId标记的），保留未保存的标注对象
    const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
    const existingObjects = canvas.getObjects().filter((obj) => annotationTypes.includes(obj.type))
    const savedObjects = existingObjects.filter((obj) => {
      const annotationId = (obj as any).annotationId
      return annotationId !== undefined && annotationId !== null
    })
    const unsavedObjects = existingObjects.filter((obj) => {
      const annotationId = (obj as any).annotationId
      return annotationId === undefined || annotationId === null
    })
    console.log('清除已保存标注对象数量:', savedObjects.length, '保留未保存标注对象数量:', unsavedObjects.length)
    savedObjects.forEach((obj) => canvas.remove(obj))
    
    if (annotations.length === 0) {
      console.log('没有标注需要绘制')
      console.log('========== 绘制完成 ==========')
      canvas.renderAll()
      return
    }
    
    if (categories.length === 0) {
      console.warn('警告：没有类别数据，无法绘制标注')
      console.log('========== 绘制完成 ==========')
      canvas.renderAll()
      return
    }
    
    // 获取背景图片信息（需要在处理标注之前获取）
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage) {
      console.warn('警告：背景图片不存在，无法绘制标注')
      canvas.renderAll()
      return
    }
    
    // 计算实际的缩放比例和背景图片位置
    const bgImageScaleX = bgImage.scaleX || 1
    const bgImageScaleY = bgImage.scaleY || 1
    const bgImageLeft = bgImage.left || 0
    const bgImageTop = bgImage.top || 0
    // 使用背景图片的缩放比例作为scale（归一化坐标 * 原图尺寸 * scale = canvas坐标）
    const actualScale = bgImageScaleX
    
    // 绘制新的标注对象
    let successCount = 0
    let failCount = 0
    annotations.forEach((ann, index) => {
      try {
        console.log(`处理标注 ${index + 1}/${annotations.length}:`, {
          id: ann.id,
          category_id: ann.category_id,
          bbox_data: ann.bbox_data
        })
        
        const annotationData = JSON.parse(ann.bbox_data)
        console.log(`标注 ${index + 1} 解析后的数据:`, annotationData)
        
        const category = categories.find((c) => c.id === ann.category_id)
        
        if (!category) {
          console.warn(`警告：找不到类别ID ${ann.category_id}，跳过此标注`)
          failCount++
          return
        }
        
        const categoryColor = category.color || '#FF0000'
        
        if (annotationType === 'segmentation') {
          // 实例分割：只绘制多边形，不绘制矩形
          // 检查points字段（可能直接是points数组，也可能在polygon.points中）
          let points = null
          if (annotationData.points && Array.isArray(annotationData.points)) {
            points = annotationData.points
          } else if (annotationData.polygon && annotationData.polygon.points && Array.isArray(annotationData.polygon.points)) {
            points = annotationData.polygon.points
          }
          
          if (points && points.length >= 3) {
            // 实例分割：绘制多边形
            const normalizedPoints = points as number[][] // [[x1, y1], [x2, y2], ...] 归一化坐标
            
            console.log(`标注 ${index + 1} 坐标转换信息:`, {
              归一化坐标: normalizedPoints,
              原图尺寸: { width: originalImgWidth, height: originalImgHeight },
              缩放比例: scale,
              canvas尺寸: { width: canvas.width, height: canvas.height },
              actualScale: actualScale,
              bgImageLeft: bgImageLeft,
              bgImageTop: bgImageTop
            })
            
            // 将归一化坐标转换为canvas坐标
            // 归一化坐标是相对于原图的（0-1之间）
            // canvas坐标需要考虑：归一化坐标 * 原图尺寸 * 缩放比例 + 背景图片在canvas中的偏移
            const canvasPoints = normalizedPoints.map(([x, y]) => ({
              x: x * originalImgWidth * actualScale + bgImageLeft,
              y: y * originalImgHeight * actualScale + bgImageTop
            }))
            
            console.log(`标注 ${index + 1} canvas坐标:`, canvasPoints)
          
          // 计算多边形的边界框，用于设置left和top
          const minX = Math.min(...canvasPoints.map(p => p.x))
          const minY = Math.min(...canvasPoints.map(p => p.y))
          const maxX = Math.max(...canvasPoints.map(p => p.x))
          const maxY = Math.max(...canvasPoints.map(p => p.y))
          
          console.log(`标注 ${index + 1} 边界框:`, { minX, minY, maxX, maxY })
          
          // 将点坐标转换为相对于多边形左上角的局部坐标
          const localPoints = canvasPoints.map(p => ({
            x: p.x - minX,
            y: p.y - minY
          }))
          
          console.log(`标注 ${index + 1} 局部坐标:`, localPoints)
          
          // 如果是实例分割，禁用整体移动
          const isSegmentation = annotationType === 'segmentation'
          
          const polygonBaseStroke = 3
          const polygon = new fabric.Polygon(localPoints, {
            left: minX,
            top: minY,
            fill: 'transparent',
            stroke: categoryColor,
            strokeWidth: Math.max(0.5, polygonBaseStroke / (canvas.getZoom() || 1)),
            selectable: true,
            evented: true,
            // 禁用缩放和旋转
            hasControls: true, // 启用控制点显示（用于显示自定义顶点控制点）
            hasBorders: false, // 隐藏矩形包络线
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            lockUniScaling: true,
            lockMovementX: isSegmentation, // 实例分割时禁用X方向移动
            lockMovementY: isSegmentation, // 实例分割时禁用Y方向移动
          })
          ;(polygon as any)._baseStrokeWidth = polygonBaseStroke
          
          console.log(`标注 ${index + 1} 多边形创建完成:`, {
            left: polygon.left,
            top: polygon.top,
            width: polygon.width,
            height: polygon.height,
            points: polygon.points,
            stroke: polygon.stroke,
            strokeWidth: polygon.strokeWidth,
            fill: polygon.fill
          })
          
          const drawOpts = {
            canvas,
            categoryColor,
            isSegmentation,
            enableEdgeControls: true,
            selectedVertexIndexRef,
            onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            onRebuildControls: (poly: fabric.Polygon) => createPolygonControls(poly, {
              canvas,
              categoryColor,
              isSegmentation,
              enableEdgeControls: true,
              selectedVertexIndexRef,
              onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            }),
          }
          createPolygonControls(polygon, drawOpts)
          
          // 在多边形上存储类别ID和标注ID
          ;(polygon as any).categoryId = ann.category_id
          ;(polygon as any).annotationId = ann.id
          
          // 设置多边形的坐标，确保正确渲染
          polygon.setCoords()
          
          canvas.add(polygon)
          console.log(`标注 ${index + 1} 多边形绘制成功，points数量:`, normalizedPoints.length, '多边形位置:', { 
            left: polygon.left, 
            top: polygon.top, 
            width: polygon.width, 
            height: polygon.height,
            points: polygon.points,
            canvasObjectsCount: canvas.getObjects().length
          })
          successCount++
          } else {
            console.warn(`标注 ${index + 1} 是segmentation类型但缺少有效的polygon数据，跳过`, {
              annotationData: annotationData,
              hasPoints: !!annotationData.points,
              hasPolygon: !!annotationData.polygon,
              pointsType: typeof annotationData.points,
              pointsIsArray: Array.isArray(annotationData.points),
              pointsLength: Array.isArray(annotationData.points) ? annotationData.points.length : 0
            })
            failCount++
          }
        } else if (annotationType === 'detection' && annotationData.x_center !== undefined) {
          // 目标检测：绘制矩形框
          // 将YOLO格式转换为原图坐标
          const x_center = annotationData.x_center * originalImgWidth
          const y_center = annotationData.y_center * originalImgHeight
          const width = annotationData.width * originalImgWidth
          const height = annotationData.height * originalImgHeight
          
          // 转换为canvas坐标（使用背景图片的缩放比例，与convertToYOLO保持一致）
          // 原图坐标 * 缩放比例 + 背景图片偏移 = canvas坐标
          let canvasLeft = x_center - width / 2
          let canvasTop = y_center - height / 2
          let canvasWidth = width
          let canvasHeight = height
          
          // 乘以缩放比例
          canvasLeft = canvasLeft * actualScale
          canvasTop = canvasTop * actualScale
          canvasWidth = canvasWidth * actualScale
          canvasHeight = canvasHeight * actualScale
          
          // 加上背景图片偏移
          canvasLeft = canvasLeft + bgImageLeft
          canvasTop = canvasTop + bgImageTop
          
          // 裁剪矩形到图片边界内
          const imageLeft = bgImageLeft
          const imageTop = bgImageTop
          const imageRight = bgImageLeft + originalImgWidth * actualScale
          const imageBottom = bgImageTop + originalImgHeight * actualScale
          
          // 计算裁剪后的矩形
          const rectLeft = Math.max(imageLeft, canvasLeft)
          const rectTop = Math.max(imageTop, canvasTop)
          const rectRight = Math.min(imageRight, canvasLeft + canvasWidth)
          const rectBottom = Math.min(imageBottom, canvasTop + canvasHeight)
          
          // 如果矩形完全在图片外，跳过
          if (rectRight <= rectLeft || rectBottom <= rectTop) {
            console.warn(`标注 ${index + 1} 矩形完全在图片外，跳过`)
            failCount++
            return
          }
          
          canvasLeft = rectLeft
          canvasTop = rectTop
          canvasWidth = rectRight - rectLeft
          canvasHeight = rectBottom - rectTop
          
          console.log(`标注 ${index + 1} 坐标转换:`, {
            yoloBbox: annotationData,
            originalRect: { x_center, y_center, width, height },
            canvasRect: { left: canvasLeft, top: canvasTop, width: canvasWidth, height: canvasHeight },
            actualScale: actualScale,
            bgImageLeft: bgImageLeft,
            bgImageTop: bgImageTop,
            categoryColor: categoryColor
          })
          
          const rectBaseStroke = 2
          const rect = new fabric.Rect({
            left: canvasLeft,
            top: canvasTop,
            width: canvasWidth,
            height: canvasHeight,
            fill: 'transparent',
            stroke: categoryColor,
            strokeWidth: Math.max(0.5, rectBaseStroke / (canvas.getZoom() || 1)),
            strokeUniform: true, // 确保线宽不受对象缩放影响
            objectCaching: false, // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
            selectable: true,
            evented: true,
            lockRotation: true, // 目标检测标注框不支持旋转
          })
          ;(rect as any)._baseStrokeWidth = rectBaseStroke
          
          // 重写 _setObjectScale 方法，确保缩放时线宽不变
          const originalSetObjectScale = (rect as any)._setObjectScale
          if (originalSetObjectScale) {
            (rect as any)._setObjectScale = function(scaleX: number, scaleY: number, by: string) {
              const result = originalSetObjectScale.call(this, scaleX, scaleY, by)
              if (this.type === 'rect' && this.canvas) {
                const base = (this as any)._baseStrokeWidth ?? 2
                this.set({
                  strokeWidth: Math.max(0.5, base / this.canvas.getZoom()),
                  strokeUniform: true
                })
              }
              return result
            }
          }
          
          // 在矩形上存储类别ID和标注ID
          ;(rect as any).categoryId = ann.category_id
          ;(rect as any).annotationId = ann.id
          
          // 设置允许任意缩放，不保持宽高比；目标检测不支持旋转
          rect.set({
            uniformScaling: false,
            lockUniScaling: false,
            lockRotation: true
          })
          
          canvas.add(rect)
          console.log(`标注 ${index + 1} 矩形绘制成功`)
          successCount++
        } else {
          console.warn(`标注 ${index + 1} 数据格式不支持，跳过`)
          failCount++
        }
      } catch (error) {
        console.error(`标注 ${index + 1} 绘制失败:`, error, ann)
        failCount++
      }
    })
    
    console.log('绘制结果:', {
      成功: successCount,
      失败: failCount,
      总计: annotations.length,
      canvas对象总数: canvas.getObjects().length,
      canvas对象列表: canvas.getObjects().map(obj => ({
        type: obj.type,
        left: obj.left,
        top: obj.top,
        width: obj.width,
        height: obj.height
      }))
    })
    console.log('========== 绘制完成 ==========')
    
    // 强制渲染，确保所有对象都显示
    canvas.renderAll()
    console.log('canvas.renderAll() 已调用，canvas对象数量:', canvas.getObjects().length)
    
    // 绘制完成后，更新类别计数
    // 使用 setTimeout 确保在 renderAll 完成后再更新
    setTimeout(() => {
      if (updateCategoryCountsRef.current) {
        updateCategoryCountsRef.current()
      }
    }, 50)
  }, [createPolygonControls])

  // 当annotations或categories变化时，重新绘制已有标注
  useEffect(() => {
    console.log('========== 检查是否需要绘制标注 ==========')
    console.log('fabricCanvasRef.current:', !!fabricCanvasRef.current)
    console.log('image:', !!image, image?.id)
    console.log('annotations.length:', annotations.length)
    console.log('categories.length:', categories.length)
    
    if (!fabricCanvasRef.current) {
      console.log('Canvas不存在，跳过绘制')
      return
    }
    
    if (!image) {
      console.log('图片不存在，跳过绘制')
      return
    }
    
    // 检查imageId是否匹配
    const currentImageId = imageIdRef.current
    if (image.id !== Number(currentImageId)) {
      console.warn('绘制标注时imageId不匹配，取消绘制。期望:', currentImageId, '实际:', image.id)
      return
    }
    
    // 检查canvas的imageId是否匹配
    const canvasImageId = (fabricCanvasRef.current as any)._currentImageId
    if (canvasImageId !== image.id) {
      console.warn('绘制标注时canvas imageId不匹配，取消绘制。Canvas:', canvasImageId, '期望:', image.id)
      return
    }
    
    // 获取项目类型
    const annotationType = project?.annotation_type || 'detection'
    
    if (annotations.length === 0) {
      console.log('没有标注数据，只清除已保存的标注对象，保留未保存的标注对象')
      const canvas = fabricCanvasRef.current
      const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
      const existingObjects = canvas.getObjects().filter((obj) => annotationTypes.includes(obj.type))
      const savedObjects = existingObjects.filter((obj) => {
        const annotationId = (obj as any).annotationId
        return annotationId !== undefined && annotationId !== null
      })
      savedObjects.forEach((obj) => canvas.remove(obj))
      canvas.renderAll()
      // 更新类别计数（即使没有标注也要更新，因为可能删除了所有标注）
      setTimeout(() => {
        if (updateCategoryCountsRef.current) {
          updateCategoryCountsRef.current()
        }
      }, 100)
      return
    }
    
    if (categories.length === 0) {
      console.log('没有类别数据，跳过绘制')
      return
    }
    
    const canvas = fabricCanvasRef.current
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height || !canvas.width || !canvas.height) {
      console.log('背景图片或Canvas尺寸不完整，跳过绘制（等待背景图片加载完成）', {
        bgImage: !!bgImage,
        bgImageWidth: bgImage?.width,
        bgImageHeight: bgImage?.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      })
      return
    }
    
    // 使用原图尺寸绘制标注对象
    const originalImgWidth = image.width || bgImage.width
    const originalImgHeight = image.height || bgImage.height
    
    // 计算缩放比例（使用背景图片的scaleX，而不是canvas.width / bgImage.width，因为canvas包含边距）
    const scaleForDraw = bgImage.scaleX || 1
    
    console.log('开始绘制标注，参数:', {
      canvasSize: { width: canvas.width, height: canvas.height },
      bgImageSize: { width: bgImage.width, height: bgImage.height },
      originalImgSize: { width: originalImgWidth, height: originalImgHeight },
      scale: scaleForDraw,
      annotationsCount: annotations.length,
      categoriesCount: categories.length,
      annotationType: annotationType
    })
    
    // 调用drawExistingAnnotations函数（该函数内部会重新获取bgImage并计算actualScale等变量）
    // drawExistingAnnotations 内部会在绘制完成后通过 ref 调用 updateCategoryCounts
    drawExistingAnnotations(canvas, annotations, categories, originalImgWidth, originalImgHeight, scaleForDraw, annotationType)
  }, [annotations, categories, image, drawExistingAnnotations])

  useEffect(() => {
    // 当image加载完成后，创建新的canvas
    if (!image || !canvasRef.current) {
      return
    }
    
    // 检查imageId是否匹配（使用最新的imageId）
    const currentImageId = imageIdRef.current
    const targetImageId = image.id
    
    if (targetImageId !== Number(currentImageId)) {
      // 这是正常的，因为image状态更新是异步的，旧的image状态会短暂存在
      // 当image更新到新的图片时，会再次触发这个useEffect，那时就会匹配
      console.debug('创建canvas时imageId不匹配（预期行为），跳过。期望:', currentImageId, '实际:', targetImageId)
      return
    }
    
    // 如果canvas已存在且是同一张图片，不需要重新创建
    if (fabricCanvasRef.current) {
      const existingCanvasImageId = (fabricCanvasRef.current as any)._currentImageId
      if (existingCanvasImageId === targetImageId) {
        console.log('Canvas已存在且图片ID匹配，跳过创建')
        return
      }
      // 如果canvas存在但不是当前图片，先清理
      try {
        console.log('清理旧canvas，准备创建新的，旧ID:', existingCanvasImageId, '新ID:', targetImageId)
        fabricCanvasRef.current.dispose()
      } catch (error) {
        console.error('清理旧canvas时出错:', error)
      }
      fabricCanvasRef.current = null
      // 清理十字线ref
      crosshairHLineRef.current = null
      crosshairVLineRef.current = null
      updateCrosshairNativeRef.current = null
    }
    
    // 再次检查imageId是否匹配（防止在清理过程中又切换了）
    if (imageIdRef.current !== currentImageId || image.id !== targetImageId) {
      console.warn('清理后imageId已变化，取消创建canvas')
      return
    }
    
    console.log('创建新canvas，图片ID:', targetImageId, 'filepath:', image.filepath, '当前imageId:', currentImageId)
    
    try {
      const canvas = new fabric.Canvas(canvasRef.current, {
        width: 800,
        height: 600,
        stopContextMenu: true, // 阻止右键菜单
        selection: true, // 启用选择，以便删除标注框
        uniformScaling: false, // 全局设置：允许任意缩放
      })
      
      // 监听渲染前事件，确保所有矩形和多边形的线宽按 zoom 反比（放大时线不变粗）
      canvas.on('before:render', () => {
        const zoom = canvas.getZoom() || 1
        canvas.getObjects().forEach((obj) => {
          if (obj.type === 'rect') {
            const rect = obj as fabric.Rect
            const base = (rect as any)._baseStrokeWidth ?? 2
            rect.set({
              strokeWidth: Math.max(0.5, base / zoom),
              strokeUniform: true,
              objectCaching: false // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
            }, false)
            ;(rect as any)._baseStrokeWidth = base
          } else if (obj.type === 'polygon') {
            const poly = obj as fabric.Polygon
            const base = (poly as any)._baseStrokeWidth ?? 3
            poly.set('strokeWidth', Math.max(0.5, base / zoom), false)
            ;(poly as any)._baseStrokeWidth = base
          }
        })
      })
      
      // 监听对象被选中事件
      canvas.on('selection:created', (e) => {
        // 如果正在绘制，不处理选择
        if (isDrawingRef.current) {
          return
        }
        const activeObject = e.selected?.[0] || canvas.getActiveObject()
        if (activeObject) {
          // 选中对象时隐藏十字辅助线
          hideCrosshair()
          
          const zoom = canvas.getZoom() || 1
          if (activeObject.type === 'rect') {
            hasActiveAnnotationRef.current = true
            const base = (activeObject as any)._baseStrokeWidth ?? 2
            activeObject.set({
              uniformScaling: false,
              lockUniScaling: false,
              lockRotation: true, // 目标检测标注框不支持旋转
              strokeWidth: Math.max(0.5, base / zoom),
              strokeUniform: true,
              objectCaching: false, // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
              // 设置控制点颜色，使其在浅色图片下更明显
              cornerColor: '#1890ff', // 深蓝色填充
              cornerStrokeColor: '#ffffff', // 白色边框
              cornerSize: 12, // 控制点大小
              transparentCorners: false // 使用填充而不是描边，更明显
            })
            ;(activeObject as any)._baseStrokeWidth = base
            // 隐藏旋转锚点（目标检测不支持旋转）
            activeObject.controls = {
              ...(activeObject.controls || {}),
              mtr: new fabric.Control({ visible: false })
            }
          } else if (activeObject.type === 'polygon') {
            // 多边形：禁用缩放，只允许移动和编辑顶点
            const polygon = activeObject as fabric.Polygon
            
            // 更新选中状态
            hasActivePolygonRef.current = true
            hasActiveAnnotationRef.current = true
            
            const polyBase = (polygon as any)._baseStrokeWidth ?? 3
            polygon.set({
              strokeWidth: Math.max(0.5, polyBase / zoom),
              hasControls: true,
              hasBorders: false,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true,
              lockUniScaling: true,
              lockMovementX: (projectRef.current || project)?.annotation_type === 'segmentation',
              lockMovementY: (projectRef.current || project)?.annotation_type === 'segmentation',
            })
            ;(polygon as any)._baseStrokeWidth = polyBase
            
            const selCategoryColor = (polygon as any).categoryId 
              ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
              : '#FF0000'
            const selIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
            const selBaseOpts = {
              canvas,
              categoryColor: selCategoryColor,
              isSegmentation: selIsSeg,
              enableEdgeControls: true,
              selectedVertexIndexRef,
              onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            }
            createPolygonControls(polygon, {
              ...selBaseOpts,
              onRebuildControls: (poly) => createPolygonControls(poly, selBaseOpts),
            })
            canvas.renderAll()
          }
          canvas.renderAll()
        }
      })
      
      // 监听选择清除事件
      // 延迟清除 ref，给 mouse:down 事件处理一个机会来检查状态
      canvas.on('selection:cleared', () => {
        // 使用 setTimeout 延迟清除，确保 mouse:down 事件处理能够先检查状态
        setTimeout(() => {
          hasActivePolygonRef.current = false
          hasActiveAnnotationRef.current = false
          selectedVertexIndexRef.current = null
          // 取消选中时，如果有最后一次鼠标事件，重新显示十字辅助线
          if (lastMouseEventRef.current && updateCrosshairNativeRef.current) {
            updateCrosshairNativeRef.current(lastMouseEventRef.current)
          }
        }, 0)
      })
      
      canvas.on('selection:updated', (e) => {
        // 如果正在绘制，不处理选择
        if (isDrawingRef.current) {
          return
        }
        const activeObject = e.selected?.[0] || canvas.getActiveObject()
        if (activeObject) {
          // 选中对象时隐藏十字辅助线
          hideCrosshair()
          
          const zoom = canvas.getZoom() || 1
          if (activeObject.type === 'rect') {
            hasActiveAnnotationRef.current = true
            const base = (activeObject as any)._baseStrokeWidth ?? 2
            activeObject.set({
              uniformScaling: false,
              lockUniScaling: false,
              lockRotation: true, // 目标检测标注框不支持旋转
              strokeWidth: Math.max(0.5, base / zoom),
              strokeUniform: true,
              objectCaching: false, // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
              // 设置控制点颜色，使其在浅色图片下更明显
              cornerColor: '#1890ff', // 深蓝色填充
              cornerStrokeColor: '#ffffff', // 白色边框
              cornerSize: 12, // 控制点大小
              transparentCorners: false // 使用填充而不是描边，更明显
            })
            ;(activeObject as any)._baseStrokeWidth = base
            // 隐藏旋转锚点（目标检测不支持旋转）
            activeObject.controls = {
              ...(activeObject.controls || {}),
              mtr: new fabric.Control({ visible: false })
            }
          } else if (activeObject.type === 'polygon') {
            // 多边形：禁用缩放，只允许移动和编辑顶点
            const polygon = activeObject as fabric.Polygon
            
            hasActivePolygonRef.current = true
            
            const polyBase = (polygon as any)._baseStrokeWidth ?? 3
            polygon.set({
              strokeWidth: Math.max(0.5, polyBase / zoom),
              hasControls: true,
              hasBorders: false,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true,
              lockUniScaling: true,
              lockMovementX: (projectRef.current || project)?.annotation_type === 'segmentation',
              lockMovementY: (projectRef.current || project)?.annotation_type === 'segmentation',
            })
            ;(polygon as any)._baseStrokeWidth = polyBase
            
            const updCategoryColor = (polygon as any).categoryId 
              ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
              : '#FF0000'
            const updIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
            const updBaseOpts = {
              canvas,
              categoryColor: updCategoryColor,
              isSegmentation: updIsSeg,
              enableEdgeControls: true,
              selectedVertexIndexRef,
              onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            }
            createPolygonControls(polygon, {
              ...updBaseOpts,
              onRebuildControls: (poly) => createPolygonControls(poly, updBaseOpts),
            })
            
            
            // 强制刷新canvas以显示控制点
            canvas.renderAll()
          }
          canvas.renderAll()
        }
      })
      
      // 监听对象缩放事件，确保矩形框的线宽按 zoom 反比
      canvas.on('object:scaling', (e) => {
        const obj = e.target
        if (obj && obj.type === 'rect' && obj.canvas) {
          const rect = obj as fabric.Rect
          const base = (rect as any)._baseStrokeWidth ?? 2
          rect.set({
            strokeWidth: Math.max(0.5, base / obj.canvas.getZoom()),
            strokeUniform: true
          }, false)
          rect.setCoords()
        }
      })
      
      // 监听对象移动事件，确保矩形框的线宽按 zoom 反比
      canvas.on('object:moving', (e) => {
        const obj = e.target
        if (obj && obj.type === 'rect' && obj.canvas) {
          const rect = obj as fabric.Rect
          const base = (rect as any)._baseStrokeWidth ?? 2
          const want = Math.max(0.5, base / obj.canvas.getZoom())
          if (Math.abs((rect.strokeWidth || 0) - want) > 0.01 || !rect.strokeUniform) {
            rect.set({
              strokeWidth: want,
              strokeUniform: true
            })
          }
        }
      })
      
      // 监听对象修改事件（包括缩放结束）
      canvas.on('object:modified', (e) => {
        const obj = e.target
        if (obj && obj.type === 'rect' && obj.canvas) {
          console.log('object:modified 事件触发，对象类型: rect')
          const rect = obj as fabric.Rect
          const base = (rect as any)._baseStrokeWidth ?? 2
          rect.set({
            strokeWidth: Math.max(0.5, base / obj.canvas.getZoom()),
            strokeUniform: true
          })
          
          // 规范化矩形：确保width和height都是正数
          // 当拖动边越过另一边时，width或height可能变成负数
          const scaleX = rect.scaleX || 1
          const scaleY = rect.scaleY || 1
          const originX = rect.originX || 'left'
          const originY = rect.originY || 'top'
          const baseWidth = rect.width || 0
          const baseHeight = rect.height || 0
          const displayWidth = baseWidth * scaleX
          const displayHeight = baseHeight * scaleY
          
          // 根据原点计算实际显示的左上角坐标
          let actualLeft = rect.left || 0
          let actualTop = rect.top || 0
          
          if (originX === 'center') {
            actualLeft = actualLeft - displayWidth / 2
          } else if (originX === 'right') {
            actualLeft = actualLeft - displayWidth
          }
          
          if (originY === 'center') {
            actualTop = actualTop - displayHeight / 2
          } else if (originY === 'bottom') {
            actualTop = actualTop - displayHeight
          }
          
          // 检查是否需要规范化（width或height为负数）
          const needsNormalize = displayWidth < 0 || displayHeight < 0
          
          if (needsNormalize) {
            console.log('检测到矩形被翻转，开始规范化:', {
              old: { left: rect.left, top: rect.top, width: baseWidth, height: baseHeight, scaleX, scaleY },
              displayWidth, displayHeight, actualLeft, actualTop
            })
            
            // 规范化：确保width和height都是正数
            let normalizedLeft = actualLeft
            let normalizedTop = actualTop
            let normalizedWidth = displayWidth
            let normalizedHeight = displayHeight
            
            if (normalizedWidth < 0) {
              normalizedLeft = normalizedLeft + normalizedWidth
              normalizedWidth = Math.abs(normalizedWidth)
            }
            
            if (normalizedHeight < 0) {
              normalizedTop = normalizedTop + normalizedHeight
              normalizedHeight = Math.abs(normalizedHeight)
            }
            
            // 更新矩形：重置缩放，设置规范化的位置和尺寸
            rect.set({
              left: normalizedLeft,
              top: normalizedTop,
              width: normalizedWidth,
              height: normalizedHeight,
              scaleX: 1,
              scaleY: 1,
              originX: 'left',
              originY: 'top'
            })
            rect.setCoords()
            canvas.renderAll()
            
            console.log('矩形规范化完成:', {
              new: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            })
          }
          
          // 只在目标检测模式下裁剪矩形
          const currentProject = projectRef.current || project
          const annotationType = currentProject?.annotation_type || 'detection'
          console.log('当前项目类型:', annotationType)
          
          if (annotationType !== 'detection') {
            console.log('不是目标检测模式，跳过裁剪')
            // 如果不是目标检测模式，跳过裁剪
            const annotationId = (rect as any).annotationId
            if (annotationId !== undefined && annotationId !== null) {
              if (saveCurrentAnnotationsRef.current) {
                saveCurrentAnnotationsRef.current().catch(error => {
                  console.error('矩形修改后保存失败:', error)
                })
              }
            }
            return
          }
          
          // 裁剪矩形到图片边界内
          const bgImage = canvas.backgroundImage as fabric.Image
          if (!bgImage || !bgImage.width || !bgImage.height) {
            console.warn('无法裁剪：背景图片不存在或尺寸无效', {
              bgImage: !!bgImage,
              width: bgImage?.width,
              height: bgImage?.height
            })
            return
          }
          
          console.log('开始裁剪检查...')
          
          // 获取图片边界（在canvas坐标系中）
          // 注意：bgImage的left/top是相对于canvas的，已经考虑了viewportTransform
          const imageLeft = bgImage.left || 0
          const imageTop = bgImage.top || 0
          const imageWidth = bgImage.width * (bgImage.scaleX || 1)
          const imageHeight = bgImage.height * (bgImage.scaleY || 1)
          const imageRight = imageLeft + imageWidth
          const imageBottom = imageTop + imageHeight
          
          // 确保图片边界有效
          if (imageWidth <= 0 || imageHeight <= 0) {
            console.warn('图片尺寸无效，跳过裁剪')
            return
          }
          
          console.log('裁剪检查 - 图片边界:', { imageLeft, imageTop, imageRight, imageBottom, imageWidth, imageHeight })
          
          // 获取矩形的实际边界框
          // 方法1：使用 getBoundingRect() 获取矩形的边界框（已考虑所有变换，包括缩放、旋转等）
          const boundingRect = rect.getBoundingRect()
          let rectLeft = boundingRect.left
          let rectTop = boundingRect.top
          let rectRight = rectLeft + boundingRect.width
          let rectBottom = rectTop + boundingRect.height
          
          // 方法2：直接计算矩形的实际显示位置和尺寸（考虑缩放和原点）
          // 注意：scaleX, scaleY, originX, originY, baseWidth, baseHeight, displayWidth, displayHeight, actualLeft, actualTop 已经在上面声明过了
          // 如果矩形被规范化了，使用规范化后的属性重新计算
          let rectLeft2: number
          let rectTop2: number
          let rectRight2: number
          let rectBottom2: number
          
          if (needsNormalize) {
            // 规范化后，矩形已经被更新，使用更新后的属性
            const normalizedScaleX = rect.scaleX || 1
            const normalizedScaleY = rect.scaleY || 1
            const normalizedOriginX = rect.originX || 'left'
            const normalizedOriginY = rect.originY || 'top'
            const normalizedBaseWidth = rect.width || 0
            const normalizedBaseHeight = rect.height || 0
            const normalizedDisplayWidth = normalizedBaseWidth * normalizedScaleX
            const normalizedDisplayHeight = normalizedBaseHeight * normalizedScaleY
            
            let normalizedActualLeft = rect.left || 0
            let normalizedActualTop = rect.top || 0
            
            if (normalizedOriginX === 'center') {
              normalizedActualLeft = normalizedActualLeft - normalizedDisplayWidth / 2
            } else if (normalizedOriginX === 'right') {
              normalizedActualLeft = normalizedActualLeft - normalizedDisplayWidth
            }
            
            if (normalizedOriginY === 'center') {
              normalizedActualTop = normalizedActualTop - normalizedDisplayHeight / 2
            } else if (normalizedOriginY === 'bottom') {
              normalizedActualTop = normalizedActualTop - normalizedDisplayHeight
            }
            
            rectLeft2 = normalizedActualLeft
            rectTop2 = normalizedActualTop
            rectRight2 = normalizedActualLeft + normalizedDisplayWidth
            rectBottom2 = normalizedActualTop + normalizedDisplayHeight
          } else {
            // 使用之前计算的值
            rectLeft2 = actualLeft
            rectTop2 = actualTop
            rectRight2 = actualLeft + displayWidth
            rectBottom2 = actualTop + displayHeight
          }
          
          console.log('裁剪检查 - 矩形边界 (方法1 getBoundingRect):', { 
            rectLeft, 
            rectTop, 
            rectRight, 
            rectBottom,
            width: boundingRect.width,
            height: boundingRect.height
          })
          console.log('裁剪检查 - 矩形边界 (方法2 直接计算):', { 
            rectLeft: rectLeft2, 
            rectTop: rectTop2, 
            rectRight: rectRight2, 
            rectBottom: rectBottom2,
            displayWidth,
            displayHeight
          })
          console.log('裁剪检查 - 矩形属性:', { 
            left: rect.left, 
            top: rect.top, 
            width: baseWidth, 
            height: baseHeight,
            scaleX,
            scaleY,
            originX,
            originY
          })
          
          // 使用两种方法中更准确的一个（优先使用方法2，因为它直接基于矩形的属性）
          // 但如果两种方法差异很大，可能需要检查坐标系统
          const useMethod2 = Math.abs(rectLeft - rectLeft2) < 10 && Math.abs(rectTop - rectTop2) < 10
          if (!useMethod2) {
            console.warn('两种方法计算的边界不一致，使用方法2')
          }
          
          rectLeft = rectLeft2
          rectTop = rectTop2
          rectRight = rectRight2
          rectBottom = rectBottom2
          
          // 验证坐标系统：检查矩形是否真的超出图片边界
          const isOutOfBounds = rectLeft < imageLeft || rectTop < imageTop || 
                                rectRight > imageRight || rectBottom > imageBottom
          console.log('裁剪检查 - 是否超出边界:', isOutOfBounds, {
            left: rectLeft < imageLeft,
            top: rectTop < imageTop,
            right: rectRight > imageRight,
            bottom: rectBottom > imageBottom
          })
          
          // 首先检查矩形是否完全在图片外（在画布内但在图片外）
          const isCompletelyOutside = isRectCompletelyOutsideImage(rect, canvas)
          
          console.log('object:modified 检查矩形是否在图片外:', {
            rectLeft, rectTop, rectRight, rectBottom,
            imageLeft, imageTop, imageRight, imageBottom,
            imageWidth, imageHeight,
            bgImageLeft: bgImage.left,
            bgImageTop: bgImage.top,
            bgImageScaleX: bgImage.scaleX,
            bgImageScaleY: bgImage.scaleY,
            bgImageWidth: bgImage.width,
            bgImageHeight: bgImage.height,
            isCompletelyOutside,
            checks: {
              left: rectRight <= imageLeft,
              right: rectLeft >= imageRight,
              top: rectBottom <= imageTop,
              bottom: rectTop >= imageBottom
            }
          })
          
          if (isCompletelyOutside) {
            // 矩形完全在图片外，删除它
            console.log('object:modified：矩形完全在图片外，删除矩形')
            
            const annotationId = (rect as any).annotationId
            canvas.remove(rect)
            canvas.renderAll()
            
            // 如果矩形有对应的标注，需要删除标注
            if (annotationId !== undefined && annotationId !== null) {
              // 删除标注的逻辑会在保存时处理（因为矩形已从canvas移除，保存时不会包含它）
              // 但为了立即更新，可以触发一次保存
              if (saveCurrentAnnotationsRef.current) {
                saveCurrentAnnotationsRef.current().catch(error => {
                  console.error('删除超出边界的矩形后保存失败:', error)
                })
              }
            }
            return
          }
          
          // 计算裁剪后的边界
          const clippedLeft = Math.max(rectLeft, imageLeft)
          const clippedTop = Math.max(rectTop, imageTop)
          const clippedRight = Math.min(rectRight, imageRight)
          const clippedBottom = Math.min(rectBottom, imageBottom)
          
          // 检查是否需要裁剪（矩形部分超出图片边界）
          const needsClip = clippedLeft > rectLeft || clippedTop > rectTop ||
                           clippedRight < rectRight || clippedBottom < rectBottom
          
          console.log('裁剪检查 - 是否需要裁剪:', needsClip, {
            clippedLeft, clippedTop, clippedRight, clippedBottom,
            rectLeft, rectTop, rectRight, rectBottom
          })
          
          if (needsClip) {
            
            // 矩形部分在图片内，裁剪到图片边界内
            // 计算裁剪后的尺寸（实际显示尺寸）
            const clippedWidth = clippedRight - clippedLeft
            const clippedHeight = clippedBottom - clippedTop
            
            // 直接设置矩形的实际位置和尺寸，重置缩放为1
            // 矩形的 left 和 top 是相对于原点的，默认原点是 'left' 和 'top'
            // 所以直接使用裁剪后的左上角坐标
            const newLeft = clippedLeft
            const newTop = clippedTop
            const newWidth = clippedWidth
            const newHeight = clippedHeight
            
            console.log('执行裁剪:', {
              old: { 
                left: rect.left, 
                top: rect.top, 
                width: rect.width, 
                height: rect.height,
                scaleX: rect.scaleX,
                scaleY: rect.scaleY,
                boundingRect: {
                  left: rectLeft,
                  top: rectTop,
                  width: rectRight - rectLeft,
                  height: rectBottom - rectTop
                }
              },
              new: { 
                left: newLeft, 
                top: newTop, 
                width: newWidth, 
                height: newHeight,
                scaleX: 1,
                scaleY: 1
              },
              clippedBounds: {
                left: clippedLeft,
                top: clippedTop,
                width: clippedWidth,
                height: clippedHeight
              }
            })
            
            // 更新矩形：设置新的位置和尺寸，重置缩放
            rect.set({
              left: newLeft,
              top: newTop,
              width: newWidth,
              height: newHeight,
              scaleX: 1,
              scaleY: 1,
              originX: 'left', // 确保原点是左上角
              originY: 'top'   // 确保原点是左上角
            })
            rect.setCoords()
            canvas.renderAll()
            
            console.log('裁剪完成，新矩形:', {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              scaleX: rect.scaleX,
              scaleY: rect.scaleY
            })
          }
          
          // 如果是已保存的标注，自动保存
          const annotationId = (rect as any).annotationId
          if (annotationId !== undefined && annotationId !== null) {
            if (saveCurrentAnnotationsRef.current) {
              saveCurrentAnnotationsRef.current().catch(error => {
                console.error('矩形修改后保存失败:', error)
              })
            }
          }
          return
        }
        
        if (obj && obj.type === 'polygon') {
          const polygon = obj as fabric.Polygon
          const points = polygon.points || []
          
          if (points.length < 3) {
            return
          }
          
          // 获取 pathOffset
          const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          
          // 将多边形的局部坐标顶点转换为 canvas 坐标
          const transformMatrix = polygon.calcTransformMatrix()
          const canvasPoints = points.map((point: any) => {
            const pointLocalX = point.x - pathOffset.x
            const pointLocalY = point.y - pathOffset.y
            return fabric.util.transformPoint(
              { x: pointLocalX, y: pointLocalY },
              transformMatrix
            )
          })
          
          // 裁剪到图片边界内
          const clippedCanvasPoints = clipPolygonToImageBounds(canvasPoints)
          
          // 如果裁剪后点数不足，不进行裁剪（保持原样）
          if (clippedCanvasPoints.length < 3) {
            console.warn('多边形裁剪后点数不足，保持原样')
            // 仍然保存
            if (saveCurrentAnnotationsRef.current) {
              saveCurrentAnnotationsRef.current().catch(error => {
                console.error('多边形修改后保存失败:', error)
              })
            }
            return
          }
          
          // 检查是否有顶点被裁剪（比较点数或位置）
          const pointsChanged = clippedCanvasPoints.length !== canvasPoints.length ||
            clippedCanvasPoints.some((clipped, i) => {
              if (i >= canvasPoints.length) return true
              const dx = Math.abs(clipped.x - canvasPoints[i].x)
              const dy = Math.abs(clipped.y - canvasPoints[i].y)
              return dx > 0.1 || dy > 0.1
            })
          
          if (pointsChanged) {
            // 将裁剪后的 canvas 坐标转换回局部坐标
            const invertedMatrix = fabric.util.invertTransform(transformMatrix)
            const clippedLocalPoints = clippedCanvasPoints.map((canvasPoint) => {
              const localPoint = fabric.util.transformPoint(
                canvasPoint,
                invertedMatrix
              )
              return {
                x: localPoint.x + pathOffset.x,
                y: localPoint.y + pathOffset.y
              }
            })
            
            // 更新多边形的顶点
            polygon.set({ points: clippedLocalPoints })
            
            // 重新计算边界框和 pathOffset
            polygon._setPositionDimensions({})
            
            // 强制标记为需要重新渲染
            ;(polygon as any).dirty = true
            if ((polygon as any)._setPath) {
              delete (polygon as any)._setPath
            }
            
            // 获取新的 pathOffset
            const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
            
            // 如果 pathOffset 改变了，需要调整 left/top 以保持多边形的绝对位置
            if (Math.abs(newPathOffset.x - pathOffset.x) > 0.001 || 
                Math.abs(newPathOffset.y - pathOffset.y) > 0.001) {
              const deltaX = pathOffset.x - newPathOffset.x
              const deltaY = pathOffset.y - newPathOffset.y
              
              // 重新计算第一个顶点的绝对位置（使用旧的 pathOffset）
              const firstPointOld = points[0]
              const firstPointOldLocalX = firstPointOld.x - pathOffset.x
              const firstPointOldLocalY = firstPointOld.y - pathOffset.y
              const firstPointOldAbsolute = fabric.util.transformPoint(
                { x: firstPointOldLocalX, y: firstPointOldLocalY },
                transformMatrix
              )
              
              // 计算第一个顶点的新局部位置（使用新的 pathOffset）
              const firstPointNew = clippedLocalPoints[0]
              const firstPointNewLocalX = firstPointNew.x - newPathOffset.x
              const firstPointNewLocalY = firstPointNew.y - newPathOffset.y
              
              // 计算新的变换矩阵（使用当前的 left/top）
              const newTransformMatrix = polygon.calcTransformMatrix()
              const firstPointNewAbsolute = fabric.util.transformPoint(
                { x: firstPointNewLocalX, y: firstPointNewLocalY },
                newTransformMatrix
              )
              
              // 调整 left/top 以保持第一个顶点的绝对位置不变
              const adjustDeltaX = firstPointOldAbsolute.x - firstPointNewAbsolute.x
              const adjustDeltaY = firstPointOldAbsolute.y - firstPointNewAbsolute.y
              
              if (Math.abs(adjustDeltaX) > 0.001 || Math.abs(adjustDeltaY) > 0.001) {
                polygon.set({
                  left: (polygon.left || 0) + adjustDeltaX,
                  top: (polygon.top || 0) + adjustDeltaY
                })
              }
            }
            
            polygon.setCoords()
            canvas.renderAll()
          }
          
          // 多边形被修改后自动保存
          if (saveCurrentAnnotationsRef.current) {
            saveCurrentAnnotationsRef.current().catch(error => {
              console.error('多边形修改后保存失败:', error)
            })
          }
        }
      })
      
      
      // 设置canvas容器样式，确保不会拦截header的事件
      const canvasContainer = canvasRef.current.parentElement
      if (canvasContainer) {
        canvasContainer.style.pointerEvents = 'auto'
        // 确保容器可以接收点击事件
        canvasContainer.style.cursor = 'crosshair'
      }
      
      // 检查图片是否完全在画布内显示
      const isImageFullyVisible = (): boolean => {
        const bgImage = canvas.backgroundImage as fabric.Image
        if (!bgImage || !bgImage.width || !bgImage.height) {
          return true // 如果没有背景图片，默认允许拖动
        }
        
        const zoom = canvas.getZoom()
        const vpt = canvas.viewportTransform
        
        if (!vpt) {
          return true
        }
        
        // 获取画布尺寸
        const canvasWidth = canvas.width || 0
        const canvasHeight = canvas.height || 0
        
        // 背景图片的原始尺寸（已经考虑了背景图片的缩放）
        const bgImageWidth = bgImage.width * (bgImage.scaleX || 1)
        const bgImageHeight = bgImage.height * (bgImage.scaleY || 1)
        
        // 计算图片在画布中的实际显示尺寸（考虑视口缩放）
        const imageDisplayWidth = bgImageWidth * zoom
        const imageDisplayHeight = bgImageHeight * zoom
        
        // 背景图片在画布中的原始位置（通常是 0, 0）
        const bgImageLeft = bgImage.left || 0
        const bgImageTop = bgImage.top || 0
        
        // 计算图片在画布中的实际位置（考虑视口变换）
        // vpt[4] 和 vpt[5] 是视口平移量
        const imageLeft = bgImageLeft + vpt[4]
        const imageTop = bgImageTop + vpt[5]
        const imageRight = imageLeft + imageDisplayWidth
        const imageBottom = imageTop + imageDisplayHeight
        
        // 判断图片是否完全在画布内
        // 如果图片的任何部分在画布外，返回 false（允许拖动）
        const isFullyVisible = imageLeft >= 0 && 
                               imageTop >= 0 && 
                               imageRight <= canvasWidth && 
                               imageBottom <= canvasHeight
        
        console.log('图片可见性检查:', {
          zoom,
          canvasSize: { width: canvasWidth, height: canvasHeight },
          bgImageSize: { width: bgImageWidth, height: bgImageHeight },
          imageDisplaySize: { width: imageDisplayWidth, height: imageDisplayHeight },
          bgImagePos: { left: bgImageLeft, top: bgImageTop },
          viewportTranslate: { x: vpt[4], y: vpt[5] },
          imagePosition: { left: imageLeft, top: imageTop, right: imageRight, bottom: imageBottom },
          isFullyVisible
        })
        
        return isFullyVisible
      }
      
      // 限制图片移动范围，确保图片不会完全移出画布
      const constrainImagePosition = (vpt: number[]): void => {
        const bgImage = canvas.backgroundImage as fabric.Image
        if (!bgImage || !bgImage.width || !bgImage.height) {
          return
        }
        
        const zoom = canvas.getZoom()
        const canvasWidth = canvas.width || 0
        const canvasHeight = canvas.height || 0
        
        // 背景图片的原始尺寸
        const bgImageWidth = bgImage.width * (bgImage.scaleX || 1)
        const bgImageHeight = bgImage.height * (bgImage.scaleY || 1)
        
        // 计算图片在画布中的实际显示尺寸
        const imageDisplayWidth = bgImageWidth * zoom
        const imageDisplayHeight = bgImageHeight * zoom
        
        // 背景图片在画布中的原始位置
        const bgImageLeft = bgImage.left || 0
        const bgImageTop = bgImage.top || 0
        
        // 计算图片的实际位置
        let imageLeft = bgImageLeft + vpt[4]
        let imageTop = bgImageTop + vpt[5]
        
        // 限制图片位置，确保图片至少有一部分在画布内
        // 如果图片比画布小，确保图片完全在画布内
        if (imageDisplayWidth <= canvasWidth) {
          imageLeft = Math.max(0, Math.min(imageLeft, canvasWidth - imageDisplayWidth))
        } else {
          // 如果图片比画布大，确保图片不会完全移出画布
          imageLeft = Math.min(0, Math.max(imageLeft, canvasWidth - imageDisplayWidth))
        }
        
        if (imageDisplayHeight <= canvasHeight) {
          imageTop = Math.max(0, Math.min(imageTop, canvasHeight - imageDisplayHeight))
        } else {
          imageTop = Math.min(0, Math.max(imageTop, canvasHeight - imageDisplayHeight))
        }
        
        // 更新视口变换
        vpt[4] = imageLeft - bgImageLeft
        vpt[5] = imageTop - bgImageTop
      }
      
      // 阻止右键的上下文菜单（防止鼠标手势）
      const preventContextMenu = (e: Event) => {
        // 在canvas区域内，始终阻止右键的上下文菜单（防止鼠标手势）
        e.preventDefault()
        e.stopPropagation()
        return false
      }
      
      // 直接在原生DOM事件上处理右键拖动
      const handleNativeMouseDown = (e: MouseEvent) => {
        // 检查是否是右键
        if (e.button === 2) {
          const pointer = canvas.getPointer(e)
          
          // 如果正在绘制多边形，记录右键按下的位置和时间，用于区分单击和拖动
          if (isDrawingPolygonRef.current && polygonPointsRef.current.length > 0) {
            rightMouseDownPointRef.current = {
              x: pointer.x,
              y: pointer.y,
              time: Date.now()
            }
            // 阻止默认行为
            e.preventDefault()
            e.stopPropagation()
            return
          }
          
          // 检查图片是否完全在画布内显示
          // 如果图片完全在画布内，不允许拖动（避免图片移出视野）
          const fullyVisible = isImageFullyVisible()
          if (fullyVisible) {
            console.log('图片完全在画布内，不允许右键拖动')
            // 仍然阻止默认行为（防止上下文菜单）
            e.preventDefault()
            e.stopPropagation()
            return
          }
          
          const currentZoom = canvas.getZoom()
          console.log('原生事件：右键按下，开始平移模式，当前缩放:', currentZoom)
          isPanningRef.current = true
          lastPanPointRef.current = pointer
          // 改变鼠标样式
          canvas.defaultCursor = 'grabbing'
          canvas.hoverCursor = 'grabbing'
          // 禁用选择功能
          canvas.selection = false
          // 阻止默认行为和事件冒泡
          e.preventDefault()
          e.stopPropagation()
        }
      }
      
      // 隐藏十字辅助线的辅助函数
      const hideCrosshair = () => {
        if (crosshairHLineRef.current && canvas) {
          canvas.remove(crosshairHLineRef.current)
          crosshairHLineRef.current = null
        }
        if (crosshairVLineRef.current && canvas) {
          canvas.remove(crosshairVLineRef.current)
          crosshairVLineRef.current = null
        }
        if (canvas) {
          canvas.renderAll()
        }
      }
      
      // 更新十字辅助线（使用原生鼠标事件，确保实时跟踪）
      const updateCrosshairNative = (e: MouseEvent) => {
        // 保存最后一次鼠标事件
        lastMouseEventRef.current = e
        
        // 取消之前的更新请求
        if (crosshairUpdateRequestRef.current !== null) {
          cancelAnimationFrame(crosshairUpdateRequestRef.current)
        }
        
        // 使用 requestAnimationFrame 确保流畅更新
        crosshairUpdateRequestRef.current = requestAnimationFrame(() => {
          // 如果正在平移，不更新十字线（避免干扰）
          if (isPanningRef.current && e.buttons === 2) {
            return
          }
          
          // 检查是否有选中的对象，如果有则隐藏十字辅助线
          // 但是，如果正在绘制矩形（rectRef.current存在且isDrawingRef.current为true），则不应该隐藏十字辅助线
          const activeObject = canvas.getActiveObject()
          if (activeObject && (activeObject.type === 'rect' || activeObject.type === 'polygon')) {
            // 如果正在绘制矩形，且activeObject就是正在绘制的矩形，不隐藏十字辅助线
            if (isDrawingRef.current && rectRef.current && activeObject === rectRef.current) {
              // 正在绘制中，继续显示十字辅助线
            } else {
              // 不是正在绘制，隐藏十字辅助线
              hideCrosshair()
              crosshairUpdateRequestRef.current = null
              return
            }
          }
          
          if (!canvas || !canvas.backgroundImage) {
          // 如果背景图片不存在，隐藏十字线
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }
        
        // 实例分割项目不显示十字线
        const currentProject = projectRef.current || project
        const annotationType = currentProject?.annotation_type || 'detection'
        if (annotationType === 'segmentation') {
          // 如果是实例分割，隐藏十字线（如果存在）
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }
        
        const bgImage = canvas.backgroundImage as fabric.Image
        
        // 使用 canvas.getPointer 获取坐标（它会自动处理 viewportTransform）
        // 直接传递原生 MouseEvent，Fabric.js 应该能够处理
        let pointerX: number
        let pointerY: number
        try {
          const pointer = canvas.getPointer(e as any)
          pointerX = pointer.x
          pointerY = pointer.y
        } catch (error) {
          // 如果 getPointer 失败，使用手动转换
          const canvasElement = canvas.getElement()
          const rect = canvasElement.getBoundingClientRect()
          const scaleX = canvas.width! / rect.width
          const scaleY = canvas.height! / rect.height
          const x = (e.clientX - rect.left) * scaleX
          const y = (e.clientY - rect.top) * scaleY
          const vpt = canvas.viewportTransform
          if (vpt) {
            const invertedVpt = fabric.util.invertTransform(vpt)
            const transformed = fabric.util.transformPoint({ x, y }, invertedVpt)
            pointerX = transformed.x
            pointerY = transformed.y
          } else {
            pointerX = x
            pointerY = y
          }
        }
        
        // 获取图片在canvas中的边界
        const imageLeft = bgImage.left || 0
        const imageTop = bgImage.top || 0
        const imageWidth = bgImage.width * (bgImage.scaleX || 1)
        const imageHeight = bgImage.height * (bgImage.scaleY || 1)
        const imageRight = imageLeft + imageWidth
        const imageBottom = imageTop + imageHeight
        
        // 检查鼠标是否在图像范围内
        const isInsideImage = pointerX >= imageLeft && pointerX <= imageRight && 
                             pointerY >= imageTop && pointerY <= imageBottom
        
        if (!isInsideImage) {
          // 鼠标不在图像范围内，隐藏十字线
          hideCrosshair()
          crosshairUpdateRequestRef.current = null
          return
        }
        
        // 鼠标在图像范围内，显示或更新十字线
        // 横线：从图像左边界到右边界，高度为鼠标y坐标
        const hLineY = Math.max(imageTop, Math.min(imageBottom, pointerY))
        
        if (crosshairHLineRef.current) {
          // 更新现有横线
          crosshairHLineRef.current.set({
            x1: imageLeft,
            y1: hLineY,
            x2: imageRight,
            y2: hLineY,
            stroke: '#333',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            opacity: 0.8
          })
          crosshairHLineRef.current.setCoords()
        } else {
          // 创建新横线
          const hLine = new fabric.Line([imageLeft, hLineY, imageRight, hLineY], {
            stroke: '#333',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            opacity: 0.8,
            selectable: false,
            evented: false,
            excludeFromExport: true
          })
          canvas.add(hLine)
          crosshairHLineRef.current = hLine
        }
        
        // 竖线：从图像上边界到下边界，宽度为鼠标x坐标
        const vLineX = Math.max(imageLeft, Math.min(imageRight, pointerX))
        
        if (crosshairVLineRef.current) {
          // 更新现有竖线
          crosshairVLineRef.current.set({
            x1: vLineX,
            y1: imageTop,
            x2: vLineX,
            y2: imageBottom,
            stroke: '#333',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            opacity: 0.8
          })
          crosshairVLineRef.current.setCoords()
        } else {
          // 创建新竖线
          const vLine = new fabric.Line([vLineX, imageTop, vLineX, imageBottom], {
            stroke: '#333',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            opacity: 0.8,
            selectable: false,
            evented: false,
            excludeFromExport: true
          })
          canvas.add(vLine)
          crosshairVLineRef.current = vLine
        }
        
        // 确保十字线在底层（在所有标注对象之下）
        if (crosshairHLineRef.current) {
          canvas.sendToBack(crosshairHLineRef.current)
        }
        if (crosshairVLineRef.current) {
          canvas.sendToBack(crosshairVLineRef.current)
        }
        
        canvas.renderAll()
        crosshairUpdateRequestRef.current = null
          })
      }
      
      // 存储十字线更新函数引用，供 handleNativeMouseMove 调用
      updateCrosshairNativeRef.current = updateCrosshairNative
      
      const handleNativeMouseMove = (e: MouseEvent) => {
        // 如果正在绘制多边形且右键按下，检查是否移动（用于区分单击和拖动）
        if (isDrawingPolygonRef.current && e.buttons === 2 && rightMouseDownPointRef.current) {
          const pointer = canvas.getPointer(e)
          const dx = pointer.x - rightMouseDownPointRef.current.x
          const dy = pointer.y - rightMouseDownPointRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          // 如果移动距离超过阈值，认为是拖动，清除右键按下记录（不删除点）
          if (distance > RIGHT_CLICK_THRESHOLD) {
            rightMouseDownPointRef.current = null
          }
        }
        
        // 如果正在平移（右键拖动），处理平移并阻止默认行为
        if (isPanningRef.current && e.buttons === 2 && lastPanPointRef.current) {
          e.preventDefault()
          e.stopPropagation()
          
          const pointer = canvas.getPointer(e)
          const deltaX = pointer.x - lastPanPointRef.current.x
          const deltaY = pointer.y - lastPanPointRef.current.y
          
          // 获取当前的视口变换
          const vpt = canvas.viewportTransform
          if (vpt) {
            // 更新视口变换，实现平移
            vpt[4] += deltaX
            vpt[5] += deltaY
            
            // 限制图片移动范围，确保图片不会完全移出画布
            constrainImagePosition(vpt)
            
            canvas.setViewportTransform(vpt)
            canvas.renderAll()
          }
          
          // 更新最后的位置
          lastPanPointRef.current = pointer
          
          // 平移时也更新十字线
          if (updateCrosshairNativeRef.current) {
            updateCrosshairNativeRef.current(e)
          }
        } else {
          // 非平移状态，更新十字线
          if (updateCrosshairNativeRef.current) {
            updateCrosshairNativeRef.current(e)
          }
        }
      }
      
      const handleNativeMouseUp = (e: MouseEvent) => {
        // 如果是右键抬起
        if (e.button === 2) {
          // 如果正在绘制多边形，检查是否是右键单击（删除最后一个点）
          if (isDrawingPolygonRef.current && rightMouseDownPointRef.current) {
            const pointer = canvas.getPointer(e)
            const dx = pointer.x - rightMouseDownPointRef.current.x
            const dy = pointer.y - rightMouseDownPointRef.current.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            const timeElapsed = Date.now() - rightMouseDownPointRef.current.time
            
            // 如果移动距离和时间都在阈值内，认为是右键单击
            if (distance <= RIGHT_CLICK_THRESHOLD && timeElapsed <= RIGHT_CLICK_TIME_THRESHOLD) {
              console.log('右键单击，删除最后一个点')
              if (removeLastPolygonPointRef.current) {
                removeLastPolygonPointRef.current()
              }
              e.preventDefault()
              e.stopPropagation()
              rightMouseDownPointRef.current = null
              return
            }
            
            // 否则清除记录
            rightMouseDownPointRef.current = null
          }
          
          // 如果是右键抬起，结束平移
          if (isPanningRef.current) {
            console.log('原生事件：右键抬起，结束平移模式')
            isPanningRef.current = false
            lastPanPointRef.current = null
            // 恢复鼠标样式
            canvas.defaultCursor = 'default'
            canvas.hoverCursor = 'move'
            // 恢复选择功能
            canvas.selection = true
            e.preventDefault()
            e.stopPropagation()
          }
        }
      }
      
      if (canvasRef.current) {
        // 阻止右键的上下文菜单（这是防止鼠标手势的关键）
        canvasRef.current.addEventListener('contextmenu', preventContextMenu, true)
        // 直接在原生DOM事件上处理右键拖动
        canvasRef.current.addEventListener('mousedown', handleNativeMouseDown, true)
        canvasRef.current.addEventListener('mousemove', handleNativeMouseMove, true)
        canvasRef.current.addEventListener('mouseup', handleNativeMouseUp, true)
      }
      
      // 在容器上也添加事件监听器，确保完全阻止鼠标手势
      if (canvasContainer) {
        canvasContainer.addEventListener('contextmenu', preventContextMenu, true)
        canvasContainer.addEventListener('mousedown', handleNativeMouseDown, true)
        canvasContainer.addEventListener('mousemove', handleNativeMouseMove, true)
        canvasContainer.addEventListener('mouseup', handleNativeMouseUp, true)
      }

      // 初始化绘制状态
      isDrawingRef.current = false
      startPointRef.current = null
      rectRef.current = null
      // 初始化多边形绘制状态
      isDrawingPolygonRef.current = false
      polygonPointsRef.current = []
      polygonRef.current = null
      polygonLineRef.current = null
      polygonPointMarkersRef.current = []
      // 初始化平移状态
      isPanningRef.current = false
      lastPanPointRef.current = null
      // 初始化右键单击检测状态
      rightMouseDownPointRef.current = null

      // 添加鼠标移动事件监听器
      const handleMouseMove = (e: fabric.IEvent<MouseEvent>) => {
        // 处理平移（右键拖动）
        if (isPanningRef.current && lastPanPointRef.current) {
          // 阻止默认行为和事件冒泡，防止触发鼠标手势
          e.e.preventDefault()
          e.e.stopPropagation()
          
          const pointer = canvas.getPointer(e.e)
          const deltaX = pointer.x - lastPanPointRef.current.x
          const deltaY = pointer.y - lastPanPointRef.current.y
          
          // 获取当前的视口变换
          const vpt = canvas.viewportTransform
          if (vpt) {
            // 更新视口变换，实现平移
            vpt[4] += deltaX
            vpt[5] += deltaY
            canvas.setViewportTransform(vpt)
            canvas.renderAll()
          }
          
          // 更新最后的位置
          lastPanPointRef.current = pointer
          return
        }
        
        // 如果正在平移但 lastPanPointRef 为空，重新初始化
        if (isPanningRef.current && !lastPanPointRef.current) {
          const pointer = canvas.getPointer(e.e)
          lastPanPointRef.current = pointer
          return
        }
        
        // 处理绘制多边形时的临时线段和预览
        if (isDrawingPolygonRef.current && polygonPointsRef.current.length > 0) {
          const pointer = canvas.getPointer(e.e)
          const lastPoint = polygonPointsRef.current[polygonPointsRef.current.length - 1]
          
          // 移除旧的临时线段
          if (polygonLineRef.current) {
            canvas.remove(polygonLineRef.current)
            polygonLineRef.current = null
          }
          
          // 创建新的临时线段（从最后一个顶点到鼠标位置）
          // 使用 selectedCategoryRef 获取最新类别，避免切换类别时闭包仍使用旧值
          const categoryColor = categories.find(c => c.id === selectedCategoryRef.current)?.color || '#FF0000'
          const line = new fabric.Line([lastPoint.x, lastPoint.y, pointer.x, pointer.y], {
            stroke: categoryColor,
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false
          })
          canvas.add(line)
          polygonLineRef.current = line
          
          // 更新预览多边形（如果有2个或更多点）
          if (polygonPointsRef.current.length >= 2) {
            // 临时添加当前鼠标位置到预览
            const tempPoints = [...polygonPointsRef.current, { x: pointer.x, y: pointer.y }]
            const minX = Math.min(...tempPoints.map(p => p.x))
            const minY = Math.min(...tempPoints.map(p => p.y))
            const localPoints = tempPoints.map(p => ({
              x: p.x - minX,
              y: p.y - minY
            }))
            
            // 移除旧的预览多边形
            if (polygonRef.current) {
              canvas.remove(polygonRef.current)
              polygonRef.current = null
            }
            
            // 创建新的预览多边形
            const previewPolygon = new fabric.Polygon(localPoints, {
              left: minX,
              top: minY,
              fill: 'rgba(255, 0, 0, 0.1)',
              stroke: categoryColor,
              strokeWidth: 2,
              selectable: false,
              evented: false,
            })
            canvas.add(previewPolygon)
            polygonRef.current = previewPolygon
          }
          
          canvas.renderAll()
          return
        }
        
        // 处理绘制矩形
        if (!isDrawingRef.current || !startPointRef.current || !rectRef.current) return
        const pointer = canvas.getPointer(e.e)
        const width = Math.abs(pointer.x - startPointRef.current.x)
        const height = Math.abs(pointer.y - startPointRef.current.y)
        rectRef.current.set({
          width: width,
          height: height,
          left: Math.min(pointer.x, startPointRef.current.x),
          top: Math.min(pointer.y, startPointRef.current.y),
        })
        canvas.renderAll()
      }

      // 添加鼠标抬起事件监听器
      const handleMouseUp = (e?: fabric.IEvent<MouseEvent>) => {
        // 结束平移
        if (isPanningRef.current) {
          console.log('右键抬起，结束平移模式')
          // 如果是右键抬起，阻止默认行为
          if (e && e.e.button === 2) {
            e.e.preventDefault()
            e.e.stopPropagation()
          }
          isPanningRef.current = false
          lastPanPointRef.current = null
          // 恢复鼠标样式
          canvas.defaultCursor = 'default'
          canvas.hoverCursor = 'move'
          // 恢复选择功能
          canvas.selection = true
          return
        }
        
        // 如果正在绘制矩形（两次点击模式），鼠标抬起不做完成处理
        // 矩形的完成由第二次 mouse:down 处理
        if (isDrawingRef.current) {
          return
        }
        
        // 检查当前活动的矩形对象是否完全在图片外（移动或修改后松开鼠标时）
        if (!isDrawingRef.current) {
          const activeObject = canvas.getActiveObject()
          if (activeObject && activeObject.type === 'rect') {
            const rect = activeObject as fabric.Rect
            const currentProject = projectRef.current || project
            const annotationType = currentProject?.annotation_type || 'detection'
            
            if (annotationType === 'detection') {
              const bgImage = canvas.backgroundImage as fabric.Image
              
              if (bgImage && bgImage.width && bgImage.height) {
                // 获取图片边界
                const imageLeft = bgImage.left || 0
                const imageTop = bgImage.top || 0
                const imageWidth = bgImage.width * (bgImage.scaleX || 1)
                const imageHeight = bgImage.height * (bgImage.scaleY || 1)
                const imageRight = imageLeft + imageWidth
                const imageBottom = imageTop + imageHeight
                
                // 获取矩形的实际边界框
                const scaleX = rect.scaleX || 1
                const scaleY = rect.scaleY || 1
                const originX = rect.originX || 'left'
                const originY = rect.originY || 'top'
                const baseWidth = rect.width || 0
                const baseHeight = rect.height || 0
                const displayWidth = baseWidth * scaleX
                const displayHeight = baseHeight * scaleY
                
                // 根据原点计算实际显示的左上角坐标
                let actualLeft = rect.left || 0
                let actualTop = rect.top || 0
                
                if (originX === 'center') {
                  actualLeft = actualLeft - displayWidth / 2
                } else if (originX === 'right') {
                  actualLeft = actualLeft - displayWidth
                }
                
                if (originY === 'center') {
                  actualTop = actualTop - displayHeight / 2
                } else if (originY === 'bottom') {
                  actualTop = actualTop - displayHeight
                }
                
                const rectLeft = actualLeft
                const rectTop = actualTop
                const rectRight = actualLeft + displayWidth
                const rectBottom = actualTop + displayHeight
                
                // 检查矩形是否完全在图片外（在画布内但在图片外）
                const isCompletelyOutside = isRectCompletelyOutsideImage(rect, canvas)
                
                console.log('鼠标松开时检查活动矩形是否在图片外:', {
                  rectLeft, rectTop, rectRight, rectBottom,
                  imageLeft, imageTop, imageRight, imageBottom,
                  imageWidth, imageHeight,
                  isCompletelyOutside,
                  checks: {
                    left: rectRight <= imageLeft,
                    right: rectLeft >= imageRight,
                    top: rectBottom <= imageTop,
                    bottom: rectTop >= imageBottom
                  }
                })
                
                if (isCompletelyOutside) {
                  // 矩形完全在图片外，删除它
                  console.log('鼠标松开时：矩形完全在图片外，删除矩形')
                  
                  const annotationId = (rect as any).annotationId
                  canvas.remove(rect)
                  canvas.renderAll()
                  
                  // 如果矩形有对应的标注，需要删除标注
                  if (annotationId !== undefined && annotationId !== null) {
                    // 删除标注的逻辑会在保存时处理（因为矩形已从canvas移除，保存时不会包含它）
                    // 但为了立即更新，可以触发一次保存
                    if (saveCurrentAnnotationsRef.current) {
                      saveCurrentAnnotationsRef.current().catch(error => {
                        console.error('删除超出边界的矩形后保存失败:', error)
                      })
                    }
                  }
                }
              }
            }
          }
        }
        
      }

      canvas.on('mouse:move', handleMouseMove)
      canvas.on('mouse:up', handleMouseUp)
      
      // 添加鼠标移出画布事件，结束平移并隐藏十字线
      const handleMouseOut = () => {
        if (isPanningRef.current) {
          console.log('鼠标移出画布，结束平移模式')
          isPanningRef.current = false
          lastPanPointRef.current = null
          // 恢复鼠标样式
          canvas.defaultCursor = 'default'
          canvas.hoverCursor = 'move'
          // 恢复选择功能
          canvas.selection = true
        }
        // 隐藏十字线
        if (crosshairHLineRef.current) {
          canvas.remove(crosshairHLineRef.current)
          crosshairHLineRef.current = null
        }
        if (crosshairVLineRef.current) {
          canvas.remove(crosshairVLineRef.current)
          crosshairVLineRef.current = null
        }
        canvas.renderAll()
      }
      canvas.on('mouse:out', handleMouseOut)
      
      // 在canvas创建时立即绑定mouse:down事件监听器（如果categories已加载）
      // 这样可以确保切换图片后能正常标注
      const bindMouseDownHandler = () => {
        // 移除旧的监听器（如果有）
        canvas.off('mouse:down')
        
        // 统一的事件处理器：处理选择和绘制
        const handleMouseDown = (e: fabric.IEvent<MouseEvent>) => {
          // 在事件处理的最开始立即保存 activeObject，因为 selection:cleared 可能在 mouse:down 之前触发
          const activeObjectAtStart = canvas.getActiveObject()
          // 是否有选中的标注（矩形或多边形），点击空白时应取消选择
          const hadActiveAnnotation = (activeObjectAtStart && (activeObjectAtStart.type === 'rect' || activeObjectAtStart.type === 'polygon')) || hasActiveAnnotationRef.current
          
          // 如果正在平移，不处理其他操作（右键拖动由原生事件处理）
          if (isPanningRef.current) {
            return
          }
          
          // 如果是右键，不处理（由原生事件处理）
          if (e.e.button === 2) {
            return
          }
          
          // 多边形选中时：检测是否点击在边上（添加顶点）或顶点上（Delete 删除）
          if (activeObjectAtStart?.type === 'polygon') {
            const polygon = activeObjectAtStart as fabric.Polygon
            const pointer = canvas.getPointer(e.e)
            const points = polygon.points || []
            const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
            const transformMatrix = polygon.calcTransformMatrix()
            const zoom = canvas.getZoom() || 1
            const VERTEX_HIT_RADIUS = 12 / zoom
            const EDGE_HIT_RADIUS = 14 / zoom
            const VERTEX_CLOSE_THRESHOLD = 10 / zoom
            
            // 先检查边（添加顶点）：边中点可点击，但距顶点过近时优先视为顶点
            // getPointer 返回逻辑 canvas 坐标，与 transformMatrix 同一坐标系
            // 缩放时命中半径 /zoom，使屏幕上的可点击区域保持约 12-14 像素
            let hitEdge: number | null = null
            let hitVertex: number | null = null
            if (points.length >= 3) {
              for (let i = 0; i < points.length; i++) {
                const nextI = (i + 1) % points.length
                const p1 = points[i]
                const p2 = points[nextI]
                const local1 = { x: p1.x - pathOffset.x, y: p1.y - pathOffset.y }
                const local2 = { x: p2.x - pathOffset.x, y: p2.y - pathOffset.y }
                const canvas1 = fabric.util.transformPoint(local1, transformMatrix)
                const canvas2 = fabric.util.transformPoint(local2, transformMatrix)
                const distToP1 = Math.sqrt((pointer.x - canvas1.x) ** 2 + (pointer.y - canvas1.y) ** 2)
                const distToP2 = Math.sqrt((pointer.x - canvas2.x) ** 2 + (pointer.y - canvas2.y) ** 2)
                if (distToP1 < VERTEX_CLOSE_THRESHOLD || distToP2 < VERTEX_CLOSE_THRESHOLD) continue
                const segDx = canvas2.x - canvas1.x
                const segDy = canvas2.y - canvas1.y
                const lenSq = segDx * segDx + segDy * segDy
                const t = lenSq <= 0 ? 0 : Math.max(0, Math.min(1,
                  ((pointer.x - canvas1.x) * segDx + (pointer.y - canvas1.y) * segDy) / lenSq))
                const closestX = canvas1.x + t * segDx
                const closestY = canvas1.y + t * segDy
                const dist = Math.sqrt((pointer.x - closestX) ** 2 + (pointer.y - closestY) ** 2)
                if (dist < EDGE_HIT_RADIUS) {
                  hitEdge = i
                  break
                }
              }
            }
            if (hitEdge === null) {
              for (let i = 0; i < points.length; i++) {
                const p = points[i]
                const localX = p.x - pathOffset.x
                const localY = p.y - pathOffset.y
                const canvasPt = fabric.util.transformPoint({ x: localX, y: localY }, transformMatrix)
                const dx = pointer.x - canvasPt.x
                const dy = pointer.y - canvasPt.y
                if (Math.sqrt(dx * dx + dy * dy) <= VERTEX_HIT_RADIUS) {
                  hitVertex = i
                  break
                }
              }
            }
            selectedVertexIndexRef.current = hitVertex
            canvas.renderAll()  // 刷新以显示顶点选中样式
            
            if (hitEdge !== null) {
                const anchorPoint = points[hitEdge]
                const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
                const anchorLocalX = anchorPoint.x - oldPathOffset.x
                const anchorLocalY = anchorPoint.y - oldPathOffset.y
                const anchorAbsolute = fabric.util.transformPoint(
                  { x: anchorLocalX, y: anchorLocalY },
                  transformMatrix
                )
                const invMatrix = fabric.util.invertTransform(transformMatrix)
                const localPoint = fabric.util.transformPoint(pointer, invMatrix)
                const newX = localPoint.x + pathOffset.x
                const newY = localPoint.y + pathOffset.y
                const polygonPointsArray = [...(polygon.points || [])]
                polygonPointsArray.splice(hitEdge + 1, 0, { x: newX, y: newY })
                polygon.set({ points: polygonPointsArray })
                polygon._setPositionDimensions({})
                ;(polygon as any).dirty = true
                if ((polygon as any)._setPath) delete (polygon as any)._setPath
                const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
                const newAnchorLocalX = anchorPoint.x - newPathOffset.x
                const newAnchorLocalY = anchorPoint.y - newPathOffset.y
                const newTransformMatrix = polygon.calcTransformMatrix()
                const newAnchorAbsolute = fabric.util.transformPoint(
                  { x: newAnchorLocalX, y: newAnchorLocalY },
                  newTransformMatrix
                )
                const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
                const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
                if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
                  polygon.set({
                    left: (polygon.left || 0) + deltaX,
                    top: (polygon.top || 0) + deltaY
                  })
                }
                polygon.setCoords()
                const edgeCategoryColor = (polygon as any).categoryId
                  ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
                  : '#FF0000'
                const edgeIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
                const edgeBaseOpts = {
                  canvas,
                  categoryColor: edgeCategoryColor,
                  isSegmentation: edgeIsSeg,
                  enableEdgeControls: true,
                  selectedVertexIndexRef,
                  onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
                }
                selectedVertexIndexRef.current = null  // 添加顶点后清除顶点选中
                createPolygonControls(polygon, {
                  ...edgeBaseOpts,
                  onRebuildControls: (poly) => createPolygonControls(poly, edgeBaseOpts),
                })
                canvas.renderAll()
                saveCurrentAnnotationsRef.current?.().catch(() => {})
                return
            }
          } else {
            selectedVertexIndexRef.current = null
          }
          
          // 如果正在绘制矩形，第二次点击完成画框
          if (isDrawingRef.current && startPointRef.current && rectRef.current) {
            console.log('第二次点击，完成矩形绘制')
            const pointer = canvas.getPointer(e.e)
            // 更新矩形最终尺寸
            const width = Math.abs(pointer.x - startPointRef.current.x)
            const height = Math.abs(pointer.y - startPointRef.current.y)
            rectRef.current.set({
              width: width,
              height: height,
              left: Math.min(pointer.x, startPointRef.current.x),
              top: Math.min(pointer.y, startPointRef.current.y),
            })
            canvas.renderAll()
            
            // 如果矩形太小，删除它
            if (rectRef.current.width! < 5 || rectRef.current.height! < 5) {
              console.log('矩形太小，删除它')
              canvas.remove(rectRef.current)
              rectRef.current = null
            } else {
              console.log('绘制完成，矩形尺寸:', rectRef.current.width, 'x', rectRef.current.height)
              // 确保矩形可以被选择和交互
              rectRef.current.set({
                selectable: true,
                evented: true
              })
              canvas.renderAll()
              // 自动保存标注
              console.log('完成矩形绘制，准备裁剪和保存')
              
              // 裁剪矩形到图片边界内
              const currentProject = projectRef.current || project
              const annotationType = currentProject?.annotation_type || 'detection'
              if (annotationType === 'detection' && rectRef.current) {
                const rect = rectRef.current
                const bgImage = canvas.backgroundImage as fabric.Image
                
                if (bgImage && bgImage.width && bgImage.height) {
                  // 获取图片边界
                  const imageLeft = bgImage.left || 0
                  const imageTop = bgImage.top || 0
                  const imageWidth = bgImage.width * (bgImage.scaleX || 1)
                  const imageHeight = bgImage.height * (bgImage.scaleY || 1)
                  const imageRight = imageLeft + imageWidth
                  const imageBottom = imageTop + imageHeight
                  
                  // 获取矩形的实际边界框
                  const scaleX = rect.scaleX || 1
                  const scaleY = rect.scaleY || 1
                  const originX = rect.originX || 'left'
                  const originY = rect.originY || 'top'
                  const baseWidth = rect.width || 0
                  const baseHeight = rect.height || 0
                  const displayWidth = baseWidth * scaleX
                  const displayHeight = baseHeight * scaleY
                  
                  // 根据原点计算实际显示的左上角坐标
                  let actualLeft = rect.left || 0
                  let actualTop = rect.top || 0
                  
                  if (originX === 'center') {
                    actualLeft = actualLeft - displayWidth / 2
                  } else if (originX === 'right') {
                    actualLeft = actualLeft - displayWidth
                  }
                  
                  if (originY === 'center') {
                    actualTop = actualTop - displayHeight / 2
                  } else if (originY === 'bottom') {
                    actualTop = actualTop - displayHeight
                  }
                  
                  const rectLeft = actualLeft
                  const rectTop = actualTop
                  const rectRight = actualLeft + displayWidth
                  const rectBottom = actualTop + displayHeight
                  
                  // 首先检查矩形是否完全在图片外
                  const isCompletelyOutside = isRectCompletelyOutsideImage(rect, canvas)
                  
                  if (isCompletelyOutside) {
                    console.log('绘制完成后：矩形完全在图片外，删除矩形')
                    canvas.remove(rect)
                    rectRef.current = null
                    canvas.renderAll()
                    // 恢复状态
                    isDrawingRef.current = false
                    startPointRef.current = null
                    rectRef.current = null
                    canvas.selection = true
                    return
                  }
                  
                  // 计算裁剪后的边界
                  const clippedLeft = Math.max(rectLeft, imageLeft)
                  const clippedTop = Math.max(rectTop, imageTop)
                  const clippedRight = Math.min(rectRight, imageRight)
                  const clippedBottom = Math.min(rectBottom, imageBottom)
                  
                  // 检查是否需要裁剪（矩形部分超出图片边界）
                  const needsClip = clippedLeft > rectLeft || clippedTop > rectTop ||
                                   clippedRight < rectRight || clippedBottom < rectBottom
                  
                  if (needsClip) {
                    const clippedWidth = clippedRight - clippedLeft
                    const clippedHeight = clippedBottom - clippedTop
                    
                    console.log('绘制完成后裁剪矩形')
                    
                    rect.set({
                      left: clippedLeft,
                      top: clippedTop,
                      width: clippedWidth,
                      height: clippedHeight,
                      scaleX: 1,
                      scaleY: 1,
                      originX: 'left',
                      originY: 'top'
                    })
                    rect.setCoords()
                    canvas.renderAll()
                  }
                }
              }
              
              if (saveCurrentAnnotationsRef.current) {
                saveCurrentAnnotationsRef.current().catch(error => {
                  console.error('完成矩形绘制后保存失败:', error)
                })
              } else {
                setTimeout(() => {
                  if (saveCurrentAnnotationsRef.current) {
                    saveCurrentAnnotationsRef.current().catch(error => {
                      console.error('完成矩形绘制后保存失败:', error)
                    })
                  }
                }, 100)
              }
            }
            
            // 恢复状态
            console.log('绘制完成，恢复选择功能')
            canvas.selection = true
            isDrawingRef.current = false
            startPointRef.current = null
            rectRef.current = null
            return
          }
          
          // 获取点击位置
          const pointer = canvas.getPointer(e.e)
          const annotationType = project?.annotation_type || 'detection'
          
          // 如果点击的是空白区域（e.target 为 null 或背景图片），检查是否有选中的标注（矩形或多边形）
          // 有则取消选择，而非开始新标注
          if (!e.target || e.target === canvas.backgroundImage) {
            if (hadActiveAnnotation) {
              canvas.discardActiveObject()
              canvas.renderAll()
              return
            }
          }
          
          // 如果正在绘制多边形，处理多边形绘制（这个逻辑在useEffect中也有，但这里也需要处理）
          if (isDrawingPolygonRef.current) {
            console.log('========== [bindMouseDownHandler] 开始添加多边形顶点 ==========')
            console.log('当前点数:', polygonPointsRef.current.length)
            console.log('点击位置（pointer）:', pointer)
            
            // 确定要添加的顶点位置
            let newPoint = { x: pointer.x, y: pointer.y }
            
          // 如果不是第一个点，检查点击位置是否超出图片边界
          if (polygonPointsRef.current.length > 0) {
            const lastPoint = polygonPointsRef.current[polygonPointsRef.current.length - 1]
            console.log('最后一点:', lastPoint, '点击位置:', newPoint)
            
            // 检查点击位置是否超出图片边界
            const bgImage = canvas.backgroundImage as fabric.Image
            if (bgImage && bgImage.width && bgImage.height) {
              const imageLeft = bgImage.left || 0
              const imageTop = bgImage.top || 0
              const imageWidth = bgImage.width * (bgImage.scaleX || 1)
              const imageHeight = bgImage.height * (bgImage.scaleY || 1)
              const imageRight = imageLeft + imageWidth
              const imageBottom = imageTop + imageHeight
              
              const isOutside = newPoint.x < imageLeft || newPoint.x > imageRight || 
                               newPoint.y < imageTop || newPoint.y > imageBottom
              
              console.log('点击位置检查:', {
                imageBounds: { imageLeft, imageTop, imageRight, imageBottom },
                clickPos: newPoint,
                isOutside
              })
              
              // 如果点击位置超出图片边界，计算交点
              if (isOutside) {
                console.log('点击位置超出图片边界，计算交点')
                try {
                  const intersectionFunc = getLineImageBoundaryIntersectionRef.current || getLineImageBoundaryIntersection
                  const intersection = intersectionFunc(lastPoint, newPoint)
                  console.log('交点计算结果:', intersection)
                  
                  if (intersection) {
                    // 如果找到交点，使用交点作为新顶点
                    newPoint = intersection
                    console.log('✓ 找到交点，使用边界交点作为新顶点:', intersection)
                  } else {
                    console.log('✗ 未找到交点，但仍使用原始点击位置（可能在图片外）')
                  }
                } catch (error) {
                  console.error('计算交点时出错:', error)
                  console.log('使用原始点击位置')
                }
              } else {
                console.log('点击位置在图片内，直接使用')
              }
            } else {
              console.log('无法获取图片信息，使用原始点击位置')
            }
          } else {
            console.log('这是第一个点，直接使用点击位置')
          }
            
            // 添加新的顶点
            console.log('========== 创建多边形顶点 ==========')
            console.log('顶点索引:', polygonPointsRef.current.length)
            console.log('顶点坐标（canvas坐标）:', { x: newPoint.x, y: newPoint.y })
            console.log('所有顶点列表:', polygonPointsRef.current.map((p, i) => ({ index: i, x: p.x, y: p.y })))
            polygonPointsRef.current.push(newPoint)
            console.log('添加后点数:', polygonPointsRef.current.length)
            
            // 移除旧的临时线段
            if (polygonLineRef.current) {
              canvas.remove(polygonLineRef.current)
              polygonLineRef.current = null
            }
            
            // 更新预览和标记
            if (polygonPointsRef.current.length >= 2) {
              const updatePreviewFunc = updatePreviewPolygonRef.current || updatePreviewPolygon
              const updateMarkersFunc = updatePointMarkersRef.current || updatePointMarkers
              updatePreviewFunc()
              updateMarkersFunc()
            } else {
              const updateMarkersFunc = updatePointMarkersRef.current || updatePointMarkers
              updateMarkersFunc()
            }
            
            canvas.renderAll()
            console.log('========== [bindMouseDownHandler] 顶点添加完成 ==========')
            return
          }
          
          // 检查点击的对象类型（矩形或多边形）
          const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
          const objects = canvas.getObjects().filter(obj => annotationTypes.includes(obj.type))
          let clickedObject: fabric.Object | null = null
          
          // 从最上层开始检查
          for (let i = objects.length - 1; i >= 0; i--) {
            const obj = objects[i]
            if (obj.type === 'rect') {
              const rect = obj as fabric.Rect
              const rectLeft = rect.left || 0
              const rectTop = rect.top || 0
              const rectWidth = rect.width || 0
              const rectHeight = rect.height || 0
              
              if (pointer.x >= rectLeft && pointer.x <= rectLeft + rectWidth &&
                  pointer.y >= rectTop && pointer.y <= rectTop + rectHeight) {
                clickedObject = rect
                break
              }
            } else if (obj.type === 'polygon') {
              const polygon = obj as fabric.Polygon
              if (polygon.containsPoint(pointer)) {
                clickedObject = polygon
                break
              }
            }
          }
          
          // 使用 findTarget 查找点击的对象（排除背景图片）
          const target = canvas.findTarget(e.e, false) as fabric.Object | null
          const isTargetAnnotation = target && annotationTypes.includes(target.type)
          
          // 如果点击的是已有标注对象，选择它
          const objectToSelect = clickedObject || (isTargetAnnotation ? target : null)
          if (objectToSelect) {
            canvas.selection = true
            objectToSelect.set({
              selectable: true,
              evented: true
            })
            canvas.setActiveObject(objectToSelect)
            canvas.renderAll()
            return
          }
          
          // 如果点击的是空白区域（没有点击到任何标注对象）
          // 检查是否有选中的多边形，如果有则取消选择（使用保存的状态）
          if (!clickedObject && !isTargetAnnotation && hadActiveAnnotation) {
              console.log('点击空白区域，取消选择标注')
            canvas.discardActiveObject()
            canvas.renderAll()
            return
          }
          
          // 如果没有选中的标注，开始绘制
          const currentSelectedCategory = selectedCategoryRef.current
          if (currentSelectedCategory === null || currentSelectedCategory === undefined) {
            message.warning('请先选择类别')
            return
          }
          
          if (annotationType === 'segmentation') {
            // 开始绘制多边形
            canvas.selection = false
            // 禁用所有现有对象的选择，防止在绘制时误选中
            canvas.getObjects().forEach((obj: any) => {
              obj.selectable = false
            })
            isDrawingPolygonRef.current = true
            polygonPointsRef.current = [{ x: pointer.x, y: pointer.y }]
            
            // 创建第一个点标记
            const currentCategories = categoriesRef.current || []
            const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
            const firstMarker = new fabric.Circle({
              left: pointer.x,
              top: pointer.y,
              radius: 4,
              fill: categoryColor,
              stroke: '#fff',
              strokeWidth: 1,
              selectable: false,
              evented: false,
              originX: 'center',
              originY: 'center',
            })
            canvas.add(firstMarker)
            polygonPointMarkersRef.current.push(firstMarker)
            canvas.renderAll()
          } else {
            // 开始绘制矩形
            canvas.selection = false
            isDrawingRef.current = true
            startPointRef.current = { x: pointer.x, y: pointer.y }
            const currentCategories = categoriesRef.current || []
            const categoryColor = currentCategories.find(c => c.id === currentSelectedCategory)?.color || '#FF0000'
            const rectBaseStroke = 2
            const rect = new fabric.Rect({
              left: pointer.x,
              top: pointer.y,
              width: 0,
              height: 0,
              fill: 'transparent',
              stroke: categoryColor,
              strokeWidth: Math.max(0.5, rectBaseStroke / (canvas.getZoom() || 1)),
              strokeUniform: true, // 确保线宽不受对象缩放影响
              objectCaching: false, // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
              selectable: false,  // 绘制过程中不可选择，完成后再启用
              evented: false,
            })
            ;(rect as any)._baseStrokeWidth = rectBaseStroke
            
            // 重写 _setObjectScale 方法，确保缩放时线宽不变
            const originalSetObjectScale = (rect as any)._setObjectScale
            if (originalSetObjectScale) {
              (rect as any)._setObjectScale = function(scaleX: number, scaleY: number, by: string) {
                const result = originalSetObjectScale.call(this, scaleX, scaleY, by)
                if (this.type === 'rect' && this.canvas) {
                  const base = (this as any)._baseStrokeWidth ?? 2
                  this.set({
                    strokeWidth: Math.max(0.5, base / this.canvas.getZoom()),
                    strokeUniform: true
                  })
                }
                return result
              }
            }
            rect.set({
              uniformScaling: false,
              lockUniScaling: false,
              lockRotation: true, // 目标检测标注框不支持旋转
            })
            ;(rect as any).categoryId = currentSelectedCategory
            canvas.add(rect)
            rectRef.current = rect
          }
        }
        
        canvas.on('mouse:down', handleMouseDown)
        // 确保选择功能默认启用
        canvas.selection = true
        console.log('Canvas创建时绑定mouse:down监听器完成')
      }
      
      // 立即绑定事件监听器
      bindMouseDownHandler()

      // 添加鼠标滚轮缩放功能
      const handleMouseWheel = (opt: fabric.IEvent<WheelEvent>) => {
        // 如果正在绘制矩形或多边形，禁用缩放
        if (isDrawingRef.current || isDrawingPolygonRef.current) {
          return
        }
        
        const delta = opt.e.deltaY
        let zoom = canvas.getZoom()
        // 缩放步长，可以根据需要调整
        const zoomStep = 0.1
        
        // 计算最小缩放比例：图片最小缩小到与画布相同大小
        const bgImage = canvas.backgroundImage as fabric.Image
        let minZoom = 0.1 // 默认最小值
        if (bgImage && bgImage.width && bgImage.height) {
          // 获取图片的原始尺寸
          const imageWidth = bgImage.width
          const imageHeight = bgImage.height
          
          // 获取画布尺寸
          const canvasWidth = canvas.width || 0
          const canvasHeight = canvas.height || 0
          
          // 计算边距（图片位置就是边距）
          const marginX = bgImage.left || 0
          const marginY = bgImage.top || 0
          
          // 画布的有效尺寸（不包括边距）
          const canvasEffectiveWidth = canvasWidth - marginX * 2
          const canvasEffectiveHeight = canvasHeight - marginY * 2
          
          // 图片的显示尺寸受两个因素影响：
          // 1. 图片本身的scaleX/scaleY（初始为1）
          // 2. canvas的zoom（通过viewportTransform）
          // 实际显示尺寸 = imageWidth * (bgImage.scaleX || 1) * canvas.getZoom()
          // 
          // 要求：图片的显示尺寸不能小于画布的有效尺寸
          // 即：imageWidth * (bgImage.scaleX || 1) * minZoom >= canvasEffectiveWidth
          // 所以：minZoom >= canvasEffectiveWidth / (imageWidth * (bgImage.scaleX || 1))
          const minZoomX = canvasEffectiveWidth / (imageWidth * (bgImage.scaleX || 1))
          const minZoomY = canvasEffectiveHeight / (imageHeight * (bgImage.scaleY || 1))
          minZoom = Math.max(minZoomX, minZoomY, 0.1) // 至少0.1，防止过小
          
          console.log('计算最小缩放比例:', {
            imageWidth,
            imageHeight,
            canvasWidth,
            canvasHeight,
            marginX,
            marginY,
            canvasEffectiveWidth,
            canvasEffectiveHeight,
            bgImageScaleX: bgImage.scaleX,
            bgImageScaleY: bgImage.scaleY,
            minZoomX,
            minZoomY,
            minZoom
          })
        }
        
        // 限制缩放范围，避免过大或过小
        const maxZoom = 5
        
        // 向下滚动缩小，向上滚动放大
        if (delta > 0) {
          zoom = Math.max(minZoom, zoom - zoomStep)
        } else {
          zoom = Math.min(maxZoom, zoom + zoomStep)
        }
        
        // 以鼠标位置为中心进行缩放
        const pointer = canvas.getPointer(opt.e)
        canvas.zoomToPoint(pointer, zoom)
        
        // 缩放后按 zoom 反比更新标注线宽，使视觉线宽保持不变，便于放大时精细操作
        const currentZoom = canvas.getZoom()
        canvas.getObjects().forEach((obj: fabric.Object) => {
          if (obj.type === 'rect' || obj.type === 'polygon') {
            const base = (obj as any)._baseStrokeWidth ?? (obj.type === 'polygon' ? 3 : 2)
            obj.set('strokeWidth', Math.max(0.5, base / currentZoom))
          }
        })
        
        // 缩放后刷新选中对象的控制点坐标，确保多边形顶点小圆点位置正确
        const activeObject = canvas.getActiveObject()
        if (activeObject) {
          activeObject.setCoords()
          canvas.renderAll()
        }
        
        opt.e.preventDefault()
        opt.e.stopPropagation()
      }
      
      canvas.on('mouse:wheel', handleMouseWheel)

      // mouse:down事件监听器在useEffect中统一管理，这里不添加

      fabricCanvasRef.current = canvas
      // 在canvas上标记当前图片ID，用于后续检查
      ;(canvas as any)._currentImageId = image.id

      // 不再使用事件触发的自动保存，改为在切换图片时保存

      // 加载图片
      // 在开发环境中，使用相对路径通过Vite代理访问，避免CORS问题
      // filepath格式通常是: images/{project_id}/{filename}
      // 所以完整URL应该是: /uploads/images/{project_id}/{filename}
      // 构建URL时，对每个路径段进行编码，但保持路径结构
      const pathParts = image.filepath.split('/').filter(part => part) // 过滤空字符串
      const encodedPathParts = pathParts.map((part) => {
        // 对每个路径段进行编码
        return encodeURIComponent(part)
      })
      const encodedFilepath = encodedPathParts.join('/')
      // 在开发环境中，使用相对路径（空字符串），让Vite代理处理
      // 在生产环境中，使用完整的API URL
      const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()
      const imgUrl = `${apiBaseUrl}/uploads/${encodedFilepath}`
      console.log('加载图片URL:', imgUrl, '原始filepath:', image.filepath, 'imageId:', image.id, 'filename:', image.filename, 'apiBaseUrl:', apiBaseUrl) // 调试日志
      
      // 显示加载提示
      message.loading({ content: '正在加载图片...', key: 'loading-image' })
      
      // 设置超时，防止图片加载时间过长
      const loadTimeout = setTimeout(() => {
        message.destroy('loading-image')
        message.error(`图片加载超时: ${image.filename}`, 5)
      }, 30000) // 30秒超时
      
      // 记录加载时的imageId，用于后续验证
      const loadingImageId = image.id
      const loadingImageIdRef = imageIdRef.current
      
      fabric.Image.fromURL(imgUrl, (img) => {
        clearTimeout(loadTimeout)
        message.destroy('loading-image')
        
        // 使用最新的imageId进行检查（避免闭包问题）
        const currentImageId = imageIdRef.current
        
        // 检查canvas是否还存在（可能在加载过程中被清理了）
        if (!fabricCanvasRef.current || !canvasRef.current) {
          console.warn('Canvas已被清理，取消图片加载，加载时imageId:', loadingImageId, '当前imageId:', currentImageId)
          return
        }
        
        // 检查canvas是否还是原来的（通过_currentImageId）
        const canvasImageId = (fabricCanvasRef.current as any)._currentImageId
        if (canvasImageId !== loadingImageId) {
          console.warn('Canvas图片ID不匹配，取消加载。Canvas:', canvasImageId, '期望:', loadingImageId)
          return
        }
        
        // 检查图片是否对应当前的imageId（避免加载了错误的图片）
        if (loadingImageId !== Number(currentImageId) || loadingImageId !== Number(loadingImageIdRef)) {
          console.warn('图片ID不匹配，取消加载。加载时:', loadingImageIdRef, '当前:', currentImageId, '图片:', loadingImageId)
          return
        }
        
        if (!img || !img.width || !img.height) {
          console.error('图片加载失败或图片无效', {
            imgUrl,
            imageId: loadingImageId,
            filepath: image.filepath,
            filename: image.filename,
            apiBaseUrl,
            encodedFilepath,
            currentImageId,
            canvasImageId,
            loadingImageIdRef
          })
          message.error(`图片加载失败: ${image.filename}。URL: ${imgUrl}。请检查文件是否存在。`, 10)
          return
        }
        
        console.log('图片加载成功:', imgUrl, '尺寸:', img.width, 'x', img.height, 'imageId:', loadingImageId)
        
        // 计算缩放比例，适应屏幕但保持原图比例
        const maxWidth = Math.min(window.innerWidth - 100, 1600)
        const maxHeight = Math.min(window.innerHeight - 200, 1000)
        const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1) // 不超过原图大小
        
        // 再次检查canvas是否还存在（可能在加载过程中被清理了）
        if (!fabricCanvasRef.current || !canvasRef.current) {
          console.warn('Canvas已被清理，取消设置尺寸，加载时imageId:', loadingImageId, '当前imageId:', currentImageId)
          return
        }
        
        // 再次检查canvas是否还是原来的
        const currentCanvasImageId = (fabricCanvasRef.current as any)._currentImageId
        if (currentCanvasImageId !== loadingImageId) {
          console.warn('Canvas图片ID不匹配，取消设置尺寸。Canvas:', currentCanvasImageId, '期望:', loadingImageId)
          return
        }
        
        // 再次检查图片ID是否匹配
        if (loadingImageId !== Number(currentImageId) || loadingImageId !== Number(loadingImageIdRef)) {
          console.warn('图片ID不匹配，取消设置尺寸。加载时:', loadingImageIdRef, '当前:', currentImageId, '图片:', loadingImageId)
          return
        }
        
        // 再次检查canvas是否还是原来的引用
        if (canvas !== fabricCanvasRef.current) {
          console.warn('Canvas引用失效，取消设置尺寸')
          return
        }
        
        // 设置canvas尺寸为缩放后的图片尺寸，并添加边距以便点击图像外的点
        // 边距设置为至少50像素，或者图片尺寸的5%（取较大值）
        const marginX = Math.max(50, img.width * scale * 0.05)
        const marginY = Math.max(50, img.height * scale * 0.05)
        const canvasWidth = img.width * scale + marginX * 2
        const canvasHeight = img.height * scale + marginY * 2
        
        try {
          fabricCanvasRef.current.setWidth(canvasWidth)
          fabricCanvasRef.current.setHeight(canvasHeight)
        } catch (error) {
          console.error('设置canvas尺寸失败:', error)
          return
        }
        
        // 清除旧的背景图片（如果有）
        if (fabricCanvasRef.current.backgroundImage) {
          fabricCanvasRef.current.setBackgroundImage(null, () => {
            fabricCanvasRef.current.renderAll()
          })
        }
        
        // 设置背景图片，确保背景图片不拦截鼠标事件
        // 将图片居中放置在canvas中（考虑边距）
        img.selectable = false
        img.evented = false
        img.set({
          left: marginX,
          top: marginY
        })
        fabricCanvasRef.current.setBackgroundImage(img, () => {
          // 再次检查canvas是否还存在和imageId是否匹配（使用最新的imageId）
          const currentImageIdCheck = imageIdRef.current
          const currentCanvasImageIdCheck = fabricCanvasRef.current ? (fabricCanvasRef.current as any)._currentImageId : null
          
          if (!fabricCanvasRef.current) {
            console.warn('Canvas已被清理，取消背景图片设置', '加载时imageId:', loadingImageId, '当前imageId:', currentImageIdCheck)
            return
          }
          
          if (loadingImageId !== Number(currentImageIdCheck) || loadingImageId !== currentCanvasImageIdCheck) {
            console.warn('imageId不匹配，取消背景图片设置', {
              loadingImageId,
              currentImageIdCheck,
              currentCanvasImageIdCheck,
              imageId: image.id
            })
            return
          }
          
          fabricCanvasRef.current.renderAll()
          console.log('背景图片设置完成，画布尺寸:', fabricCanvasRef.current.width, fabricCanvasRef.current.height, '缩放比例:', scale, 'imageId:', loadingImageId)
          
          // 再次检查imageId是否匹配
          const finalImageIdCheck = imageIdRef.current
          const finalCanvasImageId = (fabricCanvasRef.current as any)._currentImageId
          if (loadingImageId !== Number(finalImageIdCheck) || loadingImageId !== finalCanvasImageId) {
            console.warn('背景图片设置后imageId不匹配，取消绘制', {
              loadingImageId,
              finalImageIdCheck,
              finalCanvasImageId
            })
            return
          }
          
          // 背景图片设置完成后，如果已有标注和类别数据，立即绘制
          // 使用setTimeout确保状态已更新
          setTimeout(() => {
            const currentCanvas = fabricCanvasRef.current
            const currentImageId = imageIdRef.current
            
            // 再次检查所有状态
            if (!currentCanvas || !image || image.id !== Number(currentImageId)) {
              console.warn('背景图片设置后状态检查失败，取消绘制')
              return
            }
            
            // 检查canvas的imageId是否匹配
            const canvasImageId = (currentCanvas as any)._currentImageId
            if (canvasImageId !== loadingImageId) {
              console.warn('背景图片设置后canvas imageId不匹配，取消绘制', {
                canvasImageId,
                loadingImageId
              })
              return
            }
            
            // 使用ref获取最新的annotations和categories（避免闭包问题）
            const currentAnnotations = annotationsRef.current
            const currentCategories = categoriesRef.current
            const currentProject = project
            
            // 检查是否有标注需要绘制
            if (currentAnnotations.length > 0 && currentCategories.length > 0) {
              const bgImage = currentCanvas.backgroundImage as fabric.Image
              if (bgImage && bgImage.width && bgImage.height && currentCanvas.width && currentCanvas.height) {
                // 使用背景图片的缩放比例（而不是canvas.width / bgImage.width，因为canvas包含边距）
                const scaleForDraw = bgImage.scaleX || 1
                const originalImgWidth = image.width || bgImage.width
                const originalImgHeight = image.height || bgImage.height
                const annotationType = currentProject?.annotation_type || 'detection'
                console.log('背景图片设置完成后，触发绘制标注，标注数量:', currentAnnotations.length, '类型:', annotationType, 'scale:', scaleForDraw)
                // drawExistingAnnotations 内部会在绘制完成后通过 ref 调用 updateCategoryCounts
                drawExistingAnnotations(currentCanvas, currentAnnotations, currentCategories, originalImgWidth, originalImgHeight, scaleForDraw, annotationType)
              } else {
                console.warn('背景图片设置后，背景图片或Canvas尺寸不完整，无法绘制', {
                  bgImage: !!bgImage,
                  bgImageWidth: bgImage?.width,
                  bgImageHeight: bgImage?.height,
                  canvasWidth: currentCanvas.width,
                  canvasHeight: currentCanvas.height
                })
              }
            } else {
              console.log('背景图片设置后，没有标注需要绘制', {
                annotationsLength: currentAnnotations.length,
                categoriesLength: currentCategories.length
              })
            }
          }, 100)
        }, {
          scaleX: scale,
          scaleY: scale,
        })
      }, {
        crossOrigin: 'anonymous' // 允许跨域
      })
    } catch (error) {
      console.error('创建canvas时出错:', error)
      message.error('创建画布失败，请刷新页面重试')
    }
    
    // 清理函数
    return () => {
      // 只在imageId变化时清理，避免不必要的清理
      const cleanupImageId = imageIdRef.current
      if (fabricCanvasRef.current && image && image.id === Number(cleanupImageId)) {
        // 只有在当前图片的canvas才清理
        try {
          // 清除背景图片
          if (fabricCanvasRef.current.backgroundImage) {
            fabricCanvasRef.current.setBackgroundImage(null, () => {})
          }
          fabricCanvasRef.current.dispose()
        } catch (error) {
          console.error('清理canvas时出错:', error)
        }
        fabricCanvasRef.current = null
      }
      // 清理十字线ref
      crosshairHLineRef.current = null
      crosshairVLineRef.current = null
      updateCrosshairNativeRef.current = null
    }
  }, [image, drawExistingAnnotations]) // 只依赖image和drawExistingAnnotations，不依赖selectedCategory和categories，避免切换类别时重新创建canvas

  // 单独处理selectedCategory和categories的变化，更新mouse:down事件处理器
  // 注意：这个useEffect现在主要用于确保事件监听器使用最新的selectedCategory和categories
  // 主要的mouse:down事件监听器已经在canvas创建时添加
  useEffect(() => {
    if (fabricCanvasRef.current) {
      const canvas = fabricCanvasRef.current
      
      // 移除所有mouse:down监听器
      canvas.off('mouse:down')
      
      // 统一的事件处理器：处理选择和绘制
      const handleMouseDown = (e: fabric.IEvent<MouseEvent>) => {
        // 在事件处理的最开始立即保存 activeObject，因为 selection:cleared 可能在 mouse:down 之前触发
        const activeObjectAtStart = canvas.getActiveObject()
        const hadActivePolygonAtStart = activeObjectAtStart && activeObjectAtStart.type === 'polygon'
        // 也检查 ref 作为备用
        const hadActivePolygonFromRef = hasActivePolygonRef.current
        const hadActivePolygon = hadActivePolygonAtStart || hadActivePolygonFromRef
        // 是否有选中的标注（矩形或多边形），点击空白时应取消选择
        const hadActiveAnnotation = (activeObjectAtStart && (activeObjectAtStart.type === 'rect' || activeObjectAtStart.type === 'polygon')) || hasActiveAnnotationRef.current
        
        console.log('========== handleMouseDown 触发 ==========')
        console.log('事件信息:', { button: e.e.button, target: e.target, type: e.e.type })
        console.log('绘制状态:', { 
          isDrawingPolygon: isDrawingPolygonRef.current, 
          isDrawingRect: isDrawingRef.current,
          isPanning: isPanningRef.current 
        })
        console.log('点击前选中的对象:', { 
          activeObjectAtStart: activeObjectAtStart?.type,
          hadActivePolygonAtStart,
          hadActivePolygonFromRef,
          hadActivePolygon,
          hadActiveAnnotation
        })
        
        // 如果正在平移，不处理其他操作（右键拖动由原生事件处理）
        if (isPanningRef.current) {
          console.log('正在平移，忽略mouse:down')
          return
        }
        
        // 如果是右键，不处理（由原生事件处理）
        if (e.e.button === 2) {
          console.log('右键点击，忽略')
          return
        }
        
        // 多边形选中时：检测是否点击在边上（添加顶点）或顶点上（Delete 删除）
        if (activeObjectAtStart?.type === 'polygon') {
          const polygon = activeObjectAtStart as fabric.Polygon
          const pointer = canvas.getPointer(e.e)
          const points = polygon.points || []
          const pathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
          const transformMatrix = polygon.calcTransformMatrix()
          const zoom = canvas.getZoom() || 1
          const VERTEX_HIT_RADIUS = 12 / zoom
          const EDGE_HIT_RADIUS = 14 / zoom
          const VERTEX_CLOSE_THRESHOLD = 10 / zoom
          let hitEdge: number | null = null
          let hitVertex: number | null = null
          if (points.length >= 3) {
            for (let i = 0; i < points.length; i++) {
              const nextI = (i + 1) % points.length
              const p1 = points[i]
              const p2 = points[nextI]
              const local1 = { x: p1.x - pathOffset.x, y: p1.y - pathOffset.y }
              const local2 = { x: p2.x - pathOffset.x, y: p2.y - pathOffset.y }
              const canvas1 = fabric.util.transformPoint(local1, transformMatrix)
              const canvas2 = fabric.util.transformPoint(local2, transformMatrix)
              const distToP1 = Math.sqrt((pointer.x - canvas1.x) ** 2 + (pointer.y - canvas1.y) ** 2)
              const distToP2 = Math.sqrt((pointer.x - canvas2.x) ** 2 + (pointer.y - canvas2.y) ** 2)
              if (distToP1 < VERTEX_CLOSE_THRESHOLD || distToP2 < VERTEX_CLOSE_THRESHOLD) continue
              const segDx = canvas2.x - canvas1.x
              const segDy = canvas2.y - canvas1.y
              const lenSq = segDx * segDx + segDy * segDy
              const t = lenSq <= 0 ? 0 : Math.max(0, Math.min(1,
                ((pointer.x - canvas1.x) * segDx + (pointer.y - canvas1.y) * segDy) / lenSq))
              const closestX = canvas1.x + t * segDx
              const closestY = canvas1.y + t * segDy
              const dist = Math.sqrt((pointer.x - closestX) ** 2 + (pointer.y - closestY) ** 2)
              if (dist < EDGE_HIT_RADIUS) {
                hitEdge = i
                break
              }
            }
          }
          if (hitEdge === null) {
            for (let i = 0; i < points.length; i++) {
              const p = points[i]
              const localX = p.x - pathOffset.x
              const localY = p.y - pathOffset.y
              const canvasPt = fabric.util.transformPoint({ x: localX, y: localY }, transformMatrix)
              const dx = pointer.x - canvasPt.x
              const dy = pointer.y - canvasPt.y
              if (Math.sqrt(dx * dx + dy * dy) <= VERTEX_HIT_RADIUS) {
                hitVertex = i
                break
              }
            }
          }
          selectedVertexIndexRef.current = hitVertex
          canvas.renderAll()
          if (hitEdge !== null) {
            const anchorPoint = points[hitEdge]
            const oldPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
            const anchorLocalX = anchorPoint.x - oldPathOffset.x
            const anchorLocalY = anchorPoint.y - oldPathOffset.y
            const anchorAbsolute = fabric.util.transformPoint(
              { x: anchorLocalX, y: anchorLocalY },
              transformMatrix
            )
            const invMatrix = fabric.util.invertTransform(transformMatrix)
            const localPoint = fabric.util.transformPoint(pointer, invMatrix)
            const newX = localPoint.x + pathOffset.x
            const newY = localPoint.y + pathOffset.y
            const polygonPointsArray = [...(polygon.points || [])]
            polygonPointsArray.splice(hitEdge + 1, 0, { x: newX, y: newY })
            polygon.set({ points: polygonPointsArray })
            polygon._setPositionDimensions({})
            ;(polygon as any).dirty = true
            if ((polygon as any)._setPath) delete (polygon as any)._setPath
            const newPathOffset = (polygon as any).pathOffset || { x: 0, y: 0 }
            const newAnchorLocalX = anchorPoint.x - newPathOffset.x
            const newAnchorLocalY = anchorPoint.y - newPathOffset.y
            const newTransformMatrix = polygon.calcTransformMatrix()
            const newAnchorAbsolute = fabric.util.transformPoint(
              { x: newAnchorLocalX, y: newAnchorLocalY },
              newTransformMatrix
            )
            const deltaX = anchorAbsolute.x - newAnchorAbsolute.x
            const deltaY = anchorAbsolute.y - newAnchorAbsolute.y
            if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
              polygon.set({
                left: (polygon.left || 0) + deltaX,
                top: (polygon.top || 0) + deltaY
              })
            }
            polygon.setCoords()
            const edgeCategoryColor = (polygon as any).categoryId
              ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
              : '#FF0000'
            const edgeIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
            const edgeBaseOpts = {
              canvas,
              categoryColor: edgeCategoryColor,
              isSegmentation: edgeIsSeg,
              enableEdgeControls: true,
              selectedVertexIndexRef,
              onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
            }
            selectedVertexIndexRef.current = null
            createPolygonControls(polygon, {
              ...edgeBaseOpts,
              onRebuildControls: (poly) => createPolygonControls(poly, edgeBaseOpts),
            })
            canvas.renderAll()
            saveCurrentAnnotationsRef.current?.().catch(() => {})
            return
          }
        } else {
          selectedVertexIndexRef.current = null
        }
        
        // 如果正在绘制矩形，第二次点击完成画框
        if (isDrawingRef.current && startPointRef.current && rectRef.current) {
          console.log('第二次点击，完成矩形绘制')
          const pointer = canvas.getPointer(e.e)
          // 更新矩形最终尺寸
          const width = Math.abs(pointer.x - startPointRef.current.x)
          const height = Math.abs(pointer.y - startPointRef.current.y)
          rectRef.current.set({
            width: width,
            height: height,
            left: Math.min(pointer.x, startPointRef.current.x),
            top: Math.min(pointer.y, startPointRef.current.y),
          })
          canvas.renderAll()
          
          // 如果矩形太小，删除它
          if (rectRef.current.width! < 5 || rectRef.current.height! < 5) {
            console.log('矩形太小，删除它')
            canvas.remove(rectRef.current)
            rectRef.current = null
          } else {
            console.log('绘制完成，矩形尺寸:', rectRef.current.width, 'x', rectRef.current.height)
            // 确保矩形可以被选择和交互
            rectRef.current.set({
              selectable: true,
              evented: true
            })
            canvas.renderAll()
            // 自动保存标注
            console.log('完成矩形绘制，准备裁剪和保存')
            
            // 裁剪矩形到图片边界内
            const currentProject = projectRef.current || project
            const annotationType = currentProject?.annotation_type || 'detection'
            if (annotationType === 'detection' && rectRef.current) {
              const rect = rectRef.current
              const bgImage = canvas.backgroundImage as fabric.Image
              
              if (bgImage && bgImage.width && bgImage.height) {
                // 获取图片边界
                const imageLeft = bgImage.left || 0
                const imageTop = bgImage.top || 0
                const imageWidth = bgImage.width * (bgImage.scaleX || 1)
                const imageHeight = bgImage.height * (bgImage.scaleY || 1)
                const imageRight = imageLeft + imageWidth
                const imageBottom = imageTop + imageHeight
                
                // 获取矩形的实际边界框
                const scaleX = rect.scaleX || 1
                const scaleY = rect.scaleY || 1
                const originX = rect.originX || 'left'
                const originY = rect.originY || 'top'
                const baseWidth = rect.width || 0
                const baseHeight = rect.height || 0
                const displayWidth = baseWidth * scaleX
                const displayHeight = baseHeight * scaleY
                
                // 根据原点计算实际显示的左上角坐标
                let actualLeft = rect.left || 0
                let actualTop = rect.top || 0
                
                if (originX === 'center') {
                  actualLeft = actualLeft - displayWidth / 2
                } else if (originX === 'right') {
                  actualLeft = actualLeft - displayWidth
                }
                
                if (originY === 'center') {
                  actualTop = actualTop - displayHeight / 2
                } else if (originY === 'bottom') {
                  actualTop = actualTop - displayHeight
                }
                
                const rectLeft = actualLeft
                const rectTop = actualTop
                const rectRight = actualLeft + displayWidth
                const rectBottom = actualTop + displayHeight
                
                // 首先检查矩形是否完全在图片外
                const isCompletelyOutside = isRectCompletelyOutsideImage(rect, canvas)
                
                if (isCompletelyOutside) {
                  console.log('绘制完成后：矩形完全在图片外，删除矩形')
                  canvas.remove(rect)
                  rectRef.current = null
                  canvas.renderAll()
                  // 恢复状态
                  isDrawingRef.current = false
                  startPointRef.current = null
                  rectRef.current = null
                  canvas.selection = true
                  return
                }
                
                // 计算裁剪后的边界
                const clippedLeft = Math.max(rectLeft, imageLeft)
                const clippedTop = Math.max(rectTop, imageTop)
                const clippedRight = Math.min(rectRight, imageRight)
                const clippedBottom = Math.min(rectBottom, imageBottom)
                
                // 检查是否需要裁剪（矩形部分超出图片边界）
                const needsClip = clippedLeft > rectLeft || clippedTop > rectTop ||
                                 clippedRight < rectRight || clippedBottom < rectBottom
                
                if (needsClip) {
                  const clippedWidth = clippedRight - clippedLeft
                  const clippedHeight = clippedBottom - clippedTop
                  
                  console.log('绘制完成后裁剪矩形')
                  
                  rect.set({
                    left: clippedLeft,
                    top: clippedTop,
                    width: clippedWidth,
                    height: clippedHeight,
                    scaleX: 1,
                    scaleY: 1,
                    originX: 'left',
                    originY: 'top'
                  })
                  rect.setCoords()
                  canvas.renderAll()
                }
              }
            }
            
            if (saveCurrentAnnotationsRef.current) {
              saveCurrentAnnotationsRef.current().catch(error => {
                console.error('完成矩形绘制后保存失败:', error)
              })
            } else {
              setTimeout(() => {
                if (saveCurrentAnnotationsRef.current) {
                  saveCurrentAnnotationsRef.current().catch(error => {
                    console.error('完成矩形绘制后保存失败:', error)
                  })
                }
              }, 100)
            }
          }
          
          // 恢复状态
          console.log('绘制完成，恢复选择功能')
          canvas.selection = true
          isDrawingRef.current = false
          startPointRef.current = null
          rectRef.current = null
          return
        }
        
        // 获取点击位置
        const pointer = canvas.getPointer(e.e)
        const annotationType = project?.annotation_type || 'detection'
        console.log('点击位置（pointer）:', pointer, 'canvas尺寸:', { width: canvas.width, height: canvas.height })
        
        // 如果点击的是空白区域（e.target 为 null 或背景图片），检查是否有选中的标注（矩形或多边形）
        // 有则取消选择，而非开始新标注
        if (!e.target || e.target === canvas.backgroundImage) {
          if (hadActiveAnnotation) {
            console.log('点击空白区域，取消选择标注（矩形或多边形）')
            canvas.discardActiveObject()
            canvas.renderAll()
            return
          }
        }
        
        // 如果正在绘制多边形
        if (isDrawingPolygonRef.current) {
          console.log('========== 开始添加多边形顶点 ==========')
          console.log('当前点数:', polygonPointsRef.current.length)
          console.log('点击位置（pointer）:', pointer)
          
          // 确定要添加的顶点位置
          let newPoint = { x: pointer.x, y: pointer.y }
          
          // 如果不是第一个点，检查点击位置是否超出图片边界
          if (polygonPointsRef.current.length > 0) {
            const lastPoint = polygonPointsRef.current[polygonPointsRef.current.length - 1]
            console.log('最后一点:', lastPoint, '点击位置:', newPoint)
            
            // 计算引导线与图片边界的交点
            try {
              const intersection = getLineImageBoundaryIntersection(lastPoint, newPoint)
              console.log('交点计算结果:', intersection)
              
              if (intersection) {
                // 如果找到交点，使用交点作为新顶点
                newPoint = intersection
                console.log('✓ 找到交点，使用边界交点作为新顶点:', intersection)
              } else {
                console.log('✗ 未找到交点，使用原始点击位置')
              }
            } catch (error) {
              console.error('计算交点时出错:', error)
              console.log('使用原始点击位置')
            }
          } else {
            console.log('这是第一个点，直接使用点击位置')
          }
          
          // 添加新的顶点
          console.log('最终添加的顶点:', newPoint)
          polygonPointsRef.current.push(newPoint)
          console.log('添加后点数:', polygonPointsRef.current.length)
          console.log('========== 顶点添加完成 ==========')
          
          // 移除旧的临时线段
          if (polygonLineRef.current) {
            canvas.remove(polygonLineRef.current)
            polygonLineRef.current = null
          }
          
          // 如果有2个或更多点，更新预览多边形
          if (polygonPointsRef.current.length >= 2) {
            updatePreviewPolygon()
            updatePointMarkers()
          } else {
            // 只有一个点时，也要更新点标记
            updatePointMarkers()
          }
          
          canvas.renderAll()
          return
        }
        
        // 检查点击的对象类型（矩形或多边形）
        const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
        const objects = canvas.getObjects().filter(obj => annotationTypes.includes(obj.type))
        let clickedObject: fabric.Object | null = null
        
        // 从最上层开始检查
        for (let i = objects.length - 1; i >= 0; i--) {
          const obj = objects[i]
          if (obj.type === 'rect') {
            const rect = obj as fabric.Rect
            const rectLeft = rect.left || 0
            const rectTop = rect.top || 0
            const rectWidth = rect.width || 0
            const rectHeight = rect.height || 0
            
            if (pointer.x >= rectLeft && pointer.x <= rectLeft + rectWidth &&
                pointer.y >= rectTop && pointer.y <= rectTop + rectHeight) {
              clickedObject = rect
              break
            }
          } else if (obj.type === 'polygon') {
            const polygon = obj as fabric.Polygon
            // 使用Fabric.js的内置方法检查点是否在多边形内
            if (polygon.containsPoint(pointer)) {
              clickedObject = polygon
              break
            }
          }
        }
        
        // 使用 findTarget 查找点击的对象（排除背景图片）
        const target = canvas.findTarget(e.e, false) as fabric.Object | null
        const isTargetAnnotation = target && annotationTypes.includes(target.type)
        
        // 如果点击的是已有标注对象，选择它
        const objectToSelect = clickedObject || (isTargetAnnotation ? target : null)
        if (objectToSelect) {
          canvas.selection = true
          objectToSelect.set({
            selectable: true,
            evented: true
          })
          canvas.setActiveObject(objectToSelect)
          canvas.renderAll()
          return
        }
        
        // 如果点击的是空白区域（没有点击到任何标注对象）
        // 检查是否有选中的标注（矩形或多边形），如果有则取消选择
        if (!clickedObject && !isTargetAnnotation && hadActiveAnnotation) {
          console.log('点击空白区域，取消选择标注')
          canvas.discardActiveObject()
          canvas.renderAll()
          return
        }
        
        // 如果没有选中的标注，开始绘制
        if (selectedCategory === null || selectedCategory === undefined) {
          message.warning('请先选择类别')
          return
        }
        
        if (annotationType === 'segmentation') {
          // 开始绘制多边形
          canvas.selection = false
          // 禁用所有现有对象的选择，防止在绘制时误选中
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = false
          })
          isDrawingPolygonRef.current = true
          polygonPointsRef.current = [{ x: pointer.x, y: pointer.y }]
          
          // 创建第一个点标记
          const categoryColor = categories.find(c => c.id === selectedCategory)?.color || '#FF0000'
          const firstMarker = new fabric.Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 4,
            fill: categoryColor,
            stroke: '#fff',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            originX: 'center',
            originY: 'center',
          })
          canvas.add(firstMarker)
          polygonPointMarkersRef.current.push(firstMarker)
          canvas.renderAll()
        } else {
          // 开始绘制矩形
          canvas.selection = false
          isDrawingRef.current = true
          startPointRef.current = { x: pointer.x, y: pointer.y }
          const categoryColor = categories.find(c => c.id === selectedCategory)?.color || '#FF0000'
          const rectBaseStroke = 2
          const rect = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 0,
            height: 0,
            fill: 'transparent',
            stroke: categoryColor,
            strokeWidth: Math.max(0.5, rectBaseStroke / (canvas.getZoom() || 1)),
            strokeUniform: true, // 确保线宽不受对象缩放影响
            objectCaching: false, // 禁用缓存，否则缩放时 strokeUniform 会失效（fabric#6413）
            selectable: true,
            evented: true,
          })
          ;(rect as any)._baseStrokeWidth = rectBaseStroke
          rect.set({
            uniformScaling: false,
            lockUniScaling: false,
            lockRotation: true, // 目标检测标注框不支持旋转
          })
          ;(rect as any).categoryId = selectedCategory
          canvas.add(rect)
          rectRef.current = rect
        }
      }

      // 添加双击事件，完成多边形绘制
      const handleDoubleClick = (e: fabric.IEvent<MouseEvent>) => {
        if (isDrawingPolygonRef.current && polygonPointsRef.current.length >= 3) {
          finishPolygonDrawing()
        }
      }
      
      canvas.on('mouse:down', handleMouseDown)
      canvas.on('mouse:dblclick', handleDoubleClick)
      
      // 确保选择功能默认启用
      canvas.selection = true
      console.log('注册mouse:down监听器完成，选择功能已启用，canvas.selection:', canvas.selection, 'canvas对象数量:', canvas.getObjects().length)
      
      return () => {
        canvas.off('mouse:down', handleMouseDown)
        canvas.off('mouse:dblclick', handleDoubleClick)
      }
    }
  }, [selectedCategory, categories, project, getLineImageBoundaryIntersection, createPolygonControls])


  // 将YOLO格式转换为canvas坐标
  const convertFromYOLO = (bbox: any, imgWidth: number, imgHeight: number) => {
    const x_center = bbox.x_center * imgWidth
    const y_center = bbox.y_center * imgHeight
    const width = bbox.width * imgWidth
    const height = bbox.height * imgHeight
    return {
      left: x_center - width / 2,
      top: y_center - height / 2,
      width,
      height,
    }
  }


  // 注意：自动保存事件监听器现在在canvas创建时直接设置，不需要单独的useEffect

  // 计算标注进度（优先显示任务包进度，如果没有任务包则显示项目进度）
  const getProgressInfo = () => {
    // 如果有任务包统计信息，使用任务包进度
    if (taskStats) {
      const percentage = taskStats.total_images > 0 
        ? Math.round((taskStats.annotated_images / taskStats.total_images) * 100) 
        : 0
      return {
        percentage,
        annotated: taskStats.annotated_images,
        total: taskStats.total_images,
        isTaskProgress: true
      }
    }
    
    // 否则使用项目进度
    if (stats) {
      const percentage = stats.total_images > 0 
        ? Math.round((stats.annotated_images / stats.total_images) * 100) 
        : 0
      return {
        percentage,
        annotated: stats.annotated_images,
        total: stats.total_images,
        isTaskProgress: false
      }
    }
    
    return { percentage: 0, annotated: 0, total: 0, isTaskProgress: false }
  }

  const progressInfo = getProgressInfo()

  // 计算每个类别在当前图片中的数量
  const updateCategoryCounts = useCallback(() => {
    if (!fabricCanvasRef.current || !project) return
    
    const canvas = fabricCanvasRef.current
    const annotationType = project.annotation_type || 'detection'
    const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
    
    // 获取所有标注对象
    const allObjects = canvas.getObjects()
    const annotationObjects = allObjects.filter((obj) => annotationTypes.includes(obj.type))
    
    // 统计每个类别的数量
    const counts: Record<number, number> = {}
    annotationObjects.forEach((obj) => {
      const categoryId = (obj as any).categoryId
      if (categoryId !== undefined && categoryId !== null) {
        counts[categoryId] = (counts[categoryId] || 0) + 1
      }
    })
    
    setCategoryCounts(counts)
  }, [project])
  
  // 存储 updateCategoryCounts 的引用（在 useEffect 中更新，避免在渲染时执行）
  useEffect(() => {
    updateCategoryCountsRef.current = updateCategoryCounts
  }, [updateCategoryCounts])

  // 监听canvas对象变化，更新类别计数
  useEffect(() => {
    if (!fabricCanvasRef.current || !imageId) return
    
    const canvas = fabricCanvasRef.current
    
    // 创建更新函数
    const handleCanvasUpdate = () => {
      // 使用setTimeout确保在下一个事件循环中更新，避免在事件处理过程中更新状态
      setTimeout(() => {
        updateCategoryCounts()
      }, 0)
    }
    
    // 监听canvas对象添加、删除、修改事件
    canvas.on('object:added', handleCanvasUpdate)
    canvas.on('object:removed', handleCanvasUpdate)
    canvas.on('object:modified', handleCanvasUpdate)
    canvas.on('path:created', handleCanvasUpdate)
    
    // 初始计算一次
    updateCategoryCounts()
    
    // 清理函数
    return () => {
      canvas.off('object:added', handleCanvasUpdate)
      canvas.off('object:removed', handleCanvasUpdate)
      canvas.off('object:modified', handleCanvasUpdate)
      canvas.off('path:created', handleCanvasUpdate)
    }
  }, [imageId, updateCategoryCounts])

  // 当imageId变化时，重置类别计数
  useEffect(() => {
    setCategoryCounts({})
  }, [imageId])

  // 如果imageId或projectId不存在，显示加载中
  if (!imageId || !projectId) {
    return (
      <Layout className="annotation-layout">
        <Content style={{ padding: 50, textAlign: 'center' }}>
          <div>加载中...</div>
        </Content>
      </Layout>
    )
  }

  return (
    <Layout className="annotation-layout">
      <Header className="annotation-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={async () => {
            // 先保存当前图片的标注
            try {
              await saveCurrentAnnotations()
              message.success('标注已保存')
            } catch (error) {
              console.error('保存标注失败:', error)
              // 即使保存失败也继续返回
            }
            // 清理canvas
            if (fabricCanvasRef.current) {
              fabricCanvasRef.current.dispose()
              fabricCanvasRef.current = null
            }
            // 清理十字线ref
            crosshairHLineRef.current = null
            crosshairVLineRef.current = null
            updateCrosshairNativeRef.current = null
            navigate(`/projects/${projectId}`)
          }}>
            返回
          </Button>
          <span>标注工具</span>
          {/* 显示标注进度 */}
          <span style={{ marginLeft: 16, color: '#fff', fontSize: '14px' }}>
            {progressInfo.isTaskProgress && currentTask ? (
              <>工作包进度 ({currentTask.name}): {progressInfo.annotated}/{progressInfo.total} ({progressInfo.percentage}%)</>
            ) : (
              <>进度: {progressInfo.annotated}/{progressInfo.total} ({progressInfo.percentage}%)</>
            )}
          </span>
          <span style={{ marginLeft: 8, color: '#999', fontSize: '12px' }}>
            A键上一张 | D键下一张 | 自动保存 | 滚轮缩放 | 右键拖动平移
            {project?.annotation_type === 'detection' && ' | 单击开始画框 | 再次单击完成 | Esc取消'}
            {project?.annotation_type === 'segmentation' && ' | 点击绘制多边形 | 双击/Enter完成 | Esc完成(≥3点)或取消 | 右键单击删除最后一点'}
          </span>
        </Space>
      </Header>
      <Layout style={{ flex: 1 }}>
        <Content className="annotation-content">
          <div className="canvas-container">
            <canvas ref={canvasRef} />
          </div>
        </Content>
        <Sider width={200} className="category-sider" theme="light">
          <div className="category-list-container">
            <div className="category-list-title">类别列表</div>
            {categories.length === 0 ? (
              <div className="category-empty">暂无类别，请在项目设置中添加</div>
            ) : (
              <div className="category-list">
                {categories.map((cat) => {
                  const isSelected = cat.id === selectedCategory
                  return (
                    <div
                      key={cat.id}
                      className={`category-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        console.log('类别选择变化:', cat.id)
                        setSelectedCategory(cat.id)
                      }}
                      style={{
                        borderLeftColor: cat.color || '#FF0000',
                        backgroundColor: isSelected ? '#e6f7ff' : 'transparent'
                      }}
                    >
                      <span className="category-color-dot" style={{ color: cat.color || '#FF0000' }}>●</span>
                      <span className="category-name">
                        {cat.name}
                        <span className="category-count">
                          {categoryCounts[cat.id] || 0}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Sider>
      </Layout>
      <Footer className="annotation-footer">
        <div className="preview-images-container">
          {previewImages.map((img) => {
            const isCurrent = img.id === Number(imageId)
            // 在开发环境中，使用相对路径通过Vite代理访问，避免CORS问题
            // 在生产环境中，使用完整的API URL
            const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()
            // 统一URL编码方式，对每个路径段进行编码
            const pathParts = img.filepath.split('/').filter(part => part) // 过滤空字符串
            const encodedPathParts = pathParts.map((part) => {
              return encodeURIComponent(part)
            })
            const encodedFilepath = encodedPathParts.join('/')
            const imgUrl = `${apiBaseUrl}/uploads/${encodedFilepath}`
            return (
              <div
                key={img.id}
                className={`preview-image-item ${isCurrent ? 'current' : ''}`}
                onClick={async () => {
                  if (!isCurrent) {
                    // 如果正在导航，忽略点击
                    if (navigatingRef.current) {
                      return
                    }
                    
                    // 设置导航锁
                    navigatingRef.current = true
                    
                    try {
                      // 先保存当前图片的标注，必须等待完成
                      try {
                        await saveCurrentAnnotations()
                        console.log('保存完成，准备切换图片')
                      } catch (error) {
                        console.error('保存标注失败:', error)
                        // 即使保存失败也继续切换
                      }
                      
                      console.log('切换到图片:', img.id)
                      navigate(`/projects/${projectId}/annotate/${img.id}`)
                    } finally {
                      // 延迟释放导航锁，确保导航完成
                      setTimeout(() => {
                        navigatingRef.current = false
                      }, 200)
                    }
                  }
                }}
              >
                <img src={imgUrl} alt={img.filename} />
                {isCurrent && <div className="preview-image-indicator">当前</div>}
                {img.is_annotated && <div className="preview-image-annotated">✓</div>}
              </div>
            )
          })}
        </div>
      </Footer>
    </Layout>
  )
}
