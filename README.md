# Screen Tracker

Electron 桌面截屏追踪器。每 20 秒捕获主屏幕截图，调用本地 Ollama 视觉模型 `qwen3-vl:8b-instruct` 分析用户当前活动，并将结果保存为结构化日志。

## 功能

- 每 20 秒自动截取主屏幕
- 通过 Ollama API 调用 `qwen3-vl:8b-instruct` 生成 5 句话活动摘要
- 截图保存为 JPEG，按月份组织：`data/screenshots/YYYY-MM/YYYYMMDD_HHMMSS.jpg`
- 分析日志按小时组织：`data/logs/YYYY-MM/YYYYMMDD_HH.json`
- 系统托盘运行，关闭窗口时最小化到托盘
- 暗色主题 UI，实时显示状态、统计和日志

## 前置要求

1. 安装 [Node.js](https://nodejs.org/)（推荐 v18+）
2. 安装并运行 [Ollama](https://ollama.com/)
3. 拉取视觉模型：

```bash
ollama pull qwen3-vl:8b-instruct
```

## 安装

```bash
cd D:\lifecode\screen-tracker
npm install
```

## 启动

```bash
npm start
```

应用启动 2 秒后会自动开始追踪。点击 UI 中的按钮或托盘菜单可控制追踪。

## 使用说明

- **启动追踪 / 停止追踪**：主界面按钮控制捕获循环
- **检查 Ollama**：手动检测 Ollama 连接状态
- **关闭窗口**：若正在追踪，窗口会隐藏到系统托盘；右键托盘图标选择"退出"可彻底关闭
- **托盘菜单**：左键点击显示/隐藏窗口，右键菜单可选择"显示窗口"或"退出"

## 项目结构

```
screen-tracker/
├── main.js              # Electron 主进程
├── preload.js           # 安全的 IPC 桥接
├── package.json         # 项目配置
├── gen_icon.js          # 生成托盘图标
├── assets/
│   └── icon.png         # 托盘图标
├── renderer/
│   ├── index.html       # 主界面
│   ├── renderer.js      # 渲染进程逻辑
│   └── style.css        # 界面样式
└── data/                # 运行时生成的截图与日志
    ├── screenshots/
    └── logs/
```

## 配置

在 `main.js` 顶部的 `CONFIG` 对象中可修改：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `interval` | 20000 | 截屏间隔（毫秒） |
| `model` | `qwen3-vl:8b-instruct` | Ollama 模型名称 |
| `ollamaHost` | `localhost` | Ollama 主机 |
| `ollamaPort` | 11434 | Ollama 端口 |
| `saveImageQuality` | 85 | 本地保存 JPEG 质量 |
| `ollamaImageWidth` | 1280 | 发送给 Ollama 的图片最大宽度 |
| `ollamaImageQuality` | 75 | 发送给 Ollama 的 JPEG 质量 |
| `ollamaTimeout` | 120000 | Ollama 请求超时（毫秒） |

## 日志格式

每小时 JSON 文件示例：

```json
[
  {
    "timestamp": "2026-08-02 15:08:01",
    "timestampMs": 1759410481000,
    "imagePath": "screenshots/2026-08/20260802_150801.jpg",
    "activity": "用户正在浏览网页。",
    "analysisTimeMs": 3250
  }
]
```

## 常见问题

- **Ollama 未连接**：请确认 Ollama 正在运行，且已拉取模型 `qwen3-vl:8b-instruct`
- **截图失败**：部分多显示器环境可能需要以管理员身份运行，或检查 `screenshot-desktop` 权限
- **分析耗时过长**：可降低 `ollamaImageWidth` 和 `ollamaImageQuality` 以减少传输和推理时间
