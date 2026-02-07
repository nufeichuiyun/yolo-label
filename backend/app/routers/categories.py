"""
类别管理路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import User, Category, Project, UserRole
from app.schemas import CategoryCreate, CategoryResponse
from app.auth import get_current_user
from app.routers.projects import check_project_permission

router = APIRouter(prefix="/api/categories", tags=["类别"])


@router.post("", response_model=CategoryResponse)
async def create_category(
    category_data: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建类别（仅项目管理员或超级管理员）"""
    # 检查项目权限，要求项目管理员权限
    check_project_permission(category_data.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    # 检查类别名是否已存在
    existing = db.query(Category).filter(
        Category.project_id == category_data.project_id,
        Category.name == category_data.name
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="类别名已存在")
    
    db_category = Category(
        project_id=category_data.project_id,
        name=category_data.name,
        color=category_data.color
    )
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


@router.get("/project/{project_id}", response_model=List[CategoryResponse])
async def list_project_categories(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的类别列表"""
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    categories = db.query(Category).filter(Category.project_id == project_id).all()
    return categories


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    category_data: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新类别（仅项目管理员或超级管理员）"""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="类别不存在")
    
    # 检查项目权限，要求项目管理员权限
    check_project_permission(category.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    # 检查类别名是否已存在（排除自己）
    existing = db.query(Category).filter(
        Category.project_id == category.project_id,
        Category.name == category_data.name,
        Category.id != category_id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="类别名已存在")
    
    # 只更新name和color，忽略project_id
    category.name = category_data.name
    category.color = category_data.color if category_data.color else "#FF0000"
    
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}")
async def delete_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除类别（仅项目管理员或超级管理员）"""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="类别不存在")
    
    # 检查项目权限，要求项目管理员权限
    check_project_permission(category.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    db.delete(category)
    db.commit()
    return {"message": "类别已删除"}
