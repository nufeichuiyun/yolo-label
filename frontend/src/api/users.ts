import apiClient from './client'
import { User } from './auth'

export interface UserCreate {
  username: string
  email: string
  password: string
  role?: 'super_admin' | 'project_admin' | 'annotator'
}

export interface UserListResponse {
  items: User[]
  total: number
}

export interface ResetPasswordRequest {
  new_password: string
}

export const usersApi = {
  list: async (skip = 0, limit = 100): Promise<UserListResponse> => {
    const response = await apiClient.get('/api/users', {
      params: { skip, limit },
    })
    return response.data
  },
  
  get: async (id: number): Promise<User> => {
    const response = await apiClient.get(`/api/users/${id}`)
    return response.data
  },
  
  create: async (data: UserCreate): Promise<User> => {
    const response = await apiClient.post('/api/auth/register', data)
    return response.data
  },
  
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/users/${id}`)
  },

  resetPassword: async (id: number, data: ResetPasswordRequest): Promise<void> => {
    await apiClient.put(`/api/users/${id}/password`, data)
  },
}
