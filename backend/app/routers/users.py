"""
用户管理路由（仅超级管理员）
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import User, UserRole
from app.schemas import UserResponse, UserCreate, UserListResponse
from app.auth import require_super_admin

router = APIRouter(prefix="/api/users", tags=["用户管理"])


@router.get("", response_model=UserListResponse)
async def list_users(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """获取用户列表（仅超级管理员）"""
    total = db.query(User).count()
    users = db.query(User).offset(skip).limit(limit).all()
    return {"items": users, "total": total}


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """获取用户详情（仅超级管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """删除用户（仅超级管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 不能删除自己
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    db.delete(user)
    db.commit()
    return {"message": "用户已删除"}
