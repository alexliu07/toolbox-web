<script setup>
import { ref, computed, markRaw, onMounted, onUnmounted, provide } from 'vue'
import AppWindow            from './components/AppWindow.vue'
import AuthScreen           from './components/AuthScreen.vue'
import { useWindowManager } from './composables/useWindowManager.js'
import { useAuth }          from './composables/useAuth.js'

// 动态加载所有带 toolMeta 的工具组件
const toolModules = import.meta.glob('./components/*.vue', { eager: true })
const allTools = Object.values(toolModules)
  .filter(mod => mod.toolMeta)
  .map(mod => ({ ...mod.toolMeta, component: markRaw(mod.default) }))
  .sort((a, b) => a.order - b.order)

// ── auth ──
const {
  authToken, currentUser, isLoggedIn,
  checkAuth, handleLogout, authFetch,
} = useAuth()

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

// ── window manager ──
const {
  windows,
  openWindow, closeWindow, bringToFront, minimizeWindow, updateWindow,
  setTaskbarButtonRef, getTaskbarButtonRect,
  allOpenWindows, focusedWindowId, hasOpenWindows,
  handleTaskbarClick,
} = useWindowManager()

function openTool(tool) {
  openWindow({
    title: tool.windowTitle, icon: tool.windowIcon,
    width: tool.width, height: tool.height,
    component: tool.component,
    singletonKey: tool.id,
  })
}

// Provide auth token and auth-aware fetch to child components
provide('authToken', authToken)
provide('authFetch', authFetch)

// Provide window manager primitives to child components
provide('openWindow', openWindow)
provide('updateWindow', updateWindow)
provide('windows', windows)
provide('getTaskbarButtonRect', getTaskbarButtonRect)

onMounted(() => {
  timer = setInterval(() => { now.value = new Date() }, 1000)
  loadConfig()
  checkAuth()
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

    <!-- 登录/注册界面 -->
    <AuthScreen />

    <!-- 任务栏 -->
    <Transition name="taskbar-bar">
    <div class="taskbar" v-if="hasOpenWindows">
      <TransitionGroup name="taskbar" tag="div" class="taskbar-items">
        <button
          v-for="win in allOpenWindows"
          :key="win.id"
          :ref="(el) => setTaskbarButtonRef(el, win.id)"
          class="taskbar-item"
          :class="{ 'taskbar-item--active': focusedWindowId === win.id && !win.minimized, 'taskbar-item--minimized': win.minimized }"
          @click="handleTaskbarClick(win)"
          :title="win.title"
        >
          <span class="taskbar-icon">{{ win.icon }}</span>
          <span class="taskbar-title">{{ win.title }}</span>
        </button>
      </TransitionGroup>
    </div>
    </Transition>

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

      <!-- 用户信息栏 -->
      <div v-if="isLoggedIn" class="user-bar">
        <span class="user-greeting">👤 {{ currentUser.displayName || currentUser.username }}</span>
        <button class="logout-btn" @click="handleLogout">退出登录</button>
      </div>

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
      v-for="win in windows"
      :key="win.id"
      :windowId="win.id"
      :title="win.title"
      :icon="win.icon"
      :initial-width="win.width"
      :initial-height="win.height"
      :zIndex="win.zIndex"
      :minimized="win.minimized"
      @close="closeWindow(win.id)"
      @raise="bringToFront(win.id)"
      @minimize="minimizeWindow(win.id)"
    >
      <component
        :is="win.component"
        v-bind="win.props"
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

/* ── 用户信息栏 ── */
.user-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  box-sizing: border-box;
}

.user-greeting {
  flex: 1;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.3px;
}

.logout-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.logout-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.4);
  color: #f87171;
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
  padding-top: 100px;
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

/* ── 任务栏 ── */
.taskbar-bar-enter-active,
.taskbar-bar-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.taskbar-bar-enter-from,
.taskbar-bar-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

.taskbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 12px 24px;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.taskbar-items {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(20, 24, 40, 0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: auto;
  max-width: 90vw;
  overflow-x: auto;
  scrollbar-width: none;
}

.taskbar-items::-webkit-scrollbar {
  display: none;
}

.taskbar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.taskbar-item:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.taskbar-item:active {
  transform: translateY(0);
  background: rgba(255, 255, 255, 0.08);
}

.taskbar-item--active {
  background: rgba(99, 102, 241, 0.35);
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
}

.taskbar-item--active:hover {
  background: rgba(99, 102, 241, 0.45);
  border-color: rgba(99, 102, 241, 0.7);
}

.taskbar-item--minimized {
  opacity: 0.6;
}

.taskbar-item--minimized .taskbar-title {
  text-decoration: line-through;
  opacity: 0.7;
}

.taskbar-icon {
  font-size: 16px;
  line-height: 1;
}

.taskbar-title {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 任务栏标签伸缩动画 -- */
.taskbar-enter-active,
.taskbar-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.taskbar-enter-from {
  opacity: 0;
  transform: scaleX(0);
  max-width: 0;
  padding: 8px 0;
  margin: 0;
}

.taskbar-leave-to {
  opacity: 0;
  transform: scaleX(0);
  max-width: 0;
  padding: 8px 0;
  margin: 0;
}

.taskbar-move {
  transition: transform 0.2s ease;
}

@media (max-width: 600px) {
  .taskbar {
    padding: 8px 12px;
  }
  .taskbar-items {
    padding: 4px 6px;
    gap: 4px;
  }
  .taskbar-item {
    padding: 6px 10px;
  }
  .taskbar-title {
    max-width: 80px;
    font-size: 12px;
  }
  .taskbar-enter-from,
  .taskbar-leave-to {
    padding: 6px 0;
  }
}
</style>
