<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import VueOfficeDocx from '@vue-office/docx'
import '@vue-office/docx/lib/index.css'
import VueOfficeExcel from '@vue-office/excel'
import '@vue-office/excel/lib/index.css'
import VueOfficePdf from '@vue-office/pdf'
import VueOfficePptx from '@vue-office/pptx'

const props = defineProps({
  fileUrl:  { type: String, required: true },
  fileName: { type: String, default: '' },
  fileType: { type: String, default: '' },
})

// ── document type ──
const docType = computed(() => {
  const t = props.fileType || ''
  if (t.includes('pdf'))                                              return 'pdf'
  if (t.includes('wordprocessingml') || t.endsWith('.docx'))          return 'docx'
  if (t.includes('spreadsheetml') || t.endsWith('.xlsx'))             return 'xlsx'
  if (t === 'application/vnd.ms-excel' || t.endsWith('.xls'))         return 'xls'
  if (t.includes('presentationml') || t.endsWith('.pptx'))            return 'pptx'
  return 'unknown'
})

const isPDF   = computed(() => docType.value === 'pdf')
const isExcel = computed(() => docType.value === 'xlsx' || docType.value === 'xls')

// ── state ──
const loading = ref(true)
const error   = ref('')
const scale   = ref(1)
const currentPage = ref(1)
const totalPages  = ref(0)
const excelOptions = { minColLength: 20, xls: false, minRowLength: 0, showContextmenu: false }

// Component refs
const pdfRef       = ref(null)
const docxRef      = ref(null)
const excelRef     = ref(null)
const pptxRef      = ref(null)
const contentRef   = ref(null)

// ── PDF: get internal scroll container ──
function getPDFContainer() {
  if (!pdfRef.value) return null
  const el = pdfRef.value.$el
  if (el?.classList?.contains('vue-office-pdf')) return el
  return el?.querySelector?.('.vue-office-pdf') || null
}

// ── Non-PDF: find each component's actual scroll container ──
function getNonPdfScrollContainer() {
  const content = contentRef.value
  if (!content) return null
  if (docType.value === 'docx') {
    return content.querySelector('.vue-office-docx')
  }
  if (isExcel.value) {
    return content.querySelector('.vue-office-excel')
  }
  if (docType.value === 'pptx') {
    return content.querySelector('.pptx-preview-wrapper')
  }
  return null
}

function getScrollTarget() {
  if (isPDF.value) return getPDFContainer()
  return getNonPdfScrollContainer()
}

// ── PDF: page tracking via scroll ──
let pdfScrollHandler = null
function setupPDFScrollTracking() {
  const container = getPDFContainer()
  if (!container) return
  pdfScrollHandler = () => {
    const pages = container.querySelectorAll('canvas, img, [data-page-number]')
    if (!pages.length) return
    const containerRect = container.getBoundingClientRect()
    const containerCenter = containerRect.top + containerRect.height / 2
    let bestPage = 1
    let bestDist = Infinity
    pages.forEach((el, i) => {
      const rect = el.getBoundingClientRect()
      const elCenter = rect.top + rect.height / 2
      const dist = Math.abs(elCenter - containerCenter)
      if (dist < bestDist) { bestDist = dist; bestPage = i + 1 }
    })
    currentPage.value = bestPage
  }
  container.addEventListener('scroll', pdfScrollHandler, { passive: true })
}

function cleanupPDFScrollTracking() {
  const container = getPDFContainer()
  if (container && pdfScrollHandler) {
    container.removeEventListener('scroll', pdfScrollHandler)
    pdfScrollHandler = null
  }
}

// ── rendered / error handlers ──
function onRendered() {
  loading.value = false
  error.value = ''
  nextTick(() => {
    // Reset any leftover CSS transform from previous document
    const content = contentRef.value
    if (!content) return
    const main = content.querySelector('.vue-office-docx-main, .vue-office-excel-main, .vue-office-pptx-main')
    if (main) {
      main.style.transform = ''
      main.style.transformOrigin = ''
    }
    // Excel: x-spreadsheet measures container size at init, which may be wrong
    // if the window open animation hadn't finished yet. Dispatch resize so it
    // recalculates, and repeat after the animation (400ms) settles.
    if (isExcel.value) {
      window.dispatchEvent(new Event('resize'))
      setTimeout(() => window.dispatchEvent(new Event('resize')), 500)
    }
  })
  if (isPDF.value) {
    nextTick(() => {
      if (pdfRef.value?.numPages != null) {
        totalPages.value = typeof pdfRef.value.numPages === 'object'
          ? pdfRef.value.numPages.value
          : pdfRef.value.numPages
      }
      setupPDFScrollTracking()
    })
  }
}

function onError(e) {
  loading.value = false
  error.value = '加载文件失败：' + (e?.message || '未知错误')
  console.error('OfficeViewer error:', e)
}

// ── zoom ──
function zoomIn()  { applyScale(Math.min(scale.value + 0.2, 3)) }
function zoomOut() { applyScale(Math.max(scale.value - 0.2, 0.3)) }
function resetZoom() { applyScale(1) }

function applyScale(newScale) {
  scale.value = newScale
  if (isPDF.value && pdfRef.value?.setScale) {
    pdfRef.value.setScale(newScale)
    return
  }
  // Non-PDF: apply CSS transform to the -main inner element
  nextTick(() => {
    const content = contentRef.value
    if (!content) return
    const main = content.querySelector('.vue-office-docx-main, .vue-office-excel-main, .vue-office-pptx-main')
    if (main) {
      main.style.transform = `scale(${newScale})`
      main.style.transformOrigin = 'top left'
    }
  })
}

// ── scroll directions ──
// Excel uses hidden scrollbar divs (.x-spreadsheet-scrollbar) that drive canvas re-render.
// Setting scrollTop/scrollLeft on those divs triggers the scroll.
// Docx and PPTX use standard overflow containers.
function scrollUp()    { scrollBy(-200, 0) }
function scrollDown()  { scrollBy(200, 0) }
function scrollLeft()  { scrollBy(0, -200) }
function scrollRight() { scrollBy(0, 200) }

function scrollBy(dy, dx) {
  if (isExcel.value) {
    const content = contentRef.value
    if (!content) return
    const vert = content.querySelector('.x-spreadsheet-scrollbar.vertical')
    const horz = content.querySelector('.x-spreadsheet-scrollbar.horizontal')
    if (vert && dy) vert.scrollTop = Math.max(0, vert.scrollTop + dy)
    if (horz && dx) horz.scrollLeft = Math.max(0, horz.scrollLeft + dx)
    return
  }
  // PDF, DOCX, PPTX — standard DOM scroll containers
  const target = getScrollTarget()
  if (target) target.scrollBy({ top: dy, left: dx, behavior: 'smooth' })
}

// ── PDF page navigation ──
function prevPage() { if (currentPage.value > 1) goToPage(currentPage.value - 1) }
function nextPage() { if (currentPage.value < totalPages.value) goToPage(currentPage.value + 1) }

function goToPage(num) {
  const page = parseInt(num)
  if (isNaN(page) || page < 1 || page > totalPages.value) return
  currentPage.value = page
  const container = getPDFContainer()
  if (!container) return
  const wrapper = container.querySelector('.vue-office-pdf-wrapper')
  if (!wrapper) return
  const children = wrapper.children
  if (page - 1 < children.length) {
    container.scrollTo({ top: children[page - 1].offsetTop, behavior: 'smooth' })
  }
}

// ── cleanup ──
onUnmounted(() => { cleanupPDFScrollTracking() })

watch(() => props.fileUrl, () => {
  loading.value = true
  error.value = ''
  currentPage.value = 1
  totalPages.value = 0
  scale.value = 1
  cleanupPDFScrollTracking()
  // Reset CSS transform
  nextTick(() => {
    const content = contentRef.value
    if (!content) return
    const main = content.querySelector('.vue-office-docx-main, .vue-office-excel-main, .vue-office-pptx-main')
    if (main) {
      main.style.transform = ''
      main.style.transformOrigin = ''
    }
  })
})
</script>

<template>
  <div class="office-viewer">
    <!-- Toolbar -->
    <div class="ov-toolbar">
      <!-- PDF page navigation -->
      <div class="ov-toolbar-group" v-if="isPDF">
        <button class="ov-btn" :disabled="currentPage <= 1" @click="prevPage" title="上一页">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 4l-6 6 6 6"/>
          </svg>
        </button>
        <span class="ov-page-info">
          <input
            type="number"
            class="ov-page-input"
            :value="currentPage"
            @change="e => goToPage(e.target.value)"
            min="1"
            :max="totalPages"
          />
          <span class="ov-page-total">/ {{ totalPages }}</span>
        </span>
        <button class="ov-btn" :disabled="currentPage >= totalPages" @click="nextPage" title="下一页">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 4l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <!-- Scroll directions -->
      <div class="ov-toolbar-group">
        <button class="ov-btn" @click="scrollLeft" title="向左">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M13 4l-6 6 6 6"/>
          </svg>
        </button>
        <button class="ov-btn" @click="scrollUp" title="向上">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 13l6-6 6 6"/>
          </svg>
        </button>
        <button class="ov-btn" @click="scrollDown" title="向下">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 7l6 6 6-6"/>
          </svg>
        </button>
        <button class="ov-btn" @click="scrollRight" title="向右">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 4l6 6-6 6"/>
          </svg>
        </button>
      </div>

      <!-- Zoom -->
      <div class="ov-toolbar-group">
        <button class="ov-btn" @click="zoomOut" title="缩小">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="9" r="6"/>
            <path d="M14 14l4 4M6 9h6"/>
          </svg>
        </button>
        <button class="ov-btn ov-zoom-label" @click="resetZoom" title="重置缩放">
          {{ Math.round(scale * 100) }}%
        </button>
        <button class="ov-btn" @click="zoomIn" title="放大">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="9" r="6"/>
            <path d="M14 14l4 4M6 9h6M9 6v6"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="ov-content" ref="contentRef">
      <div v-show="loading" class="ov-loading">
        <div class="ov-spinner"></div>
        <span>加载中...</span>
      </div>
      <div v-show="error && !loading" class="ov-error">
        <span class="ov-error-icon">⚠️</span>
        <span>{{ error }}</span>
      </div>

      <!-- PDF -->
      <VueOfficePdf
        v-if="isPDF && !error"
        ref="pdfRef"
        :src="fileUrl"
        :defaultScale="scale"
        @rendered="onRendered"
        @error="onError"
        v-show="!loading"
      />

      <!-- DOCX -->
      <VueOfficeDocx
        v-else-if="docType === 'docx' && !error"
        ref="docxRef"
        :src="fileUrl"
        @rendered="onRendered"
        @error="onError"
        v-show="!loading"
      />

      <!-- Excel -->
      <VueOfficeExcel
        v-else-if="isExcel && !error"
        ref="excelRef"
        :src="fileUrl"
        :options="{ ...excelOptions, xls: docType === 'xls' }"
        @rendered="onRendered"
        @error="onError"
        v-show="!loading"
      />

      <!-- PPTX -->
      <VueOfficePptx
        v-else-if="docType === 'pptx' && !error"
        ref="pptxRef"
        :src="fileUrl"
        @rendered="onRendered"
        @error="onError"
        v-show="!loading"
      />

      <!-- Unknown type -->
      <div v-if="!loading && docType === 'unknown'" class="ov-error">
        <span class="ov-error-icon">⚠️</span>
        <span>不支持的文件类型</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.office-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

/* Toolbar */
.ov-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.ov-toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ov-btn {
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

.ov-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.ov-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ov-btn svg {
  width: 16px;
  height: 16px;
}

.ov-zoom-label {
  min-width: 48px;
  text-align: center;
}

.ov-page-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #8b949e;
}

.ov-page-input {
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

.ov-page-input:focus {
  border-color: #1a8fe3;
}

.ov-page-input::-webkit-inner-spin-button,
.ov-page-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Content */
.ov-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* vue-office child components fill the container and handle their own scrolling */
.ov-content > :deep(.vue-office-docx),
.ov-content > :deep(.vue-office-excel),
.ov-content > :deep(.vue-office-pptx),
.ov-content > :deep(.vue-office-pdf) {
  height: 100%;
}

/* Loading & Error */
.ov-loading,
.ov-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: #8b949e;
}

.ov-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: ov-spin 0.8s linear infinite;
}

@keyframes ov-spin {
  to { transform: rotate(360deg); }
}

.ov-error-icon {
  font-size: 32px;
}
</style>
