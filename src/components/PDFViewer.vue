<script setup>
import { ref, shallowRef, onMounted, watch, onUnmounted, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker&url'

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const props = defineProps({
  pdfUrl: { type: String, required: true }
})

const canvasRef = ref(null)
const pdfDoc = shallowRef(null)  // Use shallowRef to avoid Proxy issues with pdf.js
const currentPage = ref(1)
const totalPages = ref(0)
const userScale = ref(1)  // User's zoom level (1 = 100%)
const baseFitScale = ref(1)  // Auto-fit scale calculated from first page
const loading = ref(false)
const error = ref('')
const renderTask = ref(null)

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

    // Calculate base fit scale from first page (use default size first)
    const firstPage = await pdfDoc.value.getPage(1)
    const baseViewport = firstPage.getViewport({ scale: 1 })

    // Use default container width, will adjust on resize
    const containerWidth = 800

    // Calculate fit scale, cap at 1.5x to avoid huge pages
    baseFitScale.value = Math.min((containerWidth - 40) / baseViewport.width, 1.5)
    // Ensure minimum scale
    if (baseFitScale.value < 0.3) baseFitScale.value = 0.3

    // Wait for DOM to update
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
async function renderPage() {
  if (!pdfDoc.value || !canvasRef.value) return

  // Cancel any ongoing render task
  if (renderTask.value) {
    renderTask.value.cancel()
    renderTask.value = null
  }

  try {
    const page = await pdfDoc.value.getPage(currentPage.value)
    const canvas = canvasRef.value
    const ctx = canvas.getContext('2d')

    // Final scale = user zoom * base fit scale
    const finalScale = userScale.value * baseFitScale.value
    const scaledViewport = page.getViewport({ scale: finalScale })

    // Ensure valid dimensions
    if (scaledViewport.width < 1 || scaledViewport.height < 1 || isNaN(scaledViewport.width)) {
      console.warn('Invalid viewport dimensions', scaledViewport)
      return
    }

    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport
    }

    renderTask.value = page.render(renderContext)
    await renderTask.value.promise
    renderTask.value = null
  } catch (e) {
    if (e.name !== 'RenderingCancelledException') {
      console.error('PDF rendering error:', e)
      error.value = '渲染页面失败'
    }
  }
}

// Navigation
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

function zoomIn() {
  userScale.value = Math.min(userScale.value + 0.2, 3)
  renderPage()
}

function zoomOut() {
  userScale.value = Math.max(userScale.value - 0.2, 0.3)
  renderPage()
}

function resetZoom() {
  userScale.value = 1
  renderPage()
}

// Handle window resize
let resizeTimeout = null
function handleResize() {
  clearTimeout(resizeTimeout)
  resizeTimeout = setTimeout(() => {
    renderPage()
  }, 150)
}

onMounted(() => {
  loadPDF()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  clearTimeout(resizeTimeout)
  if (renderTask.value) {
    renderTask.value.cancel()
  }
})

watch(() => props.pdfUrl, () => {
  loadPDF()
})
</script>

<template>
  <div class="pdf-viewer">
    <!-- Toolbar -->
    <div class="pdf-toolbar">
      <div class="pdf-toolbar-group">
        <button
          class="pdf-btn"
          :disabled="currentPage <= 1"
          @click="prevPage"
          title="上一页"
        >
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
        <button
          class="pdf-btn"
          :disabled="currentPage >= totalPages"
          @click="nextPage"
          title="下一页"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 4l6 6-6 6"/>
          </svg>
        </button>
      </div>

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

      <div class="pdf-toolbar-group right">
        <!-- Download button removed - use CloudFiles instead -->
      </div>
    </div>

    <!-- Content -->
    <div class="pdf-content">
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
}

.pdf-toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pdf-toolbar-group.right {
  margin-left: auto;
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

.pdf-zoom-reset {
  min-width: 50px;
  font-variant-numeric: tabular-nums;
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
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px;
}

.pdf-canvas-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
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
