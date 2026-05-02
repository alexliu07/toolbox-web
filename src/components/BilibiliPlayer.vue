<script setup>
import { ref, nextTick, inject, onMounted, onUnmounted, shallowRef } from 'vue'
import NPlayer, { Popover } from 'nplayer'
import Danmaku from '@nplayer/danmaku'
import { MediaPlayer } from 'dashjs'
import Hls from 'hls.js'

const props = defineProps({
  bvid: { type: String, default: '' },
  aid: { type: Number, default: 0 },
  title: { type: String, default: '' },
  pageList: { type: Array, default: () => [] },
  initialCid: { type: Number, default: 0 },
  isLoggedIn: { type: Boolean, default: false },
  isBangumi: { type: Boolean, default: false },
  epId: { type: Number, default: 0 },
  seasonId: { type: Number, default: 0 },
  isLive: { type: Boolean, default: false },
  roomId: { type: Number, default: 0 },
})

const authFetch = inject('authFetch')

// 播放器状态
const currentCid = ref(props.initialCid || (props.pageList[0]?.cid ?? 0))
const currentPageIndex = ref(props.pageList.findIndex(p => p.cid === currentCid.value))
if (currentPageIndex.value < 0) currentPageIndex.value = 0
const currentEpId = ref(props.pageList[currentPageIndex.value]?.id || props.epId || 0)
const streamUrl = ref('')
const loadingStream = ref(true)
const isPlaying = ref(false)
const playerContainerRef = ref(null)
let dp = shallowRef(null)
let dashPlayerInstance = null
let playerResizeObserver = null
const danmakuOid = ref(currentCid.value)
const pendingSeekTime = ref(null)
const infoCollapsed = ref(false)
const videoInfo = ref(null)

// 互动状态
const isFaved = ref(false)
const actionLoading = ref(false)

// 番剧状态
const bangumiInfo = ref(null)
const isFollowed = ref(false)

// 直播状态
const liveInfo = ref(null)
const anchorInfo = ref(null)
let hlsInstance = null

// 收藏夹弹窗
const showFavModal = ref(false)
const favFolders = ref([])
const favFoldersLoading = ref(false)
const selectedFolderIds = ref(new Set())
const originalFavIds = ref(new Set())

// ── 格式化 ──
function formatCount(num) {
  if (!num && num !== 0) return '0'
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toString()
}

function formatSeconds(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cleanTitle(title) {
  return title.replace(/<[^>]+>/g, '')
}

function proxyAvatar(url) {
  if (!url) return ''
  let imgUrl = url
  if (url.startsWith('//')) imgUrl = 'https:' + url
  return `/api/bilibili/image?url=${encodeURIComponent(imgUrl)}`
}

// ── 数据获取 ──
async function fetchVideoInfo() {
  try {
    const res = await authFetch(`/api/bilibili/videoinfo?bvid=${encodeURIComponent(props.bvid)}`)
    const data = await res.json()
    if (data.code === 0) {
      videoInfo.value = data.data
    }
  } catch (e) {
    console.warn('Failed to fetch video info:', e)
  }
}

async function fetchActionStatus() {
  try {
    const res = await authFetch(`/api/bilibili/fav/status?aid=${props.aid}`)
    const data = await res.json()
    if (data.code === 0) isFaved.value = data.data?.favoured || false
  } catch (e) {
    console.warn('Failed to fetch action status:', e)
  }
}

async function fetchBangumiInfo() {
  if (!props.seasonId) return
  try {
    const res = await authFetch(`/api/bilibili/bangumi-info?season_id=${props.seasonId}`)
    const data = await res.json()
    if (data.code === 0) {
      bangumiInfo.value = data.data
      isFollowed.value = data.data.user_status?.follow === 1
    }
  } catch (e) {
    console.warn('Failed to fetch bangumi info:', e)
  }
}

async function toggleFollow() {
  if (!props.seasonId || actionLoading.value) return
  actionLoading.value = true
  try {
    const endpoint = isFollowed.value ? '/api/bilibili/bangumi/unfollow' : '/api/bilibili/bangumi/follow'
    const res = await authFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: props.seasonId })
    })
    const data = await res.json()
    if (data.code === 0) {
      isFollowed.value = !isFollowed.value
    }
  } catch (e) {
    console.error('Toggle follow error:', e)
  }
  actionLoading.value = false
}

async function fetchLiveInfo() {
  if (!props.roomId) return
  try {
    const [roomRes, anchorRes] = await Promise.all([
      authFetch(`/api/bilibili/live-info?room_id=${props.roomId}`),
      authFetch(`/api/bilibili/live-anchor?roomid=${props.roomId}`),
    ])
    const roomData = await roomRes.json()
    const anchorData = await anchorRes.json()
    if (roomData.code === 0) liveInfo.value = roomData.data
    if (anchorData.code === 0) anchorInfo.value = anchorData.data
  } catch (e) {
    console.warn('Failed to fetch live info:', e)
  }
}

async function openFavModal() {
  showFavModal.value = true
  favFoldersLoading.value = true
  selectedFolderIds.value = new Set()
  originalFavIds.value = new Set()
  try {
    const res = await authFetch(`/api/bilibili/favorites?rid=${props.aid}`)
    const data = await res.json()
    if (data.code === 0 && data.data?.list) {
      favFolders.value = data.data.list
      const preSelected = new Set()
      for (const f of data.data.list) {
        if (f.fav_state === 1) preSelected.add(f.id)
      }
      selectedFolderIds.value = preSelected
      originalFavIds.value = new Set(preSelected)
    }
  } catch (e) {
    console.error('Fetch folders error:', e)
  }
  favFoldersLoading.value = false
}

function toggleFolderSelection(id) {
  const s = new Set(selectedFolderIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedFolderIds.value = s
}

async function confirmFav() {
  actionLoading.value = true
  const addIds = Array.from(selectedFolderIds.value).filter(id => !originalFavIds.value.has(id))
  const delIds = Array.from(originalFavIds.value).filter(id => !selectedFolderIds.value.has(id))
  try {
    const res = await authFetch('/api/bilibili/fav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rid: props.aid,
        add_media_ids: addIds.join(','),
        del_media_ids: delIds.join(',')
      })
    })
    const data = await res.json()
    if (data.code === 0) {
      isFaved.value = selectedFolderIds.value.size > 0
      showFavModal.value = false
    } else {
      alert(data.message || '操作失败')
    }
  } catch (e) {
    console.error('Fav error:', e)
  }
  actionLoading.value = false
}

function closeFavModal() {
  showFavModal.value = false
  favFolders.value = []
  selectedFolderIds.value = new Set()
}

async function fetchStreamUrl() {
  if (props.isLive) {
    await fetchLiveStream()
    return
  }
  if (!currentCid.value) return
  if (!props.isBangumi && !props.bvid) return
  try {
    let fetchUrl
    if (props.isBangumi) {
      const params = new URLSearchParams({ cid: currentCid.value })
      if (props.aid) params.set('avid', props.aid)
      if (currentEpId.value) params.set('ep_id', currentEpId.value)
      fetchUrl = `/api/bilibili/bangumi-mpd?${params}`
    } else {
      fetchUrl = `/api/bilibili/mpd?bvid=${encodeURIComponent(props.bvid)}&cid=${currentCid.value}`
    }
    const response = await authFetch(fetchUrl)
    const lastPlayTime = response.headers.get('X-Last-Play-Time')
    if (lastPlayTime) {
      pendingSeekTime.value = parseInt(lastPlayTime) / 1000
    }
    const mpdText = await response.text()
    const modified = mpdText.replaceAll('/api', `${window.location.origin}/api`)
    const blob = new Blob([modified], { type: 'application/dash+xml' })
    streamUrl.value = URL.createObjectURL(blob)

    nextTick(() => {
      initNPlayer()
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

async function fetchLiveStream() {
  if (!props.roomId) return
  try {
    const res = await authFetch(`/api/bilibili/live-stream?room_id=${props.roomId}`)
    const data = await res.json()
    if (data.code !== 0 || !data.data?.streams?.length) {
      loadingStream.value = false
      return
    }
    // 优先选 http_hls/ts/avc，其次 http_hls/fmp4/avc
    const streams = data.data.streams
    let best = streams.find(s => s.protocol === 'http_hls' && s.format === 'ts' && s.codec === 'avc')
    if (!best) best = streams.find(s => s.protocol === 'http_hls' && s.codec === 'avc')
    if (!best) best = streams.find(s => s.codec === 'avc')
    if (!best) best = streams[0]

    // 通过代理获取流
    const proxyUrl = `/api/bilibili/stream?url=${encodeURIComponent(best.url)}`

    streamUrl.value = 'hls-live' // 占位，让模板渲染播放器容器
    nextTick(() => {
      initHlsPlayer(proxyUrl)
      loadingStream.value = false
    })
  } catch (e) {
    console.error('Fetch live stream error:', e)
    loadingStream.value = false
  }
}

function initHlsPlayer(url) {
  try {
    if (dp.value) { dp.value.dispose(); dp.value = null }
    if (!playerContainerRef.value) {
      setTimeout(() => initHlsPlayer(url), 100)
      return
    }

    const danmaku = new Danmaku({ items: [], persistOptions: true })
    const player = new NPlayer({
      controls: [['play', 'volume', 'time', 'spacer', 'airplay', 'settings', 'web-fullscreen', 'fullscreen'], ['progress']],
      plugins: [danmaku]
    })
    dp.value = player
    dp.value.on('play', () => { isPlaying.value = true })
    dp.value.on('pause', () => { isPlaying.value = false })

    if (Hls.isSupported()) {
      hlsInstance = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        enableWorker: true,
      })
      hlsInstance.attachMedia(dp.value.video)
      hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
        hlsInstance.loadSource(url)
      })
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        dp.value.video.play().catch(() => {})
      })
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data.type, data.details)
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hlsInstance.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError()
        }
      })
    } else if (dp.value.video.canPlayType('application/vnd.apple.mpegurl')) {
      dp.value.video.src = url
    }

    dp.value.mount(playerContainerRef.value)
    setTimeout(() => { if (dp.value) dp.value.emit('resize') }, 300)
    if (playerResizeObserver) playerResizeObserver.disconnect()
    playerResizeObserver = new ResizeObserver(() => { if (dp.value) dp.value.emit('resize') })
    playerResizeObserver.observe(playerContainerRef.value)
  } catch (e) {
    console.error('initHlsPlayer error:', e)
  }
}

// ── 播放器 ──
async function initNPlayer() {
  try {
    if (dp.value) { dp.value.dispose(); dp.value = null }
    if (!streamUrl.value) return
    if (!playerContainerRef.value) {
      setTimeout(initNPlayer, 100)
      return
    }

    let danmakuItems = []
    if (danmakuOid.value) {
      try {
        const res = await authFetch(`/api/bilibili/danmaku/?id=${danmakuOid.value}`)
        const data = await res.json()
        if (data.code === 0 && Array.isArray(data.data)) {
          danmakuItems = data.data.map(([time, type, color, , text]) => ({
            time, text,
            color: '#' + color.toString(16).padStart(6, '0'),
            type: type === 5 ? 'top' : type === 4 ? 'bottom' : 'scroll'
          })).sort((a, b) => a.time - b.time)
        }
      } catch (e) { console.warn('Failed to fetch danmaku:', e) }
    }

    const danmaku = new Danmaku({ items: danmakuItems, persistOptions: true })

    const Quantity = {
      el: document.createElement('div'),
      init() {
        this.btn = document.createElement('div')
        this.btn.textContent = '画质'
        this.el.appendChild(this.btn)
        this.popover = new Popover(this.el)
        this.btn.addEventListener('click', () => this.popover.show())
        this.el.style.display = 'none'
        this.el.classList.add('quantity')
      }
    }

    const player = new NPlayer({
      controls: [['play', 'volume', 'time', 'spacer', Quantity, 'airplay', 'settings', 'web-fullscreen', 'fullscreen'], ['progress']],
      plugins: [danmaku]
    })

    dp.value = player
    dp.value.on('play', () => { isPlaying.value = true })
    dp.value.on('pause', () => { isPlaying.value = false })
    dp.value.on('ended', () => { isPlaying.value = false })

    dashPlayerInstance = MediaPlayer().create()
    dashPlayerInstance.initialize(dp.value.video, streamUrl.value, true)
    let repLabelMap = new Map()

    dashPlayerInstance.on(MediaPlayer.events.MANIFEST_LOADED, (e) => {
      const adaptations = e.data.Period[0].AdaptationSet
      const videoAdapt = adaptations.find(a => a.contentType === 'video' || a.mimeType?.startsWith('video'))
      videoAdapt?.Representation?.forEach(rep => {
        const label = rep.Label?.[0].__text || rep.label
        repLabelMap.set(String(rep.id), label)
      })
    })

    dashPlayerInstance.on(MediaPlayer.events.STREAM_INITIALIZED, () => {
      const levels = dashPlayerInstance.getRepresentationsByType('video')
      levels.sort((a, b) => b.height - a.height)
      const frag = document.createDocumentFragment()

      const listener = (index) => (init) => {
        const prevEl = Quantity.itemElements[Quantity.value]
        const curEl = Quantity.itemElements[index]
        if (prevEl) prevEl.classList.remove('quantity_item-active')
        if (curEl) curEl.classList.add('quantity_item-active')
        Quantity.btn.textContent = index === -1 ? '自动' : (levels[index].label || curEl.textContent)
        Quantity.value = index
        Quantity.popover.hide()
        if (index === -1) {
          dashPlayerInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true, audio: true } } } })
        } else {
          dashPlayerInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false, audio: true } } } })
          dashPlayerInstance.setRepresentationForTypeById('video', levels[index].id)
        }
      }

      Quantity.itemElements = levels.map((l, i) => {
        const el = document.createElement('div')
        el.textContent = repLabelMap.get(String(i)) || l.height + 'P'
        el.classList.add('quantity_item')
        el.addEventListener('click', () => listener(i)())
        frag.appendChild(el)
        return el
      })

      const autoEl = document.createElement('div')
      autoEl.textContent = '自动'
      autoEl.classList.add('quantity_item')
      autoEl.addEventListener('click', () => listener(-1)())
      frag.appendChild(autoEl)
      Quantity.itemElements.push(autoEl)

      Quantity.popover.panelEl.appendChild(frag)
      Quantity.el.style.display = 'block'
      listener(-1)(true)

      if (pendingSeekTime.value != null) {
        const seekTo = pendingSeekTime.value
        pendingSeekTime.value = null
        setTimeout(() => {
          if (dp.value && dp.value.video) dp.value.video.currentTime = seekTo
        }, 300)
      }
    })

    dp.value.mount(playerContainerRef.value)

    setTimeout(() => { if (dp.value) dp.value.emit('resize') }, 300)
    if (playerResizeObserver) playerResizeObserver.disconnect()
    playerResizeObserver = new ResizeObserver(() => { if (dp.value) dp.value.emit('resize') })
    playerResizeObserver.observe(playerContainerRef.value)
  } catch (e) {
    console.error('initNPlayer error:', e)
  }
}

// ── 切换分集 ──
async function switchEpisode(index) {
  if (index === currentPageIndex.value) return
  const page = props.pageList[index]
  if (!page) return
  currentPageIndex.value = index
  currentCid.value = page.cid
  currentEpId.value = page.id || 0
  danmakuOid.value = page.cid
  pendingSeekTime.value = null
  loadingStream.value = true
  isPlaying.value = false
  if (dashPlayerInstance) { dashPlayerInstance.reset(); dashPlayerInstance = null }
  if (dp.value) { dp.value.dispose(); dp.value = null }
  await fetchStreamUrl()
}

// ── 上报进度 ──
function reportProgress() {
  try {
    const video = dp.value?.video
    if (video && props.aid && currentCid.value) {
      const progress = Math.floor(video.currentTime)
      authFetch('/api/bilibili/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aid: props.aid, cid: parseInt(currentCid.value), progress })
      }).catch(e => console.warn('Report progress failed:', e))
    }
  } catch (e) { console.warn('Report progress error:', e) }
}

// ── 生命周期 ──
onMounted(async () => {
  if (props.isLive) {
    fetchLiveInfo()
  } else if (props.isBangumi) {
    fetchBangumiInfo()
  } else {
    fetchVideoInfo()
    fetchActionStatus()
  }
  await fetchStreamUrl()
})

onUnmounted(() => {
  if (!props.isLive) reportProgress()
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  if (playerResizeObserver) { playerResizeObserver.disconnect(); playerResizeObserver = null }
  if (dashPlayerInstance) { dashPlayerInstance.reset(); dashPlayerInstance = null }
  if (dp.value) { dp.value.dispose(); dp.value = null }
})
</script>

<template>
  <div class="player-root">
    <div v-if="loadingStream" class="player-loading">
      <div class="loading-spinner"></div>
      <span>正在获取播放地址...</span>
    </div>
    <div v-else-if="!streamUrl" class="player-error">无法获取播放地址</div>
    <template v-else>
      <div ref="playerContainerRef" class="nplayer-container"></div>
      <div class="video-sidebar" :class="{ collapsed: infoCollapsed }">
        <div class="sidebar-toggle-bar">
          <button class="sidebar-toggle" @click="infoCollapsed = !infoCollapsed" :title="infoCollapsed ? '展开信息' : '收起信息'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline v-if="infoCollapsed" points="15 18 9 12 15 6"/>
              <polyline v-else points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        <template v-if="!infoCollapsed">
          <!-- 直播信息 -->
          <template v-if="props.isLive">
            <div v-if="anchorInfo" class="info-up">
              <img :src="proxyAvatar(anchorInfo.face)" class="info-up-avatar" />
              <span class="info-up-name">{{ anchorInfo.uname }}</span>
            </div>
            <div class="info-title">{{ liveInfo?.title || cleanTitle(title) }}</div>
            <div class="info-stats">
              <span v-if="liveInfo?.online" class="info-stat">{{ formatCount(liveInfo.online) }}人气</span>
              <span v-if="liveInfo?.area_name" class="info-stat">{{ liveInfo.area_name }}</span>
            </div>
            <div v-if="liveInfo?.description" class="info-desc-section">
              <div class="info-desc-label">简介</div>
              <div class="info-desc">{{ liveInfo.description }}</div>
            </div>
          </template>
          <!-- 番剧信息 -->
          <template v-else-if="props.isBangumi">
            <div class="info-title">{{ bangumiInfo?.title || cleanTitle(title) }}</div>
            <div v-if="bangumiInfo?.rating" class="info-stats">
              <span class="info-stat">{{ bangumiInfo.rating.score }}分</span>
              <span class="info-stat">{{ formatCount(bangumiInfo.rating.count) }}人评分</span>
            </div>
            <div v-if="bangumiInfo?.evaluate" class="info-desc-section">
              <div class="info-desc-label">简介</div>
              <div class="info-desc">{{ bangumiInfo.evaluate }}</div>
            </div>
            <div v-if="props.isLoggedIn" class="info-actions">
              <button class="action-btn" :class="{ active: isFollowed }" :disabled="actionLoading" @click="toggleFollow()">
                <svg width="18" height="18" viewBox="0 0 24 24" :fill="isFollowed ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <span>{{ isFollowed ? '已追番' : '追番' }}</span>
              </button>
            </div>
          </template>
          <!-- 普通视频信息 -->
          <template v-else>
            <div v-if="videoInfo?.owner" class="info-up">
              <img :src="proxyAvatar(videoInfo.owner.face)" class="info-up-avatar" />
              <span class="info-up-name">{{ videoInfo.owner.name }}</span>
            </div>
            <div class="info-title">{{ videoInfo?.title || cleanTitle(title) }}</div>
            <div v-if="videoInfo?.stat" class="info-stats">
              <span class="info-stat">{{ formatCount(videoInfo.stat.view) }}播放</span>
              <span class="info-stat">{{ formatCount(videoInfo.stat.danmaku) }}弹幕</span>
              <span class="info-stat">{{ formatDate(videoInfo.pubdate) }}</span>
            </div>
            <div v-if="videoInfo?.desc_v2?.length || videoInfo?.desc" class="info-desc-section">
              <div class="info-desc-label">简介</div>
              <div class="info-desc">
                <template v-if="videoInfo?.desc_v2?.length">
                  <template v-for="(seg, i) in videoInfo.desc_v2" :key="i">
                    <a v-if="seg.type === 2" :href="`https://space.bilibili.com/${seg.biz_id}`" target="_blank" class="info-desc-at">@{{ seg.raw_text }}</a>
                    <span v-else>{{ seg.raw_text }}</span>
                  </template>
                </template>
                <template v-else>{{ videoInfo?.desc }}</template>
              </div>
            </div>
            <div v-if="props.isLoggedIn" class="info-actions">
              <button class="action-btn" :class="{ active: isFaved }" :disabled="actionLoading" @click="openFavModal()">
                <svg width="18" height="18" viewBox="0 0 24 24" :fill="isFaved ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <span>{{ isFaved ? '已收藏' : '收藏' }}</span>
              </button>
            </div>
          </template>
          <!-- 收藏夹选择弹窗 -->
          <div v-if="props.isLoggedIn && showFavModal" class="fav-modal-overlay" @click.self="closeFavModal()">
            <div class="fav-modal">
              <div class="fav-modal-header">
                <span class="fav-modal-title">选择收藏夹</span>
                <button class="fav-modal-close" @click="closeFavModal()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div v-if="favFoldersLoading" class="fav-modal-loading">加载中...</div>
              <div v-else class="fav-modal-list">
                <div
                  v-for="folder in favFolders"
                  :key="folder.id"
                  class="fav-folder-item"
                  :class="{ selected: selectedFolderIds.has(folder.id) }"
                  @click="toggleFolderSelection(folder.id)"
                >
                  <div class="fav-folder-check">
                    <svg v-if="selectedFolderIds.has(folder.id)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span class="fav-folder-name">{{ folder.title }}</span>
                  <span class="fav-folder-count">{{ folder.media_count }}</span>
                </div>
              </div>
              <div class="fav-modal-footer">
                <button class="fav-modal-confirm" :disabled="actionLoading" @click="confirmFav()">
                  确认
                </button>
              </div>
            </div>
          </div>
          <div v-if="pageList.length > 1" class="info-episodes">
            <div class="info-ep-label">选集 ({{ pageList.length }})</div>
            <div class="info-ep-list">
              <button
                v-for="(page, idx) in pageList"
                :key="page.cid"
                class="info-ep-item"
                :class="{ active: idx === currentPageIndex }"
                @click="switchEpisode(idx)"
              >
                <span class="info-ep-index">{{ idx + 1 }}</span>
                <span class="info-ep-name">{{ page.part || (page.title ? (page.long_title ? page.title + ' ' + page.long_title : page.title) : `第${idx + 1}集`) }}</span>
                <span class="info-ep-dur">{{ page.duration ? formatSeconds(page.duration) : '' }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.player-root {
  display: flex;
  width: 100%;
  height: 100%;
  background: rgba(10, 12, 20, 0.97);
  border-radius: 0 0 8px 8px;
  overflow: hidden;
}

.player-loading,
.player-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
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

@keyframes spin { to { transform: rotate(360deg); } }

.nplayer-container {
  flex: 1;
  min-width: 0;
  border-radius: 8px;
  overflow: hidden;
}

/* 侧栏 */
.video-sidebar {
  width: 250px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(10, 12, 20, 0.92);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  transition: width 0.2s ease;
  overflow: hidden;
  flex-shrink: 0;
}

.video-sidebar.collapsed { width: 36px; }

.sidebar-toggle-bar {
  display: flex;
  align-items: center;
  padding: 8px 6px;
  flex-shrink: 0;
}

.sidebar-toggle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}

.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

/* UP主 */
.info-up {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 12px;
  flex-shrink: 0;
}

.info-up-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.info-up-name {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 标题 */
.info-title {
  padding: 0 14px 8px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex-shrink: 0;
}

/* 统计 */
.info-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 10px;
  flex-shrink: 0;
}

.info-stat {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

/* 简介 */
.info-desc-section {
  padding: 0 14px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.info-desc-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 6px;
}

.info-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
}

.info-desc::-webkit-scrollbar { width: 3px; }
.info-desc::-webkit-scrollbar-track { background: transparent; }
.info-desc::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.info-desc-at {
  color: #00a1d6;
  text-decoration: none;
}

.info-desc-at:hover { text-decoration: underline; }

/* 分集 */
.info-episodes {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-top: 8px;
}

.info-ep-label {
  padding: 0 14px 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.info-ep-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-ep-list::-webkit-scrollbar { width: 4px; }
.info-ep-list::-webkit-scrollbar-track { background: transparent; }
.info-ep-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.info-ep-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  min-width: 0;
}

.info-ep-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.info-ep-item.active {
  background: rgba(0, 161, 214, 0.2);
  color: #00a1d6;
}

.info-ep-index {
  font-size: 11px;
  font-weight: 600;
  color: inherit;
  opacity: 0.6;
  width: 18px;
  flex-shrink: 0;
  text-align: center;
}

.info-ep-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-ep-dur {
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
}

/* NPlayer */
:deep(.nplayer) {
  width: 100% !important;
  height: 100% !important;
}

:deep(.nplayer video) {
  object-fit: contain;
}

:deep(.quantity) {
  position: relative;
  padding: 0 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  white-space: nowrap;
  opacity: 0.8;
}

:deep(.quantity:hover) { opacity: 1; }
:deep(.quantity_item) { padding: 5px 20px; font-weight: normal; }
:deep(.quantity_item:hover) { background: rgba(255, 255, 255, 0.3); }
:deep(.quantity_item-active) { color: var(--theme-color); }

/* 互动按钮 */
.info-actions {
  display: flex;
  gap: 6px;
  padding: 10px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.action-btn.active {
  background: rgba(0, 161, 214, 0.15);
  border-color: rgba(0, 161, 214, 0.3);
  color: #00a1d6;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 收藏夹弹窗 */
.fav-modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.fav-modal {
  width: 280px;
  max-height: 360px;
  background: rgba(20, 22, 35, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}

.fav-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.fav-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.fav-modal-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.fav-modal-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.fav-modal-loading {
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

.fav-modal-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.fav-modal-list::-webkit-scrollbar { width: 4px; }
.fav-modal-list::-webkit-scrollbar-track { background: transparent; }
.fav-modal-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.fav-folder-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.fav-folder-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.fav-folder-item.selected {
  background: rgba(0, 161, 214, 0.12);
}

.fav-folder-check {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  flex-shrink: 0;
  color: #00a1d6;
  transition: border-color 0.12s;
}

.fav-folder-item.selected .fav-folder-check {
  border-color: #00a1d6;
  background: rgba(0, 161, 214, 0.15);
}

.fav-folder-name {
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-folder-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.fav-modal-footer {
  padding: 10px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.fav-modal-confirm {
  width: 100%;
  padding: 8px;
  background: rgba(0, 161, 214, 0.6);
  border: 1px solid rgba(0, 161, 214, 0.4);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.fav-modal-confirm:hover:not(:disabled) {
  background: rgba(0, 161, 214, 0.8);
}

.fav-modal-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
