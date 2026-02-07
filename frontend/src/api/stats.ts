import apiClient from './client'

export interface ProjectStats {
  project_id: number
  total_images: number
  annotated_images: number
  total_annotations: number
  categories_count: number
}

export interface TaskStats {
  task_id: number
  total_images: number
  annotated_images: number
}

export const statsApi = {
  getProjectStats: async (projectId: number): Promise<ProjectStats> => {
    const response = await apiClient.get(`/api/stats/project/${projectId}`)
    return response.data
  },
  
  getTaskStats: async (taskId: number): Promise<TaskStats> => {
    const response = await apiClient.get(`/api/stats/task/${taskId}`)
    return response.data
  },
}
