import { useEffect, useState } from 'react'
import { Layout, Card, Button, Table, Tag, Space, message, Modal, Upload, Progress } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, UserOutlined, ImportOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { projectsApi, Project } from '../api/projects'
import { exportApi } from '../api/export'
import ProjectForm from '../components/ProjectForm'
import { useAuth } from '../contexts/AuthContext'
import './Projects.css'

const { Header, Content } = Layout

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
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

  const handleImport = async () => {
    if (!importFile) {
      message.warning('请选择要导入的文件')
      return
    }
    setImporting(true)
    setImportProgress(0)
    try {
      const { project_id } = await exportApi.importProject(importFile, {
        onProgress: (percent) => setImportProgress(percent),
      })
      setImportProgress(100)
      message.success('项目导入成功')
      setImportModalVisible(false)
      setImportFile(null)
      setImportProgress(null)
      loadProjects()
      navigate(`/projects/${project_id}`)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '导入失败')
      setImportProgress(null)
    } finally {
      setImporting(false)
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
              <Space>
                <Button icon={<ImportOutlined />} onClick={() => setImportModalVisible(true)}>
                  导入项目
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                  新建项目
                </Button>
              </Space>
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

        <Modal
          title="导入项目"
          open={importModalVisible}
          onOk={handleImport}
          onCancel={() => {
            setImportModalVisible(false)
            setImportFile(null)
            setImportProgress(null)
          }}
          okText="导入"
          cancelText="取消"
          confirmLoading={importing}
          okButtonProps={{ disabled: !importFile || importing }}
        >
          <p style={{ marginBottom: 12 }}>请选择之前导出的项目 zip 文件进行导入。</p>
          {importing && importProgress !== null && (
            <Progress
              percent={importProgress}
              status={importProgress >= 100 ? 'active' : 'active'}
              style={{ marginBottom: 16 }}
              format={(p) => (p && p < 100 ? `上传中 ${p}%` : '正在处理...')}
            />
          )}
          <Upload
            accept=".zip"
            maxCount={1}
            disabled={importing}
            beforeUpload={(file) => {
              setImportFile(file)
              return false
            }}
            onRemove={() => setImportFile(null)}
            fileList={importFile ? [{ uid: '-1', name: importFile.name }] : []}
          >
            <Button disabled={importing}>选择文件</Button>
          </Upload>
        </Modal>
      </Content>
    </Layout>
  )
}
