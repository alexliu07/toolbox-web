<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, inject } from 'vue'

const props = defineProps({
  title: { type: String, default: 'App' },
  icon: { type: String, default: '' },
  initialWidth: { type: Number, default: 800 },
  initialHeight: { type: Number, default: 520 },
  minWidth: { type: Number, default: 400 },
  minHeight: { type: Number, default: 300 },
  zIndex: { type: Number, default: 1000 },
  minimized: { type: Boolean, default: false },
  windowId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'raise', 'minimize'])

// 注入获取任务栏按钮位置的方法
const getTaskbarButtonRect = inject('getTaskbarButtonRect', () => null)

// ── position & size ──
const x = ref(0)
const y = ref(0)
const w = ref(props.initialWidth)
const h = ref(props.initialHeight)

// ── state ──
const maximized = ref(false)
const opening = ref(true)
const closing = ref(false)
const transitioning = ref(false)
const prevRect = ref(null)
const interacting = ref(false)

// Windows 风格最小化动画状态
const isAnimating = ref(false)
const animationTransform = ref('')
const isHidden = ref(false)
const noTransition = ref(false)
let currentAnimationId = 0

// 生成唯一动画 ID，用于处理动画中断
function getAnimationId() {
  return ++currentAnimationId
}

onMounted(async () => {
  // center on screen
  x.value = Math.max(0, (window.innerWidth  - w.value) / 2)
  y.value = Math.max(0, (window.innerHeight - h.value) / 2)
  await nextTick()
  // trigger entrance animation
  requestAnimationFrame(() => { opening.value = false })
})

// 监听 minimized 变化，触发动画
watch(() => props.minimized, async (newVal, oldVal) => {
  if (newVal === oldVal) return

  if (newVal) {
    await animateMinimize()
  } else {
    await animateRestore()
  }
})

// Windows 风格最小化动画
async function animateMinimize() {
  const targetRect = getTaskbarButtonRect(props.windowId)
  if (!targetRect) {
    isHidden.value = true
    return
  }

  const animId = getAnimationId()
  isAnimating.value = true

  // 窗口当前中心点
  const windowCenterX = x.value + w.value / 2
  const windowCenterY = y.value + h.value / 2

  // 目标中心点（任务栏按钮中心）
  const targetX = targetRect.x
  const targetY = targetRect.y

  // 计算需要移动的位移
  const deltaX = targetX - windowCenterX
  const deltaY = targetY - windowCenterY

  // Windows 风格：缩小到约 5% 并移动到任务栏
  const scale = 0.05

  // 构建 transform
  animationTransform.value = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`

  // 在抵达任务栏之前就隐藏（只等待80%的动画时间）
  await new Promise(resolve => setTimeout(resolve, 160))

  // 检查动画是否被中断
  if (animId !== currentAnimationId) return

  // 提前隐藏窗口（此时还未完全抵达任务栏）
  isHidden.value = true

  // 再等待一小段时间让动画基本完成
  await new Promise(resolve => setTimeout(resolve, 40))

  // 检查动画是否被中断
  if (animId !== currentAnimationId) return

  isAnimating.value = false
}

// Windows 风格还原动画
async function animateRestore() {
  const targetRect = getTaskbarButtonRect(props.windowId)

  if (!targetRect) {
    isHidden.value = false
    animationTransform.value = ''
    return
  }

  const animId = getAnimationId()

  // 禁用过渡，瞬间跳到任务栏按钮的当前位置
  noTransition.value = true
  isAnimating.value = true

  // 窗口目标中心点
  const windowCenterX = x.value + w.value / 2
  const windowCenterY = y.value + h.value / 2

  // 起始中心点（任务栏按钮中心，实时读取）
  const startX = targetRect.x
  const startY = targetRect.y

  // 计算起始位移
  const deltaX = startX - windowCenterX
  const deltaY = startY - windowCenterY

  const scale = 0.05

  // 先设置起始位置（任务栏处，缩小状态），无过渡瞬间到位
  animationTransform.value = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`

  // 强制回流确保样式应用
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))

  // 检查动画是否被中断
  if (animId !== currentAnimationId) return

  // 显示窗口（此时已经在任务栏位置，不会闪现）
  isHidden.value = false

  // 恢复过渡，准备飞回动画
  noTransition.value = false

  // 下一帧开始飞回动画
  await new Promise(resolve => requestAnimationFrame(resolve))

  // 检查动画是否被中断
  if (animId !== currentAnimationId) return

  // 移除变换，飞回原位置
  animationTransform.value = ''

  // 等待动画完成（200ms）
  await new Promise(resolve => setTimeout(resolve, 200))

  // 检查动画是否被中断
  if (animId !== currentAnimationId) return

  isAnimating.value = false
}

// ── drag ──
let dragging = false
let dragOX = 0, dragOY = 0

function onTitleMouseDown(e) {
  if (maximized.value) return
  if (isAnimating.value || isHidden.value) return
  if (e.button !== 0) return
  dragging = true
  interacting.value = true
  dragOX = e.clientX - x.value
  dragOY = e.clientY - y.value
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup',   onDragUp)
}

function onDragMove(e) {
  if (!dragging) return
  x.value = Math.max(0, Math.min(window.innerWidth  - w.value, e.clientX - dragOX))
  y.value = Math.max(0, Math.min(window.innerHeight - 40,      e.clientY - dragOY))
}

function onDragUp() {
  dragging = false
  interacting.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup',   onDragUp)
}

// ── resize ──
let resizing = false
let resizeDir = ''
let resizeOX = 0, resizeOY = 0
let resizeX0 = 0, resizeY0 = 0
let resizeW0 = 0, resizeH0 = 0

function onResizeMouseDown(e, dir) {
  if (maximized.value) return
  if (isAnimating.value || isHidden.value) return
  if (e.button !== 0) return
  resizing   = true
  interacting.value = true
  resizeDir  = dir
  resizeOX   = e.clientX
  resizeOY   = e.clientY
  resizeX0   = x.value
  resizeY0   = y.value
  resizeW0   = w.value
  resizeH0   = h.value
  e.preventDefault()
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup',   onResizeUp)
}

function onResizeMove(e) {
  if (!resizing) return
  const dx = e.clientX - resizeOX
  const dy = e.clientY - resizeOY

  if (resizeDir.includes('e')) w.value = Math.max(props.minWidth,  resizeW0 + dx)
  if (resizeDir.includes('s')) h.value = Math.max(props.minHeight, resizeH0 + dy)
  if (resizeDir.includes('w')) {
    const nw = Math.max(props.minWidth, resizeW0 - dx)
    x.value  = resizeX0 + (resizeW0 - nw)
    w.value  = nw
  }
  if (resizeDir.includes('n')) {
    const nh = Math.max(props.minHeight, resizeH0 - dy)
    y.value  = resizeY0 + (resizeH0 - nh)
    h.value  = nh
  }
}

function onResizeUp() {
  resizing = false
  interacting.value = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup',   onResizeUp)
}

// ── maximize / restore ──
function toggleMaximize() {
  if (isAnimating.value || isHidden.value) return
  transitioning.value = true
  if (maximized.value) {
    const r = prevRect.value
    x.value = r.x; y.value = r.y; w.value = r.w; h.value = r.h
    maximized.value = false
  } else {
    prevRect.value = { x: x.value, y: y.value, w: w.value, h: h.value }
    x.value = 0; y.value = 0
    w.value = window.innerWidth; h.value = window.innerHeight
    maximized.value = true
  }
  setTimeout(() => { transitioning.value = false }, 320)
}

// ── double-click title to maximize ──
function onTitleDblClick() { toggleMaximize() }

// ── close with exit animation ──
function handleClose() {
  closing.value = true
  setTimeout(() => emit('close'), 260)
}

// ── computed style ──
const windowStyle = computed(() => ({
  left:   x.value + 'px',
  top:    y.value + 'px',
  width:  w.value + 'px',
  height: h.value + 'px',
  zIndex: props.zIndex,
  transform: animationTransform.value,
  opacity: isHidden.value ? 0 : undefined,
  pointerEvents: isHidden.value ? 'none' : undefined,
}))

onUnmounted(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup',   onDragUp)
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup',   onResizeUp)
})
</script>

<template>
  <div
    class="app-window"
    :class="{ maximized, opening, closing, transitioning, 'animating': isAnimating, 'hidden': isHidden, 'no-transition': noTransition }"
    :style="windowStyle"
    @mousedown.capture="!isAnimating && !isHidden && emit('raise')"
  >
    <!-- resize handles (8 directions) -->
    <template v-if="!maximized && !isAnimating && !isHidden">
      <div class="rh rh-n"  @mousedown.stop="onResizeMouseDown($event,'n')"/>
      <div class="rh rh-s"  @mousedown.stop="onResizeMouseDown($event,'s')"/>
      <div class="rh rh-e"  @mousedown.stop="onResizeMouseDown($event,'e')"/>
      <div class="rh rh-w"  @mousedown.stop="onResizeMouseDown($event,'w')"/>
      <div class="rh rh-ne" @mousedown.stop="onResizeMouseDown($event,'ne')"/>
      <div class="rh rh-nw" @mousedown.stop="onResizeMouseDown($event,'nw')"/>
      <div class="rh rh-se" @mousedown.stop="onResizeMouseDown($event,'se')"/>
      <div class="rh rh-sw" @mousedown.stop="onResizeMouseDown($event,'sw')"/>
    </template>

    <!-- title bar -->
    <div
      class="title-bar"
      @mousedown="onTitleMouseDown"
      @dblclick="onTitleDblClick"
    >
      <div class="title-left">
        <span v-if="icon" class="win-icon">{{ icon }}</span>
        <span class="win-title">{{ title }}</span>
      </div>
      <div class="title-btns">
        <button class="wb wb-min" @click.stop="emit('minimize')" title="最小化">
          <svg viewBox="0 0 10 10"><line x1="1" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="wb wb-max" @click.stop="toggleMaximize" :title="maximized ? '还原' : '最大化'">
          <svg v-if="!maximized" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
          <svg v-else viewBox="0 0 10 10">
            <rect x="3" y="1" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.2"/>
            <polyline points="1,4 1,9 6,9" fill="none" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
        <button class="wb wb-close" @click.stop="handleClose" title="关闭">
          <svg viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.4"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
      </div>
    </div>

    <!-- content -->
    <div class="win-body">
      <div v-if="interacting" class="iframe-shield" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-window {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #1a1d2e;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  box-shadow:
    0 32px 80px rgba(0,0,0,0.7),
    0 0 0 0.5px rgba(255,255,255,0.06) inset;
  overflow: hidden;
  transition:
    transform 0.28s cubic-bezier(0.34,1.56,0.64,1),
    opacity   0.22s ease;
}

/* Windows 风格最小化动画 - 更快完成 */
.app-window.animating {
  transition:
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    opacity   0.15s ease;
}

/* 禁用过渡，用于还原时瞬间跳到任务栏当前位置 */
.app-window.no-transition {
  transition: none !important;
}

.app-window.hidden {
  pointer-events: none;
}

.app-window.transitioning {
  transition:
    left          0.3s cubic-bezier(0.4, 0, 0.2, 1),
    top           0.3s cubic-bezier(0.4, 0, 0.2, 1),
    width         0.3s cubic-bezier(0.4, 0, 0.2, 1),
    height        0.3s cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform     0.28s cubic-bezier(0.34,1.56,0.64,1),
    opacity       0.22s ease;
}

.app-window.opening {
  transform: scale(0.55);
  opacity: 0;
}

.app-window.closing {
  transform: scale(0.55);
  opacity: 0;
}

.app-window.maximized {
  border-radius: 0;
  border: none;
}

/* ── resize handles ── */
.rh {
  position: absolute;
  z-index: 10;
}
.rh-n  { top: 0;    left:  6px; right:  6px; height: 5px; cursor: n-resize; }
.rh-s  { bottom: 0; left:  6px; right:  6px; height: 5px; cursor: s-resize; }
.rh-e  { right: 0;  top:   6px; bottom: 6px; width:  5px; cursor: e-resize; }
.rh-w  { left:  0;  top:   6px; bottom: 6px; width:  5px; cursor: w-resize; }
.rh-ne { top: 0;    right:  0;  width: 10px; height: 10px; cursor: ne-resize; }
.rh-nw { top: 0;    left:   0;  width: 10px; height: 10px; cursor: nw-resize; }
.rh-se { bottom: 0; right:  0;  width: 10px; height: 10px; cursor: se-resize; }
.rh-sw { bottom: 0; left:   0;  width: 10px; height: 10px; cursor: sw-resize; }

/* ── title bar ── */
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 8px 0 14px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  cursor: default;
  user-select: none;
  flex-shrink: 0;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.win-icon  { font-size: 16px; line-height: 1; }
.win-title { font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; letter-spacing: 0.3px; }

.title-btns { display: flex; gap: 4px; }

.wb {
  width: 28px; height: 28px;
  border: none; border-radius: 6px;
  background: transparent;
  color: rgba(255,255,255,0.55);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}
.wb svg { width: 10px; height: 10px; }

.wb-min:hover  { background: rgba(255,255,255,0.1); color: #fff; }
.wb-max:hover  { background: rgba(255,255,255,0.1); color: #fff; }
.wb-close:hover { background: #e74c3c; color: #fff; }

/* ── body ── */
.win-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* transparent shield that blocks iframe pointer events during drag/resize */
.iframe-shield {
  position: absolute;
  inset: 0;
  z-index: 999;
  cursor: inherit;
}
</style>
