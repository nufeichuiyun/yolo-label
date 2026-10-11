# 认证与 Redis 部署安全

运行模式由 `YOLO_LABEL_ENV` 指定，未设置时按 `production` 处理。只有显式 `development` 或 `test` 允许开发用 JWT 默认值和首次管理员 `admin123`。不认识或为空的模式值直接报错，不能用 `DEBUG` 绕过生产校验。

生产 JWT `SECRET_KEY` 必须是每个部署独立生成、至少 32 字符的随机密钥，不能使用仓库示例值。API 和两个 worker 共用同一值；worker 的启动校验只用标准库，不引入 Torch。校验失败不会打印密钥。

## 启动与升级

- `./manage.sh test deploy` 使用开发覆盖文件，三个后端服务都显式进入开发模式。仅用于可信测试环境。
- `./manage.sh prod deploy` 为生产生成随机 JWT 密钥；生成器对三个服务固定写入 `production`，不受宿主机开发模式影响。
- 直接使用基础 Compose 或离线部署时，先设置 `SECRET_KEY`。可用 `export SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"` 生成；不要把值粘贴到工单、聊天或 Git。必须妥善保存在本地密码管理器或权限受限、已被 Git 忽略的配置中，以便重建时继续使用。直接 Compose 支持 `.env`；离线部署脚本要求通过环境变量导出。
- 生产 `ADMIN_PASSWORD` 可显式设置（不可使用已知默认密码），否则首次初始化生成随机密码，不写标准输出或容器日志。只把初始密码写入后端 `/app/.initial_admin_password`，权限 `0600`，不覆盖同名文件。主机管理员可用 `docker exec yolo-label-backend cat /app/.initial_admin_password` 领取；在可信终端妥善保存后执行 `docker exec yolo-label-backend rm /app/.initial_admin_password`。请在容器重建前领取。若旧的未领取文件存在而数据库未创建成功，先人工核对并处理该文件，再重新初始化。
- 管理员已存在时初始化直接返回，**不会重置密码，也不要求重建数据库**。已有长随机 JWT 密钥继续可用；更换密钥会使现有登录令牌失效。已使用公开默认密钥或默认管理员密码的部署，应在维护窗口更换。

本次代码更新**不会修改已生成的 `docker-compose.prod.yml` 或正在运行的容器**。已有生产安装应在维护窗口确认 `.env.prod` 中保留有效随机密钥，运行保留数据的 `./manage.sh prod redeploy`，重新生成 Compose 并重建服务。不要选择清除数据选项；仅 `restart` 不能代替重新生成配置。升级后核验实际 Compose 配置和容器端口映射。

## Redis 网络边界

基础、开发和生产生成配置都不再向宿主机发布 Redis 端口。应用继续通过 Compose 私有网络的 `redis:6379` 通信；宿主机占用 6379 不会冲突，不再有 `REDIS_PORT` 配置或端口选择。旧 `.env.prod` 中遗留的 `REDIS_PORT` 会被忽略。

需要临时检查 Redis 时使用 `docker exec yolo-label-redis redis-cli ping`，不要为日常运行重新暴露无认证的 Redis。数据库和业务 HTTP 端口的现有配置不由此次修复改变。

## 本地回归检查

可在独立虚拟环境安装 `backend/requirements-test.txt`，运行 `python -m unittest discover -s backend/tests -v`。安全配置与初始化测试使用临时 SQLite/临时目录；部署测试只生成临时 Compose 文件，并用假的 Docker 命令核验离线入口会在容器操作前拒绝无效密钥。它们不部署服务，也不证明已有生产容器已经完成升级。

## 图片权限与模型信任

原图通过带 Bearer 凭据的 `/api/images/{id}/content` 读取，标注者只能访问自己任务中的图片；不再提供匿名 `/uploads` 静态路径。整项目导出、包含数据集的训练归档和整项目预标注要求项目管理权限。预标注必须使用同项目模型。前后端应一起升级，否则旧前端的图片地址会返回 404；自定义客户端也需改用认证接口，不能把登录令牌放在 URL 中。

模型上传只允许可信超级管理员，上传文件使用项目目录和服务器生成的唯一名称，避免覆盖其他项目或预置权重。新上传位于 `models/uploads/`，已排除 Git；已有模型文件和数据库路径保持兼容，不会自动移动或删除。

PT 模型加载仍在应用进程执行，本次没有实现反序列化沙箱。超级管理员必须核验来源，只上传可信模型；升级前普通成员已上传的模型也应由管理员核验来源，代码更新不会自动证明旧文件可信。普通成员仍可使用已授权项目中的可信模型。

首次管理员凭据、环境文件和私有运行目录也已通过 `backend/.dockerignore` 排除构建上下文，避免随 `COPY . .` 进入后端镜像。以前已经构建或分发过的镜像不因这一规则自动清理。
