# Dreamina Web

> 面向 **即梦国际 / Dreamina** 的 Web 管理与生成功能项目，支持账号密码注册、管理员后台、任务管理，以及 Docker 多架构部署。

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Docker](https://img.shields.io/badge/Docker-multi--arch-2496ED.svg)

---

## 项目定位

这个项目的重点不是国内版即梦页面，而是 **即梦国际（Dreamina / CapCut）** 相关能力接入与管理。

当前代码已经围绕国际线路做了整理，包含：

- 支持账号密码注册/登录
- 管理员管理用户
- 管理员修改用户名/密码
- 管理员删除用户
- 账户池与会话管理相关能力
- 视频生成任务管理
- Docker 打包与 GitHub Actions 多架构镜像构建

---

## 技术栈

- 前端：React 19 + TypeScript + Vite
- 后端：Node.js + Express
- 数据库：SQLite
- 容器化：Docker / Docker Compose
- 镜像构建：GitHub Actions + buildx

---

## 运行方式

### 本地开发

```bash
npm run install:all
npm run dev
```

- 前端默认端口：`5173`
- 后端默认端口：`3001`

### 生产构建

```bash
npm run build
```

### Docker

```bash
docker compose up --build -d
```

---

## 主要功能

### 用户侧

- 账号密码注册
- 用户名 / 密码登录
- 视频生成
- 下载管理
- 设置管理

### 管理员侧

- 用户列表管理
- 删除用户
- 修改用户名
- 重置或修改密码
- 状态控制
- 系统统计

---

## Docker 多架构

项目已加入多架构镜像构建支持：

- `linux/amd64`
- `linux/arm64`

GitHub Actions 工作流文件：

```text
.github/workflows/docker.yml
```

推送到 GitHub 后，可在 Actions 中自动构建镜像。

---

## 仓库说明

当前仓库建议作为你自己的独立项目使用，不再保留上游仓库历史。

如果你需要让 GitHub 首页显示你自己的项目说明，核心是两部分：

1. `README.md`：仓库主页正文内容
2. GitHub 仓库右侧 `About`：仓库简介、链接、标签

本次已经把 `README.md` 改成以 **Dreamina / 即梦国际** 为重点的版本。

---

## 目录示例

```text
.
├── src/                     # 前端
├── server/                  # 后端
├── .github/workflows/       # CI / Docker 构建
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 说明

本项目当前以实际部署和管理功能为主，README 也已去掉原仓库的宣传内容、体验地址与外部文章链接，便于作为你自己的仓库继续维护。
