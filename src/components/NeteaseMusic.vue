<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, inject } from 'vue'

const authFetch = inject('authFetch')
const authToken = inject('authToken')

const query = ref('')
const songs = ref([])
const songCount = ref(0)
const loading = ref(false)
const searched = ref(false)

// 播放状态
const currentSong = ref(null)
const isPlaying = ref(false)
const audioRef = ref(null)
const savedVolume = ref(1)
let applyingVolume = false

// 登录状态
const neteaseUser = ref(null) // { nickname, avatar_url } 或 null
const showLogin = ref(false)
const qrCode = ref('')
const qrStatus = ref(null) // 'loading' | 'waiting' | 'scanned' | 'expired' | null
let qrPollTimer = null

// 音量持久化
let volumeDebounce = null
function loadVolume() {
  authFetch('/api/data/netease-volume').then(r => r.json()).then(data => {
    if (typeof data?.volume === 'number') {
      savedVolume.value = data.volume
      if (audioRef.value) audioRef.value.volume = data.volume
    }
  }).catch(() => {})
}
function saveVolume(vol) {
  clearTimeout(volumeDebounce)
  volumeDebounce = setTimeout(() => {
    authFetch('/api/data/netease-volume', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: vol }),
    }).catch(() => {})
  }, 500)
}
function onVolumeChange() {
  if (!audioRef.value || applyingVolume) return
  const vol = audioRef.value.volume
  savedVolume.value = vol
  saveVolume(vol)
}
function applyVolume() {
  if (!audioRef.value) return
  applyingVolume = true
  audioRef.value.volume = savedVolume.value
  setTimeout(() => { applyingVolume = false }, 0)
}

// 播放列表持久化
let playlistDebounce = null
function loadPlaylist() {
  authFetch('/api/data/netease-playlist').then(r => r.json()).then(data => {
    if (Array.isArray(data?.playlist)) playlist.value = data.playlist
    if (typeof data?.playlistIndex === 'number') playlistIndex.value = data.playlistIndex
    if (data?.playMode) playMode.value = data.playMode
  }).catch(() => {})
}
function savePlaylist() {
  clearTimeout(playlistDebounce)
  playlistDebounce = setTimeout(() => {
    authFetch('/api/data/netease-playlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playlist: playlist.value,
        playlistIndex: playlistIndex.value,
        playMode: playMode.value,
      }),
    }).catch(() => {})
  }, 500)
}
function cyclePlayMode() {
  const modes = ['sequence', 'loop', 'single', 'shuffle']
  playMode.value = modes[(modes.indexOf(playMode.value) + 1) % modes.length]
  savePlaylist()
}

// 歌词
const showLyrics = ref(false)
const lyrics = ref([])
const tlyrics = ref([])
const currentTime = ref(0)
const activeLyricIndex = ref(-1)
const lyricsContainerRef = ref(null)

// 播放列表
const playlist = ref([]) // [{ id, name, artists, album, duration, fee }]
const playlistIndex = ref(-1)
const playMode = ref('sequence') // 'sequence' | 'loop' | 'single' | 'shuffle'
const showPlaylist = ref(false)

// 收藏状态
const isLiked = ref(false)

function scrollToCurrentSong() {
  if (playlistIndex.value < 0) return
  // transition + v-if needs extra time for DOM to be ready
  setTimeout(() => {
    const activeEl = document.querySelector('.playlist-body .playlist-item.active')
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, 50)
}

watch(showPlaylist, (val) => {
  if (val) scrollToCurrentSong()
})

// 歌单
const currentTab = ref('search') // 'search' | 'playlists' | 'daily'
const showPlaylistDetail = ref(false)
const userPlaylists = ref([])
const playlistDetail = ref(null) // { id, name, coverImgUrl, songs }
const loadingPlaylists = ref(false)
const loadingPlaylistDetail = ref(false)

// 每日推荐
const dailySongs = ref([])
const loadingDaily = ref(false)

async function switchTab(tab) {
  currentTab.value = tab
  if (tab === 'playlists' && !userPlaylists.value.length && !loadingPlaylists.value) {
    await fetchUserPlaylists()
  }
  if (tab === 'daily' && !dailySongs.value.length && !loadingDaily.value) {
    await fetchDailySongs()
  }
}

async function fetchUserPlaylists() {
  loadingPlaylists.value = true
  try {
    const res = await authFetch('/api/netease/user/playlist')
    const data = await res.json()
    userPlaylists.value = data.playlists || []
  } catch {
    userPlaylists.value = []
  }
  loadingPlaylists.value = false
}

async function fetchPlaylistDetail(id) {
  loadingPlaylistDetail.value = true
  showPlaylistDetail.value = true
  try {
    const res = await authFetch(`/api/netease/playlist/detail?id=${id}`)
    const data = await res.json()
    playlistDetail.value = data
  } catch {
    playlistDetail.value = null
  }
  loadingPlaylistDetail.value = false
}

function backToPlaylists() {
  showPlaylistDetail.value = false
}

async function fetchDailySongs() {
  loadingDaily.value = true
  try {
    const res = await authFetch('/api/netease/recommend/songs')
    const data = await res.json()
    dailySongs.value = data.songs || []
  } catch {
    dailySongs.value = []
  }
  loadingDaily.value = false
}

function playAllFromDaily() {
  if (!dailySongs.value.length) return
  playlist.value = dailySongs.value.map(s => ({ ...s }))
  if (playMode.value === 'shuffle') {
    playlistIndex.value = Math.floor(Math.random() * playlist.value.length)
  } else {
    playlistIndex.value = 0
  }
  savePlaylist()
  activateSong(playlist.value[playlistIndex.value])
}

function playAllFromPlaylist() {
  if (!playlistDetail.value?.songs?.length) return
  playlist.value = playlistDetail.value.songs.map(s => ({ ...s }))
  if (playMode.value === 'shuffle') {
    playlistIndex.value = Math.floor(Math.random() * playlist.value.length)
  } else {
    playlistIndex.value = 0
  }
  savePlaylist()
  activateSong(playlist.value[playlistIndex.value])
}

// 格式化时长 ms → mm:ss
function formatDuration(ms) {
  if (!ms) return '--:--'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

// 搜索
async function search() {
  const q = query.value.trim()
  if (!q) return
  loading.value = true
  searched.value = true
  try {
    const res = await authFetch(`/api/netease/search?keywords=${encodeURIComponent(q)}`)
    const data = await res.json()
    songs.value = data.songs || []
    songCount.value = data.songCount || 0
  } catch (e) {
    songs.value = []
    songCount.value = 0
  }
  loading.value = false
}

// 播放
function playSong(song) {
  if (currentSong.value?.id === song.id) {
    if (audioRef.value) {
      if (isPlaying.value) {
        audioRef.value.pause()
      } else {
        audioRef.value.play()
      }
    }
    return
  }

  // 加入播放列表
  const idx = playlist.value.findIndex(s => s.id === song.id)
  if (idx >= 0) {
    playlistIndex.value = idx
  } else {
    const item = { id: song.id, name: song.name, artists: song.artists, album: song.album, duration: song.duration, fee: song.fee }
    playlist.value.push(item)
    playlistIndex.value = playlist.value.length - 1
  }
  savePlaylist()
  activateSong(song)
}

function playSongAt(index) {
  if (index < 0 || index >= playlist.value.length) return
  playlistIndex.value = index
  savePlaylist()
  activateSong(playlist.value[index])
}

function activateSong(song) {
  currentSong.value = song
  lyrics.value = []
  tlyrics.value = []
  activeLyricIndex.value = -1
  isLiked.value = false
  fetchLyrics(song.id)
  checkLiked(song.id)
  setTimeout(() => {
    if (audioRef.value) {
      audioRef.value.play().catch(() => {})
    }
  }, 50)
}

async function checkLiked(id) {
  try {
    const res = await authFetch(`/api/netease/like/check?id=${id}`)
    const data = await res.json()
    isLiked.value = !!data.liked
  } catch {
    isLiked.value = false
  }
}

async function toggleLike() {
  if (!currentSong.value) return
  const newLiked = !isLiked.value
  isLiked.value = newLiked // optimistic update
  try {
    const res = await authFetch('/api/netease/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentSong.value.id, like: newLiked }),
    })
    const data = await res.json()
    if (!data.ok) isLiked.value = !newLiked // rollback on failure
  } catch {
    isLiked.value = !newLiked // rollback on error
  }
}

function removeFromPlaylist(index) {
  playlist.value.splice(index, 1)
  if (index < playlistIndex.value) {
    playlistIndex.value--
  } else if (index === playlistIndex.value) {
    if (playlist.value.length === 0) {
      playlistIndex.value = -1
      currentSong.value = null
      isPlaying.value = false
    } else {
      const next = Math.min(index, playlist.value.length - 1)
      playSongAt(next)
    }
  }
  savePlaylist()
}

function prevSong() {
  if (!playlist.value.length) return
  if (playMode.value === 'single') {
    if (audioRef.value) {
      audioRef.value.currentTime = 0
      audioRef.value.play().catch(() => {})
    }
    return
  }
  if (playMode.value === 'shuffle') {
    if (playlist.value.length === 1) {
      playSongAt(0)
    } else {
      let idx
      do { idx = Math.floor(Math.random() * playlist.value.length) } while (idx === playlistIndex.value)
      playSongAt(idx)
    }
    return
  }
  // sequence / loop
  const prev = playlistIndex.value - 1
  if (prev >= 0) {
    playSongAt(prev)
  } else if (playMode.value === 'loop') {
    playSongAt(playlist.value.length - 1)
  }
}

function nextSong() {
  if (!playlist.value.length) return
  if (playMode.value === 'single') {
    if (audioRef.value) {
      audioRef.value.currentTime = 0
      audioRef.value.play().catch(() => {})
    }
    return
  }
  if (playMode.value === 'shuffle') {
    if (playlist.value.length === 1) {
      playSongAt(0)
    } else {
      let idx
      do { idx = Math.floor(Math.random() * playlist.value.length) } while (idx === playlistIndex.value)
      playSongAt(idx)
    }
    return
  }
  // sequence / loop
  const next = playlistIndex.value + 1
  if (next < playlist.value.length) {
    playSongAt(next)
  } else if (playMode.value === 'loop') {
    playSongAt(0)
  }
}

function onPlay() { isPlaying.value = true }
function onPause() { isPlaying.value = false }
function onEnded() {
  isPlaying.value = false
  nextSong()
}

// ── 歌词 ──
async function fetchLyrics(id) {
  try {
    const res = await authFetch(`/api/netease/lyric?id=${id}`)
    const data = await res.json()
    lyrics.value = parseLRC(data.lrc || '')
    tlyrics.value = parseLRC(data.tlyric || '')
  } catch (e) {
    lyrics.value = []
    tlyrics.value = []
  }
}

function parseLRC(lrcText) {
  const lines = lrcText.split('\n')
  const result = []
  const timeReg = /\[(\d{2}):(\d{2})[.:](\d{1,3})\]/
  for (const line of lines) {
    const match = timeReg.exec(line)
    if (!match) continue
    const min = parseInt(match[1])
    const sec = parseInt(match[2])
    const frac = match[3].padEnd(3, '0')
    // [mm:ss:ff] 冒号分隔时 ff 是百分秒，[mm:ss.xxx] 点号分隔时是毫秒
    const ms = match[3].length === 2 && line[5] === ':'
      ? parseInt(frac) * 10
      : parseInt(frac)
    const time = min * 60 + sec + ms / 1000
    const text = line.replace(/\[.*?\]/g, '').trim()
    if (text) result.push({ time, text })
  }
  return result
}

function getTlyricText(time) {
  if (!tlyrics.value.length) return ''
  let lo = 0, hi = tlyrics.value.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tlyrics.value[mid].time <= time) { best = mid; lo = mid + 1 }
    else { hi = mid - 1 }
  }
  if (best >= 0 && time - tlyrics.value[best].time < 1) return tlyrics.value[best].text
  return ''
}

function onTimeUpdate() {
  if (!audioRef.value) return
  currentTime.value = audioRef.value.currentTime
  let idx = -1
  for (let i = lyrics.value.length - 1; i >= 0; i--) {
    if (currentTime.value >= lyrics.value[i].time) {
      idx = i
      break
    }
  }
  if (idx !== activeLyricIndex.value) {
    activeLyricIndex.value = idx
    scrollToActiveLyric()
  }
}

function scrollToActiveLyric() {
  if (!lyricsContainerRef.value || activeLyricIndex.value < 0) return
  nextTick(() => {
    const container = lyricsContainerRef.value
    const activeEl = container.querySelector('.lyric-line.active')
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

function seekToLyric(time) {
  if (audioRef.value) {
    audioRef.value.currentTime = time
    if (!isPlaying.value) audioRef.value.play().catch(() => {})
  }
}

function toggleLyrics() {
  showLyrics.value = !showLyrics.value
  if (showLyrics.value) nextTick(() => scrollToActiveLyric())
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') search()
}

// ── 登录 ──
async function checkLoginStatus() {
  try {
    const res = await authFetch('/api/netease/login/status')
    const data = await res.json()
    if (data.loggedIn) {
      neteaseUser.value = { nickname: data.nickname, avatar_url: data.avatar_url }
    } else {
      neteaseUser.value = null
    }
  } catch {
    neteaseUser.value = null
  }
}

async function startLogin() {
  showLogin.value = true
  qrCode.value = ''
  qrStatus.value = 'loading'
  clearInterval(qrPollTimer)

  try {
    // 1. 获取 unikey
    const keyRes = await authFetch('/api/netease/qr/key')
    const keyData = await keyRes.json()
    if (!keyData.unikey) {
      qrStatus.value = 'expired'
      return
    }

    // 2. 生成 QR 码
    const createRes = await authFetch(`/api/netease/qr/create?key=${encodeURIComponent(keyData.unikey)}`)
    const createData = await createRes.json()
    if (!createData.qrimg) {
      qrStatus.value = 'expired'
      return
    }
    qrCode.value = createData.qrimg
    qrStatus.value = 'waiting'

    // 3. 轮询状态
    qrPollTimer = setInterval(async () => {
      try {
        const checkRes = await authFetch(`/api/netease/qr/check?key=${encodeURIComponent(keyData.unikey)}`)
        const checkData = await checkRes.json()
        if (checkData.code === 802) {
          qrStatus.value = 'scanned'
        } else if (checkData.code === 803) {
          // 登录成功
          clearInterval(qrPollTimer)
          qrStatus.value = null
          showLogin.value = false
          await checkLoginStatus()
        } else if (checkData.code === 800) {
          // 过期
          clearInterval(qrPollTimer)
          qrStatus.value = 'expired'
        }
      } catch {
        clearInterval(qrPollTimer)
        qrStatus.value = 'expired'
      }
    }, 2000)
  } catch {
    qrStatus.value = 'expired'
  }
}

function closeLogin() {
  showLogin.value = false
  clearInterval(qrPollTimer)
}

async function logout() {
  try {
    await authFetch('/api/netease/logout', { method: 'POST' })
  } catch {}
  neteaseUser.value = null
}

// 图片代理：将网易云图片 URL 通过后端转发
function proxyImg(url) {
  if (!url) return ''
  return `/api/netease/image?url=${encodeURIComponent(url)}`
}

onMounted(() => {
  loadVolume()
  loadPlaylist()
  checkLoginStatus()
})

onUnmounted(() => {
  if (audioRef.value) {
    audioRef.value.pause()
    audioRef.value.src = ''
  }
  clearInterval(qrPollTimer)
})
</script>

<template>
  <div class="netease">
    <!-- 登录覆盖层 -->
    <transition name="lyrics-fade">
      <div v-if="showLogin" class="login-overlay" @click.self="closeLogin()">
        <div class="login-panel">
          <div class="login-title">扫码登录网易云音乐</div>
          <div class="qr-area">
            <div v-if="qrStatus === 'loading'" class="qr-loading">正在获取二维码...</div>
            <img v-else-if="qrCode && qrStatus !== 'expired'" :src="qrCode" class="qr-img" />
            <div v-else-if="qrStatus === 'expired'" class="qr-expired">
              <div class="qr-expired-text">二维码已过期</div>
              <button class="qr-refresh-btn" @click="startLogin()">刷新</button>
            </div>
          </div>
          <div class="qr-status-text">
            <template v-if="qrStatus === 'waiting'">请使用网易云音乐 App 扫码</template>
            <template v-else-if="qrStatus === 'scanned'">请在手机上确认登录</template>
            <template v-else-if="qrStatus === 'expired'">二维码已过期，请刷新</template>
          </div>
          <button class="login-close-btn" @click="closeLogin()">取消</button>
        </div>
      </div>
    </transition>

    <!-- 歌词全屏覆盖层 -->
    <transition name="lyrics-fade">
      <div v-if="showLyrics && currentSong" class="lyrics-overlay" @click="toggleLyrics()">
        <div class="lyrics-header">
          <div class="lyrics-song-name">{{ currentSong.name }}</div>
          <div class="lyrics-artist">{{ currentSong.artists }}</div>
        </div>
        <div class="lyrics-body" ref="lyricsContainerRef" @click.stop>
          <div v-if="!lyrics.length" class="lyrics-empty">暂无歌词</div>
          <div
            v-for="(line, i) in lyrics"
            :key="i"
            class="lyric-line"
            :class="{ active: i === activeLyricIndex }"
            @click="seekToLyric(line.time)"
          >{{ line.text }}<div v-if="getTlyricText(line.time)" class="lyric-translation">{{ getTlyricText(line.time) }}</div></div>
        </div>
        <div class="lyrics-hint">点击歌词跳转 · 点击空白处或歌名返回</div>
      </div>
    </transition>

    <!-- 播放列表覆盖层 -->
    <transition name="lyrics-fade">
      <div v-if="showPlaylist" class="playlist-overlay" @click.self="showPlaylist = false">
        <div class="playlist-panel">
          <div class="playlist-header">
            <span class="playlist-title">播放列表</span>
            <span class="playlist-count">{{ playlist.length }} 首歌曲</span>
          </div>
          <div class="playlist-body">
            <div v-if="!playlist.length" class="playlist-empty">播放列表为空</div>
            <div
              v-for="(song, i) in playlist"
              :key="song.id"
              class="playlist-item"
              :class="{ active: i === playlistIndex }"
              @click="playSongAt(i)"
            >
              <div class="playlist-item-name">
                <span class="play-indicator">
                  <svg v-if="i === playlistIndex && isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span class="playlist-item-song-name">{{ song.name }}</span>
                <span v-if="song.fee === 1" class="fee-badge vip">VIP</span>
                <span v-else-if="song.fee === 4" class="fee-badge paid">付费专辑</span>
              </div>
              <span class="playlist-item-artist">{{ song.artists }}</span>
              <span class="playlist-item-duration">{{ formatDuration(song.duration) }}</span>
              <button class="playlist-item-remove" @click.stop="removeFromPlaylist(i)" title="移除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 歌单详情覆盖层 -->
    <transition name="lyrics-fade">
      <div v-if="showPlaylistDetail" class="playlist-overlay" @click.self="showPlaylistDetail = false">
        <div class="playlist-panel">
          <div class="playlist-detail-header">
            <button class="pd-back-btn" @click="backToPlaylists()" title="返回歌单列表">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="playlist-title">{{ playlistDetail?.name || '' }}</span>
            <span class="playlist-count">{{ playlistDetail?.songs?.length || 0 }} 首</span>
            <button class="pd-play-all-btn" @click="playAllFromPlaylist()" title="全部播放">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              全部播放
            </button>
          </div>
          <div class="playlist-body">
            <div v-if="loadingPlaylistDetail" class="loading">加载中...</div>
            <div v-else-if="!playlistDetail?.songs?.length" class="playlist-empty">暂无歌曲</div>
            <div
              v-for="(song, i) in playlistDetail?.songs || []"
              :key="song.id"
              class="playlist-item"
              :class="{ active: currentSong?.id === song.id }"
              @click="playSong(song)"
            >
              <div class="playlist-item-name">
                <span class="play-indicator">
                  <svg v-if="currentSong?.id === song.id && isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span class="playlist-item-song-name">{{ song.name }}</span>
                <span v-if="song.fee === 1" class="fee-badge vip">VIP</span>
                <span v-else-if="song.fee === 4" class="fee-badge paid">付费专辑</span>
              </div>
              <span class="playlist-item-artist">{{ song.artists }}</span>
              <span class="playlist-item-duration">{{ formatDuration(song.duration) }}</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Tab 切换栏 -->
    <div class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'search' }"
        @click="switchTab('search')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        搜索
      </button>
      <button
        v-if="neteaseUser"
        class="tab-btn"
        :class="{ active: currentTab === 'playlists' }"
        @click="switchTab('playlists')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        歌单
      </button>
      <button
        v-if="neteaseUser"
        class="tab-btn"
        :class="{ active: currentTab === 'daily' }"
        @click="switchTab('daily')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        每日推荐
      </button>
      <!-- 用户登录按钮/头像 -->
      <div class="user-area">
        <button v-if="!neteaseUser" class="login-btn" @click="startLogin()" title="登录网易云音乐">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </button>
        <div v-else class="user-info" @click="logout()" title="点击退出登录">
          <img v-if="neteaseUser.avatar_url" :src="proxyImg(neteaseUser.avatar_url)" class="user-avatar" />
          <span class="user-name">{{ neteaseUser.nickname }}</span>
        </div>
      </div>
    </div>

    <!-- 搜索页面 -->
    <div v-show="currentTab === 'search'" class="page-content">
      <!-- 搜索栏 -->
      <div class="search-bar">
        <input
          v-model="query"
          type="text"
          class="search-input"
          placeholder="搜索歌曲、歌手..."
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

        <template v-if="!loading && songs.length">
          <div class="result-header">
            <span class="col-name">歌曲</span>
            <span class="col-artist">歌手</span>
            <span class="col-album">专辑</span>
            <span class="col-duration">时长</span>
          </div>
          <div
            v-for="song in songs"
            :key="song.id"
            class="song-row"
            :class="{ active: currentSong?.id === song.id, playing: currentSong?.id === song.id && isPlaying }"
            @dblclick="playSong(song)"
            @click="playSong(song)"
          >
            <div class="col-name">
              <span class="play-indicator">
                <svg v-if="currentSong?.id === song.id && isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
              <span class="song-name">{{ song.name }}</span>
              <span v-if="song.fee === 1" class="fee-badge vip">VIP</span>
              <span v-else-if="song.fee === 4" class="fee-badge paid">付费专辑</span>
            </div>
            <span class="col-artist">{{ song.artists }}</span>
            <span class="col-album">{{ song.album }}</span>
            <span class="col-duration">{{ formatDuration(song.duration) }}</span>
          </div>
        </template>

        <div v-if="!loading && searched && !songs.length" class="empty-state">
          <div class="empty-text">未找到相关歌曲</div>
        </div>

        <div v-if="!loading && !searched" class="empty-state">
          <div class="empty-icon"> </div>
          <div class="empty-text">搜索歌曲开始播放</div>
        </div>
      </div>
    </div>

    <!-- 歌单页面 -->
    <div v-show="currentTab === 'playlists'" class="page-content">
      <div class="results">
        <div v-if="loadingPlaylists" class="loading">加载中...</div>
        <div v-else-if="!userPlaylists.length" class="empty-state">
          <div class="empty-text">暂无歌单</div>
        </div>
        <div
          v-for="pl in userPlaylists"
          :key="pl.id"
          class="user-playlist-item"
          @click="fetchPlaylistDetail(pl.id)"
        >
          <img v-if="pl.coverImgUrl" :src="proxyImg(pl.coverImgUrl)" class="user-playlist-cover" />
          <div class="user-playlist-info">
            <div class="user-playlist-name">{{ pl.name }}</div>
            <div class="user-playlist-count">{{ pl.trackCount }} 首</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 每日推荐页面 -->
    <div v-show="currentTab === 'daily'" class="page-content">
      <div class="results">
        <div v-if="loadingDaily" class="loading">加载中...</div>
        <div v-else-if="!dailySongs.length" class="empty-state">
          <div class="empty-text">暂无推荐歌曲</div>
        </div>
        <template v-else>
          <div class="playlist-detail-header">
            <span class="playlist-detail-name">每日推荐</span>
            <button class="pd-play-all-btn" @click="playAllFromDaily()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              播放全部
            </button>
          </div>
          <div class="result-header">
            <span class="col-name">歌曲</span>
            <span class="col-artist">歌手</span>
            <span class="col-album">专辑</span>
            <span class="col-duration">时长</span>
          </div>
          <div
            v-for="song in dailySongs"
            :key="song.id"
            class="song-row"
            :class="{ active: currentSong?.id === song.id, playing: currentSong?.id === song.id && isPlaying }"
            @dblclick="playSong(song)"
            @click="playSong(song)"
          >
            <div class="col-name">
              <span class="play-indicator">
                <svg v-if="currentSong?.id === song.id && isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
              <span class="song-name">{{ song.name }}</span>
              <span v-if="song.fee === 1" class="fee-badge vip">VIP</span>
              <span v-else-if="song.fee === 4" class="fee-badge paid">付费专辑</span>
            </div>
            <span class="col-artist">{{ song.artists }}</span>
            <span class="col-album">{{ song.album }}</span>
            <span class="col-duration">{{ formatDuration(song.duration) }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- 播放控制栏 -->
    <div class="player-bar">
      <template v-if="currentSong">
        <div class="player-info">
          <div class="player-song-name" @click="toggleLyrics()" :title="showLyrics ? '关闭歌词' : '查看歌词'">{{ currentSong.name }}</div>
          <div class="player-artist">{{ currentSong.artists }}</div>
        </div>
        <audio
          ref="audioRef"
          :src="`/api/netease/stream?id=${currentSong.id}&token=${authToken}`"
          controls
          class="audio-player"
          @play="onPlay"
          @pause="onPause"
          @ended="onEnded"
          @timeupdate="onTimeUpdate"
          @volumechange="onVolumeChange"
          @loadedmetadata="applyVolume"
        />
      </template>
      <div v-else class="player-empty">未在播放</div>
      <div class="player-controls">
        <button v-if="currentSong" class="player-side-btn" :class="{ active: isLiked }" @click="toggleLike()" :title="isLiked ? '取消收藏' : '收藏'">
          <!-- 已收藏：实心心形 -->
          <svg v-if="isLiked" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <!-- 未收藏：空心心形 -->
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="player-side-btn" @click="cyclePlayMode()" :title="{sequence:'顺序播放',loop:'列表循环',single:'单曲循环',shuffle:'随机播放'}[playMode]">
          <!-- 顺序播放 -->
          <svg v-if="playMode === 'sequence'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="8" x2="19" y2="8"/><polyline points="14 3 19 8 14 13"/><line x1="5" y1="16" x2="19" y2="16"/><polyline points="14 11 19 16 14 21"/></svg>
          <!-- 列表循环 -->
          <svg v-else-if="playMode === 'loop'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <!-- 单曲循环 -->
          <svg v-else-if="playMode === 'single'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="bold">1</text></svg>
          <!-- 随机播放 -->
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
        </button>
        <button class="player-side-btn" @click="prevSong()" title="上一首">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="player-side-btn" @click="nextSong()" title="下一首">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button class="player-side-btn" @click="showPlaylist = !showPlaylist" :class="{ active: showPlaylist }" title="播放列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <span v-if="playlist.length" class="playlist-badge">{{ playlist.length }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.netease {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  color: #e0e0e0;
  overflow: hidden;
}

/* ── 登录覆盖层 ── */
.login-overlay {
  position: absolute;
  inset: 0;
  z-index: 200;
  background: rgba(10, 12, 20, 0.95);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  min-width: 280px;
}

.login-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.qr-area {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.qr-img {
  width: 200px;
  height: 200px;
}

.qr-loading {
  font-size: 14px;
  color: #666;
}

.qr-expired {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.85);
  position: absolute;
  width: 200px;
  height: 200px;
  justify-content: center;
  border-radius: 12px;
}

.qr-expired-text {
  font-size: 14px;
  color: #fff;
}

.qr-refresh-btn {
  padding: 6px 20px;
  background: rgba(225, 29, 72, 0.8);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.qr-refresh-btn:hover {
  background: rgba(225, 29, 72, 1);
}

.qr-status-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.login-close-btn {
  padding: 6px 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
}

.login-close-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* ── 歌词覆盖层 ── */
.lyrics-overlay {
  position: absolute;
  inset: 0;
  bottom: 50px;
  z-index: 100;
  background: rgba(10, 12, 20, 0.97);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  box-sizing: border-box;
  cursor: pointer;
}

.lyrics-fade-enter-active,
.lyrics-fade-leave-active {
  transition: opacity 0.25s ease;
}

.lyrics-fade-enter-from,
.lyrics-fade-leave-to {
  opacity: 0;
}

.lyrics-header {
  text-align: center;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.lyrics-song-name {
  font-size: 22px;
  font-weight: 600;
  color: #fff;
}

.lyrics-artist {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 4px;
}

.lyrics-body {
  flex: 1;
  width: 100%;
  max-width: 560px;
  overflow-y: auto;
  padding: 60px 0;
  cursor: default;
  mask-image: linear-gradient(transparent 0%, #000 15%, #000 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(transparent 0%, #000 15%, #000 85%, transparent 100%);
}

.lyrics-body::-webkit-scrollbar {
  width: 4px;
}

.lyrics-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.lyric-line {
  text-align: center;
  padding: 10px 16px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: color 0.3s, font-size 0.3s, transform 0.3s;
  line-height: 1.6;
}

.lyric-line:hover {
  color: rgba(255, 255, 255, 0.55);
}

.lyric-line.active {
  color: #f43f5e;
  font-size: 18px;
  font-weight: 600;
  transform: scale(1.05);
}

.lyric-translation {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
  margin-top: 2px;
  line-height: 1.4;
}

.lyric-line.active .lyric-translation {
  color: rgba(244, 63, 94, 0.55);
}

.lyrics-empty {
  text-align: center;
  padding-top: 80px;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.25);
}

.lyrics-hint {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.2);
  margin-top: 8px;
}

/* ── Tab 栏 ── */
.tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
  user-select: none;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.tab-btn.active {
  background: rgba(225, 29, 72, 0.2);
  border-color: rgba(225, 29, 72, 0.4);
  color: #fff;
}

.tab-bar .user-area {
  margin-left: auto;
}

/* ── 页面内容 ── */
.page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.page-content .results {
  flex: 1;
}

/* ── 搜索栏 ── */
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
  border-color: rgba(225, 29, 72, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.search-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(225, 29, 72, 0.5);
  border: 1px solid rgba(225, 29, 72, 0.4);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.search-btn:hover {
  background: rgba(225, 29, 72, 0.7);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── 用户区域 ── */
.user-area {
  flex-shrink: 0;
}

.login-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.login-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.2s;
}

.user-info:hover {
  background: rgba(225, 29, 72, 0.2);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.user-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 搜索结果 ── */
.results {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  padding-bottom: 80px;
  min-height: 0;
}

.results::-webkit-scrollbar {
  width: 6px;
}

.results::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.result-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.song-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.song-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.song-row.active {
  background: rgba(225, 29, 72, 0.15);
}

.song-row.playing .song-name {
  color: #f43f5e;
}

.col-name {
  flex: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.play-indicator {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(244, 63, 94, 0.8);
  opacity: 0;
  transition: opacity 0.15s;
}

.song-row:hover .play-indicator,
.song-row.active .play-indicator,
.playlist-item:hover .play-indicator,
.playlist-item.active .play-indicator {
  opacity: 1;
}

.song-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: #fff;
}

.fee-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.fee-badge.vip {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.3);
}

.fee-badge.paid {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.col-artist {
  flex: 2;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-album {
  flex: 2.5;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-duration {
  flex: 0 0 50px;
  text-align: right;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  font-variant-numeric: tabular-nums;
}

/* ── Loading & Empty ── */
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

/* ── 播放控制栏 ── */
.player-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: rgba(15, 17, 26, 0.95);
  backdrop-filter: blur(16px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.player-info {
  flex-shrink: 0;
  max-width: 180px;
}

.player-song-name {
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
}

.player-song-name:hover {
  color: #f43f5e;
}

.player-artist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-player {
  flex: 1;
  height: 36px;
  min-width: 0;
}

.player-empty {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.3);
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.player-side-btn {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.2s, border-color 0.2s;
}

.player-side-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.25);
}

.player-side-btn.active {
  color: #f43f5e;
  border-color: rgba(225, 29, 72, 0.4);
}

.playlist-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #f43f5e;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ── 播放列表覆盖层 ── */
.playlist-overlay {
  position: absolute;
  inset: 0;
  z-index: 150;
  background: rgba(10, 12, 20, 0.85);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-panel {
  width: 90%;
  max-width: 500px;
  max-height: 80%;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
}

.playlist-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.playlist-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.playlist-count {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

.playlist-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.playlist-body::-webkit-scrollbar {
  width: 4px;
}

.playlist-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.playlist-empty {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 14px;
}

.playlist-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.playlist-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.playlist-item.active {
  background: rgba(225, 29, 72, 0.15);
}

.playlist-item.active .playlist-item-name {
  color: #f43f5e;
}

.playlist-item-name {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #fff;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-song-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-artist {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-duration {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
  font-variant-numeric: tabular-nums;
}

.playlist-item-remove {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.playlist-item-remove:hover {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.15);
}

/* ── 歌单按钮 ── */
.playlist-fetch-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}

.playlist-fetch-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/* ── 歌单列表 ── */
.user-playlist-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.user-playlist-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.user-playlist-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.user-playlist-info {
  flex: 1;
  min-width: 0;
}

.user-playlist-name {
  font-size: 14px;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-playlist-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 2px;
}

/* ── 歌单详情 ── */
.playlist-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.pd-back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.pd-back-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.25);
}

.pd-play-all-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  background: rgba(225, 29, 72, 0.5);
  border: 1px solid rgba(225, 29, 72, 0.4);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.pd-play-all-btn:hover {
  background: rgba(225, 29, 72, 0.7);
}

</style>
