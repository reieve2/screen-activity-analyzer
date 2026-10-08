'use strict'

const toggleBtn = document.getElementById('toggleBtn')
const checkOllamaBtn = document.getElementById('checkOllamaBtn')
const historyBtn = document.getElementById('historyBtn')
const trackingStatus = document.getElementById('trackingStatus')
const ollamaStatus = document.getElementById('ollamaStatus')
const lastCaptureDiv = document.getElementById('lastCapture')
const totalCapturesEl = document.getElementById('totalCaptures')
const totalAnalysesEl = document.getElementById('totalAnalyses')
const totalErrorsEl = document.getElementById('totalErrors')
const logList = document.getElementById('logList')
const cfgInterval = document.getElementById('cfgInterval')
const cfgModel = document.getElementById('cfgModel')

let isRunning = false

// ==================== UI Update ====================

function updateUI(data) {
  isRunning = data.isRunning

  // 追踪状态
  trackingStatus.textContent = data.isRunning ? '运行中' : '已停止'
  trackingStatus.className = 'badge ' + (data.isRunning ? 'badge-running' : 'badge-stopped')

  // Ollama 状态
  if (data.ollamaConnected === true) {
    ollamaStatus.textContent = 'Ollama: 已连接'
    ollamaStatus.className = 'badge badge-connected'
  } else if (data.ollamaConnected === false) {
    ollamaStatus.textContent = 'Ollama: 未连接'
    ollamaStatus.className = 'badge badge-disconnected'
  }

  // 按钮状态
  toggleBtn.textContent = data.isRunning ? '停止追踪' : '启动追踪'
  toggleBtn.className = 'btn ' + (data.isRunning ? 'btn-secondary' : 'btn-primary')

  // 统计数据
  if (data.stats) {
    totalCapturesEl.textContent = data.stats.totalCaptures || 0
    totalAnalysesEl.textContent = data.stats.totalAnalyses || 0
    totalErrorsEl.textContent = data.stats.totalErrors || 0
  }

  // 最近活动
  if (data.lastCapture && data.lastCapture.timestamp) {
    lastCaptureDiv.innerHTML = 
      '<div class="timestamp">⏰ ' + data.lastCapture.timestamp + '</div>' +
      '<div class="activity">' + (data.lastCapture.activity || '（无分析结果）') + '</div>' +
      '<div class="analysis-time">分析耗时: ' + (data.lastCapture.analysisTime || 0) + 'ms</div>' +
      '<div class="image-path">' + (data.lastCapture.imagePath || '') + '</div>'
  }

  // 配置信息
  if (data.config) {
    cfgInterval.textContent = (data.config.interval / 1000) + 's'
    cfgModel.textContent = data.config.model
  }
}

function addLogEntry(entry) {
  // 移除"暂无日志"提示
  const placeholder = logList.querySelector('.muted')
  if (placeholder) placeholder.remove()

  const div = document.createElement('div')
  div.className = 'log-entry ' + entry.level

  const timeSpan = document.createElement('span')
  timeSpan.className = 'log-time'
  timeSpan.textContent = entry.time.substring(11)

  const msgSpan = document.createElement('span')
  msgSpan.className = 'log-msg'
  msgSpan.textContent = entry.message

  div.appendChild(timeSpan)
  div.appendChild(msgSpan)
  logList.insertBefore(div, logList.firstChild)

  // 最多保留 50 条
  while (logList.children.length > 50) {
    logList.removeChild(logList.lastChild)
  }
}

// ==================== Event Listeners ====================

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true
  try {
    if (isRunning) {
      await window.api.stop()
    } else {
      await window.api.start()
    }
  } finally {
    setTimeout(() => { toggleBtn.disabled = false }, 500)
  }
})

checkOllamaBtn.addEventListener('click', async () => {
  ollamaStatus.textContent = 'Ollama: 检测中...'
  ollamaStatus.className = 'badge badge-unknown'

  try {
    const result = await window.api.checkOllama()
    if (result.connected) {
      ollamaStatus.textContent = 'Ollama: v' + result.version
      ollamaStatus.className = 'badge badge-connected'
    } else {
      ollamaStatus.textContent = 'Ollama: 未连接'
      ollamaStatus.className = 'badge badge-disconnected'
    }
  } catch {
    ollamaStatus.textContent = 'Ollama: 检测失败'
    ollamaStatus.className = 'badge badge-disconnected'
  }
})

historyBtn.addEventListener('click', () => {
  window.api.openHistory()
})

// ==================== Tab Switching ====================

const tabs = document.querySelectorAll('.tab')
const tabContents = document.querySelectorAll('.tab-content')
let activityTabInitialized = false
let diaryTabInitialized = false
let dashboardTabInitialized = false
let qaTabInitialized = false
let settingsTabInitialized = false

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab

    tabs.forEach(t => t.classList.remove('active'))
    tabContents.forEach(c => c.classList.remove('active'))

    tab.classList.add('active')
    document.getElementById('tab-' + target).classList.add('active')

    // 首次打开动态标签页时初始化
    if (target === 'activity' && !activityTabInitialized) {
      activityTabInitialized = true
      if (typeof initActivityTab === 'function') {
        initActivityTab()
      }
    }

    // 首次打开日记标签页时初始化
    if (target === 'diary' && !diaryTabInitialized) {
      diaryTabInitialized = true
      if (typeof initDiaryTab === 'function') {
        initDiaryTab()
      }
    }

    // 首次打开看板标签页时初始化
    if (target === 'dashboard' && !dashboardTabInitialized) {
      dashboardTabInitialized = true
      if (typeof initDashboardTab === 'function') {
        initDashboardTab()
      }
    }

    // 首次打开问答标签页时初始化
    if (target === 'qa' && !qaTabInitialized) {
      qaTabInitialized = true
      if (typeof initQaTab === 'function') {
        initQaTab()
      }
    }

    // 首次打开设置标签页时初始化
    if (target === 'settings' && !settingsTabInitialized) {
      settingsTabInitialized = true
      if (typeof initSettingsTab === 'function') {
        initSettingsTab()
      }
    }
  })
})

// ==================== IPC Listeners ====================

window.api.onStatusUpdate((data) => {
  updateUI(data)
})

window.api.onLog((entry) => {
  addLogEntry(entry)
})

// ==================== Initialize ====================

async function init() {
  try {
    const status = await window.api.getStatus()
    updateUI(status)

    // 渲染已有日志
    if (status.logs && status.logs.length > 0) {
      status.logs.reverse().forEach(entry => addLogEntry(entry))
    }
  } catch (err) {
    console.error('初始化失败:', err)
  }
}

init()
