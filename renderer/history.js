'use strict'

// ==================== DOM Elements ====================
const datePicker = document.getElementById('datePicker')
const prevDayBtn = document.getElementById('prevDayBtn')
const nextDayBtn = document.getElementById('nextDayBtn')
const entryCountEl = document.getElementById('entryCount')
const summaryBtn = document.getElementById('summaryBtn')
const summarySection = document.getElementById('summarySection')
const summaryContent = document.getElementById('summaryContent')
const summaryMeta = document.getElementById('summaryMeta')
const closeSummaryBtn = document.getElementById('closeSummaryBtn')
const entryList = document.getElementById('entryList')
const detailView = document.getElementById('detailView')
const pagerEl = document.getElementById('entryPager')
const pageInfoEl = document.getElementById('entryPageInfo')
const prevPageBtn = document.getElementById('entryPrevPage')
const nextPageBtn = document.getElementById('entryNextPage')

// ==================== State ====================
let availableDates = []
let currentEntries = []
let selectedEntryIndex = -1
let currentPage = 0

// 一页最多渲染 100 条：一天可能有几千条记录，全量渲染会同时创建几千个
// DOM 节点与图片位图，是渲染进程内存暴涨的主因
const PAGE_SIZE = 100

// ==================== Date Helpers ====================

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTimeFromTimestamp(ts) {
  if (!ts) return ''
  // ts 格式: "2026-08-02 15:45:35"
  return ts.substring(11)
}

// ==================== Data Loading ====================

async function loadAvailableDates() {
  try {
    availableDates = await window.api.getHistoryDates()
    updateNavButtons()
  } catch (err) {
    console.error('加载日期列表失败:', err)
  }
}

async function loadDate(dateStr) {
  entryList.innerHTML = '<div class="empty-state"><p>加载中...</p></div>'
  detailView.innerHTML = '<div class="empty-state"><p>点击左侧记录查看详情</p></div>'
  currentEntries = []
  selectedEntryIndex = -1
  currentPage = 0

  try {
    currentEntries = await window.api.getHistoryLogs(dateStr)
    renderEntryList()
    entryCountEl.textContent = `${currentEntries.length} 条记录`
    updateNavButtons()

    // 检查是否已有每日总结
    const summary = await window.api.getDailySummary(dateStr)
    if (summary.exists) {
      showSummary(summary)
    } else {
      hideSummary()
    }
  } catch (err) {
    entryList.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`
  }
}

// ==================== Rendering ====================

function renderEntryList() {
  // 先断开旧图片的引用并清空 DOM，让渲染进程可以回收上一页占用的内存
  entryList.querySelectorAll('img').forEach(img => { img.src = '' })
  entryList.innerHTML = ''

  if (currentEntries.length === 0) {
    entryList.innerHTML = '<div class="empty-state"><p>该日期没有记录</p></div>'
    updatePager()
    return
  }

  const start = currentPage * PAGE_SIZE
  const pageItems = currentEntries.slice(start, start + PAGE_SIZE)

  pageItems.forEach((entry, i) => {
    const index = start + i
    const item = document.createElement('div')
    item.className = 'entry-item'
    item.dataset.index = index

    const thumb = document.createElement('div')
    thumb.className = 'entry-thumb-placeholder'
    thumb.textContent = '🖼'

    const info = document.createElement('div')
    info.className = 'entry-info'

    const time = document.createElement('div')
    time.className = 'entry-time'
    time.textContent = formatTimeFromTimestamp(entry.timestamp) || '未知时间'

    const activity = document.createElement('div')
    activity.className = 'entry-activity'
    // 去掉换行符，压缩成一行预览
    activity.textContent = (entry.activity || '无描述').replace(/\n/g, ' ').substring(0, 120)

    info.appendChild(time)
    info.appendChild(activity)
    item.appendChild(thumb)
    item.appendChild(info)

    item.addEventListener('click', () => selectEntry(index))
    entryList.appendChild(item)

    // 缩略图按需加载：只有滚动到可见区域的条目才会向主进程请求
    if (entry.imagePath) observeThumb(thumb, entry.imagePath)
  })

  updatePager()
}

// 可见性观察器：列表滚动到哪就加载到哪里，屏幕外的条目不发请求
const thumbObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        observer.unobserve(entry.target)
        const imagePath = entry.target.dataset.thumbPath
        if (imagePath) loadThumbnail(entry.target, imagePath)
      })
    }, { root: null, rootMargin: '200px 0px' })
  : null

function observeThumb(placeholder, imagePath) {
  placeholder.dataset.thumbPath = imagePath
  if (thumbObserver) {
    thumbObserver.observe(placeholder)
  } else {
    loadThumbnail(placeholder, imagePath)
  }
}

async function loadThumbnail(placeholder, imagePath) {
  try {
    // 关键：取缩略图（约 5KB），而不是整张截图（约 300KB，base64 后约 400KB）
    const result = await window.api.getThumbnail(imagePath, 160)
    if (result && result.success && placeholder.isConnected) {
      const img = document.createElement('img')
      img.className = 'entry-thumb'
      img.src = result.data
      placeholder.replaceWith(img)
    }
  } catch {
    // 缩略图加载失败不影响列表
  }
}

// ==================== Pagination ====================

function updatePager() {
  const total = currentEntries.length
  if (total <= PAGE_SIZE) {
    pagerEl.style.display = 'none'
    return
  }

  const pageCount = Math.ceil(total / PAGE_SIZE)
  pagerEl.style.display = 'flex'
  pageInfoEl.textContent = `第 ${currentPage + 1} / ${pageCount} 页 · 共 ${total} 条`
  prevPageBtn.disabled = currentPage === 0
  nextPageBtn.disabled = currentPage >= pageCount - 1
}

function goToPage(page) {
  const pageCount = Math.max(1, Math.ceil(currentEntries.length / PAGE_SIZE))
  const target = Math.min(Math.max(0, page), pageCount - 1)
  if (target === currentPage) return
  currentPage = target
  entryList.parentElement.scrollTop = 0
  renderEntryList()
}

function selectEntry(index) {
  selectedEntryIndex = index

  // 更新列表选中状态
  document.querySelectorAll('.entry-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.index) === index)
  })

  // 渲染详情
  const entry = currentEntries[index]
  if (!entry) return

  detailView.innerHTML = ''

  // 头部：时间 + 分析耗时
  const header = document.createElement('div')
  header.className = 'detail-header'

  const timestamp = document.createElement('div')
  timestamp.className = 'detail-timestamp'
  timestamp.textContent = entry.timestamp || '未知时间'

  const analysisTime = document.createElement('div')
  analysisTime.className = 'detail-analysis-time'
  analysisTime.textContent = `分析耗时: ${entry.analysisTimeMs || 0}ms`

  header.appendChild(timestamp)
  header.appendChild(analysisTime)
  detailView.appendChild(header)

  // 截图
  const screenshotContainer = document.createElement('div')
  screenshotContainer.className = 'detail-screenshot loading'
  screenshotContainer.textContent = '加载截图中...'
  detailView.appendChild(screenshotContainer)

  // 异步加载截图
  if (entry.imagePath) {
    window.api.getScreenshot(entry.imagePath).then(result => {
      if (result.success) {
        const img = document.createElement('img')
        img.className = 'detail-screenshot'
        img.src = result.data
        img.addEventListener('click', () => openImageModal(result.data))
        screenshotContainer.replaceWith(img)
      } else {
        screenshotContainer.textContent = '截图加载失败: ' + (result.error || '')
        screenshotContainer.classList.remove('loading')
      }
    }).catch(err => {
      screenshotContainer.textContent = '截图加载失败: ' + err.message
      screenshotContainer.classList.remove('loading')
    })
  } else {
    screenshotContainer.textContent = '无截图'
    screenshotContainer.classList.remove('loading')
  }

  // AI 分析
  const activityCard = document.createElement('div')
  activityCard.className = 'detail-activity-card'

  const activityTitle = document.createElement('h3')
  activityTitle.textContent = '🤖 AI 活动分析'

  const activityText = document.createElement('div')
  activityText.className = 'detail-activity-text'
  activityText.textContent = entry.activity || '（无分析结果）'

  activityCard.appendChild(activityTitle)
  activityCard.appendChild(activityText)
  detailView.appendChild(activityCard)

  // 元信息
  const meta = document.createElement('div')
  meta.className = 'detail-meta'

  const pathItem = document.createElement('div')
  pathItem.className = 'detail-meta-item'
  pathItem.textContent = '📁 ' + (entry.imagePath || '无路径')

  meta.appendChild(pathItem)
  detailView.appendChild(meta)
}

// ==================== Image Modal ====================

function openImageModal(src) {
  const modal = document.createElement('div')
  modal.className = 'image-modal'

  const img = document.createElement('img')
  img.src = src
  modal.appendChild(img)

  modal.addEventListener('click', () => modal.remove())
  document.body.appendChild(modal)
}

// ==================== Summary ====================

function showSummary(data) {
  summarySection.style.display = 'block'
  summaryContent.textContent = data.summary || '（无总结内容）'
  summaryMeta.textContent = `基于 ${data.entryCount || 0} 条记录 · 生成于 ${data.generatedAt || '未知时间'}`
}

function hideSummary() {
  summarySection.style.display = 'none'
}

async function handleGenerateSummary() {
  const dateStr = datePicker.value
  if (!dateStr) return

  summaryBtn.disabled = true
  summaryBtn.classList.add('loading')
  summaryBtn.textContent = '生成中...'

  try {
    const result = await window.api.generateDailySummary(dateStr)
    if (result.success) {
      showSummary(result)
    } else {
      alert('生成总结失败: ' + (result.error || '未知错误'))
    }
  } catch (err) {
    alert('生成总结失败: ' + err.message)
  } finally {
    summaryBtn.disabled = false
    summaryBtn.classList.remove('loading')
    summaryBtn.textContent = '生成每日总结'
  }
}

// ==================== Navigation ====================

function updateNavButtons() {
  const currentDate = datePicker.value
  if (availableDates.length === 0) {
    prevDayBtn.disabled = true
    nextDayBtn.disabled = true
    return
  }

  // 只在有记录的日期之间导航
  const idx = availableDates.indexOf(currentDate)
  if (idx === -1) {
    prevDayBtn.disabled = false
    nextDayBtn.disabled = true
    return
  }

  prevDayBtn.disabled = idx >= availableDates.length - 1
  nextDayBtn.disabled = idx <= 0
}

function navigateDate(delta) {
  const currentDate = datePicker.value

  // 如果当前日期在可用日期列表中，则跳转到上/下一个有记录的日期
  const idx = availableDates.indexOf(currentDate)
  if (idx !== -1) {
    const newIdx = idx - delta // 列表是从新到旧排序，delta=1 表示前一天（更旧）
    if (newIdx >= 0 && newIdx < availableDates.length) {
      datePicker.value = availableDates[newIdx]
      loadDate(availableDates[newIdx])
      return
    }
  }

  // 否则按自然日导航
  const newDate = shiftDate(currentDate, delta)
  datePicker.value = newDate
  loadDate(newDate)
}

// ==================== Event Listeners ====================

datePicker.addEventListener('change', () => {
  loadDate(datePicker.value)
})

prevDayBtn.addEventListener('click', () => navigateDate(-1))
nextDayBtn.addEventListener('click', () => navigateDate(1))
prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1))
nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1))
summaryBtn.addEventListener('click', handleGenerateSummary)
closeSummaryBtn.addEventListener('click', hideSummary)

// ==================== Initialize ====================

async function init() {
  // 默认显示今天
  const today = todayStr()
  datePicker.value = today

  await loadAvailableDates()
  await loadDate(today)
}

init()
