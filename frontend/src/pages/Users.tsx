import { useEffect, useState } from 'react'
import { Layout, Card, Button, Table, Tag, Space, message, Modal, Form, Input, Select } from 'antd'
import { PlusOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { usersApi, UserCreate } from '../api/users'
import { User } from '../api/auth'
import { useAuth } from '../contexts/AuthContext'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { getApiErrorMessage, validatePassword } from '../utils/password'
import './Users.css'

const { Header, Content } = Layout

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [changePasswordVisible, setChangePasswordVisible] = useState(false)
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [form] = Form.useForm()
  const [resetPasswordForm] = Form.useForm()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await usersApi.list()
      setUsers(data.items)
    } catch (error: any) {
      message.error('加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    form.resetFields()
    setModalVisible(true)
  }

  const handleDelete = (userToDelete: User) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除用户"${userToDelete.username}"吗？`,
      onOk: async () => {
        try {
          await usersApi.delete(userToDelete.id)
          message.success('删除成功')
          loadUsers()
        } catch (error: any) {
          message.error(error.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  const handleFormSubmit = async (values: UserCreate) => {
    try {
      await usersApi.create(values)
      message.success('创建成功')
      setModalVisible(false)
      loadUsers()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  const handleResetPassword = async (values: { new_password: string }) => {
    if (!resetPasswordUser) {
      return
    }
    setResettingPassword(true)
    try {
      await usersApi.resetPassword(resetPasswordUser.id, { new_password: values.new_password })
      message.success(`已重置用户“${resetPasswordUser.username}”的密码`)
      setResetPasswordUser(null)
      resetPasswordForm.resetFields()
    } catch (error: any) {
      message.error(getApiErrorMessage(error, '重置密码失败'))
    } finally {
      setResettingPassword(false)
    }
  }

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const roleMap: Record<string, { text: string; color: string }> = {
          super_admin: { text: '超级管理员', color: 'red' },
          project_admin: { text: '项目管理员', color: 'blue' },
          annotator: { text: '标注者', color: 'green' },
        }
        const info = roleMap[role] || { text: role, color: 'default' }
        return <Tag color={info.color}>{info.text}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>{isActive ? '启用' : '禁用'}</Tag>
      ),
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
      render: (_: any, record: User) => (
        <Space>
          {record.id !== user?.id && (
            <>
              <Button
                type="link"
                icon={<KeyOutlined />}
                onClick={() => {
                  resetPasswordForm.resetFields()
                  setResetPasswordUser(record)
                }}
              >
                重置密码
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
    <Layout className="users-layout">
      <Header className="users-header">
        <div className="header-title">yolo-label</div>
        <Space>
          <Button type="link" onClick={() => navigate('/projects')}>
            项目管理
          </Button>
          <span>欢迎，{user?.username}</span>
          <Button onClick={() => setChangePasswordVisible(true)}>修改密码</Button>
          <Button onClick={logout}>退出</Button>
        </Space>
      </Header>
      <Content className="users-content">
        <Card
          title="用户管理"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建用户
            </Button>
          }
        >
          <Table
            columns={columns}
            dataSource={users}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
          />
        </Card>

        <Modal
          title="新建用户"
          open={modalVisible}
          onCancel={() => setModalVisible(false)}
          onOk={() => {
            form.submit()
          }}
          okText="确定"
          cancelText="取消"
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleFormSubmit}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>

            <Form.Item
              name="email"
              label="邮箱"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址' },
              ]}
            >
              <Input placeholder="请输入邮箱" />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { validator: (_, value) => validatePassword(value) },
              ]}
            >
              <Input.Password placeholder="请输入密码" />
            </Form.Item>

            <Form.Item
              name="role"
              label="角色"
              initialValue="annotator"
              rules={[{ required: true, message: '请选择角色' }]}
            >
              <Select placeholder="请选择角色">
                <Select.Option value="super_admin">超级管理员</Select.Option>
                <Select.Option value="project_admin">项目管理员</Select.Option>
                <Select.Option value="annotator">标注者</Select.Option>
              </Select>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={`重置用户“${resetPasswordUser?.username || ''}”的密码`}
          open={resetPasswordUser !== null}
          onCancel={() => {
            setResetPasswordUser(null)
            resetPasswordForm.resetFields()
          }}
          onOk={() => resetPasswordForm.submit()}
          confirmLoading={resettingPassword}
          okText="确定"
          cancelText="取消"
          destroyOnHidden
        >
          <Form form={resetPasswordForm} layout="vertical" onFinish={handleResetPassword}>
            <Form.Item
              name="new_password"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { validator: (_, value) => validatePassword(value) },
              ]}
            >
              <Input.Password placeholder="请输入新密码" autoComplete="new-password" />
            </Form.Item>

            <Form.Item
              name="confirm_password"
              label="确认新密码"
              dependencies={['new_password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'))
                  },
                }),
              ]}
            >
              <Input.Password placeholder="请再次输入新密码" autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Modal>

        <ChangePasswordModal
          open={changePasswordVisible}
          onCancel={() => setChangePasswordVisible(false)}
        />
      </Content>
    </Layout>
  )
}
