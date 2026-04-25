<template>
  <div class="player-wrapper" @mousemove="showControls" @mouseleave="hideControls">
    <!-- 视频 -->
    <video ref="videoRef" class="video" />

    <!-- 弹幕画布 -->
    <canvas ref="danmakuRef" class="danmaku-canvas" />

    <!-- 控制栏 -->
    <transition name="fade">
      <div v-show="controlsVisible" class="controls">
        <!-- 进度条 -->
        <div class="progress-bar" @click="seek">
          <div class="progress-filled" :style="{ width: progress + '%' }" />
        </div>

        <div class="controls-row">
          <!-- 播放/暂停 -->
          <button @click="togglePlay">{{ playing ? '⏸' : '▶' }}</button>

          <!-- 时间 -->
          <span class="time">{{ currentTimeStr }} / {{ durationStr }}</span>

          <div class="spacer" />

          <!-- 弹幕开关 -->
          <button @click="toggleDanmaku" :class="{ active: danmakuEnabled }">弹幕</button>

          <!-- 画质切换 -->
          <div class="quality-menu">
            <button @click="showQuality = !showQuality">{{ currentQuality }}</button>
            <div v-if="showQuality" class="quality-list">
              <div
                  v-for="q in qualities"
                  :key="q.label"
                  @click="switchQuality(q)"
                  :class="{ selected: q.label === currentQuality }"
              >
                {{ q.label }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { MediaPlayer } from 'dashjs'

const props = defineProps({
  // 单画质传 mpdUrl，多画质传 qualities
  mpdUrl: String,
  qualities: {
    type: Array,
    default: () => []
    // 格式: [{ label: '480P', url: '/api/bilibili/mpd?...' }, { label: '720P', url: '...' }]
  },
  danmakuList: {
    type: Array,
    default: () => []
    // 格式: [{ time: 12.5, text: '哈哈哈', color: '#ffffff', type: 'scroll' }]
  }
})

const videoRef = ref(null)
const danmakuRef = ref(null)
let dashPlayer = null

// 播放状态
const playing = ref(false)
const progress = ref(0)
const currentTime = ref(0)
const duration = ref(0)
const controlsVisible = ref(true)
let controlsTimer = null

// 画质
const showQuality = ref(false)
const currentQuality = ref(props.qualities[0]?.label || '480P')

// 弹幕
const danmakuEnabled = ref(true)
let danmakuAnimFrame = null
let activeDanmaku = []

const currentTimeStr = computed(() => formatTime(currentTime.value))
const durationStr = computed(() => formatTime(duration.value))

function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// 初始化 dash.js
function initDash(url) {
  if (dashPlayer) {
    dashPlayer.destroy()
    dashPlayer = null
  }
  dashPlayer = MediaPlayer().create()
  dashPlayer.initialize(videoRef.value, url, true)
}

// 播放控制
function togglePlay() {
  const v = videoRef.value
  playing.value ? v.pause() : v.play()
}

function seek(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  videoRef.value.currentTime = ratio * duration.value
}

// 控制栏显示/隐藏
function showControls() {
  controlsVisible.value = true
  clearTimeout(controlsTimer)
  controlsTimer = setTimeout(() => { controlsVisible.value = false }, 3000)
}
function hideControls() {
  clearTimeout(controlsTimer)
  controlsTimer = setTimeout(() => { controlsVisible.value = false }, 1000)
}

// 画质切换
function switchQuality(q) {
  currentQuality.value = q.label
  showQuality.value = false
  const currentT = videoRef.value.currentTime
  initDash(q.url)
  videoRef.value.addEventListener('canplay', () => {
    videoRef.value.currentTime = currentT
  }, { once: true })
}

// 弹幕
function toggleDanmaku() {
  danmakuEnabled.value = !danmakuEnabled.value
  const canvas = danmakuRef.value
  if (!danmakuEnabled.value) {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}

function renderDanmaku() {
  const canvas = danmakuRef.value
  const ctx = canvas.getContext('2d')
  const now = currentTime.value

  canvas.width = canvas.offsetWidth
  canvas.height = canvas.offsetHeight
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (!danmakuEnabled.value) {
    danmakuAnimFrame = requestAnimationFrame(renderDanmaku)
    return
  }

  // 新增弹幕
  props.danmakuList.forEach(d => {
    if (Math.abs(d.time - now) < 0.3 && !activeDanmaku.find(a => a.source === d)) {
      activeDanmaku.push({
        source: d,
        text: d.text,
        color: d.color || '#ffffff',
        x: canvas.width,
        y: Math.random() * (canvas.height - 40) + 20,
        speed: 2 + Math.random() * 2
      })
    }
  })

  // 渲染并移动
  activeDanmaku = activeDanmaku.filter(d => {
    d.x -= d.speed
    ctx.font = '16px sans-serif'
    ctx.fillStyle = d.color
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 2
    ctx.strokeText(d.text, d.x, d.y)
    ctx.fillText(d.text, d.x, d.y)
    return d.x > -200
  })

  danmakuAnimFrame = requestAnimationFrame(renderDanmaku)
}

onMounted(() => {
  const v = videoRef.value

  v.addEventListener('play', () => { playing.value = true })
  v.addEventListener('pause', () => { playing.value = false })
  v.addEventListener('timeupdate', () => {
    currentTime.value = v.currentTime
    progress.value = (v.currentTime / v.duration) * 100 || 0
  })
  v.addEventListener('durationchange', () => {
    duration.value = v.duration
  })

  // 初始化 dash
  const url = props.qualities.length > 0 ? props.qualities[0].url : props.mpdUrl
  initDash(url)

  // 启动弹幕
  renderDanmaku()
})

onBeforeUnmount(() => {
  if (dashPlayer) dashPlayer.destroy()
  if (danmakuAnimFrame) cancelAnimationFrame(danmakuAnimFrame)
  clearTimeout(controlsTimer)
})
</script>

<style scoped>
.player-wrapper {
  position: relative;
  width: 100%;
  background: #000;
  aspect-ratio: 16/9;
  overflow: hidden;
}

.video {
  width: 100%;
  height: 100%;
  display: block;
}

.danmaku-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
  padding: 16px 12px 10px;
}

.progress-bar {
  height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 8px;
}

.progress-filled {
  height: 100%;
  background: #fb7299;
  border-radius: 2px;
  transition: width 0.1s;
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.controls-row button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
}

.controls-row button:hover,
.controls-row button.active {
  background: rgba(251,114,153,0.3);
  color: #fb7299;
}

.time {
  color: #ccc;
  font-size: 13px;
}

.spacer { flex: 1; }

.quality-menu {
  position: relative;
}

.quality-list {
  position: absolute;
  bottom: 32px;
  right: 0;
  background: rgba(20,20,20,0.95);
  border-radius: 6px;
  overflow: hidden;
  min-width: 80px;
}

.quality-list div {
  padding: 8px 16px;
  color: #ccc;
  cursor: pointer;
  font-size: 13px;
}

.quality-list div:hover,
.quality-list div.selected {
  background: rgba(251,114,153,0.2);
  color: #fb7299;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>