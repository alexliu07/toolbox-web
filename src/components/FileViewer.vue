<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileList: { type: Array, default: () => [] },  // all files in current directory
  currentIndex: { type: Number, default: -1 }     // index in fileList
})

const emit = defineEmits(['navigate'])

const textContent = ref('')
const loading = ref(false)
const error = ref('')

// Image controls
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const imageContainer = ref(null)
const imageElement = ref(null)
const imageNaturalWidth = ref(0)
const imageNaturalHeight = ref(0)

// Type checkers
function isImage(mime) { return mime && mime.startsWith('image/') }
function isText(mime) {
  if (!mime) return false
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml') || mime.includes('yaml')
}
function isVideo(mime) { return mime && mime.startsWith('video/') }
function isAudio(mime) { return mime && mime.startsWith('audio/') }
function isPDF(mime) { return mime && mime.includes('pdf') }

// Navigation
const canGoPrev = computed(() => props.currentIndex > 0)
const canGoNext = computed(() => props.currentIndex >= 0 && props.currentIndex < props.fileList.length - 1)

function goPrev() {
  if (canGoPrev.value) {
    resetImageControls()
    emit('navigate', props.currentIndex - 1)
  }
}

function goNext() {
  if (canGoNext.value) {
    resetImageControls()
    emit('navigate', props.currentIndex + 1)
  }
}

// Image controls
function clampPan() {
  if (!imageContainer.value || !imageNaturalWidth.value || !imageNaturalHeight.value) return

  const containerRect = imageContainer.value.getBoundingClientRect()
  const containerWidth = containerRect.width
  const containerHeight = containerRect.height

  // Calculate scaled image dimensions
  const scaledWidth = imageNaturalWidth.value * zoom.value
  const scaledHeight = imageNaturalHeight.value * zoom.value

  // If image is smaller than container, center it (no panning)
  if (scaledWidth <= containerWidth) {
    panX.value = 0
  } else {
    // Max pan distance = (scaledWidth - containerWidth) / 2
    const maxPanX = (scaledWidth - containerWidth) / 2
    panX.value = Math.max(-maxPanX, Math.min(maxPanX, panX.value))
  }

  if (scaledHeight <= containerHeight) {
    panY.value = 0
  } else {
    const maxPanY = (scaledHeight - containerHeight) / 2
    panY.value = Math.max(-maxPanY, Math.min(maxPanY, panY.value))
  }
}

function zoomIn() {
  zoom.value = Math.min(zoom.value + 0.25, 5)
  clampPan()
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 0.25, 0.25)
  clampPan()
}

function resetZoom() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function panUp() {
  panY.value += 50
  clampPan()
}

function panDown() {
  panY.value -= 50
  clampPan()
}

function panLeft() {
  panX.value += 50
  clampPan()
}

function panRight() {
  panX.value -= 50
  clampPan()
}

function resetImageControls() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

const imageStyle = computed(() => ({
  transform: `scale(${zoom.value}) translate(${panX.value}px, ${panY.value}px)`,
  cursor: zoom.value > 1 ? 'move' : 'default'
}))

// Keyboard shortcuts
function handleKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  if (isImage(props.mimeType)) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomIn()
    } else if (e.key === '-') {
      e.preventDefault()
      zoomOut()
    } else if (e.key === '0') {
      e.preventDefault()
      resetZoom()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      panUp()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      panDown()
    } else if (e.key === 'ArrowLeft' && !e.shiftKey) {
      e.preventDefault()
      panLeft()
    } else if (e.key === 'ArrowRight' && !e.shiftKey) {
      e.preventDefault()
      panRight()
    }
  }

  // Navigation shortcuts
  if (e.key === 'ArrowLeft' && e.shiftKey) {
    e.preventDefault()
    goPrev()
  } else if (e.key === 'ArrowRight' && e.shiftKey) {
    e.preventDefault()
    goNext()
  }
}

// Mouse drag for panning
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragStartPanX = 0
let dragStartPanY = 0

function handleMouseDown(e) {
  if (zoom.value <= 1) return
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPanX = panX.value
  dragStartPanY = panY.value
  e.preventDefault()
}

function handleMouseMove(e) {
  if (!isDragging) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  panX.value = dragStartPanX + dx
  panY.value = dragStartPanY + dy
}

function handleMouseUp() {
  isDragging = false
  clampPan()
}

function handleImageLoad(e) {
  imageNaturalWidth.value = e.target.naturalWidth
  imageNaturalHeight.value = e.target.naturalHeight
  clampPan()
}

// Load text content
async function loadTextContent() {
  if (!isText(props.mimeType)) return
  loading.value = true
  try {
    const res = await fetch(props.fileUrl)
    textContent.value = await res.text()
  } catch {
    textContent.value = '(无法加载内容)'
    error.value = '加载失败'
  } finally {
    loading.value = false
  }
}

// Reset controls when file changes
watch(() => props.fileUrl, () => {
  resetImageControls()
  imageNaturalWidth.value = 0
  imageNaturalHeight.value = 0
  loadTextContent()
})

onMounted(() => {
  loadTextContent()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div class="file-viewer">
    <!-- Toolbar -->
    <div class="fv-toolbar">
      <div class="fv-info">
        <span class="fv-name" :title="fileName">{{ fileName }}</span>
        <span class="fv-type">{{ mimeType }}</span>
      </div>

      <!-- Controls (show for previewable files) -->
      <div v-if="isImage(mimeType) || isVideo(mimeType) || isAudio(mimeType) || isText(mimeType)" class="fv-controls">
        <!-- Zoom & Pan (only for images) -->
        <template v-if="isImage(mimeType)">
          <div class="fv-control-group">
            <button class="fv-btn" @click="zoomOut" title="缩小 (-)">−</button>
            <span class="fv-zoom-level">{{ Math.round(zoom * 100) }}%</span>
            <button class="fv-btn" @click="zoomIn" title="放大 (+)">+</button>
            <button class="fv-btn" @click="resetZoom" title="重置 (0)">⊙</button>
          </div>

          <div class="fv-control-group">
            <button class="fv-btn" @click="panUp" title="上移 (↑)">↑</button>
            <button class="fv-btn" @click="panDown" title="下移 (↓)">↓</button>
            <button class="fv-btn" @click="panLeft" title="左移 (←)">←</button>
            <button class="fv-btn" @click="panRight" title="右移 (→)">→</button>
          </div>
        </template>

        <!-- Navigation -->
        <div class="fv-control-group">
          <button class="fv-btn" @click="goPrev" :disabled="!canGoPrev" title="上一个 (Shift+←)">◀</button>
          <button class="fv-btn" @click="goNext" :disabled="!canGoNext" title="下一个 (Shift+→)">▶</button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="fv-content">
      <!-- Loading -->
      <div v-if="loading" class="fv-loading">
        <div class="fv-spinner"></div>
        <span>加载中...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="fv-error">
        <span class="fv-error-icon">⚠️</span>
        <span>{{ error }}</span>
      </div>

      <!-- Image -->
      <div
        v-else-if="isImage(mimeType)"
        ref="imageContainer"
        class="fv-image-container"
      >
        <img
          ref="imageElement"
          :src="fileUrl"
          :alt="fileName"
          class="fv-image"
          :style="imageStyle"
          @mousedown="handleMouseDown"
          @load="handleImageLoad"
        />
      </div>

      <!-- Text -->
      <pre v-else-if="isText(mimeType)" class="fv-text">{{ textContent }}</pre>

      <!-- Video -->
      <video
        v-else-if="isVideo(mimeType)"
        :src="fileUrl"
        controls
        class="fv-video"
      />

      <!-- Audio -->
      <div v-else-if="isAudio(mimeType)" class="fv-audio-wrap">
        <div class="fv-audio-icon">🎵</div>
        <audio :src="fileUrl" controls class="fv-audio" />
      </div>

      <!-- PDF (fallback) -->
      <div v-else-if="isPDF(mimeType)" class="fv-unsupported">
        <span class="fv-icon">📕</span>
        <span>PDF 文件请使用 PDF 查看器</span>
      </div>

      <!-- Unsupported -->
      <div v-else class="fv-unsupported">
        <span class="fv-icon">📄</span>
        <span>此文件类型不支持预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1d2e;
  color: #e6edf3;
}

/* Toolbar */
.fv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.fv-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fv-control-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.fv-control-group:first-child {
  border-left: none;
  padding-left: 0;
}

.fv-zoom-level {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.fv-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.fv-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e6edf3;
}

.fv-type {
  font-size: 11px;
  color: #8b949e;
}

.fv-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  min-width: 32px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  flex-shrink: 0;
  user-select: none;
}

.fv-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.fv-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.fv-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.fv-btn svg {
  width: 16px;
  height: 16px;
}

.fv-btn.primary {
  background: #1a8fe3;
  border-color: #1a8fe3;
}

.fv-btn.primary:hover {
  background: #1479c9;
}

/* Content */
.fv-content {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

/* Loading & Error */
.fv-loading,
.fv-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8b949e;
}

.fv-spinner {
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

.fv-error-icon {
  font-size: 32px;
}

/* Image */
.fv-image-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fv-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  transition: transform 0.1s ease-out;
  transform-origin: center center;
}

/* Text */
.fv-text {
  width: 100%;
  height: 100%;
  margin: 0;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #e6edf3;
  background: #0d1117;
  padding: 16px;
  border-radius: 6px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Video */
.fv-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
}

/* Audio */
.fv-audio-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.fv-audio-icon {
  font-size: 64px;
}

.fv-audio {
  width: 400px;
  max-width: 100%;
}

/* Unsupported */
.fv-unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8b949e;
}

.fv-icon {
  font-size: 56px;
}
</style>
