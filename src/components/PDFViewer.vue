<script setup>
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

const props = defineProps({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
})

const authToken = inject('authToken', null)

// pdf.js worker — Vite resolves this at build/dev time
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// ── state ──
const pdfDoc = shallowRef(null)
const currentPage = ref(1)
const totalPages = ref(0)
const loading = ref(true)
const error = ref('')

const userScale = ref(1)        // user zoom multiplier (1 = fit-to-width)
const baseFitScale = ref(1)     // auto-fit scale computed from first page
const finalScale = computed(() => userScale.value * baseFitScale.value)

const panX = ref(0)
const panY = ref(0)

const canvasContainer = ref(null)
const canvasEl = ref(null)

let renderTask = null
const dpr = window.devicePixelRatio || 1

// ── pan clamping ──
function clampPan() {
  if (!canvasContainer.value || !canvasEl.value) return
  const containerW = canvasContainer.value.clientWidth
  const containerH = canvasContainer.value.clientHeight
  const displayW = canvasEl.value.style.width ? parseFloat(canvasEl.value.style.width) : canvasEl.value.width / dpr
  const displayH = canvasEl.value.style.height ? parseFloat(canvasEl.value.style.height) : canvasEl.value.height / dpr
  const scaledW = displayW * userScale.value
  const scaledH = displayH * userScale.value

  if (scaledW <= containerW) panX.value = 0
  else {
    const maxPanX = (scaledW - containerW) / 2
    panX.value = Math.max(-maxPanX, Math.min(maxPanX, panX.value))
  }
  if (scaledH <= containerH) panY.value = 0
  else {
    const maxPanY = (scaledH - containerH) / 2
    panY.value = Math.max(-maxPanY, Math.min(maxPanY, panY.value))
  }
}

// ── zoom ──
function zoomIn() { userScale.value = Math.min(userScale.value + 0.25, 5); clampPan() }
function zoomOut() { userScale.value = Math.max(userScale.value - 0.25, 0.25); clampPan() }
function resetZoom() { userScale.value = 1; panX.value = 0; panY.value = 0 }

// ── pan ──
function panUp()    { panY.value += 60; clampPan() }
function panDown()  { panY.value -= 60; clampPan() }
function panLeft()  { panX.value += 60; clampPan() }
function panRight() { panX.value -= 60; clampPan() }

// ── page navigation ──
function goPrevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
    panX.value = 0; panY.value = 0
  }
}
function goNextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
    panX.value = 0; panY.value = 0
  }
}

// ── render page ──
async function renderPage() {
  if (!pdfDoc.value) return
  // cancel previous render
  if (renderTask) {
    try { renderTask.cancel() } catch {}
    renderTask = null
  }

  try {
    const page = await pdfDoc.value.getPage(currentPage.value)
    const viewport = page.getViewport({ scale: finalScale.value * dpr })

    const canvas = canvasEl.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width  = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`

    renderTask = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null })
    await renderTask.promise
    renderTask = null
    clampPan()
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') {
      console.error('PDF render error:', e)
    }
  }
}

// ── load document ──
async function loadPdf() {
  loading.value = true
  error.value = ''
  pdfDoc.value = null
  currentPage.value = 1
  totalPages.value = 0

  try {
    const loadingTask = pdfjsLib.getDocument(props.fileUrl)
    pdfDoc.value = await loadingTask.promise
    totalPages.value = pdfDoc.value.numPages

    // wait for canvasContainer to exist (v-show keeps it in DOM)
    await nextTick()
    await calculateBaseFitScale()
  } catch (e) {
    console.error('PDF load error:', e)
    error.value = '加载 PDF 失败'
  } finally {
    loading.value = false
  }
}

async function calculateBaseFitScale() {
  if (!pdfDoc.value || !canvasContainer.value) return
  const page = await pdfDoc.value.getPage(1)
  const viewport = page.getViewport({ scale: 1 }) // scale=1 gives unscaled dimensions
  const containerW = canvasContainer.value.clientWidth
  // fit to container width
  baseFitScale.value = containerW / viewport.width
}

// ── mouse drag for panning ──
let isDragging = false
let dragStartX = 0, dragStartY = 0
let dragStartPanX = 0, dragStartPanY = 0

function onMouseDown(e) {
  if (userScale.value <= 1) return
  isDragging = true
  dragStartX = e.clientX; dragStartY = e.clientY
  dragStartPanX = panX.value; dragStartPanY = panY.value
  e.preventDefault()
}
function onMouseMove(e) {
  if (!isDragging) return
  panX.value = dragStartPanX + (e.clientX - dragStartX)
  panY.value = dragStartPanY + (e.clientY - dragStartY)
}
function onMouseUp() {
  if (!isDragging) return
  isDragging = false
  clampPan()
}

// ── keyboard shortcuts ──
function handleKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); panLeft(); break
    case 'ArrowRight': e.preventDefault(); panRight(); break
    case 'ArrowUp':    e.preventDefault(); panUp(); break
    case 'ArrowDown':  e.preventDefault(); panDown(); break
    case '+': case '=': e.preventDefault(); zoomIn(); break
    case '-':           e.preventDefault(); zoomOut(); break
    case '0':           e.preventDefault(); resetZoom(); break
    case 'PageUp':      e.preventDefault(); goPrevPage(); break
    case 'PageDown':    e.preventDefault(); goNextPage(); break
  }
}

// ── watchers ──
watch([currentPage, finalScale], () => {
  nextTick(renderPage)
})

watch(() => props.fileUrl, () => {
  userScale.value = 1; panX.value = 0; panY.value = 0
  loadPdf()
})

// ── lifecycle ──
onMounted(async () => {
  await loadPdf()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)

  // recalculate baseFitScale when container resizes
  const resizeObserver = new ResizeObserver(() => {
    calculateBaseFitScale()
  })
  if (canvasContainer.value) resizeObserver.observe(canvasContainer.value)
  onUnmounted(() => {
    resizeObserver.disconnect()
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (renderTask) { try { renderTask.cancel() } catch {} }
  if (pdfDoc.value) { try { pdfDoc.value.destroy() } catch {} }
})
</script>

<template>
  <div class="pdf-viewer">
    <!-- Toolbar -->
    <div class="pv-toolbar">
      <!-- Page navigation -->
      <div class="pv-group">
        <button class="pv-btn" @click="goPrevPage" :disabled="currentPage <= 1" title="上一页 (PageUp)">◀</button>
        <span class="pv-page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button class="pv-btn" @click="goNextPage" :disabled="currentPage >= totalPages" title="下一页 (PageDown)">▶</button>
      </div>

      <!-- Zoom -->
      <div class="pv-group">
        <button class="pv-btn" @click="zoomOut" title="缩小 (−)">−</button>
        <span class="pv-zoom-info">{{ Math.round(userScale * 100) }}%</span>
        <button class="pv-btn" @click="zoomIn" title="放大 (+)">+</button>
        <button class="pv-btn" @click="resetZoom" title="重置缩放 (0)">⊙</button>
      </div>

      <!-- Pan -->
      <div class="pv-group">
        <button class="pv-btn" @click="panUp" title="上移 (↑)">↑</button>
        <button class="pv-btn" @click="panDown" title="下移 (↓)">↓</button>
        <button class="pv-btn" @click="panLeft" title="左移 (←)">←</button>
        <button class="pv-btn" @click="panRight" title="右移 (→)">→</button>
      </div>

      <div class="pv-spacer" />
      <span class="pv-name" :title="fileName">{{ fileName }}</span>
    </div>

    <!-- Content -->
    <div class="pv-content">
      <!-- Loading -->
      <div v-if="loading && !pdfDoc" class="pv-loading">
        <div class="pv-spinner"></div>
        <span>加载中...</span>
      </div>

      <!-- Error -->
      <div v-if="error && !pdfDoc" class="pv-error">
        <span class="pv-error-icon">⚠️</span>
        <span>{{ error }}</span>
      </div>

      <!-- PDF canvas — always in DOM so refs work -->
      <div ref="canvasContainer" class="pv-canvas-wrap" @mousedown="onMouseDown">
        <canvas
          ref="canvasEl"
          class="pv-canvas"
          :style="{ transform: `scale(${userScale}) translate(${panX}px, ${panY}px)`, transformOrigin: 'center center' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1117;
  color: #e6edf3;
}

/* Toolbar */
.pv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.pv-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid #30363d;
}

.pv-group:last-of-type {
  border-right: none;
}

.pv-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  min-width: 28px;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: #21262d;
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  user-select: none;
}

.pv-btn:hover:not(:disabled) {
  background: #30363d;
  border-color: #484f58;
}

.pv-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.pv-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pv-page-info,
.pv-zoom-info {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.pv-spacer { flex: 1; }

.pv-name {
  font-size: 12px;
  color: #8b949e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* Content */
.pv-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 12px;
}

.pv-loading,
.pv-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #8b949e;
  background: #0d1117;
  z-index: 10;
}

.pv-canvas-wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  cursor: default;
}

.pv-canvas-wrap:active {
  cursor: grabbing;
}

.pv-canvas {
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  transition: transform 0.08s ease-out;
}

.pv-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: pv-spin 0.8s linear infinite;
}

@keyframes pv-spin {
  to { transform: rotate(360deg); }
}

.pv-error-icon {
  font-size: 48px;
}
</style>