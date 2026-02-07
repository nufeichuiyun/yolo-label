#!/bin/bash
# ============================================================================
# yolo-label 生产环境一键部署脚本
# ============================================================================
# 功能：
#   1. 自动检测并安装 Docker / Docker Compose
#   2. 检测 GPU 并可选安装 NVIDIA Container Toolkit
#   3. 交互式设置密码和密钥
#   4. 自动检测端口占用，交互式选择端口
#   5. 生成生产环境配置并部署
#   6. 部署后健康检查和总结
#   7. 支持重新部署（可选清理旧数据）
# ============================================================================

set -euo pipefail

# ======================== 颜色和格式 ========================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ======================== 全局变量 ========================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.prod"
DEPLOY_RECORD="$SCRIPT_DIR/.deploy_record"

# 默认值
DEFAULT_FRONTEND_PORT=3000
DEFAULT_BACKEND_PORT=8000
DEFAULT_DB_PORT=5432
DEFAULT_REDIS_PORT=6379

# 用户配置（在交互中填充）
ENABLE_GPU=false
POSTGRES_USER="yolo_label"
POSTGRES_PASSWORD=""
POSTGRES_DB="yolo_label_db"
SECRET_KEY=""
ADMIN_PASSWORD=""
FRONTEND_PORT=""
BACKEND_PORT=""
DB_PORT=""
REDIS_PORT=""

# ======================== 工具函数 ========================
print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}${BOLD}║                                                          ║${NC}"
    echo -e "${CYAN}${BOLD}║          yolo-label 生产环境一键部署脚本                 ║${NC}"
    echo -e "${CYAN}${BOLD}║          YOLO 图像标注平台                               ║${NC}"
    echo -e "${CYAN}${BOLD}║                                                          ║${NC}"
    echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}${BOLD}  [$1] $2${NC}"
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() { echo -e "  ${GREEN}✔${NC} $1"; }
print_error()   { echo -e "  ${RED}✘${NC} $1"; }
print_warning() { echo -e "  ${YELLOW}⚠${NC} $1"; }
print_info()    { echo -e "  ${CYAN}ℹ${NC} $1"; }

# 用户确认（默认 Y）
confirm_yes() {
    local prompt="$1"
    local answer
    read -r -p "$(echo -e "  ${YELLOW}?${NC} ${prompt} [Y/n]: ")" answer
    answer="${answer:-Y}"
    [[ "$answer" =~ ^[Yy]$ ]]
}

# 用户确认（默认 N）
confirm_no() {
    local prompt="$1"
    local answer
    read -r -p "$(echo -e "  ${YELLOW}?${NC} ${prompt} [y/N]: ")" answer
    answer="${answer:-N}"
    [[ "$answer" =~ ^[Yy]$ ]]
}

# 读取用户输入（带默认值）
read_input() {
    local prompt="$1"
    local default="$2"
    local value
    read -r -p "$(echo -e "  ${YELLOW}?${NC} ${prompt} [${DIM}默认: ${default}${NC}]: ")" value
    echo "${value:-$default}"
}

# 读取密码输入（不回显）
# 注意：此函数通过 $() 调用，stdout 会被捕获为返回值，
# 因此所有中间输出（换行、提示）必须重定向到 stderr
read_password() {
    local prompt="$1"
    local value
    while true; do
        read -r -s -p "$(echo -e "  ${YELLOW}?${NC} ${prompt}: ")" value
        echo "" >&2
        if [ ${#value} -lt 6 ]; then
            echo -e "  ${YELLOW}⚠${NC} 密码长度至少 6 位，请重新输入" >&2
            continue
        fi
        local confirm_value
        read -r -s -p "$(echo -e "  ${YELLOW}?${NC} 再次输入确认: ")" confirm_value
        echo "" >&2
        if [ "$value" != "$confirm_value" ]; then
            echo -e "  ${YELLOW}⚠${NC} 两次输入不一致，请重新输入" >&2
            continue
        fi
        break
    done
    echo "$value"
}

# 生成随机密钥
generate_secret() {
    local length="${1:-48}"
    # 尝试多种方式生成随机字符串
    if command -v openssl &>/dev/null; then
        openssl rand -base64 "$length" | tr -d '\n/+=' | head -c "$length"
    elif [ -f /dev/urandom ]; then
        head -c "$length" /dev/urandom | base64 | tr -d '\n/+=' | head -c "$length"
    else
        date +%s%N | sha256sum | head -c "$length"
    fi
}

# 检查端口是否被占用
is_port_in_use() {
    local port="$1"
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0
    elif command -v netstat &>/dev/null; then
        netstat -tlnp 2>/dev/null | grep -q ":${port} " && return 0
    elif command -v lsof &>/dev/null; then
        lsof -i ":${port}" &>/dev/null && return 0
    fi
    return 1
}

# 查找可用端口（从指定端口开始查找）
find_available_port() {
    local port="$1"
    local max_port=$((port + 100))
    while [ "$port" -le "$max_port" ]; do
        if ! is_port_in_use "$port"; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done
    echo "$1"  # 回退到原始端口
    return 1
}

# 等待并显示进度
wait_with_message() {
    local seconds="$1"
    local message="$2"
    for ((i=1; i<=seconds; i++)); do
        printf "\r  ${CYAN}⏳${NC} ${message} (%d/%d秒)..." "$i" "$seconds"
        sleep 1
    done
    printf "\r  ${CYAN}⏳${NC} ${message} ... 完成              \n"
}

# 停止并删除所有 yolo-label 容器（不删除 volumes）
cleanup_containers() {
    # 先尝试 docker-compose down（覆盖所有可能的 compose 文件）
    if [ -f "$COMPOSE_FILE" ]; then
        docker-compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    fi
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

    # 然后按容器名强制停止和删除（确保万无一失）
    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        print_info "强制停止残留容器..."
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi

    # 等待端口完全释放
    sleep 3
}

# 停止并删除所有 yolo-label 容器 + volumes（完全清除数据）
cleanup_all() {
    # 先尝试 docker-compose down -v（覆盖所有可能的 compose 文件）
    if [ -f "$COMPOSE_FILE" ]; then
        docker-compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    fi
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" down -v 2>/dev/null || true

    # 按容器名强制停止和删除
    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        print_info "强制停止残留容器..."
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi

    # 删除关联的 Docker volumes
    local volumes
    volumes=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E "(yolo-label|afa-label)" || true)
    if [ -n "$volumes" ]; then
        print_info "删除数据卷..."
        echo "$volumes" | xargs -r docker volume rm -f 2>/dev/null || true
    fi

    # 清理旧配置文件
    rm -f "$COMPOSE_FILE" "$ENV_FILE" "$DEPLOY_RECORD"

    # 等待端口完全释放
    sleep 3
}

# ======================== 步骤 0：检查已有部署 ========================
step_check_existing() {
    print_step "0/7" "检查已有部署"

    local has_existing=false

    # 检查是否有 yolo-label 容器（运行中或已停止）
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "yolo-label"; then
        has_existing=true
        print_warning "检测到已有的 yolo-label 容器："
        echo ""
        docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
        echo ""
    fi

    # 检查已有的 prod 配置
    if [ -f "$COMPOSE_FILE" ]; then
        has_existing=true
        print_warning "检测到已有的生产环境配置文件"
    fi

    if [ "$has_existing" = true ]; then
        echo ""
        echo -e "  ${BOLD}请选择操作：${NC}"
        echo -e "    ${CYAN}1)${NC} 保留数据，重新部署（更新代码/配置）"
        echo -e "    ${CYAN}2)${NC} 完全清除，全新部署（${RED}删除所有数据${NC}）"
        echo -e "    ${CYAN}3)${NC} 退出"
        echo ""
        local choice
        read -r -p "$(echo -e "  ${YELLOW}?${NC} 请输入选项 [1/2/3]: ")" choice

        case "$choice" in
            1)
                print_info "正在停止旧服务（保留数据）..."
                cleanup_containers
                print_success "旧服务已停止，数据已保留，端口已释放"
                ;;
            2)
                echo ""
                print_warning "${RED}${BOLD}此操作将删除所有数据（数据库、图片、标注、模型）！${NC}"
                if confirm_no "确定要删除所有数据吗？此操作不可恢复"; then
                    print_info "正在清除旧部署..."
                    cleanup_all
                    print_success "旧部署已完全清除（容器、数据卷、配置文件），端口已释放"
                else
                    print_info "已取消删除，将保留数据重新部署..."
                    cleanup_containers
                    print_success "旧服务已停止，数据已保留，端口已释放"
                fi
                ;;
            3)
                print_info "退出部署"
                exit 0
                ;;
            *)
                print_error "无效选项，退出"
                exit 1
                ;;
        esac

        # 验证清理结果
        local remaining
        remaining=$(docker ps --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
        if [ -n "$remaining" ]; then
            print_error "以下容器未能停止，请手动处理后重试："
            echo "$remaining" | while read -r name; do echo "    - $name"; done
            exit 1
        fi
    else
        print_success "未检测到已有部署，将执行全新部署"
    fi
}

# ======================== 步骤 1：检测/安装 Docker ========================
step_install_docker() {
    print_step "1/7" "检测 Docker 环境"

    # 检查 Docker
    if command -v docker &>/dev/null; then
        local docker_version
        docker_version=$(docker --version 2>/dev/null | grep -oP 'Docker version \K[0-9.]+' || echo "未知")
        print_success "Docker 已安装 (版本: ${docker_version})"

        # 检查 Docker 服务是否在运行
        if ! docker info &>/dev/null; then
            print_warning "Docker 服务未运行，尝试启动..."
            sudo systemctl start docker 2>/dev/null || true
            sleep 2
            if docker info &>/dev/null; then
                print_success "Docker 服务已启动"
            else
                print_error "无法启动 Docker 服务"
                print_info "请手动运行: sudo systemctl start docker"
                exit 1
            fi
        fi
    else
        print_warning "未检测到 Docker"
        if confirm_yes "是否自动安装 Docker？"; then
            print_info "正在安装 Docker..."
            curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
            sudo sh /tmp/get-docker.sh
            rm -f /tmp/get-docker.sh

            # 将当前用户加入 docker 组
            sudo usermod -aG docker "$USER" 2>/dev/null || true

            # 启动 Docker
            sudo systemctl enable docker
            sudo systemctl start docker

            # 验证安装
            if command -v docker &>/dev/null && docker info &>/dev/null; then
                print_success "Docker 安装成功"
            else
                print_warning "Docker 已安装，但可能需要重新登录以应用用户组权限"
                print_info "如果后续步骤失败，请运行: newgrp docker 或重新登录后再次运行此脚本"
            fi
        else
            print_error "Docker 是必需的，退出部署"
            exit 1
        fi
    fi

    # 检查 Docker Compose
    if command -v docker-compose &>/dev/null; then
        local compose_version
        compose_version=$(docker-compose --version 2>/dev/null | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "未知")
        print_success "Docker Compose 已安装 (版本: ${compose_version})"
    elif docker compose version &>/dev/null 2>&1; then
        # Docker Compose V2 (作为 docker 子命令)
        print_success "Docker Compose V2 已安装"
        print_info "检测到 Compose V2，将创建兼容别名..."
        # 创建别名让 docker-compose 命令也能工作
        if [ ! -f /usr/local/bin/docker-compose ]; then
            sudo bash -c 'cat > /usr/local/bin/docker-compose << "SCRIPT"
#!/bin/bash
docker compose "$@"
SCRIPT'
            sudo chmod +x /usr/local/bin/docker-compose
            print_success "已创建 docker-compose 兼容命令"
        fi
    else
        print_warning "未检测到 Docker Compose"
        if confirm_yes "是否自动安装 Docker Compose？"; then
            print_info "正在安装 Docker Compose..."
            local arch
            arch=$(uname -m)
            # 优先安装 Docker Compose V2 插件
            sudo mkdir -p /usr/local/lib/docker/cli-plugins
            sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
                -o /usr/local/lib/docker/cli-plugins/docker-compose
            sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

            # 创建兼容命令
            sudo bash -c 'cat > /usr/local/bin/docker-compose << "SCRIPT"
#!/bin/bash
docker compose "$@"
SCRIPT'
            sudo chmod +x /usr/local/bin/docker-compose

            if docker-compose version &>/dev/null; then
                print_success "Docker Compose 安装成功"
            else
                print_error "Docker Compose 安装失败"
                exit 1
            fi
        else
            print_error "Docker Compose 是必需的，退出部署"
            exit 1
        fi
    fi
}

# ======================== 步骤 2：检测 GPU ========================
step_detect_gpu() {
    print_step "2/7" "检测 GPU 环境"

    local gpu_detected=false
    local toolkit_installed=false

    # 检测 NVIDIA GPU
    if command -v nvidia-smi &>/dev/null; then
        local gpu_info
        gpu_info=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
        if [ -n "$gpu_info" ]; then
            gpu_detected=true
            print_success "检测到 NVIDIA GPU: ${gpu_info}"

            # 检查 NVIDIA Container Toolkit
            if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &>/dev/null 2>&1; then
                toolkit_installed=true
                print_success "NVIDIA Container Toolkit 已安装且可用"
            fi
        fi
    fi

    if [ "$gpu_detected" = false ]; then
        print_info "未检测到 NVIDIA GPU（系统将使用 CPU 模式）"
        print_info "CPU 模式功能完整，仅 AI 预标注推理速度较慢"
        ENABLE_GPU=false
        return
    fi

    # GPU 存在，询问用户
    echo ""
    if confirm_yes "是否启用 GPU 加速（用于 AI 辅助标注）？"; then
        ENABLE_GPU=true

        if [ "$toolkit_installed" = false ]; then
            print_warning "NVIDIA Container Toolkit 未安装"
            if confirm_yes "是否自动安装 NVIDIA Container Toolkit？"; then
                print_info "正在安装 NVIDIA Container Toolkit..."

                # 获取发行版信息
                local distribution
                distribution=$(. /etc/os-release; echo "${ID}${VERSION_ID}")

                # 添加仓库
                curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
                    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true

                curl -s -L "https://nvidia.github.io/libnvidia-container/${distribution}/libnvidia-container.list" \
                    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
                    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null

                sudo apt-get update -qq
                sudo apt-get install -y -qq nvidia-container-toolkit

                # 配置 Docker runtime
                sudo nvidia-ctk runtime configure --runtime=docker
                sudo systemctl restart docker

                # 验证
                sleep 2
                if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &>/dev/null 2>&1; then
                    print_success "NVIDIA Container Toolkit 安装成功"
                else
                    print_warning "NVIDIA Container Toolkit 安装可能未完全生效"
                    print_info "如果 GPU 功能不工作，请重启系统后重新运行部署脚本"
                fi
            else
                print_warning "跳过安装 NVIDIA Container Toolkit，GPU 加速可能不可用"
                print_info "你可以稍后手动安装，参考: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/"
            fi
        fi

        print_success "GPU 加速已启用"
    else
        ENABLE_GPU=false
        print_info "已跳过 GPU 加速，将使用 CPU 模式"
    fi
}

# ======================== 步骤 3：配置密码 ========================
step_configure_passwords() {
    print_step "3/7" "配置密码和密钥"

    echo -e "  ${BOLD}请设置以下安全信息（所有密码请妥善保管）：${NC}"
    echo ""

    # 1. 数据库密码
    echo -e "  ${CYAN}[1/3] 数据库密码${NC}"
    echo -e "  ${DIM}用于 PostgreSQL 数据库连接，建议使用强密码${NC}"
    POSTGRES_PASSWORD=$(read_password "请输入数据库密码（至少6位）")
    print_success "数据库密码已设置"
    echo ""

    # 2. 管理员密码
    echo -e "  ${CYAN}[2/3] 系统管理员密码${NC}"
    echo -e "  ${DIM}用于登录 yolo-label 系统的 admin 账号${NC}"
    ADMIN_PASSWORD=$(read_password "请输入管理员密码（至少6位）")
    print_success "管理员密码已设置"
    echo ""

    # 3. JWT 密钥（自动生成）
    echo -e "  ${CYAN}[3/3] JWT 安全密钥${NC}"
    SECRET_KEY=$(generate_secret 48)
    print_success "JWT 密钥已自动生成（48位随机字符串）"

    # 显示保存提醒
    echo ""
    echo -e "  ${YELLOW}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${YELLOW}${BOLD}║  重要提醒：请立即保存以下信息到安全的地方！        ║${NC}"
    echo -e "  ${YELLOW}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}数据库用户名：${NC}${POSTGRES_USER}"
    echo -e "  ${BOLD}数据库密码：  ${NC}${POSTGRES_PASSWORD}"
    echo -e "  ${BOLD}数据库名称：  ${NC}${POSTGRES_DB}"
    echo -e "  ${BOLD}管理员用户名：${NC}admin"
    echo -e "  ${BOLD}管理员密码：  ${NC}${ADMIN_PASSWORD}"
    echo -e "  ${BOLD}JWT 密钥：    ${NC}${SECRET_KEY}"
    echo ""

    # 同时保存到文件（仅限部署者查看）
    local cred_file="$SCRIPT_DIR/.credentials"
    cat > "$cred_file" << EOF
# yolo-label 部署凭据（请妥善保管，建议保存后删除此文件）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

数据库用户名: ${POSTGRES_USER}
数据库密码:   ${POSTGRES_PASSWORD}
数据库名称:   ${POSTGRES_DB}
管理员用户名: admin
管理员密码:   ${ADMIN_PASSWORD}
JWT 密钥:     ${SECRET_KEY}
EOF
    chmod 600 "$cred_file"
    print_info "凭据已保存到 .credentials 文件（权限 600，仅当前用户可读）"
    print_warning "建议保存信息后删除该文件: rm ${cred_file}"

    echo ""
    read -r -p "$(echo -e "  ${YELLOW}?${NC} 已保存好以上信息？按 Enter 继续...")"
}

# ======================== 步骤 4：配置端口 ========================
step_configure_ports() {
    print_step "4/7" "配置服务端口"

    echo -e "  ${BOLD}检测端口占用情况：${NC}"
    echo ""

    # 检查各端口
    local ports=("$DEFAULT_FRONTEND_PORT:前端界面" "$DEFAULT_BACKEND_PORT:后端API" "$DEFAULT_DB_PORT:数据库" "$DEFAULT_REDIS_PORT:Redis")

    for item in "${ports[@]}"; do
        local port="${item%%:*}"
        local desc="${item##*:}"
        if is_port_in_use "$port"; then
            print_warning "端口 ${port} (${desc}) 已被占用"
        else
            print_success "端口 ${port} (${desc}) 可用"
        fi
    done

    echo ""

    if confirm_yes "是否使用默认端口配置？（如有端口被占用，建议选否自定义）"; then
        FRONTEND_PORT=$DEFAULT_FRONTEND_PORT
        BACKEND_PORT=$DEFAULT_BACKEND_PORT
        DB_PORT=$DEFAULT_DB_PORT
        REDIS_PORT=$DEFAULT_REDIS_PORT
    else
        echo ""
        echo -e "  ${BOLD}请为每个服务指定端口（直接回车使用推荐端口）：${NC}"
        echo ""

        # 前端端口
        local rec_frontend
        rec_frontend=$(find_available_port $DEFAULT_FRONTEND_PORT)
        FRONTEND_PORT=$(read_input "前端界面端口" "$rec_frontend")
        if is_port_in_use "$FRONTEND_PORT"; then
            print_warning "端口 ${FRONTEND_PORT} 已被占用，服务启动后可能冲突"
        fi

        # 后端端口
        local rec_backend
        rec_backend=$(find_available_port $DEFAULT_BACKEND_PORT)
        BACKEND_PORT=$(read_input "后端 API 端口" "$rec_backend")
        if is_port_in_use "$BACKEND_PORT"; then
            print_warning "端口 ${BACKEND_PORT} 已被占用，服务启动后可能冲突"
        fi

        # 数据库端口
        local rec_db
        rec_db=$(find_available_port $DEFAULT_DB_PORT)
        DB_PORT=$(read_input "数据库端口" "$rec_db")
        if is_port_in_use "$DB_PORT"; then
            print_warning "端口 ${DB_PORT} 已被占用，服务启动后可能冲突"
        fi

        # Redis 端口
        local rec_redis
        rec_redis=$(find_available_port $DEFAULT_REDIS_PORT)
        REDIS_PORT=$(read_input "Redis 端口" "$rec_redis")
        if is_port_in_use "$REDIS_PORT"; then
            print_warning "端口 ${REDIS_PORT} 已被占用，服务启动后可能冲突"
        fi
    fi

    echo ""
    echo -e "  ${BOLD}端口配置：${NC}"
    echo -e "    前端界面  → ${CYAN}${FRONTEND_PORT}${NC}"
    echo -e "    后端 API  → ${CYAN}${BACKEND_PORT}${NC}"
    echo -e "    数据库    → ${CYAN}${DB_PORT}${NC}"
    echo -e "    Redis     → ${CYAN}${REDIS_PORT}${NC}"
}

# ======================== 步骤 5：生成配置并构建部署 ========================
step_generate_and_deploy() {
    print_step "5/7" "生成配置并构建部署"

    # ---------- 生成 .env.prod ----------
    print_info "生成环境变量配置..."
    cat > "$ENV_FILE" << EOF
# yolo-label 生产环境配置（自动生成，请勿手动修改）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
SECRET_KEY=${SECRET_KEY}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
DB_PORT=${DB_PORT}
REDIS_PORT=${REDIS_PORT}

ENABLE_GPU=${ENABLE_GPU}
EOF
    chmod 600 "$ENV_FILE"
    print_success "环境配置已生成: .env.prod"

    # ---------- 生成 docker-compose.prod.yml ----------
    print_info "生成 Docker Compose 生产配置..."

    # GPU 部分（条件性生成）
    local gpu_env_section=""
    local gpu_deploy_section=""
    if [ "$ENABLE_GPU" = true ]; then
        gpu_env_section="      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility"
        gpu_deploy_section="    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]"
    fi

    cat > "$COMPOSE_FILE" << COMPOSEFILE
# yolo-label 生产环境配置（自动生成）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# GPU 加速: ${ENABLE_GPU}
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: yolo-label-db
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "${DB_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: yolo-label-redis
    restart: always
    ports:
      - "${REDIS_PORT}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: yolo-label-backend
    restart: always
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379/0
      - SECRET_KEY=${SECRET_KEY}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - UPLOAD_DIR=/app/uploads
      - ANNOTATION_DIR=/app/annotations
      - MODEL_DIR=/app/models
      - QT_QPA_PLATFORM=offscreen
      - DISPLAY=
    volumes:
      - uploads_data:/app/uploads
      - annotations_data:/app/annotations
      - models_data:/app/models
    ports:
      - "${BACKEND_PORT}:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 300 --timeout-graceful-shutdown 300

  celery-worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: yolo-label-celery-worker
    restart: always
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379/0
      - UPLOAD_DIR=/app/uploads
      - ANNOTATION_DIR=/app/annotations
      - MODEL_DIR=/app/models
      - QT_QPA_PLATFORM=offscreen
      - DISPLAY=
${gpu_env_section}
    volumes:
      - uploads_data:/app/uploads
      - annotations_data:/app/annotations
      - models_data:/app/models
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
${gpu_deploy_section}
    command: celery -A app.celery_app worker --loglevel=info --pool=solo --concurrency=1

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: yolo-label-frontend
    restart: always
    ports:
      - "${FRONTEND_PORT}:3000"
    depends_on:
      backend:
        condition: service_started
    command: npm start

volumes:
  postgres_data:
  uploads_data:
  annotations_data:
  models_data:
COMPOSEFILE

    print_success "Docker Compose 配置已生成: docker-compose.prod.yml"

    # ---------- 构建镜像 ----------
    echo ""
    print_info "开始构建 Docker 镜像（首次构建可能需要 10-30 分钟）..."
    echo ""

    if ! docker-compose -f "$COMPOSE_FILE" build; then
        print_error "镜像构建失败！"
        print_info "请检查网络连接和磁盘空间，然后重新运行脚本"
        exit 1
    fi
    print_success "Docker 镜像构建完成"

    # ---------- 启动服务 ----------
    echo ""
    print_info "启动所有服务..."

    if ! docker-compose -f "$COMPOSE_FILE" up -d; then
        print_error "服务启动失败！"
        print_info "查看详细日志: docker-compose -f docker-compose.prod.yml logs"
        exit 1
    fi
    print_success "所有服务已启动"
}

# ======================== 步骤 6：初始化数据库 ========================
step_init_database() {
    print_step "6/7" "初始化数据库"

    print_info "等待数据库服务就绪..."

    # 等待数据库健康
    local max_wait=60
    local waited=0
    while [ $waited -lt $max_wait ]; do
        local db_status
        db_status=$(docker inspect --format='{{.State.Health.Status}}' yolo-label-db 2>/dev/null || echo "unknown")
        if [ "$db_status" = "healthy" ]; then
            break
        fi
        printf "\r  ${CYAN}⏳${NC} 等待数据库启动... (%d/%d秒)" "$waited" "$max_wait"
        sleep 2
        waited=$((waited + 2))
    done
    echo ""

    if [ $waited -ge $max_wait ]; then
        print_warning "数据库启动超时，尝试继续初始化..."
    else
        print_success "数据库已就绪"
    fi

    # 等待后端服务就绪
    print_info "等待后端服务就绪..."
    waited=0
    max_wait=60
    while [ $waited -lt $max_wait ]; do
        if docker exec yolo-label-backend python -c "print('ok')" &>/dev/null; then
            break
        fi
        printf "\r  ${CYAN}⏳${NC} 等待后端服务启动... (%d/%d秒)" "$waited" "$max_wait"
        sleep 2
        waited=$((waited + 2))
    done
    echo ""

    # 初始化数据库和管理员
    print_info "初始化数据库表和管理员账号..."
    if docker exec -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" yolo-label-backend python init_db.py; then
        print_success "数据库初始化完成"
    else
        print_warning "数据库初始化可能已执行过（如果是重新部署则属正常）"
    fi
}

# ======================== 步骤 7：健康检查和总结 ========================
step_health_check_and_summary() {
    print_step "7/7" "健康检查和部署总结"

    print_info "等待所有服务完全启动..."
    sleep 5

    echo ""
    echo -e "  ${BOLD}服务状态检查：${NC}"
    echo ""

    local all_healthy=true

    # 检查各容器
    local services=("yolo-label-db:数据库" "yolo-label-redis:Redis" "yolo-label-backend:后端API" "yolo-label-celery-worker:Celery Worker" "yolo-label-frontend:前端界面")

    for item in "${services[@]}"; do
        local container="${item%%:*}"
        local desc="${item##*:}"
        local status
        status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not found")

        if [ "$status" = "running" ]; then
            # 对有健康检查的服务，额外检查
            local health
            health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container" 2>/dev/null || echo "unknown")
            if [ "$health" = "healthy" ] || [ "$health" = "no-healthcheck" ]; then
                print_success "${desc} (${container}) — 运行中"
            else
                print_warning "${desc} (${container}) — 运行中（健康检查: ${health}）"
            fi
        else
            print_error "${desc} (${container}) — ${status}"
            all_healthy=false
        fi
    done

    # 检查端口可访问性
    echo ""
    echo -e "  ${BOLD}端口连通性检查：${NC}"
    echo ""

    # 前端
    sleep 3
    local frontend_ok=false
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}" 2>/dev/null | grep -qE "^(200|304)"; then
        frontend_ok=true
        print_success "前端界面 http://localhost:${FRONTEND_PORT} — 可访问"
    else
        # Vite 可能需要更多时间
        sleep 5
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}" 2>/dev/null | grep -qE "^(200|304)"; then
            frontend_ok=true
            print_success "前端界面 http://localhost:${FRONTEND_PORT} — 可访问"
        else
            print_warning "前端界面 http://localhost:${FRONTEND_PORT} — 暂不可访问（可能仍在启动）"
        fi
    fi

    # 后端 API
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${BACKEND_PORT}/docs" 2>/dev/null | grep -qE "^(200|304)"; then
        print_success "后端 API  http://localhost:${BACKEND_PORT}/docs — 可访问"
    else
        print_warning "后端 API  http://localhost:${BACKEND_PORT}/docs — 暂不可访问（可能仍在启动）"
        all_healthy=false
    fi

    # GPU 检查
    if [ "$ENABLE_GPU" = true ]; then
        echo ""
        echo -e "  ${BOLD}GPU 状态检查：${NC}"
        echo ""
        local cuda_status
        cuda_status=$(docker logs yolo-label-celery-worker 2>&1 | grep "CUDA可用" | tail -1 || echo "")
        if echo "$cuda_status" | grep -q "True"; then
            print_success "GPU 加速已启用 — CUDA 可用"
            local gpu_device
            gpu_device=$(docker logs yolo-label-celery-worker 2>&1 | grep "CUDA设备" | tail -1 || echo "")
            if [ -n "$gpu_device" ]; then
                print_info "$gpu_device"
            fi
        else
            print_warning "GPU 状态未确认（Worker 可能仍在启动，稍后检查日志）"
        fi
    fi

    # 保存部署记录
    cat > "$DEPLOY_RECORD" << EOF
deploy_time=$(date '+%Y-%m-%d %H:%M:%S')
frontend_port=${FRONTEND_PORT}
backend_port=${BACKEND_PORT}
db_port=${DB_PORT}
redis_port=${REDIS_PORT}
enable_gpu=${ENABLE_GPU}
compose_file=${COMPOSE_FILE}
EOF

    # ==================== 最终总结 ====================
    echo ""
    echo ""
    if [ "$all_healthy" = true ]; then
        echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
        echo -e "${GREEN}${BOLD}║            ✔ 部署成功！所有服务运行正常                  ║${NC}"
        echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
        echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    else
        echo -e "${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}${BOLD}║                                                          ║${NC}"
        echo -e "${YELLOW}${BOLD}║        ⚠ 部署完成，部分服务可能仍在启动中               ║${NC}"
        echo -e "${YELLOW}${BOLD}║                                                          ║${NC}"
        echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    fi

    echo ""
    echo -e "  ${BOLD}访问地址：${NC}"
    echo -e "    前端界面  ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
    echo -e "    后端 API  ${CYAN}http://localhost:${BACKEND_PORT}${NC}"
    echo -e "    API 文档  ${CYAN}http://localhost:${BACKEND_PORT}/docs${NC}"
    echo ""
    echo -e "  ${BOLD}登录信息：${NC}"
    echo -e "    用户名    ${CYAN}admin${NC}"
    echo -e "    密码      ${CYAN}******（您设置的管理员密码）${NC}"
    echo ""
    echo -e "  ${BOLD}常用命令：${NC}"
    echo -e "    查看日志      ${DIM}docker-compose -f docker-compose.prod.yml logs -f${NC}"
    echo -e "    查看状态      ${DIM}docker-compose -f docker-compose.prod.yml ps${NC}"
    echo -e "    停止服务      ${DIM}docker-compose -f docker-compose.prod.yml down${NC}"
    echo -e "    重启服务      ${DIM}docker-compose -f docker-compose.prod.yml restart${NC}"
    echo -e "    重新部署      ${DIM}./deploy.sh${NC}"
    echo ""

    if [ "$ENABLE_GPU" = true ]; then
        echo -e "  ${BOLD}GPU 相关：${NC}"
        echo -e "    查看 GPU 状态  ${DIM}docker logs yolo-label-celery-worker | grep CUDA${NC}"
        echo -e "    监控 GPU       ${DIM}watch -n 1 nvidia-smi${NC}"
        echo ""
    fi

    echo -e "  ${YELLOW}${BOLD}安全提醒：${NC}"
    echo -e "    ${YELLOW}•${NC} 凭据已保存在 ${DIM}.credentials${NC} 文件中，请妥善保管后删除"
    echo -e "    ${YELLOW}•${NC} 生产环境建议配置 HTTPS（使用 Nginx 反向代理）"
    echo -e "    ${YELLOW}•${NC} 请定期备份数据（参考 README.md 中的备份说明）"
    echo ""
}

# ======================== 主流程 ========================
main() {
    # 确保在项目目录中运行
    cd "$SCRIPT_DIR"

    print_banner

    # 检查是否以 root 运行（不推荐但有时需要）
    if [ "$(id -u)" -eq 0 ]; then
        print_warning "当前以 root 用户运行，建议使用普通用户（需有 sudo 和 docker 权限）"
    fi

    step_check_existing
    step_install_docker
    step_detect_gpu
    step_configure_passwords
    step_configure_ports
    step_generate_and_deploy
    step_init_database
    step_health_check_and_summary
}

# 运行
main "$@"
