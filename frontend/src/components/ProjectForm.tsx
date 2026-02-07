import { useEffect } from 'react'
import { Modal, Form, Input, Select } from 'antd'
import { Project } from '../api/projects'

interface ProjectFormProps {
  visible: boolean
  project: Project | null
  onCancel: () => void
  onSubmit: (values: any) => void
}

export default function ProjectForm({ visible, project, onCancel, onSubmit }: ProjectFormProps) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (visible) {
      if (project) {
        form.setFieldsValue(project)
      } else {
        form.resetFields()
      }
    }
  }, [visible, project, form])

  return (
    <Modal
      title={project ? '编辑项目' : '新建项目'}
      open={visible}
      onCancel={onCancel}
      onOk={() => {
        form.submit()
      }}
      okText="确定"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, message: '请输入项目名称' }]}
        >
          <Input placeholder="请输入项目名称" />
        </Form.Item>

        <Form.Item
          name="description"
          label="项目描述"
        >
          <Input.TextArea rows={4} placeholder="请输入项目描述" />
        </Form.Item>

        <Form.Item
          name="annotation_type"
          label="标注类型"
          rules={[{ required: true, message: '请选择标注类型' }]}
        >
          <Select disabled={!!project} placeholder="请选择标注类型">
            <Select.Option value="detection">目标检测</Select.Option>
            <Select.Option value="segmentation">实例分割</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="images_per_task"
          label="每个任务包的图片张数（可选）"
          tooltip="设置后，上传图片时将自动创建任务包"
        >
          <Input
            type="number"
            min={1}
            placeholder="留空则不自动创建任务包"
            disabled={!!project}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
