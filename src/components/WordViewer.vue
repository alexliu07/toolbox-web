<script setup>
import { ref, onMounted, onUnmounted, watch, inject } from 'vue'

const props = defineProps({
  fileUrl:  { type: String, required: true },
  fileName: { type: String, default: '' },
})

const authToken = inject('authToken', null)

const containerRef = ref(null)  // docx-preview body container
const styleRef     = ref(null)  // docx-preview style container
const loading      = ref(false)
const error        = ref('')
const scale        = ref(1)
const pageCount    = ref(0)
const currentPage  = ref(1)

// ── load & render ──
async function render(url) {
  if (!containerRef.value) return
  loading.value = true
  error.value   = ''
  pageCount.value = 0
  currentPage.value = 1
  try {
    const headers = {}
    const token = authToken?.value
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()

    const { renderAsync } = await import('docx-preview')
    containerRef.value.innerHTML = ''
    await renderAsync(blob, containerRef.value, styleRef.value, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    })
    applyScale(scale.value)
    countPages()
    setupScrollTracking()
  } catch (e) {
    error.value = '加载失败：' + (e?.message || '未知错误')
  } finally {
    loading.value = false
  }
}

// ── page tracking via IntersectionObserver ──
let observer = null
function setupScrollTracking() {
  if (observer) { observer.disconnect(); observer = null }
  if (!containerRef.value) return
  const pages = containerRef.value.querySelectorAll('.docx-wrapper > section, .docx > section')
  if (!pages.length) return
  observer = new IntersectionObserver((entries) => {
    let best = null
    let bestRatio = 0
    entries.forEach(e => {
      if (e.intersectionRatio > bestRatio) {
        bestRatio = e.intersectionRatio
        best = e.target
      }
    })
    if (best) {
      const idx = Array.from(pages).indexOf(best)
      if (idx >= 0) currentPage.value = idx + 1
    }
  }, { root: containerRef.value.closest('.wv-content'), threshold: [0.1, 0.5, 0.9] })
  pages.forEach(p => observer.observe(p))
}

function countPages() {
  if (!containerRef.value) return
  const pages = containerRef.value.querySelectorAll('.docx-wrapper > section, .docx > section')
  pageCount.value = pages.length || 0
}

// ── zoom ──
function applyScale(s) {
  if (!containerRef.value) return
  const wrapper = containerRef.value.querySelector('.docx-wrapper')
  if (!wrapper) return
  wrapper.style.transform = `scale(${s})`
  wrapper.style.transformOrigin = 'top left'
  // Update marginLeft after transition ends to avoid reading mid-animation layout
  let settled = false
  const update = () => {
    if (settled) return
    settled = true
    const content = containerRef.value?.closest('.wv-content')
    if (content) {
      const contentW = content.clientWidth
      const wrapperW = wrapper.scrollWidth * s
      const offset = Math.max(0, (contentW - wrapperW) / 2)
      wrapper.style.marginLeft = offset + 'px'
    }
    wrapper.removeEventListener('transitionend', update)
  }
  wrapper.addEventListener('transitionend', update)
  // Fallback: if no transition fires (e.g. initial render), update immediately after paint
  requestAnimationFrame(() => requestAnimationFrame(update))
}

function zoomIn()    { scale.value = Math.min(+(scale.value + 0.2).toFixed(1), 3); applyScale(scale.value) }
function zoomOut()   { scale.value = Math.max(+(scale.value - 0.2).toFixed(1), 0.3); applyScale(scale.value) }
function resetZoom() { scale.value = 1; applyScale(1) }

// ── scroll ──
function getScroll() {
  return containerRef.value?.closest('.wv-content') || null
}
function scrollUp()    { getScroll()?.scrollBy({ top: -200, behavior: 'smooth' }) }
function scrollDown()  { getScroll()?.scrollBy({ top:  200, behavior: 'smooth' }) }
function scrollLeft()  { getScroll()?.scrollBy({ left: -200, behavior: 'smooth' }) }
function scrollRight() { getScroll()?.scrollBy({ left:  200, behavior: 'smooth' }) }

// ── page navigation ──
function prevPage() { if (currentPage.value > 1) goToPage(currentPage.value - 1) }
function nextPage() { if (currentPage.value < pageCount.value) goToPage(currentPage.value + 1) }

function goToPage(n) {
  const num = parseInt(n)
  if (isNaN(num) || num < 1 || num > pageCount.value) return
  currentPage.value = num
  const pages = containerRef.value?.querySelectorAll('.docx-wrapper > section, .docx > section')
  if (!pages || !pages[num - 1]) return
  pages[num - 1].scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── keyboard ──
function handleKey(e) {
  if (e.target.tagName === 'INPUT') return
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn() }
  else if (e.key === '-') { e.preventDefault(); zoomOut() }
  else if (e.key === '0') { e.preventDefault(); resetZoom() }
  else if (e.key === 'ArrowUp'    && !e.shiftKey) { e.preventDefault(); scrollUp() }
  else if (e.key === 'ArrowDown'  && !e.shiftKey) { e.preventDefault(); scrollDown() }
  else if (e.key === 'ArrowLeft'  && !e.shiftKey) { e.preventDefault(); scrollLeft() }
  else if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); scrollRight() }
  else if (e.key === 'ArrowLeft'  && e.shiftKey)  { e.preventDefault(); prevPage() }
  else if (e.key === 'ArrowRight' && e.shiftKey)  { e.preventDefault(); nextPage() }
}

function handleResize() { applyScale(scale.value) }

onMounted(() => {
  render(props.fileUrl)
  window.addEventListener('keydown', handleKey)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', handleKey)
  window.removeEventListener('resize', handleResize)
})

watch(() => props.fileUrl, (url) => {
  observer?.disconnect()
  observer = null
  render(url)
})
</script>

<template>
  <div class="wv">
    <!-- Toolbar -->
    <div class="wv-toolbar">
      <!-- Scroll -->
      <div class="wv-group">
        <button class="wv-btn" @click="scrollLeft"  title="向左 (←)">←</button>
        <button class="wv-btn" @click="scrollUp"    title="向上 (↑)">↑</button>
        <button class="wv-btn" @click="scrollDown"  title="向下 (↓)">↓</button>
        <button class="wv-btn" @click="scrollRight" title="向右 (→)">→</button>
      </div>
      <div class="wv-sep"></div>

      <!-- Zoom -->
      <div class="wv-group">
        <button class="wv-btn" @click="zoomOut"   title="缩小 (-)">−</button>
        <button class="wv-btn wv-zoom-lbl" @click="resetZoom" title="重置缩放 (0)">{{ Math.round(scale * 100) }}%</button>
        <button class="wv-btn" @click="zoomIn"    title="放大 (+)">+</button>
      </div>
    </div>

    <!-- Content -->
    <div class="wv-content">
      <div v-if="loading" class="wv-state">
        <div class="wv-spinner"></div>
        <span>加载中...</span>
      </div>
      <div v-else-if="error" class="wv-state wv-error">
        <span style="font-size:32px">⚠</span>
        <span>{{ error }}</span>
      </div>
      <!-- style injected here by docx-preview -->
      <div ref="styleRef"></div>
      <!-- body rendered here -->
      <div ref="containerRef" class="wv-body" :style="{ visibility: loading || error ? 'hidden' : 'visible' }"></div>
    </div>
  </div>
</template>

<style scoped>
.wv {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

/* Toolbar */
.wv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(0,0,0,0.3);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.wv-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wv-sep {
  width: 1px;
  height: 20px;
  background: rgba(255,255,255,0.12);
  margin: 0 4px;
}

.wv-btn {
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

.wv-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.wv-btn:active:not(:disabled) { transform: scale(0.95); }
.wv-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.wv-zoom-lbl {
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}

/* Content */
.wv-content {
  flex: 1;
  overflow: auto;
  position: relative;
  background: #525659;
}

.wv-state {
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

.wv-error { color: #f85149; }

.wv-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: wv-spin 0.8s linear infinite;
}

@keyframes wv-spin { to { transform: rotate(360deg); } }

.wv-body { min-height: 100%; }

/* docx-preview wrapper tweaks */
.wv-body :deep(.docx-wrapper) {
  background: #525659;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transform-origin: top left;
  transition: transform 0.2s ease, margin-left 0.2s ease;
}

.wv-body :deep(.docx-wrapper > section) {
  background: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,0.4);
  margin: 0;
}
</style>
