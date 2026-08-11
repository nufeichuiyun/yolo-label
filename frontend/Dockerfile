FROM node:20-alpine

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 按锁文件安装依赖，确保本地与服务器版本一致
RUN npm ci

# 复制应用代码
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
