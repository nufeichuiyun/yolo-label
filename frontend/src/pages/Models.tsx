import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout, Card, Button, Table, Upload, message, Space, Modal, Input, Popconfirm, Tag } from 'antd'
import { UploadOutlined, ArrowLeftOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons'
import { modelsApi, Model } from '../api/models'
import './Models.css'

const { Header, Content } = Layout

export default function Models() {
  const navigate = useNavigate()
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [modelName, setModelName] = useState('')
  const [modelDescription, setModelDescription] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    setLoading(true)
    try {
      const data = await modelsApi.list()
      setModels(data.items)
    } catch (error) {
      message.error('加载模型列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      message.warning('请选择模型文件')
      return
    }
    if (!modelName.trim()) {
      message.warning('请输入模型名称')
      return
    }

    setUploading(true)
    try {
      await modelsApi.upload(uploadFile, modelName.trim(), modelDescription.trim())
      message.success('模型上传成功')
      setUploadModalVisible(false)
      setModelName('')
      setModelDescription('')
      setUploadFile(null)
      loadModels()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (modelId: number) => {
    try {
      await modelsApi.delete(modelId)
      message.success('删除成功')
      loadModels()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  const handleSetDefault = async (modelId: number) => {
    try {
      await modelsApi.setDefault(modelId)
      message.success('已设置为默认模型')
      loadModels()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '设置失败')
    }
  }

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
    },
    {
      title: '文件大小',
      dataIndex: 'file_size',
      key: 'file_size',
      render: (size: number) => {
        if (!size) return '-'
        const mb = (size / 1024 / 1024).toFixed(2)
        return `${mb} MB`
      },
    },
    {
      title: '状态',
      key: 'is_default',
      render: (_: any, record: Model) => (
        record.is_default ? <Tag color="blue">默认</Tag> : null
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Model) => (
        <Space>
          {!record.is_default && (
            <Button
              type="link"
              size="small"
              onClick={() => handleSetDefault(record.id)}
            >
              设为默认
            </Button>
          )}
          <Popconfirm
            title="确认删除"
            description="确定要删除此模型吗？删除后无法恢复。"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Layout className="models-layout">
      <Header className="models-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
            返回
          </Button>
          <span>模型管理</span>
        </Space>
      </Header>
      <Content className="models-content">
        <Card
          title="AI模型列表"
          extra={
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
            >
              上传模型
            </Button>
          }
        >
          <Table
            columns={columns}
            dataSource={models}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 20,
              showTotal: (total) => `共 ${total} 个模型`,
            }}
          />
        </Card>

        <Modal
          title="上传模型"
          open={uploadModalVisible}
          onOk={handleUpload}
          onCancel={() => {
            setUploadModalVisible(false)
            setModelName('')
            setModelDescription('')
            setUploadFile(null)
          }}
          okText="上传"
          cancelText="取消"
          confirmLoading={uploading}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <div style={{ marginBottom: 8 }}>模型名称</div>
              <Input
                placeholder="请输入模型名称"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8 }}>描述（可选）</div>
              <Input.TextArea
                placeholder="请输入模型描述"
                value={modelDescription}
                onChange={(e) => setModelDescription(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
            <div>
              <div style={{ marginBottom: 8 }}>模型文件</div>
              <Upload
                beforeUpload={(file) => {
                  setUploadFile(file)
                  return false // 阻止自动上传
                }}
                accept=".pt,.pth,.onnx"
                maxCount={1}
                onRemove={() => {
                  setUploadFile(null)
                }}
              >
                <Button icon={<UploadOutlined />}>选择文件</Button>
              </Upload>
              {uploadFile && (
                <div style={{ marginTop: 8, color: '#666' }}>
                  已选择: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              )}
            </div>
          </Space>
        </Modal>
      </Content>
    </Layout>
  )
}
