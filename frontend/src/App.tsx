import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from 'antd'
import Login from './pages/Login'
import Projects from './pages/Projects'
import Tasks from './pages/Tasks'
import ProjectDetail from './pages/ProjectDetail'
import Annotation from './pages/Annotation'
import Models from './pages/Models'
import Users from './pages/Users'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import './App.css'

const { Content } = Layout

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div>加载中...</div>
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/projects"
        element={
          <ProtectedRoute>
            <Projects />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <Tasks />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId"
        element={
          <ProtectedRoute>
            <ProjectDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/annotate/:imageId"
        element={
          <ProtectedRoute>
            <Annotation />
          </ProtectedRoute>
        }
      />
      <Route
        path="/models"
        element={
          <ProtectedRoute>
            <Models />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <Users />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/projects" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Layout style={{ minHeight: '100vh' }}>
          <Content>
            <AppRoutes />
          </Content>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
