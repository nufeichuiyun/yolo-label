import apiClient from './client'

function extractFilename(response: { headers: Record<string, string> }, defaultName: string): string {
  const contentDisposition = response.headers['content-disposition'] || response.headers['Content-Disposition'] || ''
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    if (filenameMatch && filenameMatch[1]) {
      return filenameMatch[1].replace(/['"]/g, '')
    }
  }
  return defaultName
}

export const exportApi = {
  /** 导出 YOLO 格式（仅已标注图片） */
  exportYOLO: async (projectId: number): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/api/export/project/${projectId}/yolo`, {
      responseType: 'blob',
    })
    const filename = extractFilename(
      response,
      `project_${projectId}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`
    )
    return { blob: response.data, filename }
  },

  /** 导出完整项目（可导入到其他实例） */
  exportFull: async (projectId: number): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/api/export/project/${projectId}/full`, {
      responseType: 'blob',
    })
    const filename = extractFilename(
      response,
      `project_${projectId}_full_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`
    )
    return { blob: response.data, filename }
  },

  /** 导入项目 */
  importProject: async (
    file: File,
    options?: { onProgress?: (percent: number) => void }
  ): Promise<{ project_id: number }> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await apiClient.post('/api/export/project/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: options?.onProgress
        ? (e) => {
            const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 0
            options.onProgress!(percent)
          }
        : undefined,
    })
    return response.data
  },
}
