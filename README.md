# 🧰 Toolbox - 实用工具集合

一个基于 Vue 3 + Express 的实用工具集合，提供多种常用工具，以悬浮窗口形式交互，界面简洁美观。

## ✨ 功能介绍

| 工具 | 说明 |
|------|------|
| 🦕 小恐龙 | Chrome 离线小游戏，支持高分记录保存 |
| 🧮 科学计算器 | 支持复杂表达式计算，历史记录自动保存 |
| 📈 Desmos | 强大的图形计算器，支持函数绘图、保存/加载图形 |
| 🎨 画板 | 简易绘图工具，支持画笔、橡皮擦，可保存作品 |
| ☁️ 云文件 | 文件管理器，支持上传、下载、重命名、删除、预览 |
| 📄 PDF 查看器 | 基于 pdf.js 的 PDF 阅读器，支持缩放、翻页 |
| 🖼 文件预览 | 支持图片、文本、视频、音频等多种格式预览 |
|   有道词典 | 英汉词典查询，支持联想建议、音标、发音播放 |

## 🚀 快速开始

### 环境要求
- Node.js ^20.19.0 或 >=22.12.0

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```
启动后访问 [http://localhost:5173](http://localhost:5173)，后端服务运行在 [http://localhost:8081](http://localhost:8081)

### 生产构建
```bash
npm run build
```
构建后的文件位于 `dist/` 目录

### 单独启动后端
```bash
npm run server
```

## ⚙️ 配置说明

部署后可通过修改 `config.json` 控制各工具的显示/隐藏，无需重新打包：

```json
{
  "dino": { "enabled": true },
  "calculator": { "enabled": true },
  "desmos": { "enabled": true },
  "drawing": { "enabled": true },
  "cloudfiles": { "enabled": true },
  "youdao": { "enabled": true }
}
```

将 `enabled` 设为 `false` 即可隐藏对应工具。

### 数据持久化

后端数据存储在以下目录，部署时注意备份或挂载持久化存储：

| 目录 | 内容 |
|------|------|
| `server/data/` | 计算器历史、高分记录等 |
| `server/drawings/` | 画板作品 |
| `server/desmos-saves/` | Desmos 图形 |
| `server/uploads/` | 云文件上传的文件 |

## 📦 从 GitHub Actions 部署

每次推送到 `main`/`master` 分支后，Actions 会自动构建并生成一个 Artifact。

### 1. 下载 Artifact

在仓库页面进入 **Actions → 对应的 workflow run → Artifacts**，下载 `toolbox-<分支>-<SHA>.zip` 并解压。

解压后目录结构：

```
release/
├── dist/           # 前端静态文件
├── server/         # 后端源码（含 package.json）
└── config.json     # 工具开关配置
```

### 2. 安装后端依赖

```bash
cd release/server
npm install --production
```

### 3. 配置 config.json

按需修改 `config.json` 开关各工具（详见下方[配置说明](#️-配置说明)）。

### 4. 启动后端

```bash
cd server
node index.js
```

后端默认监听 **8081** 端口，提供 `/api/*` 接口。

### 5. 部署前端静态文件

将 `dist/` 托管到任意静态文件服务器，并将 `/api` 请求反向代理到后端。

**Nginx 示例配置：**

```nginx
server {
    listen 80;
    root /path/to/release/dist;
    index index.html;

    # 前端路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 反向代理后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 6. 持久化数据目录

后端首次运行时会自动创建数据目录，升级部署时注意保留以下目录中的数据：

| 目录 | 内容 |
|------|------|
| `server/data/` | 计算器历史、高分记录等 |
| `server/drawings/` | 画板作品 |
| `server/desmos-saves/` | Desmos 图形 |
| `server/uploads/` | 云文件上传的文件 |

升级时只需覆盖 `dist/` 和 `server/`（源码部分），数据目录单独备份/挂载即可。

---

## 🛠 技术栈

### 前端
- [Vue 3](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Vite](https://vitejs.dev/) - 下一代前端构建工具

### 后端
- [Express](https://expressjs.com/) - Node.js Web 框架
- [Multer](https://github.com/expressjs/multer) - 文件上传处理

### 第三方库/组件

| 名称 | 用途 | 项目链接 |
|------|------|----------|
| pdfjs-dist | PDF 渲染引擎 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) |
| Chrome Dino | 小恐龙游戏（Chrome 离线页提取） | Chromium 开源项目 |
| Desmos | 图形计算器 | [desmos.com](https://www.desmos.com/) |

## 📁 项目结构

```
toolbox/
├── public/              # 静态资源
│   ├── dino/           # 小恐龙游戏文件
│   ├── desmos/         # Desmos 图形计算器
│   └── config.json     # 工具开关配置（部署后可修改）
├── server/             # Express 后端
│   ├── index.js        # 入口
│   └── routes/         # API 路由
├── src/
│   ├── components/     # Vue 组件
│   ├── main.js         # 入口
│   └── App.vue         # 主应用
└── package.json
```

## 📄 License

MIT License
