import { useEffect, useState } from 'react'
import { Layout, Card, Button, Table, Tag, Space, message, Modal } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { projectsApi, Project } from '../api/projects'
import ProjectForm from '../components/ProjectForm'
import { useAuth } from '../contexts/AuthContext'
import './Projects.css'

const { Header, Content } = Layout

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    // 如果是标注者，重定向到工作包列表
    if (user?.role === 'annotator') {
      navigate('/tasks', { replace: true })
      return
    }
    loadProjects()
  }, [user, navigate])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const data = await projectsApi.list()
      setProjects(data.items)
    } catch (error) {
      message.error('加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingProject(null)
    setModalVisible(true)
  }

  const handleEdit = (project: Project) => {
    setEditingProject(project)
    setModalVisible(true)
  }

  const handleDelete = (project: Project) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除项目"${project.name}"吗？`,
      onOk: async () => {
        try {
          await projectsApi.delete(project.id)
          message.success('删除成功')
          loadProjects()
        } catch (error) {
          message.error('删除失败')
        }
      },
    })
  }

  const handleFormSubmit = async (values: any) => {
    try {
      if (editingProject) {
        await projectsApi.update(editingProject.id, values)
        message.success('更新成功')
        setModalVisible(false)
        loadProjects()
      } else {
        const newProject = await projectsApi.create(values)
        message.success('创建成功')
        setModalVisible(false)
        loadProjects()
        // 创建成功后跳转到项目详情页
        navigate(`/projects/${newProject.id}`)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '操作失败')
    }
  }

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '标注类型',
      dataIndex: 'annotation_type',
      key: 'annotation_type',
      render: (type: string) => {
        const typeMap: Record<string, { text: string; color: string }> = {
          detection: { text: '目标检测', color: 'blue' },
          segmentation: { text: '实例分割', color: 'green' },
          keypoint: { text: '关键点检测', color: 'orange' },
        }
        const info = typeMap[type] || { text: type, color: 'default' }
        return <Tag color={info.color}>{info.text}</Tag>
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Project) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/projects/${record.id}`)}
          >
            查看
          </Button>
          {(user?.role === 'super_admin' || user?.role === 'project_admin') && (
            <>
              <Button
                type="link"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                编辑
              </Button>
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record)}
              >
                删除
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Layout className="projects-layout">
      <Header className="projects-header">
        <div className="header-title">yolo-label</div>
        <Space>
          {user?.role === 'super_admin' && (
            <Button type="link" onClick={() => navigate('/users')} style={{ color: 'white' }}>
              <UserOutlined /> 用户管理
            </Button>
          )}
          <span>欢迎，{user?.username}</span>
          <Button onClick={logout}>退出</Button>
        </Space>
      </Header>
      <Content className="projects-content">
        <Card
          title="项目管理"
          extra={
            (user?.role === 'super_admin' || user?.role === 'project_admin') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新建项目
              </Button>
            )
          }
        >
          <Table
            columns={columns}
            dataSource={projects}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
          />
        </Card>

        <ProjectForm
          visible={modalVisible}
          project={editingProject}
          onCancel={() => setModalVisible(false)}
          onSubmit={handleFormSubmit}
        />
      </Content>
    </Layout>
  )
}
