'use strict'

// ==================== State ====================
let calendarYear = 0
let calendarMonth = 0 // 0-11
let selectedDate = null // '2026-08-02'
let diaryDates = new Set()
let diaryListenersSetup = false
let currentDiary = null

// ==================== DOM Elements ====================
const calendarGrid = document.getElementById('calendarGrid')
const calendarMonthLabel = document.getElementById('calendarMonthLabel')
const prevMonthBtn = document.getElementById('prevMonth')
const nextMonthBtn = document.getElementById('nextMonth')
const diaryContent = document.getElementById('diaryContent')
const diaryStatusBadge = document.getElementById('diaryStatusBadge')
const diaryStatusBar = document.getElementById('diaryStatusBar')
const diaryStatusText = document.getElementById('diaryStatusText')
const diaryProgress = document.getElementById('diaryProgress')

// ==================== Helpers ====================

function pad(n) {
  return String(n).padStart(2, '0')
}

function dateToStr(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ==================== Calendar ====================

function renderCalendar() {
  calendarMonthLabel.textContent = `${calendarYear}年 ${calendarMonth + 1}月`
  calendarGrid.innerHTML = ''

  const firstDay = new Date(calendarYear, calendarMonth, 1)
  const lastDay = new Date(calendarYear, calendarMonth + 1, 0)
  // 周一=0, 周日=6
  let startOffset = firstDay.getDay() - 1
  if (startOffset < 0) startOffset = 6

  const daysInMonth = lastDay.getDate()
  const today = new Date()
  const todayStr = dateToStr(today.getFullYear(), today.getMonth(), today.getDate())

  // 空白格
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div')
    empty.className = 'cal-day empty'
    calendarGrid.appendChild(empty)
  }

  // 日期格
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = dateToStr(calendarYear, calendarMonth, day)
    const cell = document.createElement('div')
    cell.className = 'cal-day'
    cell.dataset.date = dateStr

    if (dateStr === todayStr) {
      cell.classList.add('today')
    }
    if (selectedDate === dateStr) {
      cell.classList.add('selected')
    }
    if (diaryDates.has(dateStr)) {
      cell.classList.add('has-diary')
    }

    const num = document.createElement('span')
    num.className = 'cal-day-num'
    num.textContent = day
    cell.appendChild(num)

    if (diaryDates.has(dateStr)) {
      const dot = document.createElement('span')
      dot.className = 'cal-day-dot'
      cell.appendChild(dot)
    }

    cell.addEventListener('click', () => selectDate(dateStr))
    calendarGrid.appendChild(cell)
  }
}

function selectDate(dateStr) {
  selectedDate = dateStr
  renderCalendar()
  loadDiary(dateStr)
}

// ==================== Diary Loading ====================

async function loadDiary(dateStr) {
  diaryContent.innerHTML = '<p class="muted">加载中...</p>'

  try {
    let diary = await window.api.getDiary(dateStr)

    if (!diary) {
      // 没有日记，尝试生成
      diaryContent.innerHTML = `
        <div class="diary-empty">
          <p class="muted">${dateStr} 还没有日记</p>
          <button id="genDiaryBtn" class="btn btn-primary">生成日记</button>
        </div>
      `
      document.getElementById('genDiaryBtn').addEventListener('click', () => generateDiaryForDate(dateStr))
      return
    }

    currentDiary = diary
    renderDiary(diary)
  } catch (err) {
    diaryContent.innerHTML = `<p class="muted">加载失败: ${escapeHtml(err.message)}</p>`
  }
}

async function generateDiaryForDate(dateStr) {
  diaryContent.innerHTML = `
    <div class="diary-generating">
      <span class="agg-spinner"></span>
      <p>正在生成 ${dateStr} 的日记，请稍候...</p>
      <p class="muted" style="font-size:12px;margin-top:8px">这可能需要1-2分钟</p>
    </div>
  `

  try {
    const result = await window.api.generateDiary(dateStr)
    if (result.success) {
      currentDiary = result.diary
      diaryDates.add(dateStr)
      renderCalendar()
      renderDiary(result.diary)
    } else {
      diaryContent.innerHTML = `
        <div class="diary-empty">
          <p class="muted" style="color:#f87171">生成失败: ${escapeHtml(result.error)}</p>
          <button id="genDiaryBtn" class="btn btn-primary">重试</button>
        </div>
      `
      document.getElementById('genDiaryBtn').addEventListener('click', () => generateDiaryForDate(dateStr))
    }
  } catch (err) {
    diaryContent.innerHTML = `<p class="muted" style="color:#f87171">生成异常: ${escapeHtml(err.message)}</p>`
  }
}

// ==================== Diary Rendering ====================

function renderDiary(diary) {
  const mainItemsHtml = (diary.mainItems || []).map((item, i) => `
    <div class="diary-main-item">
      <span class="diary-item-num">${i + 1}</span>
      <div class="diary-item-text">
        <div class="diary-item-title">${escapeHtml(item.title)}</div>
        <div class="diary-item-desc">${escapeHtml(item.description)}</div>
      </div>
    </div>
  `).join('')

  const todosHtml = (diary.todos || []).length > 0
    ? (diary.todos || []).map(t => `<li>${escapeHtml(t)}</li>`).join('')
    : '<li class="muted">暂无</li>'

  const suggestionsHtml = (diary.suggestions || []).length > 0
    ? (diary.suggestions || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')
    : '<li class="muted">暂无</li>'

  const categoryStatsHtml = diary.categoryStats
    ? Object.entries(diary.categoryStats).map(([k, v]) =>
        `<span class="diary-cat-tag cat-${k}">${k} ${v * 10}min</span>`
      ).join('')
    : ''

  diaryContent.innerHTML = `
    <article class="diary-article">
      <header class="diary-header">
        <h2 class="diary-date-title">${diary.dateStr}</h2>
        <span class="diary-meta">${diary.summaryCount || 0} 个10分钟汇总 · ${diary.totalEntries || 0} 条截屏</span>
      </header>

      ${categoryStatsHtml ? `<div class="diary-cats">${categoryStatsHtml}</div>` : ''}

      <section class="diary-section">
        <h3>📝 简短总结</h3>
        <p>${escapeHtml(diary.briefSummary || '无')}</p>
      </section>

      <section class="diary-section">
        <h3>🎯 主要事项</h3>
        <div class="diary-main-items">${mainItemsHtml || '<p class="muted">暂无</p>'}</div>
      </section>

      <section class="diary-section">
        <h3>✨ 高光时刻</h3>
        <p>${escapeHtml(diary.highlights || '无')}</p>
      </section>

      <section class="diary-section">
        <h3>📋 待办事项</h3>
        <ul class="diary-list">${todosHtml}</ul>
      </section>

      <section class="diary-section">
        <h3>💡 优化建议</h3>
        <ul class="diary-list">${suggestionsHtml}</ul>
      </section>

      <section class="diary-section diary-reminder">
        <h3>💌 温馨提示</h3>
        <p>${escapeHtml(diary.warmReminder || '无')}</p>
      </section>

      <footer class="diary-footer">
        生成于 ${escapeHtml(diary.generatedAt || '未知时间')}
      </footer>
    </article>
  `
}

// ==================== Diary Status ====================

function updateDiaryStatus(status) {
  if (status.isGenerating) {
    diaryStatusBadge.style.display = 'flex'
    diaryStatusBar.style.display = 'flex'

    if (status.currentDate) {
      diaryStatusText.textContent = `正在生成 ${status.currentDate} 的日记...`
    } else {
      diaryStatusText.textContent = '正在生成日记...'
    }

    if (status.queueTotal > 0) {
      diaryProgress.textContent = `队列: ${status.queueRemaining}/${status.queueTotal}`
    } else {
      diaryProgress.textContent = ''
    }
  } else {
    diaryStatusBadge.style.display = 'none'
    diaryStatusBar.style.display = 'none'
  }
}

function handleDiaryGenerated(data) {
  // 如果当前正在查看这个日期，更新显示
  if (selectedDate === data.dateStr) {
    currentDiary = data.diary
    diaryDates.add(data.dateStr)
    renderCalendar()
    renderDiary(data.diary)
  } else {
    diaryDates.add(data.dateStr)
    renderCalendar()
  }
}

// ==================== Event Listeners ====================

function setupDiaryListeners() {
  if (diaryListenersSetup) return
  diaryListenersSetup = true

  prevMonthBtn.addEventListener('click', () => {
    calendarMonth--
    if (calendarMonth < 0) {
      calendarMonth = 11
      calendarYear--
    }
    renderCalendar()
  })

  nextMonthBtn.addEventListener('click', () => {
    calendarMonth++
    if (calendarMonth > 11) {
      calendarMonth = 0
      calendarYear++
    }
    renderCalendar()
  })

  window.api.onDiaryStatus((status) => {
    updateDiaryStatus(status)
  })

  window.api.onDiaryGenerated((data) => {
    handleDiaryGenerated(data)
  })
}

// ==================== Initialization ====================

async function initDiaryTab() {
  setupDiaryListeners()

  // 默认显示昨天的日记
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  calendarYear = yesterday.getFullYear()
  calendarMonth = yesterday.getMonth()
  selectedDate = dateToStr(calendarYear, calendarMonth, yesterday.getDate())

  // 加载有日记的日期列表
  try {
    const dates = await window.api.getDiaryDates()
    diaryDates = new Set(dates)
  } catch (err) {
    console.error('加载日记日期失败:', err)
  }

  // 获取当前日记生成状态
  try {
    const status = await window.api.getDiaryStatus()
    updateDiaryStatus(status)
  } catch { /* */ }

  renderCalendar()
  loadDiary(selectedDate)
}
