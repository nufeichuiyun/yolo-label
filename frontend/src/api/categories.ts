import apiClient from './client'

export interface Category {
  id: number
  project_id: number
  name: string
  color: string
  created_at: string
}

export interface CategoryCreate {
  project_id: number
  name: string
  color?: string
}

export interface CategoryUpdate {
  name: string
  color?: string
}

export const categoriesApi = {
  list: async (projectId: number): Promise<Category[]> => {
    const response = await apiClient.get(`/api/categories/project/${projectId}`)
    return response.data
  },
  
  create: async (data: CategoryCreate): Promise<Category> => {
    const response = await apiClient.post('/api/categories', data)
    return response.data
  },
  
  update: async (id: number, data: CategoryUpdate): Promise<Category> => {
    const response = await apiClient.put(`/api/categories/${id}`, {
      project_id: 0, // 后端会忽略这个字段
      ...data
    })
    return response.data
  },
  
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/categories/${id}`)
  },
}
