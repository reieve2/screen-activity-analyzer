'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 主窗口 API
  start: () => ipcRenderer.invoke('start'),
  stop: () => ipcRenderer.invoke('stop'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
  onLog: (callback) => ipcRenderer.on('log', (event, data) => callback(data)),

  // 历史窗口 API
  openHistory: () => ipcRenderer.invoke('open-history'),
  getHistoryDates: () => ipcRenderer.invoke('get-history-dates'),
  getHistoryLogs: (dateStr) => ipcRenderer.invoke('get-history-logs', { dateStr }),
  getScreenshot: (imagePath) => ipcRenderer.invoke('get-screenshot', imagePath),
  generateDailySummary: (dateStr) => ipcRenderer.invoke('generate-daily-summary', { dateStr }),
  getDailySummary: (dateStr) => ipcRenderer.invoke('get-daily-summary', { dateStr }),

  // 10分钟汇总 API
  getActivitySummaries: () => ipcRenderer.invoke('get-activity-summaries'),
  getAggregationStatus: () => ipcRenderer.invoke('get-aggregation-status'),
  onAggregationStatus: (callback) => ipcRenderer.on('aggregation-status', (event, data) => callback(data)),
  onNewAggregation: (callback) => ipcRenderer.on('new-aggregation', (event, data) => callback(data)),

  // 日记 API
  getDiary: (dateStr) => ipcRenderer.invoke('get-diary', { dateStr }),
  generateDiary: (dateStr) => ipcRenderer.invoke('generate-diary', { dateStr }),
  getDiaryDates: () => ipcRenderer.invoke('get-diary-dates'),
  getDiaryStatus: () => ipcRenderer.invoke('get-diary-status'),
  onDiaryStatus: (callback) => ipcRenderer.on('diary-status', (event, data) => callback(data)),
  onDiaryGenerated: (callback) => ipcRenderer.on('diary-generated', (event, data) => callback(data)),

  // 看板 API
  getDashboardData: (range, dateStr) => ipcRenderer.invoke('get-dashboard-data', { range, dateStr }),

  // 问答 API
  answerQuestion: (question) => ipcRenderer.invoke('answer-question', { question }),
  onQaProgress: (callback) => ipcRenderer.on('qa-progress', (event, data) => callback(data)),

  // 设置 API
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getFontPresets: () => ipcRenderer.invoke('get-font-presets')
})
