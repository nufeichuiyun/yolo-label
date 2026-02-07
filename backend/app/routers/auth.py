"""
认证相关路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, Token, UserResponse, UserCreate
from app.auth import verify_password, get_password_hash, create_access_token, get_current_user, require_super_admin
from datetime import timedelta

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login", response_model=Token)
async def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """用户登录"""
    try:
        user = db.query(User).filter(User.username == login_data.username).first()
        if not user or not verify_password(login_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not user.is_active:
            raise HTTPException(status_code=400, detail="用户已被禁用")
        
        # 兼容旧的角色值：如果角色是 'admin'，自动更新为 'super_admin'
        try:
            role_value = user.role.value if hasattr(user.role, 'value') else str(user.role)
            if role_value == 'admin':
                from app.models import UserRole
                user.role = UserRole.SUPER_ADMIN
                db.commit()
                db.refresh(user)
        except Exception:
            # 如果角色值无法读取，尝试直接更新数据库
            try:
                from app.models import UserRole
                from sqlalchemy import text
                db.execute(text("UPDATE users SET role = 'super_admin' WHERE id = :user_id"), {"user_id": user.id})
                db.commit()
                db.refresh(user)
            except Exception:
                pass  # 如果更新失败，继续执行
        
        access_token_expires = timedelta(minutes=3 * 24 * 60)  # 3天
        access_token = create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        return {"access_token": access_token, "token_type": "bearer"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"登录失败: {str(e)}")


@router.post("/register", response_model=UserResponse)
async def register(
    user_data: UserCreate,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """创建用户（仅超级管理员可创建）"""
    # 检查用户名是否已存在
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    
    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")
    
    # 创建新用户
    hashed_password = get_password_hash(user_data.password)
    db_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hashed_password,
        role=user_data.role
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    try:
        # 兼容旧的角色值：如果角色是 'admin'，自动更新为 'super_admin'
        try:
            role_value = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
            if role_value == 'admin':
                from app.models import UserRole
                from app.database import SessionLocal
                db = SessionLocal()
                try:
                    db_user = db.query(User).filter(User.id == current_user.id).first()
                    if db_user:
                        db_user.role = UserRole.SUPER_ADMIN
                        db.commit()
                        db.refresh(db_user)
                        current_user = db_user
                finally:
                    db.close()
        except Exception:
            # 如果无法读取角色值，尝试直接更新数据库
            try:
                from app.database import SessionLocal
                from sqlalchemy import text
                db = SessionLocal()
                try:
                    db.execute(text("UPDATE users SET role = 'super_admin' WHERE id = :user_id"), {"user_id": current_user.id})
                    db.commit()
                    db.refresh(current_user)
                finally:
                    db.close()
            except Exception:
                pass  # 如果更新失败，继续执行
        
        return current_user
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取用户信息失败: {str(e)}")
