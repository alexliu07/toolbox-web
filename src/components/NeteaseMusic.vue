<script>
export const toolMeta = {
  id: 'netease',
  name: '网易云音乐',
  icon: '🎼',
  gradient: 'linear-gradient(135deg,#e11d48,#dc2626)',
  windowTitle: '网易云音乐',
  windowIcon: '🎼',
  width: 800,
  height: 600,
  order: 10,
}
</script>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, inject } from 'vue'

const authFetch = inject('authFetch')

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
  // reset after next tick to not block legitimate volume changes
  setTimeout(() => { applyingVolume = false }, 0)
}

// 歌词
const showLyrics = ref(false)
const lyrics = ref([])       // [{ time: number, text: string }]
const currentTime = ref(0)
const activeLyricIndex = ref(-1)
const lyricsContainerRef = ref(null)
let scrollTimer = null

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
    const res = await fetch(`/api/netease/search?keywords=${encodeURIComponent(q)}`)
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

  currentSong.value = song
  showLyrics.value = false
  lyrics.value = []
  activeLyricIndex.value = -1
  fetchLyrics(song.id)
  setTimeout(() => {
    if (audioRef.value) {
      audioRef.value.play().catch(() => {})
    }
  }, 50)
}

function onPlay() { isPlaying.value = true }
function onPause() { isPlaying.value = false }
function onEnded() { isPlaying.value = false }

// ── 歌词 ──
async function fetchLyrics(id) {
  try {
    const res = await fetch(`/api/netease/lyric?id=${id}`)
    const data = await res.json()
    lyrics.value = parseLRC(data.lrc || '')
  } catch (e) {
    lyrics.value = []
  }
}

function parseLRC(lrcText) {
  const lines = lrcText.split('\n')
  const result = []
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/
  for (const line of lines) {
    const match = timeReg.exec(line)
    if (!match) continue
    const min = parseInt(match[1])
    const sec = parseInt(match[2])
    const ms = parseInt(match[3].padEnd(3, '0'))
    const time = min * 60 + sec + ms / 1000
    const text = line.replace(/\[.*?\]/g, '').trim()
    if (text) result.push({ time, text })
  }
  return result
}

function onTimeUpdate() {
  if (!audioRef.value) return
  currentTime.value = audioRef.value.currentTime
  // 找到当前歌词行
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
  if (showLyrics.value) scrollToActiveLyric()
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') search()
}

onMounted(() => {
  loadVolume()
})

onUnmounted(() => {
  if (audioRef.value) {
    audioRef.value.pause()
    audioRef.value.src = ''
  }
})
</script>

<template>
  <div class="netease">
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
          >{{ line.text }}</div>
        </div>
        <div class="lyrics-hint">点击歌词跳转 · 点击空白处返回</div>
      </div>
    </transition>

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
    <div class="results" :class="{ 'has-player': currentSong }">
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

    <!-- 播放控制栏 -->
    <div v-if="currentSong" class="player-bar">
      <div class="player-info">
        <div class="player-song-name" @click="toggleLyrics()" title="查看歌词">{{ currentSong.name }}</div>
        <div class="player-artist">{{ currentSong.artists }}</div>
      </div>
      <audio
        ref="audioRef"
        :src="`/api/netease/stream?id=${currentSong.id}`"
        controls
        class="audio-player"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
        @timeupdate="onTimeUpdate"
        @volumechange="onVolumeChange"
        @loadedmetadata="applyVolume"
      />
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

/* ── 歌词覆盖层 ── */
.lyrics-overlay {
  position: absolute;
  inset: 0;
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

/* ── 搜索栏 ── */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
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

/* ── 搜索结果 ── */
.results {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  min-height: 0;
}

.results.has-player {
  padding-bottom: 80px;
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
.song-row.active .play-indicator {
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
</style>
