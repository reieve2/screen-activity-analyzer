'use strict'

// ==================== Settings State ====================

let currentSettings = null
let fontPresets = null

const AREA_LABELS = {
  home:      '主页',
  activity:  '动态',
  diary:     '日记',
  dashboard: '看板',
  qa:        '问答'
}

const AREA_ORDER = ['home', 'activity', 'diary', 'dashboard', 'qa']

// ==================== Load & Save ====================

async function loadSettingsData() {
  try {
    currentSettings = await window.api.getSettings()
    fontPresets = await window.api.getFontPresets()
    // Ensure all areas are initialized
    if (!currentSettings.areas) currentSettings.areas = {}
    for (const area of AREA_ORDER) {
      if (!currentSettings.areas[area]) {
        currentSettings.areas[area] = { enabled: false, fontSize: currentSettings.global.fontSize, fontColor: currentSettings.global.fontColor }
      }
    }
  } catch (err) {
    console.error('加载设置失败:', err)
    currentSettings = {
      preset: 'standard',
      global: { fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      areas: {}
    }
    fontPresets = {
      standard: { fontSize: 14, fontColor: 'rgba(255,255,255,0.92)', label: '标准' }
    }
  }
}

async function saveSettingsData() {
  try {
    await window.api.saveSettings(currentSettings)
    applyFontSettings()
    showToast('设置已保存')
  } catch (err) {
    showToast('保存失败: ' + err.message, true)
  }
}

// ==================== Apply Font Settings ====================

function applyFontSettings() {
  if (!currentSettings) return

  const globalSize = currentSettings.global.fontSize
  const globalColor = currentSettings.global.fontColor

  // Set global defaults on body
  document.body.style.setProperty('--global-font-size', globalSize + 'px')
  document.body.style.setProperty('--global-font-color', globalColor)

  // Apply per-area settings
  for (const area of AREA_ORDER) {
    const tabEl = document.getElementById('tab-' + area)
    if (!tabEl) continue

    const areaSetting = currentSettings.areas[area]
    if (areaSetting && areaSetting.enabled) {
      tabEl.style.setProperty('--area-font-size', areaSetting.fontSize + 'px')
      tabEl.style.setProperty('--area-font-color', areaSetting.fontColor)
    } else {
      tabEl.style.setProperty('--area-font-size', globalSize + 'px')
      tabEl.style.setProperty('--area-font-color', globalColor)
    }
  }
}

// ==================== UI Rendering ====================

function renderPresets() {
  const grid = document.getElementById('presetGrid')
  grid.innerHTML = ''

  for (const [key, preset] of Object.entries(fontPresets)) {
    const card = document.createElement('div')
    card.className = 'preset-card' + (currentSettings.preset === key ? ' active' : '')
    card.dataset.preset = key

    card.innerHTML =
      '<div class="preset-preview" style="font-size:' + preset.fontSize + 'px;color:' + preset.fontColor + ';">' +
      'Aa 文字' +
      '</div>' +
      '<div class="preset-info">' +
      '<span class="preset-name">' + preset.label + '</span>' +
      '<span class="preset-meta">' + preset.fontSize + 'px</span>' +
      '</div>'

    card.addEventListener('click', () => applyPreset(key))
    grid.appendChild(card)
  }
}

function applyPreset(key) {
  const preset = fontPresets[key]
  if (!preset) return

  currentSettings.preset = key
  currentSettings.global.fontSize = preset.fontSize
  currentSettings.global.fontColor = preset.fontColor

  // Reset all areas to disabled (use global)
  for (const area of AREA_ORDER) {
    if (!currentSettings.areas[area]) {
      currentSettings.areas[area] = { enabled: false, fontSize: preset.fontSize, fontColor: preset.fontColor }
    } else {
      currentSettings.areas[area].enabled = false
      currentSettings.areas[area].fontSize = preset.fontSize
      currentSettings.areas[area].fontColor = preset.fontColor
    }
  }

  renderPresets()
  renderGlobalControls()
  renderAreaSettings()
  applyFontSettings()
}

function renderGlobalControls() {
  const sizeSlider = document.getElementById('globalFontSize')
  const sizeDisplay = document.getElementById('globalFontSizeVal')
  const colorPicker = document.getElementById('globalFontColor')
  const colorDisplay = document.getElementById('globalFontColorVal')
  const preview = document.getElementById('globalPreview')

  sizeSlider.value = currentSettings.global.fontSize
  sizeDisplay.textContent = currentSettings.global.fontSize + 'px'
  preview.style.fontSize = currentSettings.global.fontSize + 'px'

  // Convert rgba to hex for color picker
  const hexColor = rgbaToHex(currentSettings.global.fontColor)
  colorPicker.value = hexColor
  colorDisplay.textContent = hexColor
  preview.style.color = currentSettings.global.fontColor

  // Clear preset selection when manually adjusting
  sizeSlider.oninput = function() {
    currentSettings.preset = 'custom'
    currentSettings.global.fontSize = parseInt(this.value)
    sizeDisplay.textContent = this.value + 'px'
    preview.style.fontSize = this.value + 'px'
    updatePresetSelection()
    applyFontSettings()
  }

  colorPicker.oninput = function() {
    currentSettings.preset = 'custom'
    const hex = this.value
    currentSettings.global.fontColor = hexToRgba(hex)
    colorDisplay.textContent = hex
    preview.style.color = currentSettings.global.fontColor
    updatePresetSelection()
    applyFontSettings()
  }
}

function renderAreaSettings() {
  const list = document.getElementById('areaSettingsList')
  list.innerHTML = ''

  for (const area of AREA_ORDER) {
    const setting = currentSettings.areas[area] || { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' }
    const label = AREA_LABELS[area]

    const row = document.createElement('div')
    row.className = 'area-settings-row' + (setting.enabled ? ' enabled' : '')
    row.dataset.area = area

    row.innerHTML =
      '<div class="area-header">' +
        '<label class="area-toggle">' +
          '<input type="checkbox" data-area="' + area + '" data-field="enabled" ' + (setting.enabled ? 'checked' : '') + '>' +
          '<span class="area-name">' + label + '</span>' +
        '</label>' +
        '<span class="area-status">' + (setting.enabled ? '自定义' : '跟随全局') + '</span>' +
      '</div>' +
      '<div class="area-controls' + (setting.enabled ? '' : ' disabled') + '">' +
        '<div class="font-control-row">' +
          '<label class="font-control-label">大小</label>' +
          '<div class="font-control-inputs">' +
            '<input type="range" data-area="' + area + '" data-field="fontSize" class="font-slider" min="10" max="28" step="1" value="' + setting.fontSize + '"' + (setting.enabled ? '' : 'disabled') + '>' +
            '<span class="font-size-display">' + setting.fontSize + 'px</span>' +
          '</div>' +
        '</div>' +
        '<div class="font-control-row">' +
          '<label class="font-control-label">颜色</label>' +
          '<div class="font-control-inputs">' +
            '<input type="color" data-area="' + area + '" data-field="fontColor" class="font-color-picker" value="' + rgbaToHex(setting.fontColor) + '"' + (setting.enabled ? '' : 'disabled') + '>' +
            '<span class="font-color-display">' + rgbaToHex(setting.fontColor) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'

    list.appendChild(row)
  }

  // Bind events
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', function() {
      const area = this.dataset.area
      const field = this.dataset.field
      if (!currentSettings.areas[area]) {
        currentSettings.areas[area] = { enabled: false, fontSize: currentSettings.global.fontSize, fontColor: currentSettings.global.fontColor }
      }
      currentSettings.areas[area][field] = this.checked

      // Update row visual
      const row = this.closest('.area-settings-row')
      row.classList.toggle('enabled', this.checked)
      row.querySelector('.area-status').textContent = this.checked ? '自定义' : '跟随全局'
      row.querySelector('.area-controls').classList.toggle('disabled', !this.checked)

      // Enable/disable sliders
      row.querySelectorAll('input[type="range"], input[type="color"]').forEach(input => {
        input.disabled = !this.checked
      })

      applyFontSettings()
    })
  })

  list.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.addEventListener('input', function() {
      const area = this.dataset.area
      const field = this.dataset.field
      currentSettings.areas[area][field] = parseInt(this.value)
      this.parentElement.querySelector('.font-size-display').textContent = this.value + 'px'
      applyFontSettings()
    })
  })

  list.querySelectorAll('input[type="color"]').forEach(picker => {
    picker.addEventListener('input', function() {
      const area = this.dataset.area
      const field = this.dataset.field
      const hex = this.value
      currentSettings.areas[area][field] = hexToRgba(hex)
      this.parentElement.querySelector('.font-color-display').textContent = hex
      applyFontSettings()
    })
  })
}

function updatePresetSelection() {
  document.querySelectorAll('.preset-card').forEach(card => {
    card.classList.toggle('active', card.dataset.preset === currentSettings.preset)
  })
}

// ==================== Color Utilities ====================

function rgbaToHex(rgba) {
  // Parse rgba(r, g, b, a) or rgb(r, g, b) or #hex
  if (typeof rgba !== 'string') return '#ffffff'
  if (rgba.startsWith('#')) {
    if (rgba.length === 7) return rgba
    if (rgba.length === 4) {
      return '#' + rgba[1] + rgba[1] + rgba[2] + rgba[2] + rgba[3] + rgba[3]
    }
    return rgba
  }
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return '#ffffff'
  const r = parseInt(match[1])
  const g = parseInt(match[2])
  const b = parseInt(match[3])
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

function hexToRgba(hex) {
  // Convert #rrggbb to rgba(r, g, b, alpha)
  if (!hex || !hex.startsWith('#')) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 'rgba(' + r + ',' + g + ',' + b + ',0.92)'
}

// ==================== Toast ====================

function showToast(msg, isError) {
  let toast = document.getElementById('settingsToast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'settingsToast'
    toast.className = 'settings-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.className = 'settings-toast' + (isError ? ' error' : '')
  toast.style.display = 'block'
  setTimeout(() => { toast.style.display = 'none' }, 2500)
}

// ==================== Init ====================

async function initSettingsTab() {
  if (!currentSettings) {
    await loadSettingsData()
  }

  renderPresets()
  renderGlobalControls()
  renderAreaSettings()

  // Bind action buttons
  document.getElementById('saveSettingsBtn').onclick = saveSettingsData
  document.getElementById('resetSettingsBtn').onclick = function() {
    currentSettings = {
      preset: 'standard',
      global: { fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' },
      areas: {}
    }
    for (const area of AREA_ORDER) {
      currentSettings.areas[area] = { enabled: false, fontSize: 14, fontColor: 'rgba(255,255,255,0.92)' }
    }
    renderPresets()
    renderGlobalControls()
    renderAreaSettings()
    applyFontSettings()
    showToast('已恢复默认（需点击保存）')
  }
}

// Load settings on startup and apply
;(async function() {
  await loadSettingsData()
  applyFontSettings()
})()
