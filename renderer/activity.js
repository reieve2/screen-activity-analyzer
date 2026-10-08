'use strict'

// ==================== State ====================
let allSummaries = []
let filteredSummaries = []
let timelinePage = 0
const PAGE_SIZE = 10
let activityListenersSetup = false

// ==================== DOM Elements ====================
const heatmap = document.getElementById('heatmap')
const heatmapTooltip = document.getElementById('heatmapTooltip')
const timeline = document.getElementById('timeline')
const loadMoreBtn = document.getElementById('loadMoreBtn')
const filterProject = document.getElementById('filterProject')
const filterSoftware = document.getElementById('filterSoftware')
const filterDate = document.getElementById('filterDate')
const clearFilterBtn = document.getElementById('clearFilterBtn')
const aggStatusBadge = document.getElementById('aggStatusBadge')
const aggStatusBar = document.getElementById('aggStatusBar')
const aggStatusText = document.getElementById('aggStatusText')
const aggProgress = document.getElementById('aggProgress')

// ==================== Helpers ====================

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function formatTimeRange(summary) {
  const start = summary.periodStart ? summary.periodStart.substring(11, 16) : '??'
  const end = summary.periodEnd ? summary.periodEnd.substring(11, 16) : '??'
  const date = summary.periodStart ? summary.periodStart.substring(0, 10) : ''
  return `${date} ${start} - ${end}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.substring(0, 10)
}

// ==================== Heatmap ====================

function renderHeatmap() {
  if (allSummaries.length === 0) {
    heatmap.innerHTML = '<p class="muted">暂无汇总数据</p>'
    return
  }

  heatmap.innerHTML = ''

  // 从旧到新排列（左到右）
  const sorted = [...allSummaries].reverse()

  for (const summary of sorted) {
    const dot = document.createElement('div')
    dot.className = 'heatmap-dot cat-' + (summary.category || '工作')
    dot.dataset.index = allSummaries.indexOf(summary)

    dot.addEventListener('mouseenter', (e) => showHeatmapTooltip(e, summary))
    dot.addEventListener('mouseleave', hideHeatmapTooltip)
    dot.addEventListener('click', () => scrollToTimelineItem(summary))

    heatmap.appendChild(dot)
  }
}

function showHeatmapTooltip(e, summary) {
  const rect = e.target.getBoundingClientRect()
  const catColor = {
    '工作': '#4ade80',
    '娱乐': '#f87171',
    '学习': '#60a5fa',
    '社交': '#c084fc'
  }

  heatmapTooltip.innerHTML = `
    <div class="tt-time">${formatTimeRange(summary)}</div>
    <div class="tt-project">${escapeHtml(summary.projectName)}</div>
    <div class="tt-category" style="background:${catColor[summary.category] || '#4ade80'}22;color:${catColor[summary.category] || '#4ade80'}">${escapeHtml(summary.category)}</div>
    ${summary.entryCount ? `<div style="margin-top:4px;color:#6b6b8d;font-size:11px">${summary.entryCount}条记录</div>` : ''}
  `

  heatmapTooltip.style.display = 'block'
  // 定位 tooltip
  const ttRect = heatmapTooltip.getBoundingClientRect()
  let left = rect.left + rect.width / 2 - ttRect.width / 2
  let top = rect.top - ttRect.height - 8

  // 边界检查
  if (left < 4) left = 4
  if (left + ttRect.width > window.innerWidth - 4) left = window.innerWidth - ttRect.width - 4
  if (top < 4) top = rect.bottom + 8

  heatmapTooltip.style.left = left + 'px'
  heatmapTooltip.style.top = top + 'px'
}

function hideHeatmapTooltip() {
  heatmapTooltip.style.display = 'none'
}

function scrollToTimelineItem(summary) {
  // 找到对应的 timeline item 并滚动到它
  const items = timeline.querySelectorAll('.timeline-item')
  for (const item of items) {
    if (item.dataset.periodStartMs === String(summary.periodStartMs)) {
      item.scrollIntoView({ behavior: 'smooth', block: 'center' })
      item.style.borderColor = '#4f46e5'
      setTimeout(() => { item.style.borderColor = '' }, 2000)
      return
    }
  }
}

// ==================== Timeline ====================

function renderTimeline() {
  // 应用筛选
  applyFilters()

  // 重置分页
  timelinePage = 0
  renderTimelinePage()
}

function renderTimelinePage() {
  const start = 0
  const end = (timelinePage + 1) * PAGE_SIZE
  const pageItems = filteredSummaries.slice(start, end)

  if (pageItems.length === 0) {
    timeline.innerHTML = '<p class="muted">暂无活动记录</p>'
    loadMoreBtn.style.display = 'none'
    return
  }

  // 移除占位符
  const placeholder = timeline.querySelector('.muted')
  if (placeholder) placeholder.remove()

  // 如果是第一页，清空
  if (timelinePage === 0) {
    timeline.innerHTML = ''
  }

  // 只渲染新增的项
  const existingCount = timeline.children.length
  for (let i = existingCount; i < pageItems.length; i++) {
    const item = createTimelineItem(pageItems[i])
    timeline.appendChild(item)
  }

  // 显示/隐藏加载更多按钮
  const hasMore = filteredSummaries.length > end
  loadMoreBtn.style.display = hasMore ? 'block' : 'none'
}

function createTimelineItem(summary) {
  const item = document.createElement('div')
  item.className = 'timeline-item'
  item.dataset.periodStartMs = summary.periodStartMs

  // 头部：时间 + 分类
  const header = document.createElement('div')
  header.className = 'timeline-item-header'

  const time = document.createElement('span')
  time.className = 'timeline-time'
  time.textContent = formatTimeRange(summary)

  const category = document.createElement('span')
  category.className = 'timeline-category cat-' + (summary.category || '工作')
  category.textContent = summary.category || '工作'

  header.appendChild(time)
  header.appendChild(category)

  // 项目名称
  const project = document.createElement('div')
  project.className = 'timeline-project'
  project.textContent = summary.projectName || '未知项目'

  // 描述
  const desc = document.createElement('div')
  desc.className = 'timeline-description'
  desc.textContent = summary.description || '（无描述）'

  item.appendChild(header)
  item.appendChild(project)
  item.appendChild(desc)

  // 软件标签
  if (summary.softwareUsed && summary.softwareUsed.length > 0) {
    const swContainer = document.createElement('div')
    swContainer.className = 'timeline-software'

    for (const sw of summary.softwareUsed) {
      const tag = document.createElement('span')
      tag.className = 'software-tag'
      tag.textContent = sw
      swContainer.appendChild(tag)
    }

    item.appendChild(swContainer)
  }

  // 待办事项
  if (summary.todoItems && summary.todoItems.length > 0) {
    const todos = document.createElement('div')
    todos.className = 'timeline-todos'
    todos.innerHTML = '<strong>📋 可能遗漏的待办:</strong>' +
      summary.todoItems.map(t => escapeHtml(t)).join('<br>')

    item.appendChild(todos)
  }

  // 记录条数
  if (summary.entryCount) {
    const count = document.createElement('div')
    count.className = 'timeline-entry-count'
    count.textContent = `基于 ${summary.entryCount} 条截屏记录`
    item.appendChild(count)
  }

  return item
}

// ==================== Filters ====================

function populateFilters() {
  // 收集所有项目名称
  const projects = new Set()
  const software = new Set()

  for (const s of allSummaries) {
    if (s.projectName) projects.add(s.projectName)
    if (s.softwareUsed) {
      for (const sw of s.softwareUsed) software.add(sw)
    }
  }

  // 填充项目下拉框
  filterProject.innerHTML = '<option value="">所有项目</option>'
  for (const p of Array.from(projects).sort()) {
    const opt = document.createElement('option')
    opt.value = p
    opt.textContent = p
    filterProject.appendChild(opt)
  }

  // 填充软件下拉框
  filterSoftware.innerHTML = '<option value="">所有软件</option>'
  for (const s of Array.from(software).sort()) {
    const opt = document.createElement('option')
    opt.value = s
    opt.textContent = s
    filterSoftware.appendChild(opt)
  }
}

function applyFilters() {
  const projectFilter = filterProject.value
  const softwareFilter = filterSoftware.value
  const dateFilter = filterDate.value

  filteredSummaries = allSummaries.filter(s => {
    // 项目筛选
    if (projectFilter && s.projectName !== projectFilter) return false

    // 软件筛选
    if (softwareFilter && (!s.softwareUsed || !s.softwareUsed.includes(softwareFilter))) return false

    // 日期筛选
    if (dateFilter) {
      const itemDate = s.periodStart ? s.periodStart.substring(0, 10) : ''
      if (itemDate !== dateFilter) return false
    }

    return true
  })
}

function clearFilters() {
  filterProject.value = ''
  filterSoftware.value = ''
  filterDate.value = ''
  renderTimeline()
}

// ==================== Aggregation Status ====================

function updateAggregationStatus(status) {
  if (status.isAggregating) {
    aggStatusBadge.style.display = 'flex'
    aggStatusBar.style.display = 'flex'

    if (status.current && status.current.periodStartMs) {
      const time = new Date(status.current.periodStartMs)
      const timeStr = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
      aggStatusText.textContent = `正在汇总 ${timeStr} 的活动...`
    } else {
      aggStatusText.textContent = '正在汇总活动...'
    }

    if (status.queueTotal > 0) {
      const remaining = status.queueRemaining
      const total = status.queueTotal
      aggProgress.textContent = `队列: ${remaining}/${total}`
    } else {
      aggProgress.textContent = ''
    }
  } else {
    aggStatusBadge.style.display = 'none'
    aggStatusBar.style.display = 'none'
  }
}

// ==================== Real-time Updates ====================

function handleNewAggregation(summary) {
  // 检查是否已存在（避免重复）
  const existingIdx = allSummaries.findIndex(s => s.periodStartMs === summary.periodStartMs)
  if (existingIdx !== -1) {
    allSummaries[existingIdx] = summary
  } else {
    // 插入到正确位置（最新的在前）
    allSummaries.unshift(summary)
  }

  // 更新 UI
  renderHeatmap()
  populateFilters()
  renderTimeline()
}

// ==================== Event Listeners ====================

function setupActivityListeners() {
  if (activityListenersSetup) return
  activityListenersSetup = true

  loadMoreBtn.addEventListener('click', () => {
    timelinePage++
    renderTimelinePage()
  })

  filterProject.addEventListener('change', renderTimeline)
  filterSoftware.addEventListener('change', renderTimeline)
  filterDate.addEventListener('change', renderTimeline)
  clearFilterBtn.addEventListener('click', clearFilters)

  window.api.onAggregationStatus((status) => {
    updateAggregationStatus(status)
  })

  window.api.onNewAggregation((summary) => {
    handleNewAggregation(summary)
  })
}

// ==================== Initialization ====================

async function initActivityTab() {
  setupActivityListeners()

  try {
    // 加载所有汇总数据
    allSummaries = await window.api.getActivitySummaries()
    filteredSummaries = [...allSummaries]

    // 获取当前汇总状态
    const status = await window.api.getAggregationStatus()
    updateAggregationStatus(status)

    // 渲染 UI
    renderHeatmap()
    populateFilters()
    renderTimeline()
  } catch (err) {
    console.error('初始化动态标签页失败:', err)
    timeline.innerHTML = `<p class="muted">加载失败: ${escapeHtml(err.message)}</p>`
  }
}
