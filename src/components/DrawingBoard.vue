<script>
export const toolMeta = {
  id: 'drawing',
  name: '画板',
  icon: '🎨',
  gradient: 'linear-gradient(135deg,#d97706,#dc2626)',
  windowTitle: '画板',
  windowIcon: '🎨',
  width: 900,
  height: 620,
  order: 4,
}
</script>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'

// ── reactive tool state (used in template) ──
const tool       = ref('pen')
const penColor   = ref('#1a1a1a')
const penWidth   = ref(4)
const eraserSize = ref(24)
const eraserMode = ref('area')   // 'area' | 'stroke'
const hasSelection = ref(false)

// ── save/load state ──
const saveName = ref('')
const saves = ref([])
const showSaves = ref(false)
const saveStatus = ref('')   // '' | 'saving' | 'ok' | 'err'

// ── canvas / container ──
const canvasEl    = ref(null)
const containerEl = ref(null)
let ctx = null
let resizeObs = null

// ── viewport ──
let vpX = 0, vpY = 0

// ── stroke storage (plain, not reactive) ──
let strokes = []
let seq = 0

const authFetch = inject('authFetch')

// ── transient state ──
let liveStroke      = null
let lassoPath       = []
let selection       = new Set()
let hoveredStrokeId = null
let mouseCanvas     = null   // screen-space cursor position

// ── interaction flags ──
let isDown = false, isDrawing = false, isLassoing = false
let isStrokeErasing = false, isDraggingSel = false
let isScaling = false, isPanning = false

// ── drag / scale / pan data ──
let dragOrig = null, dragSnaps = null
let scaleData = null, panOrig = null

// ──────────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────────
let rafId = null
function queueRender() {
  if (!rafId) rafId = requestAnimationFrame(() => { rafId = null; paint() })
}

function paint() {
  if (!ctx || !canvasEl.value) return
  const cvs = canvasEl.value
  ctx.clearRect(0, 0, cvs.width, cvs.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cvs.width, cvs.height)

  ctx.save()
  ctx.translate(vpX, vpY)

  for (const s of strokes)  paintStroke(s)
  if (liveStroke)            paintStroke(liveStroke)

  // lasso outline
  if (lassoPath.length > 1) {
    ctx.save()
    ctx.setLineDash([5, 3])
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.fillStyle = 'rgba(56,189,248,0.07)'
    ctx.beginPath()
    lassoPath.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  // selection bounding box + handles
  if (selection.size > 0) {
    const b = computeBounds()
    if (b) {
      const P = 10
      ctx.save()
      ctx.setLineDash([5, 3])
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.5
      ctx.strokeRect(b.x - P, b.y - P, b.w + P * 2, b.h + P * 2)
      ctx.setLineDash([])
      for (const h of cornerHandles(b, P)) {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(h.x, h.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  ctx.restore()

  // eraser brush circle (screen space, no world transform)
  if (tool.value === 'eraser' && eraserMode.value === 'area' && mouseCanvas) {
    ctx.save()
    ctx.strokeStyle = 'rgba(100,100,100,0.65)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.arc(mouseCanvas.x, mouseCanvas.y, +eraserSize.value / 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

function paintStroke(s) {
  if (!s.points.length) return
  const isSel = selection.has(s.id)
  const isHov = s.id === hoveredStrokeId
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (isSel) {
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = s.width + 8
    ctx.globalAlpha = 0.35
    tracePath(s.points)
    ctx.globalAlpha = 1
  }
  if (isHov) {
    ctx.strokeStyle = '#f87171'
    ctx.lineWidth = s.width + 6
    ctx.globalAlpha = 0.5
    tracePath(s.points)
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = s.color
  ctx.lineWidth = s.width
  if (s.points.length === 1) {
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    tracePath(s.points)
  }
  ctx.restore()
}

function tracePath(pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  ctx.stroke()
}

// ──────────────────────────────────────────────
// GEOMETRY HELPERS
// ──────────────────────────────────────────────
function toWorld(cx, cy) { return { x: cx - vpX, y: cy - vpY } }

function screenXY(e) {
  const r = canvasEl.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function screenXYTouch(t) {
  const r = canvasEl.value.getBoundingClientRect()
  return { x: t.clientX - r.left, y: t.clientY - r.top }
}

function computeBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of strokes) {
    if (!selection.has(s.id)) continue
    for (const p of s.points) {
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function cornerHandles(b, P) {
  return [
    { x: b.x - P,         y: b.y - P         },
    { x: b.x + b.w + P,   y: b.y - P         },
    { x: b.x - P,         y: b.y + b.h + P   },
    { x: b.x + b.w + P,   y: b.y + b.h + P   },
  ]
}

function hitHandle(wx, wy) {
  const b = computeBounds(); if (!b) return -1
  for (let i = 0; i < 4; i++) {
    const h = cornerHandles(b, 10)[i]
    if (Math.hypot(wx - h.x, wy - h.y) < 10) return i
  }
  return -1
}

function inSelBounds(wx, wy) {
  const b = computeBounds(); if (!b) return false
  const P = 14
  return wx >= b.x - P && wx <= b.x + b.w + P && wy >= b.y - P && wy <= b.y + b.h + P
}

function nearestStroke(wx, wy, r) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    if (s.eraser) continue
    for (const p of s.points) {
      if (Math.hypot(p.x - wx, p.y - wy) < r + s.width / 2) return s.id
    }
  }
  return null
}

function polyContains(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { x: xi, y: yi } = poly[i], { x: xj, y: yj } = poly[j]
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// ──────────────────────────────────────────────
// MOUSE EVENTS
// ──────────────────────────────────────────────
function onDown(e) {
  if (e.button !== 0) return
  isDown = true
  const cp = screenXY(e), wp = toWorld(cp.x, cp.y)
  mouseCanvas = cp

  if (tool.value === 'pan') {
    isPanning = true
    panOrig = { cx: e.clientX, cy: e.clientY, vx: vpX, vy: vpY }
    return
  }

  if (tool.value === 'lasso') {
    if (selection.size > 0) {
      const hi = hitHandle(wp.x, wp.y)
      if (hi >= 0) {
        const b = computeBounds()
        const hs = cornerHandles(b, 10)
        const piv = hs[[3, 2, 1, 0][hi]]
        const origDist = Math.hypot(wp.x - piv.x, wp.y - piv.y)
        isScaling = true
        scaleData = {
          pivX: piv.x, pivY: piv.y, origDist,
          snaps: strokes.filter(s => selection.has(s.id)).map(s => ({
            id: s.id, w: s.width, pts: s.points.map(p => ({ ...p }))
          }))
        }
        return
      }
      if (inSelBounds(wp.x, wp.y)) {
        isDraggingSel = true
        dragOrig = { wx: wp.x, wy: wp.y }
        dragSnaps = strokes.filter(s => selection.has(s.id)).map(s => ({
          id: s.id, pts: s.points.map(p => ({ ...p }))
        }))
        return
      }
    }
    // start fresh lasso
    selection = new Set(); hasSelection.value = false
    lassoPath = [{ x: wp.x, y: wp.y }]
    isLassoing = true
    return
  }

  if (tool.value === 'pen') {
    isDrawing = true
    liveStroke = { id: ++seq, points: [{ ...wp }], color: penColor.value, width: +penWidth.value }
    return
  }

  if (tool.value === 'eraser') {
    if (eraserMode.value === 'stroke') {
      isStrokeErasing = true
      const id = nearestStroke(wp.x, wp.y, +eraserSize.value / 2)
      if (id !== null) { strokes = strokes.filter(s => s.id !== id); queueRender() }
    } else {
      isDrawing = true
      liveStroke = { id: ++seq, points: [{ ...wp }], color: '#ffffff', width: +eraserSize.value, eraser: true }
    }
  }
}

function onMove(e) {
  const cp = screenXY(e), wp = toWorld(cp.x, cp.y)
  mouseCanvas = cp

  if (isPanning) {
    vpX = panOrig.vx + e.clientX - panOrig.cx
    vpY = panOrig.vy + e.clientY - panOrig.cy
    queueRender(); return
  }

  if (tool.value === 'lasso') {
    if (isScaling && scaleData) {
      const { pivX, pivY, origDist, snaps } = scaleData
      if (origDist < 0.01) return
      const sc = Math.max(0.05, Math.hypot(wp.x - pivX, wp.y - pivY) / origDist)
      for (const snap of snaps) {
        const s = strokes.find(x => x.id === snap.id); if (!s) continue
        s.points = snap.pts.map(p => ({ x: pivX + (p.x - pivX) * sc, y: pivY + (p.y - pivY) * sc }))
        s.width  = Math.max(0.5, snap.w * sc)
      }
      queueRender(); return
    }
    if (isDraggingSel) {
      const dx = wp.x - dragOrig.wx, dy = wp.y - dragOrig.wy
      for (const snap of dragSnaps) {
        const s = strokes.find(x => x.id === snap.id); if (!s) continue
        s.points = snap.pts.map(p => ({ x: p.x + dx, y: p.y + dy }))
      }
      queueRender(); return
    }
    if (isLassoing) { lassoPath.push({ x: wp.x, y: wp.y }); queueRender() }
    return
  }

  if (tool.value === 'eraser' && eraserMode.value === 'stroke') {
    const id = nearestStroke(wp.x, wp.y, +eraserSize.value / 2)
    if (id !== hoveredStrokeId) { hoveredStrokeId = id; queueRender() }
    if (isStrokeErasing && id !== null) {
      strokes = strokes.filter(s => s.id !== id)
      hoveredStrokeId = null
      queueRender()
    }
    return
  }

  if (tool.value === 'eraser' && eraserMode.value === 'area') queueRender() // redraw cursor circle

  if (!isDown || !liveStroke) return
  liveStroke.points.push({ ...wp })
  queueRender()
}

function onUp() {
  if (!isDown) return
  isDown = false

  if (isPanning)      { isPanning = false; return }
  if (isScaling)      { isScaling = false; scaleData = null; return }
  if (isDraggingSel)  { isDraggingSel = false; dragSnaps = null; return }
  if (isStrokeErasing){ isStrokeErasing = false; return }

  if (isLassoing) {
    isLassoing = false
    if (lassoPath.length > 2) {
      selection = new Set(
        strokes
          .filter(s => !s.eraser && s.points.some(p => polyContains(p, lassoPath)))
          .map(s => s.id)
      )
      hasSelection.value = selection.size > 0
    }
    lassoPath = []
    queueRender(); return
  }

  if (liveStroke) {
    strokes.push(liveStroke)
    liveStroke = null
    queueRender()
  }
  isDrawing = false
}

function onLeave() {
  mouseCanvas = null
  if (hoveredStrokeId !== null) { hoveredStrokeId = null; queueRender() }
  else if (tool.value === 'eraser') queueRender()
}

// ──────────────────────────────────────────────
// TOUCH EVENTS
// ──────────────────────────────────────────────
function onTouchStart(e) {
  if (e.touches.length !== 1) return
  e.preventDefault()
  const t = e.touches[0]
  const cp = screenXYTouch(t)
  const wp = toWorld(cp.x, cp.y)
  mouseCanvas = cp
  isDown = true

  if (tool.value === 'pan') {
    isPanning = true
    panOrig = { cx: t.clientX, cy: t.clientY, vx: vpX, vy: vpY }
    return
  }

  if (tool.value === 'lasso') {
    if (selection.size > 0) {
      const hi = hitHandle(wp.x, wp.y)
      if (hi >= 0) {
        const b = computeBounds()
        const hs = cornerHandles(b, 10)
        const piv = hs[[3, 2, 1, 0][hi]]
        const origDist = Math.hypot(wp.x - piv.x, wp.y - piv.y)
        isScaling = true
        scaleData = {
          pivX: piv.x, pivY: piv.y, origDist,
          snaps: strokes.filter(s => selection.has(s.id)).map(s => ({
            id: s.id, w: s.width, pts: s.points.map(p => ({ ...p }))
          }))
        }
        return
      }
      if (inSelBounds(wp.x, wp.y)) {
        isDraggingSel = true
        dragOrig = { wx: wp.x, wy: wp.y }
        dragSnaps = strokes.filter(s => selection.has(s.id)).map(s => ({
          id: s.id, pts: s.points.map(p => ({ ...p }))
        }))
        return
      }
    }
    selection = new Set(); hasSelection.value = false
    lassoPath = [{ x: wp.x, y: wp.y }]
    isLassoing = true
    return
  }

  if (tool.value === 'pen') {
    isDrawing = true
    liveStroke = { id: ++seq, points: [{ ...wp }], color: penColor.value, width: +penWidth.value }
    return
  }

  if (tool.value === 'eraser') {
    if (eraserMode.value === 'stroke') {
      isStrokeErasing = true
      const id = nearestStroke(wp.x, wp.y, +eraserSize.value / 2)
      if (id !== null) { strokes = strokes.filter(s => s.id !== id); queueRender() }
    } else {
      isDrawing = true
      liveStroke = { id: ++seq, points: [{ ...wp }], color: '#ffffff', width: +eraserSize.value, eraser: true }
    }
  }
}

function onTouchMove(e) {
  if (e.touches.length !== 1) return
  e.preventDefault()
  const t = e.touches[0]
  const cp = screenXYTouch(t)
  const wp = toWorld(cp.x, cp.y)
  mouseCanvas = cp

  if (isPanning) {
    vpX = panOrig.vx + t.clientX - panOrig.cx
    vpY = panOrig.vy + t.clientY - panOrig.cy
    queueRender(); return
  }

  if (tool.value === 'lasso') {
    if (isScaling && scaleData) {
      const { pivX, pivY, origDist, snaps } = scaleData
      if (origDist < 0.01) return
      const sc = Math.max(0.05, Math.hypot(wp.x - pivX, wp.y - pivY) / origDist)
      for (const snap of snaps) {
        const s = strokes.find(x => x.id === snap.id); if (!s) continue
        s.points = snap.pts.map(p => ({ x: pivX + (p.x - pivX) * sc, y: pivY + (p.y - pivY) * sc }))
        s.width  = Math.max(0.5, snap.w * sc)
      }
      queueRender(); return
    }
    if (isDraggingSel) {
      const dx = wp.x - dragOrig.wx, dy = wp.y - dragOrig.wy
      for (const snap of dragSnaps) {
        const s = strokes.find(x => x.id === snap.id); if (!s) continue
        s.points = snap.pts.map(p => ({ x: p.x + dx, y: p.y + dy }))
      }
      queueRender(); return
    }
    if (isLassoing) { lassoPath.push({ x: wp.x, y: wp.y }); queueRender() }
    return
  }

  if (tool.value === 'eraser' && eraserMode.value === 'stroke') {
    const id = nearestStroke(wp.x, wp.y, +eraserSize.value / 2)
    if (id !== hoveredStrokeId) { hoveredStrokeId = id; queueRender() }
    if (isStrokeErasing && id !== null) {
      strokes = strokes.filter(s => s.id !== id)
      hoveredStrokeId = null
      queueRender()
    }
    return
  }

  if (!isDown || !liveStroke) return
  liveStroke.points.push({ ...wp })
  queueRender()
}

function onTouchEnd(e) {
  e.preventDefault()
  onUp()
}

// ──────────────────────────────────────────────
// ACTIONS
// ──────────────────────────────────────────────
function deleteSelection() {
  strokes = strokes.filter(s => !selection.has(s.id))
  selection = new Set(); hasSelection.value = false
  queueRender()
}

function clearAll() {
  strokes = []; liveStroke = null
  selection = new Set(); hasSelection.value = false
  lassoPath = []
  vpX = 0; vpY = 0
  queueRender()
}

// ──────────────────────────────────────────────
// SAVE / LOAD
// ──────────────────────────────────────────────
async function loadSavesList() {
  try {
    const res = await authFetch('/api/drawings')
    saves.value = await res.json()
  } catch { /* ignore */ }
}

async function saveDrawing() {
  const name = saveName.value.trim() || '未命名'
  saveStatus.value = 'saving'
  try {
    const res = await authFetch('/api/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        strokes: strokes.map(s => ({
          id: s.id,
          points: s.points,
          color: s.color,
          width: s.width,
          eraser: s.eraser || false
        })),
        viewport: { x: vpX, y: vpY }
      }),
    })
    saveStatus.value = res.ok ? 'ok' : 'err'
    if (res.ok) await loadSavesList()
  } catch {
    saveStatus.value = 'err'
  }
  setTimeout(() => { saveStatus.value = '' }, 1800)
}

async function loadDrawing(name) {
  try {
    const res = await authFetch(`/api/drawings/${encodeURIComponent(name)}`)
    const data = await res.json()
    strokes = (data.strokes || []).map(s => ({ ...s, id: s.id || ++seq }))
    if (data.viewport) { vpX = data.viewport.x || 0; vpY = data.viewport.y || 0 }
    selection = new Set(); hasSelection.value = false
    liveStroke = null
    saveName.value = name
    showSaves.value = false
    queueRender()
  } catch { /* ignore */ }
}

async function deleteDrawing(name) {
  if (!confirm(`删除存档 "${name}"？`)) return
  await authFetch(`/api/drawings/${encodeURIComponent(name)}`, { method: 'DELETE' })
  await loadSavesList()
}

function fmtDate(iso) {
  return iso.slice(0, 10)
}

function onKeyDown(e) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
    e.preventDefault(); deleteSelection()
  }
}

// ──────────────────────────────────────────────
// CANVAS RESIZE
// ──────────────────────────────────────────────
function resizeCanvas() {
  if (!canvasEl.value || !containerEl.value) return
  canvasEl.value.width  = containerEl.value.offsetWidth
  canvasEl.value.height = containerEl.value.offsetHeight
  queueRender()
}

const canvasCursor = computed(() => tool.value === 'pan' ? 'grab' : 'crosshair')

onMounted(() => {
  ctx = canvasEl.value.getContext('2d')
  resizeCanvas()
  resizeObs = new ResizeObserver(resizeCanvas)
  resizeObs.observe(containerEl.value)
  // AppWindow 开场动画约 280ms，动画结束后补测一次确保尺寸正确
  setTimeout(resizeCanvas, 320)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  resizeObs?.disconnect()
  window.removeEventListener('mouseup', onUp)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="board-root">

    <!-- ── toolbar ── -->
    <div class="toolbar">

      <!-- tool buttons -->
      <div class="tool-group">
        <button :class="['tb-btn', { active: tool === 'pen' }]" @click="tool = 'pen'" title="画笔">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z"/><path d="M11.5 5.5l3 3"/>
          </svg>
          <span>画笔</span>
        </button>
        <button :class="['tb-btn', { active: tool === 'eraser' }]" @click="tool = 'eraser'" title="橡皮">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 17h14M6 14l-3-3 8-8 3 3-8 8z"/><path d="M6 14h6"/>
          </svg>
          <span>橡皮</span>
        </button>
        <button :class="['tb-btn', { active: tool === 'lasso' }]" @click="tool = 'lasso'" title="圈选">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="10" cy="9" rx="7" ry="5" stroke-dasharray="3.5 2.2"/>
            <polyline points="13,13 13,17 17,17"/>
          </svg>
          <span>圈选</span>
        </button>
        <button :class="['tb-btn', { active: tool === 'pan' }]" @click="tool = 'pan'" title="拖动画布">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 3v14M3 10h14M6.5 6.5L3 10l3.5 3.5M13.5 6.5L17 10l-3.5 3.5"/>
          </svg>
          <span>拖动</span>
        </button>
      </div>

      <div class="sep"/>

      <!-- pen options -->
      <template v-if="tool === 'pen'">
        <label class="color-wrap" title="颜色">
          <input type="color" v-model="penColor" class="color-input"/>
          <span class="color-swatch" :style="{ background: penColor }"/>
        </label>
        <label class="slider-wrap">
          <span class="sl-label">粗细</span>
          <input type="range" v-model="penWidth" min="1" max="40" class="slider"/>
          <span class="sl-val">{{ penWidth }}</span>
        </label>
      </template>

      <!-- eraser options -->
      <template v-if="tool === 'eraser'">
        <div class="seg-ctrl">
          <button :class="{ active: eraserMode === 'area' }"   @click="eraserMode = 'area'">区域</button>
          <button :class="{ active: eraserMode === 'stroke' }" @click="eraserMode = 'stroke'">笔画</button>
        </div>
        <label class="slider-wrap">
          <span class="sl-label">大小</span>
          <input type="range" v-model="eraserSize" min="4" max="100" class="slider"/>
          <span class="sl-val">{{ eraserSize }}</span>
        </label>
      </template>

      <!-- lasso: delete btn -->
      <template v-if="tool === 'lasso' && hasSelection">
        <button class="tb-btn danger" @click="deleteSelection" title="删除选中 (Delete)">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <path d="M3 6h14l-1.2 11H4.2L3 6zM8 6V4h4v2M1 6h18"/>
          </svg>
          <span>删除</span>
        </button>
      </template>

      <div class="sep"/>

      <!-- save/load -->
      <input
        class="save-input"
        v-model="saveName"
        placeholder="存档名称…"
        @keydown.enter="saveDrawing"
      />
      <button
        class="tb-btn save-btn"
        :class="{ ok: saveStatus === 'ok', err: saveStatus === 'err' }"
        @click="saveDrawing"
        title="保存画板"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 17v-10l5-4h9v14H3z"/><path d="M7 3v4h6V3"/>
        </svg>
        <span>{{
          saveStatus === 'saving' ? '保存中…'
          : saveStatus === 'ok'   ? '✓ 已保存'
          : saveStatus === 'err'  ? '✗ 失败'
          : '保存'
        }}</span>
      </button>
      <button
        class="tb-btn"
        @click="showSaves = !showSaves; if(showSaves) loadSavesList()"
        title="读取存档"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v10h14V7M1 4h18v3H1V4z"/><path d="M7 10h6"/>
        </svg>
        <span>存档</span>
        <span class="badge" v-if="saves.length">{{ saves.length }}</span>
      </button>

      <div style="flex:1"/>

      <!-- clear all -->
      <button class="tb-btn" @click="clearAll" title="清空画布">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 9l-2 2 6 6 8-10"/><path d="M8 6L5 9"/>
        </svg>
        <span>清空</span>
      </button>

    </div>

    <!-- ── saves panel ── -->
    <div class="saves-panel" v-if="showSaves">
      <div v-if="saves.length === 0" class="saves-empty">暂无存档</div>
      <div v-for="s in saves" :key="s.name" class="save-row">
        <span class="save-name" :title="s.name">{{ s.name }}</span>
        <span class="save-date">{{ fmtDate(s.mtime) }}</span>
        <button class="tb-btn sm" @click="loadDrawing(s.name)">加载</button>
        <button class="tb-btn sm danger" @click="deleteDrawing(s.name)">删除</button>
      </div>
    </div>

    <!-- ── canvas ── -->
    <div class="canvas-wrap" ref="containerEl">
      <canvas
        ref="canvasEl"
        :style="{ cursor: canvasCursor }"
        @mousedown="onDown"
        @mousemove="onMove"
        @mouseleave="onLeave"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend.prevent="onTouchEnd"
      />
    </div>

  </div>
</template>

<style scoped>
.board-root {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  background: #f0f0f0;
  font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  user-select: none;
}

/* ── toolbar ── */
.toolbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 5px 10px;
  background: #1c2128;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}

.tool-group { display: flex; gap: 2px; }

.tb-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 5px 9px; min-width: 46px;
  background: transparent; border: 1px solid transparent; border-radius: 7px;
  color: rgba(230,237,243,0.5); cursor: pointer; font-size: 10px;
  transition: all 0.12s;
}
.tb-btn svg { width: 15px; height: 15px; }
.tb-btn:hover  { background: rgba(255,255,255,0.06); color: #e6edf3; }
.tb-btn.active { background: rgba(56,189,248,0.13); border-color: rgba(56,189,248,0.32); color: #38bdf8; }
.tb-btn.danger { color: rgba(248,113,113,0.8); }
.tb-btn.danger:hover { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.3); color: #f87171; }

.sep { width: 1px; height: 28px; background: rgba(255,255,255,0.08); margin: 0 2px; flex-shrink: 0; }

.color-wrap { position: relative; display: flex; align-items: center; cursor: pointer; }
.color-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: none; padding: 0; }
.color-swatch { display: block; width: 26px; height: 26px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.18); }

.slider-wrap { display: flex; align-items: center; gap: 6px; }
.sl-label { font-size: 11px; color: rgba(230,237,243,0.4); white-space: nowrap; }
.slider { width: 80px; accent-color: #38bdf8; cursor: pointer; }
.sl-val { font-size: 11px; color: rgba(230,237,243,0.5); width: 22px; text-align: right; font-variant-numeric: tabular-nums; }

.seg-ctrl {
  display: flex; border-radius: 7px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}
.seg-ctrl button {
  padding: 4px 11px; background: transparent; border: none;
  color: rgba(230,237,243,0.4); font-size: 11px; cursor: pointer; transition: all 0.12s;
}
.seg-ctrl button:hover:not(.active) { background: rgba(255,255,255,0.05); color: rgba(230,237,243,0.7); }
.seg-ctrl button.active { background: rgba(56,189,248,0.15); color: #38bdf8; }

/* ── save/load UI ── */
.save-input {
  padding: 4px 8px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  background: rgba(0,0,0,0.25);
  color: #e6edf3;
  font-size: 12px;
  outline: none;
  width: 120px;
}
.save-input:focus { border-color: #38bdf8; }
.save-input::placeholder { color: rgba(230,237,243,0.3); }

.tb-btn.save-btn.ok { color: #4ade80; }
.tb-btn.save-btn.err { color: #f87171; }

.badge {
  background: rgba(56,189,248,0.25);
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  margin-left: 2px;
}

.saves-panel {
  background: #1a1f26;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  max-height: 160px;
  overflow-y: auto;
  flex-shrink: 0;
}
.saves-panel::-webkit-scrollbar { width: 4px; }
.saves-panel::-webkit-scrollbar-thumb { background: #3e4856; border-radius: 2px; }

.saves-empty {
  padding: 12px;
  color: rgba(230,237,243,0.35);
  font-size: 13px;
  text-align: center;
}

.save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 13px;
  transition: background 0.12s;
}
.save-row:hover { background: rgba(255,255,255,0.04); }
.save-name { flex: 1; color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.save-date { color: rgba(230,237,243,0.4); font-size: 11px; flex-shrink: 0; }

.tb-btn.sm { padding: 3px 8px; min-width: auto; font-size: 11px; }

/* ── canvas ── */
.canvas-wrap {
  flex: 1; position: relative; overflow: hidden;
}
canvas {
  position: absolute; inset: 0; display: block;
}
</style>
