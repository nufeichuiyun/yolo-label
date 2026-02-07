import apiClient from './client'

export interface Image {
  id: number
  project_id: number
  filename: string
  filepath: string
  width?: number
  height?: number
  file_size?: number
  is_annotated: boolean
  annotation_count?: number
  created_at: string
}

export interface ImageListResponse {
  items: Image[]
  total: number
}

export const imagesApi = {
  list: async (projectId: number, skip = 0, limit = 100): Promise<ImageListResponse> => {
    const response = await apiClient.get(`/api/images/project/${projectId}`, {
      params: { skip, limit },
    })
    return response.data
  },
  
  get: async (id: number): Promise<Image> => {
    const response = await apiClient.get(`/api/images/${id}`)
    return response.data
  },
  
  upload: async (projectId: number, files: File[]): Promise<void> => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    await apiClient.post(`/api/images/upload/${projectId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 300000, // 5分钟超时（支持大量文件上传）
    })
  },
  
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/images/${id}`)
  },
}
