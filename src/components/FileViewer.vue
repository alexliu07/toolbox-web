<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' }
})

const textContent = ref('')
const loading = ref(false)
const error = ref('')

// Type checkers
function isImage(mime) { return mime && mime.startsWith('image/') }
function isText(mime) {
  if (!mime) return false
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml') || mime.includes('yaml')
}
function isVideo(mime) { return mime && mime.startsWith('video/') }
function isAudio(mime) { return mime && mime.startsWith('audio/') }
function isPDF(mime) { return mime && mime.includes('pdf') }

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

onMounted(() => {
  loadTextContent()
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
      <img
        v-else-if="isImage(mimeType)"
        :src="fileUrl"
        :alt="fileName"
        class="fv-image"
      />

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
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.fv-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
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
.fv-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
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
