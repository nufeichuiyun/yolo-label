import apiClient from './client'

export interface Annotation {
  id: number
  image_id: number
  category_id: number
  annotator_id: number
  bbox_data: string
  created_at: string
  updated_at?: string
}

export interface AnnotationBbox {
  x_center: number
  y_center: number
  width: number
  height: number
}

export interface AnnotationCreate {
  category_id: number
  bbox: AnnotationBbox
}

export const annotationsApi = {
  create: async (imageId: number, annotations: AnnotationCreate[]): Promise<Annotation[]> => {
    const response = await apiClient.post(`/api/annotations?image_id=${imageId}`, annotations)
    return response.data
  },
  
  getImageAnnotations: async (imageId: number): Promise<Annotation[]> => {
    const response = await apiClient.get(`/api/annotations/image/${imageId}`)
    return response.data
  },
  
  delete: async (imageId: number): Promise<void> => {
    await apiClient.delete(`/api/annotations/image/${imageId}`)
  },
}
