"""
Pydantic模型（API请求/响应模型）
"""
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
from datetime import datetime
from app.models import UserRole, AnnotationType


# 用户相关
def validate_new_password(password: str) -> str:
    """校验 bcrypt 可安全处理的新密码。"""
    if len(password) < 6:
        raise ValueError("密码至少需要6个字符")
    if len(password.encode("utf-8")) > 72:
        raise ValueError("密码的 UTF-8 编码不能超过72字节")
    return password


class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str
    role: Optional[UserRole] = UserRole.ANNOTATOR

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_new_password(password)


class UserResponse(UserBase):
    id: int
    role: UserRole
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    items: List[UserResponse]
    total: int


class Token(BaseModel):
    access_token: str
    token_type: str


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_new_password(password)


class PasswordResetRequest(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_new_password(password)


# 项目相关
class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    annotation_type: AnnotationType


class ProjectCreate(ProjectBase):
    images_per_task: Optional[int] = None  # 每个任务包的图片张数，如果提供则自动创建任务包


class ProjectResponse(ProjectBase):
    id: int
    creator_id: int
    images_per_task: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    items: List[ProjectResponse]
    total: int


# 图片相关
class ImageBase(BaseModel):
    filename: str


class ImageResponse(ImageBase):
    id: int
    project_id: int
    filepath: str
    width: Optional[int]
    height: Optional[int]
    file_size: Optional[int]
    is_annotated: bool
    annotation_count: Optional[int] = 0
    created_at: datetime

    class Config:
        from_attributes = True


class ImageListResponse(BaseModel):
    items: List[ImageResponse]
    total: int


# 类别相关
class CategoryBase(BaseModel):
    name: str
    color: Optional[str] = "#FF0000"


class CategoryCreate(CategoryBase):
    project_id: int


class CategoryResponse(CategoryBase):
    id: int
    project_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# 标注相关
class AnnotationBase(BaseModel):
    bbox_data: str  # JSON字符串


class AnnotationCreate(AnnotationBase):
    image_id: int
    category_id: int


class AnnotationResponse(AnnotationBase):
    id: int
    image_id: int
    category_id: int
    annotator_id: int
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# 统计相关
class ProjectStats(BaseModel):
    project_id: int
    total_images: int
    annotated_images: int
    total_annotations: int
    categories_count: int


# 模型相关
class ModelBase(BaseModel):
    name: str
    description: Optional[str] = None


class ModelCreate(ModelBase):
    pass


class ModelResponse(ModelBase):
    id: int
    project_id: int
    filename: str
    filepath: str
    file_size: Optional[int]
    model_type: str
    class_names: Optional[str] = None  # JSON字符串
    is_default: bool
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


class ModelListResponse(BaseModel):
    items: List[ModelResponse]
    total: int


# 预标注任务相关
class PreAnnotationTaskCreate(BaseModel):
    project_id: int
    model_id: int
    selected_classes: List[str]  # 选中的类别名称列表


class PreAnnotationTaskResponse(BaseModel):
    id: int
    project_id: int
    model_id: int
    task_id: str
    status: str  # pending, running, completed, failed
    progress: int
    total_images: int
    processed_images: int
    selected_classes: str  # JSON字符串
    error_message: Optional[str] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# 任务包相关
class TaskBase(BaseModel):
    name: str
    annotator_id: Optional[int] = None


class TaskCreate(TaskBase):
    project_id: int
    image_ids: List[int]  # 分配给此任务包的图片ID列表


class TaskResponse(TaskBase):
    id: int
    project_id: int
    status: str  # pending, in_progress, completed
    image_count: Optional[int] = 0  # 任务包中的图片数量
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int


class TaskAssignRequest(BaseModel):
    annotator_id: int  # 分配的标注者ID


class TaskReassignRequest(BaseModel):
    images_per_task: int  # 每个任务包的图片张数


class TaskStats(BaseModel):
    """任务包统计信息"""
    task_id: int
    total_images: int  # 任务包总图片数
    annotated_images: int  # 已标注图片数


# 训练任务相关
class TrainingTaskCreate(BaseModel):
    project_id: int
    base_model: Optional[str] = None  # 不传则按项目类型自动选择
    epochs: Optional[int] = 100
    imgsz: Optional[int] = 640
    batch: Optional[int] = 16
    train_split: Optional[float] = 0.8
    convert_to_rknn: Optional[bool] = True  # 训练后转换为 RK3588 RKNN，默认开启


class TrainingTaskMetrics(BaseModel):
    """训练实时指标（从 Redis 读取）"""
    epoch: Optional[int] = None
    loss: Optional[float] = None
    map50: Optional[float] = None
    map50_95: Optional[float] = None
    lr: Optional[float] = None


class TrainingTaskResponse(BaseModel):
    id: int
    project_id: int
    base_model: str
    task_id: str
    status: str  # pending, running, completed, failed
    progress: int
    epochs: int
    current_epoch: int
    train_images: int
    val_images: int
    error_message: Optional[str] = None
    output_model_path: Optional[str] = None
    output_archive_path: Optional[str] = None
    convert_to_rknn: bool = False
    rknn_status: Optional[str] = None
    output_rknn_path: Optional[str] = None
    rknn_error: Optional[str] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime]
    latest_metrics: Optional[TrainingTaskMetrics] = None  # 实时指标，仅运行中任务有

    class Config:
        from_attributes = True
