import apiClient from './client'

export const exportApi = {
  exportYOLO: async (projectId: number): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/api/export/project/${projectId}/yolo`, {
      responseType: 'blob',
    })
    // 从Content-Disposition头中提取文件名
    // 注意：axios会将响应头转换为小写
    const contentDisposition = response.headers['content-disposition'] || response.headers['Content-Disposition'] || ''
    let filename = ''
    if (contentDisposition) {
      // 匹配 filename="xxx" 或 filename=xxx
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        // 移除引号
        filename = filenameMatch[1].replace(/['"]/g, '')
      }
    }
    // 如果没有从header获取到，使用默认名称（带时间戳）
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      filename = `project_${projectId}_${timestamp}.zip`
    }
    return { blob: response.data, filename }
  },
}
