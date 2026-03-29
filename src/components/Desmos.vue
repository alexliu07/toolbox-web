<script>
export const appMeta = {
  // id和windowId相同
  id: 'desmos',
  name: 'Desmos',
  icon: '📈',
  gradient: 'linear-gradient(135deg,#0a7ea4,#05c3de)',
  order: 3,
}
export const windowMeta = {
  windowTitle: 'Desmos 图形计算器',
  windowIcon: '📈',
  width: 1000,
  height: 640,
  windowId: 'desmos',
}
</script>

<script setup>
import { ref, onMounted, onUnmounted, inject } from 'vue'

const iframeRef = ref(null)
const calcReady = ref(false)
const saveName = ref('')
const saves = ref([])
const showSaves = ref(false)
const saveStatus = ref('')   // '' | 'saving' | 'ok' | 'err'

const authFetch = inject('authFetch')

// ── poll for calc instance after iframe loads ──
let pollTimer = null

function onIframeLoad() {
  pollTimer = setInterval(() => {
    const calc = getCalc()
    if (calc) {
      clearInterval(pollTimer)
      calcReady.value = true
      loadSavesList()
    }
  }, 300)
  setTimeout(() => clearInterval(pollTimer), 15000)
}

function getCalc() {
  const iwin = iframeRef.value?.contentWindow
  if (!iwin) return null
  // Check known locations first
  for (const key of ['__desmos_calc', 'Calc', 'calc', 'calculator']) {
    try { if (iwin[key]?.getState && iwin[key]?.setState) return iwin[key] } catch {}
  }
  // Broad duck-type search as fallback
  for (const key of Object.getOwnPropertyNames(iwin)) {
    try {
      const v = iwin[key]
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          typeof v.getState === 'function' &&
          typeof v.setState === 'function' &&
          typeof v.setExpression === 'function') return v
    } catch {}
  }
  return null
}

// ── saves API ──
async function loadSavesList() {
  try {
    const res = await authFetch('/api/desmos')
    saves.value = await res.json()
  } catch { /* ignore */ }
}

async function saveGraph() {
  const calc = getCalc()
  if (!calc) return
  const name = saveName.value.trim() || '未命名'
  saveStatus.value = 'saving'
  try {
    const state = calc.getState()
    const res = await authFetch('/api/desmos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state }),
    })
    saveStatus.value = res.ok ? 'ok' : 'err'
    if (res.ok) await loadSavesList()
  } catch {
    saveStatus.value = 'err'
  }
  setTimeout(() => { saveStatus.value = '' }, 1800)
}

async function loadGraph(name) {
  const calc = getCalc()
  if (!calc) return
  try {
    const res = await authFetch(`/api/desmos/${encodeURIComponent(name)}`)
    const state = await res.json()
    calc.setState(state)
    saveName.value = name
    showSaves.value = false
  } catch { /* ignore */ }
}

async function deleteGraph(name) {
  if (!confirm(`删除存档 "${name}"？`)) return
  await authFetch(`/api/desmos/${encodeURIComponent(name)}`, { method: 'DELETE' })
  await loadSavesList()
}

function fmtDate(iso) {
  return iso.slice(0, 10)
}

onMounted(() => { /* iframe @load handles init */ })
onUnmounted(() => { clearInterval(pollTimer) })
</script>

<template>
  <div class="desmos-wrap">
    <!-- toolbar -->
    <div class="dbar">
      <input
        class="dbar-name"
        v-model="saveName"
        placeholder="图表名称…"
        @keydown.enter="saveGraph"
      />
      <button
        class="dbar-btn primary"
        :disabled="false"
        @click="saveGraph"
      >
        {{
          saveStatus === 'saving' ? '保存中…'
          : saveStatus === 'ok'   ? '✓ 已保存'
          : saveStatus === 'err'  ? '✗ 失败'
          : '💾 保存'
        }}
      </button>
      <button
        class="dbar-btn"
        @click="showSaves = !showSaves; if(showSaves) loadSavesList()"
      >
        📂 存档 <span class="badge">{{ saves.length }}</span>
      </button>
    </div>

    <!-- saves list -->
    <div class="saves-panel" v-if="showSaves">
      <div v-if="saves.length === 0" class="saves-empty">暂无存档</div>
      <div v-for="s in saves" :key="s.name" class="save-row">
        <span class="save-name" :title="s.name">{{ s.name }}</span>
        <span class="save-date">{{ fmtDate(s.mtime) }}</span>
        <button class="dbar-btn sm" @click="loadGraph(s.name)">加载</button>
        <button class="dbar-btn sm danger" @click="deleteGraph(s.name)">删除</button>
      </div>
    </div>

    <!-- desmos iframe -->
    <iframe
      ref="iframeRef"
      src="/desmos/index.html"
      class="desmos-frame"
@load="onIframeLoad"
    />
  </div>
</template>

<style scoped>
.desmos-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

/* ── toolbar ── */
.dbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: #1e1e2e;
  border-bottom: 1px solid #2e2e4a;
  flex-shrink: 0;
}

.dbar-name {
  flex: 1;
  max-width: 220px;
  padding: 4px 8px;
  border: 1px solid #3e3e5e;
  border-radius: 5px;
  background: #12121e;
  color: #e0e0f0;
  font-size: 13px;
  outline: none;
}
.dbar-name:focus { border-color: #6c63ff; }
.dbar-name::placeholder { color: #55556a; }

.dbar-btn {
  padding: 4px 12px;
  border: 1px solid #3e3e5e;
  border-radius: 5px;
  background: #2a2a40;
  color: #c0c0e0;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: background 0.12s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.dbar-btn:hover:not(:disabled) { background: #3a3a58; }
.dbar-btn:disabled { opacity: 0.5; cursor: default; }
.dbar-btn.primary { background: #4c3fff; border-color: #4c3fff; color: #fff; }
.dbar-btn.primary:hover:not(:disabled) { background: #5a4dff; }
.dbar-btn.sm { padding: 2px 8px; font-size: 12px; }
.dbar-btn.danger:hover { background: rgba(248,81,73,0.18); border-color: #f85149; color: #f85149; }

.badge {
  background: rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 0 5px;
  font-size: 11px;
}

/* ── saves list ── */
.saves-panel {
  background: #1a1a2c;
  border-bottom: 1px solid #2e2e4a;
  max-height: 190px;
  overflow-y: auto;
  flex-shrink: 0;
}
.saves-panel::-webkit-scrollbar { width: 4px; }
.saves-panel::-webkit-scrollbar-thumb { background: #3e3e5e; border-radius: 2px; }

.saves-empty {
  padding: 12px;
  color: #55556a;
  font-size: 13px;
  text-align: center;
}

.save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #242438;
  font-size: 13px;
  transition: background 0.12s;
}
.save-row:hover { background: #22223a; }
.save-name { flex: 1; color: #c0c0e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.save-date { color: #55556a; font-size: 11px; flex-shrink: 0; }

/* ── iframe ── */
.desmos-frame {
  flex: 1;
  width: 100%;
  border: none;
  display: block;
  min-height: 0;
}
</style>
