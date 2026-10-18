import { client } from './client'

export interface TrainingTaskMetrics {
  epoch?: number
  loss?: number
  map50?: number
  map50_95?: number
  lr?: number
}

export interface TrainingTask {
  id: number
  project_id: number
  base_model: string
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  epochs: number
  current_epoch: number
  train_images: number
  val_images: number
  error_message?: string
  output_model_path?: string
  output_archive_path?: string
  convert_to_rknn?: boolean
  rknn_status?: 'pending' | 'converting' | 'completed' | 'failed'
  output_rknn_path?: string
  rknn_error?: string
  created_by: number
  created_at: string
  updated_at?: string
  latest_metrics?: TrainingTaskMetrics
}

export interface TrainingTaskCreate {
  project_id: number
  base_model?: string
  epochs?: number
  imgsz?: number
  batch?: number
  train_split?: number
  convert_to_rknn?: boolean
}

export interface BaseModelOption {
  rknn_supported: boolean
  value: string
  label: string
}

export interface BaseModelsResponse {
  rknn_enabled: boolean
  models: BaseModelOption[]
  default: string
}

export const trainingApi = {
  // 创建训练任务
  create: async (taskData: TrainingTaskCreate): Promise<TrainingTask> => {
    const response = await client.post('/api/training', taskData)
    return response.data
  },

  // 获取任务状态
  getTask: async (taskId: string): Promise<TrainingTask> => {
    const response = await client.get(`/api/training/task/${taskId}`)
    return response.data
  },

  // 获取项目的所有训练任务
  listProjectTasks: async (projectId: number): Promise<TrainingTask[]> => {
    const response = await client.get(`/api/training/project/${projectId}`)
    return response.data
  },

  // 获取项目可用的基础模型
  getBaseModels: async (projectId: number): Promise<BaseModelsResponse> => {
    const response = await client.get(`/api/training/project/${projectId}/base-models`)
    return response.data
  },

  // 中断/停止正在进行的训练任务
  revokeTask: async (taskId: string): Promise<void> => {
    await client.post(`/api/training/task/${taskId}/revoke`)
  },

  // 下载训练完成的模型
  downloadModel: async (taskId: string, filename: string): Promise<void> => {
    const response = await client.get(`/api/training/download/${taskId}`, {
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `model_${taskId}.pt`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  },

  // 下载训练完整包（数据集+模型+训练曲线 zip）
  downloadArchive: async (taskId: string, filename: string): Promise<void> => {
    const response = await client.get(`/api/training/download-archive/${taskId}`, {
      responseType: 'blob',
      validateStatus: () => true, // 不自动抛出，手动检查
    })
    // 4xx/5xx 时 data 是 Blob（含 JSON 错误体），需解析
    if (response.status >= 400) {
      if (response.status === 401) {
        localStorage.removeItem('token')
        window.location.href = '/login'
        return
      }
      const text = await (response.data as Blob).text()
      let detail = '下载失败'
      try {
        const parsed = JSON.parse(text)
        detail = parsed.detail || detail
      } catch {
        if (text) detail = text
      }
      throw new Error(detail)
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `training_${taskId}.zip`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  },

  // 下载 PT + RKNN 模型包（zip）
  downloadBundle: async (taskId: string, filename: string): Promise<void> => {
    const response = await client.get(`/api/training/download-bundle/${taskId}`, {
      responseType: 'blob',
      validateStatus: () => true, // 不自动抛出，手动检查
    })
    if (response.status >= 400) {
      if (response.status === 401) {
        localStorage.removeItem('token')
        window.location.href = '/login'
        return
      }
      const text = await (response.data as Blob).text()
      let detail = '下载失败'
      try {
        const parsed = JSON.parse(text)
        detail = parsed.detail || detail
      } catch {
        if (text) detail = text
      }
      throw new Error(detail)
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `model_bundle_${taskId}.zip`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  },
}
