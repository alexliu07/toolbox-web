<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const display   = ref('0')
const exprLine  = ref('')
const memory    = ref(0)
const hasMemory = ref(false)
const angleMode = ref('DEG')
const history   = ref([])
const showHist  = ref(false)
const evaluated = ref(false)
const rippleKey = ref('')
const shiftMode = ref(false)

// ── helpers ──
const toRad   = x => angleMode.value === 'DEG' ? x * Math.PI / 180 : x
const fromRad = x => angleMode.value === 'DEG' ? x * 180 / Math.PI : x

function fmt(n) {
  if (isNaN(n))         return 'Error'
  if (!isFinite(n))     return n > 0 ? 'Infinity' : '-Infinity'
  if (Math.abs(n) >= 1e15) return n.toExponential(8)
  const s = n.toPrecision(12)
  const v = parseFloat(s)
  return String(v)
}

function calc(expr) {
  try {
    const e = expr
      .replace(/×/g, '*').replace(/÷/g, '/')
      .replace(/π/g, String(Math.PI)).replace(/ℯ/g, String(Math.E))
      .replace(/\^/g, '**')
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict";return(' + e + ')')()
    return typeof r === 'number' ? r : NaN
  } catch { return NaN }
}

function factorial(n) {
  n = Math.round(n)
  if (n < 0 || n > 170) return n < 0 ? NaN : Infinity
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r
}

// ── ripple ──
function tap(key) { rippleKey.value = key; setTimeout(() => { rippleKey.value = '' }, 140) }
function isPressed(k) { return rippleKey.value === k }

// ── input ──
function pressNum(v) {
  tap(v)
  if (evaluated.value && v !== '.') { display.value = v; exprLine.value = ''; evaluated.value = false; return }
  if (evaluated.value && v === '.') { display.value = '0.'; evaluated.value = false; return }
  evaluated.value = false
  if (v === '.') {
    const segs = display.value.split(/[+\-×÷(]/)
    if (segs[segs.length - 1].includes('.')) return
    display.value += '.'
    return
  }
  display.value = display.value === '0' ? v : display.value + v
}

function pressOp(op) {
  tap(op); evaluated.value = false
  display.value = display.value.replace(/[+\-×÷]$/, '') + op
}

function paren() {
  tap('()')
  evaluated.value = false
  const opens  = (display.value.match(/\(/g) || []).length
  const closes = (display.value.match(/\)/g) || []).length
  const add = (opens <= closes || display.value.endsWith('(')) ? '(' : ')'
  display.value = display.value === '0' && add === '(' ? '(' : display.value + add
}

function pressConst(c) {
  tap(c); evaluated.value = false
  display.value = display.value === '0' ? c : display.value + c
}

function pressPow() { tap('^'); evaluated.value = false; display.value += '^' }

// ── unary functions ──
function applyFn(fn) {
  tap(fn)
  const cur = parseFloat(display.value)
  if (isNaN(cur)) return
  let result, label
  switch (fn) {
    case 'sin':   result = Math.sin(toRad(cur));  label = `sin(${display.value})`; break
    case 'cos':   result = Math.cos(toRad(cur));  label = `cos(${display.value})`; break
    case 'tan':   result = Math.tan(toRad(cur));  label = `tan(${display.value})`; break
    case 'asin':  result = fromRad(Math.asin(cur)); label = `sin⁻¹(${display.value})`; break
    case 'acos':  result = fromRad(Math.acos(cur)); label = `cos⁻¹(${display.value})`; break
    case 'atan':  result = fromRad(Math.atan(cur)); label = `tan⁻¹(${display.value})`; break
    case 'ln':    result = Math.log(cur);       label = `ln(${display.value})`; break
    case 'log':   result = Math.log10(cur);     label = `log(${display.value})`; break
    case 'log2':  result = Math.log2(cur);      label = `log₂(${display.value})`; break
    case 'sqrt':  result = Math.sqrt(cur);      label = `√(${display.value})`; break
    case 'cbrt':  result = Math.cbrt(cur);      label = `∛(${display.value})`; break
    case 'exp':   result = Math.exp(cur);       label = `eˣ(${display.value})`; break
    case 'sq':    result = cur * cur;           label = `(${display.value})²`; break
    case 'cube':  result = cur ** 3;            label = `(${display.value})³`; break
    case 'inv':   result = 1 / cur;             label = `1/(${display.value})`; break
    case 'fact':  result = factorial(cur);      label = `${display.value}!`; break
    case 'abs':   result = Math.abs(cur);       label = `|${display.value}|`; break
    case 'floor': result = Math.floor(cur);     label = `⌊${display.value}⌋`; break
    case 'ceil':  result = Math.ceil(cur);      label = `⌈${display.value}⌉`; break
    default: return
  }
  const r = fmt(result)
  exprLine.value = label
  history.value.unshift({ expr: label, result: r })
  if (history.value.length > 60) history.value.pop()
  display.value = r
  evaluated.value = true
}

// ── equals ──
function equals() {
  tap('=')
  if (!display.value || display.value === 'Error') return
  const expr = display.value
  const r    = fmt(calc(expr))
  exprLine.value = expr
  history.value.unshift({ expr, result: r })
  if (history.value.length > 60) history.value.pop()
  display.value = r
  evaluated.value = true
}

// ── clear / backspace ──
function clear() { tap('AC'); display.value = '0'; exprLine.value = ''; evaluated.value = false }
function back()  {
  tap('⌫')
  if (evaluated.value) { clear(); return }
  display.value = display.value.length <= 1 ? '0' : display.value.slice(0, -1)
}
function negate()  { tap('±'); if (display.value !== '0') display.value = display.value.startsWith('-') ? display.value.slice(1) : '-' + display.value }
function percent() { tap('%'); const v = parseFloat(display.value); if (!isNaN(v)) { display.value = fmt(v / 100); evaluated.value = true } }

// ── memory ──
function mClear()  { tap('MC'); memory.value = 0; hasMemory.value = false }
function mRecall() { tap('MR'); if (hasMemory.value) { display.value = fmt(memory.value); evaluated.value = true } }
function mStore()  { tap('MS'); memory.value = parseFloat(display.value) || 0; hasMemory.value = true }
function mAdd()    { tap('M+'); memory.value += parseFloat(display.value) || 0; hasMemory.value = true }
function mSub()    { tap('M-'); memory.value -= parseFloat(display.value) || 0; hasMemory.value = true }


// ── display font ──
const displayFS = computed(() => {
  const l = display.value.length
  if (l > 20) return '16px'
  if (l > 14) return '22px'
  if (l > 10) return '30px'
  if (l > 6)  return '38px'
  return '48px'
})

// ── keyboard ──
const rootEl = ref(null)
let cleanupAppWin = null

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key
  if (/^[0-9]$/.test(k))   { pressNum(k); return }
  if (k === '.')            { pressNum('.'); return }
  if (k === '+')            { pressOp('+'); return }
  if (k === '-')            { pressOp('-'); return }
  if (k === '*')            { pressOp('×'); return }
  if (k === '/')            { e.preventDefault(); pressOp('÷'); return }
  if (k === '^')            { pressPow(); return }
  if (k === '%')            { percent(); return }
  if (k === 'Enter' || k === '=') { equals(); return }
  if (k === 'Backspace')    { back(); return }
  if (k === 'Escape')       { clear(); return }
  if (k === '(' || k === ')') { paren(); return }
}

onMounted(() => {
  rootEl.value.addEventListener('keydown', onKey)
  rootEl.value.focus()

  // 点击标题栏/resize 边框等 calc-root 以外的窗口区域时，把焦点还给 rootEl
  const appWin = rootEl.value.closest('.app-window')
  if (appWin) {
    const refocus = (e) => {
      if (!rootEl.value?.contains(e.target))
        setTimeout(() => rootEl.value?.focus(), 0)
    }
    appWin.addEventListener('mousedown', refocus)
    cleanupAppWin = () => appWin.removeEventListener('mousedown', refocus)
  }
})

onUnmounted(() => {
  rootEl.value?.removeEventListener('keydown', onKey)
  cleanupAppWin?.()
})
</script>

<template>
  <div class="calc-root" ref="rootEl" tabindex="0">

    <!-- ── history sidebar ── -->
    <transition name="hist-slide">
      <aside v-if="showHist" class="hist-panel">
        <div class="hist-head">历史记录</div>
        <div class="hist-body">
          <template v-if="history.length">
            <div
              v-for="(h, i) in history" :key="i"
              class="hist-row"
              @click="display = h.result; evaluated = true; showHist = false"
            >
              <span class="h-ex">{{ h.expr }}</span>
              <span class="h-re">{{ h.result }}</span>
            </div>
          </template>
          <div v-else class="hist-empty">暂无记录</div>
        </div>
        <button class="hist-clr" @click="history = []">清空记录</button>
      </aside>
    </transition>

    <!-- ── calculator body ── -->
    <div class="calc-body">

      <!-- display -->
      <div class="disp-area">
        <div class="disp-meta">
          <span class="badge angle" @click="angleMode = angleMode==='DEG'?'RAD':'DEG'">{{ angleMode }}</span>
          <span class="badge mem" :class="{ on: hasMemory }">M</span>
          <span class="badge shift" :class="{ on: shiftMode }" @click="shiftMode = !shiftMode">{{ shiftMode ? 'INV' : 'SHIFT' }}</span>
          <button class="hist-toggle" :class="{ on: showHist }" @click="showHist = !showHist">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,5 8,8.5 10.5,10"/></svg>
          </button>
        </div>
        <div class="expr-row">{{ exprLine }}</div>
        <div class="main-num" :style="{ fontSize: displayFS }">{{ display }}</div>
      </div>

      <!-- ── scientific grid (5 cols × 5 rows) ── -->
      <div class="sci-grid">
        <!-- memory row -->
        <button class="btn mem-btn" :class="{ rip: isPressed('MC') }" @click="mClear">MC</button>
        <button class="btn mem-btn" :class="{ rip: isPressed('MR') }" @click="mRecall">MR</button>
        <button class="btn mem-btn" :class="{ rip: isPressed('MS') }" @click="mStore">MS</button>
        <button class="btn mem-btn" :class="{ rip: isPressed('M+') }" @click="mAdd">M+</button>
        <button class="btn mem-btn" :class="{ rip: isPressed('M-') }" @click="mSub">M−</button>

        <!-- trig row -->
        <button class="btn sci-btn" :class="{ rip: isPressed(shiftMode?'asin':'sin') }" @click="applyFn(shiftMode?'asin':'sin')">{{ shiftMode ? 'sin⁻¹' : 'sin' }}</button>
        <button class="btn sci-btn" :class="{ rip: isPressed(shiftMode?'acos':'cos') }" @click="applyFn(shiftMode?'acos':'cos')">{{ shiftMode ? 'cos⁻¹' : 'cos' }}</button>
        <button class="btn sci-btn" :class="{ rip: isPressed(shiftMode?'atan':'tan') }" @click="applyFn(shiftMode?'atan':'tan')">{{ shiftMode ? 'tan⁻¹' : 'tan' }}</button>
        <button class="btn sci-btn" :class="{ rip: isPressed(shiftMode?'exp':'ln') }" @click="applyFn(shiftMode?'exp':'ln')">{{ shiftMode ? 'eˣ' : 'ln' }}</button>
        <button class="btn sci-btn" :class="{ rip: isPressed(shiftMode?'log2':'log') }" @click="applyFn(shiftMode?'log2':'log')">{{ shiftMode ? 'log₂' : 'log' }}</button>

        <!-- power/root row -->
        <button class="btn sci-btn" :class="{ rip: isPressed('sq') }" @click="applyFn('sq')">x²</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('cube') }" @click="applyFn('cube')">x³</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('^') }" @click="pressPow">xʸ</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('sqrt') }" @click="applyFn(shiftMode?'cbrt':'sqrt')">{{ shiftMode ? '∛' : '√' }}</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('inv') }" @click="applyFn('inv')">1/x</button>

        <!-- misc row -->
        <button class="btn sci-btn" :class="{ rip: isPressed('fact') }" @click="applyFn('fact')">n!</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('abs') }"  @click="applyFn('abs')">|x|</button>
        <button class="btn sci-btn" :class="{ rip: isPressed('()') }"   @click="paren">( )</button>
        <button class="btn const-btn" :class="{ rip: isPressed('π') }" @click="pressConst('π')">π</button>
        <button class="btn const-btn" :class="{ rip: isPressed('ℯ') }" @click="pressConst('ℯ')">e</button>
      </div>

      <!-- ── number pad (4 cols × 5 rows) ── -->
      <div class="num-grid">
        <button class="btn util-btn red"  :class="{ rip: isPressed('AC') }" @click="clear">AC</button>
        <button class="btn util-btn back" :class="{ rip: isPressed('⌫') }"  @click="back">⌫</button>
        <button class="btn util-btn"      :class="{ rip: isPressed('±') }"  @click="negate">±</button>
        <button class="btn op-btn"        :class="{ rip: isPressed('÷') }"  @click="pressOp('÷')">÷</button>

        <button class="btn dig-btn"       :class="{ rip: isPressed('7') }"  @click="pressNum('7')">7</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('8') }"  @click="pressNum('8')">8</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('9') }"  @click="pressNum('9')">9</button>
        <button class="btn op-btn"        :class="{ rip: isPressed('×') }"  @click="pressOp('×')">×</button>

        <button class="btn dig-btn"       :class="{ rip: isPressed('4') }"  @click="pressNum('4')">4</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('5') }"  @click="pressNum('5')">5</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('6') }"  @click="pressNum('6')">6</button>
        <button class="btn op-btn"        :class="{ rip: isPressed('-') }"  @click="pressOp('-')">−</button>

        <button class="btn dig-btn"       :class="{ rip: isPressed('1') }"  @click="pressNum('1')">1</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('2') }"  @click="pressNum('2')">2</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('3') }"  @click="pressNum('3')">3</button>
        <button class="btn op-btn"        :class="{ rip: isPressed('+') }"  @click="pressOp('+')">+</button>

        <!-- last row: 0(span2), ., = -->
        <button class="btn dig-btn zero"  :class="{ rip: isPressed('0') }"  @click="pressNum('0')">0</button>
        <button class="btn dig-btn"       :class="{ rip: isPressed('.') }"  @click="pressNum('.')">.</button>
        <button class="btn eq-btn"        :class="{ rip: isPressed('=') }"  @click="equals">=</button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── root ── */
.calc-root {
  width: 100%; height: 100%;
  display: flex;
  background: #0d1117;
  font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  user-select: none;
  overflow: hidden;
  color: #e6edf3;
  outline: none;
}
.calc-root:focus-within {
  box-shadow: inset 0 0 0 1.5px rgba(56,189,248,0.35);
}

/* ── history ── */
.hist-panel {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #0d1117;
  border-right: 1px solid rgba(255,255,255,0.07);
}
.hist-head {
  padding: 12px 14px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: rgba(230,237,243,0.3);
  font-weight: 600;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.hist-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px;
}
.hist-body::-webkit-scrollbar { width: 3px; }
.hist-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
.hist-row {
  padding: 8px 10px 7px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.12s;
}
.hist-row:hover { background: rgba(255,255,255,0.06); }
.h-ex { display: block; font-size: 11px; color: rgba(230,237,243,0.38); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h-re { display: block; font-size: 15px; font-weight: 500; text-align: right; color: #e6edf3; }
.hist-empty { padding: 20px 10px; font-size: 12px; color: rgba(230,237,243,0.25); text-align: center; }
.hist-clr {
  margin: 8px; padding: 7px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  color: rgba(230,237,243,0.35);
  font-size: 11px; cursor: pointer;
  transition: all 0.15s; flex-shrink: 0;
}
.hist-clr:hover { background: rgba(248,81,73,0.12); color: #f85149; border-color: rgba(248,81,73,0.3); }

.hist-slide-enter-active,
.hist-slide-leave-active { transition: width 0.26s cubic-bezier(0.4,0,0.2,1), opacity 0.2s; overflow: hidden; }
.hist-slide-enter-from,
.hist-slide-leave-to    { width: 0 !important; opacity: 0; }

/* ── calc body ── */
.calc-body {
  flex: 1;
  display: grid;
  grid-template-rows: auto 4fr 5fr;
  min-width: 0;
  min-height: 0;
}

/* ── display ── */
.disp-area {
  background: linear-gradient(170deg, #161b22 0%, #0d1117 100%);
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}
.disp-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  padding: 2px 7px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}
.badge.angle { background: rgba(56,189,248,0.12); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); }
.badge.angle:hover { background: rgba(56,189,248,0.22); }
.badge.mem   { background: rgba(255,255,255,0.06); color: rgba(230,237,243,0.3); border: 1px solid rgba(255,255,255,0.1); cursor: default; }
.badge.mem.on { background: rgba(163,230,53,0.12); color: #a3e635; border-color: rgba(163,230,53,0.3); }
.badge.shift { background: rgba(255,255,255,0.06); color: rgba(230,237,243,0.45); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; }
.badge.shift:hover { background: rgba(255,255,255,0.1); }
.badge.shift.on { background: rgba(56,189,248,0.15); color: #38bdf8; border-color: rgba(56,189,248,0.35); }
.hist-toggle {
  margin-left: auto;
  width: 26px; height: 26px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 7px;
  color: rgba(230,237,243,0.4);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; padding: 0;
}
.hist-toggle svg { width: 13px; height: 13px; }
.hist-toggle:hover,
.hist-toggle.on { background: rgba(56,189,248,0.15); color: #38bdf8; border-color: rgba(56,189,248,0.3); }
.expr-row {
  font-size: 12px;
  color: rgba(230,237,243,0.28);
  text-align: right;
  height: 17px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.main-num {
  height: 58px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  font-weight: 300;
  letter-spacing: -0.5px;
  line-height: 1.15;
  transition: font-size 0.15s ease;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  color: #f0f6fc;
}

/* ── shared button base ── */
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-weight: 400;
  transition: filter 0.08s, transform 0.08s;
  position: relative;
  overflow: hidden;
}
.btn:active, .btn.rip { transform: scale(0.91); filter: brightness(1.3); }

/* ripple ring */
.btn::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgba(255,255,255,0);
  transition: background 0.12s;
}
.btn:hover::after { background: rgba(255,255,255,0.06); }
.btn.rip::after   { background: rgba(255,255,255,0.14); }

/* ── scientific grid ── */
.sci-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.04);
  min-height: 0;
}

.mem-btn {
  background: #161b22;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: rgba(163,230,53,0.7);
}
.mem-btn:hover::after { background: rgba(163,230,53,0.06); }

.sci-btn {
  background: #161b22;
  font-size: 17px;
  color: rgba(186,230,253,0.75);
}

.const-btn {
  background: #161b22;
  font-size: 21px;
  color: #6ee7b7;
  font-style: italic;
}

/* ── number pad ── */
.num-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(5, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.04);
  min-height: 0;
}

.dig-btn {
  background: #1c2128;
  font-size: 20px;
  color: #f0f6fc;
}

.op-btn {
  background: #1f2937;
  font-size: 20px;
  color: #60a5fa;
  font-weight: 300;
}

.util-btn {
  background: #21262d;
  font-size: 17px;
  color: rgba(230,237,243,0.7);
  font-weight: 500;
}
.util-btn.red  { color: #f87171; }
.util-btn.red:hover::after  { background: rgba(248,113,113,0.08); }
.util-btn.back { color: #fca5a5; font-size: 19px; }

.eq-btn {
  background: linear-gradient(145deg, #1d4ed8, #4f46e5);
  font-size: 24px;
  font-weight: 300;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
}
.eq-btn:hover::after { background: rgba(255,255,255,0.1); }

.dig-btn.zero { grid-column: span 2; font-size: 20px; justify-content: flex-start; padding-left: 28%; }</style>
