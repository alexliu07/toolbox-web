<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import AppWindow            from './components/AppWindow.vue'
import DinoGame             from './components/DinoGame.vue'
import ScientificCalculator from './components/ScientificCalculator.vue'
import Desmos               from './components/Desmos.vue'

const now = ref(new Date())
let timer = null

const timeH = computed(() => String(now.value.getHours()).padStart(2, '0'))
const timeM = computed(() => String(now.value.getMinutes()).padStart(2, '0'))
const timeS = computed(() => String(now.value.getSeconds()).padStart(2, '0'))
const colonBlink = computed(() => now.value.getSeconds() % 2 === 0)

const dateStr = computed(() => {
  const d = now.value
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日　${weekDays[d.getDay()]}`
})

// ── tools registry ──
const tools = [
  {
    id: 'dino',
    name: '小恐龙',
    icon: '🦕',
    gradient: 'linear-gradient(135deg,#3a8c5c,#1d5e3a)',
    component: DinoGame,
    windowTitle: 'Chrome Dino',
    windowIcon: '🦕',
    width: 800,
    height: 380,
  },
  {
    id: 'calculator',
    name: '科学计算器',
    icon: '🧮',
    gradient: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
    component: ScientificCalculator,
    windowTitle: '科学计算器',
    windowIcon: '🧮',
    width: 520,
    height: 620,
  },
  {
    id: 'desmos',
    name: 'Desmos',
    icon: '📈',
    gradient: 'linear-gradient(135deg,#0a7ea4,#05c3de)',
    component: Desmos,
    windowTitle: 'Desmos 图形计算器',
    windowIcon: '📈',
    width: 1000,
    height: 640,
  },
]

// ── open windows ──
const openWindows = ref([])    // array of { id, toolId, tool, zIndex }
let winSeq = 0
let zCounter = 1000

function openTool(tool) {
  // only one instance per tool
  if (openWindows.value.find(w => w.toolId === tool.id)) return
  openWindows.value.push({ id: ++winSeq, toolId: tool.id, tool, zIndex: ++zCounter })
}

function closeWindow(winId) {
  openWindows.value = openWindows.value.filter(w => w.id !== winId)
}

function bringToFront(winId) {
  const win = openWindows.value.find(w => w.id === winId)
  if (win) win.zIndex = ++zCounter
}

onMounted(() => {
  timer = setInterval(() => { now.value = new Date() }, 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="app">
    <!-- 动态背景 -->
    <div class="bg">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
    </div>

    <main class="content">
      <!-- 时钟区域 -->
      <section class="clock-section">
        <div class="clock-card">
          <div class="clock-time">
            <span class="seg">{{ timeH }}</span>
            <span class="colon" :class="{ dim: colonBlink }">:</span>
            <span class="seg">{{ timeM }}</span>
            <span class="colon" :class="{ dim: colonBlink }">:</span>
            <span class="seg sec">{{ timeS }}</span>
          </div>
          <div class="clock-date">{{ dateStr }}</div>
        </div>
      </section>

      <!-- 工具启动台 -->
      <section class="launcher-section">
        <div class="launcher-grid">
          <button
            v-for="tool in tools"
            :key="tool.id"
            class="tool-item"
            @click="openTool(tool)"
          >
            <div class="tool-icon-wrap" :style="{ background: tool.gradient }">
              <span class="tool-icon">{{ tool.icon }}</span>
            </div>
            <span class="tool-name">{{ tool.name }}</span>
          </button>
        </div>
      </section>
    </main>

    <!-- 浮动窗口层 -->
    <AppWindow
      v-for="win in openWindows"
      :key="win.id"
      :title="win.tool.windowTitle"
      :icon="win.tool.windowIcon"
      :initial-width="win.tool.width"
      :initial-height="win.tool.height"
      :zIndex="win.zIndex"
      @close="closeWindow(win.id)"
      @raise="bringToFront(win.id)"
    >
      <component :is="win.tool.component" />
    </AppWindow>
  </div>
</template>

<style scoped>
/* ── 整体布局 ── */
.app {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ── 动态背景 ── */
.bg {
  position: fixed;
  inset: 0;
  background: #080c1a;
  z-index: 0;
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.45;
}

.orb-1 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, #5e3aee, #2d1b80);
  top: -150px;
  left: -100px;
  animation: float1 18s ease-in-out infinite;
}

.orb-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, #0f9bff, #0042a8);
  bottom: -100px;
  right: -80px;
  animation: float2 22s ease-in-out infinite;
}

.orb-3 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #ff4fd8, #7b0055);
  top: 40%;
  left: 50%;
  transform: translateX(-50%);
  animation: float3 26s ease-in-out infinite;
}

@keyframes float1 {
  0%, 100% { transform: translate(0, 0); }
  33%  { transform: translate(60px, 80px); }
  66%  { transform: translate(-40px, 50px); }
}

@keyframes float2 {
  0%, 100% { transform: translate(0, 0); }
  33%  { transform: translate(-70px, -60px); }
  66%  { transform: translate(50px, -30px); }
}

@keyframes float3 {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  40%  { transform: translateX(-60%) translateY(-60px); }
  80%  { transform: translateX(-40%) translateY(50px); }
}

/* ── 内容层 ── */
.content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1100px;
  padding: 0 32px 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 48px;
}

/* ── 时钟区域 ── */
.clock-section {
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 80px;
}

.clock-card {
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 28px;
  padding: 36px 64px 32px;
  text-align: center;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.clock-time {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
  font-size: 88px;
  font-weight: 200;
  letter-spacing: -2px;
  color: #ffffff;
  line-height: 1;
  text-shadow: 0 0 40px rgba(120, 150, 255, 0.5);
}

.seg { display: inline-block; min-width: 2ch; text-align: center; }

.sec {
  font-size: 56px;
  opacity: 0.75;
  align-self: flex-end;
  padding-bottom: 6px;
}

.colon {
  opacity: 1;
  transition: opacity 0.1s;
  margin: 0 4px;
  color: rgba(255, 255, 255, 0.6);
}

.colon.dim { opacity: 0.2; }

.clock-date {
  margin-top: 14px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 1.5px;
  font-weight: 300;
}

/* ── 启动台 ── */
.launcher-section {
  width: 100%;
}

.launcher-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 24px 16px;
  justify-items: center;
}

.tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  width: 110px;
}

.tool-icon-wrap {
  width: 76px;
  height: 76px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.2);
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease;
  position: relative;
}

.tool-icon-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.tool-icon {
  font-size: 36px;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.tool-name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  text-align: center;
  letter-spacing: 0.5px;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  font-weight: 400;
  transition: color 0.2s;
}

/* ── 悬停效果 ── */
.tool-item:hover .tool-icon-wrap {
  transform: scale(1.12) translateY(-4px);
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.45),
    0 6px 12px rgba(0, 0, 0, 0.3);
}

.tool-item:hover .tool-name {
  color: #ffffff;
}

.tool-item:active .tool-icon-wrap {
  transform: scale(0.96) translateY(0);
  transition-duration: 0.1s;
}

/* ── 响应式 ── */
@media (max-width: 600px) {
  .clock-time { font-size: 56px; }
  .sec { font-size: 36px; }
  .clock-card { padding: 28px 32px 24px; }
  .clock-section { padding-top: 48px; }
  .launcher-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 20px 12px; }
  .tool-icon-wrap { width: 64px; height: 64px; border-radius: 16px; }
  .tool-icon { font-size: 30px; }
}
</style>
