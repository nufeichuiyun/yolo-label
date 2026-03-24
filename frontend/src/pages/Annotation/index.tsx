import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout, Button, Space, message } from 'antd'
const { Header, Content, Footer, Sider } = Layout
import { ArrowLeftOutlined } from '@ant-design/icons'
import { fabric } from 'fabric'
import { imagesApi, Image } from '../../api/images'
import { categoriesApi, Category } from '../../api/categories'
import { annotationsApi } from '../../api/annotations'
import { statsApi, ProjectStats, TaskStats } from '../../api/stats'
import { projectsApi, Project } from '../../api/projects'
import { tasksApi, Task } from '../../api/tasks'
import { useAuth } from '../../contexts/AuthContext'
import './Annotation.css'

// Hooks
import { useZoomPan } from './hooks/useZoomPan'
import { useImageLoader } from './hooks/useImageLoader'
import { useAnnotations } from './hooks/useAnnotations'
import { useDrawing } from './hooks/useDrawing'
import { useSelection } from './hooks/useSelection'
// useKeyboard not used directly — keyboard handling is inline for more comprehensive control

// Constants
import { RIGHT_CLICK_THRESHOLD, RIGHT_CLICK_TIME_THRESHOLD } from './utils/constants'

// 动态获取API地址
const getApiBaseUrl = () => {
  if (import.meta.env.DEV) {
    return ''
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
  const { user } = useAuth()

  // ============================================================
  // Page-level state
  // ============================================================
  const [image, setImage] = useState<Image | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [annotations, setAnnotations] = useState<any[]>([])
  const [allImages, setAllImages] = useState<Image[]>([])
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [currentTask, setCurrentTask] = useState<Task | null>(null)
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null)
  const [previewImages, setPreviewImages] = useState<Image[]>([])
  const [categoryCounts, setCategoryCounts] = useState<Record<number, number>>({})

  // Refs for closure-safe access
  const categoriesRef = useRef<Category[]>([])
  const projectRef = useRef<Project | null>(null)
  const imageRef = useRef<Image | null>(null)
  const imageIdRef = useRef<string | undefined>(undefined)
  const selectedCategoryRef = useRef<number | null>(null)
  const navigatingRef = useRef<boolean>(false)
  const saveCurrentAnnotationsRef = useRef<(() => Promise<void>) | null>(null)
  const rightMouseDownPointRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const loadingAllImagesRef = useRef<boolean>(false)
  const updateCategoryCountsRef = useRef<(() => void) | null>(null)

  // Keep refs in sync with state
  useEffect(() => { imageRef.current = image }, [image])
  useEffect(() => { imageIdRef.current = imageId }, [imageId])
  useEffect(() => { selectedCategoryRef.current = selectedCategory }, [selectedCategory])
  useEffect(() => { categoriesRef.current = categories }, [categories])
  useEffect(() => { projectRef.current = project }, [project])

  // ============================================================
  // Canvas ref (canvas is created in the image-display useEffect below)
  // ============================================================
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)

  // ============================================================
  // Drawing hook (needs to be created before selection for refs)
  // ============================================================
  // We need selection.createPolygonControls for drawing, and drawing.isDrawingRef for selection.
  // Resolve by creating selection first (it needs drawing.hideCrosshair and drawing.isDrawingRef).
  // But drawing needs selection.createPolygonControls and selection.selectedVertexIndexRef.
  // Solution: create drawing first with a proxy for createPolygonControls via ref.

  const createPolygonControlsRef = useRef<any>(null)
  const selectedVertexIndexProxyRef = useRef<number | null>(null)

  const drawing = useDrawing({
    canvasRef: fabricCanvasRef,
    categoriesRef,
    selectedCategoryRef,
    projectRef,
    saveCurrentAnnotationsRef,
    selectedVertexIndexRef: selectedVertexIndexProxyRef,
    createPolygonControls: (...args: any[]) => {
      if (createPolygonControlsRef.current) {
        createPolygonControlsRef.current(...args)
      }
    },
    isPanningRef: useRef(false), // Will be synced below
  })

  // ============================================================
  // Selection hook
  // ============================================================
  const selection = useSelection({
    categoriesRef,
    projectRef,
    saveCurrentAnnotationsRef,
    isDrawingRef: drawing.isDrawingRef,
    hideCrosshair: drawing.hideCrosshair,
    restoreCrosshairFromLastEvent: drawing.restoreCrosshairFromLastEvent,
  })

  // Wire createPolygonControls proxy
  useEffect(() => {
    createPolygonControlsRef.current = selection.createPolygonControls
  }, [selection.createPolygonControls])

  // Sync selectedVertexIndex proxy with selection's ref
  useEffect(() => {
    // These refs need to be the same object
    // Since we can't reassign refs, we'll use selection's ref directly
    // by overriding the proxy
  }, [])

  // ============================================================
  // ZoomPan hook
  // ============================================================
  const zoomPan = useZoomPan({
    canvasRef: fabricCanvasRef,
    isDrawingRef: drawing.isDrawingRef,
    isDrawingPolygonRef: drawing.isDrawingPolygonRef,
  })

  // Sync isPanningRef - drawing needs this
  // We need to update drawing's isPanningRef to point to zoomPan's
  // Since we can't change the ref after creation, we sync manually in effects

  // ============================================================
  // Image loader hook
  // ============================================================
  const imageLoader = useImageLoader({
    canvasRef: fabricCanvasRef,
    setCanvasSize: useCallback(() => {}, []),  // canvas 尺寸在 useEffect 中直接管理
    onImageLoaded: useCallback(() => {}, []),
    onBeforeSwitch: useCallback(() => {}, []),
    getApiBaseUrl,
  })

  // ============================================================
  // Annotations hook
  // ============================================================
  const annotationsMgr = useAnnotations({
    canvasRef: fabricCanvasRef,
    imageBoundsRef: imageLoader.imageBoundsRef,
    imageRef,
    imageIdRef,
    categoriesRef,
    projectRef,
    selectedVertexIndexRef: selection.selectedVertexIndexRef,
    saveCurrentAnnotationsRef,
    createPolygonControls: selection.createPolygonControls,
    onStatsUpdate: useCallback(() => {
      if (projectId) {
        statsApi.getProjectStats(Number(projectId)).then(setStats).catch(console.error)
      }
    }, [projectId]),
  })

  // Store saveCurrentAnnotations in ref
  useEffect(() => {
    saveCurrentAnnotationsRef.current = annotationsMgr.saveCurrentAnnotations
  }, [annotationsMgr.saveCurrentAnnotations])

  // ============================================================
  // Data loading functions
  // ============================================================

  const updatePreviewImages = useCallback((images: Image[], currentImageId: number) => {
    const currentIndex = images.findIndex(img => img.id === currentImageId)
    if (currentIndex === -1) {
      setPreviewImages([])
      return
    }
    const previewCount = 5
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
      categoriesRef.current = data
      if (data.length > 0 && selectedCategoryRef.current === null) {
        setSelectedCategory(data[0].id)
      }
    } catch (error) {
      message.error('加载类别失败')
    }
  }, [projectId])

  const loadAnnotations = useCallback(async () => {
    if (!imageId) return
    try {
      const data = await annotationsApi.getImageAnnotations(Number(imageId))
      setAnnotations(data)
      annotationsMgr.annotationsRef.current = data
    } catch (error) {
      setAnnotations([])
      annotationsMgr.annotationsRef.current = []
    }
  }, [imageId, annotationsMgr.annotationsRef])

  const loadAllImages = useCallback(async () => {
    if (!projectId) return
    if (loadingAllImagesRef.current) return
    loadingAllImagesRef.current = true
    try {
      const data = await imagesApi.list(Number(projectId), 0, 10000)
      const sortedImages = [...data.items].sort((a, b) => a.id - b.id)
      setAllImages(sortedImages)
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
      projectRef.current = data
    } catch (error) {
      console.error('加载项目信息失败:', error)
      message.error('加载项目信息失败')
    }
  }, [projectId])

  // ============================================================
  // Navigate to image (prev/next)
  // ============================================================

  const navigateToImage = useCallback(async (direction: 'prev' | 'next') => {
    if (navigatingRef.current) return
    if (allImages.length === 0 || !imageId || !projectId) return

    navigatingRef.current = true

    try {
      const currentImageId = imageId

      // Save current annotations first
      try {
        while (annotationsMgr.savingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        await annotationsMgr.saveCurrentAnnotations()
        while (annotationsMgr.savingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (imageIdRef.current !== currentImageId) return
      } catch (error) {
        console.error('保存失败，但继续切换图片', error)
      }

      const currentIndex = allImages.findIndex(img => img.id === Number(imageId))
      if (currentIndex === -1) return

      let targetIndex: number
      if (direction === 'prev') {
        targetIndex = currentIndex - 1
        if (targetIndex < 0) {
          message.info('已经是第一张图片')
          return
        }
      } else {
        targetIndex = currentIndex + 1
        if (targetIndex >= allImages.length) {
          message.info('已经是最后一张图片')
          return
        }
      }

      if (imageIdRef.current !== currentImageId) return

      const targetImage = allImages[targetIndex]
      navigate(`/projects/${projectId}/annotate/${targetImage.id}`)
    } finally {
      setTimeout(() => {
        navigatingRef.current = false
      }, 300)
    }
  }, [allImages, imageId, projectId, navigate, annotationsMgr.saveCurrentAnnotations, annotationsMgr.savingRef])

  // ============================================================
  // Category counts
  // ============================================================

  const updateCategoryCounts = useCallback(() => {
    if (!fabricCanvasRef.current || !project) return

    const canvas = fabricCanvasRef.current
    const annotationType = project.annotation_type || 'detection'
    const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']

    const allObjects = canvas.getObjects()
    const annotationObjects = allObjects.filter((obj: fabric.Object) => annotationTypes.includes(obj.type!))

    const counts: Record<number, number> = {}
    annotationObjects.forEach((obj: fabric.Object) => {
      const categoryId = (obj as any).categoryId
      if (categoryId !== undefined && categoryId !== null) {
        counts[categoryId] = (counts[categoryId] || 0) + 1
      }
    })

    setCategoryCounts(counts)
  }, [project])

  useEffect(() => {
    updateCategoryCountsRef.current = updateCategoryCounts
  }, [updateCategoryCounts])

  // ============================================================
  // Progress info
  // ============================================================

  const getProgressInfo = () => {
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
  const currentImageIndex = allImages.findIndex(img => img.id === Number(imageId))
  const currentPosition = currentImageIndex >= 0 ? currentImageIndex + 1 : 0
  const totalImages = allImages.length

  // ============================================================
  // useEffects: Project-level data loading
  // ============================================================

  useEffect(() => {
    if (projectId) {
      loadProject()
      loadAllImages()
      loadStats()
      loadCategories()
    }
  }, [projectId, loadProject, loadAllImages, loadStats, loadCategories])

  // ============================================================
  // useEffect: Image change handling
  // ============================================================

  useEffect(() => {
    if (!imageId || !projectId) return

    const targetImageId = imageId

    const handleImageChange = async () => {
      // Save old image annotations if switching
      const oldCanvas = fabricCanvasRef.current
      const oldImage = imageRef.current
      const oldImageId = imageIdRef.current
      if (oldCanvas && oldImage && oldImageId && oldImageId !== targetImageId) {
        try {
          await saveCurrentAnnotationsRef.current?.()
        } catch (error) {
          console.error('保存旧图片标注失败:', error)
        }
      }

      // Update ref to new imageId
      imageIdRef.current = targetImageId

      // Reset state
      setImage(null)
      setAnnotations([])
      annotationsMgr.annotationsRef.current = []

      // Load new image data
      try {
        const data = await imagesApi.get(Number(targetImageId))
        if (imageIdRef.current !== targetImageId) return // stale
        setImage(data)
      } catch (error) {
        console.error('加载图片失败:', error)
        message.error('加载图片失败')
      }

      try {
        const data = await annotationsApi.getImageAnnotations(Number(targetImageId))
        if (imageIdRef.current !== targetImageId) return // stale
        setAnnotations(data)
        annotationsMgr.annotationsRef.current = data
      } catch (error) {
        setAnnotations([])
        annotationsMgr.annotationsRef.current = []
      }

      try {
        const task = await tasksApi.getImageTask(Number(targetImageId))
        if (imageIdRef.current !== targetImageId) return // stale
        setCurrentTask(task)
        if (task) {
          const taskStatsData = await statsApi.getTaskStats(task.id)
          setTaskStats(taskStatsData)
        } else {
          setTaskStats(null)
        }
      } catch (error) {
        setCurrentTask(null)
        setTaskStats(null)
      }
    }

    handleImageChange()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, projectId])

  // ============================================================
  // useEffect: Update preview images
  // ============================================================

  useEffect(() => {
    if (allImages.length > 0 && imageId) {
      updatePreviewImages(allImages, Number(imageId))
    }
  }, [allImages, imageId, updatePreviewImages])

  // ============================================================
  // useEffect: Reset category counts on imageId change
  // ============================================================

  useEffect(() => {
    setCategoryCounts({})
  }, [imageId])

  // ============================================================
  // useEffect: Canvas creation, event binding, image display
  // ============================================================

  useEffect(() => {
    if (!image || !canvasElRef.current) return

    const currentImageId = imageIdRef.current
    const targetImageId = image.id

    if (targetImageId !== Number(currentImageId)) return

    // If canvas exists for the same image, skip
    if (fabricCanvasRef.current) {
      const existingCanvasImageId = (fabricCanvasRef.current as any)._currentImageId
      if (existingCanvasImageId === targetImageId) return
      // Clean up old canvas
      try {
        fabricCanvasRef.current.dispose()
      } catch (error) {
        console.error('清理旧canvas时出错:', error)
      }
      fabricCanvasRef.current = null
    }

    if (imageIdRef.current !== currentImageId || image.id !== targetImageId) return

    // Create canvas
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: 800,
      height: 600,
      stopContextMenu: true,
      selection: true,
      uniformScaling: false,
    })

    // before:render — stroke width scales inversely with zoom
    canvas.on('before:render', () => {
      const zoom = canvas.getZoom() || 1
      canvas.getObjects().forEach((obj: fabric.Object) => {
        if (obj.type === 'rect') {
          const base = (obj as any)._baseStrokeWidth ?? 2
          obj.set({
            strokeWidth: Math.max(0.5, base / zoom),
            strokeUniform: true,
            objectCaching: false,
          } as any, false)
          ;(obj as any)._baseStrokeWidth = base
        } else if (obj.type === 'polygon') {
          const base = (obj as any)._baseStrokeWidth ?? 3
          obj.set('strokeWidth', Math.max(0.5, base / zoom), false)
          ;(obj as any)._baseStrokeWidth = base
        }
      })
    })

    fabricCanvasRef.current = canvas
    ;(canvas as any)._currentImageId = targetImageId

    // --- Bind selection events (from useSelection) ---
    selection.bindSelectionEvents(canvas)

    // --- Setup crosshair (from useDrawing) ---
    drawing.setupCrosshair(canvas)

    // --- Mouse wheel zoom (inline, since useZoomPan can't track canvas lifecycle) ---
    canvas.on('mouse:wheel', ((opt: fabric.IEvent<WheelEvent>) => {
      const e = opt.e
      e.preventDefault()
      e.stopPropagation()

      if (drawing.isDrawingRef.current || drawing.isDrawingPolygonRef.current) return

      const delta = e.deltaY
      let zoom = canvas.getZoom()

      const bgImage = canvas.backgroundImage as fabric.Image
      let minZoom = 0.1
      if (bgImage && bgImage.width && bgImage.height) {
        const imgW = bgImage.width * (bgImage.scaleX || 1)
        const imgH = bgImage.height * (bgImage.scaleY || 1)
        const canvasEffW = canvas.getWidth() * 0.9
        const canvasEffH = canvas.getHeight() * 0.9
        minZoom = Math.max(canvasEffW / imgW, canvasEffH / imgH, 0.1)
      }

      if (delta < 0) {
        zoom = Math.min(zoom + 0.1, 5)
      } else {
        zoom = Math.max(zoom - 0.1, minZoom)
      }

      const pointer = canvas.getPointer(e)
      canvas.zoomToPoint(new fabric.Point(pointer.x, pointer.y), zoom)
      zoomPan.constrainImagePosition(canvas)
    }) as any)

    // --- Fabric mouse events ---

    // mouse:move
    canvas.on('mouse:move', (e: fabric.IEvent<MouseEvent>) => {
      // Handle panning
      if (zoomPan.isPanningRef.current && zoomPan.lastPanPointRef.current) {
        e.e.preventDefault()
        e.e.stopPropagation()
        const pointer = canvas.getPointer(e.e)
        const deltaX = pointer.x - zoomPan.lastPanPointRef.current.x
        const deltaY = pointer.y - zoomPan.lastPanPointRef.current.y
        const vpt = canvas.viewportTransform
        if (vpt) {
          vpt[4] += deltaX
          vpt[5] += deltaY
          canvas.setViewportTransform(vpt)
          canvas.renderAll()
        }
        zoomPan.lastPanPointRef.current = pointer
        return
      }
      if (zoomPan.isPanningRef.current && !zoomPan.lastPanPointRef.current) {
        const pointer = canvas.getPointer(e.e)
        zoomPan.lastPanPointRef.current = pointer
        return
      }

      // Drawing mouse move
      drawing.handleDrawingMouseMove(e)
    })

    // mouse:up
    canvas.on('mouse:up', (e?: fabric.IEvent<MouseEvent>) => {
      // End panning
      if (zoomPan.isPanningRef.current) {
        if (e && e.e.button === 2) {
          e.e.preventDefault()
          e.e.stopPropagation()
        }
        zoomPan.isPanningRef.current = false
        zoomPan.lastPanPointRef.current = null
        canvas.defaultCursor = 'default'
        canvas.hoverCursor = 'move'
        canvas.selection = true
        return
      }

      // Drawing mouse up
      drawing.handleDrawingMouseUp(e)
    })

    // mouse:out
    canvas.on('mouse:out', () => {
      if (zoomPan.isPanningRef.current) {
        zoomPan.isPanningRef.current = false
        zoomPan.lastPanPointRef.current = null
        canvas.defaultCursor = 'default'
        canvas.hoverCursor = 'move'
        canvas.selection = true
      }
      drawing.hideCrosshair()
    })

    // mouse:dblclick
    canvas.on('mouse:dblclick', () => {
      drawing.handleDblClick()
    })

    // mouse:down
    const bindMouseDownHandler = () => {
      canvas.off('mouse:down')
      canvas.on('mouse:down', (e: fabric.IEvent<MouseEvent>) => {
        const activeObjectAtStart = canvas.getActiveObject()
        const hadActiveAnnotation = (activeObjectAtStart && (activeObjectAtStart.type === 'rect' || activeObjectAtStart.type === 'polygon')) || selection.hasActiveAnnotationRef.current

        if (zoomPan.isPanningRef.current) return
        if (e.e.button === 2) return

        // Polygon hit test (when polygon is selected)
        if (activeObjectAtStart?.type === 'polygon') {
          const polygon = activeObjectAtStart as fabric.Polygon
          const pointer = canvas.getPointer(e.e)
          const handled = selection.handlePolygonHitTest(canvas, polygon, pointer)
          if (handled) return
        }

        // Drawing mouse down
        drawing.handleDrawingMouseDown(e, !!hadActiveAnnotation)
      })
    }
    bindMouseDownHandler()

    // --- Native DOM event handlers for right-click panning ---

    const isImageFullyVisible = (): boolean => {
      const bgImage = canvas.backgroundImage as fabric.Image
      if (!bgImage || !bgImage.width || !bgImage.height) return true
      const zoom = canvas.getZoom()
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0]
      const imgW = bgImage.width * (bgImage.scaleX || 1) * zoom
      const imgH = bgImage.height * (bgImage.scaleY || 1) * zoom
      const imgLeft = (bgImage.left || 0) + vpt[4]
      const imgTop = (bgImage.top || 0) + vpt[5]
      const canvasW = canvas.getWidth()
      const canvasH = canvas.getHeight()
      return imgLeft >= 0 && imgTop >= 0 && imgLeft + imgW <= canvasW && imgTop + imgH <= canvasH
    }

    const preventContextMenu = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      return false
    }

    const cycleToNextCategory = () => {
      const cats = categoriesRef.current || []
      if (cats.length === 0) return
      const currentId = selectedCategoryRef.current
      const idx = cats.findIndex(c => c.id === currentId)
      const nextIdx = idx < 0 ? 0 : (idx + 1) % cats.length
      setSelectedCategory(cats[nextIdx].id)
    }

    const handleNativeMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        const pointer = canvas.getPointer(e)

        // Polygon drawing: record right-click for undo-last-point detection
        if (drawing.isDrawingPolygonRef.current && drawing.polygonPointsRef.current.length > 0) {
          rightMouseDownPointRef.current = { x: pointer.x, y: pointer.y, time: Date.now() }
          e.preventDefault()
          e.stopPropagation()
          return
        }

        // Record right-click for category cycling detection
        if (!drawing.isDrawingRef.current) {
          rightMouseDownPointRef.current = { x: pointer.x, y: pointer.y, time: Date.now() }
        }

        const fullyVisible = isImageFullyVisible()
        if (fullyVisible) {
          e.preventDefault()
          e.stopPropagation()
          return
        }

        zoomPan.isPanningRef.current = true
        zoomPan.lastPanPointRef.current = pointer
        canvas.defaultCursor = 'grabbing'
        canvas.hoverCursor = 'grabbing'
        canvas.selection = false
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const handleNativeMouseMove = (e: MouseEvent) => {
      // Track right-button drag to distinguish click from drag
      if (e.buttons === 2 && rightMouseDownPointRef.current) {
        const pointer = canvas.getPointer(e)
        const dx = pointer.x - rightMouseDownPointRef.current.x
        const dy = pointer.y - rightMouseDownPointRef.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance > RIGHT_CLICK_THRESHOLD) {
          rightMouseDownPointRef.current = null
        }
      }

      // Panning
      if (zoomPan.isPanningRef.current && e.buttons === 2 && zoomPan.lastPanPointRef.current) {
        e.preventDefault()
        e.stopPropagation()
        const pointer = canvas.getPointer(e)
        const deltaX = pointer.x - zoomPan.lastPanPointRef.current.x
        const deltaY = pointer.y - zoomPan.lastPanPointRef.current.y
        const vpt = canvas.viewportTransform
        if (vpt) {
          vpt[4] += deltaX
          vpt[5] += deltaY
          zoomPan.constrainImagePosition(canvas)
          canvas.setViewportTransform(vpt)
          canvas.renderAll()
        }
        zoomPan.lastPanPointRef.current = pointer
      }

      // Crosshair update
      if (drawing.updateCrosshairNativeRef.current) {
        drawing.updateCrosshairNativeRef.current(e)
      }
    }

    const handleNativeMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        // Polygon drawing: right-click to delete last point
        if (drawing.isDrawingPolygonRef.current && rightMouseDownPointRef.current) {
          const pointer = canvas.getPointer(e)
          const dx = pointer.x - rightMouseDownPointRef.current.x
          const dy = pointer.y - rightMouseDownPointRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const timeElapsed = Date.now() - rightMouseDownPointRef.current.time
          if (distance <= RIGHT_CLICK_THRESHOLD && timeElapsed <= RIGHT_CLICK_TIME_THRESHOLD) {
            drawing.removeLastPolygonPoint()
            e.preventDefault()
            e.stopPropagation()
            rightMouseDownPointRef.current = null
            return
          }
          rightMouseDownPointRef.current = null
        }

        // Category cycling on right-click (not drawing)
        if (!drawing.isDrawingPolygonRef.current && !drawing.isDrawingRef.current && rightMouseDownPointRef.current) {
          const pointer = canvas.getPointer(e)
          const dx = pointer.x - rightMouseDownPointRef.current.x
          const dy = pointer.y - rightMouseDownPointRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const timeElapsed = Date.now() - rightMouseDownPointRef.current.time
          if (distance <= RIGHT_CLICK_THRESHOLD && timeElapsed <= RIGHT_CLICK_TIME_THRESHOLD) {
            cycleToNextCategory()
            if (zoomPan.isPanningRef.current) {
              zoomPan.isPanningRef.current = false
              zoomPan.lastPanPointRef.current = null
              canvas.defaultCursor = 'default'
              canvas.hoverCursor = 'move'
              canvas.selection = true
            }
            e.preventDefault()
            e.stopPropagation()
            rightMouseDownPointRef.current = null
            return
          }
          rightMouseDownPointRef.current = null
        }

        // End panning
        if (zoomPan.isPanningRef.current) {
          zoomPan.isPanningRef.current = false
          zoomPan.lastPanPointRef.current = null
          canvas.defaultCursor = 'default'
          canvas.hoverCursor = 'move'
          canvas.selection = true
          e.preventDefault()
          e.stopPropagation()
        }
      }
    }

    // Get canvas container and element for native event binding
    const canvasContainer = canvasElRef.current?.parentElement
    const canvasElement = canvasElRef.current

    if (canvasElement) {
      canvasElement.addEventListener('contextmenu', preventContextMenu, true)
      canvasElement.addEventListener('mousedown', handleNativeMouseDown, true)
      canvasElement.addEventListener('mousemove', handleNativeMouseMove, true)
      canvasElement.addEventListener('mouseup', handleNativeMouseUp, true)
    }
    if (canvasContainer) {
      canvasContainer.addEventListener('contextmenu', preventContextMenu, true)
      canvasContainer.addEventListener('mousedown', handleNativeMouseDown, true)
      canvasContainer.addEventListener('mousemove', handleNativeMouseMove, true)
      canvasContainer.addEventListener('mouseup', handleNativeMouseUp, true)
    }

    // --- Load and display image ---
    const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()
    const pathParts = image.filepath.split('/').filter((part: string) => part)
    const encodedParts = pathParts.map((part: string) => encodeURIComponent(part))
    const imgUrl = `${apiBaseUrl}/uploads/${encodedParts.join('/')}`

    message.loading({ content: '正在加载图片...', key: 'loading-image' })
    const loadTimeout = setTimeout(() => {
      message.destroy('loading-image')
      message.error(`图片加载超时: ${image.filename}`, 5)
    }, 30000)

    fabric.Image.fromURL(imgUrl, (img: fabric.Image) => {
      clearTimeout(loadTimeout)
      message.destroy('loading-image')

      if (!fabricCanvasRef.current || (fabricCanvasRef.current as any)._currentImageId !== targetImageId) return

      if (!img || !img.width || !img.height) {
        message.error(`图片加载失败: ${image.filename}`, 10)
        return
      }

      // 计算可用空间：减去 header(64) + footer(104) + padding(48) + sider 留白
      const headerHeight = 64
      const footerHeight = 104
      const verticalPadding = 48  // annotation-content padding * 2
      const availableHeight = window.innerHeight - headerHeight - footerHeight - verticalPadding
      const siderWidth = 200
      const horizontalPadding = 48
      const availableWidth = window.innerWidth - siderWidth - horizontalPadding

      const maxWidth = Math.max(availableWidth, 400)
      const maxHeight = Math.max(availableHeight, 300)
      // 不限制 scale <= 1，让小图片也能填满画布
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height)

      const marginX = Math.max(30, img.width * scale * 0.03)
      const marginY = Math.max(30, img.height * scale * 0.03)
      const canvasWidth = img.width * scale + 2 * marginX
      const canvasHeight = img.height * scale + 2 * marginY

      canvas.setDimensions({ width: canvasWidth, height: canvasHeight })

      // Set DPR backstore
      const currentDpr = window.devicePixelRatio || 1
      canvas.setDimensions(
        { width: canvasWidth * currentDpr, height: canvasHeight * currentDpr },
        { backstoreOnly: true }
      )

      canvas.getObjects().forEach((obj: fabric.Object) => canvas.remove(obj))

      canvas.setBackgroundImage(img, () => {
        canvas.renderAll()
        // 设置 imageBounds 供 useAnnotations 使用
        const bgImage = canvas.backgroundImage as fabric.Image
        if (bgImage) {
          imageLoader.imageBoundsRef.current = {
            left: bgImage.left || 0,
            top: bgImage.top || 0,
            scaleX: bgImage.scaleX || 1,
            scaleY: bgImage.scaleY || 1,
            originalWidth: bgImage.width || 0,
            originalHeight: bgImage.height || 0,
          }
        }
      }, {
        left: marginX,
        top: marginY,
        scaleX: scale,
        scaleY: scale,
        crossOrigin: 'anonymous',
      } as any)
    }, { crossOrigin: 'anonymous' })

    // --- Preload adjacent images ---
    if (allImages.length > 0) {
      const currentIndex = allImages.findIndex(img => img.id === targetImageId)
      if (currentIndex >= 0) {
        imageLoader.preloadAdjacentImages(currentIndex, allImages)
      }
    }

    // Cleanup
    return () => {
      if (canvasElement) {
        canvasElement.removeEventListener('contextmenu', preventContextMenu, true)
        canvasElement.removeEventListener('mousedown', handleNativeMouseDown, true)
        canvasElement.removeEventListener('mousemove', handleNativeMouseMove, true)
        canvasElement.removeEventListener('mouseup', handleNativeMouseUp, true)
      }
      if (canvasContainer) {
        canvasContainer.removeEventListener('contextmenu', preventContextMenu, true)
        canvasContainer.removeEventListener('mousedown', handleNativeMouseDown, true)
        canvasContainer.removeEventListener('mousemove', handleNativeMouseMove, true)
        canvasContainer.removeEventListener('mouseup', handleNativeMouseUp, true)
      }

      try {
        canvas.dispose()
      } catch (error) {
        console.error('清理canvas时出错:', error)
      }
      if (fabricCanvasRef.current === canvas) {
        fabricCanvasRef.current = null
      }
    }
  }, [image]) // Only recreate canvas when image changes

  // ============================================================
  // useEffect: Redraw annotations on data change
  // ============================================================

  useEffect(() => {
    if (!fabricCanvasRef.current || !image) return

    const currentImageId = imageIdRef.current
    if (image.id !== Number(currentImageId)) return

    const canvasImageId = (fabricCanvasRef.current as any)._currentImageId
    if (canvasImageId !== image.id) return

    const annotationType = project?.annotation_type || 'detection'

    if (annotations.length === 0) {
      const canvas = fabricCanvasRef.current
      const annotationTypes = annotationType === 'segmentation' ? ['polygon'] : ['rect']
      const savedObjects = canvas.getObjects().filter((obj: fabric.Object) => {
        return annotationTypes.includes(obj.type!) && (obj as any).annotationId != null
      })
      savedObjects.forEach((obj: fabric.Object) => canvas.remove(obj))
      canvas.renderAll()
      setTimeout(() => { updateCategoryCountsRef.current?.() }, 100)
      return
    }

    if (categories.length === 0) return

    const canvas = fabricCanvasRef.current
    const bgImage = canvas.backgroundImage as fabric.Image
    if (!bgImage || !bgImage.width || !bgImage.height || !canvas.width || !canvas.height) return

    const originalImgWidth = image.width || bgImage.width
    const originalImgHeight = image.height || bgImage.height
    const scaleForDraw = bgImage.scaleX || 1

    annotationsMgr.drawExistingAnnotations(
      canvas, annotations, categories,
      originalImgWidth, originalImgHeight, scaleForDraw, annotationType
    )

    setTimeout(() => { updateCategoryCountsRef.current?.() }, 50)
  }, [annotations, categories, image, annotationsMgr.drawExistingAnnotations, project])

  // ============================================================
  // useEffect: Canvas object change tracking for category counts
  // ============================================================

  useEffect(() => {
    if (!fabricCanvasRef.current || !imageId) return

    const canvas = fabricCanvasRef.current

    const handleCanvasUpdate = () => {
      setTimeout(() => { updateCategoryCounts() }, 0)
    }

    canvas.on('object:added', handleCanvasUpdate)
    canvas.on('object:removed', handleCanvasUpdate)
    canvas.on('object:modified', handleCanvasUpdate)
    canvas.on('path:created', handleCanvasUpdate)

    updateCategoryCounts()

    return () => {
      canvas.off('object:added', handleCanvasUpdate)
      canvas.off('object:removed', handleCanvasUpdate)
      canvas.off('object:modified', handleCanvasUpdate)
      canvas.off('path:created', handleCanvasUpdate)
    }
  }, [imageId, updateCategoryCounts])

  // ============================================================
  // Keyboard shortcuts (inline, more comprehensive than useKeyboard hook)
  // ============================================================

  useEffect(() => {
    let lastKeyTime = 0
    const DEBOUNCE_TIME = 300

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (navigatingRef.current) return

      const now = Date.now()
      if (now - lastKeyTime < DEBOUNCE_TIME) return
      lastKeyTime = now

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        if (drawing.isDrawingPolygonRef.current) {
          message.warning('请先完成或取消当前多边形绘制（Enter/双击完成，Esc取消）')
          return
        }
        navigateToImage('prev')
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        if (drawing.isDrawingPolygonRef.current) {
          message.warning('请先完成或取消当前多边形绘制（Enter/双击完成，Esc取消）')
          return
        }
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
            const idx = selection.selectedVertexIndexRef.current

            if (idx !== null && idx >= 0 && idx < points.length && points.length > 3) {
              // Delete vertex
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
              const newPoints = points.filter((_: any, i: number) => i !== idx)
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
                  top: (polygon.top || 0) + deltaY,
                })
              }
              polygon.setCoords()
              selection.selectedVertexIndexRef.current = null

              const delCategoryColor = (polygon as any).categoryId
                ? categoriesRef.current.find(c => c.id === (polygon as any).categoryId)?.color || '#FF0000'
                : '#FF0000'
              const delIsSeg = (projectRef.current || project)?.annotation_type === 'segmentation'
              const delBaseOpts = {
                canvas: fabricCanvasRef.current!,
                categoryColor: delCategoryColor,
                isSegmentation: delIsSeg,
                enableEdgeControls: true,
                selectedVertexIndexRef: selection.selectedVertexIndexRef,
                onModified: () => saveCurrentAnnotationsRef.current?.().catch(() => {}),
              }
              selection.createPolygonControls(polygon, {
                ...delBaseOpts,
                onRebuildControls: (poly: fabric.Polygon) => selection.createPolygonControls(poly, delBaseOpts),
              })
              fabricCanvasRef.current.renderAll()
              saveCurrentAnnotationsRef.current?.().catch(() => {})
            } else {
              // Delete entire polygon
              fabricCanvasRef.current.remove(activeObject)
              fabricCanvasRef.current.discardActiveObject()
              fabricCanvasRef.current.renderAll()
              selection.selectedVertexIndexRef.current = null
              saveCurrentAnnotationsRef.current?.().catch(() => {})
            }
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (drawing.isDrawingRef.current && fabricCanvasRef.current) {
          if (drawing.rectRef.current) {
            fabricCanvasRef.current.remove(drawing.rectRef.current)
            drawing.rectRef.current = null
          }
          drawing.isDrawingRef.current = false
          drawing.startPointRef.current = null
          fabricCanvasRef.current.selection = true
          fabricCanvasRef.current.renderAll()
        } else if (drawing.isDrawingPolygonRef.current) {
          if (drawing.polygonPointsRef.current.length >= 3) {
            drawing.finishPolygonDrawing()
          } else {
            drawing.cancelPolygonDrawing()
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (fabricCanvasRef.current && drawing.isDrawingPolygonRef.current && drawing.polygonPointsRef.current.length >= 3) {
          drawing.finishPolygonDrawing()
        } else if (drawing.isDrawingPolygonRef.current) {
          drawing.cancelPolygonDrawing()
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [allImages, imageId, projectId, navigateToImage, annotationsMgr.saveCurrentAnnotations, selection.createPolygonControls, project, drawing, selection])

  // ============================================================
  // JSX
  // ============================================================

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
            try {
              await annotationsMgr.saveCurrentAnnotations()
              message.success('标注已保存')
            } catch (error) {
              console.error('保存标注失败:', error)
            }
            // 不手动 dispose canvas —— 组件卸载时 useEffect cleanup 会处理
            if (user?.role === 'annotator') {
              navigate('/tasks')
            } else {
              navigate(`/projects/${projectId}`)
            }
          }}>
            返回
          </Button>
          <span>标注工具</span>
          <span style={{ marginLeft: 16, color: '#fff', fontSize: '14px' }}>
            {progressInfo.isTaskProgress && currentTask ? (
              <>工作包进度 ({currentTask.name}): 已标注 {progressInfo.annotated} 张 / 共 {progressInfo.total} 张 ({progressInfo.percentage}%)</>
            ) : (
              <>进度: 已标注 {progressInfo.annotated} 张 / 共 {progressInfo.total} 张 ({progressInfo.percentage}%)</>
            )}
            {currentPosition > 0 && totalImages > 0 && (
              <>  ·  当前第 {currentPosition} 张 / 共 {totalImages} 张</>
            )}
          </span>
          <span style={{ marginLeft: 8, color: '#999', fontSize: '12px' }}>
            A键上一张 | D键下一张 | 自动保存 | 滚轮缩放 | 右键拖动平移 | 右键单击循环切换类别
            {project?.annotation_type === 'detection' && ' | 单击开始画框 | 再次单击完成 | Esc取消'}
            {project?.annotation_type === 'segmentation' && ' | 点击绘制多边形 | 双击/Enter完成 | Esc完成(≥3点)或取消 | 画多边形时右键删除最后一点'}
          </span>
        </Space>
      </Header>
      <Layout style={{ flex: 1 }}>
        <Content className="annotation-content">
          <div className="canvas-container">
            <canvas ref={canvasElRef} />
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
            const apiBaseUrl = import.meta.env.DEV ? '' : getApiBaseUrl()
            const pathParts = img.filepath.split('/').filter((part: string) => part)
            const encodedPathParts = pathParts.map((part: string) => encodeURIComponent(part))
            const encodedFilepath = encodedPathParts.join('/')
            const imgUrl = `${apiBaseUrl}/uploads/${encodedFilepath}`
            return (
              <div
                key={img.id}
                className={`preview-image-item ${isCurrent ? 'current' : ''}`}
                onClick={async () => {
                  if (!isCurrent) {
                    if (navigatingRef.current) return
                    if (drawing.isDrawingPolygonRef.current) {
                      message.warning('请先完成或取消当前多边形绘制（Enter/双击完成，Esc取消）')
                      return
                    }
                    navigatingRef.current = true
                    try {
                      try {
                        await annotationsMgr.saveCurrentAnnotations()
                      } catch (error) {
                        console.error('保存标注失败:', error)
                      }
                      navigate(`/projects/${projectId}/annotate/${img.id}`)
                    } finally {
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
