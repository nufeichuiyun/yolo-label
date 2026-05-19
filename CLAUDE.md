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
- `backend/app/models.py` — SQLAlchemy models (users, projects, images, annotations, categories, models, tasks, etc.)
- `backend/app/schemas.py` — Pydantic request/response schemas
- `backend/app/database.py` — PostgreSQL connection config
- `backend/alembic/` — Database migrations

### Key Frontend Structure
- `frontend/src/pages/Annotation/` — Core annotation editor (Fabric.js canvas), split into index.tsx + utils/
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
./manage.sh prod deploy

# Other manage.sh commands
./manage.sh test deploy       # Test environment with defaults + hot reload
./manage.sh prod redeploy     # Redeploy with existing config
./manage.sh prod restart      # Restart services
./manage.sh status            # View service status
./manage.sh logs [service]    # View logs
./manage.sh offline package   # Package for offline deployment
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite dev server (port 3000, proxies /api and /uploads to :8000)
npm run build        # tsc && vite build
npm run test         # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
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

## Testing

Frontend has Vitest tests for annotation utility functions in `frontend/src/pages/Annotation/utils/__tests__/`. No backend tests exist. No linting or formatting configuration is set up.

## Conventions

- **Git commits must be in Chinese.** Format: `动词 + 对象 + 说明` (e.g., `优化项目详情界面的布局`). Keep messages concise and focus on the *purpose* of the change rather than enumerating each modified file or line. Unrelated changes should be separate commits.
- YOLO annotation format: detection `class_id x_center y_center width height` (normalized), segmentation polygon vertices (normalized).
- Frontend uses Chinese locale (zhCN from Ant Design).
