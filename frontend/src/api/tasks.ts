import apiClient from './client'

export interface Task {
  id: number
  project_id: number
  name: string
  annotator_id?: number
  status: 'pending' | 'in_progress' | 'completed'
  image_count: number
  created_at: string
  updated_at?: string
}

export interface TaskCreate {
  project_id: number
  name: string
  annotator_id?: number
  image_ids: number[]
}

export interface TaskListResponse {
  items: Task[]
  total: number
}

export interface TaskAssignRequest {
  annotator_id: number
}

export interface TaskReassignRequest {
  images_per_task: number
}

export const tasksApi = {
  list: async (projectId: number): Promise<TaskListResponse> => {
    const response = await apiClient.get(`/api/tasks/project/${projectId}`)
    return response.data
  },
  
  get: async (id: number): Promise<Task> => {
    const response = await apiClient.get(`/api/tasks/${id}`)
    return response.data
  },
  
  create: async (data: TaskCreate): Promise<Task> => {
    const response = await apiClient.post('/api/tasks', data)
    return response.data
  },
  
  assign: async (taskId: number, data: TaskAssignRequest): Promise<Task> => {
    const response = await apiClient.put(`/api/tasks/${taskId}/assign`, data)
    return response.data
  },
  
  unassign: async (taskId: number): Promise<Task> => {
    const response = await apiClient.put(`/api/tasks/${taskId}/unassign`)
    return response.data
  },
  
  reassign: async (projectId: number, data: TaskReassignRequest): Promise<TaskListResponse> => {
    const response = await apiClient.put(`/api/tasks/project/${projectId}/reassign`, data)
    return response.data
  },
  
  getImages: async (taskId: number): Promise<number[]> => {
    const response = await apiClient.get(`/api/tasks/${taskId}/images`)
    return response.data
  },
  
  listMyTasks: async (): Promise<TaskListResponse> => {
    const response = await apiClient.get('/api/tasks/user/my-tasks')
    return response.data
  },
  
  getImageTask: async (imageId: number): Promise<Task | null> => {
    const response = await apiClient.get(`/api/tasks/image/${imageId}/task`)
    return response.data
  },
}
