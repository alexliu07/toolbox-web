<script>
export const toolMeta = {
  id: 'dino',
  name: '小恐龙',
  icon: '🦕',
  gradient: 'linear-gradient(135deg,#3a8c5c,#1d5e3a)',
  windowTitle: 'Chrome Dino',
  windowIcon: '🦕',
  width: 800,
  height: 380,
  order: 1,
}
</script>

<script setup>
import { ref, onMounted, onUnmounted, inject } from 'vue'

const iframeRef = ref(null)
const iframeLoaded = ref(false)
let savedScore = 0

const authFetch = inject('authFetch')

async function loadHighScore() {
  try {
    const res = await authFetch('/api/data/dino-highscore')
    const data = await res.json()
    if (data && data.score > 0) savedScore = data.score
  } catch { /* ignore */ }
}

async function saveHighScore(score) {
  try {
    await authFetch('/api/data/dino-highscore', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    })
  } catch { /* ignore */ }
}

function sendScoreToIframe() {
  if (savedScore > 0 && iframeRef.value?.contentWindow) {
    iframeRef.value.contentWindow.postMessage({ type: 'setHighScore', score: savedScore }, '*')
  }
}

function onIframeLoad() {
  iframeLoaded.value = true
  sendScoreToIframe()
}

function onMessage(e) {
  if (e.data?.type === 'newHighScore' && e.data.score > 0) {
    saveHighScore(e.data.score)
  }
}

onMounted(async () => {
  window.addEventListener('message', onMessage)
  await loadHighScore()
  // If iframe already loaded before API responded, send now
  if (iframeLoaded.value) sendScoreToIframe()
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<template>
  <iframe
    ref="iframeRef"
    src="/dino/index.html"
    class="dino-frame"

    @load="onIframeLoad"
  />
</template>

<style scoped>
.dino-frame {
  width: 100%;
  height: 100%;
  display: block;
  border: none;
  background: #f7f7f7;
  overflow: hidden;
}
</style>
