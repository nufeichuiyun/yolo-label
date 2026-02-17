import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout, Card, Button, Table, Upload, message, Space, Statistic, Row, Col, Input, Modal, Popconfirm, Tag, ColorPicker, Checkbox, Progress, List, Spin, Select, Slider, Tooltip } from 'antd'
import { UploadOutlined, ArrowLeftOutlined, DownloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined, RobotOutlined, CloseOutlined, HistoryOutlined, CheckOutlined, ThunderboltOutlined, StopOutlined, DownOutlined } from '@ant-design/icons'
import { projectsApi, Project } from '../api/projects'
import { imagesApi, Image } from '../api/images'
import { statsApi, ProjectStats } from '../api/stats'
import { exportApi } from '../api/export'
import { categoriesApi, Category } from '../api/categories'
import { modelsApi, Model } from '../api/models'
import { preannotationApi, PreAnnotationTask } from '../api/preannotation'
import { trainingApi, TrainingTask } from '../api/training'
import { tasksApi, Task } from '../api/tasks'
import { usersApi, UserListResponse } from '../api/users'
import { useAuth } from '../contexts/AuthContext'
import './ProjectDetail.css'

const { Header, Content } = Layout

// 将十六进制颜色转换为RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [images, setImages] = useState<Image[]>([])
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false) // 上传状态标记
  const uploadedFilesRef = useRef<Set<string>>(new Set()) // 跟踪已上传的文件
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryModalVisible, setCategoryModalVisible] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState<string>('#FF0000')
  
  // AI预标注相关状态
  const [preannotationModalVisible, setPreannotationModalVisible] = useState(false)
  const [modelsModalVisible, setModelsModalVisible] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [modelClasses, setModelClasses] = useState<string[]>([])
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [loadingClasses, setLoadingClasses] = useState(false)
  const [currentTask, setCurrentTask] = useState<PreAnnotationTask | null>(null)
  const [taskPollingInterval, setTaskPollingInterval] = useState<NodeJS.Timeout | null>(null)
  const [taskHistory, setTaskHistory] = useState<PreAnnotationTask[]>([])
  const [taskHistoryVisible, setTaskHistoryVisible] = useState(false)
  
  // 模型管理相关状态
  const [uploadingModel, setUploadingModel] = useState(false)
  const [modelName, setModelName] = useState('')
  const [modelDescription, setModelDescription] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  
  // 任务包管理相关状态
  const [tasks, setTasks] = useState<Task[]>([])
  const [annotators, setAnnotators] = useState<any[]>([])
  const [assignModalVisible, setAssignModalVisible] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedAnnotatorId, setSelectedAnnotatorId] = useState<number | null>(null)
  const [reassignModalVisible, setReassignModalVisible] = useState(false)
  const [reassignImagesPerTask, setReassignImagesPerTask] = useState<number>(0)
  
  // 训练相关状态
  const [trainingModalVisible, setTrainingModalVisible] = useState(false)
  const [trainingHistoryVisible, setTrainingHistoryVisible] = useState(false)
  const [trainingHistory, setTrainingHistory] = useState<TrainingTask[]>([])
  const [currentTrainingTask, setCurrentTrainingTask] = useState<TrainingTask | null>(null)
  const [trainingFloatVisible, setTrainingFloatVisible] = useState(true)  // 训练进度浮层是否展开（关闭仅最小化，训练继续）
  const [trainingPollingInterval, setTrainingPollingInterval] = useState<NodeJS.Timeout | null>(null)
  const [baseModels, setBaseModels] = useState<{ value: string; label: string }[]>([])
  const [defaultBaseModel, setDefaultBaseModel] = useState<string>('')
  const [trainingConfig, setTrainingConfig] = useState({ base_model: '', epochs: 100, imgsz: 640, batch: 16, train_split: 0.8 })
  const [startingTraining, setStartingTraining] = useState(false)
  
  const { user } = useAuth()

  // 定义所有加载函数
  const loadProject = async () => {
    try {
      const data = await projectsApi.get(Number(projectId))
      setProject(data)
    } catch (error) {
      message.error('加载项目失败')
    }
  }

  const loadImages = async () => {
    setLoading(true)
    try {
      const data = await imagesApi.list(Number(projectId), 0, 1000)
      setImages(data.items)
      console.log('加载图片列表:', data.items.length, '张图片')
    } catch (error) {
      console.error('加载图片列表失败:', error)
      message.error('加载图片列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const data = await statsApi.getProjectStats(Number(projectId))
      setStats(data)
    } catch (error) {
      // 忽略统计错误
    }
  }

  const loadCategories = async () => {
    try {
      const data = await categoriesApi.list(Number(projectId))
      setCategories(data)
    } catch (error) {
      message.error('加载类别列表失败')
    }
  }

  const loadTasks = async () => {
    if (!projectId) return
    try {
      const data = await tasksApi.list(Number(projectId))
      setTasks(data.items)
    } catch (error) {
      message.error('加载任务包列表失败')
    }
  }

  const loadAnnotators = async () => {
    try {
      const data: UserListResponse = await usersApi.list(0, 1000)
      // 只显示标注者
      const annotatorList = data.items.filter(u => u.role === 'annotator')
      setAnnotators(annotatorList)
    } catch (error) {
      message.error('加载标注者列表失败')
    }
  }

  const loadModels = async () => {
    if (!projectId) return
    try {
      const data = await modelsApi.list(Number(projectId))
      setModels(data.items)
      // 如果有默认模型，自动选择
      const defaultModel = data.items.find(m => m.is_default)
      if (defaultModel) {
        setSelectedModelId(defaultModel.id)
        loadModelClasses(defaultModel.id)
      }
    } catch (error) {
      console.error('加载模型列表失败:', error)
    }
  }
  
  const loadModelClasses = async (modelId: number) => {
    setLoadingClasses(true)
    try {
      const data = await modelsApi.getClasses(modelId)
      const classes = data.classes || []
      setModelClasses(classes)
      // 默认全选
      setSelectedClasses(classes)
    } catch (error) {
      message.error('加载模型类别失败')
      console.error('加载模型类别失败:', error)
    } finally {
      setLoadingClasses(false)
    }
  }
  
  const pollTaskStatus = useCallback(async (taskId: string) => {
    try {
      const task = await preannotationApi.getTask(taskId)
      setCurrentTask(task)
      
      if (task.status === 'completed') {
        // 任务完成，停止轮询
        setTaskPollingInterval(prev => {
          if (prev) {
            clearInterval(prev)
          }
          return null
        })
        message.success('预标注任务已完成')
        setCurrentTask(null)
        // 刷新数据（使用setTimeout避免在回调中直接调用）
        setTimeout(() => {
          if (projectId) {
            loadImages()
            loadStats()
            loadCategories()
            // 刷新任务历史
            preannotationApi.listProjectTasks(Number(projectId))
              .then(tasks => setTaskHistory(tasks))
              .catch(err => console.error('刷新任务历史失败:', err))
          }
        }, 100)
      } else if (task.status === 'failed') {
        // 任务失败，停止轮询
        setTaskPollingInterval(prev => {
          if (prev) {
            clearInterval(prev)
          }
          return null
        })
        message.error(`预标注任务失败: ${task.error_message || '未知错误'}`)
        setCurrentTask(null)
      }
    } catch (error) {
      console.error('查询任务状态失败:', error)
    }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  
  const startTaskPolling = useCallback((taskId: string) => {
    // 清除旧的轮询
    setTaskPollingInterval(prev => {
      if (prev) {
        clearInterval(prev)
      }
      return null
    })
    
    // 立即查询一次
    pollTaskStatus(taskId)
    
    // 每2秒轮询一次
    const interval = setInterval(() => {
      pollTaskStatus(taskId)
    }, 2000)
    
    setTaskPollingInterval(interval)
  }, [pollTaskStatus])
  
  const loadBaseModels = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await trainingApi.getBaseModels(Number(projectId))
      setBaseModels(data.models)
      setDefaultBaseModel(data.default)
      setTrainingConfig(prev => ({ ...prev, base_model: data.default }))
    } catch (error) {
      console.error('加载基础模型失败:', error)
    }
  }, [projectId])

  const loadTrainingHistory = useCallback(async () => {
    if (!projectId) return
    try {
      const tasks = await trainingApi.listProjectTasks(Number(projectId))
      setTrainingHistory(tasks)
      const runningTask = tasks.find(t => t.status === 'running')
      if (runningTask) {
        setCurrentTrainingTask(prev => (!prev || prev.id !== runningTask.id ? runningTask : prev))
      }
    } catch (error) {
      console.error('加载训练历史失败:', error)
    }
  }, [projectId])

  const pollTrainingStatus = useCallback(async (taskId: string) => {
    try {
      const task = await trainingApi.getTask(taskId)
      setCurrentTrainingTask(task)
      if (task.status === 'completed') {
        setTrainingPollingInterval(prev => { if (prev) clearInterval(prev); return null })
        message.success('模型训练已完成')
        setCurrentTrainingTask(null)
        setTimeout(() => {
          if (projectId) {
            loadTrainingHistory()
            loadModels()
          }
        }, 100)
      } else if (task.status === 'failed') {
        setTrainingPollingInterval(prev => { if (prev) clearInterval(prev); return null })
        message.error(`训练失败: ${task.error_message || '未知错误'}`)
        setCurrentTrainingTask(null)
      }
    } catch (error) {
      console.error('查询训练状态失败:', error)
    }
  }, [projectId])

  const startTrainingPolling = useCallback((taskId: string) => {
    setTrainingPollingInterval(prev => { if (prev) clearInterval(prev); return null })
    pollTrainingStatus(taskId)
    const interval = setInterval(() => pollTrainingStatus(taskId), 3000)
    setTrainingPollingInterval(interval)
  }, [pollTrainingStatus])

  const handleStartTraining = async () => {
    if (!trainingConfig.base_model) {
      message.warning('请选择基础模型')
      return
    }
    setStartingTraining(true)
    try {
      const task = await trainingApi.create({
        project_id: Number(projectId),
        base_model: trainingConfig.base_model,
        epochs: trainingConfig.epochs,
        imgsz: trainingConfig.imgsz,
        batch: trainingConfig.batch,
        train_split: trainingConfig.train_split,
      })
      message.success('训练任务已启动，将在后台执行')
      setTrainingModalVisible(false)
      setCurrentTrainingTask(task)
      setTrainingFloatVisible(true)
      startTrainingPolling(task.task_id)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '启动训练失败')
    } finally {
      setStartingTraining(false)
    }
  }

  const handleOpenTrainingModal = () => {
    setTrainingModalVisible(true)
    loadBaseModels()
  }

  const handleRevokeTraining = async () => {
    if (!currentTrainingTask) return
    try {
      await trainingApi.revokeTask(currentTrainingTask.task_id)
      message.success('已发送停止信号，任务将尽快终止')
      setCurrentTrainingTask(null)
      if (trainingPollingInterval) {
        clearInterval(trainingPollingInterval)
        setTrainingPollingInterval(null)
      }
      loadTrainingHistory()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '停止失败')
    }
  }

  const handleDownloadTrainedModel = async (task: TrainingTask) => {
    if (!task.output_model_path) return
    try {
      await trainingApi.downloadModel(task.task_id, task.output_model_path)
      message.success('模型下载成功')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '下载失败')
    }
  }

  const handleDownloadArchive = async (task: TrainingTask) => {
    if (!task.output_archive_path) return
    try {
      await trainingApi.downloadArchive(task.task_id, task.output_archive_path.split('/').pop() || `training_${task.task_id}.zip`)
      message.success('完整包下载成功')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '下载失败')
    }
  }

  const loadTaskHistory = useCallback(async () => {
    if (!projectId) return
    try {
      const tasks = await preannotationApi.listProjectTasks(Number(projectId))
      setTaskHistory(tasks)
      // 如果有运行中的任务，设置为当前任务（不在这里启动轮询，由useEffect处理）
      const runningTask = tasks.find(t => t.status === 'running')
      if (runningTask) {
        setCurrentTask(prevTask => {
          if (!prevTask || prevTask.id !== runningTask.id) {
            return runningTask
          }
          return prevTask
        })
      }
    } catch (error) {
      console.error('加载任务历史失败:', error)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) {
      loadProject()
      loadImages()
      loadStats()
      loadCategories()
      loadModels()
      loadTaskHistory()
      loadTrainingHistory()
      loadTasks()
      // 只有项目管理员和超级管理员需要加载标注者列表
      if (user?.role === 'super_admin' || user?.role === 'project_admin') {
        loadAnnotators()
      }
    }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  
  // 当currentTask变为running状态时，确保轮询已启动
  useEffect(() => {
    if (currentTask && currentTask.status === 'running' && !taskPollingInterval) {
      startTaskPolling(currentTask.task_id)
    }
  }, [currentTask?.status, currentTask?.task_id, taskPollingInterval, startTaskPolling])

  // 当currentTrainingTask变为running时，确保轮询已启动
  useEffect(() => {
    if (currentTrainingTask && currentTrainingTask.status === 'running' && !trainingPollingInterval) {
      startTrainingPolling(currentTrainingTask.task_id)
    }
  }, [currentTrainingTask?.status, currentTrainingTask?.task_id, trainingPollingInterval, startTrainingPolling])

  // 定期刷新训练历史（如果有运行中的任务）
  useEffect(() => {
    if (currentTrainingTask && currentTrainingTask.status === 'running') {
      const interval = setInterval(() => loadTrainingHistory(), 5000)
      return () => clearInterval(interval)
    }
  }, [currentTrainingTask?.status, projectId, loadTrainingHistory])

  // 清理训练轮询
  useEffect(() => {
    return () => {
      if (trainingPollingInterval) clearInterval(trainingPollingInterval)
    }
  }, [trainingPollingInterval])
  
  // 定期刷新任务历史（如果有运行中的任务）
  useEffect(() => {
    if (currentTask && currentTask.status === 'running') {
      const interval = setInterval(() => {
        loadTaskHistory()
      }, 5000) // 每5秒刷新一次
      return () => clearInterval(interval)
    }
  }, [currentTask?.status, projectId, loadTaskHistory])
  
  // 清理任务轮询
  useEffect(() => {
    return () => {
      if (taskPollingInterval) {
        clearInterval(taskPollingInterval)
      }
    }
  }, [taskPollingInterval])

  // 监听页面可见性变化，当从标注页面返回时刷新图片列表
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && projectId) {
        // 页面变为可见时，刷新图片列表和统计
        loadImages()
        loadStats()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [projectId])


  const handleCreateCategory = () => {
    setEditingCategory(null)
    setCategoryName('')
    setCategoryColor('#FF0000')
    setCategoryModalVisible(true)
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
    setCategoryName(category.name)
    setCategoryColor(category.color || '#FF0000')
    setCategoryModalVisible(true)
  }

  const handleDeleteCategory = async (categoryId: number) => {
    try {
      await categoriesApi.delete(categoryId)
      message.success('删除成功')
      loadCategories()
      loadStats()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  const handleCategorySubmit = async () => {
    const trimmedName = categoryName.trim()
    if (!trimmedName) {
      message.warning('请输入类别名称')
      return
    }
    try {
      if (editingCategory) {
        // 编辑类别
        await categoriesApi.update(editingCategory.id, { name: trimmedName, color: categoryColor })
        message.success('更新成功')
      } else {
        // 创建类别
        await categoriesApi.create({
          project_id: Number(projectId),
          name: trimmedName,
          color: categoryColor,
        })
        message.success('创建成功')
      }
      setCategoryModalVisible(false)
      setCategoryName('')
      setCategoryColor('#FF0000')
      setEditingCategory(null)
      loadCategories()
      loadStats()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '操作失败')
    }
  }
  
  const handleModelChange = (modelId: number) => {
    setSelectedModelId(modelId)
    setSelectedClasses([])
    loadModelClasses(modelId)
  }
  
  const handleStartPreannotation = async () => {
    if (!selectedModelId) {
      message.warning('请选择模型')
      return
    }
    if (selectedClasses.length === 0) {
      message.warning('请至少选择一个类别')
      return
    }
    
    try {
      const task = await preannotationApi.create({
        project_id: Number(projectId),
        model_id: selectedModelId,
        selected_classes: selectedClasses,
      })
      
      message.success('预标注任务已启动，将在后台执行')
      setPreannotationModalVisible(false)
      setCurrentTask(task)
      
      // 开始轮询任务状态
      startTaskPolling(task.task_id)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '启动预标注任务失败')
    }
  }
  
  const handleOpenPreannotationModal = () => {
    setPreannotationModalVisible(true)
    loadModels()
  }
  
  const handleClosePreannotationModal = () => {
    setPreannotationModalVisible(false)
    setSelectedModelId(null)
    setModelClasses([])
    setSelectedClasses([])
  }
  
  // 模型管理相关函数
  const handleUploadModel = async () => {
    if (!uploadFile) {
      message.warning('请选择模型文件')
      return
    }
    if (!modelName.trim()) {
      message.warning('请输入模型名称')
      return
    }
    if (!projectId) {
      message.error('项目ID不存在')
      return
    }

    setUploadingModel(true)
    try {
      await modelsApi.upload(Number(projectId), uploadFile, modelName.trim(), modelDescription.trim())
      message.success('模型上传成功')
      setModelsModalVisible(false)
      setModelName('')
      setModelDescription('')
      setUploadFile(null)
      loadModels()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上传失败')
    } finally {
      setUploadingModel(false)
    }
  }

  const handleDeleteModel = async (modelId: number) => {
    try {
      await modelsApi.delete(modelId)
      message.success('删除成功')
      loadModels()
      // 如果删除的是当前选中的模型，清空选择
      if (selectedModelId === modelId) {
        setSelectedModelId(null)
        setModelClasses([])
        setSelectedClasses([])
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  // 任务包管理相关函数
  const handleAssignTask = (task: Task) => {
    setSelectedTask(task)
    setSelectedAnnotatorId(task.annotator_id || null)
    setAssignModalVisible(true)
  }

  const handleConfirmAssign = async () => {
    if (!selectedTask || !selectedAnnotatorId) {
      message.warning('请选择标注者')
      return
    }
    try {
      await tasksApi.assign(selectedTask.id, { annotator_id: selectedAnnotatorId })
      message.success('分配成功')
      setAssignModalVisible(false)
      setSelectedTask(null)
      setSelectedAnnotatorId(null)
      loadTasks()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '分配失败')
    }
  }

  const handleUnassignTask = async (taskId: number) => {
    try {
      await tasksApi.unassign(taskId)
      message.success('取消分配成功')
      loadTasks()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '取消分配失败')
    }
  }

  const handleReassignTasks = async (imagesPerTask: number) => {
    if (imagesPerTask <= 0) {
      message.warning('每个任务包的图片张数必须大于0')
      return
    }
    try {
      await tasksApi.reassign(Number(projectId), { images_per_task: imagesPerTask })
      message.success('重新分配成功')
      loadTasks()
      loadImages() // 重新加载图片列表
      setReassignModalVisible(false)
      setReassignImagesPerTask(0)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '重新分配失败')
    }
  }

  const handleSetDefaultModel = async (modelId: number) => {
    try {
      await modelsApi.setDefault(modelId)
      message.success('已设置为默认模型')
      loadModels()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '设置失败')
    }
  }

  const handleUpload = async (files: File[]) => {
    try {
      await imagesApi.upload(Number(projectId), files)
      message.success(`成功上传 ${files.length} 张图片`)
      loadImages()
      loadStats()
      // 如果项目设置了自动创建任务包，上传后需要刷新任务包列表
      if (user?.role === 'super_admin' || user?.role === 'project_admin') {
        loadTasks()
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上传失败')
    }
  }

  const handleExport = async () => {
    try {
      const { blob, filename } = await exportApi.exportYOLO(Number(projectId))
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      message.success('导出成功')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '导出失败')
    }
  }

  const columns = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
    },
    {
      title: '包含的标注目标数量',
      dataIndex: 'annotation_count',
      key: 'annotation_count',
      render: (count: number) => count || 0,
    },
    {
      title: '标注状态',
      dataIndex: 'is_annotated',
      key: 'is_annotated',
      render: (annotated: boolean) => (
        <span style={{ color: annotated ? '#52c41a' : '#ff4d4f', fontWeight: annotated ? 500 : 400 }}>
          {annotated ? '已标注' : '未标注'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Image) => (
        <Button
          type="link"
          onClick={() => navigate(`/projects/${projectId}/annotate/${record.id}`)}
        >
          标注
        </Button>
      ),
    },
  ]

  return (
    <Layout className="project-detail-layout">
      <Header className="project-detail-header">
        <Space>
          <Button type="primary" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
            返回
          </Button>
          <span>{project?.name}</span>
        </Space>
      </Header>
      <Content className="project-detail-content">
        {stats && (
          <Card className="stats-card">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="总图片数" value={stats.total_images} />
              </Col>
              <Col span={6}>
                <Statistic title="已标注" value={stats.annotated_images} />
              </Col>
              <Col span={6}>
                <Statistic title="总标注数" value={stats.total_annotations} />
              </Col>
              <Col span={6}>
                <Statistic title="类别数" value={stats.categories_count} />
              </Col>
            </Row>
          </Card>
        )}

        {/* AI预标注功能区域 */}
        <Card title="AI 预标注" style={{ marginTop: 16 }}>
          <Space wrap>
            <Button 
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => {
                setModelsModalVisible(true)
                loadModels()
              }}
            >
              模型管理
            </Button>
            <Button 
              type="primary" 
              icon={<RobotOutlined />} 
              onClick={handleOpenPreannotationModal}
              disabled={images.length === 0}
            >
              AI预标注
            </Button>
            {taskHistory.length > 0 && (
              <Button 
                type="primary"
                icon={<HistoryOutlined />}
                onClick={() => setTaskHistoryVisible(true)}
              >
                AI 预标注任务历史
                {taskHistory.filter(t => t.status === 'running').length > 0 && (
                  <Tag color="processing" style={{ marginLeft: 4 }}>
                    {taskHistory.filter(t => t.status === 'running').length} 运行中
                  </Tag>
                )}
              </Button>
            )}
          </Space>
        </Card>

        {/* 训练功能区域 */}
        {(user?.role === 'super_admin' || user?.role === 'project_admin') && (
          <Card title="模型训练" style={{ marginTop: 16 }}>
            <Space wrap>
              <Tooltip
                title={
                  trainingHistory.some(t => t.status === 'running') || currentTrainingTask?.status === 'running'
                    ? '请先停止当前训练或等待完成后再开始新训练'
                    : !(stats && stats.annotated_images >= 10 && stats.categories_count >= 1)
                    ? `需至少 10 张已标注图片和 1 个类别（当前：${stats?.annotated_images ?? 0} 张已标注，${stats?.categories_count ?? 0} 个类别）`
                    : null
                }
              >
                <span>
                  <Button 
                    type="primary" 
                    icon={<ThunderboltOutlined />} 
                    onClick={handleOpenTrainingModal}
                    disabled={
                      !(stats && stats.annotated_images >= 10 && stats.categories_count >= 1) ||
                      trainingHistory.some(t => t.status === 'running') ||
                      currentTrainingTask?.status === 'running'
                    }
                  >
                    开始训练
                  </Button>
                </span>
              </Tooltip>
              {(trainingHistory.length > 0 || currentTrainingTask) && (
                <Button 
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={() => setTrainingHistoryVisible(true)}
                >
                  训练历史
                  {trainingHistory.filter(t => t.status === 'running').length > 0 && (
                    <Tag color="processing" style={{ marginLeft: 4 }}>
                      {trainingHistory.filter(t => t.status === 'running').length} 运行中
                    </Tag>
                  )}
                </Button>
              )}
            </Space>
          </Card>
        )}

        <Card
          title={
            <Space>
              <span>类别管理</span>
              {(user?.role === 'super_admin' || user?.role === 'project_admin') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateCategory}>
                  添加类别
                </Button>
              )}
            </Space>
          }
          style={{ marginTop: 24 }}
        >
          {categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
              暂无类别，请先添加类别
            </div>
          ) : (
            <Space wrap>
              {categories.map((cat) => {
                // 根据背景色亮度计算文字颜色
                const hexColor = cat.color || '#FF0000'
                const rgb = hexToRgb(hexColor)
                const brightness = rgb ? (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 : 128
                const textColor = brightness > 128 ? '#333' : '#fff' // 亮色背景用深色文字，暗色背景用白色文字
                
                return (
                  <Tag
                    key={cat.id}
                    style={{
                      backgroundColor: hexColor,
                      borderColor: hexColor,
                      color: textColor,
                      fontSize: '14px',
                      padding: '4px 12px',
                      marginBottom: '8px',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    <span style={{ marginRight: 8 }}>{cat.name}</span>
                    {(user?.role === 'super_admin' || user?.role === 'project_admin') && (
                      <Space size="small" style={{ marginLeft: 4 }}>
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => handleEditCategory(cat)}
                          style={{ color: textColor, padding: '0 4px' }}
                        />
                        <Popconfirm
                          title="确认删除"
                          description={`确定要删除类别"${cat.name}"吗？删除后相关标注也会被删除。`}
                          onConfirm={() => handleDeleteCategory(cat.id)}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Button
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: textColor, padding: '0 4px' }}
                          />
                        </Popconfirm>
                      </Space>
                    )}
                  </Tag>
                )
              })}
            </Space>
          )}
        </Card>

        {/* 任务包管理 - 只有项目管理员和超级管理员可见 */}
        {(user?.role === 'super_admin' || user?.role === 'project_admin') && (
          <Card
            title={
              <Space>
                <span>任务包管理</span>
                <Button
                  type="primary"
                  onClick={() => {
                    const imagesPerTask = tasks.length > 0 ? (project?.images_per_task || 0) : 0
                    setReassignImagesPerTask(imagesPerTask)
                    setReassignModalVisible(true)
                  }}
                >
                  {tasks.length > 0 ? '重新分配任务包' : '分配任务包'}
                </Button>
              </Space>
            }
            style={{ marginTop: 24 }}
          >
            {tasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                暂无任务包。上传图片后，如果项目设置了"每个任务包的图片张数"，系统会自动创建任务包。
              </div>
            ) : (
              <Table
                dataSource={tasks}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                columns={[
                  {
                    title: '任务包名称',
                    dataIndex: 'name',
                    key: 'name',
                  },
                  {
                    title: '图片数量',
                    dataIndex: 'image_count',
                    key: 'image_count',
                    render: (count: number) => `${count} 张`,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    key: 'status',
                    render: (status: string) => {
                      const statusMap: Record<string, { text: string; color: string }> = {
                        pending: { text: '待分配', color: 'orange' },
                        in_progress: { text: '进行中', color: 'blue' },
                        completed: { text: '已完成', color: 'green' },
                      }
                      const info = statusMap[status] || { text: status, color: 'default' }
                      return <Tag color={info.color}>{info.text}</Tag>
                    },
                  },
                  {
                    title: '标注者',
                    dataIndex: 'annotator_id',
                    key: 'annotator_id',
                    render: (annotatorId: number | undefined) => {
                      if (!annotatorId) {
                        return <Tag color="default">未分配</Tag>
                      }
                      const annotator = annotators.find(a => a.id === annotatorId)
                      return annotator ? annotator.username : `ID: ${annotatorId}`
                    },
                  },
                  {
                    title: '操作',
                    key: 'action',
                    render: (_: any, record: Task) => (
                      <Space>
                        {!record.annotator_id && (
                          <Button
                            type="link"
                            onClick={() => handleAssignTask(record)}
                          >
                            分配标注者
                          </Button>
                        )}
                        {record.annotator_id && (
                          <>
                            <Button
                              type="link"
                              onClick={() => handleAssignTask(record)}
                            >
                              重新分配
                            </Button>
                            <Popconfirm
                              title="确认取消分配"
                              description="确定要取消此任务包的分配吗？"
                              onConfirm={() => handleUnassignTask(record.id)}
                              okText="确定"
                              cancelText="取消"
                            >
                              <Button type="link">
                                取消分配
                              </Button>
                            </Popconfirm>
                          </>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        )}

        <Card
          title={
            <Space>
              <span>图片列表</span>
              <Upload
                beforeUpload={() => false} // 阻止自动上传
                onChange={(info) => {
                  // 防止重复上传：如果正在上传，直接返回
                  if (uploading) {
                    return
                  }
                  
                  const { fileList } = info
                  
                  // 过滤出新添加的文件（未处理过的）
                  const newFiles = fileList.filter(f => {
                    const fileObj = f.originFileObj
                    if (!(fileObj instanceof File)) {
                      return false
                    }
                    // 使用文件名+大小作为唯一标识
                    const fileKey = `${fileObj.name}_${fileObj.size}`
                    if (uploadedFilesRef.current.has(fileKey)) {
                      return false // 已处理过
                    }
                    return true
                  })
                  
                  // 当有新文件时，延迟执行确保所有文件都添加完成
                  if (newFiles.length > 0) {
                    setTimeout(() => {
                      // 再次检查上传状态
                      if (uploading) {
                        return
                      }
                      
                      const currentFileList = info.fileList || fileList
                      const filesToUpload = currentFileList
                        .map(f => f.originFileObj)
                        .filter((file): file is File => {
                          if (!(file instanceof File)) {
                            return false
                          }
                          const fileKey = `${file.name}_${file.size}`
                          return !uploadedFilesRef.current.has(fileKey)
                        })
                      
                      if (filesToUpload.length > 0) {
                        // 分批上传：每批300张，避免超时和内存问题
                        const batchSize = 300
                        const batches: File[][] = []
                        for (let i = 0; i < filesToUpload.length; i += batchSize) {
                          batches.push(filesToUpload.slice(i, i + batchSize))
                        }
                        
                        // 设置上传状态
                        setUploading(true)
                        
                        // 分批上传
                        let totalSuccess = 0
                        let totalFail = 0
                        const uploadPromises = batches.map((batch, batchIndex) => {
                          // 标记这批文件为已处理
                          batch.forEach(file => {
                            const fileKey = `${file.name}_${file.size}`
                            uploadedFilesRef.current.add(fileKey)
                          })
                          
                          return imagesApi.upload(Number(projectId), batch)
                            .then((response: any) => {
                              const successCount = response?.success_count || response?.images?.length || batch.length
                              const failCount = response?.failed_count || (batch.length - successCount)
                              totalSuccess += successCount
                              totalFail += failCount
                              
                              // 显示批次进度
                              if (batches.length > 1) {
                                message.info(`批次 ${batchIndex + 1}/${batches.length} 完成: 成功 ${successCount} 张`)
                              }
                              
                              return { successCount, failCount }
                            })
                            .catch((error) => {
                              // 上传失败，移除标记，允许重试
                              batch.forEach(file => {
                                const fileKey = `${file.name}_${file.size}`
                                uploadedFilesRef.current.delete(fileKey)
                              })
                              totalFail += batch.length
                              
                              const errorMsg = error.response?.data?.detail || error.message || '上传失败'
                              message.error(`批次 ${batchIndex + 1}/${batches.length} 失败: ${errorMsg}`)
                              
                              return { successCount: 0, failCount: batch.length }
                            })
                        })
                        
                        // 等待所有批次完成
                        Promise.all(uploadPromises)
                          .then(() => {
                            // 显示最终结果
                            if (totalFail === 0) {
                              message.success(`全部上传完成: 成功 ${totalSuccess} 张图片`)
                            } else {
                              message.warning(`上传完成: 成功 ${totalSuccess} 张，失败 ${totalFail} 张`)
                            }
                            
                            loadImages()
                            loadStats()
                          })
                          .catch((error) => {
                            const errorMsg = error.response?.data?.detail || error.message || '上传失败'
                            message.error(`上传失败: ${errorMsg}`)
                          })
                          .finally(() => {
                            // 重置上传状态
                            setUploading(false)
                          })
                      }
                    }, 200) // 延迟200ms，确保所有文件都添加完成
                  }
                }}
                showUploadList={false} // 不显示上传列表，避免混乱
                accept="image/*"
                multiple
              >
                <Button type="primary" icon={<UploadOutlined />} loading={uploading} disabled={uploading}>
                  {uploading ? '上传中...' : '上传图片'}
                </Button>
              </Upload>
              {images.length > 0 && (
                <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
                  导出yolo格式数据集
                </Button>
              )}
            </Space>
          }
          style={{ marginTop: 24 }}
        >
          <Table
            columns={columns}
            dataSource={images}
            rowKey="id"
            loading={loading}
            pagination={{ 
              pageSize: 20,
              showTotal: (total) => `共 ${total} 张图片`,
              showSizeChanger: true,
              showQuickJumper: true,
            }}
          />
        </Card>

        <Modal
          title={editingCategory ? '编辑类别' : '添加类别'}
          open={categoryModalVisible}
          onOk={handleCategorySubmit}
          onCancel={() => {
            setCategoryModalVisible(false)
            setCategoryName('')
            setCategoryColor('#FF0000')
            setEditingCategory(null)
          }}
          okText="确定"
          cancelText="取消"
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <div style={{ marginBottom: 8 }}>类别名称</div>
              <Input
                placeholder="请输入类别名称"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                onPressEnter={handleCategorySubmit}
                autoFocus
                allowClear
                maxLength={50}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8 }}>类别颜色</div>
              <ColorPicker
                value={categoryColor}
                onChange={(color) => setCategoryColor(color.toHexString())}
                showText
                presets={[
                  {
                    label: '推荐颜色',
                    colors: [
                      '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                      '#FFA500', '#800080', '#FFC0CB', '#A52A2A', '#808080', '#000000'
                    ],
                  },
                ]}
              />
            </div>
          </Space>
        </Modal>

        {/* 训练配置模态框 */}
        <Modal
          title="开始训练"
          open={trainingModalVisible}
          onCancel={() => setTrainingModalVisible(false)}
          footer={null}
          width={600}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>基础模型</div>
              <Select
                style={{ width: '100%' }}
                value={trainingConfig.base_model || defaultBaseModel}
                onChange={(v) => setTrainingConfig(prev => ({ ...prev, base_model: v }))}
                options={baseModels}
                placeholder="选择基础模型"
              />
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>训练轮数 (epochs)</div>
              <Input
                type="number"
                min={1}
                max={1000}
                value={trainingConfig.epochs}
                onChange={(e) => setTrainingConfig(prev => ({ ...prev, epochs: Number(e.target.value) || 100 }))}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>输入尺寸 (imgsz)</div>
              <Input
                type="number"
                min={32}
                max={1280}
                value={trainingConfig.imgsz}
                onChange={(e) => setTrainingConfig(prev => ({ ...prev, imgsz: Number(e.target.value) || 640 }))}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>批次大小 (batch)</div>
              <Input
                type="number"
                min={0}
                max={128}
                value={trainingConfig.batch}
                onChange={(e) => setTrainingConfig(prev => ({ ...prev, batch: Number(e.target.value) }))}
                placeholder="0=自动（根据显存）"
              />
              <div style={{ marginTop: 4, fontSize: '12px', color: '#999' }}>0 表示自动检测（有 GPU 时根据显存选择最优值）</div>
            </div>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>训练集比例 (train_split)</div>
              <Slider
                min={0.5}
                max={0.95}
                step={0.05}
                value={trainingConfig.train_split}
                onChange={(v) => setTrainingConfig(prev => ({ ...prev, train_split: v }))}
                marks={{ 0.5: '50%', 0.7: '70%', 0.8: '80%', 0.9: '90%', 0.95: '95%' }}
              />
              {stats && stats.annotated_images >= 10 && stats.categories_count >= 1 && (
                <div style={{ padding: '8px 0', color: '#666', fontSize: '13px' }}>
                  已标注图片共 <strong>{stats.annotated_images}</strong> 张，
                  按比例划分：训练集 <strong>{Math.floor(stats.annotated_images * trainingConfig.train_split)}</strong> 张，
                  验证集 <strong>{stats.annotated_images - Math.floor(stats.annotated_images * trainingConfig.train_split)}</strong> 张
                </div>
              )}
              {stats && (stats.annotated_images < 10 || stats.categories_count < 1) && (
                <div style={{ padding: '8px 0', color: '#ff4d4f', fontSize: '13px' }}>
                  需至少 10 张已标注图片和 1 个类别（当前：{stats.annotated_images} 张已标注，{stats.categories_count} 个类别）
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setTrainingModalVisible(false)}>取消</Button>
                <Button
                  type="primary"
                  onClick={handleStartTraining}
                  loading={startingTraining}
                  disabled={
                    (!trainingConfig.base_model && !defaultBaseModel) ||
                    !(stats && stats.annotated_images >= 10 && stats.categories_count >= 1)
                  }
                >
                  开始训练
                </Button>
              </Space>
            </div>
          </Space>
        </Modal>

        {/* 训练进度浮层：关闭仅最小化，训练继续在后台进行 */}
        {currentTrainingTask && currentTrainingTask.status === 'running' && (
          <>
            {trainingFloatVisible ? (
              <Card
                style={{
                  position: 'fixed',
                  bottom: 20,
                  right: 20,
                  width: 420,
                  zIndex: 1000,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  borderRadius: 8,
                  border: '1px solid #e8e8e8',
                }}
              >
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ThunderboltOutlined style={{ color: '#1890ff', fontSize: 18 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>模型训练任务</div>
                        <div style={{ fontSize: '12px', color: '#999', marginTop: 2 }}>
                          {new Date(currentTrainingTask.created_at).toLocaleString('zh-CN')}
                        </div>
                      </div>
                    </div>
                    <Space>
                      <Popconfirm
                        title="确认停止"
                        description="确定要停止当前训练任务吗？已训练的进度将丢失。"
                        onConfirm={handleRevokeTraining}
                        okText="停止"
                        okButtonProps={{ danger: true }}
                        cancelText="取消"
                      >
                        <Button type="text" icon={<StopOutlined />} danger>
                          停止训练
                        </Button>
                      </Popconfirm>
                      <Tooltip title="最小化（训练继续在后台进行）">
                        <Button
                          type="text"
                          icon={<DownOutlined />}
                          onClick={() => setTrainingFloatVisible(false)}
                        />
                      </Tooltip>
                    </Space>
                  </div>
              <div>
                <Progress
                  percent={currentTrainingTask.progress}
                  status="active"
                  strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
                  showInfo
                  format={(p) => `${p}%`}
                />
                <div style={{ fontSize: '13px', color: '#666', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Epoch {currentTrainingTask.current_epoch} / {currentTrainingTask.epochs}</span>
                  <Tag color="processing">训练中...</Tag>
                </div>
                {currentTrainingTask.latest_metrics && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px' }}>
                      {currentTrainingTask.latest_metrics.loss != null && (
                        <span><strong>Loss:</strong> {currentTrainingTask.latest_metrics.loss.toFixed(4)}</span>
                      )}
                      {currentTrainingTask.latest_metrics.map50 != null && (
                        <span><strong>mAP50:</strong> {(currentTrainingTask.latest_metrics.map50 * 100).toFixed(2)}%</span>
                      )}
                      {currentTrainingTask.latest_metrics.map50_95 != null && (
                        <span><strong>mAP50-95:</strong> {(currentTrainingTask.latest_metrics.map50_95 * 100).toFixed(2)}%</span>
                      )}
                      {currentTrainingTask.latest_metrics.lr != null && (
                        <span><strong>LR:</strong> {currentTrainingTask.latest_metrics.lr.toExponential(2)}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Space>
          </Card>
            ) : (
              /* 最小化状态：点击可重新展开 */
              <Tooltip title="点击展开训练进度">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setTrainingFloatVisible(true)}
                  onKeyDown={(e) => e.key === 'Enter' && setTrainingFloatVisible(true)}
                  style={{
                    position: 'fixed',
                    bottom: 20,
                    right: 20,
                    zIndex: 1000,
                    padding: '8px 16px',
                    background: '#1890ff',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 2px 8px rgba(24,144,255,0.4)',
                  }}
                >
                  <ThunderboltOutlined />
                  <span>训练进行中 {currentTrainingTask.progress}%</span>
                </div>
              </Tooltip>
            )}
          </>
        )}

        {/* 训练历史模态框 */}
        <Modal
          title={<Space><ThunderboltOutlined /><span>训练历史</span></Space>}
          open={trainingHistoryVisible}
          onCancel={() => setTrainingHistoryVisible(false)}
          footer={null}
          width={800}
        >
          <List
            dataSource={trainingHistory}
            renderItem={(task) => {
              const statusConfig: Record<string, { color: string; text: string }> = {
                pending: { color: 'default', text: '等待中' },
                running: { color: 'processing', text: '运行中' },
                completed: { color: 'success', text: '已完成' },
                failed: { color: 'error', text: '失败' },
              }
              const config = statusConfig[task.status] || statusConfig.pending
              return (
                <List.Item
                  actions={task.status === 'completed' ? [
                    task.output_model_path && (
                      <Button key="download-model" type="link" onClick={() => handleDownloadTrainedModel(task)}>
                        下载模型
                      </Button>
                    ),
                    task.output_archive_path && (
                      <Button key="download-archive" type="link" onClick={() => handleDownloadArchive(task)}>
                        下载完整包
                      </Button>
                    ),
                  ].filter(Boolean) : []}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={config.color}>{config.text}</Tag>
                        <span>任务 #{task.id}</span>
                        <span style={{ fontSize: '12px', color: '#999' }}>{task.base_model}</span>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <div>创建时间: {new Date(task.created_at).toLocaleString('zh-CN')}</div>
                        {(task.status === 'running' || task.status === 'completed') && (
                          <Progress
                            percent={task.progress}
                            status={task.status === 'failed' ? 'exception' : 'success'}
                            size="small"
                            format={() => `Epoch ${task.current_epoch}/${task.epochs}`}
                          />
                        )}
                        {task.status === 'completed' && (
                          <div style={{ color: '#52c41a', fontSize: '12px' }}>
                            训练集 {task.train_images} 张，验证集 {task.val_images} 张
                          </div>
                        )}
                        {task.status === 'failed' && task.error_message && (
                          <div style={{ color: '#ff4d4f', fontSize: '12px' }}>错误: {task.error_message}</div>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )
            }}
            locale={{ emptyText: '暂无训练历史' }}
          />
        </Modal>

        {/* AI预标注模态框 */}
        <Modal
          title="AI预标注"
          open={preannotationModalVisible}
          onCancel={handleClosePreannotationModal}
          footer={null}
          width={800}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>选择模型</div>
              {models.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                  暂无模型，请先上传模型
                </div>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {models.map((model) => (
                    <Card
                      key={model.id}
                      size="small"
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedModelId === model.id ? '#1890ff' : undefined,
                        backgroundColor: selectedModelId === model.id ? '#e6f7ff' : undefined,
                      }}
                      onClick={() => handleModelChange(model.id)}
                    >
                      <Space>
                        <Checkbox checked={selectedModelId === model.id} />
                        <div>
                          <div style={{ fontWeight: 500 }}>{model.name}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>
                            {model.filename} {model.is_default && <Tag color="blue">默认</Tag>}
                          </div>
                        </div>
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </div>

            {selectedModelId && (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>选择类别（支持多选）</div>
                {loadingClasses ? (
                  <Spin />
                ) : modelClasses.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                    该模型没有类别信息
                  </div>
                ) : (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <Checkbox.Group
                      value={selectedClasses}
                      onChange={(values) => setSelectedClasses(values as string[])}
                      style={{ width: '100%' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {modelClasses.map((className, index) => (
                          <Checkbox key={index} value={className}>
                            {className}
                          </Checkbox>
                        ))}
                      </Space>
                    </Checkbox.Group>
                  </div>
                )}
              </div>
            )}

            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={handleClosePreannotationModal}>取消</Button>
                <Button
                  type="primary"
                  onClick={handleStartPreannotation}
                  disabled={!selectedModelId || selectedClasses.length === 0}
                >
                  开始预标注
                </Button>
              </Space>
            </div>
          </Space>
        </Modal>

        {/* 预标注任务进度提示 - 优化样式 */}
        {currentTask && currentTask.status === 'running' && (
          <Card
            style={{
              position: 'fixed',
              bottom: 20,
              right: 20,
              width: 420,
              zIndex: 1000,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              borderRadius: 8,
              border: '1px solid #e8e8e8',
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RobotOutlined style={{ color: '#1890ff', fontSize: 18 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>AI预标注任务</div>
                    <div style={{ fontSize: '12px', color: '#999', marginTop: 2 }}>
                      {new Date(currentTask.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                </div>
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => {
                    setCurrentTask(null)
                    if (taskPollingInterval) {
                      clearInterval(taskPollingInterval)
                      setTaskPollingInterval(null)
                    }
                  }}
                />
              </div>
              <div>
                <Progress
                  percent={currentTask.progress}
                  status="active"
                  strokeColor={{
                    '0%': '#108ee9',
                    '100%': '#87d068',
                  }}
                  showInfo={true}
                  format={(percent) => `${percent}%`}
                />
                <div style={{ 
                  fontSize: '13px', 
                  color: '#666', 
                  marginTop: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>
                    <span style={{ fontWeight: 500 }}>{currentTask.processed_images}</span> / {currentTask.total_images} 张图片
                  </span>
                  <Tag color="processing">处理中...</Tag>
                </div>
              </div>
            </Space>
          </Card>
        )}

        {/* AI 预标注任务历史模态框 */}
        <Modal
          title={
            <Space>
              <RobotOutlined />
              <span>AI 预标注任务历史</span>
            </Space>
          }
          open={taskHistoryVisible}
          onCancel={() => setTaskHistoryVisible(false)}
          footer={null}
          width={800}
        >
          <List
            dataSource={taskHistory}
            renderItem={(task) => {
              const statusConfig = {
                pending: { color: 'default', text: '等待中' },
                running: { color: 'processing', text: '运行中' },
                completed: { color: 'success', text: '已完成' },
                failed: { color: 'error', text: '失败' },
              }
              const config = statusConfig[task.status] || statusConfig.pending
              
              return (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color={config.color}>{config.text}</Tag>
                        <span>任务 #{task.id}</span>
                        {task.status === 'running' && (
                          <Tag color="blue">进行中</Tag>
                        )}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <div>
                          创建时间: {new Date(task.created_at).toLocaleString('zh-CN')}
                          {task.updated_at && (
                            <span style={{ marginLeft: 16 }}>
                              更新时间: {new Date(task.updated_at).toLocaleString('zh-CN')}
                            </span>
                          )}
                        </div>
                        {task.status === 'running' || task.status === 'completed' ? (
                          <div>
                            <Progress
                              percent={task.progress}
                              status={task.status === 'failed' ? 'exception' : 'success'}
                              size="small"
                              format={() => `${task.processed_images}/${task.total_images}`}
                            />
                          </div>
                        ) : null}
                        {task.status === 'failed' && task.error_message && (
                          <div style={{ color: '#ff4d4f', fontSize: '12px' }}>
                            错误: {task.error_message}
                          </div>
                        )}
                        {task.status === 'completed' && (
                          <div style={{ color: '#52c41a', fontSize: '12px' }}>
                            ✓ 成功处理 {task.processed_images} 张图片
                          </div>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )
            }}
            locale={{ emptyText: '暂无 AI 预标注任务历史' }}
          />
        </Modal>

        {/* 模型管理模态框 */}
        <Modal
          title="模型管理"
          open={modelsModalVisible}
          onCancel={() => {
            setModelsModalVisible(false)
            setModelName('')
            setModelDescription('')
            setUploadFile(null)
          }}
          footer={null}
          width={900}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                模型列表
              </div>
              {models.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                  暂无模型，请先上传模型
                </div>
              ) : (
                <Table
                  columns={[
                    {
                      title: '模型名称',
                      dataIndex: 'name',
                      key: 'name',
                    },
                    {
                      title: '文件名',
                      dataIndex: 'filename',
                      key: 'filename',
                    },
                    {
                      title: '文件大小',
                      dataIndex: 'file_size',
                      key: 'file_size',
                      render: (size: number) => {
                        if (!size) return '-'
                        const mb = (size / 1024 / 1024).toFixed(2)
                        return `${mb} MB`
                      },
                    },
                    {
                      title: '状态',
                      key: 'is_default',
                      render: (_: any, record: Model) => (
                        record.is_default ? <Tag color="blue">默认</Tag> : null
                      ),
                    },
                    {
                      title: '操作',
                      key: 'action',
                      render: (_: any, record: Model) => (
                        <Space>
                          {!record.is_default && (
                            <Button
                              type="link"
                              icon={<CheckOutlined />}
                              onClick={() => handleSetDefaultModel(record.id)}
                            >
                              设为默认
                            </Button>
                          )}
                          <Popconfirm
                            title="确认删除"
                            description="确定要删除此模型吗？删除后无法恢复。"
                            onConfirm={() => handleDeleteModel(record.id)}
                            okText="确定"
                            cancelText="取消"
                          >
                            <Button type="link" danger icon={<DeleteOutlined />}>
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                  dataSource={models}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                  size="small"
                />
              )}
            </div>

            <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>上传新模型</div>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <div style={{ marginBottom: 8 }}>模型名称</div>
                  <Input
                    placeholder="请输入模型名称"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 8 }}>描述（可选）</div>
                  <Input.TextArea
                    placeholder="请输入模型描述"
                    value={modelDescription}
                    onChange={(e) => setModelDescription(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 8 }}>模型文件</div>
                  <Upload
                    beforeUpload={(file) => {
                      setUploadFile(file)
                      return false // 阻止自动上传
                    }}
                    accept=".pt,.pth,.onnx"
                    maxCount={1}
                    onRemove={() => {
                      setUploadFile(null)
                    }}
                  >
                    <Button type="primary" icon={<UploadOutlined />}>选择文件</Button>
                  </Upload>
                  {uploadFile && (
                    <div style={{ marginTop: 8, color: '#666' }}>
                      已选择: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Button
                    type="primary"
                    onClick={handleUploadModel}
                    loading={uploadingModel}
                    disabled={!uploadFile || !modelName.trim()}
                  >
                    上传
                  </Button>
                </div>
              </Space>
            </div>
          </Space>
        </Modal>

        {/* 任务包分配 Modal */}
        <Modal
          title="分配任务包"
          open={assignModalVisible}
          onCancel={() => {
            setAssignModalVisible(false)
            setSelectedTask(null)
            setSelectedAnnotatorId(null)
          }}
          onOk={handleConfirmAssign}
          okText="确定"
          cancelText="取消"
        >
          {selectedTask && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <strong>任务包：</strong>{selectedTask.name}
              </div>
              <div style={{ marginBottom: 16 }}>
                <strong>图片数量：</strong>{selectedTask.image_count} 张
              </div>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>选择标注者</div>
                <Select
                  style={{ width: '100%' }}
                  placeholder="请选择标注者"
                  value={selectedAnnotatorId}
                  onChange={(value) => setSelectedAnnotatorId(value)}
                >
                  {annotators.map((annotator) => (
                    <Select.Option key={annotator.id} value={annotator.id}>
                      {annotator.username} ({annotator.email})
                    </Select.Option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </Modal>

        {/* 分配/重新分配任务包 Modal */}
        <Modal
          title={tasks.length > 0 ? '重新分配任务包' : '分配任务包'}
          open={reassignModalVisible}
          onCancel={() => {
            setReassignModalVisible(false)
            setReassignImagesPerTask(0)
          }}
          onOk={() => {
            if (reassignImagesPerTask <= 0) {
              message.warning('每个任务包的图片张数必须大于0')
              return
            }
            // 如果有任务包，检查是否有已分配的任务包
            if (tasks.length > 0) {
              const hasAssignedTasks = tasks.some(t => t.annotator_id)
              if (hasAssignedTasks) {
                message.error('无法重新分配：项目中存在已分配的任务包，请先取消所有任务包的分配')
                return
              }
            }
            handleReassignTasks(reassignImagesPerTask)
          }}
          okText="确定"
          cancelText="取消"
        >
          <div>
            {tasks.length > 0 && (
              <div style={{ marginBottom: 16, color: '#ff4d4f' }}>
                ⚠️ 注意：重新分配需要所有任务包都未分配标注者
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <strong>当前项目图片总数：</strong>{images.length} 张
            </div>
            <div style={{ marginBottom: 16 }}>
              <strong>每个任务包的图片张数：</strong>
              <Input
                type="number"
                min={1}
                value={reassignImagesPerTask || ''}
                onChange={(e) => setReassignImagesPerTask(Number(e.target.value) || 0)}
                placeholder="请输入每个任务包的图片张数"
                style={{ width: 150, marginLeft: 8 }}
              />
            </div>
            {reassignImagesPerTask > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: '#f0f0f0', borderRadius: 4 }}>
                <div><strong>预计创建任务包数量：</strong>
                  {Math.ceil(images.length / reassignImagesPerTask)} 个
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>分配情况：</strong>
                  {Array.from({ length: Math.ceil(images.length / reassignImagesPerTask) }, (_, i) => {
                    const start = i * reassignImagesPerTask
                    const end = Math.min(start + reassignImagesPerTask, images.length)
                    const count = end - start
                    return (
                      <div key={i} style={{ marginTop: 4 }}>
                        任务包 {i + 1}：{count} 张图片
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      </Content>
    </Layout>
  )
}
