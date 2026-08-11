import { useState } from 'react'
import { Form, Input, message, Modal } from 'antd'
import { authApi, ChangePasswordRequest } from '../api/auth'
import { useAuth } from '../contexts/AuthContext'
import { getApiErrorMessage, validatePassword } from '../utils/password'

interface ChangePasswordModalProps {
  open: boolean
  onCancel: () => void
}

interface ChangePasswordFormValues extends ChangePasswordRequest {
  confirm_password: string
}

export default function ChangePasswordModal({ open, onCancel }: ChangePasswordModalProps) {
  const [form] = Form.useForm<ChangePasswordFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const { logout } = useAuth()

  const handleCancel = () => {
    form.resetFields()
    onCancel()
  }

  const handleSubmit = async (values: ChangePasswordFormValues) => {
    setSubmitting(true)
    try {
      await authApi.changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      })
      message.success('密码修改成功，请重新登录')
      form.resetFields()
      logout()
    } catch (error: any) {
      message.error(getApiErrorMessage(error, '密码修改失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="修改密码"
      open={open}
      onCancel={handleCancel}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText="确定"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="old_password"
          label="旧密码"
          rules={[{ required: true, message: '请输入旧密码' }]}
        >
          <Input.Password placeholder="请输入旧密码" autoComplete="current-password" />
        </Form.Item>

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
  )
}
