<script setup>
import { ref, computed, nextTick, inject, onMounted, onUnmounted, shallowRef, markRaw } from 'vue'
import NPlayer, { Popover } from 'nplayer'
import Danmaku from '@nplayer/danmaku'
import { MediaPlayer } from 'dashjs'

const authFetch = inject('authFetch')

// 卡片高度(90封面+20padding+2border) + gap
const CARD_HEIGHT = 112
const CARD_GAP = 8
const PAGINATION_HEIGHT = 40

// 结果区域高度 → 动态 pageSize
const resultsRef = ref(null)
const resultsHeight = ref(400)
const pageSize = computed(() => Math.max(1, Math.floor((resultsHeight.value - PAGINATION_HEIGHT) / (CARD_HEIGHT + CARD_GAP))))

let resultsResizeObserver = null

// 搜索状态
const query = ref('')
const allResults = ref([])      // 已缓存的全部结果（跨 API 页累积）
const searchTotal = ref(0)
const localPage = ref(1)        // 本地展示页码
const apiPage = ref(1)          // 已加载到第几 API 页
const loading = ref(false)
const searched = ref(false)

const pagedResults = computed(() => {
  const start = (localPage.value - 1) * pageSize.value
  return allResults.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => Math.max(1, Math.ceil(searchTotal.value / pageSize.value)))

// 当前播放视频
const currentVideo = ref(null)
const currentBvid = ref('')
const currentCid = ref('')
const streamUrl = ref('')
const danmakuOid = ref('')
const pageList = ref([])
const currentPageIndex = ref(0)
const isPlaying = ref(false)
const playerContainerRef = ref(null)
// 使用 shallowRef 避免 Vue 代理破坏 DPlayer 内部状态
let dp = shallowRef(null)
let dashPlayerInstance = null
let playerResizeObserver = null
const showPlayer = ref(false)

const loadingStream = ref(false)
const episodeCollapsed = ref(false)
const pendingSeekTime = ref(null) // 自动跳转到上次播放进度（秒）

// 登录状态
const bilibiliUser = ref(null)
const showLogin = ref(false)
const qrCode = ref('')
const qrStatus = ref(null)  // 'loading' | 'waiting' | 'scanned' | 'expired' | null
let qrPollTimer = null

// 页面切换
const activeTab = ref('search') // 'search' | 'history' | 'toview'

// 历史记录状态
const historyPage = ref(1)
const historyPageData = ref([])
const historyCursors = ref([{ max: 0, business: '', view_at: 0 }])
const historyLoading = ref(false)
const historyInited = ref(false)
const historyHasMore = ref(false)

// 稍后再看状态
const toviewData = ref([])
const toviewCount = ref(0)
const toviewLoading = ref(false)
const toviewInited = ref(false)
const toviewPage = ref(1)

// 格式化数字
function formatCount(num) {
  if (!num && num !== 0) return '0'
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toString()
}

// 格式化秒数为 MM:SS
function formatSeconds(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

// 头像代理
function proxyAvatar(url) {
  if (!url) return ''
  let imgUrl = url
  if (url.startsWith('//')) imgUrl = 'https:' + url
  return `/api/bilibili/image?url=${encodeURIComponent(imgUrl)}`
}

// 检查登录状态
async function checkLoginStatus() {
  try {
    const res = await authFetch('/api/bilibili/login/status')
    const data = await res.json()
    if (data.loggedIn) {
      bilibiliUser.value = { mid: data.mid, nickname: data.nickname, avatar_url: data.avatar_url }
    } else {
      bilibiliUser.value = null
    }
  } catch (e) {
    console.warn('Check bilibili login status failed:', e)
  }
}

// 开始登录
async function startLogin() {
  showLogin.value = true
  qrStatus.value = 'loading'
  qrCode.value = ''
  try {
    const res = await authFetch('/api/bilibili/login/qr/generate')
    const data = await res.json()
    if (data.qrimg) {
      qrCode.value = data.qrimg
      qrStatus.value = 'waiting'
      // 开始轮询
      startQrPoll(data.qrcode_key)
    } else {
      qrStatus.value = 'expired'
    }
  } catch (e) {
    console.error('Generate QR failed:', e)
    qrStatus.value = 'expired'
  }
}

// 轮询扫码状态
function startQrPoll(qrcodeKey) {
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrPollTimer = setInterval(async () => {
    try {
      const res = await authFetch(`/api/bilibili/login/qr/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`)
      const data = await res.json()
      if (data.code === 0) {
        // 登录成功
        clearInterval(qrPollTimer)
        qrPollTimer = null
        bilibiliUser.value = data.user
        closeLogin()
      } else if (data.code === 86090) {
        qrStatus.value = 'scanned'
      } else if (data.code === 86038) {
        // 二维码过期
        clearInterval(qrPollTimer)
        qrPollTimer = null
        qrStatus.value = 'expired'
      }
      // 86101 = 未扫码，继续轮询
    } catch (e) {
      console.error('QR poll error:', e)
    }
  }, 2000)
}

// 关闭登录弹窗
function closeLogin() {
  showLogin.value = false
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
  qrCode.value = ''
  qrStatus.value = null
}

// 登出
async function logout() {
  try {
    await authFetch('/api/bilibili/logout', { method: 'POST' })
  } catch (e) {
    console.warn('Logout error:', e)
  }
  bilibiliUser.value = null
}

// 新搜索（重置所有状态）
async function search() {
  const q = query.value.trim()
  if (!q) return
  loading.value = true
  searched.value = true
  allResults.value = []
  searchTotal.value = 0
  localPage.value = 1
  apiPage.value = 1
  try {
    const res = await authFetch(`/api/bilibili/search?keyword=${encodeURIComponent(q)}&page=1`)
    const data = await res.json()
    if (data.code === 0 && data.data?.result) {
      allResults.value = data.data.result.filter(item => item.type === 'video')
      searchTotal.value = data.data.numResults || allResults.value.length
    }
  } catch (e) {
    console.error('Search error:', e)
  }
  loading.value = false
}

// 加载更多 API 页（追加到缓存）
async function fetchApiPage(page) {
  const q = query.value.trim()
  if (!q) return
  loading.value = true
  try {
    const res = await authFetch(`/api/bilibili/search?keyword=${encodeURIComponent(q)}&page=${page}`)
    const data = await res.json()
    if (data.code === 0 && data.data?.result) {
      const more = data.data.result.filter(item => item.type === 'video')
      allResults.value = [...allResults.value, ...more]
      apiPage.value = page
    }
  } catch (e) {
    console.error('Search error:', e)
  }
  loading.value = false
}

async function goToPage(page) {
  if (page < 1 || page > totalPages.value) return
  // 检查是否需要加载更多 API 数据
  const needed = page * pageSize.value
  while (allResults.value.length < needed && allResults.value.length < searchTotal.value) {
    await fetchApiPage(apiPage.value + 1)
  }
  localPage.value = page
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') search()
}

// 切换页面
function switchTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'history') {
    historyCursors.value = [{ max: 0, business: '', view_at: 0 }]
    fetchHistory(1)
  } else if (tab === 'toview') {
    toviewPage.value = 1
    fetchToview()
  }
}

// 获取历史记录
async function fetchHistory(page) {
  historyLoading.value = true
  try {
    const cursor = historyCursors.value[page - 1] || { max: 0, business: '', view_at: 0 }
    const params = new URLSearchParams({ ps: '20' })
    if (cursor.max) params.set('max', cursor.max)
    if (cursor.business) params.set('business', cursor.business)
    if (cursor.view_at) params.set('view_at', cursor.view_at)

    const res = await authFetch(`/api/bilibili/history?${params.toString()}`)
    const data = await res.json()
    if (data.code === 0 && data.data?.list) {
      historyPageData.value = data.data.list
      historyPage.value = page
      historyInited.value = true

      // 存储下一页游标
      const nextCursor = data.data.cursor
      if (nextCursor && data.data.list.length > 0) {
        historyCursors.value[page] = {
          max: nextCursor.max,
          business: nextCursor.business,
          view_at: nextCursor.view_at
        }
        historyHasMore.value = true
      } else {
        historyHasMore.value = false
      }
    } else if (data.code === -101) {
      historyPageData.value = []
      historyHasMore.value = false
    }
  } catch (e) {
    console.error('Fetch history error:', e)
  }
  historyLoading.value = false
}

function historyGoToPage(page) {
  if (page < 1) return
  if (page > historyPage.value && !historyHasMore.value) return
  fetchHistory(page)
}

// 将历史记录项转为播放所需格式
function historyToVideo(item) {
  return {
    bvid: item.history?.bvid || '',
    aid: item.history?.oid || 0,
    title: item.title || '',
    author: item.author_name || '',
    pic: item.cover || '',
    play: 0,
    favorites: 0,
    review: 0,
    pubdate: item.view_at || 0,
    duration: item.duration ? formatDurationFromSec(item.duration) : '',
    cid: item.history?.cid || 0,
  }
}

// 稍后再看分页
const toviewPagedData = computed(() => {
  const start = (toviewPage.value - 1) * pageSize.value
  return toviewData.value.slice(start, start + pageSize.value)
})

const toviewTotalPages = computed(() => Math.max(1, Math.ceil(toviewCount.value / pageSize.value)))

// 获取稍后再看列表
async function fetchToview() {
  toviewLoading.value = true
  try {
    const res = await authFetch('/api/bilibili/toview')
    const data = await res.json()
    if (data.code === 0 && data.data?.list) {
      toviewData.value = data.data.list
      toviewCount.value = data.data.count || data.data.list.length
      toviewInited.value = true
    } else if (data.code === -101) {
      toviewData.value = []
      toviewCount.value = 0
    }
  } catch (e) {
    console.error('Fetch toview error:', e)
  }
  toviewLoading.value = false
}

// 将稍后再看项转为播放所需格式
function toviewToVideo(item) {
  return {
    bvid: item.bvid || '',
    aid: item.aid || 0,
    title: item.title || '',
    author: item.owner?.name || '',
    pic: item.pic || '',
    play: item.stat?.view || 0,
    favorites: item.stat?.favorite || 0,
    review: item.stat?.reply || 0,
    pubdate: item.pubdate || 0,
    duration: item.duration ? formatDurationFromSec(item.duration) : '',
    cid: item.cid || 0,
  }
}

// 格式化秒数为 HH:MM:SS 或 MM:SS
function formatDurationFromSec(sec) {
  if (!sec) return '--:--'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// 格式化观看进度百分比
function formatProgress(progress, duration) {
  if (!duration || duration <= 0) return 0
  if (progress < 0) return 100 // 已看完
  return Math.min(100, Math.round((progress / duration) * 100))
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

  try {
    // 获取视频分页列表（获取cid）
    const cidRes = await authFetch(`/api/bilibili/pagelist?bvid=${encodeURIComponent(video.bvid)}`)
    const cidData = await cidRes.json()
    if (cidData.code !== 0 || !cidData.data?.length) {
      throw new Error('获取视频信息失败')
    }
    pageList.value = cidData.data
    currentPageIndex.value = 0
    currentCid.value = cidData.data[0].cid
    danmakuOid.value = cidData.data[0].cid
    pendingSeekTime.value = null

    // 获取上次播放进度并自动跳转（仅登录用户）
    if (bilibiliUser.value) {
      try {
        const lpRes = await authFetch(`/api/bilibili/lastplay?bvid=${encodeURIComponent(video.bvid)}&cid=${currentCid.value}`)
        const lpData = await lpRes.json()
        if (lpData.code === 0 && lpData.data) {
          const { last_play_time } = lpData.data
          if (last_play_time) {
            pendingSeekTime.value = last_play_time / 1000 // 毫秒转秒
          }
        }
      } catch (e) {
        console.warn('Failed to fetch last play info:', e)
      }
    }

    // 获取视频流地址
    await fetchStreamUrl()
  } catch (e) {
    console.error('Play video error:', e)
    alert('播放失败: ' + e.message)
    closePlayer()
  }
}

// 初始化 NPlayer + dash.js
async function initNPlayer() {
  try {
    if (dp.value) {
      dp.value.dispose()
      dp.value = null
    }
    if (!streamUrl.value) {
      console.warn('initNPlayer: no streamUrl')
      return
    }
    if (!playerContainerRef.value) {
      console.warn('initNPlayer: container not ready, retrying...')
      setTimeout(initNPlayer, 100)
      return
    }

    // 获取弹幕
    let danmakuItems = []
    if (danmakuOid.value) {
      try {
        const res = await authFetch(`/api/bilibili/danmaku/?id=${danmakuOid.value}`)
        const data = await res.json()
        if (data.code === 0 && Array.isArray(data.data)) {
          danmakuItems = data.data.map(([time, type, color, , text]) => ({
            time: time,
            text: text,
            color: '#' + color.toString(16).padStart(6, '0'),
            type: type === 5 ? 'top' : type === 4 ? 'bottom' : 'scroll'
          })).sort((a, b) => a.time - b.time)
        }
      } catch (e) {
        console.warn('Failed to fetch danmaku:', e)
      }
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
    // 创建 NPlayer
    const player = new NPlayer({
      controls:[
        [
          "play",
          "volume",
          "time",
          "spacer",
          Quantity,
          "airplay",
          "settings",
          "web-fullscreen",
          "fullscreen"
        ],
        ["progress"]
      ],
      plugins:[danmaku]
    })

    dp.value = markRaw(player)

    dp.value.on('play', () => { isPlaying.value = true })
    dp.value.on('pause', () => { isPlaying.value = false })
    dp.value.on('ended', () => { isPlaying.value = false })

    // 使用 dash.js 加载后端生成的 MPD 清单
    const dashPlayerInstance = MediaPlayer().create()
    dashPlayerInstance.initialize(dp.value.video, streamUrl.value, true)
    let repLabelMap = new Map();
    dashPlayerInstance.on(MediaPlayer.events.MANIFEST_LOADED,(e=>{
      const adaptations = e.data.Period[0].AdaptationSet;
      const videoAdapt = adaptations.find(a =>
          a.contentType === 'video' || a.mimeType?.startsWith('video')
      );
      videoAdapt?.Representation?.forEach(rep => {
        const label = rep.Label?.[0].__text || rep.label
        repLabelMap.set(String(rep.id), label);
      });
    }))

    dashPlayerInstance.on(MediaPlayer.events.STREAM_INITIALIZED,()=>{
      // 获取所有清晰度，按分辨率从高到低排序
      dashPlayerInstance.getTracksFor()
      const levels = dashPlayerInstance.getRepresentationsByType('video')
      levels.sort((a, b) => b.height - a.height)
      const frag = document.createDocumentFragment()
      // 5. 切换清晰度的逻辑
      const listener = (index) => (init) => {
        // 更新高亮样式
        const prevEl = Quantity.itemElements[Quantity.value]
        const curEl = Quantity.itemElements[index]
        if (prevEl) prevEl.classList.remove('quantity_item-active')
        if (curEl) curEl.classList.add('quantity_item-active')

        Quantity.btn.textContent = index === -1 ? '自动' : (levels[index].label || curEl.textContent)
        Quantity.value = index
        Quantity.popover.hide()
        if (index === -1) {
          // 自动模式：开启 ABR 自适应
          dashPlayerInstance.updateSettings({
            streaming: {abr: {autoSwitchBitrate: {video: true, audio: true}}}
          })
        } else {
          // 手动模式：关闭 ABR，指定清晰度
          dashPlayerInstance.updateSettings({
            streaming: {abr: {autoSwitchBitrate: {video: false,audio: true}}}
          })
          // dash.js 的 index 对应排序后的原始 qualityIndex
          dashPlayerInstance.setRepresentationForTypeById('video', levels[index].id)
        }
      }
      // 6. 生成清晰度菜单项
      Quantity.itemElements = levels.map((l, i) => {
        const el = document.createElement('div')
        el.textContent = repLabelMap.get(String(i)) || l.height + 'P'
        el.classList.add('quantity_item')
        el.addEventListener('click', () => listener(i)())
        frag.appendChild(el)
        return el
      })
      dashPlayerInstance.on(MediaPlayer.events.QUALITY_CHANGE_REQUESTED, (e) => {
        console.log('切换请求:', e);
      });

      dashPlayerInstance.on(MediaPlayer.events.QUALITY_CHANGE_RENDERED, (e) => {
        console.log('切换生效:', e); // 实际渲染的新清晰度
      });

      // 7. 添加「自动」选项
      const autoEl = document.createElement('div')
      autoEl.textContent = '自动'
      autoEl.classList.add('quantity_item')
      autoEl.addEventListener('click', () => listener(-1)())
      frag.appendChild(autoEl)
      Quantity.itemElements.push(autoEl)

      Quantity.popover.panelEl.appendChild(frag)
      Quantity.el.style.display = 'block'

      // 初始化为自动模式
      listener(-1)(true)

      // 自动跳转到上次播放进度
      if (pendingSeekTime.value != null) {
        const seekTo = pendingSeekTime.value
        pendingSeekTime.value = null
        setTimeout(() => {
          if (dp.value && dp.value.video) {
            dp.value.video.currentTime = seekTo
          }
        }, 300)
      }
    })
    dp.value.mount(playerContainerRef.value)


    // 修复窗口动画完成前容器宽度为 0 导致弹幕不滚动
    setTimeout(() => {
      if (dp.value) dp.value.emit('resize')
    }, 300)

    // 监听容器尺寸变化
    if (playerResizeObserver) playerResizeObserver.disconnect()
    playerResizeObserver = new ResizeObserver(() => {
      if (dp.value) dp.value.emit('resize')
    })
    playerResizeObserver.observe(playerContainerRef.value)

    console.log('NPlayer + dash.js initialized')
  } catch (e) {
    console.error('initNPlayer error:', e)
  }
}

async function fetchStreamUrl() {
  if (!currentBvid.value || !currentCid.value) return
  try {
    // 后端生成的 MPD 清单 URL（包含代理后的视频/音频 BaseURL）
    const response = await authFetch(`/api/bilibili/mpd?bvid=${encodeURIComponent(currentBvid.value)}&cid=${currentCid.value}`)
    const mpdText = await response.text();
    const modified = mpdText.replaceAll('/api', `${window.location.origin}/api`);
    const blob = new Blob([modified], { type: 'application/dash+xml' });
    streamUrl.value = URL.createObjectURL(blob)

    // 等待 DOM 更新后初始化 NPlayer
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

function closePlayer() {
  // 上报观看进度
  try {
    const video = dp.value?.video
    const aid = currentVideo.value?.aid
    if (video && aid && currentCid.value) {
      const progress = Math.floor(video.currentTime)
      authFetch('/api/bilibili/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aid, cid: parseInt(currentCid.value), progress })
      }).catch(e => console.warn('Report progress failed:', e))
    }
  } catch (e) {
    console.warn('Report progress error:', e)
  }

  showPlayer.value = false
  if (dashPlayerInstance) {
    dashPlayerInstance.reset()
    dashPlayerInstance = null
  }
  if (playerResizeObserver) {
    playerResizeObserver.disconnect()
    playerResizeObserver = null
  }
  if (dp.value) {
    dp.value.dispose()
    dp.value = null
  }
  isPlaying.value = false
  currentVideo.value = null
  currentBvid.value = ''
  currentCid.value = ''
  streamUrl.value = ''
  danmakuOid.value = ''
  pageList.value = []
  currentPageIndex.value = 0
  pendingSeekTime.value = null
}

async function switchEpisode(index) {
  if (index === currentPageIndex.value) return
  const page = pageList.value[index]
  if (!page) return
  currentPageIndex.value = index
  currentCid.value = page.cid
  danmakuOid.value = page.cid
  pendingSeekTime.value = null
  loadingStream.value = true
  isPlaying.value = false
  if (dashPlayerInstance) {
    dashPlayerInstance.reset()
    dashPlayerInstance = null
  }
  if (dp.value) {
    dp.value.dispose()
    dp.value = null
  }

  // 获取该分集的播放进度（仅登录用户）
  if (bilibiliUser.value) {
    try {
      const lpRes = await authFetch(`/api/bilibili/lastplay?bvid=${encodeURIComponent(currentBvid.value)}&cid=${page.cid}`)
      const lpData = await lpRes.json()
      if (lpData.code === 0 && lpData.data) {
        const { last_play_time } = lpData.data
        if (last_play_time) {
          pendingSeekTime.value = last_play_time / 1000
        }
      }
    } catch (e) {
      console.warn('Failed to fetch last play info:', e)
    }
  }

  await fetchStreamUrl()
}

onMounted(() => {
  checkLoginStatus()
  nextTick(() => {
    if (resultsRef.value) {
      resultsHeight.value = resultsRef.value.getBoundingClientRect().height
      resultsResizeObserver = new ResizeObserver(entries => {
        resultsHeight.value = entries[0].contentRect.height
      })
      resultsResizeObserver.observe(resultsRef.value)
    }
  })
})

onUnmounted(() => {
  if (resultsResizeObserver) resultsResizeObserver.disconnect()
  if (playerResizeObserver) playerResizeObserver.disconnect()
  if (dp.value) {
    dp.value.dispose()
    dp.value = null
  }
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
})
</script>

<template>
  <div class="bilibili">
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
          <template v-else>
            <div ref="playerContainerRef" class="nplayer-container" :class="{ 'has-episodes': pageList.length > 1, 'episode-collapsed': pageList.length > 1 && episodeCollapsed }"></div>
            <div v-if="pageList.length > 1" class="episode-panel" :class="{ collapsed: episodeCollapsed }">
              <div class="episode-title">
                <button class="episode-toggle" @click="episodeCollapsed = !episodeCollapsed" :title="episodeCollapsed ? '展开选集' : '收起选集'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline v-if="episodeCollapsed" points="15 18 9 12 15 6"/>
                    <polyline v-else points="9 18 15 12 9 6"/>
                  </svg>
                </button>
                <span v-if="!episodeCollapsed">选集 ({{ pageList.length }})</span>
              </div>
              <div v-if="!episodeCollapsed" class="episode-list">
                <button
                  v-for="(page, idx) in pageList"
                  :key="page.cid"
                  class="episode-item"
                  :class="{ active: idx === currentPageIndex }"
                  @click="switchEpisode(idx)"
                >
                  <span class="episode-index">{{ idx + 1 }}</span>
                  <span class="episode-name">{{ page.part || `第${idx + 1}集` }}</span>
                  <span class="episode-dur">{{ formatDuration(page.duration ? formatSeconds(page.duration) : '') }}</span>
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </transition>

    <!-- 登录覆盖层 -->
    <transition name="player-fade">
      <div v-if="showLogin" class="login-overlay" @click.self="closeLogin()">
        <div class="login-panel">
          <div class="login-title">扫码登录哔哩哔哩</div>
          <div class="qr-area">
            <div v-if="qrStatus === 'loading'" class="qr-loading">
              <div class="loading-spinner"></div>
              <span>正在获取二维码...</span>
            </div>
            <template v-else>
              <img :src="qrCode" class="qr-image" />
              <div v-if="qrStatus === 'expired'" class="qr-expired-overlay">
                <span>二维码已过期</span>
                <button class="qr-refresh-btn" @click="startLogin()">点击刷新</button>
              </div>
              <div v-if="qrStatus === 'scanned'" class="qr-scanned-overlay">
                <span>已扫码，请在手机上确认</span>
              </div>
            </template>
          </div>
          <div class="login-status-text">
            <template v-if="qrStatus === 'waiting'">请使用哔哩哔哩 App 扫码</template>
            <template v-else-if="qrStatus === 'scanned'">请在手机上确认登录</template>
            <template v-else-if="qrStatus === 'expired'">二维码已过期</template>
            <template v-else-if="qrStatus === 'loading'">加载中...</template>
          </div>
          <button class="login-cancel-btn" @click="closeLogin()">取消</button>
        </div>
      </div>
    </transition>

    <!-- 页面切换标签 -->
    <div class="tab-bar">
      <button class="tab-item" :class="{ active: activeTab === 'search' }" @click="switchTab('search')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        搜索
      </button>
      <button v-if="bilibiliUser" class="tab-item" :class="{ active: activeTab === 'history' }" @click="switchTab('history')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        历史记录
      </button>
      <button v-if="bilibiliUser" class="tab-item" :class="{ active: activeTab === 'toview' }" @click="switchTab('toview')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        稍后再看
      </button>
      <div class="tab-spacer"></div>
      <button v-if="!bilibiliUser" class="login-btn" @click="startLogin()" title="登录哔哩哔哩">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </button>
      <div v-else class="user-info" @click="logout()" title="点击登出">
        <img v-if="bilibiliUser.avatar_url" :src="proxyAvatar(bilibiliUser.avatar_url)" class="user-avatar" />
        <span class="user-name">{{ bilibiliUser.nickname }}</span>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div v-if="activeTab === 'search'" class="search-bar">
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
    <div v-if="activeTab === 'search'" ref="resultsRef" class="results">
      <div v-if="loading" class="loading">搜索中...</div>

      <template v-if="!loading && pagedResults.length">
        <div class="result-list">
          <div
            v-for="video in pagedResults"
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

        <div v-if="totalPages > 1" class="pagination">
          <button class="page-btn" :disabled="localPage <= 1 || loading" @click="goToPage(localPage - 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ localPage }} / {{ totalPages }}</span>
          <button class="page-btn" :disabled="localPage >= totalPages || loading" @click="goToPage(localPage + 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </template>

      <div v-if="!loading && searched && !allResults.length" class="empty-state">
        <div class="empty-text">未找到相关视频</div>
      </div>

      <div v-if="!loading && !searched" class="empty-state">
        <div class="empty-icon">📺</div>
        <div class="empty-text">搜索视频开始播放</div>
      </div>
    </div>

    <!-- 历史记录 -->
    <div v-if="activeTab === 'history'" class="results">
      <div v-if="!bilibiliUser" class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-text">请先登录查看历史记录</div>
        <button class="login-prompt-btn" @click="startLogin()">登录</button>
      </div>

      <div v-else-if="historyLoading" class="loading">加载中...</div>

      <template v-else-if="!historyLoading && historyPageData.length">
        <div class="result-list">
          <div
            v-for="item in historyPageData"
            :key="item.kid"
            class="video-card"
            :class="{ active: currentBvid === (item.history?.bvid || '') }"
            @click="playVideo(historyToVideo(item))"
          >
            <div class="video-cover-wrap">
              <img
                v-if="item.cover"
                :src="proxyImg(item.cover)"
                class="video-cover"
                loading="lazy"
              />
              <div class="video-duration">{{ item.duration ? formatDurationFromSec(item.duration) : '' }}</div>
              <div v-if="item.progress != null && item.duration" class="video-progress-bar">
                <div class="video-progress-fill" :style="{ width: formatProgress(item.progress, item.duration) + '%' }"></div>
              </div>
            </div>
            <div class="video-info">
              <div class="video-title">{{ cleanTitle(item.title) }}</div>
              <div v-if="item.long_title || item.show_title" class="video-subtitle">{{ item.long_title || item.show_title }}</div>
              <div class="video-meta">
                <span v-if="item.author_name" class="video-author">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {{ item.author_name }}
                </span>
                <span v-if="item.badge" class="history-badge">{{ item.badge }}</span>
              </div>
              <div class="video-stats">
                <span class="video-date">{{ formatDate(item.view_at) }}</span>
                <span v-if="item.tag_name" class="stat-item">{{ item.tag_name }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="pagination">
          <button class="page-btn" :disabled="historyPage <= 1 || historyLoading" @click="historyGoToPage(historyPage - 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ historyPage }}</span>
          <button class="page-btn" :disabled="!historyHasMore || historyLoading" @click="historyGoToPage(historyPage + 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </template>

      <div v-else-if="!historyLoading && historyInited && !historyPageData.length" class="empty-state">
        <div class="empty-text">暂无观看历史</div>
      </div>
    </div>

    <!-- 稍后再看 -->
    <div v-if="activeTab === 'toview'" class="results">
      <div v-if="toviewLoading" class="loading">加载中...</div>

      <template v-else-if="!toviewLoading && toviewPagedData.length">
        <div class="result-list">
          <div
            v-for="item in toviewPagedData"
            :key="item.aid"
            class="video-card"
            :class="{ active: currentBvid === item.bvid }"
            @click="playVideo(toviewToVideo(item))"
          >
            <div class="video-cover-wrap">
              <img
                v-if="item.pic"
                :src="proxyImg(item.pic)"
                class="video-cover"
                loading="lazy"
              />
              <div class="video-duration">{{ item.duration ? formatDurationFromSec(item.duration) : '' }}</div>
              <div v-if="item.progress > 0 && item.duration" class="video-progress-bar">
                <div class="video-progress-fill" :style="{ width: formatProgress(item.progress, item.duration) + '%' }"></div>
              </div>
            </div>
            <div class="video-info">
              <div class="video-title">{{ cleanTitle(item.title) }}</div>
              <div class="video-meta">
                <span v-if="item.owner?.name" class="video-author">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {{ item.owner.name }}
                </span>
                <span v-if="item.tname" class="history-badge">{{ item.tname }}</span>
              </div>
              <div class="video-stats">
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {{ formatCount(item.stat?.view) }}
                </span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {{ formatCount(item.stat?.reply) }}
                </span>
                <span class="video-date">{{ formatDate(item.add_at) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="toviewTotalPages > 1" class="pagination">
          <button class="page-btn" :disabled="toviewPage <= 1" @click="toviewPage--">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ toviewPage }} / {{ toviewTotalPages }}</span>
          <button class="page-btn" :disabled="toviewPage >= toviewTotalPages" @click="toviewPage++">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </template>

      <div v-else-if="!toviewLoading && toviewInited && !toviewData.length" class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">稍后再看列表为空</div>
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

.nplayer-container {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
  position: absolute;
  inset: 0;
}

.nplayer-container.has-episodes {
  right: 220px;
  width: auto;
  transition: right 0.2s ease;
}

.nplayer-container.has-episodes.episode-collapsed {
  right: 36px;
}

/* 分集面板 */
.episode-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 210px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(10, 12, 20, 0.92);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 8px 8px 0;
  transition: width 0.2s ease;
}

.episode-panel.collapsed {
  width: 36px;
}

.episode-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.episode-toggle {
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

.episode-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.episode-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.episode-list::-webkit-scrollbar {
  width: 4px;
}

.episode-list::-webkit-scrollbar-track {
  background: transparent;
}

.episode-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.episode-item {
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

.episode-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.episode-item.active {
  background: rgba(0, 161, 214, 0.2);
  color: #00a1d6;
}

.episode-index {
  font-size: 11px;
  font-weight: 600;
  color: inherit;
  opacity: 0.6;
  width: 18px;
  flex-shrink: 0;
  text-align: center;
}

.episode-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-dur {
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
}

/* 确保 NPlayer 内部元素填满容器 */
:deep(.nplayer) {
  width: 100% !important;
  height: 100% !important;
}

:deep(.nplayer video) {
  object-fit: contain;
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
  overflow: hidden;
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

/* 登录覆盖层 */
.login-overlay {
  position: absolute;
  inset: 0;
  z-index: 200;
  background: rgba(10, 12, 20, 0.9);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-panel {
  background: rgba(20, 22, 35, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.login-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.qr-area {
  width: 200px;
  height: 200px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.qr-expired-overlay,
.qr-scanned-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  font-size: 13px;
}

.qr-refresh-btn {
  padding: 6px 16px;
  background: rgba(0, 161, 214, 0.8);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.qr-refresh-btn:hover {
  background: rgba(0, 161, 214, 1);
}

.login-status-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.login-cancel-btn {
  padding: 8px 24px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.login-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/* 登录按钮 */
.login-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}

.login-btn:hover {
  background: rgba(0, 161, 214, 0.2);
  color: #00a1d6;
  border-color: rgba(0, 161, 214, 0.3);
}

/* 用户信息 */
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.user-info:hover {
  background: rgba(0, 161, 214, 0.15);
  border-color: rgba(0, 161, 214, 0.3);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.user-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 标签栏 */
.tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.tab-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.tab-item.active {
  background: rgba(0, 161, 214, 0.2);
  border-color: rgba(0, 161, 214, 0.4);
  color: #00a1d6;
}

.tab-spacer {
  flex: 1;
}

/* 历史记录副标题 */
.video-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 历史记录角标 */
.history-badge {
  font-size: 11px;
  padding: 1px 6px;
  background: rgba(0, 161, 214, 0.2);
  color: #00a1d6;
  border-radius: 4px;
}

/* 观看进度条 */
.video-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
}

.video-progress-fill {
  height: 100%;
  background: #00a1d6;
  border-radius: 0 2px 2px 0;
  transition: width 0.2s;
}

/* 登录提示按钮 */
.login-prompt-btn {
  padding: 8px 24px;
  background: rgba(0, 161, 214, 0.5);
  border: 1px solid rgba(0, 161, 214, 0.4);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.login-prompt-btn:hover {
  background: rgba(0, 161, 214, 0.7);
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
:deep(.quantity:hover) {
  opacity: 1;
}
:deep(.quantity_item) {
  padding: 5px 20px;
  font-weight: normal;
}
:deep(.quantity_item:hover) {
  background: rgba(255, 255, 255, 0.3);
}
:deep(.quantity_item-active) {
  color: var(--theme-color);
}
</style>
