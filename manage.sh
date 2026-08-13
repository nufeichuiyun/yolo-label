#!/bin/bash
# ============================================================================
# yolo-label 统一管理脚本
# ============================================================================
# 用法：
#   ./manage.sh <环境> <操作>
#
# 环境和操作：
#   prod deploy      首次生产环境部署（完整交互式设置）
#   prod redeploy    重复生产环境部署（复用已有配置）
#   prod restart     生产环境重启
#   prod clean       生产环境清理（删除容器、数据、配置）
#   test deploy      首次测试环境部署
#   test redeploy    重复测试环境部署（重新构建镜像）
#   test restart     测试环境重启
#   test clean       测试环境清理
#   offline package  离线环境打包
#   offline deploy   离线环境部署（支持重复部署）
#   status           查看服务状态
#   logs [服务名]    查看服务日志
#   help             查看帮助
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
NC='\033[0m'

# ======================== 全局变量 ========================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PROD="$SCRIPT_DIR/docker-compose.prod.yml"
COMPOSE_BASE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_DEV="$SCRIPT_DIR/docker-compose.dev.yml"
COMPOSE_GPU="$SCRIPT_DIR/docker-compose.gpu.yml"
ENV_FILE="$SCRIPT_DIR/.env.prod"
DEPLOY_RECORD="$SCRIPT_DIR/.deploy_record"
TEST_ENV_FILE="$SCRIPT_DIR/.test_env"

# 默认端口
DEFAULT_FRONTEND_PORT=3000
DEFAULT_BACKEND_PORT=8000
DEFAULT_DB_PORT=5432
DEFAULT_REDIS_PORT=6379

# 用户配置（交互中填充）
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

# 根据系统内存自动设置 SHM_SIZE（Docker 共享内存，供 PyTorch 多 worker 使用）
if [ -z "${SHM_SIZE:-}" ]; then
    if command -v free &>/dev/null; then
        total_gb=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}')
        if [ -n "$total_gb" ] && [ "$total_gb" -ge 32 ]; then
            export SHM_SIZE=4g
        elif [ -n "$total_gb" ] && [ "$total_gb" -ge 16 ]; then
            export SHM_SIZE=2g
        else
            export SHM_SIZE=1g
        fi
    else
        export SHM_SIZE=2g
    fi
fi

# 检测 compose 命令（兼容 docker-compose 和 docker compose V2）
if command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version &>/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE=""
fi

# ======================== 工具函数 ========================
print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}${BOLD}║                                                          ║${NC}"
    echo -e "${CYAN}${BOLD}║           yolo-label 统一管理脚本                        ║${NC}"
    echo -e "${CYAN}${BOLD}║           YOLO 图像标注平台                              ║${NC}"
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
    read -r -p "$(echo -e "  ${YELLOW}?${NC} ${prompt} [Y/n]（默认 Y）: ")" answer
    answer="${answer:-Y}"
    [[ "$answer" =~ ^[Yy]$ ]]
}

# 用户确认（默认 N）
confirm_no() {
    local prompt="$1"
    local answer
    read -r -p "$(echo -e "  ${YELLOW}?${NC} ${prompt} [y/N]（默认 N）: ")" answer
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

# 已分配端口列表（用于避免服务间端口冲突）
ASSIGNED_PORTS=()

# 检查端口是否已分配给本次部署的其他服务
is_port_assigned() {
    local port="$1"
    for assigned in "${ASSIGNED_PORTS[@]}"; do
        if [ "$assigned" = "$port" ]; then
            return 0
        fi
    done
    return 1
}

# 查找可用端口（同时排除系统占用和本次已分配端口）
find_available_port() {
    local port="$1"
    local max_port=$((port + 100))
    while [ "$port" -le "$max_port" ]; do
        if ! is_port_in_use "$port" && ! is_port_assigned "$port"; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done
    echo "$1"
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

# 检查是否有 yolo-label 容器在运行
has_running_containers() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "yolo-label"
}

# 检查是否有 yolo-label 容器（包括已停止的）
has_any_containers() {
    docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "yolo-label"
}

# ======================== Docker 环境函数 ========================
# 检查 Docker（仅检查，不安装）
check_docker() {
    if ! command -v docker &>/dev/null; then
        print_error "未安装 Docker，请先安装 Docker"
        print_info "安装方法: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    if ! docker info &>/dev/null; then
        print_error "Docker 服务未运行"
        print_info "请运行: sudo systemctl start docker"
        exit 1
    fi
    if [ -z "$DOCKER_COMPOSE" ]; then
        print_error "未安装 Docker Compose"
        print_info "请安装 Docker Compose 或 Docker Compose V2 插件"
        exit 1
    fi
}

# 确保 Docker 环境（检查并按需安装）
ensure_docker() {
    print_step "1/7" "检测 Docker 环境"

    # 检查 Docker
    if command -v docker &>/dev/null; then
        local docker_version
        docker_version=$(docker --version 2>/dev/null | grep -oP 'Docker version \K[0-9.]+' || echo "未知")
        print_success "Docker 已安装 (版本: ${docker_version})"

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
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            sudo systemctl enable docker
            sudo systemctl start docker
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
        print_success "Docker Compose V2 已安装"
        print_info "检测到 Compose V2，将创建兼容别名..."
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
            sudo mkdir -p /usr/local/lib/docker/cli-plugins
            sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
                -o /usr/local/lib/docker/cli-plugins/docker-compose
            sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
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

# ======================== GPU 函数 ========================
detect_gpu() {
    print_step "2/7" "检测 GPU 环境"

    local gpu_detected=false
    local toolkit_installed=false

    if command -v nvidia-smi &>/dev/null; then
        local gpu_info
        gpu_info=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
        if [ -n "$gpu_info" ]; then
            gpu_detected=true
            print_success "检测到 NVIDIA GPU: ${gpu_info}"
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

    echo ""
    if confirm_yes "是否启用 GPU 加速（用于 AI 辅助标注）？"; then
        ENABLE_GPU=true
        if [ "$toolkit_installed" = false ]; then
            print_info "NVIDIA Container Toolkit 未安装，正在自动安装..."
            # 清理可能损坏的旧源列表
            sudo rm -f /etc/apt/sources.list.d/nvidia-container-toolkit.list
            sudo rm -f /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
            local install_ok=false
            # 使用 curl 下载：重试、较长超时；先试 IPv4 再试默认（部分网络 IPv6 HTTPS 会 reset）
            local curl_opts="-fsSL --connect-timeout 30 --max-time 90 --retry 2 --retry-delay 5"
            local gpg_ok=false
            if curl $curl_opts -4 https://nvidia.github.io/libnvidia-container/gpgkey 2>/dev/null \
                | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null; then
                gpg_ok=true
            elif curl $curl_opts https://nvidia.github.io/libnvidia-container/gpgkey 2>/dev/null \
                | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null; then
                gpg_ok=true
            fi
            if [ "$gpg_ok" = true ]; then
                if curl -s -L $curl_opts -4 https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list 2>/dev/null \
                    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
                    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null; then
                    :
                elif curl -s -L $curl_opts https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list 2>/dev/null \
                    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
                    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null; then
                    :
                else
                    gpg_ok=false
                fi
                if [ "$gpg_ok" = true ]; then
                    if sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq nvidia-container-toolkit 2>/dev/null; then
                        sudo nvidia-ctk runtime configure --runtime=docker 2>/dev/null || true
                        sudo systemctl restart docker 2>/dev/null || true
                        sleep 2
                        if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &>/dev/null 2>&1; then
                            install_ok=true
                        fi
                    fi
                fi
            fi
            if [ "$install_ok" = false ]; then
                print_warning "自动安装失败（可能是网络问题，HTTPS 连接被重置）"
                echo ""
                echo -e "  ${BOLD}请手动安装后重新运行部署：${NC}"
                echo -e "  ${DIM}# Ubuntu/Debian（若 curl 失败可尝试加 -4 强制 IPv4）：${NC}"
                echo -e "  curl -fsSL -4 https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
                echo -e "  curl -s -L -4 https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \\"
                echo -e "    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list"
                echo -e "  sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit"
                echo -e "  sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
                echo ""
                echo -e "  ${BOLD}或使用 CPU 模式继续部署（AI 推理较慢）：${NC}"
                if confirm_yes "是否改用 CPU 模式继续？"; then
                    ENABLE_GPU=false
                    print_info "已切换为 CPU 模式"
                else
                    print_info "请完成手动安装后重新运行: ./manage.sh test deploy"
                    exit 1
                fi
            else
                print_success "NVIDIA Container Toolkit 安装成功"
            fi
        fi
        if [ "$ENABLE_GPU" = true ]; then
            print_success "GPU 加速已启用"
        fi
    else
        ENABLE_GPU=false
        print_info "已跳过 GPU 加速，将使用 CPU 模式"
    fi
}

# 加载测试环境配置（GPU 选择等）
load_test_env() {
    if [ -f "$TEST_ENV_FILE" ]; then
        # shellcheck source=/dev/null
        . "$TEST_ENV_FILE"
    else
        ENABLE_GPU=false
    fi
}

# 保存测试环境配置
save_test_env() {
    echo "# yolo-label 测试环境配置（自动生成）" > "$TEST_ENV_FILE"
    echo "ENABLE_GPU=${ENABLE_GPU}" >> "$TEST_ENV_FILE"
}

# 获取测试环境 compose 参数（根据是否启用 GPU）
get_compose_test_args() {
    load_test_env
    if [ "$ENABLE_GPU" = true ] && [ -f "$COMPOSE_GPU" ]; then
        echo "-f" "$COMPOSE_BASE" "-f" "$COMPOSE_DEV" "-f" "$COMPOSE_GPU"
    else
        echo "-f" "$COMPOSE_BASE" "-f" "$COMPOSE_DEV"
    fi
}

# ======================== 配置函数（生产环境）========================
configure_passwords() {
    print_step "3/7" "配置密码和密钥"

    echo -e "  ${BOLD}请设置以下安全信息（所有密码请妥善保管）：${NC}"
    echo ""

    echo -e "  ${CYAN}[1/3] 数据库密码${NC}"
    echo -e "  ${DIM}用于 PostgreSQL 数据库连接，建议使用强密码${NC}"
    POSTGRES_PASSWORD=$(read_password "请输入数据库密码（至少6位）")
    print_success "数据库密码已设置"
    echo ""

    echo -e "  ${CYAN}[2/3] 系统管理员密码${NC}"
    echo -e "  ${DIM}用于登录 yolo-label 系统的 admin 账号${NC}"
    ADMIN_PASSWORD=$(read_password "请输入管理员密码（至少6位）")
    print_success "管理员密码已设置"
    echo ""

    echo -e "  ${CYAN}[3/3] JWT 安全密钥${NC}"
    SECRET_KEY=$(generate_secret 48)
    print_success "JWT 密钥已自动生成（48位随机字符串）"

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

# 交互式读取单个端口（带推荐、冲突提示、占用检查）
# 用法: read_port "服务名" 默认端口
# 结果写入 _PORT_RESULT 变量
read_port() {
    local service_name="$1"
    local default_port="$2"
    local rec_port chosen_port

    rec_port=$(find_available_port "$default_port")
    if [ "$rec_port" != "$default_port" ]; then
        # 默认端口被占用，推荐替代端口
        read -r -p "$(echo -e "  ${YELLOW}?${NC} ${service_name}端口（${default_port} 被占用，推荐 ${CYAN}${rec_port}${NC}，回车确认）: ")" chosen_port
        chosen_port="${chosen_port:-$rec_port}"
    else
        read -r -p "$(echo -e "  ${YELLOW}?${NC} ${service_name}端口（默认 ${CYAN}${rec_port}${NC}，回车确认）: ")" chosen_port
        chosen_port="${chosen_port:-$rec_port}"
    fi

    # 校验用户输入
    is_port_in_use "$chosen_port" && print_warning "端口 ${chosen_port} 已被系统其他服务占用"
    is_port_assigned "$chosen_port" && print_warning "端口 ${chosen_port} 与已选的其他服务端口重复！"
    ASSIGNED_PORTS+=("$chosen_port")

    _PORT_RESULT="$chosen_port"
}

configure_ports() {
    print_step "4/7" "配置服务端口"

    echo -e "  ${BOLD}检测端口占用情况：${NC}"
    echo ""

    local has_conflict=false
    local service_names=("前端界面" "后端API" "数据库" "Redis")
    local default_ports=($DEFAULT_FRONTEND_PORT $DEFAULT_BACKEND_PORT $DEFAULT_DB_PORT $DEFAULT_REDIS_PORT)

    for i in "${!default_ports[@]}"; do
        if is_port_in_use "${default_ports[$i]}"; then
            print_warning "端口 ${default_ports[$i]} (${service_names[$i]}) 已被占用"
            has_conflict=true
        else
            print_success "端口 ${default_ports[$i]} (${service_names[$i]}) 可用"
        fi
    done

    echo ""
    local need_custom=false
    if [ "$has_conflict" = true ]; then
        # 有冲突：自动进入自定义模式
        print_info "检测到端口冲突，将自动推荐可用端口"
        need_custom=true
    elif ! confirm_yes "所有默认端口均可用，是否直接使用？"; then
        need_custom=true
    fi

    if [ "$need_custom" = true ]; then
        echo ""
        echo -e "  ${BOLD}请确认或修改各服务端口（直接回车使用推荐端口）：${NC}"
        echo ""

        ASSIGNED_PORTS=()

        read_port "前端界面" $DEFAULT_FRONTEND_PORT; FRONTEND_PORT="$_PORT_RESULT"
        read_port "后端 API" $DEFAULT_BACKEND_PORT;  BACKEND_PORT="$_PORT_RESULT"
        read_port "数据库"   $DEFAULT_DB_PORT;       DB_PORT="$_PORT_RESULT"
        read_port "Redis"    $DEFAULT_REDIS_PORT;     REDIS_PORT="$_PORT_RESULT"
    else
        FRONTEND_PORT=$DEFAULT_FRONTEND_PORT
        BACKEND_PORT=$DEFAULT_BACKEND_PORT
        DB_PORT=$DEFAULT_DB_PORT
        REDIS_PORT=$DEFAULT_REDIS_PORT
    fi

    echo ""
    echo -e "  ${BOLD}端口配置：${NC}"
    echo -e "    前端界面  → ${CYAN}${FRONTEND_PORT}${NC}"
    echo -e "    后端 API  → ${CYAN}${BACKEND_PORT}${NC}"
    echo -e "    数据库    → ${CYAN}${DB_PORT}${NC}"
    echo -e "    Redis     → ${CYAN}${REDIS_PORT}${NC}"
}

# 加载已有的生产环境配置
load_prod_config() {
    if [ ! -f "$ENV_FILE" ]; then
        return 1
    fi
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    FRONTEND_PORT=${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}
    BACKEND_PORT=${BACKEND_PORT:-$DEFAULT_BACKEND_PORT}
    DB_PORT=${DB_PORT:-$DEFAULT_DB_PORT}
    REDIS_PORT=${REDIS_PORT:-$DEFAULT_REDIS_PORT}
    ENABLE_GPU=${ENABLE_GPU:-false}
    return 0
}

# 生成生产环境配置文件
generate_prod_config() {
    print_info "生成环境变量配置..."
    cat > "$ENV_FILE" << EOF
# yolo-label 生产环境配置（自动生成，请勿手动修改）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
SECRET_KEY=${SECRET_KEY}

FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
DB_PORT=${DB_PORT}
REDIS_PORT=${REDIS_PORT}

ENABLE_GPU=${ENABLE_GPU}
EOF
    chmod 600 "$ENV_FILE"
    print_success "环境配置已生成: .env.prod"
}

generate_compose_prod() {
    print_info "生成 Docker Compose 生产配置..."

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

    cat > "$COMPOSE_PROD" << COMPOSEFILE
# yolo-label 生产环境配置（自动生成）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# GPU 加速: ${ENABLE_GPU}
# 注：Compose V2 已弃用 version 字段，此处不再写入
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
      - UPLOAD_DIR=/app/uploads
      - ANNOTATION_DIR=/app/annotations
      - MODEL_DIR=/app/models
      - TRAINING_OUTPUT_DIR=/app/training_output
      - QT_QPA_PLATFORM=offscreen
      - DISPLAY=
    volumes:
      - uploads_data:/app/uploads
      - annotations_data:/app/annotations
      - ./models:/app/models
      - training_output_data:/app/training_output
    ports:
      - "${BACKEND_PORT}:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    # 启动前自动应用数据库迁移，避免模型与表结构漂移
    command: sh -c "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 300 --timeout-graceful-shutdown 300"

  celery-worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: yolo-label-celery-worker
    restart: always
    shm_size: '${SHM_SIZE:-4gb}'
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379/0
      - UPLOAD_DIR=/app/uploads
      - ANNOTATION_DIR=/app/annotations
      - MODEL_DIR=/app/models
      - TRAINING_OUTPUT_DIR=/app/training_output
      - TRAINING_WORKERS=\${TRAINING_WORKERS:-}
      - QT_QPA_PLATFORM=offscreen
      - DISPLAY=
${gpu_env_section}
    volumes:
      - uploads_data:/app/uploads
      - annotations_data:/app/annotations
      - ./models:/app/models
      - training_output_data:/app/training_output
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
${gpu_deploy_section}
    command: celery -A app.celery_app worker --loglevel=info --pool=solo --concurrency=1 -Q celery

  rknn-worker:
    build:
      context: .
      dockerfile: rknn_converter/Dockerfile
    container_name: yolo-label-rknn-worker
    restart: always
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379/0
      - MODEL_DIR=/app/models
      - QT_QPA_PLATFORM=offscreen
      - DISPLAY=
    volumes:
      - ./models:/app/models
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: celery -A app.celery_app worker --loglevel=info --pool=solo --concurrency=1 -Q rknn

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
  training_output_data:
COMPOSEFILE

    chmod 600 "$COMPOSE_PROD"

    print_success "Docker Compose 配置已生成: docker-compose.prod.yml"
}

# ======================== 容器管理函数 ========================
# 停止容器（保留数据卷）
stop_containers() {
    local compose_file="$1"
    if [ -f "$compose_file" ]; then
        $DOCKER_COMPOSE -f "$compose_file" down 2>/dev/null || true
    fi
    # 强制清理残留容器
    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        print_info "强制停止残留容器..."
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi
    sleep 3
}

# 停止测试环境容器
stop_test_containers() {
    $DOCKER_COMPOSE $(get_compose_test_args) down 2>/dev/null || true
    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        print_info "强制停止残留容器..."
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi
    sleep 3
}

# 完全清理（容器 + 数据卷 + 配置文件）
cleanup_all_prod() {
    if [ -f "$COMPOSE_PROD" ]; then
        $DOCKER_COMPOSE -f "$COMPOSE_PROD" down -v 2>/dev/null || true
    fi
    $DOCKER_COMPOSE -f "$COMPOSE_BASE" down -v 2>/dev/null || true

    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi

    local volumes
    volumes=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E "(yolo-label|afa-label)" || true)
    if [ -n "$volumes" ]; then
        print_info "删除数据卷..."
        echo "$volumes" | xargs -r docker volume rm -f 2>/dev/null || true
    fi

    rm -f "$COMPOSE_PROD" "$ENV_FILE" "$DEPLOY_RECORD"
    sleep 3
}

# 完全清理测试环境
cleanup_all_test() {
    $DOCKER_COMPOSE $(get_compose_test_args) down -v 2>/dev/null || true

    local containers
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
    if [ -n "$containers" ]; then
        echo "$containers" | xargs -r docker stop 2>/dev/null || true
        echo "$containers" | xargs -r docker rm -f 2>/dev/null || true
    fi

    local volumes
    volumes=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E "(yolo-label|afa-label)" || true)
    if [ -n "$volumes" ]; then
        print_info "删除数据卷..."
        echo "$volumes" | xargs -r docker volume rm -f 2>/dev/null || true
    fi

    sleep 3
}

# ======================== 数据库初始化 ========================
wait_for_db() {
    print_info "等待数据库服务就绪..."
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
        print_warning "数据库启动超时，尝试继续..."
    else
        print_success "数据库已就绪"
    fi
}

wait_for_backend() {
    print_info "等待后端服务就绪..."
    local max_wait=60
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if docker exec yolo-label-backend python -c "print('ok')" &>/dev/null; then
            break
        fi
        printf "\r  ${CYAN}⏳${NC} 等待后端服务启动... (%d/%d秒)" "$waited" "$max_wait"
        sleep 2
        waited=$((waited + 2))
    done
    echo ""
}

init_database() {
    local admin_pwd="${1:-}"
    print_info "初始化数据库表和管理员账号..."
    if [ -n "$admin_pwd" ]; then
        if docker exec -e ADMIN_PASSWORD="$admin_pwd" yolo-label-backend python init_db.py 2>&1; then
            print_success "数据库初始化完成"
        else
            print_warning "数据库初始化可能已执行过（重新部署时属正常）"
        fi
    else
        if docker exec yolo-label-backend python init_db.py 2>&1; then
            print_success "数据库初始化完成"
        else
            print_warning "数据库初始化可能已执行过（重新部署时属正常）"
        fi
    fi
}

# ======================== 健康检查 ========================
health_check() {
    local frontend_port="${1:-$DEFAULT_FRONTEND_PORT}"
    local backend_port="${2:-$DEFAULT_BACKEND_PORT}"

    print_info "等待所有服务完全启动..."
    sleep 5

    echo ""
    echo -e "  ${BOLD}服务状态检查：${NC}"
    echo ""

    local all_healthy=true
    local services=("yolo-label-db:数据库" "yolo-label-redis:Redis" "yolo-label-backend:后端API" "yolo-label-celery-worker:Celery Worker" "yolo-label-rknn-worker:RKNN Worker" "yolo-label-frontend:前端界面")

    for item in "${services[@]}"; do
        local container="${item%%:*}"
        local desc="${item##*:}"
        local status
        status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not found")

        if [ "$status" = "running" ]; then
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

    echo ""
    echo -e "  ${BOLD}端口连通性检查：${NC}"
    echo ""

    sleep 3
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${frontend_port}" 2>/dev/null | grep -qE "^(200|304)"; then
        print_success "前端界面 http://localhost:${frontend_port} — 可访问"
    else
        sleep 5
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${frontend_port}" 2>/dev/null | grep -qE "^(200|304)"; then
            print_success "前端界面 http://localhost:${frontend_port} — 可访问"
        else
            print_warning "前端界面 http://localhost:${frontend_port} — 暂不可访问（可能仍在启动）"
        fi
    fi

    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${backend_port}/docs" 2>/dev/null | grep -qE "^(200|304)"; then
        print_success "后端 API  http://localhost:${backend_port}/docs — 可访问"
    else
        print_warning "后端 API  http://localhost:${backend_port}/docs — 暂不可访问（可能仍在启动）"
        all_healthy=false
    fi

    if [ "$ENABLE_GPU" = true ]; then
        echo ""
        echo -e "  ${BOLD}GPU 状态检查：${NC}"
        echo ""
        local cuda_status
        cuda_status=$(docker logs yolo-label-celery-worker 2>&1 | grep "CUDA可用" | tail -1 || echo "")
        if echo "$cuda_status" | grep -q "True"; then
            print_success "GPU 加速已启用 — CUDA 可用"
        else
            print_warning "GPU 状态未确认（Worker 可能仍在启动）"
        fi
    fi

    return $([ "$all_healthy" = true ] && echo 0 || echo 1)
}

# 打印部署总结
print_summary() {
    local env_name="$1"
    local frontend_port="${2:-$DEFAULT_FRONTEND_PORT}"
    local backend_port="${3:-$DEFAULT_BACKEND_PORT}"
    local all_healthy="${4:-true}"

    echo ""
    echo ""
    if [ "$all_healthy" = true ]; then
        echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
        echo -e "${GREEN}${BOLD}║            ✔ ${env_name}部署成功！所有服务运行正常        ║${NC}"
        echo -e "${GREEN}${BOLD}║                                                          ║${NC}"
        echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    else
        echo -e "${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}${BOLD}║                                                          ║${NC}"
        echo -e "${YELLOW}${BOLD}║        ⚠ ${env_name}部署完成，部分服务可能仍在启动中     ║${NC}"
        echo -e "${YELLOW}${BOLD}║                                                          ║${NC}"
        echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    fi

    echo ""
    echo -e "  ${BOLD}访问地址：${NC}"
    echo -e "    前端界面  ${CYAN}http://localhost:${frontend_port}${NC}"
    echo -e "    后端 API  ${CYAN}http://localhost:${backend_port}${NC}"
    echo -e "    API 文档  ${CYAN}http://localhost:${backend_port}/docs${NC}"
    echo ""

    if [ "$env_name" = "测试环境" ]; then
        echo -e "  ${BOLD}登录信息：${NC}"
        echo -e "    用户名    ${CYAN}admin${NC}"
        echo -e "    密码      ${CYAN}admin123${NC}"
    else
        echo -e "  ${BOLD}登录信息：${NC}"
        echo -e "    用户名    ${CYAN}admin${NC}"
        echo -e "    密码      ${CYAN}******（您设置的管理员密码）${NC}"
    fi
    echo ""

    echo -e "  ${BOLD}常用命令：${NC}"
    if [ "$env_name" = "测试环境" ]; then
        echo -e "    查看日志      ${DIM}docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f${NC}"
        echo -e "    查看状态      ${DIM}docker-compose -f docker-compose.yml -f docker-compose.dev.yml ps${NC}"
        echo -e "    重启服务      ${DIM}./manage.sh test restart${NC}"
        echo -e "    重新部署      ${DIM}./manage.sh test redeploy${NC}"
        echo -e "    清理环境      ${DIM}./manage.sh test clean${NC}"
    else
        echo -e "    查看日志      ${DIM}docker-compose -f docker-compose.prod.yml logs -f${NC}"
        echo -e "    查看状态      ${DIM}docker-compose -f docker-compose.prod.yml ps${NC}"
        echo -e "    重启服务      ${DIM}./manage.sh prod restart${NC}"
        echo -e "    重新部署      ${DIM}./manage.sh prod redeploy${NC}"
        echo -e "    清理环境      ${DIM}./manage.sh prod clean${NC}"
    fi
    echo ""

    if [ "$ENABLE_GPU" = true ]; then
        echo -e "  ${BOLD}GPU 相关：${NC}"
        echo -e "    查看 GPU 状态  ${DIM}docker logs yolo-label-celery-worker | grep CUDA${NC}"
        echo -e "    监控 GPU       ${DIM}watch -n 1 nvidia-smi${NC}"
        echo ""
    fi

    if [ "$env_name" != "测试环境" ]; then
        echo -e "  ${YELLOW}${BOLD}安全提醒：${NC}"
        echo -e "    ${YELLOW}•${NC} 凭据已保存在 ${DIM}.credentials${NC} 文件中，请妥善保管后删除"
        echo -e "    ${YELLOW}•${NC} 生产环境建议配置 HTTPS（使用 Nginx 反向代理）"
        echo -e "    ${YELLOW}•${NC} 请定期备份数据库与上传目录（PostgreSQL 数据卷、uploads/）"
        echo ""
    fi
}

# ================================================================
#                        主要操作函数
# ================================================================

# ======================== 生产环境首次部署 ========================
cmd_prod_deploy() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}首次生产环境部署${NC}"

    if [ "$(id -u)" -eq 0 ]; then
        print_warning "当前以 root 用户运行，建议使用普通用户（需有 sudo 和 docker 权限）"
    fi

    # 检查已有部署
    if has_any_containers; then
        print_warning "检测到已有的 yolo-label 容器："
        echo ""
        docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
        echo ""
        echo -e "  ${BOLD}首次部署需要一个干净的环境，请选择：${NC}"
        echo -e "    ${CYAN}1)${NC} 清除已有部署后继续（${RED}删除所有数据${NC}）"
        echo -e "    ${CYAN}2)${NC} 退出（建议使用 ${CYAN}./manage.sh prod redeploy${NC} 进行重复部署）"
        echo ""
        local choice
        read -r -p "$(echo -e "  ${YELLOW}?${NC} 请输入选项 [1/2]（默认 2）: ")" choice
        choice="${choice:-2}"
        case "$choice" in
            1)
                if confirm_no "确定要删除所有数据吗？此操作不可恢复"; then
                    print_info "正在清除旧部署..."
                    cleanup_all_prod
                    print_success "旧部署已完全清除"
                else
                    print_info "已取消，退出部署"
                    exit 0
                fi
                ;;
            *)
                print_info "退出部署。如需更新部署，请使用: ./manage.sh prod redeploy"
                exit 0
                ;;
        esac
    fi

    # 完整的部署流程
    ensure_docker
    detect_gpu
    configure_passwords
    configure_ports

    print_step "5/7" "生成配置并构建部署"
    generate_prod_config
    generate_compose_prod

    echo ""
    print_info "开始构建 Docker 镜像（首次构建可能需要 10-30 分钟）..."
    echo ""
    if ! $DOCKER_COMPOSE -f "$COMPOSE_PROD" build; then
        print_error "镜像构建失败！请检查网络连接和磁盘空间"
        exit 1
    fi
    print_success "Docker 镜像构建完成"

    echo ""
    print_info "启动所有服务..."
    if ! $DOCKER_COMPOSE -f "$COMPOSE_PROD" up -d; then
        print_error "服务启动失败！查看日志: docker-compose -f docker-compose.prod.yml logs"
        exit 1
    fi
    print_success "所有服务已启动"

    print_step "6/7" "初始化数据库"
    wait_for_db
    wait_for_backend
    init_database "$ADMIN_PASSWORD"

    # 保存部署记录
    cat > "$DEPLOY_RECORD" << EOF
deploy_time=$(date '+%Y-%m-%d %H:%M:%S')
frontend_port=${FRONTEND_PORT}
backend_port=${BACKEND_PORT}
db_port=${DB_PORT}
redis_port=${REDIS_PORT}
enable_gpu=${ENABLE_GPU}
compose_file=${COMPOSE_PROD}
EOF

    print_step "7/7" "健康检查和部署总结"
    local all_healthy=true
    health_check "$FRONTEND_PORT" "$BACKEND_PORT" || all_healthy=false
    print_summary "生产环境" "$FRONTEND_PORT" "$BACKEND_PORT" "$all_healthy"
}

# ======================== 生产环境重复部署 ========================
cmd_prod_redeploy() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}重复生产环境部署${NC}"

    # 检查已有配置
    if ! load_prod_config; then
        print_error "未找到已有的生产环境配置 (.env.prod)"
        print_info "请先运行首次部署: ./manage.sh prod deploy"
        exit 1
    fi
    print_success "已加载现有配置"
    print_info "前端端口: ${FRONTEND_PORT}  后端端口: ${BACKEND_PORT}  GPU: ${ENABLE_GPU}"

    echo ""
    echo -e "  ${BOLD}请选择重新部署方式：${NC}"
    echo -e "    ${CYAN}1)${NC} 保留数据，重新构建并部署（${GREEN}推荐${NC}，用于更新代码）"
    echo -e "    ${CYAN}2)${NC} 清除数据，全新部署（${RED}删除所有数据${NC}）"
    echo -e "    ${CYAN}3)${NC} 退出"
    echo ""
    local choice
    read -r -p "$(echo -e "  ${YELLOW}?${NC} 请输入选项 [1/2/3]（默认 1）: ")" choice
    choice="${choice:-1}"

    case "$choice" in
        1)
            print_info "正在停止旧服务（保留数据）..."
            stop_containers "$COMPOSE_PROD"
            print_success "旧服务已停止，数据已保留"
            ;;
        2)
            print_warning "${RED}${BOLD}此操作将删除所有数据（数据库、图片、标注、模型）！${NC}"
            if confirm_no "确定要删除所有数据吗？此操作不可恢复"; then
                print_info "正在清除旧部署..."
                cleanup_all_prod
                print_success "旧部署已完全清除"
                # 清除后需要重新配置
                print_info "数据已清除，需要重新配置密码..."
                configure_passwords
            else
                print_info "已取消删除，将保留数据重新部署..."
                stop_containers "$COMPOSE_PROD"
                print_success "旧服务已停止，数据已保留"
            fi
            ;;
        3)
            print_info "退出"
            exit 0
            ;;
        *)
            print_error "无效选项，退出"
            exit 1
            ;;
    esac

    # 重新生成配置并部署
    generate_prod_config
    generate_compose_prod

    echo ""
    print_info "重新构建 Docker 镜像..."
    if ! $DOCKER_COMPOSE -f "$COMPOSE_PROD" build; then
        print_error "镜像构建失败！"
        exit 1
    fi
    print_success "Docker 镜像构建完成"

    echo ""
    print_info "启动所有服务..."
    if ! $DOCKER_COMPOSE -f "$COMPOSE_PROD" up -d; then
        print_error "服务启动失败！"
        exit 1
    fi
    print_success "所有服务已启动"

    wait_for_db
    wait_for_backend
    init_database "${ADMIN_PASSWORD:-}"

    echo ""
    local all_healthy=true
    health_check "$FRONTEND_PORT" "$BACKEND_PORT" || all_healthy=false
    print_summary "生产环境" "$FRONTEND_PORT" "$BACKEND_PORT" "$all_healthy"
}

# ======================== 生产环境重启 ========================
cmd_prod_restart() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}生产环境重启${NC}"

    if [ ! -f "$COMPOSE_PROD" ]; then
        print_error "未找到生产环境配置文件 (docker-compose.prod.yml)"
        print_info "请先部署: ./manage.sh prod deploy"
        exit 1
    fi

    load_prod_config || true

    print_info "正在重启所有生产环境服务..."
    $DOCKER_COMPOSE -f "$COMPOSE_PROD" restart
    print_success "所有服务已重启"

    echo ""
    local all_healthy=true
    health_check "${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}" "${BACKEND_PORT:-$DEFAULT_BACKEND_PORT}" || all_healthy=false

    echo ""
    if [ "$all_healthy" = true ]; then
        print_success "所有服务重启成功，运行正常"
    else
        print_warning "部分服务可能仍在启动中，请稍后检查"
    fi
}

# ======================== 生产环境清理 ========================
cmd_prod_clean() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}生产环境清理${NC}"

    echo ""
    print_warning "${RED}${BOLD}此操作将：${NC}"
    echo -e "    ${RED}•${NC} 停止所有 yolo-label 容器"
    echo -e "    ${RED}•${NC} 删除所有容器和镜像缓存"
    echo -e "    ${RED}•${NC} 删除所有数据卷（数据库、上传文件、标注、模型）"
    echo -e "    ${RED}•${NC} 删除生产环境配置文件"
    echo ""

    if ! confirm_no "确定要清理生产环境吗？此操作不可恢复"; then
        print_info "已取消"
        exit 0
    fi

    print_info "正在清理生产环境..."
    cleanup_all_prod

    # 额外清理镜像
    local images
    images=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E "(yolo-label|afa-label)" || true)
    if [ -n "$images" ]; then
        print_info "删除相关镜像..."
        echo "$images" | xargs -r docker rmi -f 2>/dev/null || true
    fi

    print_success "生产环境已完全清理"
    echo ""
    print_info "如需重新部署: ./manage.sh prod deploy"
}

# ======================== 测试环境首次部署 ========================
cmd_test_deploy() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}首次测试环境部署${NC}"

    # 检查已有容器
    if has_any_containers; then
        print_warning "检测到已有的 yolo-label 容器："
        echo ""
        docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
        echo ""
        echo -e "  ${BOLD}首次部署需要一个干净的环境，请选择：${NC}"
        echo -e "    ${CYAN}1)${NC} 清除已有部署后继续（${RED}删除所有数据${NC}）"
        echo -e "    ${CYAN}2)${NC} 退出（建议使用 ${CYAN}./manage.sh test redeploy${NC} 进行重复部署）"
        echo ""
        local choice
        read -r -p "$(echo -e "  ${YELLOW}?${NC} 请输入选项 [1/2]（默认 2）: ")" choice
        choice="${choice:-2}"
        case "$choice" in
            1)
                print_info "正在清除旧部署..."
                cleanup_all_test
                print_success "旧部署已清除"
                ;;
            *)
                print_info "退出部署。如需更新，请使用: ./manage.sh test redeploy"
                exit 0
                ;;
        esac
    fi

    # 检查 Docker 环境
    check_docker
    print_success "Docker 环境检查通过"

    # 检测并选择是否启用 GPU
    echo ""
    detect_gpu
    save_test_env

    echo ""
    print_info "开始构建 Docker 镜像（首次构建可能需要 10-30 分钟）..."
    echo ""

    # 清理旧容器（如果有残留）
    $DOCKER_COMPOSE $(get_compose_test_args) down 2>/dev/null || true

    # 构建镜像
    if ! $DOCKER_COMPOSE $(get_compose_test_args) build; then
        print_error "镜像构建失败！请检查网络连接和磁盘空间"
        exit 1
    fi
    print_success "Docker 镜像构建完成"

    echo ""
    print_info "启动测试环境服务..."
    if ! $DOCKER_COMPOSE $(get_compose_test_args) up -d; then
        print_error "服务启动失败！"
        exit 1
    fi
    print_success "所有服务已启动"

    # 初始化数据库
    wait_for_db
    wait_for_backend
    init_database

    echo ""
    local all_healthy=true
    health_check "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" || all_healthy=false
    print_summary "测试环境" "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" "$all_healthy"
}

# ======================== 测试环境重复部署 ========================
cmd_test_redeploy() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}重复测试环境部署${NC}"

    check_docker
    load_test_env

    echo ""
    echo -e "  ${BOLD}当前 GPU 设置：${NC}${ENABLE_GPU}"
    if confirm_no "是否重新选择 GPU 设置？"; then
        detect_gpu
        save_test_env
    fi

    echo ""
    echo -e "  ${BOLD}请选择重新部署方式：${NC}"
    echo -e "    ${CYAN}1)${NC} 保留数据，重新构建并部署（${GREEN}推荐${NC}）"
    echo -e "    ${CYAN}2)${NC} 清除数据，全新部署（${RED}删除所有数据${NC}）"
    echo -e "    ${CYAN}3)${NC} 退出"
    echo ""
    local choice
    read -r -p "$(echo -e "  ${YELLOW}?${NC} 请输入选项 [1/2/3]（默认 1）: ")" choice
    choice="${choice:-1}"

    case "$choice" in
        1)
            print_info "停止旧服务（保留数据）..."
            stop_test_containers
            print_success "旧服务已停止"
            ;;
        2)
            print_info "清除旧部署..."
            cleanup_all_test
            print_success "旧部署已清除"
            ;;
        3)
            print_info "退出"
            exit 0
            ;;
        *)
            print_error "无效选项，退出"
            exit 1
            ;;
    esac

    echo ""
    print_info "重新构建 Docker 镜像..."
    if ! $DOCKER_COMPOSE $(get_compose_test_args) build; then
        print_error "镜像构建失败！"
        exit 1
    fi
    print_success "Docker 镜像构建完成"

    echo ""
    print_info "启动测试环境服务..."
    if ! $DOCKER_COMPOSE $(get_compose_test_args) up -d; then
        print_error "服务启动失败！"
        exit 1
    fi
    print_success "所有服务已启动"

    wait_for_db
    wait_for_backend
    init_database

    echo ""
    local all_healthy=true
    health_check "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" || all_healthy=false
    print_summary "测试环境" "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" "$all_healthy"
}

# ======================== 测试环境重启 ========================
cmd_test_restart() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}测试环境重启${NC}"

    check_docker
    load_test_env

    if ! has_any_containers; then
        print_error "未检测到 yolo-label 容器，请先部署: ./manage.sh test deploy"
        exit 1
    fi

    print_info "正在重启所有测试环境服务..."
    $DOCKER_COMPOSE $(get_compose_test_args) restart
    print_success "所有服务已重启"

    echo ""
    local all_healthy=true
    health_check "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" || all_healthy=false

    echo ""
    if [ "$all_healthy" = true ]; then
        print_success "所有服务重启成功，运行正常"
    else
        print_warning "部分服务可能仍在启动中，请稍后检查"
    fi
}

# ======================== 测试环境清理 ========================
cmd_test_clean() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}测试环境清理${NC}"

    echo ""
    print_warning "${RED}${BOLD}此操作将删除所有测试环境容器、数据卷和数据！${NC}"
    echo ""

    if ! confirm_no "确定要清理测试环境吗？此操作不可恢复"; then
        print_info "已取消"
        exit 0
    fi

    print_info "正在清理测试环境..."
    cleanup_all_test

    # 额外清理镜像
    local images
    images=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E "(yolo-label|afa-label)" || true)
    if [ -n "$images" ]; then
        print_info "删除相关镜像..."
        echo "$images" | xargs -r docker rmi -f 2>/dev/null || true
    fi

    rm -f "$TEST_ENV_FILE"
    print_success "测试环境已完全清理"
    echo ""
    print_info "如需重新部署: ./manage.sh test deploy"
}

# ======================== 离线环境打包 ========================
cmd_offline_package() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}离线环境打包${NC}"

    cd "$SCRIPT_DIR"

    local PACKAGE_NAME="yolo-label-offline-$(date +%Y%m%d-%H%M%S)"
    local PACKAGE_DIR="/tmp/$PACKAGE_NAME"

    echo ""
    print_info "目标目录: ${PACKAGE_DIR}"
    mkdir -p "$PACKAGE_DIR"

    # 1. 导出 Docker 镜像
    print_step "1/4" "导出 Docker 镜像"
    # 尝试多种可能的镜像名称
    local backend_image=""
    local frontend_image=""
    if docker images --format '{{.Repository}}' | grep -q "afa-label_backend"; then
        backend_image="afa-label_backend:latest"
        frontend_image="afa-label_frontend:latest"
    elif docker images --format '{{.Repository}}' | grep -q "yolo-label-backend"; then
        backend_image="yolo-label-backend:latest"
        frontend_image="yolo-label-frontend:latest"
    elif docker images --format '{{.Repository}}' | grep -q "yolo-label_backend"; then
        backend_image="yolo-label_backend:latest"
        frontend_image="yolo-label_frontend:latest"
    fi

    if [ -z "$backend_image" ]; then
        print_error "未找到 Docker 镜像，请先构建镜像"
        print_info "运行: ./manage.sh prod deploy 或 ./manage.sh test deploy"
        exit 1
    fi

    print_info "导出镜像: ${backend_image}, ${frontend_image}, postgres:15-alpine, redis:7-alpine"
    docker save \
        "$backend_image" \
        "$frontend_image" \
        postgres:15-alpine \
        redis:7-alpine \
        -o "$PACKAGE_DIR/yolo-label-images.tar"

    print_info "压缩镜像文件..."
    gzip "$PACKAGE_DIR/yolo-label-images.tar"
    print_success "镜像导出完成: yolo-label-images.tar.gz"

    # 2. 打包项目文件
    print_step "2/4" "打包项目文件"
    mkdir -p "$PACKAGE_DIR/offline-deploy"

    rsync -av --exclude='.git' \
        --exclude='node_modules' \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='.env' \
        --exclude='.env.prod' \
        --exclude='.credentials' \
        --exclude='.deploy_record' \
        --exclude='uploads_data' \
        --exclude='annotations_data' \
        --exclude='models_data' \
        --exclude='postgres_data' \
        --exclude='*.tar.gz' \
        --exclude='*.tar' \
        --exclude='*.zip' \
        --exclude='offline-deploy' \
        --exclude='docker-compose.prod.yml' \
        ./ "$PACKAGE_DIR/offline-deploy/"

    print_success "文件打包完成"

    # 3. 创建离线部署脚本
    print_step "3/4" "创建离线部署脚本和说明"

    cat > "$PACKAGE_DIR/deploy.sh" << 'DEPLOY_SCRIPT'
#!/bin/bash
# ============================================================================
# yolo-label 离线部署脚本
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║          yolo-label 离线部署                            ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: 未安装 Docker，请先安装 Docker${NC}"
    exit 1
fi
# 检测 compose 命令（兼容 docker-compose 和 docker compose V2）
if command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version &>/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    echo -e "${RED}错误: 未安装 Docker Compose，请先安装${NC}"
    exit 1
fi

# 检查并处理已有部署
EXISTING=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" || true)
if [ -n "$EXISTING" ]; then
    echo -e "${YELLOW}检测到已有的 yolo-label 容器：${NC}"
    docker ps -a --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
    echo ""
    echo -e "  ${CYAN}1)${NC} 保留数据，重新部署"
    echo -e "  ${CYAN}2)${NC} 清除数据，全新部署"
    echo -e "  ${CYAN}3)${NC} 退出"
    read -r -p "请选择 [1/2/3]: " choice
    case "$choice" in
        1)
            echo "停止旧服务..."
            cd offline-deploy 2>/dev/null || true
            $DOCKER_COMPOSE -f docker-compose.yml -f docker-compose.gpu.yml down 2>/dev/null || true
            $DOCKER_COMPOSE -f docker-compose.yml down 2>/dev/null || true
            cd "$SCRIPT_DIR"
            docker ps -a --format '{{.Names}}' | grep "yolo-label" | xargs -r docker stop 2>/dev/null || true
            docker ps -a --format '{{.Names}}' | grep "yolo-label" | xargs -r docker rm -f 2>/dev/null || true
            ;;
        2)
            echo "清除旧部署..."
            cd offline-deploy 2>/dev/null || true
            $DOCKER_COMPOSE -f docker-compose.yml -f docker-compose.gpu.yml down -v 2>/dev/null || true
            $DOCKER_COMPOSE -f docker-compose.yml down -v 2>/dev/null || true
            cd "$SCRIPT_DIR"
            docker ps -a --format '{{.Names}}' | grep "yolo-label" | xargs -r docker stop 2>/dev/null || true
            docker ps -a --format '{{.Names}}' | grep "yolo-label" | xargs -r docker rm -f 2>/dev/null || true
            docker volume ls --format '{{.Name}}' | grep -E "(yolo-label|afa-label)" | xargs -r docker volume rm -f 2>/dev/null || true
            ;;
        *)
            echo "退出"
            exit 0
            ;;
    esac
    sleep 2
fi

# 1. 导入 Docker 镜像
echo ""
echo -e "${GREEN}步骤 1: 导入 Docker 镜像...${NC}"
if [ -f "yolo-label-images.tar.gz" ]; then
    echo "解压并导入镜像（可能需要几分钟）..."
    gunzip -c yolo-label-images.tar.gz | docker load
elif [ -f "yolo-label-images.tar" ]; then
    echo "导入镜像（可能需要几分钟）..."
    docker load < yolo-label-images.tar
else
    echo -e "${RED}错误: 未找到镜像文件${NC}"
    exit 1
fi
echo -e "${GREEN}✔ 镜像导入完成${NC}"

# 2. 进入项目目录
if [ -d "offline-deploy" ]; then
    cd offline-deploy
fi

# 3. 检查 GPU 并选择是否启用
echo ""
echo -e "${GREEN}步骤 2: 检查 GPU 支持...${NC}"
ENABLE_GPU=false
if command -v nvidia-smi &> /dev/null; then
    if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &> /dev/null 2>&1; then
        echo -e "${GREEN}✔ 检测到 NVIDIA GPU 且容器可用${NC}"
        read -r -p "是否启用 GPU 加速？[Y/n]: " gpu_choice
        gpu_choice="${gpu_choice:-Y}"
        if [[ "$gpu_choice" =~ ^[Yy]$ ]]; then
            ENABLE_GPU=true
        fi
    else
        echo -e "${YELLOW}⚠ 检测到 GPU 但容器不可用，将使用 CPU 模式${NC}"
    fi
else
    echo "未检测到 GPU，将使用 CPU 模式"
fi

# 4. 启动服务
echo ""
echo -e "${GREEN}步骤 3: 启动服务...${NC}"
if [ "$ENABLE_GPU" = true ] && [ -f "docker-compose.gpu.yml" ]; then
    $DOCKER_COMPOSE -f docker-compose.yml -f docker-compose.gpu.yml up -d
else
    $DOCKER_COMPOSE -f docker-compose.yml up -d
fi
echo -e "${GREEN}✔ 服务已启动${NC}"

# 5. 等待并初始化数据库
echo ""
echo -e "${GREEN}步骤 4: 初始化数据库...${NC}"
sleep 10
max_retries=5
retry=0
while [ $retry -lt $max_retries ]; do
    if docker exec yolo-label-backend python init_db.py 2>&1 | grep -q "创建成功\|已存在"; then
        echo -e "${GREEN}✔ 数据库初始化完成${NC}"
        break
    else
        retry=$((retry + 1))
        echo "等待数据库就绪... ($retry/$max_retries)"
        sleep 5
    fi
done

if [ $retry -eq $max_retries ]; then
    echo -e "${YELLOW}⚠ 数据库初始化可能失败，请手动检查:${NC}"
    echo "  docker exec -it yolo-label-backend python init_db.py"
fi

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║            ✔ 部署完成！                                 ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  访问地址:"
echo -e "    前端界面  ${CYAN}http://localhost:3000${NC}"
echo -e "    API 文档  ${CYAN}http://localhost:8000/docs${NC}"
echo ""
echo -e "  默认账号:  admin / admin123"
echo ""
echo -e "  常用命令:"
echo -e "    查看状态  docker-compose ps"
echo -e "    查看日志  docker logs -f yolo-label-backend"
echo -e "    停止服务  docker-compose down"
echo -e "    启动服务  $DOCKER_COMPOSE up -d"
echo ""
DEPLOY_SCRIPT
    chmod +x "$PACKAGE_DIR/deploy.sh"
    print_success "离线部署脚本已创建"

    # 创建 README
    cat > "$PACKAGE_DIR/README.md" << 'README_EOF'
# YOLO Label 离线部署包

## 部署步骤

1. 解压文件: `tar -xzf yolo-label-offline-*.tar.gz`
2. 进入目录: `cd yolo-label-offline-*`
3. 运行部署: `./deploy.sh`

## 重复部署

直接再次运行 `./deploy.sh`，脚本会自动检测并处理已有部署。

## 系统要求

- Linux (Ubuntu 22.04/24.04 推荐)
- Docker 20.10+
- Docker Compose 2.0+
- 至少 10GB 磁盘空间

## 访问地址

- 前端: http://localhost:3000
- API 文档: http://localhost:8000/docs
- 默认账号: admin / admin123
README_EOF
    print_success "README 已创建"

    # 4. 创建最终压缩包
    print_step "4/4" "创建最终压缩包"
    cd /tmp
    tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║            ✔ 打包完成！                                 ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}部署包位置：${NC}/tmp/${PACKAGE_NAME}.tar.gz"
    echo -e "  ${BOLD}文件大小：  ${NC}$(du -h "/tmp/${PACKAGE_NAME}.tar.gz" | cut -f1)"
    echo ""
    echo -e "  ${BOLD}使用方法：${NC}"
    echo -e "    1. 传输到目标服务器"
    echo -e "    2. tar -xzf ${PACKAGE_NAME}.tar.gz"
    echo -e "    3. cd ${PACKAGE_NAME}"
    echo -e "    4. ./deploy.sh"
    echo ""
}

# ======================== 离线环境部署 ========================
cmd_offline_deploy() {
    print_banner
    echo -e "  ${BOLD}模式：${CYAN}离线环境部署${NC}"

    cd "$SCRIPT_DIR"

    # 检查 Docker
    if ! command -v docker &> /dev/null; then
        print_error "未安装 Docker，请先安装 Docker"
        exit 1
    fi
    if [ -z "$DOCKER_COMPOSE" ]; then
        print_error "未安装 Docker Compose，请先安装"
        exit 1
    fi

    # 检查已有部署
    if has_any_containers; then
        print_warning "检测到已有的 yolo-label 容器："
        docker ps -a --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
        echo ""
        echo -e "  ${CYAN}1)${NC} 保留数据，重新部署（${GREEN}推荐${NC}）"
        echo -e "  ${CYAN}2)${NC} 清除数据，全新部署（${RED}删除所有数据${NC}）"
        echo -e "  ${CYAN}3)${NC} 退出"
        local choice
        read -r -p "$(echo -e "  ${YELLOW}?${NC} 请选择 [1/2/3]（默认 1）: ")" choice
        choice="${choice:-1}"
        case "$choice" in
            1)
                print_info "停止旧服务..."
                stop_containers "$COMPOSE_BASE"
                print_success "旧服务已停止"
                ;;
            2)
                print_info "清除旧部署..."
                cleanup_all_test
                print_success "旧部署已清除"
                ;;
            *)
                print_info "退出"
                exit 0
                ;;
        esac
    fi

    # 导入 Docker 镜像
    print_step "1/3" "导入 Docker 镜像"
    if [ -f "$SCRIPT_DIR/yolo-label-images.tar.gz" ]; then
        print_info "解压并导入镜像（可能需要几分钟）..."
        gunzip -c "$SCRIPT_DIR/yolo-label-images.tar.gz" | docker load
    elif [ -f "$SCRIPT_DIR/yolo-label-images.tar" ]; then
        print_info "导入镜像（可能需要几分钟）..."
        docker load < "$SCRIPT_DIR/yolo-label-images.tar"
    else
        print_error "未找到镜像文件 (yolo-label-images.tar 或 yolo-label-images.tar.gz)"
        print_info "请确保镜像文件在当前目录: $SCRIPT_DIR"
        exit 1
    fi
    print_success "镜像导入完成"

    # 检查 GPU
    print_step "2/3" "检查 GPU 支持"
    if command -v nvidia-smi &> /dev/null; then
        print_success "检测到 NVIDIA GPU"
        if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &> /dev/null 2>&1; then
            print_success "NVIDIA Container Toolkit 已安装"
        else
            print_warning "GPU 功能不可用，将使用 CPU 模式"
        fi
    else
        print_info "未检测到 GPU，将使用 CPU 模式"
    fi

    # 启动服务
    print_step "3/3" "启动服务并初始化"
    print_info "启动服务..."
    $DOCKER_COMPOSE -f "$COMPOSE_BASE" up -d
    print_success "服务已启动"

    sleep 10
    wait_for_db
    wait_for_backend
    init_database

    echo ""
    ENABLE_GPU=false
    local all_healthy=true
    health_check "$DEFAULT_FRONTEND_PORT" "$DEFAULT_BACKEND_PORT" || all_healthy=false

    echo ""
    echo -e "  ${BOLD}访问地址：${NC}"
    echo -e "    前端界面  ${CYAN}http://localhost:${DEFAULT_FRONTEND_PORT}${NC}"
    echo -e "    API 文档  ${CYAN}http://localhost:${DEFAULT_BACKEND_PORT}/docs${NC}"
    echo ""
    echo -e "  ${BOLD}默认账号：${NC}admin / admin123"
    echo ""
    echo -e "  ${BOLD}常用命令：${NC}"
    echo -e "    查看状态  ${DIM}docker-compose ps${NC}"
    echo -e "    查看日志  ${DIM}docker logs -f yolo-label-backend${NC}"
    echo -e "    停止服务  ${DIM}docker-compose down${NC}"
    echo ""
}

# ======================== 查看服务状态 ========================
cmd_status() {
    echo ""
    echo -e "${BOLD}  yolo-label 服务状态${NC}"
    echo ""

    if ! has_any_containers; then
        print_info "未检测到任何 yolo-label 容器"
        print_info "部署生产环境: ./manage.sh prod deploy"
        print_info "部署测试环境: ./manage.sh test deploy"
        return
    fi

    # 显示容器状态
    echo -e "  ${BOLD}容器状态：${NC}"
    echo ""
    docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(NAMES|yolo-label)" || true
    echo ""

    # 判断环境类型
    if [ -f "$COMPOSE_PROD" ]; then
        print_info "检测到生产环境配置"
        if load_prod_config; then
            echo -e "    前端端口: ${CYAN}${FRONTEND_PORT}${NC}"
            echo -e "    后端端口: ${CYAN}${BACKEND_PORT}${NC}"
            echo -e "    GPU 加速: ${CYAN}${ENABLE_GPU}${NC}"
        fi
    else
        print_info "检测到测试/开发环境配置"
        load_test_env
        echo -e "    前端端口: ${CYAN}${DEFAULT_FRONTEND_PORT}${NC}"
        echo -e "    后端端口: ${CYAN}${DEFAULT_BACKEND_PORT}${NC}"
        echo -e "    GPU 加速: ${CYAN}${ENABLE_GPU}${NC}"
    fi

    # 磁盘使用
    echo ""
    echo -e "  ${BOLD}数据卷使用：${NC}"
    echo ""
    docker system df -v 2>/dev/null | grep -E "(VOLUME NAME|yolo-label|afa-label)" || print_info "无相关数据卷"
    echo ""
}

# ======================== 查看服务日志 ========================
cmd_logs() {
    local service="${1:-}"

    if [ -n "$service" ]; then
        local container="yolo-label-${service}"
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
            docker logs -f --tail 100 "$container"
        else
            print_error "未找到容器: ${container}"
            print_info "可用容器:"
            docker ps -a --format '{{.Names}}' 2>/dev/null | grep "yolo-label" | while read -r name; do
                echo "    - ${name#yolo-label-}"
            done
        fi
    else
        # 显示所有服务日志
        if [ -f "$COMPOSE_PROD" ]; then
            $DOCKER_COMPOSE -f "$COMPOSE_PROD" logs -f --tail 50
        elif has_any_containers; then
            $DOCKER_COMPOSE $(get_compose_test_args) logs -f --tail 50
        else
            print_error "未检测到运行中的服务"
        fi
    fi
}

# ======================== 帮助信息 ========================
cmd_help() {
    echo ""
    echo -e "${CYAN}${BOLD}yolo-label 统一管理脚本${NC}"
    echo ""
    echo -e "${BOLD}用法：${NC}"
    echo -e "  ./manage.sh <环境> <操作>"
    echo ""
    echo -e "${BOLD}生产环境命令：${NC}"
    echo -e "  ${CYAN}prod deploy${NC}      首次生产环境部署（完整交互式设置：Docker/GPU/密码/端口）"
    echo -e "  ${CYAN}prod redeploy${NC}    重复生产环境部署（复用已有配置，可选保留/清除数据）"
    echo -e "  ${CYAN}prod restart${NC}     生产环境重启（仅重启服务，不重新构建）"
    echo -e "  ${CYAN}prod clean${NC}       生产环境清理（删除所有容器、数据卷、配置文件）"
    echo ""
    echo -e "${BOLD}测试环境命令：${NC}"
    echo -e "  ${CYAN}test deploy${NC}      首次测试环境部署（使用默认配置，支持热重载）"
    echo -e "  ${CYAN}test redeploy${NC}    重复测试环境部署（重新构建镜像并启动）"
    echo -e "  ${CYAN}test restart${NC}     测试环境重启（仅重启服务，不重新构建）"
    echo -e "  ${CYAN}test clean${NC}       测试环境清理（删除所有容器和数据卷）"
    echo ""
    echo -e "${BOLD}离线部署命令：${NC}"
    echo -e "  ${CYAN}offline package${NC}  离线环境打包（导出镜像+项目文件为 tar.gz）"
    echo -e "  ${CYAN}offline deploy${NC}   离线环境部署（导入镜像并启动，支持重复部署）"
    echo ""
    echo -e "${BOLD}其他命令：${NC}"
    echo -e "  ${CYAN}status${NC}           查看所有服务状态"
    echo -e "  ${CYAN}logs${NC} [服务名]    查看服务日志（可选: backend, frontend, db, redis, celery-worker）"
    echo -e "  ${CYAN}help${NC}             显示此帮助信息"
    echo ""
    echo -e "${BOLD}示例：${NC}"
    echo -e "  ${DIM}# 首次在生产服务器部署${NC}"
    echo -e "  ./manage.sh prod deploy"
    echo ""
    echo -e "  ${DIM}# 更新代码后重新部署生产环境${NC}"
    echo -e "  ./manage.sh prod redeploy"
    echo ""
    echo -e "  ${DIM}# 本地启动测试环境${NC}"
    echo -e "  ./manage.sh test deploy"
    echo ""
    echo -e "  ${DIM}# 打包离线部署包${NC}"
    echo -e "  ./manage.sh offline package"
    echo ""
    echo -e "  ${DIM}# 查看后端日志${NC}"
    echo -e "  ./manage.sh logs backend"
    echo ""
}

# ======================== 主入口 ========================
main() {
    cd "$SCRIPT_DIR"

    local env="${1:-}"
    local action="${2:-}"
    local extra="${3:-}"

    case "$env" in
        prod)
            case "$action" in
                deploy)     cmd_prod_deploy ;;
                redeploy)   cmd_prod_redeploy ;;
                restart)    cmd_prod_restart ;;
                clean)      cmd_prod_clean ;;
                *)
                    print_error "未知的生产环境操作: ${action:-<空>}"
                    echo -e "  可用操作: deploy, redeploy, restart, clean"
                    echo -e "  查看帮助: ./manage.sh help"
                    exit 1
                    ;;
            esac
            ;;
        test)
            case "$action" in
                deploy)     cmd_test_deploy ;;
                redeploy)   cmd_test_redeploy ;;
                restart)    cmd_test_restart ;;
                clean)      cmd_test_clean ;;
                *)
                    print_error "未知的测试环境操作: ${action:-<空>}"
                    echo -e "  可用操作: deploy, redeploy, restart, clean"
                    echo -e "  查看帮助: ./manage.sh help"
                    exit 1
                    ;;
            esac
            ;;
        offline)
            case "$action" in
                package)    cmd_offline_package ;;
                deploy)     cmd_offline_deploy ;;
                *)
                    print_error "未知的离线操作: ${action:-<空>}"
                    echo -e "  可用操作: package, deploy"
                    echo -e "  查看帮助: ./manage.sh help"
                    exit 1
                    ;;
            esac
            ;;
        status)     cmd_status ;;
        logs)       cmd_logs "$action" ;;
        help|--help|-h)  cmd_help ;;
        "")
            cmd_help
            ;;
        *)
            print_error "未知命令: ${env}"
            echo -e "  查看帮助: ./manage.sh help"
            exit 1
            ;;
    esac
}

main "$@"
