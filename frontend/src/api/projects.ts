import apiClient from './client'

export interface Project {
  id: number
  name: string
  description?: string
  annotation_type: 'detection' | 'segmentation' | 'keypoint'
  images_per_task?: number
  creator_id: number
  created_at: string
  updated_at?: string
}

export interface ProjectCreate {
  name: string
  description?: string
  annotation_type: 'detection' | 'segmentation' | 'keypoint'
  images_per_task?: number
}

export interface ProjectListResponse {
  items: Project[]
  total: number
}

export const projectsApi = {
  list: async (skip = 0, limit = 100): Promise<ProjectListResponse> => {
    const response = await apiClient.get('/api/projects', {
      params: { skip, limit },
    })
    return response.data
  },
  
  get: async (id: number): Promise<Project> => {
    const response = await apiClient.get(`/api/projects/${id}`)
    return response.data
  },
  
  create: async (data: ProjectCreate): Promise<Project> => {
    const response = await apiClient.post('/api/projects', data)
    return response.data
  },
  
  update: async (id: number, data: ProjectCreate): Promise<Project> => {
    const response = await apiClient.put(`/api/projects/${id}`, data)
    return response.data
  },
  
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${id}`)
  },
}
