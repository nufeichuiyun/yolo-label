import { client } from './client'

export interface Model {
  id: number
  project_id: number
  name: string
  filename: string
  filepath: string
  file_size?: number
  model_type: string
  class_names?: string  // JSON字符串
  is_default: boolean
  created_by: number
  created_at: string
}

export interface ModelListResponse {
  items: Model[]
  total: number
}

export interface ModelClassesResponse {
  classes: string[]
}

export const modelsApi = {
  // 上传模型
  upload: async (projectId: number, file: File, name: string, description: string = ''): Promise<Model> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', name)
    formData.append('description', description)
    
    const response = await client.post(`/api/models/project/${projectId}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },

  // 获取项目模型列表
  list: async (projectId: number): Promise<ModelListResponse> => {
    const response = await client.get(`/api/models/project/${projectId}`)
    return response.data
  },

  // 获取模型详情
  get: async (modelId: number): Promise<Model> => {
    const response = await client.get(`/api/models/${modelId}`)
    return response.data
  },

  // 删除模型
  delete: async (modelId: number): Promise<void> => {
    await client.delete(`/api/models/${modelId}`)
  },

  // 设置默认模型
  setDefault: async (modelId: number): Promise<void> => {
    await client.post(`/api/models/${modelId}/set-default`)
  },

  // 获取模型类别列表
  getClasses: async (modelId: number, forceReparse: boolean = true): Promise<ModelClassesResponse> => {
    // 默认强制重新解析，确保获取最新的类别信息
    const response = await client.get(`/api/models/${modelId}/classes`, {
      params: { force_reparse: forceReparse }
    })
    return response.data
  },
}
