<script>
export const appMeta = {
  // id和windowId相同
  id: 'youdao',
  name: '有道词典',
  icon: '📚',
  gradient: 'linear-gradient(135deg,#e11d48,#be123c)',
  order: 6,
}
export const windowMeta = {
  windowTitle: '有道词典',
  windowIcon: '📚',
  width: 600,
  height: 520,
  windowId: 'youdao',
}
</script>

<script setup>
import { ref, watch } from 'vue'

const query = ref('')
const suggestions = ref([])
const result = ref(null)
const loading = ref(false)
const showSuggestions = ref(false)
const activeIndex = ref(-1)
let debounceTimer = null

// ── Suggest (autocomplete) ──
watch(query, (val) => {
  clearTimeout(debounceTimer)
  if (!val.trim()) {
    suggestions.value = []
    showSuggestions.value = false
    return
  }
  debounceTimer = setTimeout(() => fetchSuggestions(val.trim()), 200)
})

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/youdao/suggest?q=${encodeURIComponent(q)}&num=8`)
    const data = await res.json()
    if (data.result?.code === 200 && data.data?.entries) {
      suggestions.value = data.data.entries
      showSuggestions.value = true
      activeIndex.value = -1
    }
  } catch (e) {
    suggestions.value = []
  }
}

// ── Dictionary definition ──
async function fetchDefinition(q) {
  try {
    const res = await fetch(`/api/youdao/define?q=${encodeURIComponent(q)}`)
    return await res.json()
  } catch (e) {
    return null
  }
}

// ── Search ──
async function search(word) {
  const q = (word || query.value).trim()
  if (!q) return
  query.value = q
  showSuggestions.value = false
  loading.value = true
  result.value = null

  result.value = await fetchDefinition(q)
  loading.value = false
}

function selectSuggestion(entry) {
  search(entry.entry)
}

function onKeydown(e) {
  if (!showSuggestions.value || !suggestions.value.length) {
    if (e.key === 'Enter') search()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0) {
      selectSuggestion(suggestions.value[activeIndex.value])
    } else {
      search()
    }
  } else if (e.key === 'Escape') {
    showSuggestions.value = false
  }
}

function onBlur() {
  setTimeout(() => { showSuggestions.value = false }, 200)
}

// ── Extract display data ──
function getWordInfo(data) {
  if (!data) return null
  const info = { phonetics: [], translations: [], phrases: [], webTrans: [] }

  // simple section: phonetics
  if (data.simple?.word?.[0]) {
    const w = data.simple.word[0]
    if (w.ukphone) info.phonetics.push({ label: '英', phone: w.ukphone })
    if (w.usphone) info.phonetics.push({ label: '美', phone: w.usphone })
  }

  // ec: English-Chinese dictionary
  if (data.ec?.word?.[0]?.trs) {
    for (const tr of data.ec.word[0].trs) {
      const texts = tr.tr?.[0]?.l?.i
      if (texts) info.translations.push(...texts)
    }
  }

  // ce: Chinese-English dictionary
  if (data.ce?.word?.[0]?.trs) {
    for (const tr of data.ce.word[0].trs) {
      const texts = tr.tr?.[0]?.l?.i
      if (texts) info.translations.push(...texts)
    }
  }

  // phrs: phrases
  if (data.phrs?.phrs) {
    for (const p of data.phrs.phrs.slice(0, 6)) {
      const headword = p.phr?.[0]?.l?.i?.[0] || ''
      const tran = p.phr?.[1]?.l?.i?.[0] || ''
      if (headword && tran) info.phrases.push({ phrase: headword, meaning: tran })
    }
  }

  // web_trans: web translations
  if (data.web_trans?.web_translation) {
    for (const wt of data.web_trans.web_translation.slice(0, 5)) {
      const val = wt.trans?.[0]?.value
      if (val) info.webTrans.push(val)
    }
  }

  return info
}

function playAudio(word, type) {
  const audio = new Audio(`/api/youdao/audio?word=${encodeURIComponent(word)}&type=${type}`)
  audio.play().catch(() => {})
}
</script>

<template>
  <div class="youdao">
    <!-- Search bar -->
    <div class="search-bar">
      <input
        v-model="query"
        type="text"
        class="search-input"
        placeholder="输入单词..."
        @keydown="onKeydown"
        @focus="query && suggestions.length && (showSuggestions = true)"
        @blur="onBlur"
        autofocus
      />
      <button class="search-btn" @click="search()" :disabled="loading">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>

      <!-- Suggestions dropdown -->
      <div class="suggestions" v-show="showSuggestions && suggestions.length">
        <div
          v-for="(entry, i) in suggestions"
          :key="entry.entry"
          class="suggestion-item"
          :class="{ active: i === activeIndex }"
          @mousedown.prevent="selectSuggestion(entry)"
          @mouseenter="activeIndex = i"
        >
          <span class="sug-word">{{ entry.entry }}</span>
          <span class="sug-explain">{{ entry.explain }}</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading">查询中...</div>

    <!-- Results -->
    <div v-if="!loading && result" class="results">
      <!-- Word + phonetics -->
      <div class="word-header" v-if="getWordInfo(result)">
        <span class="word-text">{{ getWordInfo(result)?.phonetics.length ? (result.simple?.word?.[0]?.['return-phrase'] || query) : query }}</span>
        <div class="phonetics">
          <span v-for="p in getWordInfo(result).phonetics" :key="p.label" class="phonetic">
            <span class="ph-label">{{ p.label }}</span>
            <span class="ph-text">{{ p.phone }}</span>
            <button class="play-btn" @click="playAudio(query, p.label === '美' ? 2 : 1)" title="播放发音">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
          </span>
        </div>
      </div>

      <!-- Dictionary translations -->
      <div v-if="getWordInfo(result)?.translations.length" class="section">
        <div class="section-title">释义</div>
        <div class="trans-list">
          <div v-for="(t, i) in getWordInfo(result).translations" :key="i" class="trans-item">{{ t }}</div>
        </div>
      </div>

      <!-- Phrases -->
      <div v-if="getWordInfo(result)?.phrases.length" class="section">
        <div class="section-title">常用短语</div>
        <div class="phrases-list">
          <div v-for="(p, i) in getWordInfo(result).phrases" :key="i" class="phrase-item">
            <span class="phrase-text">{{ p.phrase }}</span>
            <span class="phrase-meaning">{{ p.meaning }}</span>
          </div>
        </div>
      </div>

      <!-- Web translations -->
      <div v-if="getWordInfo(result)?.webTrans.length" class="section">
        <div class="section-title">网络释义</div>
        <div class="web-trans-list">
          <div v-for="(w, i) in getWordInfo(result).webTrans" :key="i" class="web-trans-item">{{ w }}</div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && !result && !query" class="empty-state">
      <div class="empty-icon"> </div>
      <div class="empty-text">输入单词开始查询</div>
    </div>
  </div>
</template>

<style scoped>
.youdao {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  color: #e0e0e0;
  overflow: hidden;
}

/* ── Search bar ── */
.search-bar {
  position: relative;
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
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
  border-color: rgba(99, 102, 241, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.search-btn {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(99, 102, 241, 0.5);
  border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.search-btn:hover {
  background: rgba(99, 102, 241, 0.7);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Suggestions ── */
.suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 50px;
  margin-top: 4px;
  background: rgba(20, 22, 40, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  overflow: hidden;
  z-index: 10;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  max-height: 300px;
  overflow-y: auto;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.suggestion-item:hover,
.suggestion-item.active {
  background: rgba(99, 102, 241, 0.2);
}

.sug-word {
  font-size: 15px;
  font-weight: 500;
  color: #fff;
  min-width: 80px;
}

.sug-explain {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Loading ── */
.loading {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
}

/* ── Results ── */
.results {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.results::-webkit-scrollbar {
  width: 6px;
}

.results::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

/* ── Word header ── */
.word-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.word-text {
  font-size: 28px;
  font-weight: 600;
  color: #fff;
}

.phonetics {
  display: flex;
  gap: 12px;
}

.phonetic {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
}

.ph-label {
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
}

.ph-text {
  color: rgba(255, 255, 255, 0.65);
}

.play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  color: rgba(99, 102, 241, 0.7);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.2s, background 0.2s;
}

.play-btn:hover {
  color: rgba(99, 102, 241, 1);
  background: rgba(99, 102, 241, 0.15);
}

/* ── Sections ── */
.section {
  margin-bottom: 16px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

/* ── Translations ── */
.trans-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trans-item {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  padding: 4px 0;
  line-height: 1.5;
}

/* ── Phrases ── */
.phrases-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.phrase-item {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 14px;
  padding: 4px 0;
}

.phrase-text {
  color: rgba(99, 102, 241, 0.9);
  font-weight: 500;
  flex-shrink: 0;
}

.phrase-meaning {
  color: rgba(255, 255, 255, 0.55);
}

/* ── Web translations ── */
.web-trans-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.web-trans-item {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  padding: 3px 0;
}

/* ── Empty state ── */
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
</style>
