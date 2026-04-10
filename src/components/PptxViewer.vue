<script setup>
import { ref, onMounted, onUnmounted, watch, inject, nextTick } from 'vue'

const props = defineProps({
  fileUrl:  { type: String, required: true },
  fileName: { type: String, default: '' },
})

const authToken = inject('authToken', null)

const slideContainer = ref(null)
const slideWrapper = ref(null)
const thumbnailBar = ref(null)
const loading = ref(true)
const error = ref('')
const currentSlide = ref(0)
const totalSlides = ref(0)
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)

let presentation = null
let lib = null  // cached module

// ── load & render ──
async function loadPptx(url) {
  loading.value = true
  error.value = ''
  currentSlide.value = 0
  totalSlides.value = 0
  scale.value = 1
  panX.value = 0
  panY.value = 0

  try {
    // fetch file
    const headers = {}
    const token = authToken?.value
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()

    // import library lazily
    if (!lib) {
      lib = await import('pptx-viewer')
    }

    // cleanup previous
    if (presentation?.cleanup) presentation.cleanup()

    presentation = await lib.loadPresentation(buffer)
    totalSlides.value = presentation.slides.length

    // Must render AFTER loading=false so v-show makes container visible
    // and getBoundingClientRect() returns real dimensions
    loading.value = false
    await nextTick()
    await nextTick()

    renderSlide(0)
    renderThumbnails()
  } catch (e) {
    error.value = '加载失败：' + (e?.message || '未知错误')
    loading.value = false
  }
}

function renderSlide(index) {
  if (!presentation || !slideContainer.value) return
  if (index < 0 || index >= presentation.slides.length) return
  currentSlide.value = index
  panX.value = 0
  panY.value = 0

  // Get the wrapper's real size to pass to renderSlideToElement
  const wrapperRect = slideWrapper.value?.getBoundingClientRect()
  const targetW = wrapperRect?.width || 800
  const targetH = wrapperRect?.height || 600

  // Determine slide aspect ratio and fit within wrapper
  const slideW = presentation.slideSize.width
  const slideH = presentation.slideSize.height
  const slideAspect = slideW / slideH
  const wrapperAspect = targetW / targetH

  let renderW, renderH
  if (wrapperAspect > slideAspect) {
    // wrapper is wider — fit height
    renderH = targetH - 20  // small padding
    renderW = renderH * slideAspect
  } else {
    // wrapper is taller — fit width
    renderW = targetW - 20
    renderH = renderW / slideAspect
  }

  // clear and render with explicit size
  slideContainer.value.innerHTML = ''
  lib.renderSlideToElement(presentation, index, slideContainer.value, {
    width: renderW,
    height: renderH,
  })

  // update active thumbnail highlight
  nextTick(() => {
    const thumbs = thumbnailBar.value?.querySelectorAll('.pv-thumb')
    if (thumbs) {
      thumbs.forEach((el, i) => {
        el.classList.toggle('pv-thumb-active', i === index)
      })
    }
    const active = thumbnailBar.value?.querySelector('.pv-thumb-active')
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  })
}

function renderThumbnails() {
  if (!presentation || !thumbnailBar.value) return
  thumbnailBar.value.innerHTML = ''
  const thumbs = lib.getThumbnails(presentation, 120)
  thumbs.forEach((svg, i) => {
    const wrap = document.createElement('div')
    wrap.className = 'pv-thumb' + (i === currentSlide.value ? ' pv-thumb-active' : '')
    wrap.appendChild(svg)
    wrap.addEventListener('click', () => renderSlide(i))
    thumbnailBar.value.appendChild(wrap)
  })
}

// ── navigation ──
function prevSlide() { if (currentSlide.value > 0) renderSlide(currentSlide.value - 1) }
function nextSlide() { if (currentSlide.value < totalSlides.value - 1) renderSlide(currentSlide.value + 1) }
function firstSlide() { renderSlide(0) }
function lastSlide() { renderSlide(totalSlides.value - 1) }

// ── zoom ──
function zoomIn()  { scale.value = Math.min(+(scale.value + 0.2).toFixed(1), 5) }
function zoomOut() { scale.value = Math.max(+(scale.value - 0.2).toFixed(1), 0.2) }
function resetZoom() { scale.value = 1; panX.value = 0; panY.value = 0 }

// ── pan ──
function panUp()    { panY.value += 60 }
function panDown()  { panY.value -= 60 }
function panLeft()  { panX.value += 60 }
function panRight() { panX.value -= 60 }

// ── keyboard ──
function handleKey(e) {
  if (e.target.tagName === 'INPUT') return
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); e.shiftKey ? prevSlide() : panLeft(); break
    case 'ArrowRight': e.preventDefault(); e.shiftKey ? nextSlide() : panRight(); break
    case 'ArrowUp':    e.preventDefault(); panUp(); break
    case 'ArrowDown':  e.preventDefault(); panDown(); break
    case 'PageUp':     e.preventDefault(); prevSlide(); break
    case 'PageDown':   e.preventDefault(); nextSlide(); break
    case 'Home':       e.preventDefault(); firstSlide(); break
    case 'End':        e.preventDefault(); lastSlide(); break
    case '+': case '=': e.preventDefault(); zoomIn(); break
    case '-':           e.preventDefault(); zoomOut(); break
    case '0':           e.preventDefault(); resetZoom(); break
  }
}

// Re-render on resize for proper fit
let resizeTimer = null
function handleResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (presentation && !loading.value) renderSlide(currentSlide.value)
  }, 200)
}

onMounted(() => {
  loadPptx(props.fileUrl)
  window.addEventListener('keydown', handleKey)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey)
  window.removeEventListener('resize', handleResize)
  if (presentation?.cleanup) presentation.cleanup()
})

watch(() => props.fileUrl, (url) => {
  loadPptx(url)
})
</script>

<template>
  <div class="pv">
    <!-- Toolbar -->
    <div class="pv-toolbar">
      <!-- Slide nav -->
      <div class="pv-group">
        <button class="pv-btn" @click="firstSlide" :disabled="currentSlide <= 0" title="首页 (Home)">⏮</button>
        <button class="pv-btn" @click="prevSlide" :disabled="currentSlide <= 0" title="上一页 (PageUp)">◀</button>
        <span class="pv-page-info">{{ currentSlide + 1 }} / {{ totalSlides }}</span>
        <button class="pv-btn" @click="nextSlide" :disabled="currentSlide >= totalSlides - 1" title="下一页 (PageDown)">▶</button>
        <button class="pv-btn" @click="lastSlide" :disabled="currentSlide >= totalSlides - 1" title="末页 (End)">⏭</button>
      </div>
      <div class="pv-sep"></div>

      <!-- Pan -->
      <div class="pv-group">
        <button class="pv-btn" @click="panLeft"  title="左移 (←)">←</button>
        <button class="pv-btn" @click="panUp"    title="上移 (↑)">↑</button>
        <button class="pv-btn" @click="panDown"  title="下移 (↓)">↓</button>
        <button class="pv-btn" @click="panRight" title="右移 (→)">→</button>
      </div>
      <div class="pv-sep"></div>

      <!-- Zoom -->
      <div class="pv-group">
        <button class="pv-btn" @click="zoomOut" title="缩小 (-)">−</button>
        <button class="pv-btn pv-zoom-lbl" @click="resetZoom" title="重置缩放 (0)">{{ Math.round(scale * 100) }}%</button>
        <button class="pv-btn" @click="zoomIn"  title="放大 (+)">+</button>
      </div>
    </div>

    <!-- Slide area -->
    <div class="pv-slide-area">
      <div v-if="loading" class="pv-state">
        <div class="pv-spinner"></div>
        <span>加载中...</span>
      </div>
      <div v-else-if="error" class="pv-state pv-error">
        <span style="font-size:32px">⚠</span>
        <span>{{ error }}</span>
      </div>
      <div
        v-show="!loading && !error"
        ref="slideWrapper"
        class="pv-slide-wrapper"
      >
        <div
          ref="slideContainer"
          class="pv-slide-content"
          :style="{
            transform: `scale(${scale}) translate(${panX}px, ${panY}px)`,
          }"
        ></div>
      </div>
    </div>

    <!-- Thumbnail bar -->
    <div ref="thumbnailBar" class="pv-thumbs" v-show="!loading && !error"></div>
  </div>
</template>

<style scoped>
.pv {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

/* ── toolbar ── */
.pv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(0,0,0,0.3);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pv-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pv-sep {
  width: 1px;
  height: 20px;
  background: rgba(255,255,255,0.12);
  margin: 0 4px;
}

.pv-btn {
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

.pv-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.pv-btn:active:not(:disabled) { transform: scale(0.95); }
.pv-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.pv-page-info {
  font-size: 12px;
  min-width: 56px;
  text-align: center;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.pv-zoom-lbl {
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}

/* ── slide area ── */
.pv-slide-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #525659;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-slide-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pv-slide-content {
  transform-origin: center center;
  transition: transform 0.2s ease;
}

.pv-slide-content :deep(svg) {
  display: block;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
}

/* ── state ── */
.pv-state {
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

.pv-error { color: #f85149; }

.pv-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #1a8fe3;
  border-radius: 50%;
  animation: pv-spin 0.8s linear infinite;
}

@keyframes pv-spin { to { transform: rotate(360deg); } }

/* ── thumbnail bar ── */
.pv-thumbs {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(0,0,0,0.3);
  border-top: 1px solid rgba(255,255,255,0.08);
  overflow-x: auto;
  flex-shrink: 0;
  min-height: 70px;
  align-items: center;
}

.pv-thumbs :deep(.pv-thumb) {
  flex-shrink: 0;
  width: 90px;
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
  background: rgba(255,255,255,0.03);
}

.pv-thumbs :deep(.pv-thumb:hover) {
  border-color: rgba(255,255,255,0.25);
}

.pv-thumbs :deep(.pv-thumb-active) {
  border-color: #1a8fe3;
  background: rgba(26,143,227,0.1);
}

.pv-thumbs :deep(.pv-thumb svg) {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 2px;
}
</style>
