<script setup>
import { ref, computed, markRaw, onMounted, onUnmounted, provide } from 'vue'
import AppWindow            from './components/AppWindow.vue'
import DinoGame             from './components/DinoGame.vue'
import ScientificCalculator from './components/ScientificCalculator.vue'
import Desmos               from './components/Desmos.vue'
import DrawingBoard         from './components/DrawingBoard.vue'
import CloudFiles           from './components/CloudFiles.vue'
import PDFViewer            from './components/PDFViewer.vue'
import FileViewer           from './components/FileViewer.vue'

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
const toolConfig = ref({})
const allTools = [
  {
    id: 'dino',
    name: '小恐龙',
    icon: '🦕',
    gradient: 'linear-gradient(135deg,#3a8c5c,#1d5e3a)',
    component: markRaw(DinoGame),
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
    component: markRaw(ScientificCalculator),
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
    component: markRaw(Desmos),
    windowTitle: 'Desmos 图形计算器',
    windowIcon: '📈',
    width: 1000,
    height: 640,
  },
  {
    id: 'drawing',
    name: '画板',
    icon: '🎨',
    gradient: 'linear-gradient(135deg,#d97706,#dc2626)',
    component: markRaw(DrawingBoard),
    windowTitle: '画板',
    windowIcon: '🎨',
    width: 900,
    height: 620,
  },
  {
    id: 'cloudfiles',
    name: '云文件',
    icon: '☁️',
    gradient: 'linear-gradient(135deg,#0f4c81,#1a8fe3)',
    component: markRaw(CloudFiles),
    windowTitle: '云文件管理',
    windowIcon: '☁️',
    width: 900,
    height: 600,
  },
]

// 根据配置过滤启用的工具
const tools = computed(() => {
  const cfg = toolConfig.value
  return allTools.filter(tool => cfg[tool.id]?.enabled !== false)
})

// 加载外部配置
async function loadConfig() {
  try {
    const res = await fetch('/config.json')
    if (res.ok) {
      toolConfig.value = await res.json()
    }
  } catch (e) {
    console.warn('Failed to load config.json, using defaults')
  }
}

// ── open windows ──
const openWindows = ref([])      // array of { id, toolId, tool, zIndex }
const pdfWindows = ref([])       // array of { id, pdfUrl, title, zIndex }
const fileWindows = ref([])      // array of { id, fileUrl, fileName, mimeType, zIndex }
let winSeq = 0
let pdfWinSeq = 0
let fileWinSeq = 0
let zCounter = 1000

function openTool(tool) {
  // only one instance per tool
  if (openWindows.value.find(w => w.toolId === tool.id)) return
  openWindows.value.push({ id: ++winSeq, toolId: tool.id, tool, zIndex: ++zCounter })
}

function closeWindow(winId) {
  openWindows.value = openWindows.value.filter(w => w.id !== winId)
}

function closePDFWindow(winId) {
  pdfWindows.value = pdfWindows.value.filter(w => w.id !== winId)
}

function closeFileWindow(winId) {
  fileWindows.value = fileWindows.value.filter(w => w.id !== winId)
}

function bringToFront(winId) {
  const win = openWindows.value.find(w => w.id === winId)
  if (win) win.zIndex = ++zCounter
}

function bringPDFToFront(winId) {
  const win = pdfWindows.value.find(w => w.id === winId)
  if (win) win.zIndex = ++zCounter
}

function bringFileToFront(winId) {
  const win = fileWindows.value.find(w => w.id === winId)
  if (win) win.zIndex = ++zCounter
}

// Open PDF in new window
function openPDFViewer(pdfUrl, title = 'PDF Viewer') {
  pdfWindows.value.push({
    id: ++pdfWinSeq,
    pdfUrl,
    title: title.length > 40 ? title.slice(0, 37) + '...' : title,
    zIndex: ++zCounter
  })
}

// Open file in new window (image, text, video, audio)
function openFileViewer(fileUrl, fileName, mimeType, fileList = [], currentIndex = -1) {
  // Determine icon based on mime type
  let icon = '📄'
  if (mimeType?.startsWith('image/')) icon = '🖼'
  else if (mimeType?.startsWith('video/')) icon = '🎬'
  else if (mimeType?.startsWith('audio/')) icon = '🎵'
  else if (mimeType?.startsWith('text/')) icon = '📝'

  fileWindows.value.push({
    id: ++fileWinSeq,
    fileUrl,
    fileName: fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName,
    mimeType,
    icon,
    fileList,
    currentIndex,
    zIndex: ++zCounter
  })
}

// Navigate to different file in file viewer
function navigateFileViewer(winId, newIndex) {
  const win = fileWindows.value.find(w => w.id === winId)
  if (!win || !win.fileList || newIndex < 0 || newIndex >= win.fileList.length) return

  const newFile = win.fileList[newIndex]
  win.currentIndex = newIndex
  win.fileUrl = newFile.url
  win.fileName = newFile.name.length > 40 ? newFile.name.slice(0, 37) + '...' : newFile.name
  win.mimeType = newFile.mime

  // Update icon
  if (newFile.mime?.startsWith('image/')) win.icon = '🖼'
  else if (newFile.mime?.startsWith('video/')) win.icon = '🎬'
  else if (newFile.mime?.startsWith('audio/')) win.icon = '🎵'
  else if (newFile.mime?.startsWith('text/')) win.icon = '📝'
  else win.icon = '📄'
}

// Provide functions to child components
provide('openPDFViewer', openPDFViewer)
provide('openFileViewer', openFileViewer)
provide('navigateFileViewer', navigateFileViewer)

onMounted(() => {
  timer = setInterval(() => { now.value = new Date() }, 1000)
  loadConfig()
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

    <!-- PDF 查看器窗口层 -->
    <AppWindow
      v-for="win in pdfWindows"
      :key="'pdf-' + win.id"
      :title="win.title"
      icon="📄"
      :initial-width="900"
      :initial-height="700"
      :zIndex="win.zIndex"
      @close="closePDFWindow(win.id)"
      @raise="bringPDFToFront(win.id)"
    >
      <PDFViewer :pdfUrl="win.pdfUrl" />
    </AppWindow>

    <!-- 文件预览窗口层 (图片、文本、视频、音频) -->
    <AppWindow
      v-for="win in fileWindows"
      :key="'file-' + win.id"
      :title="win.fileName"
      :icon="win.icon"
      :initial-width="800"
      :initial-height="600"
      :zIndex="win.zIndex"
      @close="closeFileWindow(win.id)"
      @raise="bringFileToFront(win.id)"
    >
      <FileViewer
        :fileUrl="win.fileUrl"
        :fileName="win.fileName"
        :mimeType="win.mimeType"
        :fileList="win.fileList || []"
        :currentIndex="win.currentIndex !== undefined ? win.currentIndex : -1"
        @navigate="(newIndex) => navigateFileViewer(win.id, newIndex)"
      />
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
