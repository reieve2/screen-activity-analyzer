'use strict'

// ==================== State ====================
let currentRange = 'day'
let currentDate = null // '2026-08-02'
let dashboardListenersSetup = false
let charts = {} // store chart instances for cleanup

// ==================== Category Colors ====================
const CAT_COLORS = {
  '工作': '#4ade80',
  '娱乐': '#f87171',
  '学习': '#60a5fa',
  '社交': '#c084fc',
  '其他': '#888888'
}

// ==================== DOM Elements ====================
const rangeBtns = document.querySelectorAll('.range-btn')
const dashboardDateInput = document.getElementById('dashboardDate')
const refreshDashboardBtn = document.getElementById('refreshDashboard')
const dashboardDateRange = document.getElementById('dashboardDateRange')
const dashTotalTime = document.getElementById('dashTotalTime')
const dashTotalEntries = document.getElementById('dashTotalEntries')
const dashProjects = document.getElementById('dashProjects')
const dashSoftware = document.getElementById('dashSoftware')
const dashboardTodos = document.getElementById('dashboardTodos')

// ==================== Helpers ====================

function pad(n) {
  return String(n).padStart(2, '0')
}

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ==================== Chart Defaults ====================

Chart.defaults.color = '#8b8baa'
Chart.defaults.borderColor = '#252540'
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'

// ==================== Load Dashboard Data ====================

async function loadDashboard() {
  const dateStr = currentDate || todayStr()
  dashboardDateRange.textContent = '加载中...'

  try {
    const data = await window.api.getDashboardData(currentRange, dateStr)

    if (!data.hasData) {
      showNoData()
      return
    }

    // 更新日期范围显示
    dashboardDateRange.textContent = data.dateRange

    // 更新统计数字
    dashTotalTime.textContent = data.totalHours
    dashTotalEntries.textContent = data.totalEntries
    dashProjects.textContent = data.uniqueProjects
    dashSoftware.textContent = data.uniqueSoftware

    // 销毁旧图表
    destroyAllCharts()

    // 渲染图表
    renderCategoryPie(data)
    renderSoftwareBar(data)
    renderProjectBar(data)
    renderHourlyLine(data)
    renderDailyStacked(data)
    renderTodos(data)
  } catch (err) {
    dashboardDateRange.textContent = '加载失败'
    console.error('看板加载失败:', err)
  }
}

function showNoData() {
  dashboardDateRange.textContent = '该时间段暂无数据'
  dashTotalTime.textContent = '-'
  dashTotalEntries.textContent = '-'
  dashProjects.textContent = '-'
  dashSoftware.textContent = '-'

  destroyAllCharts()
  dashboardTodos.innerHTML = '<p class="muted">暂无数据</p>'
}

function destroyAllCharts() {
  for (const key in charts) {
    if (charts[key]) {
      charts[key].destroy()
      charts[key] = null
    }
  }
}

function resetChartWrapper(canvasId) {
  const ctx = document.getElementById(canvasId)
  if (!ctx) return null
  // 重置容器内容为纯净的 canvas
  ctx.parentElement.innerHTML = `<canvas id="${canvasId}"></canvas>`
  return document.getElementById(canvasId)
}

// ==================== Chart Renderers ====================

function renderCategoryPie(data) {
  const ctx = resetChartWrapper('chartCategoryPie')
  const labels = Object.keys(data.categoryTime)
  const values = Object.values(data.categoryTime)
  const colors = labels.map(l => CAT_COLORS[l] || CAT_COLORS['其他'])

  charts.categoryPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map(l => `${l} (${(data.categoryTime[l] / 60).toFixed(1)}h)`),
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: '#1a1a2e',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { padding: 12, font: { size: 12 } }
        }
      }
    }
  })
}

function renderSoftwareBar(data) {
  const entries = Object.entries(data.softwareFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  if (entries.length === 0) {
    const ctx = resetChartWrapper('chartSoftwareBar')
    ctx.parentElement.innerHTML += '<p class="muted" style="text-align:center;padding:20px">暂无软件数据</p>'
    return
  }

  const ctx = resetChartWrapper('chartSoftwareBar')
  charts.softwareBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        label: '出现次数',
        data: entries.map(e => e[1]),
        backgroundColor: 'rgba(96, 165, 250, 0.6)',
        borderColor: '#60a5fa',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: '#20203a' },
          ticks: { color: '#6b6b8d' }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#a0a0c0' }
        }
      }
    }
  })
}

function renderProjectBar(data) {
  const entries = Object.entries(data.projectTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  if (entries.length === 0) {
    const ctx = resetChartWrapper('chartProjectBar')
    ctx.parentElement.innerHTML += '<p class="muted" style="text-align:center;padding:20px">暂无项目数据</p>'
    return
  }

  const ctx = resetChartWrapper('chartProjectBar')
  charts.projectBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        label: '专注时间 (分钟)',
        data: entries.map(e => e[1]),
        backgroundColor: 'rgba(129, 140, 248, 0.6)',
        borderColor: '#818cf8',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x} 分钟 (${(ctx.parsed.x / 60).toFixed(1)}h)`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: '#20203a' },
          ticks: {
            color: '#6b6b8d',
            callback: (v) => v >= 60 ? `${(v / 60).toFixed(0)}h` : `${v}m`
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#a0a0c0' }
        }
      }
    }
  })
}

function renderHourlyLine(data) {
  const ctx = resetChartWrapper('chartHourlyLine')
  const hours = data.hourlyActivity

  charts.hourlyLine = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${pad(i)}:00`),
      datasets: [{
        label: '10分钟汇总数',
        data: hours,
        backgroundColor: hours.map(h => {
          if (h === 0) return 'rgba(100,100,120,0.2)'
          if (h <= 2) return 'rgba(96, 165, 250, 0.5)'
          if (h <= 4) return 'rgba(74, 222, 128, 0.5)'
          return 'rgba(129, 140, 248, 0.6)'
        }),
        borderColor: hours.map(h => {
          if (h === 0) return 'rgba(100,100,120,0.3)'
          if (h <= 2) return '#60a5fa'
          if (h <= 4) return '#4ade80'
          return '#818cf8'
        }),
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} 个汇总 (${ctx.parsed.y * 10}分钟)`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#6b6b8d', maxRotation: 45 }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#20203a' },
          ticks: { color: '#6b6b8d', stepSize: 1 }
        }
      }
    }
  })
}

function renderDailyStacked(data) {
  const dates = Object.keys(data.dailyCategoryData).sort()
  const categories = ['工作', '娱乐', '学习', '社交', '其他']

  if (dates.length === 0) {
    const ctx = resetChartWrapper('chartDailyStacked')
    ctx.parentElement.innerHTML += '<p class="muted" style="text-align:center;padding:20px">暂无数据</p>'
    return
  }

  const ctx = resetChartWrapper('chartDailyStacked')
  const datasets = categories.map(cat => ({
    label: cat,
    data: dates.map(d => (data.dailyCategoryData[d][cat] || 0)),
    backgroundColor: CAT_COLORS[cat],
    borderRadius: 2
  }))

  charts.dailyStacked = new Chart(ctx, {
    type: 'bar',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 10, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}分钟`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: '#6b6b8d', maxRotation: 45 }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#20203a' },
          ticks: {
            color: '#6b6b8d',
            callback: (v) => v >= 60 ? `${(v / 60).toFixed(0)}h` : `${v}m`
          }
        }
      }
    }
  })
}

function renderTodos(data) {
  if (!data.todos || data.todos.length === 0) {
    dashboardTodos.innerHTML = '<p class="muted">暂无待办事项</p>'
    return
  }

  // 去重
  const uniqueTodos = [...new Set(data.todos)]
  dashboardTodos.innerHTML = uniqueTodos.map(t =>
    `<div class="todo-item">${escapeHtml(t)}</div>`
  ).join('')
}

// ==================== Event Listeners ====================

function setupDashboardListeners() {
  if (dashboardListenersSetup) return
  dashboardListenersSetup = true

  rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      rangeBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentRange = btn.dataset.range
      loadDashboard()
    })
  })

  dashboardDateInput.addEventListener('change', () => {
    currentDate = dashboardDateInput.value
    loadDashboard()
  })

  refreshDashboardBtn.addEventListener('click', () => {
    loadDashboard()
  })
}

// ==================== Initialization ====================

async function initDashboardTab() {
  setupDashboardListeners()

  // 设置默认日期为今天
  currentDate = todayStr()
  dashboardDateInput.value = currentDate

  await loadDashboard()
}
