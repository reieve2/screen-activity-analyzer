'use strict'

// ==================== Imports ====================
const { app, BrowserWindow, ipcMain, nativeImage, Tray, Menu, Notification, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const screenshot = require('screenshot-desktop')

// ==================== Configuration ====================
// 打包后 __dirname 指向 app.asar（只读），数据目录改用 userData 路径
const _dataRoot = app.getPath('userData')
const CONFIG = {
    interval: 35000,                    // 截屏间隔 (ms) = 35秒（2026-09-22 由 20 秒调大：和本地 AI 抢 GPU）
  ollamaHost: '127.0.0.1',           // 用 IPv4 地址，避免 localhost 解析为 ::1 导致连不上
  ollamaPort: 11434,
  // Ollama 模型名称（必须是支持图像输入的视觉模型）
  // 可用环境变量 SCREEN_TRACKER_MODEL 覆盖，便于按机器性能切换而不改代码
  model: process.env.SCREEN_TRACKER_MODEL || 'qwen3-vl:8b-instruct',
  dataDir: path.join(_dataRoot, 'data'),
  screenshotsDir: path.join(_dataRoot, 'data', 'screenshots'),
  logsDir: path.join(_dataRoot, 'data', 'logs'),
  saveImageQuality: 85,               // 保存到磁盘的 JPEG 质量
    ollamaImageWidth: 800,              // 发送给 Ollama 的图片最大宽度（2026-09-22 由 1280 降到 800：图片 token 约减半，预填充快很多）
  ollamaImageQuality: 75,             // 发送给 Ollama 的 JPEG 质量
  ollamaTimeout: 120000,              // Ollama 请求超时 (ms)
  prompt: '请仔细观察这张电脑截屏图片，用简短的5句话总结用户当前正在做什么。每句话描述一个方面，直接输出5句话，用句号分隔，不要加编号或其他格式。',
  autoStart: true,                    // 启动后自动开始追踪
  aggregationInterval: 10 * 60 * 1000, // 10分钟汇总间隔 (ms)
  summaries10MinDir: path.join(_dataRoot, 'data', 'summaries', '10min'),
  aggregationTimeout: 180000,         // 汇总请求超时 (ms)
  diaryDir: path.join(_dataRoot, 'data', 'summaries', 'diary'),
  diaryTimeout: 300000,               // 日记生成超时 (ms)
  qaTimeout: 120000,                  // 问答 LLM 调用超时 (ms)
  idlePauseSec: 300,                  // 无键盘/鼠标输入超过该秒数则自动暂停采集（0 = 关闭）
  skipUnchanged: true,                // 画面与上一张基本相同则跳过 Ollama 推理
  unchangedThreshold: 4,              // 画面差异阈值 (0-255)，越大越宽松。
                                      // 实测（16x9 亮度网格，真实截图 390 组相邻对比）：
                                      // 画面静止时差异 < 1，真实切换窗口时 > 8，取 4 作为保守分界
  savedImageWidth: 1280               // 落盘截图的宽度（0 = 保持原始尺寸）
}

// ==================== Global State ====================
let mainWindow = null
let historyWindow = null
let tray = null
let isQuitting = false
let isTracking = false
let captureTimer = null
let ollamaConnected = false

let stats = {
  totalCaptures: 0,
  totalAnalyses: 0,
  totalErrors: 0,
  totalSkipped: 0,
  startTime: null
}

let lastCapture = {
  timestamp: null,
  imagePath: null,
  activity: null,
  analysisTime: 0
}

let recentLogs = []
const MAX_LOGS = 100

// 自动暂停状态（空闲 / 锁屏 / 休眠）
// 目的：停止向 Ollama 发请求，让模型在 keep_alive 到期后自动卸载，把内存还给系统
let isPaused = false
let pauseReason = ''
let idleCheckTimer = null

// 上一次截图的画面网格，用于判断"画面是否基本没变"
let lastFrameGrid = null

// 10分钟汇总状态
let isAggregating = false
let aggregationQueue = []
let aggregationTimer = null
let currentAggregation = null  // { periodStartMs, periodEndMs }
let totalAggregationQueue = 0  // 队列初始总数（用于显示进度）

// 日记生成状态
let isGeneratingDiary = false
let diaryQueue = []
let currentDiaryDate = null
let totalDiaryQueue = 0

// ==================== Utility Functions ====================

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatTimestamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function getMonthFolder(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function getDateStr(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function getHourFileName(date) {
  return `${getDateStr(date)}_${pad(date.getHours())}.json`
}

function getScreenshotName(date) {
  return `${getDateStr(date)}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.jpg`
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function addLog(level, message) {
  const entry = {
    time: formatTimestamp(new Date()),
    level,
    message
  }
  recentLogs.unshift(entry)
  if (recentLogs.length > MAX_LOGS) recentLogs.pop()
  sendToRenderer('log', entry)
  console.log(`[${level.toUpperCase()}] ${message}`)
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function sendStatusUpdate() {
  sendToRenderer('status-update', {
    isRunning: isTracking,
    paused: isPaused,
    pauseReason,
    ollamaConnected,
    stats: { ...stats },
    lastCapture: { ...lastCapture },
    timestamp: formatTimestamp(new Date())
  })
}

// ==================== Screenshot Capture ====================

async function captureScreenshot() {
  // screenshot-desktop 返回 PNG Buffer
  const buffer = await screenshot({ format: 'png' })
  return buffer
}

// ==================== Image Processing ====================

// 注意：以下两个函数接收已经解码好的 nativeImage（而不是原始 Buffer）。
// 原实现让两者各自 createFromBuffer，同一张截图会被解码成两份全尺寸位图
// （2560x1440 每份约 14.7 MB），这里改为调用方解码一次后复用。
function saveImageToDisk(img, date) {
  const size = img.getSize()
  const targetWidth = CONFIG.savedImageWidth
  const out = (targetWidth > 0 && size.width > targetWidth)
    ? img.resize({ width: targetWidth, quality: 'good' })
    : img
  const jpegBuffer = out.toJPEG(CONFIG.saveImageQuality)

  const monthFolder = getMonthFolder(date)
  const dir = path.join(CONFIG.screenshotsDir, monthFolder)
  ensureDir(dir)

  const filename = getScreenshotName(date)
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, jpegBuffer)

  // 返回相对路径 (相对于 data 目录)
  return path.join('screenshots', monthFolder, filename)
}

function prepareImageForOllama(img) {
  const size = img.getSize()

  let resized = img
  if (size.width > CONFIG.ollamaImageWidth) {
    resized = img.resize({ width: CONFIG.ollamaImageWidth })
  }

  return resized.toJPEG(CONFIG.ollamaImageQuality).toString('base64')
}

// ==================== 画面变化检测 ====================
// 把截图缩到 64px 宽，切成 16x9 网格取平均亮度，得到指纹。
// 用网格平均值而不是完整哈希，是为了对时钟、闪烁光标这类小变化不敏感，
// 只判断"整屏画面是否基本没变"，从而跳过整次 Ollama 推理。
function computeFrameGrid(img) {
  const small = img.resize({ width: 64, quality: 'good' })
  const { width, height } = small.getSize()
  const bmp = small.toBitmap() // BGRA 原始像素

  const COLS = 16
  const ROWS = 9
  const cellW = Math.max(1, Math.floor(width / COLS))
  const cellH = Math.max(1, Math.floor(height / ROWS))
  const grid = []

  for (let gy = 0; gy < ROWS; gy++) {
    for (let gx = 0; gx < COLS; gx++) {
      const x0 = gx * cellW
      const y0 = gy * cellH
      let sum = 0
      let count = 0

      for (let y = y0; y < y0 + cellH; y += 2) {
        for (let x = x0; x < x0 + cellW; x += 2) {
          const px = (y * width + x) * 4
          // BGRA → 粗略亮度
          sum += bmp[px] * 0.114 + bmp[px + 1] * 0.587 + bmp[px + 2] * 0.299
          count++
        }
      }

      grid.push(count ? sum / count : 0)
    }
  }

  return grid
}

function framesAreSimilar(a, b, threshold) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i])
  }
  return (diff / a.length) < threshold
}

// ==================== Ollama API ====================

function callOllama(imageBase64) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: CONFIG.model,
      messages: [{
        role: 'user',
        content: CONFIG.prompt,
        images: [imageBase64]
      }],
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9
      }
    })

    const options = {
      hostname: CONFIG.ollamaHost,
      port: CONFIG.ollamaPort,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }

    const req = http.request(options, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama API 返回 ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(body)
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve({
              content: result.message ? result.message.content : '',
              evalCount: result.eval_count || 0
            })
          }
        } catch (e) {
          reject(new Error(`解析 Ollama 响应失败: ${e.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(CONFIG.ollamaTimeout, () => {
      req.destroy(new Error('Ollama 请求超时'))
    })
    req.write(requestBody)
    req.end()
  })
}

async function checkOllamaStatus() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: CONFIG.ollamaHost,
      port: CONFIG.ollamaPort,
      path: '/api/version',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve({ connected: true, version: JSON.parse(body).version })
          } catch {
            resolve({ connected: true, version: 'unknown' })
          }
        } else {
          resolve({ connected: false, version: null })
        }
      })
    })

    req.on('error', () => resolve({ connected: false, version: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ connected: false, version: null })
    })
    req.end()
  })
}

// ==================== File Management ====================

function saveLogEntry(entry, date) {
  const monthFolder = getMonthFolder(date)
  const dir = path.join(CONFIG.logsDir, monthFolder)
  ensureDir(dir)

  const filename = getHourFileName(date)
  const filepath = path.join(dir, filename)

  let entries = []
  if (fs.existsSync(filepath)) {
    try {
      entries = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
      if (!Array.isArray(entries)) entries = []
    } catch {
      entries = []
    }
  }

  entries.push(entry)
  fs.writeFileSync(filepath, JSON.stringify(entries, null, 2), 'utf-8')
  return filepath
}

// ==================== 10-Minute Aggregation System ====================

function get10MinPeriodStart(date) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  d.setMinutes(Math.floor(d.getMinutes() / 10) * 10)
  return d
}

function get10MinPeriodEnd(periodStart) {
  return new Date(periodStart.getTime() + 10 * 60 * 1000)
}

function get10MinPeriodKey(date) {
  const d = get10MinPeriodStart(date)
  return `${getDateStr(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function get10MinSummaryFilePath(periodStartMs) {
  const d = new Date(periodStartMs)
  const monthFolder = getMonthFolder(d)
  const dir = path.join(CONFIG.summaries10MinDir, monthFolder)
  return path.join(dir, `${get10MinPeriodKey(d)}.json`)
}

function load10MinSummary(periodStartMs) {
  const filePath = get10MinSummaryFilePath(periodStartMs)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function save10MinSummary(summary) {
  const d = new Date(summary.periodStartMs)
  const monthFolder = getMonthFolder(d)
  const dir = path.join(CONFIG.summaries10MinDir, monthFolder)
  ensureDir(dir)
  const filePath = get10MinSummaryFilePath(summary.periodStartMs)
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8')
}

function getEntriesInPeriod(startMs, endMs) {
  const entries = []
  let currentMs = startMs

  while (currentMs < endMs) {
    const currentDate = new Date(currentMs)
    const monthFolder = getMonthFolder(currentDate)
    const monthPath = path.join(CONFIG.logsDir, monthFolder)
    const fileName = `${getDateStr(currentDate)}_${pad(currentDate.getHours())}.json`
    const filePath = path.join(monthPath, fileName)

    if (fs.existsSync(filePath)) {
      try {
        const hourEntries = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (Array.isArray(hourEntries)) {
          entries.push(...hourEntries.filter(e =>
            e.timestampMs >= startMs && e.timestampMs < endMs
          ))
        }
      } catch { /* skip */ }
    }

    // 移动到下一个小时
    currentMs = new Date(
      currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(),
      currentDate.getHours() + 1, 0, 0, 0
    ).getTime()
  }

  return entries.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
}

function getAll10MinSummaries() {
  const summaries = []
  const baseDir = CONFIG.summaries10MinDir

  if (!fs.existsSync(baseDir)) return summaries

  const monthDirs = fs.readdirSync(baseDir).filter(name => {
    return fs.statSync(path.join(baseDir, name)).isDirectory() && /^\d{4}-\d{2}$/.test(name)
  })

  for (const monthDir of monthDirs) {
    const monthPath = path.join(baseDir, monthDir)
    const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'))

    for (const file of files) {
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(monthPath, file), 'utf-8'))
        if (summary && summary.periodStartMs) {
          summaries.push(summary)
        }
      } catch { /* skip */ }
    }
  }

  return summaries.sort((a, b) => (b.periodStartMs || 0) - (a.periodStartMs || 0))
}

function findUnprocessedPeriods() {
  const periods = new Map() // periodStartMs -> entryCount

  if (!fs.existsSync(CONFIG.logsDir)) return []

  const monthDirs = fs.readdirSync(CONFIG.logsDir).filter(name => {
    return fs.statSync(path.join(CONFIG.logsDir, name)).isDirectory() && /^\d{4}-\d{2}$/.test(name)
  })

  for (const monthDir of monthDirs) {
    const monthPath = path.join(CONFIG.logsDir, monthDir)
    const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'))

    for (const file of files) {
      try {
        const entries = JSON.parse(fs.readFileSync(path.join(monthPath, file), 'utf-8'))
        if (!Array.isArray(entries)) continue

        for (const entry of entries) {
          if (!entry.timestampMs) continue
          const periodStart = get10MinPeriodStart(new Date(entry.timestampMs))
          const key = periodStart.getTime()
          if (!periods.has(key)) {
            periods.set(key, { periodStartMs: key, count: 0 })
          }
          periods.get(key).count++
        }
      } catch { /* skip */ }
    }
  }

  // 过滤掉已有 summary 的周期
  const unprocessed = []
  for (const [key, info] of periods) {
    if (!load10MinSummary(key)) {
      unprocessed.push(info)
    }
  }

  return unprocessed.sort((a, b) => a.periodStartMs - b.periodStartMs)
}

function sendAggregationStatus() {
  const status = {
    isAggregating,
    current: currentAggregation,
    queueRemaining: aggregationQueue.length,
    queueTotal: totalAggregationQueue
  }
  sendToRenderer('aggregation-status', status)
}

async function callOllamaForAggregation(prompt) {
  const requestBody = JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    options: { temperature: 0.4, top_p: 0.9 }
  })

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CONFIG.ollamaHost,
      port: CONFIG.ollamaPort,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama 返回 ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(body)
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result.message ? result.message.content : '')
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(CONFIG.aggregationTimeout, () => {
      req.destroy(new Error('汇总请求超时'))
    })
    req.write(requestBody)
    req.end()
  })
}

function parseAggregationResult(content) {
  // 尝试直接解析 JSON
  let parsed = null
  try {
    parsed = JSON.parse(content)
  } catch {
    // 尝试去掉 markdown 代码块
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try {
        parsed = JSON.parse(match[1].trim())
      } catch { /* */ }
    }
    // 尝试找到第一个 { 和最后一个 }
    if (!parsed) {
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start !== -1 && end !== -1) {
        try {
          parsed = JSON.parse(content.substring(start, end + 1))
        } catch { /* */ }
      }
    }
  }

  if (!parsed) return null

  return {
    projectName: parsed.projectName || '未知项目',
    category: ['工作', '娱乐', '学习', '社交'].includes(parsed.category) ? parsed.category : '工作',
    description: parsed.description || '',
    softwareUsed: Array.isArray(parsed.softwareUsed) ? parsed.softwareUsed : [],
    todoItems: Array.isArray(parsed.todoItems) ? parsed.todoItems : []
  }
}

async function aggregatePeriod(periodStartMs) {
  const periodStart = new Date(periodStartMs)
  const periodEnd = get10MinPeriodEnd(periodStart)
  const entries = getEntriesInPeriod(periodStartMs, periodEnd.getTime())

  if (entries.length === 0) {
    return { success: false, error: '该时间段没有记录' }
  }

  // 获取上一个10分钟的 summary（用于项目名称连续性）
  const prevPeriodStartMs = periodStartMs - 10 * 60 * 1000
  const prevSummary = load10MinSummary(prevPeriodStartMs)
  const prevProjectName = prevSummary ? prevSummary.projectName : '（无上一个10分钟记录）'

  // 构建活动记录文本
  const activitiesText = entries.map(e => {
    const time = e.timestamp ? e.timestamp.substring(11) : '未知时间'
    return `[${time}] ${e.activity || '无描述'}`
  }).join('\n')

  const prompt = `你是一个活动分析助手。请分析用户在过去10分钟内的电脑活动记录，输出结构化的JSON。

上一个10分钟分析的项目名称是："${prevProjectName}"
（如果当前活动与上一个10分钟相同，请使用相同的项目名称）

时间范围：${formatTimestamp(periodStart)} 到 ${formatTimestamp(periodEnd)}
活动记录条数：${entries.length}

活动记录：
${activitiesText}

请分析并输出严格的JSON格式（不要包含markdown代码块标记，不要包含任何其他文本）：

{"projectName":"用户正在做的项目名称（如'玩《荒野大镖客》'、'写《2026年中报告》'、'开发Screen Tracker'，如果和上一个10分钟相同请用相同的名字）","category":"工作","description":"约1000字的详细描述，分析用户在这10分钟内具体做了什么，包括操作细节、使用工具、浏览内容等","softwareUsed":["软件1","软件2"],"todoItems":["可能遗漏的重要待办事项1","待办事项2"]}

注意：
- category 只能是：工作、娱乐、学习、社交 之一
- projectName 要简洁明确
- description 要详细，约1000字
- softwareUsed 是这10分钟内使用到的所有软件名称
- todoItems 是可能遗漏的重要待办事项，如果没有则为空数组 []`

  let content
  try {
    content = await callOllamaForAggregation(prompt)
  } catch (err) {
    return { success: false, error: err.message }
  }

  const parsed = parseAggregationResult(content)
  if (!parsed) {
    return { success: false, error: '解析AI输出失败', rawContent: content.substring(0, 500) }
  }

  const summary = {
    periodStartMs,
    periodEndMs: periodEnd.getTime(),
    periodStart: formatTimestamp(periodStart),
    periodEnd: formatTimestamp(periodEnd),
    entryCount: entries.length,
    ...parsed,
    generatedAt: formatTimestamp(new Date())
  }

  save10MinSummary(summary)
  return { success: true, summary }
}

async function processAggregationQueue() {
  if (isAggregating || aggregationQueue.length === 0) return

  // 检查 Ollama 连接
  const status = await checkOllamaStatus()
  if (!status.connected) {
    addLog('warn', 'Ollama 未连接，暂停汇总队列处理')
    // 5分钟后重试
    setTimeout(() => processAggregationQueue(), 5 * 60 * 1000)
    return
  }

  const item = aggregationQueue.shift()
  currentAggregation = { periodStartMs: item.periodStartMs }
  isAggregating = true
  sendAggregationStatus()

  addLog('info', `开始汇总 ${formatTimestamp(new Date(item.periodStartMs))} (剩余 ${aggregationQueue.length}/${totalAggregationQueue})`)

  try {
    const result = await aggregatePeriod(item.periodStartMs)
    if (result.success) {
      addLog('success', `汇总完成: ${result.summary.projectName} [${result.summary.category}]`)
      // 通知前端有新汇总
      sendToRenderer('new-aggregation', result.summary)
    } else {
      addLog('error', `汇总失败: ${result.error}`)
    }
  } catch (err) {
    addLog('error', `汇总异常: ${err.message}`)
  }

  isAggregating = false
  currentAggregation = null
  sendAggregationStatus()

  // 如果还有队列，延迟2秒继续（给截屏分析留出时间）
  if (aggregationQueue.length > 0) {
    setTimeout(() => processAggregationQueue(), 2000)
  }
}

function startAggregationTimer() {
  if (aggregationTimer) clearInterval(aggregationTimer)

  let lastCheckedPeriodMs = 0

  // 每分钟检查一次是否有新的已完成但未处理的10分钟周期
  aggregationTimer = setInterval(async () => {
    const now = new Date()
    const currentPeriodStart = get10MinPeriodStart(now)
    // 最近完成的周期 = 当前周期开始时间 - 10分钟
    const lastCompletedMs = currentPeriodStart.getTime() - 10 * 60 * 1000

    // 如果这个周期已经检查过了，跳过
    if (lastCompletedMs === lastCheckedPeriodMs) return
    lastCheckedPeriodMs = lastCompletedMs

    // 检查是否已处理
    if (!load10MinSummary(lastCompletedMs)) {
      const prevEnd = new Date(lastCompletedMs + 10 * 60 * 1000)
      const entries = getEntriesInPeriod(lastCompletedMs, prevEnd.getTime())
      if (entries.length > 0) {
        addLog('info', `检测到未处理的10分钟周期: ${formatTimestamp(new Date(lastCompletedMs))}`)
        aggregationQueue.push({ periodStartMs: lastCompletedMs })
        totalAggregationQueue = Math.max(totalAggregationQueue, aggregationQueue.length)
        sendAggregationStatus()
        if (!isAggregating) {
          processAggregationQueue()
        }
      }
    }
  }, 60000)
}

async function initAggregationSystem() {
  ensureDir(CONFIG.summaries10MinDir)

  // 查找未处理的周期
  const unprocessed = findUnprocessedPeriods()

  if (unprocessed.length > 0) {
    addLog('info', `发现 ${unprocessed.length} 个未处理的10分钟周期，开始排队汇总...`)
    aggregationQueue = unprocessed.map(u => ({ periodStartMs: u.periodStartMs }))
    totalAggregationQueue = aggregationQueue.length
    sendAggregationStatus()

    // 延迟5秒后开始处理（让截屏系统先启动）
    setTimeout(() => processAggregationQueue(), 5000)
  }

  // 启动定时器
  startAggregationTimer()
}

// ==================== Diary System ====================

function getDiaryFilePath(dateStr) {
  return path.join(CONFIG.diaryDir, `${dateStr}.json`)
}

function loadDiary(dateStr) {
  const filePath = getDiaryFilePath(dateStr)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function saveDiary(diary) {
  ensureDir(CONFIG.diaryDir)
  const filePath = getDiaryFilePath(diary.dateStr)
  fs.writeFileSync(filePath, JSON.stringify(diary, null, 2), 'utf-8')
}

function get10MinSummariesForDate(dateStr) {
  // dateStr 格式: 2026-08-02
  const [year, month] = dateStr.split('-')
  const monthFolder = `${year}-${month}`
  const monthPath = path.join(CONFIG.summaries10MinDir, monthFolder)

  if (!fs.existsSync(monthPath)) return []

  const dayPrefix = dateStr.replace(/-/g, '') // 20260802
  const files = fs.readdirSync(monthPath).filter(f => f.startsWith(dayPrefix) && f.endsWith('.json'))

  const summaries = []
  for (const file of files) {
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(monthPath, file), 'utf-8'))
      if (summary && summary.periodStartMs) {
        summaries.push(summary)
      }
    } catch { /* skip */ }
  }

  return summaries.sort((a, b) => (a.periodStartMs || 0) - (b.periodStartMs || 0))
}

function findDatesWithSummaries() {
  const dates = new Set()
  const baseDir = CONFIG.summaries10MinDir

  if (!fs.existsSync(baseDir)) return []

  const monthDirs = fs.readdirSync(baseDir).filter(name => {
    return fs.statSync(path.join(baseDir, name)).isDirectory() && /^\d{4}-\d{2}$/.test(name)
  })

  for (const monthDir of monthDirs) {
    const monthPath = path.join(baseDir, monthDir)
    const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'))

    for (const file of files) {
      // 文件名格式: 20260802_1540.json -> 提取 2026-08-02
      const match = file.match(/^(\d{4})(\d{2})(\d{2})_/)
      if (match) {
        dates.add(`${match[1]}-${match[2]}-${match[3]}`)
      }
    }
  }

  return Array.from(dates).sort()
}

function findUnprocessedDiaries() {
  const datesWithSummaries = findDatesWithSummaries()
  const unprocessed = []

  for (const dateStr of datesWithSummaries) {
    // 今天不需要生成日记（还没结束）
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    if (dateStr === todayStr) continue

    if (!loadDiary(dateStr)) {
      unprocessed.push(dateStr)
    }
  }

  return unprocessed
}

async function generateDiary(dateStr) {
  const summaries = get10MinSummariesForDate(dateStr)

  if (summaries.length === 0) {
    return { success: false, error: '该日期没有10分钟汇总数据' }
  }

  // 检查 Ollama 连接
  const status = await checkOllamaStatus()
  if (!status.connected) {
    return { success: false, error: 'Ollama 未连接' }
  }

  // 构建活动汇总文本
  const summariesText = summaries.map(s => {
    const time = s.periodStart ? s.periodStart.substring(11, 16) : '??'
    return `[${time}] 项目:${s.projectName || '未知'} | 分类:${s.category || '未知'} | 软件:${(s.softwareUsed || []).join(', ')} | ${s.description || '无描述'}`
  }).join('\n')

  const totalEntries = summaries.reduce((sum, s) => sum + (s.entryCount || 0), 0)
  const categoryCount = {}
  for (const s of summaries) {
    categoryCount[s.category] = (categoryCount[s.category] || 0) + 1
  }

  const prompt = `你是一个生活助手，请根据用户一天中的10分钟活动汇总记录，生成一篇结构化的日记。

日期：${dateStr}
10分钟汇总条数：${summaries.length}
截屏记录总数：${totalEntries}
活动分类统计：${Object.entries(categoryCount).map(([k, v]) => `${k}(${v}个10分钟)`).join('、')}

以下是各10分钟的活动汇总：
${summariesText}

请生成结构化的JSON日记（不要包含markdown代码块标记，不要包含任何其他文本）：

{"briefSummary":"用2-3句话简短总结这一天的主要活动内容","mainItems":[{"title":"事项标题（简洁）","description":"具体描述做了什么（1-2句话）"},{"title":"事项标题","description":"具体描述"},{"title":"事项标题","description":"具体描述"}],"highlights":"今天的亮点或高光时刻（1-2句话）","todos":["可能遗漏或需要跟进的待办事项1","待办事项2"],"suggestions":["针对时间管理和效率的优化建议1","优化建议2"],"warmReminder":"一句温馨的提示或鼓励的话"}

注意：
- mainItems 选取三件最主要的做的事情
- todos 可以是之前10分钟汇总中提到的待办事项的汇总，如果没有则空数组
- suggestions 基于当天活动给出实际可执行的建议
- warmReminder 要温暖、有同理心`

  let content
  try {
    content = await callOllamaForDiary(prompt)
  } catch (err) {
    return { success: false, error: err.message }
  }

  const parsed = parseDiaryResult(content)
  if (!parsed) {
    return { success: false, error: '解析AI输出失败', rawContent: content.substring(0, 500) }
  }

  const diary = {
    dateStr,
    ...parsed,
    summaryCount: summaries.length,
    totalEntries,
    categoryStats: categoryCount,
    generatedAt: formatTimestamp(new Date())
  }

  saveDiary(diary)
  return { success: true, diary }
}

async function callOllamaForDiary(prompt) {
  const requestBody = JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    options: { temperature: 0.5, top_p: 0.9 }
  })

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CONFIG.ollamaHost,
      port: CONFIG.ollamaPort,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama 返回 ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(body)
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result.message ? result.message.content : '')
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(CONFIG.diaryTimeout, () => {
      req.destroy(new Error('日记生成超时'))
    })
    req.write(requestBody)
    req.end()
  })
}

function parseDiaryResult(content) {
  let parsed = null
  try {
    parsed = JSON.parse(content)
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try { parsed = JSON.parse(match[1].trim()) } catch { /* */ }
    }
    if (!parsed) {
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start !== -1 && end !== -1) {
        try { parsed = JSON.parse(content.substring(start, end + 1)) } catch { /* */ }
      }
    }
  }

  if (!parsed) return null

  return {
    briefSummary: parsed.briefSummary || '',
    mainItems: Array.isArray(parsed.mainItems) ? parsed.mainItems.map(item => ({
      title: item.title || '未知事项',
      description: item.description || ''
    })) : [],
    highlights: parsed.highlights || '',
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    warmReminder: parsed.warmReminder || ''
  }
}

async function processDiaryQueue() {
  if (isGeneratingDiary || diaryQueue.length === 0) return

  const status = await checkOllamaStatus()
  if (!status.connected) {
    addLog('warn', 'Ollama 未连接，暂停日记生成队列')
    setTimeout(() => processDiaryQueue(), 5 * 60 * 1000)
    return
  }

  const dateStr = diaryQueue.shift()
  currentDiaryDate = dateStr
  isGeneratingDiary = true
  sendDiaryStatus()

  addLog('info', `开始生成日记 ${dateStr} (剩余 ${diaryQueue.length}/${totalDiaryQueue})`)

  try {
    const result = await generateDiary(dateStr)
    if (result.success) {
      addLog('success', `日记生成完成: ${dateStr}`)
      sendToRenderer('diary-generated', { dateStr, diary: result.diary })
    } else {
      addLog('error', `日记生成失败 ${dateStr}: ${result.error}`)
    }
  } catch (err) {
    addLog('error', `日记生成异常 ${dateStr}: ${err.message}`)
  }

  isGeneratingDiary = false
  currentDiaryDate = null
  sendDiaryStatus()

  if (diaryQueue.length > 0) {
    setTimeout(() => processDiaryQueue(), 2000)
  }
}

function sendDiaryStatus() {
  const status = {
    isGenerating: isGeneratingDiary,
    currentDate: currentDiaryDate,
    queueRemaining: diaryQueue.length,
    queueTotal: totalDiaryQueue
  }
  sendToRenderer('diary-status', status)
}

async function initDiarySystem() {
  ensureDir(CONFIG.diaryDir)

  const unprocessed = findUnprocessedDiaries()
  if (unprocessed.length > 0) {
    addLog('info', `发现 ${unprocessed.length} 天未生成日记，开始排队生成...`)
    diaryQueue = [...unprocessed]
    totalDiaryQueue = diaryQueue.length
    sendDiaryStatus()
    // 延迟10秒后开始（让10分钟汇总先跑）
    setTimeout(() => processDiaryQueue(), 10000)
  }
}

// ==================== Dashboard Data ====================

function getDashboardData(range, dateStr) {
  // range: 'day', 'week', 'month', 'year'
  // dateStr: '2026-08-02' (范围内的任意日期)
  const [year, month, day] = dateStr.split('-').map(Number)
  const summaries = getDashboardSummariesForRange(range, year, month, day)

  if (summaries.length === 0) {
    return { hasData: false, range, dateStr }
  }

  // 1. 分类时间分布
  const categoryTime = {}
  for (const s of summaries) {
    const cat = s.category || '其他'
    categoryTime[cat] = (categoryTime[cat] || 0) + 10 // 每个summary代表10分钟
  }

  // 2. 软件使用频次
  const softwareFreq = {}
  for (const s of summaries) {
    if (s.softwareUsed) {
      for (const sw of s.softwareUsed) {
        softwareFreq[sw] = (softwareFreq[sw] || 0) + 1
      }
    }
  }

  // 3. 项目专注时间
  const projectTime = {}
  for (const s of summaries) {
    const proj = s.projectName || '未知项目'
    projectTime[proj] = (projectTime[proj] || 0) + 10
  }

  // 4. 按小时分布的活动量
  const hourlyActivity = new Array(24).fill(0)
  for (const s of summaries) {
    if (s.periodStartMs) {
      const hour = new Date(s.periodStartMs).getHours()
      hourlyActivity[hour]++
    }
  }

  // 5. 每日分类分布（堆叠数据）
  const dailyCategoryData = {}
  for (const s of summaries) {
    if (s.periodStartMs) {
      const d = new Date(s.periodStartMs)
      const dStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      if (!dailyCategoryData[dStr]) {
        dailyCategoryData[dStr] = { 工作: 0, 娱乐: 0, 学习: 0, 社交: 0, 其他: 0 }
      }
      const cat = s.category || '其他'
      dailyCategoryData[dStr][cat] = (dailyCategoryData[dStr][cat] || 0) + 10
    }
  }

  // 6. 待办事项汇总
  const allTodos = []
  for (const s of summaries) {
    if (s.todoItems) {
      for (const todo of s.todoItems) {
        allTodos.push(todo)
      }
    }
  }

  // 7. 总统计
  const totalMinutes = summaries.length * 10
  const totalHours = (totalMinutes / 60).toFixed(1)
  const totalEntries = summaries.reduce((sum, s) => sum + (s.entryCount || 0), 0)
  const uniqueProjects = Object.keys(projectTime).length
  const uniqueSoftware = Object.keys(softwareFreq).length

  return {
    hasData: true,
    range,
    dateStr,
    summaryCount: summaries.length,
    totalEntries,
    totalMinutes,
    totalHours,
    uniqueProjects,
    uniqueSoftware,
    categoryTime,
    softwareFreq,
    projectTime,
    hourlyActivity,
    dailyCategoryData,
    todos: allTodos,
    dateRange: getDashboardDateRange(range, year, month, day)
  }
}

function getDashboardSummariesForRange(range, year, month, day) {
  let startDate, endDate

  if (range === 'day') {
    startDate = new Date(year, month - 1, day, 0, 0, 0, 0)
    endDate = new Date(year, month - 1, day + 1, 0, 0, 0, 0)
  } else if (range === 'week') {
    // 以 dateStr 所在周的周一为开始
    const refDate = new Date(year, month - 1, day)
    const dayOfWeek = refDate.getDay() || 7 // 周日=0 -> 7
    startDate = new Date(year, month - 1, day - dayOfWeek + 1, 0, 0, 0, 0)
    endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 7, 0, 0, 0, 0)
  } else if (range === 'month') {
    startDate = new Date(year, month - 1, 1, 0, 0, 0, 0)
    endDate = new Date(year, month, 1, 0, 0, 0, 0)
  } else if (range === 'year') {
    startDate = new Date(year, 0, 1, 0, 0, 0, 0)
    endDate = new Date(year + 1, 0, 1, 0, 0, 0, 0)
  }

  return getAll10MinSummariesInRange(startDate.getTime(), endDate.getTime())
}

function getAll10MinSummariesInRange(startMs, endMs) {
  const summaries = []
  const baseDir = CONFIG.summaries10MinDir

  if (!fs.existsSync(baseDir)) return summaries

  const startDate = new Date(startMs)
  const endDate = new Date(endMs)

  // 遍历从 startDate 到 endDate 之间的所有月份
  let currentYear = startDate.getFullYear()
  let currentMonth = startDate.getMonth() + 1

  while (true) {
    const monthFolder = `${currentYear}-${pad(currentMonth)}`
    const monthPath = path.join(baseDir, monthFolder)

    if (fs.existsSync(monthPath)) {
      const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'))
      for (const file of files) {
        try {
          const summary = JSON.parse(fs.readFileSync(path.join(monthPath, file), 'utf-8'))
          if (summary && summary.periodStartMs) {
            if (summary.periodStartMs >= startMs && summary.periodStartMs < endMs) {
              summaries.push(summary)
            }
          }
        } catch { /* skip */ }
      }
    }

    // 移到下个月
    if (currentYear === endDate.getFullYear() && currentMonth === endDate.getMonth() + 1) {
      break
    }
    currentMonth++
    if (currentMonth > 12) {
      currentMonth = 1
      currentYear++
    }
  }

  return summaries.sort((a, b) => (a.periodStartMs || 0) - (b.periodStartMs || 0))
}

function getDashboardDateRange(range, year, month, day) {
  if (range === 'day') {
    const d = new Date(year, month - 1, day)
    return formatTimestamp(d).substring(0, 10)
  } else if (range === 'week') {
    const refDate = new Date(year, month - 1, day)
    const dayOfWeek = refDate.getDay() || 7
    const start = new Date(year, month - 1, day - dayOfWeek + 1)
    const end = new Date(year, month - 1, day - dayOfWeek + 7)
    return `${formatTimestamp(start).substring(0, 10)} ~ ${formatTimestamp(end).substring(0, 10)}`
  } else if (range === 'month') {
    return `${year}-${pad(month)}`
  } else if (range === 'year') {
    return `${year}`
  }
}

// ==================== Q&A Search System ====================

function parseQaDateRange(dateRange) {
  const now = new Date()
  let dateFrom = null, dateTo = null

  if (dateRange === 'today') {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  } else if (dateRange === 'week') {
    const dayOfWeek = now.getDay() || 7
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1)
    dateTo = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate() + 7)
  } else if (dateRange === 'month') {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1)
    dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  } else if (dateRange && dateRange !== 'all') {
    // Try parsing as YYYY-MM-DD
    const parsed = new Date(dateRange)
    if (!isNaN(parsed.getTime())) {
      dateFrom = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
      dateTo = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + 1)
    }
  }

  return { dateFrom, dateTo }
}

function textMatchesAny(text, keywords) {
  if (!keywords || keywords.length === 0) return true
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(String(kw).toLowerCase()))
}

function search10MinSummaries(keywords, dateFrom, dateTo) {
  let summaries

  if (dateFrom && dateTo) {
    summaries = getAll10MinSummariesInRange(dateFrom.getTime(), dateTo.getTime())
  } else {
    summaries = getAll10MinSummaries()
  }

  const results = []
  const maxResults = 20

  for (const s of summaries) {
    const text = [
      s.projectName || '',
      s.description || '',
      (s.softwareUsed || []).join(' '),
      s.category || ''
    ].join(' ')

    if (textMatchesAny(text, keywords)) {
      results.push({
        type: '10min',
        time: s.periodStart || '',
        projectName: s.projectName || '',
        category: s.category || '',
        description: (s.description || '').substring(0, 300),
        softwareUsed: s.softwareUsed || []
      })
      if (results.length >= maxResults) break
    }
  }

  return results
}

function searchDiaries(keywords, dateFrom, dateTo) {
  const results = []
  const maxResults = 10

  if (!fs.existsSync(CONFIG.diaryDir)) return results

  const files = fs.readdirSync(CONFIG.diaryDir).filter(f => f.endsWith('.json'))

  for (const file of files) {
    // 文件名格式: 2026-08-02.json
    const dateStr = file.replace('.json', '')

    // Date range filter
    if (dateFrom && dateTo) {
      const fileDate = new Date(dateStr)
      if (isNaN(fileDate.getTime()) || fileDate < dateFrom || fileDate >= dateTo) continue
    }

    try {
      const diary = JSON.parse(fs.readFileSync(path.join(CONFIG.diaryDir, file), 'utf-8'))
      if (!diary) continue

      const text = [
        diary.briefSummary || '',
        diary.highlights || '',
        diary.warmReminder || '',
        ...(diary.mainItems || []).map(i => (i.title || '') + ' ' + (i.description || '')),
        ...(diary.suggestions || []),
        ...(diary.todos || [])
      ].join(' ')

      if (textMatchesAny(text, keywords)) {
        results.push({
          type: 'diary',
          date: dateStr,
          briefSummary: (diary.briefSummary || '').substring(0, 200),
          mainItems: (diary.mainItems || []).slice(0, 3).map(i => ({
            title: i.title || '',
            description: (i.description || '').substring(0, 100)
          })),
          highlights: (diary.highlights || '').substring(0, 150)
        })
        if (results.length >= maxResults) break
      }
    } catch { /* skip */ }
  }

  return results.sort((a, b) => (a.date > b.date ? -1 : 1))
}

function searchLogs(keywords, dateFrom, dateTo) {
  const results = []
  const maxResults = 15

  // If no date range, default to last 3 days to limit scope
  if (!dateFrom) {
    dateFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  }
  if (!dateTo) {
    dateTo = new Date()
  }

  // Iterate through dates from newest to oldest
  let currentDate = new Date(dateTo)
  currentDate.setHours(0, 0, 0, 0)
  const stopDate = new Date(dateFrom)
  stopDate.setHours(0, 0, 0, 0)

  while (currentDate >= stopDate && results.length < maxResults) {
    const monthFolder = getMonthFolder(currentDate)
    const monthPath = path.join(CONFIG.logsDir, monthFolder)

    if (fs.existsSync(monthPath)) {
      const dayPrefix = getDateStr(currentDate)
      const files = fs.readdirSync(monthPath).filter(f => f.startsWith(dayPrefix) && f.endsWith('.json'))

      // Sort files by hour descending (newest first)
      files.sort().reverse()

      for (const file of files) {
        try {
          const entries = JSON.parse(fs.readFileSync(path.join(monthPath, file), 'utf-8'))
          if (!Array.isArray(entries)) continue

          // Newest first
          entries.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0))

          for (const e of entries) {
            const text = e.activity || ''
            if (textMatchesAny(text, keywords)) {
              results.push({
                type: 'logs',
                time: e.timestamp || '',
                activity: text.substring(0, 200)
              })
              if (results.length >= maxResults) return results
            }
          }
        } catch { /* skip */ }
      }
    }

    // Previous day
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 1)
  }

  return results
}

function searchRecords(dataType, keywords, dateRange) {
  const { dateFrom, dateTo } = parseQaDateRange(dateRange)

  if (dataType === '10min') {
    return search10MinSummaries(keywords, dateFrom, dateTo)
  } else if (dataType === 'diary') {
    return searchDiaries(keywords, dateFrom, dateTo)
  } else if (dataType === 'logs') {
    return searchLogs(keywords, dateFrom, dateTo)
  }

  return []
}

function formatSearchResults(search, results) {
  const dataTypeName = { '10min': '10分钟汇总', 'diary': '日记', 'logs': '20秒记录' }[search.dataType] || search.dataType

  let text = `--- 搜索结果：${dataTypeName} | 关键词: ${(search.keywords || []).join(', ')} | 时间范围: ${search.dateRange || 'all'} | 找到 ${results.length} 条 ---\n`

  if (results.length === 0) {
    text += '（无匹配结果）\n'
    return text
  }

  for (const r of results) {
    if (r.type === '10min') {
      text += `[${r.time}] 项目:${r.projectName} | 分类:${r.category} | 软件:${(r.softwareUsed || []).join(',')}\n描述:${r.description}\n\n`
    } else if (r.type === 'diary') {
      text += `[日记 ${r.date}] 总结:${r.briefSummary}\n`
      for (const item of r.mainItems) {
        text += `  - ${item.title}: ${item.description}\n`
      }
      text += `高光:${r.highlights}\n\n`
    } else if (r.type === 'logs') {
      text += `[${r.time}] ${r.activity}\n`
    }
  }

  return text
}

// ==================== Q&A Agentic Flow ====================

function buildQaPrompt(question, searchHistory, allContext, isLastRound) {
  const historyText = searchHistory.length > 0
    ? searchHistory.map(h =>
        `第${h.round}轮: 搜索${h.dataTypeName || h.dataType}，关键词"${(h.keywords || []).join(', ')}"，范围${h.dateRange || 'all'}，找到${h.resultCount}条`
      ).join('\n')
    : '（尚未搜索）'

  let prompt = `你是一个活动记录搜索助手。用户会问你关于他们电脑使用活动的问题。
你需要在活动记录中搜索相关信息，然后回答问题。

可搜索的数据类型：
1. "10min" - 10分钟活动汇总（中等粒度，包含项目名、分类、详细描述、使用的软件、待办事项。信息密度最高，优先使用）
2. "diary" - 日记（粗粒度，一天的整体总结、主要事项、高光时刻、建议。适合了解某天的概况）
3. "logs" - 20秒截屏记录（最细粒度，每条是5句话描述，数量最多。适合查找具体时间点的活动细节）

时间范围选项：
- "today" - 今天
- "week" - 本周
- "month" - 本月
- "all" - 所有记录
- "YYYY-MM-DD" - 特定日期（如 "2026-08-01"）

你最多可以进行3轮搜索。`

  if (isLastRound) {
    prompt += `\n\n⚠️ 你已经用完了3轮搜索机会，现在必须回答问题。`
  } else {
    prompt += `\n\n你可以选择继续搜索（action="search"）或直接回答（action="answer"）。如果已有足够信息，请直接回答。`
  }

  prompt += `\n\n请输出严格的JSON格式（不要包含markdown代码块标记，不要包含任何其他文本）：

如果要搜索：
{"action":"search","reasoning":"简短思考","searches":[{"dataType":"10min","keywords":["关键词1","关键词2"],"dateRange":"week"}]}

如果要回答：
{"action":"answer","reasoning":"简短思考","answer":"你的回答"}

注意：
- keywords 应该是记录中可能出现的具体词，如软件名、项目名、活动描述中的关键词
- 每次搜索指定1-3个关键词即可
- 优先搜索10分钟汇总（信息密度最高）
- 回答要基于搜索到的实际记录，不要编造
- 回答用中文，简洁清晰`

  prompt += `\n\n=== 用户问题 ===\n${question}\n`

  prompt += `\n=== 搜索历史 ===\n${historyText}\n`

  if (allContext) {
    // Limit context to ~6000 chars to avoid token overflow
    const trimmedContext = allContext.length > 6000
      ? allContext.substring(0, 6000) + '\n...（部分结果已截断）'
      : allContext
    prompt += `\n=== 搜索到的记录 ===\n${trimmedContext}\n`
  }

  return prompt
}

async function callOllamaForQa(prompt) {
  const requestBody = JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    options: { temperature: 0.4, top_p: 0.9 }
  })

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CONFIG.ollamaHost,
      port: CONFIG.ollamaPort,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama 返回 ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(body)
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result.message ? result.message.content : '')
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(CONFIG.qaTimeout, () => {
      req.destroy(new Error('问答请求超时'))
    })
    req.write(requestBody)
    req.end()
  })
}

function parseQaResult(content) {
  let parsed = null
  try {
    parsed = JSON.parse(content)
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try { parsed = JSON.parse(match[1].trim()) } catch { /* */ }
    }
    if (!parsed) {
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start !== -1 && end !== -1) {
        try { parsed = JSON.parse(content.substring(start, end + 1)) } catch { /* */ }
      }
    }
  }

  if (!parsed) return null
  return {
    action: parsed.action === 'answer' ? 'answer' : 'search',
    reasoning: parsed.reasoning || '',
    searches: Array.isArray(parsed.searches) ? parsed.searches.filter(s => s && s.dataType).map(s => ({
      dataType: s.dataType,
      keywords: Array.isArray(s.keywords) ? s.keywords.map(String) : [],
      dateRange: s.dateRange || 'all'
    })) : [],
    answer: typeof parsed.answer === 'string' ? parsed.answer : ''
  }
}

async function answerQuestion(question) {
  const status = await checkOllamaStatus()
  if (!status.connected) {
    return { success: false, error: 'Ollama 未连接' }
  }

  let searchHistory = []
  let allContext = ''
  const maxSearchRounds = 3

  for (let round = 0; round <= maxSearchRounds; round++) {
    const isLastRound = (round === maxSearchRounds)

    // Build prompt and call model
    sendToRenderer('qa-progress', {
      type: isLastRound ? 'answering' : 'thinking',
      round: round + 1,
      message: isLastRound ? '正在生成回答...' : `正在思考第 ${round + 1} 轮搜索策略...`
    })

    const prompt = buildQaPrompt(question, searchHistory, allContext, isLastRound)

    let content
    try {
      content = await callOllamaForQa(prompt)
    } catch (err) {
      return { success: false, error: err.message }
    }

    const parsed = parseQaResult(content)

    if (!parsed) {
      // Can't parse, use raw content as answer
      return { success: true, answer: content, searchHistory }
    }

    // If model wants to answer or it's the last round, return the answer
    if (parsed.action === 'answer' || isLastRound) {
      const answer = parsed.answer || (isLastRound ? '抱歉，无法生成回答。' : content)
      return { success: true, answer, searchHistory }
    }

    // Execute searches
    if (parsed.searches && parsed.searches.length > 0) {
      for (const search of parsed.searches) {
        const dataTypeName = { '10min': '10分钟汇总', 'diary': '日记', 'logs': '20秒记录' }[search.dataType] || search.dataType

        sendToRenderer('qa-progress', {
          type: 'searching',
          round: round + 1,
          dataType: search.dataType,
          dataTypeName,
          keywords: search.keywords,
          dateRange: search.dateRange,
          message: `搜索${dataTypeName}，关键词: ${(search.keywords || []).join(', ')}，范围: ${search.dateRange || 'all'}`
        })

        const results = searchRecords(search.dataType, search.keywords, search.dateRange)

        searchHistory.push({
          round: round + 1,
          dataType: search.dataType,
          dataTypeName,
          keywords: search.keywords,
          dateRange: search.dateRange,
          resultCount: results.length,
          reasoning: parsed.reasoning || ''
        })

        sendToRenderer('qa-progress', {
          type: 'searched',
          round: round + 1,
          dataType: search.dataType,
          dataTypeName,
          keywords: search.keywords,
          dateRange: search.dateRange,
          resultCount: results.length,
          message: `搜索完成，找到 ${results.length} 条匹配记录`
        })

        if (results.length > 0) {
          allContext += formatSearchResults(search, results) + '\n'
        }
      }
    }
    // If no searches specified but action was "search", continue to next round
  }

  // Shouldn't reach here
  return { success: true, answer: '抱歉，无法生成回答。', searchHistory }
}

// ==================== Main Capture Loop ====================

async function captureAndAnalyze() {
  const date = new Date()
  const timestamp = formatTimestamp(date)

  addLog('info', '开始截屏...')

  // Step 1: 截屏
  let screenshotBuffer
  try {
    screenshotBuffer = await captureScreenshot()
    addLog('info', `截屏成功 (${(screenshotBuffer.length / 1024).toFixed(1)} KB)`)
  } catch (err) {
    addLog('error', `截屏失败: ${err.message}`)
    stats.totalErrors++
    sendStatusUpdate()
    return
  }

  // Step 2: 只解码一次，后续保存与推理复用同一个 nativeImage
  let img
  try {
    img = nativeImage.createFromBuffer(screenshotBuffer)
    if (img.isEmpty()) throw new Error('图片解码结果为空')
  } catch (err) {
    addLog('error', `截图解码失败: ${err.message}`)
    stats.totalErrors++
    sendStatusUpdate()
    return
  }

  // Step 3: 判断画面是否基本没变；没变就不做推理，也不新增截图文件
  let frameGrid = null
  try {
    frameGrid = computeFrameGrid(img)
  } catch {
    frameGrid = null
  }

  if (CONFIG.skipUnchanged && framesAreSimilar(lastFrameGrid, frameGrid, CONFIG.unchangedThreshold)) {
    lastFrameGrid = frameGrid
    stats.totalCaptures++
    stats.totalSkipped++

    const logEntry = {
      timestamp,
      timestampMs: date.getTime(),
      imagePath: lastCapture.imagePath || null,
      activity: lastCapture.activity || '（画面无变化）',
      analysisTimeMs: 0,
      unchanged: true
    }

    try {
      saveLogEntry(logEntry, date)
    } catch (err) {
      addLog('error', `保存日志失败: ${err.message}`)
      stats.totalErrors++
    }

    lastCapture = {
      timestamp,
      imagePath: logEntry.imagePath,
      activity: logEntry.activity,
      analysisTime: 0
    }

    addLog('info', '画面与上一张基本相同，跳过 AI 分析')
    sendStatusUpdate()
    return
  }

  lastFrameGrid = frameGrid

  // Step 4: 保存截图到磁盘（按 savedImageWidth 降采样，节省磁盘）
  let relativeImagePath
  try {
    relativeImagePath = saveImageToDisk(img, date)
    addLog('info', `截图已保存: ${relativeImagePath}`)
  } catch (err) {
    addLog('error', `保存截图失败: ${err.message}`)
    stats.totalErrors++
    sendStatusUpdate()
    return
  }
  stats.totalCaptures++

  // Step 5: 调用 Ollama 分析
  let activity = '（分析失败）'
  let analysisTime = 0

  try {
    const imageBase64 = prepareImageForOllama(img)
    addLog('info', `调用 Ollama ${CONFIG.model} 分析中...`)

    const startTime = Date.now()
    const result = await callOllama(imageBase64)
    analysisTime = Date.now() - startTime

    activity = result.content.trim()
    stats.totalAnalyses++
    addLog('success', `分析完成 (${analysisTime}ms): ${activity.substring(0, 60)}...`)
  } catch (err) {
    addLog('error', `Ollama 分析失败: ${err.message}`)
    stats.totalErrors++
    activity = `（分析失败: ${err.message}）`
  }

  // Step 6: 保存日志记录
  const logEntry = {
    timestamp,
    timestampMs: date.getTime(),
    imagePath: relativeImagePath,
    activity,
    analysisTimeMs: analysisTime
  }

  try {
    saveLogEntry(logEntry, date)
  } catch (err) {
    addLog('error', `保存日志失败: ${err.message}`)
    stats.totalErrors++
  }

  // 更新状态
  lastCapture = {
    timestamp,
    imagePath: relativeImagePath,
    activity,
    analysisTime
  }

  sendStatusUpdate()
}

async function captureLoop() {
  if (!isTracking || isPaused) return
  captureTimer = null

  try {
    await captureAndAnalyze()
  } catch (err) {
    addLog('error', `捕获循环异常: ${err.message}`)
  }

  // 等待间隔后继续 (在上一次完成后才开始计时)
  if (isTracking && !isPaused) {
    captureTimer = setTimeout(captureLoop, CONFIG.interval)
  }
}

// ==================== Tracking Control ====================

async function startTracking() {
  if (isTracking) return

  // 手动启动时清掉自动暂停状态，并强制分析下一帧
  isPaused = false
  pauseReason = ''
  lastFrameGrid = null

  // 检查 Ollama 连接
  const status = await checkOllamaStatus()
  ollamaConnected = status.connected
  if (status.connected) {
    addLog('success', `Ollama 已连接 (v${status.version})`)
  } else {
    addLog('warn', `Ollama 未连接 (${CONFIG.ollamaHost}:${CONFIG.ollamaPort})，将仅保存截图`)
  }

  isTracking = true
  stats.startTime = formatTimestamp(new Date())
  addLog('success', '追踪已启动')
  sendStatusUpdate()

  // 开始捕获循环
  captureLoop()
}

function stopTracking() {
  if (!isTracking) return

  isTracking = false
  isPaused = false
  pauseReason = ''
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }

  addLog('warn', '追踪已停止')
  sendStatusUpdate()
}

// ==================== 空闲 / 锁屏自动暂停 ====================
// 采集循环每 35 秒就会向 Ollama 发一次请求，会把模型的 keep_alive 一直续期，
// 导致 6-8 GB 的视觉模型在整段"追踪中"时间里常驻内存。
// 空闲、锁屏、休眠时暂停采集，模型就能在 keep_alive 到期后自动卸载。

function pauseTracking(reason) {
  if (!isTracking || isPaused) return

  isPaused = true
  pauseReason = reason

  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }

  addLog('warn', `已自动暂停采集（${reason}），Ollama 模型将在空闲后自动卸载`)
  sendStatusUpdate()
}

function resumeTracking() {
  if (!isTracking || !isPaused) return

  isPaused = false
  pauseReason = ''
  lastFrameGrid = null // 恢复后强制分析第一帧

  addLog('success', '已恢复采集')
  sendStatusUpdate()

  if (!captureTimer) captureLoop()
}

function checkIdleState() {
  if (!isTracking || CONFIG.idlePauseSec <= 0) return

  const idleSec = powerMonitor.getSystemIdleTime()
  if (idleSec >= CONFIG.idlePauseSec) {
    pauseTracking(`无操作 ${Math.floor(idleSec / 60)} 分钟`)
  } else if (isPaused) {
    resumeTracking()
  }
}

function initPowerMonitor() {
  if (CONFIG.idlePauseSec > 0) {
    idleCheckTimer = setInterval(checkIdleState, 15000)
    addLog('info', `空闲自动暂停已启用 (${CONFIG.idlePauseSec}s)`)
  }

  powerMonitor.on('lock-screen', () => pauseTracking('锁屏'))
  powerMonitor.on('suspend', () => pauseTracking('系统休眠'))
  powerMonitor.on('unlock-screen', () => resumeTracking())
  powerMonitor.on('resume', () => resumeTracking())
}

// ==================== IPC Handlers ====================

ipcMain.handle('start', async () => {
  await startTracking()
  return { success: true }
})

ipcMain.handle('stop', () => {
  stopTracking()
  return { success: true }
})

ipcMain.handle('get-status', () => {
  return {
    isRunning: isTracking,
    paused: isPaused,
    pauseReason,
    ollamaConnected,
    stats: { ...stats },
    lastCapture: { ...lastCapture },
    logs: recentLogs.slice(0, 30),
    config: {
      interval: CONFIG.interval,
      model: CONFIG.model,
      ollamaHost: CONFIG.ollamaHost,
      ollamaPort: CONFIG.ollamaPort
    }
  }
})

ipcMain.handle('check-ollama', async () => {
  const status = await checkOllamaStatus()
  ollamaConnected = status.connected
  sendStatusUpdate()
  return status
})

// ==================== History Window IPC Handlers ====================

ipcMain.handle('open-history', () => {
  createHistoryWindow()
  return { success: true }
})

ipcMain.handle('get-history-dates', () => {
  return getAvailableDates()
})

ipcMain.handle('get-history-logs', (event, params) => {
  return getLogsForDate(params.dateStr)
})

// 缩略图内存缓存（LRU，上限 400 张，约 2-3 MB）
const thumbCache = new Map()
const THUMB_CACHE_MAX = 400

ipcMain.handle('get-screenshot', async (event, relativePath) => {
  try {
    const fullPath = path.join(CONFIG.dataDir, relativePath)
    const buffer = await fs.promises.readFile(fullPath)
    return { success: true, data: 'data:image/jpeg;base64,' + buffer.toString('base64') }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { success: false, error: '文件不存在' }
    }
    return { success: false, error: err.message }
  }
})

// 历史列表专用：返回小尺寸缩略图。
// 原实现让列表里每一条记录都通过 get-screenshot 取整张 1920px 截图
// （约 300KB，base64 后约 400KB，解码后约 8MB 位图），一天几千条记录会直接吃光内存。
ipcMain.handle('get-thumbnail', (event, params) => {
  try {
    const relativePath = params && params.imagePath
    if (!relativePath) {
      return { success: false, error: '缺少图片路径' }
    }

    const width = Math.max(64, Math.min(Number(params && params.width) || 160, 480))
    const cacheKey = width + '|' + relativePath

    const cached = thumbCache.get(cacheKey)
    if (cached) {
      return { success: true, data: cached }
    }

    const fullPath = path.join(CONFIG.dataDir, relativePath)
    const img = nativeImage.createFromPath(fullPath)
    if (img.isEmpty()) {
      return { success: false, error: '无法读取图片' }
    }

    const size = img.getSize()
    const resized = size.width > width ? img.resize({ width, quality: 'good' }) : img
    const data = 'data:image/jpeg;base64,' + resized.toJPEG(72).toString('base64')

    thumbCache.set(cacheKey, data)
    if (thumbCache.size > THUMB_CACHE_MAX) {
      thumbCache.delete(thumbCache.keys().next().value)
    }

    return { success: true, data }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('generate-daily-summary', async (event, params) => {
  return generateDailySummary(params.dateStr)
})

ipcMain.handle('get-daily-summary', (event, params) => {
  return loadDailySummary(params.dateStr)
})

// ==================== Aggregation IPC Handlers ====================

ipcMain.handle('get-activity-summaries', () => {
  return getAll10MinSummaries()
})

ipcMain.handle('get-aggregation-status', () => {
  return {
    isAggregating,
    current: currentAggregation,
    queueRemaining: aggregationQueue.length,
    queueTotal: totalAggregationQueue
  }
})

// ==================== Diary IPC Handlers ====================

ipcMain.handle('get-diary', (event, params) => {
  return loadDiary(params.dateStr)
})

ipcMain.handle('generate-diary', async (event, params) => {
  return generateDiary(params.dateStr)
})

ipcMain.handle('get-diary-dates', () => {
  return findDatesWithSummaries()
})

ipcMain.handle('get-diary-status', () => {
  return {
    isGenerating: isGeneratingDiary,
    currentDate: currentDiaryDate,
    queueRemaining: diaryQueue.length,
    queueTotal: totalDiaryQueue
  }
})

// ==================== Dashboard IPC Handlers ====================

ipcMain.handle('get-dashboard-data', (event, params) => {
  return getDashboardData(params.range, params.dateStr)
})

// ==================== Settings IPC Handlers ====================

const settingsFilePath = path.join(_dataRoot, 'data', 'settings.json')

function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      return JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'))
    }
  } catch {
    // 返回默认设置
  }
  return getDefaultSettings()
}

function saveSettingsData(settings) {
  ensureDir(path.dirname(settingsFilePath))
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf-8')
}

function getDefaultSettings() {
  return {
    preset: 'standard',
    global: { fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
    areas: {
      home:      { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      activity:  { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      diary:     { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      dashboard: { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      qa:        { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' }
    }
  }
}

const FONT_PRESETS = {
  standard:     { fontSize: 14, fontColor: 'rgba(255,255,255,0.92)', label: '标准' },
  large:        { fontSize: 18, fontColor: 'rgba(255,255,255,0.95)', label: '大字号' },
  'high-contrast': { fontSize: 16, fontColor: '#ffffff', label: '高对比' },
  'eye-care':   { fontSize: 15, fontColor: '#c8e6c9', label: '护眼' },
  warm:         { fontSize: 15, fontColor: '#ffdcb0', label: '暖色' }
}

ipcMain.handle('get-settings', () => {
  return loadSettings()
})

ipcMain.handle('save-settings', (event, settings) => {
  saveSettingsData(settings)
  return { success: true }
})

ipcMain.handle('get-font-presets', () => {
  return FONT_PRESETS
})

// ==================== Q&A IPC Handlers ====================

ipcMain.handle('answer-question', async (event, params) => {
  return answerQuestion(params.question)
})

// ==================== History Data Functions ====================

function getAvailableDates() {
  const dates = new Set()
  const logsDir = CONFIG.logsDir

  if (!fs.existsSync(logsDir)) return []

  // 扫描所有月份文件夹
  const monthDirs = fs.readdirSync(logsDir).filter(name => {
    return fs.statSync(path.join(logsDir, name)).isDirectory() && /^\d{4}-\d{2}$/.test(name)
  })

  for (const monthDir of monthDirs) {
    const monthPath = path.join(logsDir, monthDir)
    const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'))

    for (const file of files) {
      // 文件名格式: 20260802_15.json -> 提取日期 2026-08-02
      const match = file.match(/^(\d{4})(\d{2})(\d{2})_/)
      if (match) {
        dates.add(`${match[1]}-${match[2]}-${match[3]}`)
      }
    }
  }

  return Array.from(dates).sort().reverse()
}

function getLogsForDate(dateStr) {
  // dateStr 格式: 2026-08-02
  const [year, month, day] = dateStr.split('-')
  const monthFolder = `${year}-${month}`
  const monthPath = path.join(CONFIG.logsDir, monthFolder)

  const allEntries = []

  if (!fs.existsSync(monthPath)) return []

  // 读取该日期所有小时的日志文件
  const dayPrefix = `${year}${month}${day}`
  const files = fs.readdirSync(monthPath).filter(f => f.startsWith(dayPrefix) && f.endsWith('.json'))

  for (const file of files) {
    const filePath = path.join(monthPath, file)
    try {
      const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (Array.isArray(entries)) {
        allEntries.push(...entries)
      }
    } catch {
      // 跳过损坏的文件
    }
  }

  // 按时间戳排序（从新到旧）
  allEntries.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0))

  return allEntries
}

function getSummaryDir() {
  return path.join(CONFIG.dataDir, 'summaries')
}

function getSummaryFilePath(dateStr) {
  return path.join(getSummaryDir(), `${dateStr}.json`)
}

function loadDailySummary(dateStr) {
  const filePath = getSummaryFilePath(dateStr)
  if (!fs.existsSync(filePath)) {
    return { exists: false }
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return { exists: true, ...data }
  } catch {
    return { exists: false }
  }
}

async function generateDailySummary(dateStr) {
  const entries = getLogsForDate(dateStr)
  if (entries.length === 0) {
    return { success: false, error: '该日期没有记录' }
  }

  // 检查 Ollama 连接
  const status = await checkOllamaStatus()
  if (!status.connected) {
    return { success: false, error: 'Ollama 未连接，无法生成总结' }
  }

  // 准备总结 prompt
  const activities = entries.reverse().map((e, i) => {
    const time = e.timestamp ? e.timestamp.substring(11) : '未知时间'
    return `[${time}] ${e.activity || '无描述'}`
  }).join('\n')

  const summaryPrompt = `以下是一天中用户电脑活动的逐条记录（每20秒截屏一次的AI分析），请帮我总结这一天用户主要做了什么，按时间段归纳活动内容。输出格式：

## 每日活动总结

请用2-3段话总结当天的主要活动，标注大致时间段。重点关注用户在不同时间段做了什么类型的工作。

---

以下是活动记录：
${activities}`

  try {
    const requestBody = JSON.stringify({
      model: CONFIG.model,
      messages: [{
        role: 'user',
        content: summaryPrompt
      }],
      stream: false,
      options: {
        temperature: 0.5,
        top_p: 0.9
      }
    })

    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: CONFIG.ollamaHost,
        port: CONFIG.ollamaPort,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Ollama 返回 ${res.statusCode}`))
            return
          }
          try {
            const parsed = JSON.parse(body)
            resolve({
              content: parsed.message ? parsed.message.content : '',
              evalCount: parsed.eval_count || 0
            })
          } catch (e) {
            reject(e)
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(CONFIG.ollamaTimeout, () => req.destroy(new Error('超时')))
      req.write(requestBody)
      req.end()
    })

    const summaryData = {
      dateStr,
      summary: result.content.trim(),
      entryCount: entries.length,
      generatedAt: formatTimestamp(new Date())
    }

    // 保存总结
    ensureDir(getSummaryDir())
    fs.writeFileSync(getSummaryFilePath(dateStr), JSON.stringify(summaryData, null, 2), 'utf-8')

    return { success: true, ...summaryData }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ==================== History Window ====================

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show()
    historyWindow.focus()
    return
  }

  historyWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Screen Tracker - 历史记录',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  historyWindow.loadFile(path.join(__dirname, 'renderer', 'history.html'))

  historyWindow.on('closed', () => {
    historyWindow = null
  })
}

// ==================== App Lifecycle ====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 820,
    minWidth: 580,
    title: 'Screen Tracker',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // 关闭窗口时，如果正在追踪则最小化到托盘
  mainWindow.on('close', (e) => {
    if (!isQuitting && isTracking) {
      e.preventDefault()
      mainWindow.hide()
      if (Notification.isSupported()) {
        new Notification({
          title: 'Screen Tracker',
          body: '追踪仍在后台运行，点击托盘图标可恢复窗口。'
        }).show()
      }
    }
  })
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Screen Tracker - 截屏追踪器')

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) mainWindow.show() } },
    { label: '查看历史记录', click: () => createHistoryWindow() },
    { type: 'separator' },
    { label: '退出', click: () => {
      isQuitting = true
      stopTracking()
      app.quit()
    }}
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    }
  })
}

app.whenReady().then(async () => {
  // 创建数据目录
  ensureDir(CONFIG.dataDir)
  ensureDir(CONFIG.screenshotsDir)
  ensureDir(CONFIG.logsDir)
  ensureDir(CONFIG.summaries10MinDir)
  ensureDir(CONFIG.diaryDir)

  // 创建托盘和窗口
  createTray()
  createWindow()

  addLog('info', '应用已启动')
  addLog('info', `配置: 间隔=${CONFIG.interval / 1000}s, 模型=${CONFIG.model}`)

  // 空闲/锁屏自动暂停（避免模型被持续续期而常驻内存）
  initPowerMonitor()

  // 检查 Ollama 连接
  const status = await checkOllamaStatus()
  ollamaConnected = status.connected
  if (status.connected) {
    addLog('success', `Ollama 已连接 (v${status.version})`)
  } else {
    addLog('warn', `Ollama 未连接，请确保 Ollama 正在运行`)
    addLog('info', `拉取模型: ollama pull ${CONFIG.model}`)
  }

  // 初始化10分钟汇总系统
  initAggregationSystem()

  // 初始化日记系统
  initDiarySystem()

  // 自动开始追踪
  if (CONFIG.autoStart) {
    addLog('info', '2秒后自动启动追踪...')
    setTimeout(() => startTracking(), 2000)
  }
})

app.on('window-all-closed', () => {
  if (!isTracking || isQuitting) {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
