import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Login.css'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // 如果已经登录，根据角色自动跳转
  useEffect(() => {
    if (!authLoading && user) {
      // 标注者跳转到工作包列表，其他角色跳转到项目列表
      if (user.role === 'annotator') {
        navigate('/tasks', { replace: true })
      } else {
        navigate('/projects', { replace: true })
      }
    }
  }, [user, authLoading, navigate])

  // 如果正在加载认证状态，显示加载中
  if (authLoading) {
    return (
      <div className="login-container">
        <Card className="login-card" title="yolo-label 登录">
          <div style={{ textAlign: 'center', padding: '20px' }}>加载中...</div>
        </Card>
      </div>
    )
  }

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.username, values.password)
      message.success('登录成功')
      // 根据用户角色跳转
      // 注意：这里user可能还没有更新，需要从login返回的用户信息判断
      // 但login函数会更新AuthContext中的user，所以上面的useEffect会处理跳转
      // 这里先跳转到默认页面，useEffect会根据实际用户角色再次跳转
      navigate('/projects')
    } catch (error: any) {
      console.error('登录错误:', error)
      const errorMessage = error.response?.data?.detail || error.message || '登录失败，请检查用户名和密码'
      message.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <Card className="login-card" title="yolo-label 登录">
        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
