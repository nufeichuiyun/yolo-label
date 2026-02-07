import apiClient from './client'

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface User {
  id: number
  username: string
  email: string
  role: 'super_admin' | 'project_admin' | 'annotator'
  is_active: boolean
  created_at: string
}

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post('/api/auth/login', data)
    return response.data
  },
  
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get('/api/auth/me')
    return response.data
  },
}
