"""
数据库模型定义
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM


class UserRole(str, enum.Enum):
    """用户角色"""
    SUPER_ADMIN = "super_admin"  # 超级管理员
    PROJECT_ADMIN = "project_admin"  # 项目管理员
    ANNOTATOR = "annotator"  # 标注者


class AnnotationType(str, enum.Enum):
    """标注类型"""
    DETECTION = "detection"  # 目标检测
    SEGMENTATION = "segmentation"  # 实例分割
    KEYPOINT = "keypoint"  # 关键点检测


class User(Base):
    """用户模型"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole, native_enum=False, length=50, values_callable=lambda obj: [e.value for e in obj]), default=UserRole.ANNOTATOR, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    projects = relationship("Project", back_populates="creator")
    annotations = relationship("Annotation", back_populates="annotator")
    assigned_tasks = relationship("Task", back_populates="annotator", foreign_keys="Task.annotator_id")


class Project(Base):
    """项目模型"""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text)
    annotation_type = Column(Enum(AnnotationType), nullable=False)  # 标注类型
    images_per_task = Column(Integer, nullable=True)  # 每个任务包的图片张数
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    creator = relationship("User", back_populates="projects")
    images = relationship("Image", back_populates="project", cascade="all, delete-orphan")
    project_users = relationship("ProjectUser", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    training_tasks = relationship("TrainingTask", back_populates="project", cascade="all, delete-orphan")


class ProjectUser(Base):
    """项目用户关联表（项目权限）"""
    __tablename__ = "project_users"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(Enum(UserRole, native_enum=False, length=50, values_callable=lambda obj: [e.value for e in obj]), default=UserRole.ANNOTATOR, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    project = relationship("Project", back_populates="project_users")
    user = relationship("User")


class Image(Base):
    """图片模型"""
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    width = Column(Integer)
    height = Column(Integer)
    file_size = Column(Integer)  # 文件大小（字节）
    is_annotated = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    project = relationship("Project", back_populates="images")
    annotations = relationship("Annotation", back_populates="image", cascade="all, delete-orphan")
    task_images = relationship("TaskImage", back_populates="image", cascade="all, delete-orphan")


class Category(Base):
    """类别模型（动态添加的类别）"""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    color = Column(String(7), default="#FF0000")  # 颜色代码，如#FF0000
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    project = relationship("Project")
    annotations = relationship("Annotation", back_populates="category")


class Annotation(Base):
    """标注模型"""
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    annotator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # YOLO格式数据：class_id x_center y_center width height (归一化坐标)
    # 存储为JSON格式：{"x_center": 0.5, "y_center": 0.5, "width": 0.2, "height": 0.2}
    bbox_data = Column(Text)  # JSON格式的边界框数据
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    image = relationship("Image", back_populates="annotations")
    category = relationship("Category", back_populates="annotations")
    annotator = relationship("User", back_populates="annotations")


class Model(Base):
    """AI模型模型"""
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)  # 所属项目（暂时允许NULL以兼容现有数据）
    name = Column(String(100), nullable=False, index=True)  # 模型名称
    filename = Column(String(255), nullable=False)  # 文件名
    filepath = Column(String(500), nullable=False)  # 文件路径
    file_size = Column(Integer)  # 文件大小（字节）
    model_type = Column(String(50), default="yolo11")  # 模型类型
    description = Column(Text)  # 描述
    class_names = Column(Text)  # JSON格式的类别名称列表
    is_default = Column(Boolean, default=False)  # 是否为默认模型（项目内）
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    project = relationship("Project")
    creator = relationship("User")


class PreAnnotationTask(Base):
    """预标注任务模型"""
    __tablename__ = "pre_annotation_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    task_id = Column(String(255), unique=True, index=True)  # Celery任务ID
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    progress = Column(Integer, default=0)  # 进度百分比 0-100
    total_images = Column(Integer, default=0)  # 总图片数
    processed_images = Column(Integer, default=0)  # 已处理图片数
    selected_classes = Column(Text)  # JSON格式的选中类别列表
    error_message = Column(Text)  # 错误信息
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    project = relationship("Project")
    model = relationship("Model")
    creator = relationship("User")


class TrainingTask(Base):
    """训练任务模型"""
    __tablename__ = "training_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    base_model = Column(String(100), nullable=False)  # yolo11n.pt / yolo11n-seg.pt 等
    task_id = Column(String(255), unique=True, index=True)  # Celery任务ID
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    progress = Column(Integer, default=0)  # 进度百分比 0-100
    epochs = Column(Integer, default=100)  # 总epoch数
    current_epoch = Column(Integer, default=0)  # 当前epoch
    train_images = Column(Integer, default=0)  # 训练集图片数
    val_images = Column(Integer, default=0)  # 验证集图片数
    error_message = Column(Text)  # 错误信息
    output_model_path = Column(String(500))  # 输出模型路径（完成后）
    output_archive_path = Column(String(500))  # 完整训练包 zip 路径（数据集+模型+训练曲线）
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    project = relationship("Project", back_populates="training_tasks")
    creator = relationship("User")


class Task(Base):
    """任务包模型"""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)  # 任务包名称
    annotator_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 分配的标注者（可为空，表示未分配）
    status = Column(String(50), default="pending")  # pending, in_progress, completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    project = relationship("Project", back_populates="tasks")
    annotator = relationship("User")
    task_images = relationship("TaskImage", back_populates="task", cascade="all, delete-orphan")


class TaskImage(Base):
    """任务包图片关联表"""
    __tablename__ = "task_images"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    image_id = Column(Integer, ForeignKey("images.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    task = relationship("Task", back_populates="task_images")
    image = relationship("Image", back_populates="task_images")
