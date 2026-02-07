import { useEffect, useState } from 'react'
import { Layout, Card, Table, Space, message, Progress } from 'antd'
import { EyeOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { tasksApi, Task } from '../api/tasks'
import { projectsApi, Project } from '../api/projects'
import { statsApi, TaskStats } from '../api/stats'
import { useAuth } from '../contexts/AuthContext'
import './Tasks.css'

const { Header, Content } = Layout

interface TaskWithProject extends Task {
  project?: Project
  stats?: TaskStats
}

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskWithProject[]>([])
  const [loading, setLoading] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    loadTasks()
  }, [])

  const loadTasks = async () => {
    setLoading(true)
    try {
      const data = await tasksApi.listMyTasks()
      
      // 获取所有项目信息
      const projectIds = [...new Set(data.items.map(task => task.project_id))]
      const projectsMap = new Map<number, Project>()
      
      for (const projectId of projectIds) {
        try {
          const project = await projectsApi.get(projectId)
          projectsMap.set(projectId, project)
        } catch (error) {
          console.error(`加载项目 ${projectId} 失败:`, error)
        }
      }
      
      // 获取每个任务包的统计信息
      const tasksWithProject: TaskWithProject[] = await Promise.all(
        data.items.map(async (task) => {
          const project = projectsMap.get(task.project_id)
          let stats: TaskStats | undefined
          
          try {
            stats = await statsApi.getTaskStats(task.id)
          } catch (error) {
            console.error(`加载任务包 ${task.id} 统计失败:`, error)
          }
          
          return {
            ...task,
            project,
            stats,
          }
        })
      )
      
      setTasks(tasksWithProject)
    } catch (error) {
      message.error('加载工作包列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleStartAnnotation = async (task: TaskWithProject) => {
    try {
      // 获取任务包中的图片列表
      const imageIds = await tasksApi.getImages(task.id)
      if (imageIds.length === 0) {
        message.warning('该任务包中没有图片')
        return
      }
      
      // 跳转到第一张图片的标注页面
      navigate(`/projects/${task.project_id}/annotate/${imageIds[0]}`)
    } catch (error) {
      message.error('获取任务包图片失败')
    }
  }

  const columns = [
    {
      title: '项目名称',
      key: 'project_name',
      render: (_: any, record: TaskWithProject) => record.project?.name || `项目 ${record.project_id}`,
    },
    {
      title: '工作包名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '图片数量',
      dataIndex: 'image_count',
      key: 'image_count',
      render: (count: number) => `${count} 张`,
    },
    {
      title: '标注进度',
      key: 'progress',
      render: (_: any, record: TaskWithProject) => {
        if (!record.stats) {
          return '-'
        }
        const percentage = record.stats.total_images > 0
          ? Math.round((record.stats.annotated_images / record.stats.total_images) * 100)
          : 0
        return (
          <Space>
            <Progress
              percent={percentage}
              size="small"
              style={{ width: 100 }}
              format={(percent) => `${percent}%`}
            />
            <span style={{ fontSize: '12px', color: '#666' }}>
              {record.stats.annotated_images}/{record.stats.total_images}
            </span>
          </Space>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: TaskWithProject) => (
        <Space>
          <a onClick={() => handleStartAnnotation(record)}>
            <EyeOutlined /> 开始标注
          </a>
        </Space>
      ),
    },
  ]

  return (
    <Layout className="tasks-layout">
      <Header className="tasks-header">
        <div className="header-title">yolo-label</div>
        <Space>
          {user?.role === 'super_admin' && (
            <a onClick={() => navigate('/users')} style={{ color: 'white' }}>
              <UserOutlined /> 用户管理
            </a>
          )}
          {user?.role !== 'annotator' && (
            <a onClick={() => navigate('/projects')} style={{ color: 'white' }}>
              项目管理
            </a>
          )}
          <span>欢迎，{user?.username}</span>
          <a onClick={logout} style={{ color: 'white' }}>退出</a>
        </Space>
      </Header>
      <Content className="tasks-content">
        <Card title="我的工作包">
          <Table
            columns={columns}
            dataSource={tasks}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
          />
        </Card>
      </Content>
    </Layout>
  )
}
