<script setup>
import { ref, computed, nextTick, inject, onMounted, onUnmounted, markRaw } from 'vue'
import BilibiliPlayer from './BilibiliPlayer.vue'

const authFetch = inject('authFetch')
const openWindow = inject('openWindow')
const closeWindow = inject('closeWindow')
const bringToFront = inject('bringToFront')
const windows = inject('windows')

let playerWindowId = null

function isPlayerWindowOpen() {
  return playerWindowId && windows.value.some(w => w.id === playerWindowId)
}

// 卡片高度(90封面+20padding+2border) + gap
const CARD_HEIGHT = 112
const CARD_GAP = 8
const PAGINATION_HEIGHT = 40
const DETAIL_HEADER_HEIGHT = 46 // 返回按钮+标题行高度(margin+padding+border)

// 结果区域高度 → 动态 pageSize
const resultsRef = ref(null)
const resultsHeight = ref(400)
const pageSize = computed(() => Math.max(1, Math.floor((resultsHeight.value - PAGINATION_HEIGHT) / (CARD_HEIGHT + CARD_GAP))))
const detailPageSize = computed(() => Math.max(1, Math.floor((resultsHeight.value - PAGINATION_HEIGHT - DETAIL_HEADER_HEIGHT) / (CARD_HEIGHT + CARD_GAP))))

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

// 登录状态
const bilibiliUser = ref(null)
const showLogin = ref(false)
const qrCode = ref('')
const qrStatus = ref(null)  // 'loading' | 'waiting' | 'scanned' | 'expired' | null
let qrPollTimer = null

// 页面切换
const activeTab = ref('recommend') // 'recommend' | 'search' | 'history' | 'toview'

// 推荐状态
const recommendData = ref([])
const recommendLoading = ref(false)
const recommendInited = ref(false)
const recommendPage = ref(1)
const recommendFreshIdx = ref(1)

// 历史记录状态（累积式分页，与搜索一致）
const allHistoryResults = ref([])
const historyTotal = ref(0)
const historyLocalPage = ref(1)
const historyApiPage = ref(0)  // 已加载到第几 API 页（游标页）
const historyCursors = ref([{ max: 0, business: '', view_at: 0 }])
const historyLoading = ref(false)
const historyInited = ref(false)

const historyPagedData = computed(() => {
  const start = (historyLocalPage.value - 1) * pageSize.value
  return allHistoryResults.value.slice(start, start + pageSize.value)
})

const historyTotalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / pageSize.value)))

// 稍后再看状态
const toviewData = ref([])
const toviewCount = ref(0)
const toviewLoading = ref(false)
const toviewInited = ref(false)
const toviewPage = ref(1)

// 收藏夹状态
const favoritesInited = ref(false)
const favoritesActiveView = ref('list') // 'list' | 'detail'
const favoritesData = ref([])
const favoritesLoading = ref(false)
const favoritesPage = ref(1)

const currentFolder = ref(null) // { id, title, media_count }
const favoritesDetailData = ref([])
const favoritesDetailLoading = ref(false)
const favoritesDetailPage = ref(1)
const favoritesDetailHasMore = ref(true)

const favoritesPagedData = computed(() => {
  const start = (favoritesPage.value - 1) * pageSize.value
  return favoritesData.value.slice(start, start + pageSize.value)
})

const favoritesTotalPages = computed(() => Math.max(1, Math.ceil(favoritesData.value.length / pageSize.value)))

const favoritesDetailPagedData = computed(() => {
  const start = (favoritesDetailPage.value - 1) * detailPageSize.value
  return favoritesDetailData.value.slice(start, start + detailPageSize.value)
})

const favoritesDetailTotalPages = computed(() => Math.max(1, Math.ceil(favoritesDetailData.value.length / detailPageSize.value)))

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

// 推荐分页
const recommendPagedData = computed(() => {
  const start = (recommendPage.value - 1) * pageSize.value
  return recommendData.value.slice(start, start + pageSize.value)
})

const recommendTotalPages = computed(() => Math.max(1, Math.ceil(recommendData.value.length / pageSize.value)))

// 获取推荐列表
async function fetchRecommend() {
  recommendLoading.value = true
  try {
    const res = await authFetch(`/api/bilibili/recommend?fresh_idx=${recommendFreshIdx.value}&ps=30`)
    const data = await res.json()
    if (data.code === 0 && data.data?.item) {
      // 过滤出普通视频（排除直播、OGV等）
      const videos = data.data.item.filter(item => item.goto === 'av')
      recommendData.value = [...recommendData.value, ...videos]
      recommendFreshIdx.value++
      recommendInited.value = true
    } else if (data.code === -101) {
      recommendInited.value = true
    }
  } catch (e) {
    console.error('Fetch recommend error:', e)
  }
  recommendLoading.value = false
}

// 推荐加载更多页
async function recommendLoadMore() {
  if (recommendLoading.value) return
  await fetchRecommend()
}

// 将推荐项转为播放所需格式
function recommendToVideo(item) {
  return {
    bvid: item.bvid || '',
    aid: item.id || 0,
    title: item.title || '',
    author: item.owner?.name || '',
    pic: item.pic || '',
    play: item.stat?.view || 0,
    favorites: 0,
    review: item.stat?.reply || 0,
    pubdate: item.pubdate || 0,
    duration: item.duration ? formatDurationFromSec(item.duration) : '',
    cid: item.cid || 0,
  }
}

// 推荐理由
function getRcmdReason(item) {
  if (!item.rcmd_reason) return ''
  if (item.rcmd_reason.reason_type === 1) return '已关注'
  if (item.rcmd_reason.reason_type === 3 && item.rcmd_reason.content) return item.rcmd_reason.content
  return ''
}

// 切换页面
function switchTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'recommend') {
    if (!recommendInited.value) {
      fetchRecommend()
    }
  } else if (tab === 'history') {
    allHistoryResults.value = []
    historyTotal.value = 0
    historyLocalPage.value = 1
    historyApiPage.value = 0
    historyCursors.value = [{ max: 0, business: '', view_at: 0 }]
    fetchHistory()
  } else if (tab === 'toview') {
    toviewPage.value = 1
    fetchToview()
  } else if (tab === 'favorites') {
    favoritesActiveView.value = 'list'
    currentFolder.value = null
    if (!favoritesInited.value) {
      fetchFavorites()
    }
  }
}

// 获取历史记录（累积式，与搜索 fetchApiPage 一致）
async function fetchHistory() {
  historyLoading.value = true
  try {
    const cursor = historyCursors.value[historyApiPage.value] || { max: 0, business: '', view_at: 0 }
    const params = new URLSearchParams({ ps: '20' })
    if (cursor.max) params.set('max', cursor.max)
    if (cursor.business) params.set('business', cursor.business)
    if (cursor.view_at) params.set('view_at', cursor.view_at)

    const res = await authFetch(`/api/bilibili/history?${params.toString()}`)
    const data = await res.json()
    if (data.code === 0 && data.data?.list) {
      allHistoryResults.value = [...allHistoryResults.value, ...data.data.list]
      historyTotal.value = allHistoryResults.value.length
      historyApiPage.value++
      historyInited.value = true

      // 存储下一页游标
      const nextCursor = data.data.cursor
      if (nextCursor && data.data.list.length > 0) {
        historyCursors.value[historyApiPage.value] = {
          max: nextCursor.max,
          business: nextCursor.business,
          view_at: nextCursor.view_at
        }
      }
    } else if (data.code === -101) {
      historyInited.value = true
    }
  } catch (e) {
    console.error('Fetch history error:', e)
  }
  historyLoading.value = false
}

async function historyGoToPage(page) {
  if (page < 1 || page > historyTotalPages.value) return
  // 检查是否需要加载更多 API 数据
  const needed = page * pageSize.value
  while (allHistoryResults.value.length < needed && (historyCursors.value[historyApiPage.value] || historyApiPage.value === 0)) {
    const prevLen = allHistoryResults.value.length
    await fetchHistory()
    // 如果没有新数据了，停止加载
    if (allHistoryResults.value.length === prevLen) break
  }
  historyLocalPage.value = page
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

// 获取收藏夹列表
async function fetchFavorites() {
  favoritesLoading.value = true
  try {
    const res = await authFetch('/api/bilibili/favorites')
    const data = await res.json()
    if (data.code === 0 && data.data?.list) {
      favoritesData.value = data.data.list
      favoritesInited.value = true
    } else if (data.code === -101) {
      favoritesData.value = []
      favoritesInited.value = true
    }
  } catch (e) {
    console.error('Fetch favorites error:', e)
  }
  favoritesLoading.value = false
}

// 打开收藏夹详情
async function openFolder(folder) {
  currentFolder.value = { id: folder.id, title: folder.title, media_count: folder.media_count }
  favoritesActiveView.value = 'detail'
  favoritesDetailData.value = []
  favoritesDetailPage.value = 1
  favoritesDetailHasMore.value = true
  await fetchFavoritesDetail()
}

// 返回收藏夹列表
function backToFavoritesList() {
  favoritesActiveView.value = 'list'
  currentFolder.value = null
  favoritesDetailData.value = []
}

// 获取收藏夹内容
async function fetchFavoritesDetail() {
  if (!currentFolder.value) return
  favoritesDetailLoading.value = true
  try {
    const pn = Math.ceil(favoritesDetailData.value.length / 20) + 1
    const res = await authFetch(`/api/bilibili/favorites/detail?media_id=${currentFolder.value.id}&pn=${pn}&ps=20`)
    const data = await res.json()
    if (data.code === 0 && data.data?.medias) {
      const videos = data.data.medias.filter(m => m.type === 2 && m.attr === 0)
      favoritesDetailData.value = [...favoritesDetailData.value, ...videos]
      favoritesDetailHasMore.value = !!data.data.has_more
    }
  } catch (e) {
    console.error('Fetch favorites detail error:', e)
  }
  favoritesDetailLoading.value = false
}

// 收藏夹视频加载更多
async function favoritesDetailLoadMore() {
  if (favoritesDetailLoading.value || !favoritesDetailHasMore.value) return
  await fetchFavoritesDetail()
}

async function favoritesDetailGoToPage(page) {
  if (page < 1 || page > favoritesDetailTotalPages.value) return
  const needed = page * detailPageSize.value
  while (favoritesDetailData.value.length < needed && favoritesDetailHasMore.value) {
    const prevLen = favoritesDetailData.value.length
    await fetchFavoritesDetail()
    if (favoritesDetailData.value.length === prevLen) break
  }
  favoritesDetailPage.value = page
}

// 将收藏夹视频项转为播放所需格式
function favoritesToVideo(item) {
  return {
    bvid: item.bvid || '',
    aid: item.id || 0,
    title: item.title || '',
    author: item.upper?.name || '',
    pic: item.cover || '',
    play: item.cnt_info?.play || 0,
    favorites: item.cnt_info?.collect || 0,
    review: 0,
    pubdate: item.pubtime || 0,
    duration: item.duration ? formatDurationFromSec(item.duration) : '',
    cid: 0,
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

// 添加稍后再看
async function addToToview(aid, event) {
  event.stopPropagation()
  try {
    const res = await authFetch('/api/bilibili/toview/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aid })
    })
    const data = await res.json()
    if (data.code === 0) {
      // 简单视觉反馈
      const btn = event.currentTarget
      btn.classList.add('toview-added')
      setTimeout(() => btn.classList.remove('toview-added'), 1500)
    } else {
      alert(data.message || '添加失败')
    }
  } catch (e) {
    console.error('Add to toview error:', e)
  }
}

// 点击播放视频 — 在独立窗口中打开播放器
async function playVideo(video) {
  // 同一视频 → 将已有窗口置顶
  if (currentBvid.value === video.bvid && isPlayerWindowOpen()) {
    bringToFront(playerWindowId)
    return
  }

  // 不同视频或窗口已关闭 → 关闭旧窗口（触发 onUnmounted 上报进度）
  if (isPlayerWindowOpen()) {
    closeWindow(playerWindowId)
  }
  playerWindowId = null

  currentVideo.value = video
  currentBvid.value = video.bvid

  // 获取分页列表
  let pageList
  try {
    const cidRes = await authFetch(`/api/bilibili/pagelist?bvid=${encodeURIComponent(video.bvid)}`)
    const cidData = await cidRes.json()
    if (cidData.code !== 0 || !cidData.data?.length) throw new Error('获取视频信息失败')
    pageList = cidData.data
  } catch (e) {
    console.error('Play video error:', e)
    alert('播放失败: ' + e.message)
    return
  }

  // 打开独立播放器窗口
  playerWindowId = openWindow({
    title: cleanTitle(video.title),
    icon: '📺',
    width: 1000,
    height: 650,
    component: markRaw(BilibiliPlayer),
    props: {
      bvid: video.bvid,
      aid: video.aid,
      title: video.title,
      pageList,
      initialCid: pageList[0].cid,
      isLoggedIn: !!bilibiliUser.value,
    },
  })
}

onMounted(() => {
  checkLoginStatus()
  fetchRecommend()
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
  if (playerWindowId) {
    closeWindow(playerWindowId)
    playerWindowId = null
  }
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
})
</script>

<template>
  <div class="bilibili">
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
      <button class="tab-item" :class="{ active: activeTab === 'recommend' }" @click="switchTab('recommend')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        推荐
      </button>
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
      <button v-if="bilibiliUser" class="tab-item" :class="{ active: activeTab === 'favorites' }" @click="switchTab('favorites')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        收藏夹
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

    <!-- 内容区域（统一容器，ResizeObserver 监听此元素） -->
    <div ref="resultsRef" class="results-wrapper">
    <!-- 推荐 -->
    <div v-if="activeTab === 'recommend'">
      <div v-if="recommendLoading && !recommendInited" class="loading">加载中...</div>

      <template v-else-if="!recommendLoading && recommendPagedData.length">
        <div class="result-list">
          <div
            v-for="item in recommendPagedData"
            :key="item.bvid"
            class="video-card"
            :class="{ active: currentBvid === item.bvid }"
            @click="playVideo(recommendToVideo(item))"
          >
            <div class="video-cover-wrap">
              <img
                v-if="item.pic"
                :src="proxyImg(item.pic)"
                class="video-cover"
                loading="lazy"
              />
              <div class="video-duration">{{ item.duration ? formatDurationFromSec(item.duration) : '' }}</div>
              <button v-if="bilibiliUser" class="toview-btn" @click="addToToview(item.aid, $event)" title="添加到稍后再看">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>
            </div>
            <div class="video-info">
              <div class="video-title">{{ cleanTitle(item.title) }}</div>
              <div v-if="getRcmdReason(item)" class="rcmd-reason">{{ getRcmdReason(item) }}</div>
              <div class="video-meta">
                <span v-if="item.owner?.name" class="video-author">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {{ item.owner.name }}
                </span>
              </div>
              <div class="video-stats">
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {{ formatCount(item.stat?.view) }}
                </span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {{ formatCount(item.stat?.danmaku) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="recommendTotalPages > 1" class="pagination">
          <button class="page-btn" :disabled="recommendPage <= 1" @click="recommendPage--">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ recommendPage }} / {{ recommendTotalPages }}</span>
          <button class="page-btn" :disabled="recommendPage >= recommendTotalPages" @click="recommendPage++">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button class="page-btn load-more-btn" :disabled="recommendLoading" @click="recommendLoadMore()" title="加载更多推荐">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </template>

      <div v-else-if="!recommendLoading && recommendInited && !recommendData.length" class="empty-state">
        <div class="empty-text">暂无推荐内容</div>
      </div>
    </div>

    <!-- 搜索结果 -->
    <div v-if="activeTab === 'search'">
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
              <button v-if="bilibiliUser" class="toview-btn" @click="addToToview(video.aid, $event)" title="添加到稍后再看">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>
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
    <div v-if="activeTab === 'history'">
      <div v-if="!bilibiliUser" class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-text">请先登录查看历史记录</div>
        <button class="login-prompt-btn" @click="startLogin()">登录</button>
      </div>

      <div v-else-if="historyLoading" class="loading">加载中...</div>

      <template v-else-if="!historyLoading && historyPagedData.length">
        <div class="result-list">
          <div
            v-for="item in historyPagedData"
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
              <button v-if="bilibiliUser" class="toview-btn" @click="addToToview(item.history?.oid, $event)" title="添加到稍后再看">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>
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

        <div v-if="historyTotalPages > 1" class="pagination">
          <button class="page-btn" :disabled="historyLocalPage <= 1 || historyLoading" @click="historyGoToPage(historyLocalPage - 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-info">{{ historyLocalPage }} / {{ historyTotalPages }}</span>
          <button class="page-btn" :disabled="historyLocalPage >= historyTotalPages || historyLoading" @click="historyGoToPage(historyLocalPage + 1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </template>

      <div v-else-if="!historyLoading && historyInited && !allHistoryResults.length" class="empty-state">
        <div class="empty-text">暂无观看历史</div>
      </div>
    </div>

    <!-- 稍后再看 -->
    <div v-if="activeTab === 'toview'">
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

    <!-- 收藏夹 -->
    <div v-if="activeTab === 'favorites'">
      <div v-if="!bilibiliUser" class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-text">请先登录查看收藏夹</div>
        <button class="login-prompt-btn" @click="startLogin()">登录</button>
      </div>

      <!-- 收藏夹列表 -->
      <template v-else-if="favoritesActiveView === 'list'">
        <div v-if="favoritesLoading" class="loading">加载中...</div>

        <template v-else-if="!favoritesLoading && favoritesPagedData.length">
          <div class="result-list">
            <div
              v-for="folder in favoritesPagedData"
              :key="folder.id"
              class="video-card folder-card"
              @click="openFolder(folder)"
            >
              <div class="video-cover-wrap">
                <img
                  v-if="folder.cover"
                  :src="proxyImg(folder.cover)"
                  class="video-cover"
                  loading="lazy"
                />
                <div v-else class="folder-cover-placeholder">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </div>
                <div class="folder-count-badge">{{ folder.media_count }}个视频</div>
              </div>
              <div class="video-info">
                <div class="video-title">{{ folder.title }}</div>
                <div class="video-meta">
                  <span v-if="folder.attr & 1" class="folder-private-badge">私密</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="favoritesTotalPages > 1" class="pagination">
            <button class="page-btn" :disabled="favoritesPage <= 1" @click="favoritesPage--">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="page-info">{{ favoritesPage }} / {{ favoritesTotalPages }}</span>
            <button class="page-btn" :disabled="favoritesPage >= favoritesTotalPages" @click="favoritesPage++">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </template>

        <div v-else-if="!favoritesLoading && favoritesInited && !favoritesData.length" class="empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-text">暂无收藏夹</div>
        </div>
      </template>

      <!-- 收藏夹详情 -->
      <template v-else-if="favoritesActiveView === 'detail'">
        <div class="favorites-detail-header">
          <button class="back-btn" @click="backToFavoritesList()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            返回
          </button>
          <span class="favorites-detail-title">{{ currentFolder?.title }}</span>
          <span class="favorites-detail-count">{{ currentFolder?.media_count }}个视频</span>
        </div>

        <div v-if="favoritesDetailLoading && !favoritesDetailData.length" class="loading">加载中...</div>

        <template v-else-if="favoritesDetailPagedData.length">
          <div class="result-list">
            <div
              v-for="item in favoritesDetailPagedData"
              :key="item.id"
              class="video-card"
              :class="{ active: currentBvid === item.bvid }"
              @click="playVideo(favoritesToVideo(item))"
            >
              <div class="video-cover-wrap">
                <img
                  v-if="item.cover"
                  :src="proxyImg(item.cover)"
                  class="video-cover"
                  loading="lazy"
                />
                <div class="video-duration">{{ item.duration ? formatDurationFromSec(item.duration) : '' }}</div>
                <button v-if="bilibiliUser" class="toview-btn" @click="addToToview(item.id, $event)" title="添加到稍后再看">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </button>
              </div>
              <div class="video-info">
                <div class="video-title">{{ cleanTitle(item.title) }}</div>
                <div class="video-meta">
                  <span v-if="item.upper?.name" class="video-author">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    {{ item.upper.name }}
                  </span>
                </div>
                <div class="video-stats">
                  <span class="stat-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {{ formatCount(item.cnt_info?.play) }}
                  </span>
                  <span class="stat-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {{ formatCount(item.cnt_info?.danmaku) }}
                  </span>
                  <span class="video-date">{{ formatDate(item.fav_time) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="pagination">
            <button class="page-btn" :disabled="favoritesDetailPage <= 1 || favoritesDetailLoading" @click="favoritesDetailGoToPage(favoritesDetailPage - 1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="page-info">{{ favoritesDetailPage }} / {{ favoritesDetailTotalPages }}</span>
            <button class="page-btn" :disabled="favoritesDetailPage >= favoritesDetailTotalPages || favoritesDetailLoading" @click="favoritesDetailGoToPage(favoritesDetailPage + 1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button v-if="favoritesDetailHasMore" class="page-btn load-more-btn" :disabled="favoritesDetailLoading" @click="favoritesDetailLoadMore()" title="加载更多">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </template>

        <div v-else-if="!favoritesDetailLoading && !favoritesDetailData.length" class="empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-text">收藏夹为空</div>
        </div>
      </template>
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
.results-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

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

.toview-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.video-card:hover .toview-btn {
  opacity: 1;
}

.toview-btn:hover {
  background: rgba(0, 161, 214, 0.8);
  color: #fff;
}

.toview-btn.toview-added {
  opacity: 1;
  background: rgba(0, 161, 214, 0.9);
  color: #fff;
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

/* 推荐理由 */
.rcmd-reason {
  font-size: 11px;
  padding: 1px 6px;
  background: rgba(251, 114, 153, 0.15);
  color: #fb7299;
  border-radius: 4px;
  display: inline-block;
}

/* 加载更多按钮 */
.load-more-btn {
  margin-left: 4px;
  background: rgba(0, 161, 214, 0.2);
  border-color: rgba(0, 161, 214, 0.3);
}

.load-more-btn:hover:not(:disabled) {
  background: rgba(0, 161, 214, 0.4);
  color: #fff;
  border-color: rgba(0, 161, 214, 0.5);
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

/* 收藏夹文件夹卡片 */
.folder-card .video-cover-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(255, 255, 255, 0.2);
}

.folder-count-badge {
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

.folder-private-badge {
  font-size: 11px;
  padding: 1px 6px;
  background: rgba(251, 114, 153, 0.15);
  color: #fb7299;
  border-radius: 4px;
}

/* 收藏夹详情头部 */
.favorites-detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.favorites-detail-title {
  font-size: 15px;
  font-weight: 500;
  color: #fff;
}

.favorites-detail-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
