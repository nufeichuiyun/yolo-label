import { client } from './client'

export interface PreAnnotationTask {
  id: number
  project_id: number
  model_id: number
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  total_images: number
  processed_images: number
  selected_classes: string  // JSON字符串
  error_message?: string
  created_by: number
  created_at: string
  updated_at?: string
}

export interface PreAnnotationTaskCreate {
  project_id: number
  model_id: number
  selected_classes: string[]  // 类别名称列表
}

export const preannotationApi = {
  // 创建预标注任务
  create: async (taskData: PreAnnotationTaskCreate): Promise<PreAnnotationTask> => {
    const response = await client.post('/api/preannotation', taskData)
    return response.data
  },

  // 获取任务状态
  getTask: async (taskId: string): Promise<PreAnnotationTask> => {
    const response = await client.get(`/api/preannotation/task/${taskId}`)
    return response.data
  },

  // 获取项目的所有任务
  listProjectTasks: async (projectId: number): Promise<PreAnnotationTask[]> => {
    const response = await client.get(`/api/preannotation/project/${projectId}`)
    return response.data
  },

  // 取消任务
  cancel: async (taskId: string): Promise<void> => {
    await client.delete(`/api/preannotation/task/${taskId}`)
  },
}
