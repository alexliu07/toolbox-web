<script setup>
import { ref, shallowRef, onMounted, watch, onUnmounted, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from '../pdf-worker-wrapper.js?worker&url'

// Configure pdf.js worker (wrapper includes polyfills for older WebViews)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps({
  pdfUrl: { type: String, required: true }
})

const canvasRef = ref(null)
const contentRef = ref(null)
const pdfDoc = shallowRef(null)
const currentPage = ref(1)
const totalPages = ref(0)
const userScale = ref(1)
const baseFitScale = ref(1)
const loading = ref(false)
const error = ref('')
const renderTask = shallowRef(null)

// Load PDF
async function loadPDF() {
  if (!props.pdfUrl) return

  loading.value = true
  error.value = ''

  try {
    const loadingTask = pdfjsLib.getDocument(props.pdfUrl)
    pdfDoc.value = await loadingTask.promise
    totalPages.value = pdfDoc.value.numPages
    currentPage.value = 1
    userScale.value = 1

    const firstPage = await pdfDoc.value.getPage(1)
    const baseViewport = firstPage.getViewport({ scale: 1 })
    const containerWidth = 800
    baseFitScale.value = Math.min((containerWidth - 40) / baseViewport.width, 1.5)
    if (baseFitScale.value < 0.3) baseFitScale.value = 0.3

    await nextTick()
    await renderPage()
  } catch (e) {
    error.value = '无法加载PDF文件：' + (e.message || '未知错误')
    console.error('PDF loading error:', e)
  } finally {
    loading.value = false
  }
}

// Render current page
// preserveScroll: true = keep proportional scroll position (zoom), false = reset to top (page change)
async function renderPage(preserveScroll = false) {
  if (!pdfDoc.value || !canvasRef.value) return

  if (renderTask.value) {
    renderTask.value.cancel()
    renderTask.value = null
  }

  // Snapshot scroll ratio before resize
  let scrollRatioX = 0, scrollRatioY = 0
  if (preserveScroll && contentRef.value) {
    const el = contentRef.value
    scrollRatioX = el.scrollWidth  > el.clientWidth  ? el.scrollLeft / (el.scrollWidth  - el.clientWidth)  : 0
    scrollRatioY = el.scrollHeight > el.clientHeight ? el.scrollTop  / (el.scrollHeight - el.clientHeight) : 0
  }

  try {
    const page = await pdfDoc.value.getPage(currentPage.value)
    const canvas = canvasRef.value
    const ctx = canvas.getContext('2d')

    const finalScale = userScale.value * baseFitScale.value
    const scaledViewport = page.getViewport({ scale: finalScale })

    if (scaledViewport.width < 1 || scaledViewport.height < 1 || isNaN(scaledViewport.width)) {
      console.warn('Invalid viewport dimensions', scaledViewport)
      return
    }

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(scaledViewport.width * dpr)
    canvas.height = Math.floor(scaledViewport.height * dpr)
    canvas.style.width = Math.floor(scaledViewport.width) + 'px'
    canvas.style.height = Math.floor(scaledViewport.height) + 'px'

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }

    renderTask.value = page.render(renderContext)
    await renderTask.value.promise
    renderTask.value = null

    if (contentRef.value) {
      if (preserveScroll) {
        // Restore proportional scroll position after zoom
        await nextTick()
        const el = contentRef.value
        el.scrollLeft = scrollRatioX * (el.scrollWidth  - el.clientWidth)
        el.scrollTop  = scrollRatioY * (el.scrollHeight - el.clientHeight)
      } else {
        contentRef.value.scrollTop = 0
      }
    }
  } catch (e) {
    if (e.name !== 'RenderingCancelledException') {
      console.error('PDF rendering error:', e)
      error.value = '渲染页面失败'
    }
  }
}

// Page navigation
function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
    renderPage()
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
    renderPage()
  }
}

function goToPage(e) {
  const page = parseInt(e.target.value)
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
    renderPage()
  }
}

// Scroll up/down buttons
function scrollUp() {
  if (!contentRef.value) return
  contentRef.value.scrollBy({ top: -contentRef.value.clientHeight * 0.8, behavior: 'smooth' })
}

function scrollDown() {
  if (!contentRef.value) return
  contentRef.value.scrollBy({ top: contentRef.value.clientHeight * 0.8, behavior: 'smooth' })
}

function scrollLeft() {
  if (!contentRef.value) return
  contentRef.value.scrollBy({ left: -contentRef.value.clientWidth * 0.8, behavior: 'smooth' })
}

function scrollRight() {
  if (!contentRef.value) return
  contentRef.value.scrollBy({ left: contentRef.value.clientWidth * 0.8, behavior: 'smooth' })
}

// Zoom
function zoomIn() {
  userScale.value = Math.min(userScale.value + 0.2, 3)
  renderPage(true)
}

function zoomOut() {
  userScale.value = Math.max(userScale.value - 0.2, 0.3)
  renderPage(true)
}

function resetZoom() {
  userScale.value = 1
  renderPage(true)
}

// Handle window resize
let resizeTimeout = null
function handleResize() {
  clearTimeout(resizeTimeout)
  resizeTimeout = setTimeout(() => { renderPage() }, 150)
}

onMounted(() => {
  loadPDF()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  clearTimeout(resizeTimeout)
  if (renderTask.value) renderTask.value.cancel()
})

watch(() => props.pdfUrl, () => { loadPDF() })
</script>

<template>
  <div class="pdf-viewer">
    <!-- Toolbar -->
    <div class="pdf-toolbar">
      <!-- Page navigation -->
      <div class="pdf-toolbar-group">
        <button class="pdf-btn" :disabled="currentPage <= 1" @click="prevPage" title="上一页">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 4l-6 6 6 6"/>
          </svg>
        </button>
        <span class="pdf-page-info">
          <input
            type="number"
            class="pdf-page-input"
            :value="currentPage"
            @change="goToPage"
            min="1"
            :max="totalPages"
          />
          <span class="pdf-page-total">/ {{ totalPages }}</span>
        </span>
        <button class="pdf-btn" :disabled="currentPage >= totalPages" @click="nextPage" title="下一页">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 4l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <!-- Scroll up/down/left/right -->
      <div class="pdf-toolbar-group">
        <button class="pdf-btn" @click="scrollLeft" title="向左滚动">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M13 4l-6 6 6 6"/>
          </svg>
        </button>
        <button class="pdf-btn" @click="scrollUp" title="向上滚动">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 13l6-6 6 6"/>
          </svg>
        </button>
        <button class="pdf-btn" @click="scrollDown" title="向下滚动">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 7l6 6 6-6"/>
          </svg>
        </button>
        <button class="pdf-btn" @click="scrollRight" title="向右滚动">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 4l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <!-- Zoom -->
      <div class="pdf-toolbar-group">
        <button class="pdf-btn" @click="zoomOut" title="缩小">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="9" r="6"/>
            <path d="M14 14l4 4M6 9h6"/>
          </svg>
        </button>
        <button class="pdf-btn zoom-reset" @click="resetZoom" title="重置缩放">
          {{ Math.round(userScale * 100) }}%
        </button>
        <button class="pdf-btn" @click="zoomIn" title="放大">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="9" r="6"/>
            <path d="M14 14l4 4M6 9h6M9 6v6"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="pdf-content" ref="contentRef">
      <div v-show="loading" class="pdf-loading">
        <div class="pdf-spinner"></div>
        <span>加载PDF中...</span>
      </div>
      <div v-show="error && !loading" class="pdf-error">
        <span class="pdf-error-icon">⚠️</span>
        <span>{{ error }}</span>
      </div>
      <div v-show="!loading && !error" class="pdf-canvas-wrapper">
        <canvas ref="canvasRef" class="pdf-canvas" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

/* Toolbar */
.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pdf-toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pdf-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.pdf-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.pdf-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pdf-btn svg {
  width: 16px;
  height: 16px;
}

.pdf-page-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #8b949e;
}

.pdf-page-input {
  width: 50px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  color: #e6edf3;
  font-size: 13px;
  text-align: center;
  outline: none;
}

.pdf-page-input:focus {
  border-color: #1a8fe3;
}

.pdf-page-input::-webkit-inner-spin-button,
.pdf-page-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Content */
.pdf-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.pdf-canvas-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  width: fit-content;
  margin: 0 auto;
}

.pdf-canvas {
  display: block;
  background: white;
}

/* Loading & Error */
.pdf-loading,
.pdf-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8b949e;
}

.pdf-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.pdf-error-icon {
  font-size: 32px;
}
</style>
