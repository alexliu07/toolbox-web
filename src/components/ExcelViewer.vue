<script setup>
import { ref, onMounted, onUnmounted, watch, inject } from 'vue'

const props = defineProps({
  fileUrl:  { type: String, required: true },
  fileName: { type: String, default: '' },
})

const authToken = inject('authToken', null)

const containerRef = ref(null)
const loading      = ref(false)
const error        = ref('')
const scale        = ref(1)

// ── load & render ──
async function render(url) {
  if (!containerRef.value) return
  loading.value = true
  error.value   = ''
  try {
    const headers = {}
    const token = authToken?.value
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()

    const XLSX = await import('xlsx')
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })

    containerRef.value.innerHTML = ''

    workbook.SheetNames.forEach((sheetName, idx) => {
      const sheet = workbook.Sheets[sheetName]

      // sheet tab label
      const label = document.createElement('div')
      label.className = 'ev-sheet-label'
      label.textContent = sheetName
      containerRef.value.appendChild(label)

      // render to HTML table
      const html = XLSX.utils.sheet_to_html(sheet, { editable: false })
      const wrapper = document.createElement('div')
      wrapper.className = 'ev-sheet-wrapper'
      wrapper.innerHTML = html
      containerRef.value.appendChild(wrapper)
    })

    applyScale(scale.value)
  } catch (e) {
    error.value = '加载失败：' + (e?.message || '未知错误')
  } finally {
    loading.value = false
  }
}

// ── zoom ──
function applyScale(s) {
  if (!containerRef.value) return
  containerRef.value.style.transform = `scale(${s})`
  containerRef.value.style.transformOrigin = 'top left'

  let settled = false
  const update = () => {
    if (settled) return
    settled = true
    const content = containerRef.value?.closest('.ev-content')
    if (content) {
      const contentW = content.clientWidth
      const innerW = containerRef.value.scrollWidth * s
      const offset = Math.max(0, (contentW - innerW) / 2)
      containerRef.value.style.marginLeft = offset + 'px'
    }
    containerRef.value?.removeEventListener('transitionend', update)
  }
  containerRef.value.addEventListener('transitionend', update)
  requestAnimationFrame(() => requestAnimationFrame(update))
}

function zoomIn()    { scale.value = Math.min(+(scale.value + 0.2).toFixed(1), 3); applyScale(scale.value) }
function zoomOut()   { scale.value = Math.max(+(scale.value - 0.2).toFixed(1), 0.3); applyScale(scale.value) }
function resetZoom() { scale.value = 1; applyScale(1) }

// ── scroll ──
function getScroll() { return containerRef.value?.closest('.ev-content') || null }
function scrollUp()    { getScroll()?.scrollBy({ top: -200, behavior: 'smooth' }) }
function scrollDown()  { getScroll()?.scrollBy({ top:  200, behavior: 'smooth' }) }
function scrollLeft()  { getScroll()?.scrollBy({ left: -200, behavior: 'smooth' }) }
function scrollRight() { getScroll()?.scrollBy({ left:  200, behavior: 'smooth' }) }

// ── keyboard ──
function handleKey(e) {
  if (e.target.tagName === 'INPUT') return
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn() }
  else if (e.key === '-') { e.preventDefault(); zoomOut() }
  else if (e.key === '0') { e.preventDefault(); resetZoom() }
  else if (e.key === 'ArrowUp')    { e.preventDefault(); scrollUp() }
  else if (e.key === 'ArrowDown')  { e.preventDefault(); scrollDown() }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollLeft() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scrollRight() }
}

function handleResize() { applyScale(scale.value) }

onMounted(() => {
  render(props.fileUrl)
  window.addEventListener('keydown', handleKey)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey)
  window.removeEventListener('resize', handleResize)
})

watch(() => props.fileUrl, (url) => render(url))
</script>

<template>
  <div class="ev">
    <!-- Toolbar -->
    <div class="ev-toolbar">
      <!-- Scroll -->
      <div class="ev-group">
        <button class="ev-btn" @click="scrollLeft"  title="向左 (←)">←</button>
        <button class="ev-btn" @click="scrollUp"    title="向上 (↑)">↑</button>
        <button class="ev-btn" @click="scrollDown"  title="向下 (↓)">↓</button>
        <button class="ev-btn" @click="scrollRight" title="向右 (→)">→</button>
      </div>
      <div class="ev-sep"></div>
      <!-- Zoom -->
      <div class="ev-group">
        <button class="ev-btn" @click="zoomOut"  title="缩小 (-)">−</button>
        <button class="ev-btn ev-zoom-lbl" @click="resetZoom" title="重置缩放 (0)">{{ Math.round(scale * 100) }}%</button>
        <button class="ev-btn" @click="zoomIn"   title="放大 (+)">+</button>
      </div>
    </div>

    <!-- Content -->
    <div class="ev-content">
      <div v-if="loading" class="ev-state">
        <div class="ev-spinner"></div>
        <span>加载中...</span>
      </div>
      <div v-else-if="error" class="ev-state ev-error">
        <span style="font-size:32px">⚠</span>
        <span>{{ error }}</span>
      </div>
      <div
        ref="containerRef"
        class="ev-body"
        :style="{ visibility: loading || error ? 'hidden' : 'visible' }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.ev {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

.ev-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(0,0,0,0.3);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.ev-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ev-sep {
  width: 1px;
  height: 20px;
  background: rgba(255,255,255,0.12);
  margin: 0 4px;
}

.ev-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  background: rgba(255,255,255,0.05);
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
  user-select: none;
}

.ev-btn:hover { background: rgba(255,255,255,0.12); }
.ev-btn:active { transform: scale(0.95); }

.ev-zoom-lbl {
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}

/* Content */
.ev-content {
  flex: 1;
  overflow: auto;
  position: relative;
  background: #1e2330;
}

.ev-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #8b949e;
  background: #1a1d2e;
}

.ev-error { color: #f85149; }

.ev-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: ev-spin 0.8s linear infinite;
}

@keyframes ev-spin { to { transform: rotate(360deg); } }

.ev-body {
  padding: 16px;
  min-width: max-content;
  transition: transform 0.2s ease, margin-left 0.2s ease;
  transform-origin: top left;
}

/* Sheet label */
.ev-body :deep(.ev-sheet-label) {
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 12px 4px 6px;
}

.ev-body :deep(.ev-sheet-label:first-child) {
  padding-top: 4px;
}

/* Table */
.ev-body :deep(.ev-sheet-wrapper) {
  margin-bottom: 24px;
  overflow-x: auto;
}

.ev-body :deep(table) {
  border-collapse: collapse;
  font-size: 13px;
  color: #e6edf3;
  background: #161b22;
  white-space: nowrap;
}

.ev-body :deep(td),
.ev-body :deep(th) {
  border: 1px solid #30363d;
  padding: 5px 10px;
  min-width: 60px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ev-body :deep(tr:first-child td),
.ev-body :deep(th) {
  background: #21262d;
  font-weight: 600;
  color: #e6edf3;
  position: sticky;
  top: 0;
  z-index: 1;
}

.ev-body :deep(tr:hover td) {
  background: #1c2128;
}
</style>
