# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YOLO-Label is a web-based YOLO annotation and training platform. It supports object detection and instance segmentation with AI pre-annotation, model training, and team collaboration features. The UI is in Chinese.

## Architecture

- **Frontend** (`frontend/`): React 18 + TypeScript + Ant Design + Vite. Canvas annotation via Fabric.js.
- **Backend** (`backend/`): FastAPI + SQLAlchemy 2.0 + PostgreSQL 15. JWT auth (3-day expiry).
- **Task Queue**: Celery + Redis for training and pre-annotation jobs. Solo pool mode to avoid CUDA fork issues.
- **Deployment**: Docker Compose with 5 services (db, redis, backend, celery-worker, frontend). GPU support via `docker-compose.gpu.yml`.

### Key Backend Structure
- `backend/app/routers/` — 13 API route files under `/api/` prefix
- `backend/app/services/` — YOLO inference, dataset preparation, training archive
- `backend/app/tasks/` — Celery tasks for training and pre-annotation
- `backend/app/models.py` — SQLAlchemy models (10 tables: users, projects, images, annotations, categories, models, tasks, etc.)
- `backend/app/schemas.py` — Pydantic request/response schemas
- `backend/app/database.py` — PostgreSQL connection config
- `backend/alembic/` — Database migrations

### Key Frontend Structure
- `frontend/src/pages/Annotation.tsx` — Core annotation editor (~5700 lines, Fabric.js canvas)
- `frontend/src/pages/` — Page components (Projects, ProjectDetail, Tasks, Models, Users, Login)
- `frontend/src/api/` — Axios API client modules
- `frontend/src/contexts/` — React context (Auth)

### Data Flow
- Images stored in `/app/uploads/`, annotations in YOLO `.txt` format in `/app/annotations/{project_id}/`
- Training: Celery prepares dataset (train/val split) → runs `ultralytics.YOLO.train()` → saves to `/app/training_output/`
- Pre-annotation: Celery runs YOLO inference batch-wise → saves results as annotations
- Progress tracking via Redis polling

### Permission Model
Three roles: `super_admin` > `project_admin` > `annotator`. Projects have per-user membership.

## Common Commands

### Development (Docker)
```bash
# Start all services (dev mode with hot reload)
docker compose up

# Start with GPU support
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up

# Production deployment (interactive)
bash manage.sh
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite dev server (port 3000, proxies /api and /uploads to :8000)
npm run build        # tsc && vite build
```

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Celery worker
celery -A app.celery_app worker --loglevel=info --pool=solo

# Database migrations
alembic upgrade head
alembic revision --autogenerate -m "description"
```

## Conventions

- **Git commits must be in Chinese.** Format: `动词 + 对象 + 说明` (e.g., `优化项目详情界面的布局`). Unrelated changes should be separate commits.
- YOLO annotation format: detection `class_id x_center y_center width height` (normalized), segmentation polygon vertices (normalized).
- Frontend uses Chinese locale (zhCN from Ant Design).
- No automated test suite exists.
