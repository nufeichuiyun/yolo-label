import React, { createContext, useContext, useState, useEffect } from 'react'
import { authApi, User } from '../api/auth'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 检查是否有token
    const token = localStorage.getItem('token')
    console.log('AuthContext初始化，检查token:', token ? '存在' : '不存在')
    if (token) {
      // 获取用户信息
      authApi
        .getCurrentUser()
        .then((userData) => {
          console.log('Token验证成功，用户:', userData.username)
          setUser(userData)
          setLoading(false)
        })
        .catch((error) => {
          console.error('Token验证失败:', error.response?.status, error.response?.data)
          // 只有在401错误时才清除token，其他错误可能是网络问题
          if (error.response?.status === 401) {
            console.log('Token已过期或无效，清除token')
            localStorage.removeItem('token')
          }
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (username: string, password: string) => {
    try {
      const response = await authApi.login({ username, password })
      if (!response || !response.access_token) {
        throw new Error('登录响应无效')
      }
      console.log('登录成功，保存token到localStorage')
      localStorage.setItem('token', response.access_token)
      const userData = await authApi.getCurrentUser()
      console.log('获取用户信息成功:', userData.username)
      setUser(userData)
    } catch (error: any) {
      console.error('登录API错误:', error)
      // 登录失败时清除可能存在的旧token
      localStorage.removeItem('token')
      // 重新抛出错误，让Login组件处理
      throw error
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
