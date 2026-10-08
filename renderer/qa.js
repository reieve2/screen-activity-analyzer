'use strict'

// ==================== DOM Elements ====================
const qaMessages = document.getElementById('qaMessages')
const qaInput = document.getElementById('qaInput')
const qaSendBtn = document.getElementById('qaSendBtn')

// ==================== State ====================
let qaInProgress = false
let qaListenersSetup = false
let currentProgressContainer = null

// ==================== Helpers ====================

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function scrollToBottom() {
  qaMessages.scrollTop = qaMessages.scrollHeight
}

// ==================== Message Rendering ====================

function addUserMessage(text) {
  const msg = document.createElement('div')
  msg.className = 'qa-msg qa-msg-user'
  msg.innerHTML = `<div class="qa-msg-bubble">${escapeHtml(text)}</div>`
  qaMessages.appendChild(msg)
  scrollToBottom()
}

function addBotMessage(html) {
  const msg = document.createElement('div')
  msg.className = 'qa-msg qa-msg-bot'
  msg.innerHTML = html
  qaMessages.appendChild(msg)
  scrollToBottom()
  return msg
}

function addThinkingMessage() {
  const msg = document.createElement('div')
  msg.className = 'qa-msg qa-msg-bot'
  msg.innerHTML = `
    <div class="qa-msg-bubble qa-thinking">
      <span class="agg-spinner"></span>
      <span class="qa-thinking-text">思考中...</span>
    </div>
  `
  qaMessages.appendChild(msg)
  scrollToBottom()
  return msg
}

function addSearchStep(container, data) {
  const step = document.createElement('div')
  step.className = 'qa-search-step'

  if (data.type === 'thinking') {
    step.className += ' qa-step-thinking'
    step.innerHTML = `
      <span class="agg-spinner qa-step-spinner"></span>
      <span>${escapeHtml(data.message)}</span>
    `
  } else if (data.type === 'searching') {
    step.innerHTML = `
      <span class="qa-step-icon">🔍</span>
      <span>${escapeHtml(data.message)}</span>
    `
  } else if (data.type === 'searched') {
    const countClass = data.resultCount > 0 ? 'qa-step-found' : 'qa-step-empty'
    step.innerHTML = `
      <span class="qa-step-icon">${data.resultCount > 0 ? '✅' : '⚪'}</span>
      <span>${escapeHtml(data.dataTypeName)} · 关键词: ${escapeHtml((data.keywords || []).join(', '))} · 范围: ${escapeHtml(data.dateRange || 'all')}</span>
      <span class="qa-step-count ${countClass}">${data.resultCount} 条</span>
    `
  } else if (data.type === 'answering') {
    step.className += ' qa-step-thinking'
    step.innerHTML = `
      <span class="agg-spinner qa-step-spinner"></span>
      <span>${escapeHtml(data.message)}</span>
    `
  }

  container.appendChild(step)
  scrollToBottom()
}

// ==================== Q&A Flow ====================

async function sendQuestion(question) {
  if (qaInProgress || !question.trim()) return

  qaInProgress = true
  qaInput.value = ''
  qaInput.disabled = true
  qaSendBtn.disabled = true
  qaSendBtn.textContent = '思考中...'

  // Remove welcome if present
  const welcome = qaMessages.querySelector('.qa-welcome')
  if (welcome) welcome.remove()

  addUserMessage(question)

  // Create bot message container for progress + answer
  const botMsg = document.createElement('div')
  botMsg.className = 'qa-msg qa-msg-bot'
  botMsg.innerHTML = `<div class="qa-msg-bubble qa-progress-bubble"></div>`
  const progressContainer = botMsg.querySelector('.qa-progress-bubble')
  currentProgressContainer = progressContainer
  qaMessages.appendChild(botMsg)
  scrollToBottom()

  // Add initial thinking indicator
  addSearchStep(progressContainer, { type: 'thinking', message: '正在分析问题...' })

  try {
    const result = await window.api.answerQuestion(question)

    // Clear progress container and show search history + answer
    progressContainer.innerHTML = ''

    // Show search steps
    if (result.searchHistory && result.searchHistory.length > 0) {
      const stepsHeader = document.createElement('div')
      stepsHeader.className = 'qa-steps-header'
      stepsHeader.textContent = `搜索过程（${result.searchHistory.length} 步）`
      progressContainer.appendChild(stepsHeader)

      for (const h of result.searchHistory) {
        const countClass = h.resultCount > 0 ? 'qa-step-found' : 'qa-step-empty'
        const step = document.createElement('div')
        step.className = 'qa-search-step qa-step-done'
        step.innerHTML = `
          <span class="qa-step-icon">${h.resultCount > 0 ? '✅' : '⚪'}</span>
          <span>${escapeHtml(h.dataTypeName)} · 关键词: ${escapeHtml((h.keywords || []).join(', '))} · 范围: ${escapeHtml(h.dateRange || 'all')}</span>
          <span class="qa-step-count ${countClass}">${h.resultCount} 条</span>
        `
        progressContainer.appendChild(step)
      }
    }

    // Show answer
    if (result.success) {
      const answerDiv = document.createElement('div')
      answerDiv.className = 'qa-answer'
      answerDiv.innerHTML = escapeHtml(result.answer).replace(/\n/g, '<br>')
      progressContainer.appendChild(answerDiv)
    } else {
      const errorDiv = document.createElement('div')
      errorDiv.className = 'qa-error'
      errorDiv.textContent = '回答失败: ' + (result.error || '未知错误')
      progressContainer.appendChild(errorDiv)
    }
  } catch (err) {
    progressContainer.innerHTML = `<div class="qa-error">出错了: ${escapeHtml(err.message)}</div>`
  } finally {
    qaInProgress = false
    qaInput.disabled = false
    qaSendBtn.disabled = false
    qaSendBtn.textContent = '提问'
    currentProgressContainer = null
    qaInput.focus()
    scrollToBottom()
  }
}

// ==================== Event Listeners ====================

function setupQaListeners() {
  if (qaListenersSetup) return
  qaListenersSetup = true

  qaSendBtn.addEventListener('click', () => {
    sendQuestion(qaInput.value)
  })

  qaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendQuestion(qaInput.value)
    }
  })

  // Suggestion buttons
  document.querySelectorAll('.qa-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      sendQuestion(btn.textContent)
    })
  })

  // Progress updates - append to the current progress container
  window.api.onQaProgress((data) => {
    if (currentProgressContainer) {
      addSearchStep(currentProgressContainer, data)
    }
  })
}

// ==================== Initialization ====================

function initQaTab() {
  setupQaListeners()
  qaInput.focus()
}
