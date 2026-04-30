<script setup>
import { ref, inject, onMounted } from 'vue'

const authToken = inject('authToken')
const authFetch = inject('authFetch')
const refreshWallpaper = inject('refreshWallpaper')

const menuItems = [
  { id: 'wallpaper', label: '壁纸设置', icon: '🖼️' },
]
const activeMenu = ref('wallpaper')

// ── 壁纸相关 ──
const wallpapers = ref([])
const currentWallpaperId = ref(null)
const uploading = ref(false)

async function loadWallpapers() {
  try {
    const [listRes, curRes] = await Promise.all([
      authFetch('/api/wallpaper'),
      authFetch('/api/wallpaper/current'),
    ])
    if (listRes.ok) wallpapers.value = await listRes.json()
    if (curRes.ok) {
      const data = await curRes.json()
      currentWallpaperId.value = data.current?.id ?? null
    }
  } catch (e) {
    console.warn('加载壁纸失败:', e)
  }
}

async function uploadWallpaper(e) {
  const file = e.target.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await authFetch('/api/wallpaper/upload', { method: 'POST', body: form })
    if (res.ok) {
      await loadWallpapers()
    }
  } catch (err) {
    console.warn('上传失败:', err)
  } finally {
    uploading.value = false
    e.target.value = ''
  }
}

async function setWallpaper(id) {
  try {
    const res = await authFetch(`/api/wallpaper/current/${id}`, { method: 'PUT' })
    if (res.ok) {
      currentWallpaperId.value = id
      // 通知 App.vue 刷新壁纸
      if (refreshWallpaper) refreshWallpaper()
    }
  } catch (e) {
    console.warn('设置壁纸失败:', e)
  }
}

async function clearWallpaper() {
  try {
    const res = await authFetch('/api/wallpaper/clear', { method: 'PUT' })
    if (res.ok) {
      currentWallpaperId.value = null
      if (refreshWallpaper) refreshWallpaper()
    }
  } catch (e) {
    console.warn('清除壁纸失败:', e)
  }
}

async function deleteWallpaper(id) {
  try {
    const res = await authFetch(`/api/wallpaper/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await loadWallpapers()
    }
  } catch (e) {
    console.warn('删除壁纸失败:', e)
  }
}

onMounted(loadWallpapers)
</script>

<template>
  <div class="settings">
    <!-- 左侧菜单 -->
    <nav class="settings-sidebar">
      <button
        v-for="item in menuItems"
        :key="item.id"
        class="menu-item"
        :class="{ active: activeMenu === item.id }"
        @click="activeMenu = item.id"
      >
        <span class="menu-icon">{{ item.icon }}</span>
        <span class="menu-label">{{ item.label }}</span>
      </button>
    </nav>

    <!-- 右侧内容 -->
    <div class="settings-content">
      <!-- 壁纸设置 -->
      <div v-if="activeMenu === 'wallpaper'" class="wallpaper-panel">
        <div class="panel-header">
          <h3>壁纸设置</h3>
          <div class="panel-actions">
            <label class="upload-btn" :class="{ disabled: uploading }">
              <input
                type="file"
                accept="image/*"
                @change="uploadWallpaper"
                :disabled="uploading"
              />
              {{ uploading ? '上传中...' : '+ 上传壁纸' }}
            </label>
            <button
              v-if="currentWallpaperId"
              class="clear-btn"
              @click="clearWallpaper"
            >恢复默认</button>
          </div>
        </div>

        <div v-if="wallpapers.length === 0" class="empty-state">
          <span class="empty-icon">🖼️</span>
          <p>还没有壁纸，上传一张试试</p>
        </div>

        <div v-else class="wallpaper-grid">
          <div
            v-for="wp in wallpapers"
            :key="wp.id"
            class="wallpaper-item"
            :class="{ active: currentWallpaperId === wp.id }"
            @click="setWallpaper(wp.id)"
          >
            <img
              :src="`/api/wallpaper/image/${wp.id}?token=${authToken}`"
              :alt="wp.file_name"
              loading="lazy"
            />
            <div class="wallpaper-overlay">
              <span v-if="currentWallpaperId === wp.id" class="current-badge">当前</span>
              <button
                class="delete-btn"
                @click.stop="deleteWallpaper(wp.id)"
                title="删除"
              >×</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  height: 100%;
  background: #1a1d2e;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
}

/* ── 侧边栏 ── */
.settings-sidebar {
  width: 160px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.2);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  white-space: nowrap;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
}

.menu-item.active {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}

.menu-icon {
  font-size: 18px;
  line-height: 1;
}

/* ── 内容区 ── */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  padding: 7px 16px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.3);
  border: 1px solid rgba(99, 102, 241, 0.5);
  color: #a5b4fc;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.upload-btn:hover {
  background: rgba(99, 102, 241, 0.45);
}

.upload-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upload-btn input {
  display: none;
}

.clear-btn {
  padding: 7px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.4);
  color: #f87171;
}

/* ── 空状态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.35);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

/* ── 壁纸网格 ── */
.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.wallpaper-item {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.wallpaper-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wallpaper-item:hover {
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-2px);
}

.wallpaper-item.active {
  border-color: #6366f1;
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.4);
}

.wallpaper-overlay {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 6px;
}

.current-badge {
  background: rgba(99, 102, 241, 0.85);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
}

.delete-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wallpaper-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.8);
}
</style>
