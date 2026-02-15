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
}

export interface BaseModelOption {
  value: string
  label: string
}

export interface BaseModelsResponse {
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
}
