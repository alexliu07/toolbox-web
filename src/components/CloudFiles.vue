<script setup>
import { ref, computed, onMounted, onErrorCaptured, inject } from 'vue'

// ── state ──
const openPDFViewer = inject('openPDFViewer')
const openFileViewer = inject('openFileViewer')
const files = ref([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const sharedFolders = ref([])
const currentFolder = ref(null)  // null = default storage, or folder id

function safeLocalStorage(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function safeLocalStorageSet(key, val) {
  try { localStorage.setItem(key, val) } catch {}
}

const viewMode = ref(safeLocalStorage('cloudfiles-view', 'list'))

// preview (for unsupported file types)
const preview = ref(null)

// rename
const renaming = ref(null)  // file name being renamed
const renameVal = ref('')

// upload
const isDragging = ref(false)
const uploadProgress = ref([])  // [{ name, done }]
const fileInput = ref(null)

// ── computed ──
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return files.value
  return files.value.filter(f => f.name.toLowerCase().includes(q))
})

// ── helpers ──
function setView(mode) {
  viewMode.value = mode
  safeLocalStorageSet('cloudfiles-view', mode)
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function formatDate(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function fileTypeIcon(mime) {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml')) return '📝'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('rar') || mime.includes('7z')) return '📦'
  return '📄'
}

function isPDF(mime) { return mime && mime.includes('pdf') }

function isImage(mime) { return mime && mime.startsWith('image/') }
function isText(mime) {
  if (!mime) return false
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml') || mime.includes('yaml')
}
function isVideo(mime) { return mime && mime.startsWith('video/') }
function isAudio(mime) { return mime && mime.startsWith('audio/') }

// ── API calls ──
async function fetchSharedFolders() {
  try {
    const res = await fetch('/api/shared-folders')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    sharedFolders.value = await res.json()
  } catch (e) {
    console.error('fetchSharedFolders error:', e)
  }
}

async function fetchFiles() {
  loading.value = true
  error.value = ''
  try {
    const url = currentFolder.value
      ? `/api/shared-folders/${currentFolder.value}/files`
      : '/api/files'
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    files.value = await res.json()
  } catch (e) {
    const msg = e?.message || e?.name || JSON.stringify(e) || '未知错误'
    error.value = '加载文件列表失败：' + msg + ' | ' + (e?.stack?.split('\n')[0] || '')
    console.error('fetchFiles error:', e, 'type:', typeof e, 'keys:', Object.keys(e || {}))
  } finally {
    loading.value = false
  }
}

function selectFolder(folderId) {
  currentFolder.value = folderId
  fetchFiles()
}

async function uploadFiles(fileList) {
  const arr = Array.from(fileList)
  uploadProgress.value = arr.map(f => ({ name: f.name, done: false, error: '' }))
  for (let i = 0; i < arr.length; i++) {
    const fd = new FormData()
    fd.append('file', arr[i])
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json()
        uploadProgress.value[i].error = body.error || 'Upload failed'
      } else {
        uploadProgress.value[i].done = true
      }
    } catch (e) {
      uploadProgress.value[i].error = e.message
    }
  }
  await fetchFiles()
  setTimeout(() => { uploadProgress.value = [] }, 2000)
}

async function deleteFile(name) {
  if (!confirm(`确认删除文件 "${name}"？`)) return
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json()
      alert(body.error || '删除失败')
      return
    }
    files.value = files.value.filter(f => f.name !== name)
  } catch (e) {
    alert('删除失败：' + e.message)
  }
}

function downloadFile(file) {
  const link = document.createElement('a')
  const url = currentFolder.value
    ? `/api/shared-folders/${currentFolder.value}/raw/${encodeURIComponent(file.name)}`
    : `/api/files/raw/${encodeURIComponent(file.name)}`
  link.href = url
  link.download = file.name
  link.click()
}

function startRename(name) {
  renaming.value = name
  renameVal.value = name
}

async function confirmRename(oldName) {
  const newName = renameVal.value.trim()
  renaming.value = null
  if (!newName || newName === oldName) return
  try {
    const res = await fetch('/api/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName }),
    })
    const body = await res.json()
    if (!res.ok) { alert(body.error || '重命名失败'); return }
    await fetchFiles()
  } catch (e) {
    alert('重命名失败：' + e.message)
  }
}

async function openPreview(file) {
  const fileUrl = currentFolder.value
    ? `/api/shared-folders/${currentFolder.value}/raw/${encodeURIComponent(file.name)}`
    : `/api/files/raw/${encodeURIComponent(file.name)}`

  // Open PDF in PDF viewer
  if (isPDF(file.mime)) {
    if (openPDFViewer) {
      openPDFViewer(fileUrl, file.name)
    }
    return
  }

  // Open image, text, video, audio in file viewer
  if (isImage(file.mime) || isText(file.mime) || isVideo(file.mime) || isAudio(file.mime)) {
    if (openFileViewer) {
      openFileViewer(fileUrl, file.name, file.mime)
    }
    return
  }

  // For other file types, show preview modal
  preview.value = { file }
}

function closePreview() { preview.value = null }

// ── drag-drop ──
function onDragOver(e) { e.preventDefault(); isDragging.value = true }
function onDragLeave() { isDragging.value = false }
function onDrop(e) {
  e.preventDefault()
  isDragging.value = false
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
}

function onFileInputChange(e) {
  if (e.target.files.length) uploadFiles(e.target.files)
  e.target.value = ''
}

onMounted(() => {
  fetchSharedFolders()
  fetchFiles().catch(e => {
    const msg = e?.message || e?.name || JSON.stringify(e) || '未知错误'
    error.value = '加载文件列表失败：' + msg
    loading.value = false
    console.error('onMounted fetchFiles catch:', e)
  })
})

onErrorCaptured((e) => {
  const msg = e?.message || e?.name || JSON.stringify(e) || '未知错误'
  error.value = '组件错误：' + msg
  loading.value = false
  console.error('onErrorCaptured:', e)
  return false
})
</script>

<template>
  <div
    class="cf"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    :class="{ dragging: isDragging }"
  >
    <!-- sidebar -->
    <div class="cf-sidebar">
      <div class="cf-sidebar-title">文件夹</div>
      <div
        class="cf-sidebar-item"
        :class="{ active: currentFolder === null }"
        @click="selectFolder(null)"
      >
        <span class="cf-sidebar-icon">☁</span>
        <span class="cf-sidebar-name">云存储</span>
      </div>
      <div
        v-for="folder in sharedFolders"
        :key="folder.id"
        class="cf-sidebar-item"
        :class="{ active: currentFolder === folder.id }"
        @click="selectFolder(folder.id)"
      >
        <span class="cf-sidebar-icon">{{ folder.icon || '📁' }}</span>
        <span class="cf-sidebar-name">{{ folder.name }}</span>
      </div>
    </div>

    <!-- main content -->
    <div class="cf-main">
    <!-- toolbar -->
    <div class="cf-toolbar">
      <button class="cf-btn primary" @click="fileInput.click()" :disabled="currentFolder !== null">+ 上传文件</button>
      <input ref="fileInput" type="file" multiple style="display:none" @change="onFileInputChange" />
      <input class="cf-search" v-model="search" placeholder="搜索文件名…" />
      <div class="cf-spacer" />
      <button class="cf-view-btn" :class="{ active: viewMode === 'list' }" @click="setView('list')" title="列表视图">☰</button>
      <button class="cf-view-btn" :class="{ active: viewMode === 'grid' }" @click="setView('grid')" title="网格视图">⊞</button>
    </div>

    <!-- upload progress -->
    <div class="cf-upload-bar" v-if="uploadProgress.length">
      <div v-for="item in uploadProgress" :key="item.name" class="cf-upload-item">
        <span class="cf-upload-name">{{ item.name }}</span>
        <span v-if="item.done" class="cf-upload-ok">✓</span>
        <span v-else-if="item.error" class="cf-upload-err">✗ {{ item.error }}</span>
        <span v-else class="cf-upload-spin">…</span>
      </div>
    </div>

    <!-- error -->
    <div class="cf-error" v-if="error">{{ error }} <button @click="fetchFiles">重试</button></div>

    <!-- loading -->
    <div class="cf-loading" v-if="loading">加载中…</div>

    <!-- empty -->
    <div class="cf-empty" v-else-if="!loading && filtered.length === 0 && !error">
      <div class="cf-empty-icon">☁</div>
      <div>{{ search ? '没有匹配的文件' : '拖拽文件到此处上传' }}</div>
    </div>

    <!-- list view -->
    <div v-else-if="viewMode === 'list'" class="cf-list">
      <div class="cf-list-header">
        <span class="col-icon"></span>
        <span class="col-name">文件名</span>
        <span class="col-size">大小</span>
        <span class="col-time">修改时间</span>
        <span class="col-ops"></span>
      </div>
      <div
        v-for="file in filtered"
        :key="file.name"
        class="cf-list-row"
      >
        <span class="col-icon">{{ fileTypeIcon(file.mime) }}</span>
        <span class="col-name">
          <template v-if="renaming === file.name">
            <input
              class="cf-rename-input"
              v-model="renameVal"
              @keydown.enter="confirmRename(file.name)"
              @blur="confirmRename(file.name)"
              @keydown.esc="renaming = null"
              autofocus
            />
          </template>
          <span v-else class="cf-filename" @click="openPreview(file)">{{ file.name }}</span>
        </span>
        <span class="col-size">{{ formatSize(file.size) }}</span>
        <span class="col-time">{{ formatDate(file.mtime) }}</span>
        <span class="col-ops">
          <button class="cf-op-btn" @click="downloadFile(file)" title="下载">⬇</button>
          <button class="cf-op-btn" @click="startRename(file.name)" title="重命名" :disabled="currentFolder !== null">✏</button>
          <button class="cf-op-btn danger" @click="deleteFile(file.name)" title="删除" :disabled="currentFolder !== null">🗑</button>
        </span>
      </div>
    </div>

    <!-- grid view -->
    <div v-else class="cf-grid">
      <div
        v-for="file in filtered"
        :key="file.name"
        class="cf-grid-item"
      >
        <div class="cf-grid-thumb" @click="openPreview(file)">
          <img v-if="isImage(file.mime)" :src="currentFolder ? `/api/shared-folders/${currentFolder}/raw/${encodeURIComponent(file.name)}` : `/api/files/raw/${encodeURIComponent(file.name)}`" :alt="file.name" />
          <span v-else class="cf-grid-type-icon">{{ fileTypeIcon(file.mime) }}</span>
        </div>
        <div class="cf-grid-info">
          <template v-if="renaming === file.name">
            <input
              class="cf-rename-input"
              v-model="renameVal"
              @keydown.enter="confirmRename(file.name)"
              @blur="confirmRename(file.name)"
              @keydown.esc="renaming = null"
              autofocus
            />
          </template>
          <span v-else class="cf-grid-name" @click="openPreview(file)" :title="file.name">{{ file.name }}</span>
          <div class="cf-grid-ops">
            <button class="cf-op-btn" @click="downloadFile(file)" title="下载">⬇</button>
            <button class="cf-op-btn" @click="startRename(file.name)" title="重命名" :disabled="currentFolder !== null">✏</button>
            <button class="cf-op-btn danger" @click="deleteFile(file.name)" title="删除" :disabled="currentFolder !== null">🗑</button>
          </div>
        </div>
      </div>
    </div>

    <!-- drag overlay -->
    <div class="cf-drag-overlay" v-if="isDragging">
      <div class="cf-drag-text">释放以上传文件</div>
    </div>

    <!-- preview modal for unsupported files -->
    <div class="cf-modal-backdrop" v-if="preview" @click.self="closePreview">
      <div class="cf-modal">
        <div class="cf-modal-header">
          <span>{{ preview.file.name }}</span>
          <button class="cf-modal-close" @click="closePreview">✕</button>
        </div>
        <div class="cf-modal-body">
          <div class="cf-preview-unsupported">
            <div>{{ fileTypeIcon(preview.file.mime) }}</div>
            <div>此文件类型不支持预览</div>
            <a :href="currentFolder ? `/api/shared-folders/${currentFolder}/raw/${encodeURIComponent(preview.file.name)}` : `/api/files/raw/${encodeURIComponent(preview.file.name)}`" target="_blank" class="cf-btn primary cf-dl-link">下载文件</a>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* ── layout ── */
.cf {
  position: relative;
  display: flex;
  height: 100%;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  overflow: hidden;
}

.cf-sidebar {
  width: 180px;
  background: #161b22;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}

.cf-sidebar-title {
  padding: 12px 14px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8b949e;
  font-weight: 600;
}

.cf-sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 3px solid transparent;
}

.cf-sidebar-item:hover {
  background: #0d1117;
}

.cf-sidebar-item.active {
  background: #0d1117;
  border-left-color: #1a8fe3;
}

.cf-sidebar-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.cf-sidebar-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.cf-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cf.dragging::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 3px dashed #1a8fe3;
  border-radius: 8px;
  pointer-events: none;
  z-index: 50;
}

/* ── toolbar ── */
.cf-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.cf-btn {
  padding: 6px 14px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #e6edf3;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.cf-btn:hover { background: #30363d; }

.cf-btn.primary {
  background: #1a8fe3;
  border-color: #1a8fe3;
  color: #fff;
}

.cf-btn.primary:hover { background: #1479c9; }
.cf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cf-btn.primary:disabled:hover { background: #1a8fe3; }

.cf-search {
  flex: 1;
  max-width: 260px;
  padding: 5px 10px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  outline: none;
}

.cf-search:focus { border-color: #1a8fe3; }

.cf-spacer { flex: 1; }

.cf-view-btn {
  padding: 5px 10px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #8b949e;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.cf-view-btn:hover { color: #e6edf3; }
.cf-view-btn.active { background: #1a8fe3; border-color: #1a8fe3; color: #fff; }

/* ── upload progress ── */
.cf-upload-bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.cf-upload-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8b949e;
}

.cf-upload-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cf-upload-ok { color: #3fb950; }
.cf-upload-err { color: #f85149; }
.cf-upload-spin { color: #8b949e; }

/* ── messages ── */
.cf-error {
  padding: 12px 14px;
  background: rgba(248, 81, 73, 0.1);
  border-bottom: 1px solid rgba(248, 81, 73, 0.3);
  color: #f85149;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.cf-error button {
  padding: 3px 10px;
  border: 1px solid #f85149;
  border-radius: 4px;
  background: none;
  color: #f85149;
  cursor: pointer;
  font-size: 12px;
}

.cf-loading, .cf-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #484f58;
  gap: 12px;
}

.cf-empty-icon { font-size: 48px; }

/* ── list view ── */
.cf-list {
  flex: 1;
  overflow-y: auto;
}

.cf-list-header {
  display: grid;
  grid-template-columns: 24px 1fr 80px 150px 80px;
  gap: 8px;
  padding: 8px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  color: #8b949e;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
}

.cf-list-row {
  display: grid;
  grid-template-columns: 24px 1fr 80px 150px 80px;
  gap: 8px;
  align-items: center;
  padding: 7px 14px;
  border-bottom: 1px solid #21262d;
  transition: background 0.15s;
}

.cf-list-row:hover { background: #161b22; }

.col-icon { font-size: 15px; text-align: center; }
.col-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-size { color: #8b949e; text-align: right; }
.col-time { color: #8b949e; font-size: 12px; }
.col-ops { display: flex; gap: 4px; justify-content: flex-end; }

.cf-filename {
  cursor: pointer;
  color: #79c0ff;
}

.cf-filename:hover { text-decoration: underline; }

/* ── grid view ── */
.cf-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  padding: 14px;
  align-content: start;
}

.cf-grid-item {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  overflow: hidden;
  cursor: default;
  transition: border-color 0.15s;
}

.cf-grid-item:hover { border-color: #1a8fe3; }

.cf-grid-thumb {
  width: 100%;
  aspect-ratio: 1;
  background: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}

.cf-grid-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s;
}

.cf-grid-thumb:hover img { transform: scale(1.05); }

.cf-grid-type-icon { font-size: 40px; }

.cf-grid-info {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cf-grid-name {
  display: block;
  font-size: 12px;
  color: #79c0ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.cf-grid-name:hover { text-decoration: underline; }

.cf-grid-ops {
  display: flex;
  gap: 4px;
}

/* ── op buttons ── */
.cf-op-btn {
  padding: 3px 7px;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: #21262d;
  color: #8b949e;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.cf-op-btn:hover { background: #30363d; color: #e6edf3; }
.cf-op-btn.danger:hover { background: rgba(248, 81, 73, 0.2); border-color: #f85149; color: #f85149; }
.cf-op-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cf-op-btn:disabled:hover { background: #21262d; color: #8b949e; border-color: #30363d; }

/* ── rename input ── */
.cf-rename-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid #1a8fe3;
  border-radius: 4px;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  outline: none;
}

/* ── drag overlay ── */
.cf-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(26, 143, 227, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  pointer-events: none;
}

.cf-drag-text {
  font-size: 22px;
  font-weight: 600;
  color: #1a8fe3;
  background: rgba(13, 17, 23, 0.85);
  padding: 20px 40px;
  border-radius: 12px;
  border: 2px dashed #1a8fe3;
}

/* ── modal ── */
.cf-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.cf-modal {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  max-width: min(90%, 820px);
  max-height: 85%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cf-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #30363d;
  font-weight: 500;
  color: #e6edf3;
  flex-shrink: 0;
  overflow: hidden;
}

.cf-modal-header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cf-modal-close {
  background: none;
  border: none;
  color: #8b949e;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.cf-modal-close:hover { background: #30363d; color: #e6edf3; }

.cf-modal-body {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 0;
}

.cf-preview-loading {
  color: #8b949e;
}

.cf-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.cf-preview-text {
  width: 100%;
  height: 100%;
  margin: 0;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #e6edf3;
  background: #0d1117;
  padding: 12px;
  border-radius: 6px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  align-self: stretch;
}

.cf-preview-video, .cf-preview-audio {
  max-width: 100%;
  max-height: 100%;
}

.cf-preview-unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8b949e;
  font-size: 18px;
}

.cf-preview-unsupported > :first-child { font-size: 56px; }

.cf-dl-link {
  text-decoration: none;
  font-size: 14px;
  margin-top: 4px;
}
</style>
