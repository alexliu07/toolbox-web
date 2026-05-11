<script setup>
import { ref, onUnmounted, inject} from 'vue'

const authFetch = inject('authFetch')

const imageUrl = ref(null)
const captureTimeStr = ref('')
const loading = ref(false)
const cached = ref(false)

function formatTime(epochMs) {
  const d = new Date(epochMs)
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${weekDays[d.getDay()]} ${h}:${m}:${s}`
}

async function capture() {
  loading.value = true
  try {
    // 释放旧 blob URL
    if (imageUrl.value) {
      URL.revokeObjectURL(imageUrl.value)
      imageUrl.value = null
    }

    const res = await authFetch('/api/screenshot/capture')
    if (!res.ok) {
      const err = await res.json()
      alert(err.error || '截图失败')
      return
    }

    const captureTime = parseInt(res.headers.get('X-Capture-Time'), 10)
    cached.value = res.headers.get('X-Cache') === 'hit'
    captureTimeStr.value = formatTime(captureTime)

    const blob = await res.blob()
    imageUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    alert('请求失败：' + e.message)
  } finally {
    loading.value = false
  }
}

function download() {
  if (!imageUrl.value) return
  const a = document.createElement('a')
  a.href = imageUrl.value
  a.download = `截图_${captureTimeStr.value.replace(/[: ]/g, '_')}.png`
  a.click()
}

onUnmounted(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})
</script>

<template>
  <div class="screenshot-tool">
    <div class="toolbar">
      <button class="btn-capture" :disabled="loading" @click="capture">
        {{ loading ? '截取中…' : '截取屏幕' }}
      </button>
      <button class="btn-download" :disabled="!imageUrl" @click="download">
        下载截图
      </button>
      <span v-if="captureTimeStr" class="capture-info">
        {{ captureTimeStr }}
        <span v-if="cached" class="cache-badge">缓存</span>
      </span>
    </div>

    <div class="image-area">
      <div v-if="loading" class="loading-overlay">
        <span class="spinner"></span>
        正在截取屏幕…
      </div>
      <div v-else-if="!imageUrl" class="empty-hint">
        点击「截取屏幕」按钮开始
      </div>
      <img v-else :src="imageUrl" class="screenshot-img" alt="屏幕截图" />
    </div>
  </div>
</template>

<style scoped>
.screenshot-tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.btn-capture {
  background: linear-gradient(135deg, #0ea5e9, #06b6d4);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.15s;
  white-space: nowrap;
}
.btn-capture:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-capture:active:not(:disabled) { transform: translateY(0); }
.btn-capture:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-download {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  color: rgba(255,255,255,0.7);
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.btn-download:hover:not(:disabled) {
  background: rgba(255,255,255,0.14);
  color: #fff;
}
.btn-download:disabled { opacity: 0.35; cursor: not-allowed; }

.capture-info {
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  margin-left: 8px;
}

.cache-badge {
  font-size: 11px;
  background: rgba(14,165,233,0.25);
  color: #0ea5e9;
  padding: 2px 8px;
  border-radius: 4px;
  margin-left: 6px;
}

.image-area {
  flex: 1;
  min-height: 0;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.screenshot-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.empty-hint {
  color: rgba(255,255,255,0.4);
  font-size: 15px;
}

.loading-overlay {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255,255,255,0.6);
  font-size: 14px;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>