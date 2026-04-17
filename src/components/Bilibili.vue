<script setup>
import { ref, computed, onMounted, nextTick, inject, onUnmounted, shallowRef, markRaw } from 'vue'
import DPlayer from 'dplayer'

const authFetch = inject('authFetch')

const ROW_HEIGHT = 64
const PAGE_MIN = 5

const containerHeight = ref(500)
const containerRef = ref(null)
const listHeight = computed(() => Math.max(80, containerHeight.value - 50 - 56 - 32))
const pageSize = computed(() => Math.max(PAGE_MIN, Math.floor((listHeight.value - 140) / ROW_HEIGHT)))

let resizeObserver = null
function setupResizeObserver() {
  resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      containerHeight.value = entry.contentRect.height
    }
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
    containerHeight.value = containerRef.value.getBoundingClientRect().height
  }
}

// 搜索状态
const query = ref('')
const searchResults = ref([])
const searchTotal = ref(0)
const searchPage = ref(1)
const loading = ref(false)
const searched = ref(false)

// 当前播放视频
const currentVideo = ref(null)
const currentBvid = ref('')
const currentCid = ref('')
const videoInfo = ref(null)
const streamUrl = ref('')
const audioUrl = ref('')
const danmakuOid = ref('')
const danmakuList = ref([])
const isPlaying = ref(false)
const playerContainerRef = ref(null)
// 使用 shallowRef 避免 Vue 代理破坏 DPlayer 内部状态
let dp = shallowRef(null)
const showPlayer = ref(false)

// 画质选项: { qn: 数字, desc: 描述 }
const qualityOptions = ref([])
const selectedQuality = ref(16)
const loadingStream = ref(false)

// 格式化数字
function formatCount(num) {
  if (!num && num !== 0) return '0'
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toString()
}

// 格式化时长
function formatDuration(str) {
  if (!str) return '--:--'
  return str
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 清理标题中的em标签
function cleanTitle(title) {
  return title.replace(/<[^>]+>/g, '')
}

// 图片代理
function proxyImg(url) {
  if (!url) return ''
  let imgUrl = url
  if (url.startsWith('//')) imgUrl = 'https:' + url
  return `/api/bilibili/image?url=${encodeURIComponent(imgUrl)}`
}

// 搜索
async function search(page) {
  const q = query.value.trim()
  if (!q) return
  if (page) searchPage.value = page
  loading.value = true
  searched.value = true
  try {
    const res = await authFetch(`/api/bilibili/search?keyword=${encodeURIComponent(q)}&page=${searchPage.value}`)
    const data = await res.json()
    if (data.code === 0 && data.data?.result) {
      const videoList = data.data.result.filter(item => item.type === 'video')
      searchResults.value = videoList
      searchTotal.value = data.data.numResults || videoList.length
    } else {
      searchResults.value = []
      searchTotal.value = 0
    }
  } catch (e) {
    console.error('Search error:', e)
    searchResults.value = []
    searchTotal.value = 0
  }
  loading.value = false
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') search()
}

// 点击播放视频
async function playVideo(video) {
  if (currentBvid.value === video.bvid) {
    showPlayer.value = !showPlayer.value
    return
  }

  currentVideo.value = video
  currentBvid.value = video.bvid
  showPlayer.value = true
  loadingStream.value = true
  isPlaying.value = false
  streamUrl.value = ''
  audioUrl.value = ''

  try {
    // 获取视频分页列表（获取cid）
    const cidRes = await authFetch(`/api/bilibili/pagelist?bvid=${encodeURIComponent(video.bvid)}`)
    const cidData = await cidRes.json()
    if (cidData.code !== 0 || !cidData.data?.length) {
      throw new Error('获取视频信息失败')
    }
    currentCid.value = cidData.data[0].cid
    danmakuOid.value = cidData.data[0].cid

    // 获取弹幕
    const danmakuRes = await authFetch(`/api/bilibili/danmaku?oid=${cidData.data[0].cid}`)
    danmakuList.value = await danmakuRes.json()

    // 获取视频流地址
    await fetchStreamUrl()
  } catch (e) {
    console.error('Play video error:', e)
    alert('播放失败: ' + e.message)
    closePlayer()
  }
}

// 初始化 DPlayer
function initDPlayer() {
  try {
    if (dp.value) {
      dp.value.destroy()
      dp.value = null
    }
    if (!streamUrl.value) {
      console.warn('initDPlayer: no streamUrl')
      return
    }
    if (!playerContainerRef.value) {
      console.warn('initDPlayer: container not ready, retrying...')
      setTimeout(initDPlayer, 100)
      return
    }

    const videoUrl = getProxyStreamUrl(streamUrl.value)
    console.log('initDPlayer: creating player with url:', videoUrl ? 'yes' : 'no', 'danmaku:', danmakuList.value.length)

    dp.value = markRaw(new DPlayer({
      container: playerContainerRef.value,
      video: {
        url: videoUrl,
        autoplay: true,
        type: 'normal'
      },
      danmaku: {
        data: danmakuList.value
      },
      contextmenu: [
        { text: 'bilibili', link: 'https://www.bilibili.com' }
      ]
    }))

    dp.value.on('play', () => { isPlaying.value = true })
    dp.value.on('pause', () => { isPlaying.value = false })
    dp.value.on('ended', () => { isPlaying.value = false })
    dp.value.on('seeking', () => { console.log('DPlayer: seeking...') })
    dp.value.on('seeked', () => { console.log('DPlayer: seeked') })

    // 获取当前播放时间，用于 seek 时重新获取流
    const video = dp.value.video
    video.addEventListener('seeking', async () => {
      const currentTime = video.currentTime
      console.log('Seeking to:', currentTime)
    })
    video.addEventListener('seeked', async () => {
      console.log('Seeked to:', video.currentTime)
    })

    console.log('DPlayer initialized successfully')
  } catch (e) {
    console.error('initDPlayer error:', e)
  }
}

async function fetchStreamUrl() {
  if (!currentBvid.value || !currentCid.value) return

  try {
    // fnval=1 返回 FLV/MP4 格式，支持拖动
    const res = await authFetch(`/api/bilibili/playurl?bvid=${encodeURIComponent(currentBvid.value)}&cid=${currentCid.value}&qn=${selectedQuality.value}&fnval=1&fourk=1`)
    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(data.message || '获取播放地址失败')
    }

    videoInfo.value = data.data

    // 解析 FLV/MP4 流
    if (data.data.durl && data.data.durl.length > 0) {
      streamUrl.value = data.data.durl[0]?.url || ''
    } else {
      streamUrl.value = ''
    }

    // 更新画质选项 (qn: 数字, desc: 描述)
    const qnList = data.data.accept_quality || []
    const descList = data.data.accept_description || []
    qualityOptions.value = qnList.map((qn, i) => ({
      qn,
      desc: descList[i] || `${qn}p`
    }))

    // 等待 DOM 更新后初始化 DPlayer
    nextTick(() => {
      initDPlayer()
      // 等待 DPlayer 内部渲染完成后再隐藏 loading
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          loadingStream.value = false
        })
      })
    })
  } catch (e) {
    console.error('Fetch stream URL error:', e)
    loadingStream.value = false
  }
}

async function changeQuality() {
  if (!currentBvid.value || !currentCid.value) return
  loadingStream.value = true
  isPlaying.value = false
  if (dp.value) {
    dp.value.pause()
    dp.value.destroy()
    dp.value = null
  }
  await fetchStreamUrl()
}

function closePlayer() {
  showPlayer.value = false
  if (dp.value) {
    dp.value.destroy()
    dp.value = null
  }
  isPlaying.value = false
  currentVideo.value = null
  currentBvid.value = ''
  currentCid.value = ''
  streamUrl.value = ''
  audioUrl.value = ''
  danmakuOid.value = ''
  danmakuList.value = []
}

// 分页
function totalPages(total, size) {
  const ps = size || pageSize.value
  return Math.max(1, Math.ceil(total / ps))
}
const searchTotalPages = computed(() => totalPages(searchTotal.value))

function pagedItems(items, page, size) {
  const ps = size || pageSize.value
  const start = (page - 1) * ps
  return items.slice(start, start + ps)
}

function getProxyStreamUrl(url) {
  if (!url) return ''
  return `/api/bilibili/stream?url=${encodeURIComponent(url)}`
}

onMounted(() => {
  nextTick(() => setupResizeObserver())
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (dp.value) {
    dp.value.destroy()
    dp.value = null
  }
})
</script>

<template>
  <div ref="containerRef" class="bilibili">
    <!-- 播放器覆盖层 -->
    <transition name="player-fade">
      <div v-if="showPlayer && currentVideo" class="player-overlay">
        <div class="player-header">
          <div class="player-title">{{ cleanTitle(currentVideo.title) }}</div>
          <div class="player-info">
            <span class="player-author">{{ currentVideo.author }}</span>
            <span class="player-stat">{{ formatCount(currentVideo.play) }}播放</span>
            <span class="player-stat">{{ formatCount(currentVideo.favorites) }}收藏</span>
          </div>
          <div class="player-controls">
            <select v-model="selectedQuality" class="quality-select" @change="changeQuality" :disabled="loadingStream">
              <option v-for="q in qualityOptions" :key="q.qn" :value="q.qn">{{ q.desc }}</option>
            </select>
            <button class="player-close-btn" @click="closePlayer()" title="关闭">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="player-body">
          <div v-if="loadingStream" class="player-loading">
            <div class="loading-spinner"></div>
            <span>正在获取播放地址...</span>
          </div>
          <div v-else-if="!streamUrl" class="player-error">无法获取播放地址</div>
          <div v-else ref="playerContainerRef" class="dplayer-container"></div>
        </div>
      </div>
    </transition>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <input
        v-model="query"
        type="text"
        class="search-input"
        placeholder="搜索视频..."
        @keydown="onSearchKeydown"
        autofocus
      />
      <button class="search-btn" @click="search()" :disabled="loading">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
    </div>

    <!-- 搜索结果 -->
    <div class="results">
      <div v-if="loading" class="loading">搜索中...</div>

      <template v-if="!loading && searchResults.length">
        <div class="result-list">
          <div
            v-for="video in pagedItems(searchResults, searchPage, pageSize)"
            :key="video.bvid"
            class="video-card"
            :class="{ active: currentBvid === video.bvid }"
            @click="playVideo(video)"
          >
            <div class="video-cover-wrap">
              <img
                v-if="video.pic"
                :src="proxyImg(video.pic)"
                class="video-cover"
                loading="lazy"
              />
              <div class="video-duration">{{ video.duration }}</div>
            </div>
            <div class="video-info">
              <div class="video-title">{{ cleanTitle(video.title) }}</div>
              <div class="video-meta">
                <span class="video-author">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {{ video.author }}
                </span>
              </div>
              <div class="video-stats">
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {{ formatCount(video.play) }}
                </span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  {{ formatCount(video.favorites) }}
                </span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {{ formatCount(video.review) }}
                </span>
                <span class="video-date">{{ formatDate(video.pubdate) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="searchTotalPages > 1" class="pagination">
          <button class="page-btn" :disabled="searchPage <= 1" @click="search(searchPage - 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ searchPage }} / {{ searchTotalPages }}</span>
          <button class="page-btn" :disabled="searchPage >= searchTotalPages" @click="search(searchPage + 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </template>

      <div v-if="!loading && searched && !searchResults.length" class="empty-state">
        <div class="empty-text">未找到相关视频</div>
      </div>

      <div v-if="!loading && !searched" class="empty-state">
        <div class="empty-icon">📺</div>
        <div class="empty-text">搜索视频开始播放</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bilibili {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  color: #e0e0e0;
  overflow: hidden;
}

/* 播放器覆盖层 */
.player-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(10, 12, 20, 0.97);
  display: flex;
  flex-direction: column;
}

.player-fade-enter-active,
.player-fade-leave-active {
  transition: opacity 0.25s ease;
}

.player-fade-enter-from,
.player-fade-leave-to {
  opacity: 0;
}

.player-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.player-title {
  flex: 1;
  font-size: 15px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.player-author {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.player-stat {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.quality-select {
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.quality-select option {
  background: #1a1a2e;
  color: #fff;
}

.player-close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.player-close-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.25);
}

.player-body {
  flex: 1;
  display: block;
  position: relative;
  overflow: hidden;
  padding: 16px;
  box-sizing: border-box;
}

.player-loading,
.player-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #00a1d6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.dplayer-container {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
  position: absolute;
  inset: 0;
}

/* 确保 DPlayer 内部元素填满容器 */
:deep(.dplayer) {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}

:deep(.dplayer-video-wrap) {
  width: 100%;
  height: 100%;
}

:deep(.dplayer-video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

:deep(.dplayer-bar-wrap) {
  cursor: pointer;
  pointer-events: auto;
}

:deep(.dplayer-bar) {
  pointer-events: none;
}

:deep(.dplayer-bar-preview) {
  pointer-events: none;
}

:deep(.dplayer-controls) {
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.5));
  padding: 10px;
}

/* 搜索栏 */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
  align-items: center;
}

.search-input {
  flex: 1;
  padding: 10px 16px;
  font-size: 16px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: #fff;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.search-input:focus {
  border-color: rgba(0, 161, 214, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.search-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 161, 214, 0.5);
  border: 1px solid rgba(0, 161, 214, 0.4);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.search-btn:hover {
  background: rgba(0, 161, 214, 0.7);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 结果列表 */
.results {
  flex: 1;
  overflow-y: hidden;
  padding-right: 4px;
  min-height: 0;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.video-card {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.video-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.video-card.active {
  background: rgba(0, 161, 214, 0.15);
  border-color: rgba(0, 161, 214, 0.4);
}

.video-cover-wrap {
  position: relative;
  width: 160px;
  height: 90px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
}

.video-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 4px;
  font-size: 11px;
  color: #fff;
  font-weight: 500;
}

.video-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.video-title {
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}

.video-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.video-author {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.video-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.video-date {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-left: auto;
}

/* Loading & Empty */
.loading {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.3);
}

/* 分页 */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 0 8px;
}

.page-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.page-info {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

/* 滚动条 */
.results::-webkit-scrollbar {
  width: 6px;
}

.results::-webkit-scrollbar-track {
  background: transparent;
}

.results::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.results::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
