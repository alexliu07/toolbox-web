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
  buvid3: { type: String, default: '' },
})

const authFetch = inject('authFetch')

// 带buvid3的请求封装
function biliFetch(url, options = {}) {
  const buvid = props.buvid3
  if (!buvid) return authFetch(url, options)
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = `${url}${sep}buvid3=${encodeURIComponent(buvid)}`
  return authFetch(fullUrl, options)
}

// 播放器状态
const currentCid = ref(props.initialCid || (props.pageList[0]?.cid ?? 0))
const currentPageIndex = ref(props.pageList.findIndex(p => p.cid === currentCid.value))
if (currentPageIndex.value < 0) currentPageIndex.value = 0
const currentEpId = ref(props.pageList[currentPageIndex.value]?.id || props.epId || 0)
const streamUrl = ref('')
const loadingStream = ref(true)
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
const livePopularity = ref(0)
let hlsInstance = null
let liveDanmakuSource = null
let danmakuCleanupTimer = null

// 侧栏标签页
const sidebarTab = ref('info')

// 评论状态
const comments = ref([])
const commentPage = ref(1)
const commentTotal = ref(0)
const commentSort = ref(0) // 0=时间 1=点赞 2=回复
const commentsLoading = ref(false)
const commentPageSize = 20

// 回复查看状态: Map<rpid, { replies, page, total, loading }>
const replyViewState = ref(new Map())

// ── 评论 ──
async function fetchComments() {
  if (!props.aid) return
  commentsLoading.value = true
  try {
    const res = await biliFetch(`/api/bilibili/comments?type=1&oid=${props.aid}&pn=${commentPage.value}&ps=${commentPageSize}&sort=${commentSort.value}`)
    const data = await res.json()
    if (data.code === 0 && data.data) {
      comments.value = data.data.replies || []
      commentTotal.value = data.data.page?.count || 0
    } else {
      comments.value = []
      commentTotal.value = 0
    }
  } catch (e) {
    console.warn('Failed to fetch comments:', e)
    comments.value = []
    commentTotal.value = 0
  }
  commentsLoading.value = false
}

function switchCommentTab() {
  sidebarTab.value = 'comments'
  if (comments.value.length === 0) fetchComments()
}

function commentTotalPages() {
  return Math.ceil(commentTotal.value / commentPageSize) || 1
}

function formatCommentTime(ctime) {
  if (!ctime) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ctime
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  const d = new Date(ctime * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getReplyState(rpid) {
  return replyViewState.value.get(rpid) || null
}

async function toggleReplyView(comment) {
  const rpid = comment.rpid
  if (replyViewState.value.has(rpid)) {
    replyViewState.value.delete(rpid)
    replyViewState.value = new Map(replyViewState.value) // trigger reactivity
    return
  }
  const state = { replies: [], page: 1, total: comment.count || 0, loading: true }
  replyViewState.value.set(rpid, state)
  replyViewState.value = new Map(replyViewState.value)
  await fetchReplies(rpid, state)
}

async function fetchReplies(rpid, state) {
  state.loading = true
  replyViewState.value = new Map(replyViewState.value)
  try {
    const res = await biliFetch(`/api/bilibili/comments/reply?type=1&oid=${props.aid}&root=${rpid}&pn=${state.page}&ps=20`)
    const data = await res.json()
    if (data.code === 0 && data.data) {
      state.replies = data.data.replies || []
      state.total = data.data.page?.count || 0
    } else {
      state.replies = []
    }
  } catch (e) {
    console.warn('Failed to fetch replies:', e)
    state.replies = []
  }
  state.loading = false
  replyViewState.value = new Map(replyViewState.value)
}

function replyTotalPages(rpid) {
  const state = replyViewState.value.get(rpid)
  if (!state) return 1
  return Math.ceil(state.total / 20) || 1
}

async function replyChangePage(rpid, delta) {
  const state = replyViewState.value.get(rpid)
  if (!state) return
  state.page += delta
  await fetchReplies(rpid, state)
}

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
    const res = await biliFetch(`/api/bilibili/videoinfo?bvid=${encodeURIComponent(props.bvid)}`)
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
    const res = await biliFetch(`/api/bilibili/fav/status?aid=${props.aid}`)
    const data = await res.json()
    if (data.code === 0) isFaved.value = data.data?.favoured || false
  } catch (e) {
    console.warn('Failed to fetch action status:', e)
  }
}

async function fetchBangumiInfo() {
  if (!props.seasonId) return
  try {
    const res = await biliFetch(`/api/bilibili/bangumi-info?season_id=${props.seasonId}`)
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
    const res = await biliFetch(endpoint, {
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
      biliFetch(`/api/bilibili/live-info?room_id=${props.roomId}`),
      biliFetch(`/api/bilibili/live-anchor?roomid=${props.roomId}`),
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
    const res = await biliFetch(`/api/bilibili/favorites?rid=${props.aid}`)
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
    const res = await biliFetch('/api/bilibili/fav', {
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
    const response = await biliFetch(fetchUrl)
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
    const res = await biliFetch(`/api/bilibili/live-stream?room_id=${props.roomId}`)
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
      connectLiveDanmaku()
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
        if (data.fatal) {
          console.error('HLS fatal error:', data.type, data.details)
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

// ── 直播弹幕 SSE 连接 ──
function connectLiveDanmaku() {
  if (!props.isLive || !props.roomId) return
  if (liveDanmakuSource) { liveDanmakuSource.close(); liveDanmakuSource = null }

  const authToken = localStorage.getItem('auth_token') || ''
  const buvid = props.buvid3
  const params = new URLSearchParams({ room_id: props.roomId })
  if (buvid) params.set('buvid3', buvid)
  if (authToken) params.set('token', authToken)

  liveDanmakuSource = new EventSource(`/api/bilibili/live-danmaku?${params}`)

  liveDanmakuSource.addEventListener('danmaku', (e) => {
    try {
      const data = JSON.parse(e.data)
      if (dp.value?.danmaku) {
        dp.value.danmaku.addItem({ text: data.text, color: data.color, type: data.type, time: dp.value.video?.currentTime || 0, force: true })
      }
    } catch {}
  })

  liveDanmakuSource.addEventListener('popularity', (e) => {
    try {
      const data = JSON.parse(e.data)
      livePopularity.value = data.popularity
    } catch {}
  })

  liveDanmakuSource.addEventListener('connected', (e) => {
    console.log('[live-danmaku] SSE connected')
  })

  liveDanmakuSource.addEventListener('error', () => {
    // EventSource 自动重连；致命错误时 readyState 变为 CLOSED
  })

  // 弹幕内存清理：每60秒清除旧弹幕
  if (danmakuCleanupTimer) clearInterval(danmakuCleanupTimer)
  danmakuCleanupTimer = setInterval(() => {
    try {
      const items = dp.value?.danmaku?.getItems()
      if (items && items.length > 500) {
        const current = dp.value.video?.currentTime || 0
        const cutoff = current - 60
        const filtered = items.filter(item => item.time >= cutoff)
        dp.value.danmaku.resetItems(filtered)
      }
    } catch {}
  }, 60000)
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
        const res = await biliFetch(`/api/bilibili/danmaku/?id=${danmakuOid.value}`)
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
    dp.value.on('Pause', () => {
      reportProgress()
    })

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
  reportProgress()
  if (index === currentPageIndex.value) return
  const page = props.pageList[index]
  if (!page) return
  currentPageIndex.value = index
  currentCid.value = page.cid
  currentEpId.value = page.id || 0
  danmakuOid.value = page.cid
  pendingSeekTime.value = null
  loadingStream.value = true
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
      biliFetch('/api/bilibili/report', {
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
  if (liveDanmakuSource) { liveDanmakuSource.close(); liveDanmakuSource = null }
  if (danmakuCleanupTimer) { clearInterval(danmakuCleanupTimer); danmakuCleanupTimer = null }
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
          <button class="sidebar-toggle" @click="infoCollapsed = !infoCollapsed; if (infoCollapsed) sidebarTab = 'info'" :title="infoCollapsed ? '展开信息' : '收起信息'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline v-if="infoCollapsed" points="15 18 9 12 15 6"/>
              <polyline v-else points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <div v-if="!infoCollapsed && !props.isLive && aid" class="sidebar-tabs">
            <button class="sidebar-tab" :class="{ active: sidebarTab === 'info' }" @click="sidebarTab = 'info'">简介</button>
            <button class="sidebar-tab" :class="{ active: sidebarTab === 'comments' }" @click="switchCommentTab()">评论</button>
          </div>
        </div>
        <template v-if="!infoCollapsed">
          <!-- 评论页面 -->
          <template v-if="sidebarTab === 'comments' && !props.isLive">
            <div class="comment-sort-bar">
              <button class="comment-sort-btn" :class="{ active: commentSort === 0 }" @click="commentSort = 0; commentPage = 1; fetchComments()">最新</button>
              <button class="comment-sort-btn" :class="{ active: commentSort === 1 }" @click="commentSort = 1; commentPage = 1; fetchComments()">最热</button>
              <span class="comment-total">{{ formatCount(commentTotal) }}条评论</span>
            </div>
            <div v-if="commentsLoading" class="comment-loading-wrap">
              <div class="loading-spinner"></div>
              <span>加载评论...</span>
            </div>
            <template v-else>
              <div class="comment-list">
                <div v-if="comments.length === 0" class="comment-empty">暂无评论</div>
                <div v-for="reply in comments" :key="reply.rpid" class="comment-item">
                  <img :src="proxyAvatar(reply.member?.avatar)" class="comment-avatar" />
                  <div class="comment-body">
                    <div class="comment-header">
                      <span class="comment-name">{{ reply.member?.uname }}</span>
                      <span class="comment-time">{{ formatCommentTime(reply.ctime) }}</span>
                    </div>
                    <div class="comment-content">{{ reply.content?.message }}</div>
                    <div v-if="reply.content?.pictures?.length" class="comment-images">
                      <img v-for="(pic, pi) in reply.content.pictures" :key="pi" :src="`/api/bilibili/image?url=${encodeURIComponent(pic.img_src)}`" class="comment-img" @click="window.open(`/api/bilibili/image?url=${encodeURIComponent(pic.img_src)}`, '_blank')" />
                    </div>
                    <div class="comment-meta">
                      <span class="comment-like">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                        {{ formatCount(reply.like) }}
                      </span>
                      <button v-if="reply.count" class="comment-reply-btn" @click="toggleReplyView(reply)">
                        {{ getReplyState(reply.rpid) ? '收起回复' : `${reply.count}条回复` }}
                      </button>
                      <span v-if="reply.floor" class="comment-floor">#{{ reply.floor }}</span>
                    </div>
                    <!-- 回复展开区域 -->
                    <template v-if="getReplyState(reply.rpid)">
                      <div v-if="getReplyState(reply.rpid).loading" class="reply-loading">加载回复...</div>
                      <template v-else>
                        <div class="reply-list">
                          <div v-for="sub in getReplyState(reply.rpid).replies" :key="sub.rpid" class="reply-item">
                            <img :src="proxyAvatar(sub.member?.avatar)" class="reply-avatar" />
                            <div class="reply-body">
                              <div class="reply-header">
                                <span class="reply-name">{{ sub.member?.uname }}</span>
                                <span class="reply-time">{{ formatCommentTime(sub.ctime) }}</span>
                              </div>
                              <div class="reply-content">{{ sub.content?.message }}</div>
                              <span class="reply-like">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                                {{ formatCount(sub.like) }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div v-if="replyTotalPages(reply.rpid) > 1" class="reply-pagination">
                          <button class="reply-page-btn" :disabled="getReplyState(reply.rpid).page <= 1" @click="replyChangePage(reply.rpid, -1)">上一页</button>
                          <span class="reply-page-info">{{ getReplyState(reply.rpid).page }} / {{ replyTotalPages(reply.rpid) }}</span>
                          <button class="reply-page-btn" :disabled="getReplyState(reply.rpid).page >= replyTotalPages(reply.rpid)" @click="replyChangePage(reply.rpid, 1)">下一页</button>
                        </div>
                      </template>
                    </template>
                  </div>
                </div>
              </div>
              <div v-if="commentTotal > commentPageSize" class="comment-pagination">
                <button class="comment-page-btn" :disabled="commentPage <= 1" @click="commentPage--; fetchComments()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="comment-page-info">{{ commentPage }} / {{ commentTotalPages() }}</span>
                <button class="comment-page-btn" :disabled="commentPage >= commentTotalPages()" @click="commentPage++; fetchComments()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </template>
          </template>
          <!-- 信息页面 -->
          <template v-else>
          <!-- 直播信息 -->
          <template v-if="props.isLive">
            <div v-if="anchorInfo" class="info-up">
              <img :src="proxyAvatar(anchorInfo.face)" class="info-up-avatar" />
              <span class="info-up-name">{{ anchorInfo.uname }}</span>
            </div>
            <div class="info-title">{{ liveInfo?.title || cleanTitle(title) }}</div>
            <div class="info-stats">
              <span class="info-stat">{{ formatCount(livePopularity || liveInfo?.online) }}人气</span>
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
          </template><!-- close info page -->
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

/* 侧栏标签 */
.sidebar-tabs {
  display: flex;
  gap: 2px;
  margin-left: 8px;
  flex: 1;
}

.sidebar-tab {
  padding: 4px 12px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.sidebar-tab:hover {
  color: rgba(255, 255, 255, 0.7);
}

.sidebar-tab.active {
  color: #00a1d6;
  background: rgba(0, 161, 214, 0.12);
  font-weight: 600;
}

/* 评论排序 */
.comment-sort-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.comment-sort-btn {
  padding: 3px 8px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  cursor: pointer;
  border-radius: 3px;
  transition: color 0.12s;
}

.comment-sort-btn.active {
  color: #00a1d6;
  font-weight: 600;
}

.comment-total {
  margin-left: auto;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

/* 评论列表 */
.comment-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.comment-list::-webkit-scrollbar { width: 4px; }
.comment-list::-webkit-scrollbar-track { background: transparent; }
.comment-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

.comment-loading-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

.comment-empty {
  text-align: center;
  padding: 40px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

.comment-item {
  display: flex;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}

.comment-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.comment-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.comment-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comment-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.comment-content {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.5;
  margin-top: 4px;
  word-break: break-all;
}

.comment-images {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  overflow-x: auto;
}

.comment-img {
  width: 60px;
  height: 60px;
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
  flex-shrink: 0;
}

.comment-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.comment-like {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.comment-reply-count {
  font-size: 11px;
  color: rgba(0, 161, 214, 0.6);
}

.comment-floor {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}

.comment-reply-btn {
  font-size: 11px;
  color: rgba(0, 161, 214, 0.6);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.comment-reply-btn:hover {
  color: rgba(0, 161, 214, 0.9);
}

/* 回复列表 */
.reply-loading {
  padding: 8px 0 4px;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
}

.reply-list {
  margin-top: 8px;
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.reply-item {
  display: flex;
  gap: 8px;
  padding: 6px 0;
}

.reply-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.reply-body {
  flex: 1;
  min-width: 0;
}

.reply-header {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.reply-name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
}

.reply-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}

.reply-content {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  margin-top: 2px;
  word-break: break-all;
}

.reply-like {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
}

.reply-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 0;
  margin-top: 4px;
}

.reply-page-btn {
  padding: 3px 8px;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.12s;
}

.reply-page-btn:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.7);
}

.reply-page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.reply-page-info {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

/* 评论翻页 */
.comment-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 14px;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.comment-page-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  padding: 0;
}

.comment-page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.comment-page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.comment-page-info {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}
</style>
