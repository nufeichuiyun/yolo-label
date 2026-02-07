import axios from 'axios'

// 动态检测API地址 - 支持局域网访问
const getApiBaseUrl = () => {
  // 在开发环境中，始终使用相对路径通过Vite代理访问后端
  // Vite代理配置在vite.config.ts中，会将/api/*代理到后端
  // 这样可以避免CORS问题和连接问题
  if (import.meta.env.DEV) {
    // 开发环境：使用相对路径，通过Vite代理
    console.log('[API] 开发环境：使用相对路径，通过Vite代理访问后端')
    return ''
  }
  
  // 生产环境：使用当前页面的hostname和8000端口
  // 这样支持局域网访问：如果访问 http://192.168.1.100:3000，API会自动使用 http://192.168.1.100:8000
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol
    const hostname = window.location.hostname
    const port = '8000'
    const apiUrl = `${protocol}//${hostname}:${port}`
    console.log('[API] 生产环境：API Base URL:', apiUrl)
    return apiUrl
  }
  
  // 默认值（不应该到达这里）
  console.warn('[API] 使用默认API地址')
  return ''
}

const API_BASE_URL = getApiBaseUrl()

// 调试：在控制台输出API地址
if (typeof window !== 'undefined') {
  console.log('Frontend API Base URL:', API_BASE_URL || '(使用相对路径，通过Vite代理)')
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：添加token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器：处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default apiClient
export const client = apiClient
