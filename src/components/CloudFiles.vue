<script setup>
import { ref, computed, onMounted, onErrorCaptured, inject, markRaw, defineAsyncComponent } from 'vue'
import FileViewer from './FileViewer.vue'
import PDFViewer from './PDFViewer.vue'

const FileViewerRaw = markRaw(FileViewer)
const PDFViewerRaw  = markRaw(PDFViewer)
const WordViewerRaw  = markRaw(defineAsyncComponent(() => import('./WordViewer.vue')))
const ExcelViewerRaw = markRaw(defineAsyncComponent(() => import('./ExcelViewer.vue')))
const PptxViewerRaw  = markRaw(defineAsyncComponent(() => import('./PptxViewer.vue')))

// ── state ──
const openWindow   = inject('openWindow')
const updateWindow = inject('updateWindow')
const windows      = inject('windows')
const authFetch = inject('authFetch')
const authToken = inject('authToken')

function mimeToIcon(mime) {
  if (mime?.startsWith('image/')) return '🖼'
  if (mime?.startsWith('video/')) return '🎬'
  if (mime?.startsWith('audio/')) return '🎵'
  if (mime?.startsWith('text/'))  return '📝'
  if (mime?.includes('pdf'))     return '📕'
  return '📄'
}

function openWordViewer(fileUrl, fileName) {
  const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName
  openWindow({
    title: shortName,
    icon: '📝', width: 900, height: 720,
    component: WordViewerRaw,
    props: { fileUrl, fileName: shortName },
  })
}

function openExcelViewer(fileUrl, fileName) {
  const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName
  openWindow({
    title: shortName,
    icon: '📊', width: 960, height: 680,
    component: ExcelViewerRaw,
    props: { fileUrl, fileName: shortName },
  })
}

function openPptxViewer(fileUrl, fileName) {
  const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName
  openWindow({
    title: shortName,
    icon: '📽', width: 960, height: 700,
    component: PptxViewerRaw,
    props: { fileUrl, fileName: shortName },
  })
}

function openFileViewer(fileUrl, fileName, mimeType, fileList = [], currentIndex = -1) {
  const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName
  let winId = null
  winId = openWindow({
    title: shortName, icon: mimeToIcon(mimeType),
    width: 800, height: 600,
    component: FileViewerRaw,
    props: { fileUrl, fileName: shortName, mimeType, fileList, currentIndex,
             onNavigate: (i) => navigateFileViewer(winId, i) },
  })
}

function openPDFViewer(fileUrl, fileName) {
  const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName
  openWindow({
    title: shortName,
    icon: '📕', width: 900, height: 700,
    component: PDFViewerRaw,
    props: { fileUrl, fileName: shortName },
  })
}

function navigateFileViewer(winId, newIndex) {
  const win = windows.value.find(w => w.id === winId)
  if (!win?.props?.fileList || newIndex < 0 || newIndex >= win.props.fileList.length) return
  const f = win.props.fileList[newIndex]
  const shortName = f.name.length > 40 ? f.name.slice(0, 37) + '...' : f.name
  updateWindow(winId, {
    title: shortName, icon: mimeToIcon(f.mime),
    props: { fileUrl: f.url, fileName: shortName, mimeType: f.mime, currentIndex: newIndex },
  })
}

// Build a raw file URL, appending ?token= for routes that need auth
// but are accessed via <img src>, <video src>, <a href> (can't set headers)
function rawUrl(fileName) {
  const base = `/api/files/raw/${encodeURIComponent(fileName)}`
  const t = authToken?.value
  return t ? `${base}?token=${encodeURIComponent(t)}` : base
}
const files = ref([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const sharedFolders = ref([])
const currentFolder = ref(null)  // null = default storage, or folder id
const currentPath = ref('')  // current subpath within shared folder

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

function fileTypeIcon(mime, type) {
  if (type === 'folder' || mime === 'folder') return '📁'
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml')) return '📝'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('rar') || mime.includes('7z')) return '📦'
  return '📄'
}


function isWord(mime) {
  if (!mime) return false
  return mime.includes('wordprocessingml') || mime === 'application/msword'
}

function isExcel(mime) {
  if (!mime) return false
  return mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel'
}

function isPptx(mime) {
  if (!mime) return false
  return mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint'
}

function isImage(mime) { return mime && mime.startsWith('image/') }
function isText(mime) {
  if (!mime) return false
  if (mime.startsWith('application/vnd.')) return false
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml') || mime.includes('yaml')
}
function isVideo(mime) { return mime && mime.startsWith('video/') }
function isAudio(mime) { return mime && mime.startsWith('audio/') }
function isPDF(mime) { return mime && mime.includes('pdf') }

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
    let url
    if (currentFolder.value) {
      url = `/api/shared-folders/${currentFolder.value}/files`
      if (currentPath.value) {
        url += `?path=${encodeURIComponent(currentPath.value)}`
      }
    } else {
      url = '/api/files'
    }
    const res = await authFetch(url)
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
  currentPath.value = ''
  fetchFiles()
}

function navigateToSubfolder(folderName) {
  if (currentPath.value) {
    currentPath.value = currentPath.value + '/' + folderName
  } else {
    currentPath.value = folderName
  }
  fetchFiles()
}

function navigateToBreadcrumb(index) {
  if (index === -1) {
    currentPath.value = ''
  } else {
    const parts = currentPath.value.split('/')
    currentPath.value = parts.slice(0, index + 1).join('/')
  }
  fetchFiles()
}

const breadcrumbs = computed(() => {
  if (!currentPath.value) return []
  return currentPath.value.split('/')
})

async function uploadFiles(fileList) {
  const arr = Array.from(fileList)
  uploadProgress.value = arr.map(f => ({ name: f.name, done: false, error: '' }))
  for (let i = 0; i < arr.length; i++) {
    const fd = new FormData()
    fd.append('file', arr[i])
    try {
      const res = await authFetch('/api/files/upload', { method: 'POST', body: fd })
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
    const res = await authFetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
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
  let url
  if (currentFolder.value) {
    const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    url = `/api/shared-folders/${currentFolder.value}/raw/${filePath}`
  } else {
    url = rawUrl(file.name)
  }
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
    const res = await authFetch('/api/files/rename', {
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
  // If it's a folder, navigate into it
  if (file.type === 'folder') {
    navigateToSubfolder(file.name)
    return
  }

  let fileUrl
  if (currentFolder.value) {
    const filePath = currentPath.value ? `${currentPath.value}/${file.name}` : file.name
    fileUrl = `/api/shared-folders/${currentFolder.value}/raw/${filePath}`
  } else {
    fileUrl = rawUrl(file.name)
  }

  // Open PDF in PDF viewer
  if (isPDF(file.mime)) {
    openPDFViewer(fileUrl, file.name)
    return
  }

  // Open Word documents in word viewer
  if (isWord(file.mime)) {
    openWordViewer(fileUrl, file.name)
    return
  }

  // Open Excel files in excel viewer
  if (isExcel(file.mime)) {
    openExcelViewer(fileUrl, file.name)
    return
  }

  // Open PPTX files in pptx viewer
  if (isPptx(file.mime)) {
    openPptxViewer(fileUrl, file.name)
    return
  }

  // Open image, text, video, audio in file viewer
  if (isImage(file.mime) || isText(file.mime) || isVideo(file.mime) || isAudio(file.mime)) {
    if (openFileViewer) {
      // Build file list for navigation (only include previewable files)
      const previewableFiles = files.value
        .filter(f => f.type !== 'folder' && (isImage(f.mime) || isText(f.mime) || isVideo(f.mime) || isAudio(f.mime)))
        .map(f => {
          let url
          if (currentFolder.value) {
            const filePath = currentPath.value ? `${currentPath.value}/${f.name}` : f.name
            url = `/api/shared-folders/${currentFolder.value}/raw/${filePath}`
          } else {
            url = rawUrl(f.name)
          }
          return { name: f.name, url, mime: f.mime }
        })

      const currentIndex = previewableFiles.findIndex(f => f.name === file.name)
      openFileViewer(fileUrl, file.name, file.mime, previewableFiles, currentIndex)
    }
    return
  }

  // For other file types, show preview modal
  preview.value = { file, fileUrl }
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

    <!-- breadcrumb navigation -->
    <div class="cf-breadcrumb" v-if="currentFolder && (currentPath || breadcrumbs.length)">
      <span class="cf-breadcrumb-item" @click="navigateToBreadcrumb(-1)">根目录</span>
      <span class="cf-breadcrumb-sep" v-if="breadcrumbs.length">/</span>
      <template v-for="(crumb, index) in breadcrumbs" :key="index">
        <span class="cf-breadcrumb-item" @click="navigateToBreadcrumb(index)">{{ crumb }}</span>
        <span class="cf-breadcrumb-sep" v-if="index < breadcrumbs.length - 1">/</span>
      </template>
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
        <span class="col-icon">{{ fileTypeIcon(file.mime, file.type) }}</span>
        <span class="col-name">
          <template v-if="renaming === file.name && file.type !== 'folder'">
            <input
              class="cf-rename-input"
              v-model="renameVal"
              @keydown.enter="confirmRename(file.name)"
              @blur="confirmRename(file.name)"
              @keydown.esc="renaming = null"
              autofocus
            />
          </template>
          <span v-else class="cf-filename" @click="openPreview(file)" :class="{ 'cf-folder': file.type === 'folder' }">{{ file.name }}</span>
        </span>
        <span class="col-size">{{ file.type === 'folder' ? '-' : formatSize(file.size) }}</span>
        <span class="col-time">{{ formatDate(file.mtime) }}</span>
        <span class="col-ops">
          <button v-if="file.type !== 'folder'" class="cf-op-btn" @click="downloadFile(file)" title="下载">⬇</button>
          <button v-if="file.type !== 'folder'" class="cf-op-btn" @click="startRename(file.name)" title="重命名" :disabled="currentFolder !== null">✏</button>
          <button v-if="file.type !== 'folder'" class="cf-op-btn danger" @click="deleteFile(file.name)" title="删除" :disabled="currentFolder !== null">🗑</button>
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
          <img v-if="file.type !== 'folder' && isImage(file.mime)" :src="currentFolder ? `/api/shared-folders/${currentFolder}/raw/${currentPath ? currentPath + '/' : ''}${file.name}` : rawUrl(file.name)" :alt="file.name" />
          <span v-else class="cf-grid-type-icon">{{ fileTypeIcon(file.mime, file.type) }}</span>
        </div>
        <div class="cf-grid-info">
          <template v-if="renaming === file.name && file.type !== 'folder'">
            <input
              class="cf-rename-input"
              v-model="renameVal"
              @keydown.enter="confirmRename(file.name)"
              @blur="confirmRename(file.name)"
              @keydown.esc="renaming = null"
              autofocus
            />
          </template>
          <span v-else class="cf-grid-name" @click="openPreview(file)" :title="file.name" :class="{ 'cf-folder': file.type === 'folder' }">{{ file.name }}</span>
          <div class="cf-grid-ops" v-if="file.type !== 'folder'">
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
            <div>{{ fileTypeIcon(preview.file.mime, preview.file.type) }}</div>
            <div>此文件类型不支持预览</div>
            <a :href="preview.fileUrl" target="_blank" class="cf-btn primary cf-dl-link">下载文件</a>
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

/* ── breadcrumb ── */
.cf-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  font-size: 13px;
  flex-shrink: 0;
  overflow-x: auto;
}

.cf-breadcrumb-item {
  color: #79c0ff;
  cursor: pointer;
  white-space: nowrap;
}

.cf-breadcrumb-item:hover {
  text-decoration: underline;
}

.cf-breadcrumb-item:last-child {
  color: #e6edf3;
  font-weight: 500;
  cursor: default;
}

.cf-breadcrumb-item:last-child:hover {
  text-decoration: none;
}

.cf-breadcrumb-sep {
  color: #8b949e;
}

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

.cf-filename.cf-folder {
  color: #e6edf3;
  font-weight: 500;
}

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

.cf-grid-name.cf-folder {
  color: #e6edf3;
  font-weight: 500;
}

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
