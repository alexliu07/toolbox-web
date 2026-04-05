<script setup>
import { ref, computed, onMounted, inject } from 'vue'

const authFetch = inject('authFetch')

// State
const phase = ref('login') // login | exams | detail
const username = ref('')
const password = ref('')
const sessionId = ref('')
const loginError = ref('')
const loading = ref(false)

// Scroll refs
const examListEl = ref(null)
const detailContentEl = ref(null)

// Exams
const exams = ref([])
const studentName = ref('')
const customExamId = ref('')

// Detail
const selectedExam = ref(null)
const totalData = ref(null)
const subjects = ref([])
const expandedSubject = ref(null) // subjectid
const subjectDetail = ref(null)
const questionList = ref(null)
const detailLoading = ref(false)

// ── Auto-load saved credentials ──
onMounted(async () => {
  try {
    const res = await authFetch('/api/data/yunchengji-creds')
    if (res.ok) {
      const creds = await res.json()
      if (creds) {
        if (creds.username) username.value = creds.username
        if (creds.password) password.value = creds.password
      }
    }
  } catch {}
})

// ── Login ──
async function login() {
  loginError.value = ''
  if (!username.value.trim() || !password.value.trim()) {
    loginError.value = '请输入账号和密码'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/yunchengji/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      loginError.value = data.error || '登录失败'
      return
    }
    sessionId.value = data.sessionId
    // Save credentials silently
    authFetch('/api/data/yunchengji-creds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
    }).catch(() => {})
    await loadExams()
  } catch (e) {
    loginError.value = '网络错误，请重试'
  } finally {
    loading.value = false
  }
}

// ── Load exams ──
async function loadExams() {
  loading.value = true
  try {
    const res = await fetch('/api/yunchengji/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId.value }),
    })
    const data = await res.json()
    const list = data?.desc?.selist || []
    exams.value = list
    if (list.length) studentName.value = list[0].studentname || ''
    phase.value = 'exams'
  } catch (e) {
    loginError.value = '获取考试列表失败'
  } finally {
    loading.value = false
  }
}

// ── Select exam ──
async function selectExam(exam) {
  selectedExam.value = exam
  detailLoading.value = true
  totalData.value = null
  subjects.value = []
  expandedSubject.value = null
  subjectDetail.value = null
  questionList.value = null
  phase.value = 'detail'

  try {
    const [totalRes, subjRes] = await Promise.all([
      fetch(`/api/yunchengji/total?session=${encodeURIComponent(sessionId.value)}&seid=${exam.id}`),
      fetch(`/api/yunchengji/subjects?session=${encodeURIComponent(sessionId.value)}&seid=${exam.id}`),
    ])
    totalData.value = (await totalRes.json())?.desc || null
    // Use exam name from API if available
    if (totalData.value?.examName) {
      selectedExam.value = { ...exam, name: totalData.value.examName }
    }
    const subjData = await subjRes.json()
    // subject-list desc is an array of { subjectid, name, ... }
    subjects.value = Array.isArray(subjData?.desc) ? subjData.desc : (subjData?.desc?.subjects || [])
  } catch (e) {
    // silent
  } finally {
    detailLoading.value = false
  }
}

// ── Custom exam ID query ──
function queryCustomExam() {
  const id = customExamId.value.trim()
  if (!id) return
  selectExam({ id, name: '自定义考试 #' + id })
}

// ── Expand subject ──
async function toggleSubject(subj) {
  const sid = subj.subjectid || subj.id
  if (expandedSubject.value === sid) {
    expandedSubject.value = null
    subjectDetail.value = null
    questionList.value = null
    return
  }
  expandedSubject.value = sid
  subjectDetail.value = null
  questionList.value = null
  try {
    const [detailRes, qRes] = await Promise.all([
      fetch(`/api/yunchengji/subject?session=${encodeURIComponent(sessionId.value)}&seid=${selectedExam.value.id}&subjectid=${sid}`),
      fetch(`/api/yunchengji/questions?session=${encodeURIComponent(sessionId.value)}&seid=${selectedExam.value.id}&subjectid=${sid}`),
    ])
    subjectDetail.value = (await detailRes.json())?.desc || null
    questionList.value = (await qRes.json())?.desc?.questions || []
  } catch (e) {
    // silent
  }
}

// ── Computed ──
const totalEntry = computed(() => {
  const subjects = totalData.value?.stuOrder?.subjects
  if (!subjects) return null
  return subjects.find(s => s.name === '总分') || null
})

const subjectRows = computed(() => {
  const stu = totalData.value?.stuOrder
  if (!stu?.subjects) return []
  const gap = stu.scoreGap || {}
  return stu.subjects.filter(s => s.name !== '总分').map(s => ({
    ...s,
    classAvg: gap.classAvg,
    schoolAvg: gap.schoolAvg,
    unionAvg: gap.unionAvg,
  }))
})

const totalScore = computed(() => totalEntry.value?.score ?? null)
const totalFull = computed(() => totalEntry.value?.fullScore ?? null)
const scoreGap = computed(() => totalData.value?.stuOrder?.scoreGap || null)

function goBack() {
  if (phase.value === 'detail') {
    phase.value = 'exams'
    selectedExam.value = null
  } else if (phase.value === 'exams') {
    // Logout from remote server
    fetch('/api/yunchengji/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId.value }),
    }).catch(() => {})
    phase.value = 'login'
    sessionId.value = ''
    exams.value = []
  }
}

function scrollList(el, dir) {
  if (!el) return
  el.scrollBy({ top: dir * 200, behavior: 'smooth' })
}

function scoreColor(score, full) {
  if (!full) return ''
  const ratio = score / full
  if (ratio >= 0.9) return 'score-excellent'
  if (ratio >= 0.6) return 'score-pass'
  return 'score-fail'
}

function orderBadge(order, total) {
  if (!order || !total) return ''
  const ratio = order / total
  if (ratio <= 0.1) return 'order-top'
  if (ratio <= 0.3) return 'order-good'
  return ''
}
</script>

<template>
  <div class="ycj">
    <!-- Login -->
    <div v-if="phase === 'login'" class="login-view">
      <div class="login-header">
        <div class="login-icon"> </div>
        <div class="login-title">云成绩查分</div>
        <div class="login-subtitle">登录云成绩账号查看考试成绩</div>
      </div>
      <div class="login-form">
        <input
          v-model="username"
          type="text"
          class="login-input"
          placeholder="手机号"
          @keydown.enter="login"
        />
        <input
          v-model="password"
          type="password"
          class="login-input"
          placeholder="密码"
          @keydown.enter="login"
        />
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <button class="login-btn" @click="login" :disabled="loading">
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </div>
    </div>

    <!-- Exam list -->
    <div v-else-if="phase === 'exams'" class="exams-view">
      <div class="view-header">
        <button class="back-btn" @click="goBack" title="返回登录">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="view-title">{{ studentName }}的考试</span>
        <span class="exam-count">{{ exams.length }}场考试</span>
      </div>
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="!exams.length" class="empty-state">
        <div class="empty-icon"> </div>
        <div class="empty-text">暂无考试记录</div>
      </div>
      <div v-else class="scroll-wrapper">
        <button class="scroll-btn scroll-up" @click="scrollList(examListEl, -1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <div ref="examListEl" class="exam-list">
        <div
          v-for="exam in exams"
          :key="exam.id"
          class="exam-card"
          @click="selectExam(exam)"
        >
          <div class="exam-name">{{ exam.name }}</div>
          <div class="exam-meta">
            <span v-if="exam.date" class="exam-date">{{ exam.date }}</span>
            <span v-if="exam.examtypestr" class="exam-type">{{ exam.examtypestr }}</span>
            <span v-if="exam.examdesc" class="exam-desc">{{ exam.examdesc }}</span>
          </div>
          <svg class="exam-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        </div>
        <button class="scroll-btn scroll-down" @click="scrollList(examListEl, 1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="custom-exam-bar">
        <input
          v-model="customExamId"
          type="text"
          class="custom-exam-input"
          placeholder="输入考试编号查询..."
          @keydown.enter="queryCustomExam"
        />
        <button class="custom-exam-btn" @click="queryCustomExam">查询</button>
      </div>
    </div>

    <!-- Detail -->
    <div v-else-if="phase === 'detail'" class="detail-view">
      <div class="view-header">
        <button class="back-btn" @click="goBack" title="返回考试列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="view-title">{{ selectedExam?.name }}</span>
      </div>

      <div v-if="detailLoading" class="loading">加载中...</div>

      <div v-else class="scroll-wrapper detail-scroll">
        <button class="scroll-btn scroll-up" @click="scrollList(detailContentEl, -1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <div ref="detailContentEl" class="detail-content">
        <!-- Total score banner -->
        <div v-if="totalScore !== null" class="total-banner">
          <div class="total-score">{{ totalScore }}</div>
          <div class="total-label">总分 / {{ totalFull }}</div>
          <div v-if="totalEntry?.paperScore != null" class="total-label">卷面 {{ totalEntry.paperScore }}</div>
          <div class="total-ranks" v-if="totalEntry">
            <span v-if="totalEntry.classOrder" class="total-rank">
              班<span :class="orderBadge(totalEntry.classOrder, 1)">{{ totalEntry.classOrder }}</span>
            </span>
            <span v-if="totalEntry.schoolOrder" class="total-rank">
              校<span :class="orderBadge(totalEntry.schoolOrder, 1)">{{ totalEntry.schoolOrder }}</span>
            </span>
            <span v-if="totalEntry.unionOrder" class="total-rank">
              联<span :class="orderBadge(totalEntry.unionOrder, 1)">{{ totalEntry.unionOrder }}</span>
            </span>
          </div>
        </div>

        <!-- Subject table -->
        <div v-if="subjectRows.length" class="section">
          <div class="section-title">各科成绩</div>
          <div class="score-table">
            <div class="score-row score-header">
              <span class="col-subject">科目</span>
              <span class="col-score">分数</span>
              <span class="col-score">卷面</span>
              <span class="col-rank">班排名</span>
              <span class="col-rank">校排名</span>
              <span class="col-rank">联排名</span>
            </div>
            <div
              v-for="s in subjectRows"
              :key="s.name"
              class="score-row"
              :class="{ clickable: true, active: expandedSubject === (s.subjectid || s.id) }"
              @click="toggleSubject(s)"
            >
              <span class="col-subject">{{ s.name }}</span>
              <span class="col-score" :class="scoreColor(s.score, s.fullScore)">
                {{ s.score }}<span class="score-full">/{{ s.fullScore }}</span>
              </span>
              <span class="col-score" :class="scoreColor(s.paperScore, s.fullScore)">{{ s.paperScore }}</span>
              <span class="col-rank" :class="orderBadge(s.classOrder, 1)">
                {{ s.classOrder || '-' }}
              </span>
              <span class="col-rank" :class="orderBadge(s.schoolOrder, 1)">
                {{ s.schoolOrder || '-' }}
              </span>
              <span class="col-rank" :class="orderBadge(s.unionOrder, 1)">
                {{ s.unionOrder || '-' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Score gap stats -->
        <div v-if="scoreGap" class="section">
          <div class="section-title">统计数据</div>
          <div class="gap-table">
            <div class="gap-row gap-header">
              <span class="gap-col"></span>
              <span class="gap-col">人数</span>
              <span class="gap-col">最高分</span>
              <span class="gap-col">平均分</span>
            </div>
            <div class="gap-row">
              <span class="gap-col gap-label">班级</span>
              <span class="gap-col">{{ scoreGap.classNum ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.classTop ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.classAvg ?? '-' }}</span>
            </div>
            <div class="gap-row">
              <span class="gap-col gap-label">学校</span>
              <span class="gap-col">{{ scoreGap.schoolNum ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.schoolTop ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.schoolAvg ?? '-' }}</span>
            </div>
            <div class="gap-row">
              <span class="gap-col gap-label">联考</span>
              <span class="gap-col">{{ scoreGap.unionNum ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.unionTop ?? '-' }}</span>
              <span class="gap-col">{{ scoreGap.unionAvg ?? '-' }}</span>
            </div>
          </div>
        </div>

        <!-- Expanded subject detail -->
        <div v-if="expandedSubject && (subjectDetail || questionList?.length)" class="subject-detail">
          <div class="section">
            <div class="section-title">小题得分</div>
            <div v-if="questionList?.length" class="question-grid">
              <div
                v-for="q in questionList"
                :key="q.title"
                class="question-item"
                :class="scoreColor(q.score, q.totalScore)"
              >
                <span class="q-title">{{ q.title }}</span>
                <span class="q-score">{{ q.score }}/{{ q.totalScore }}</span>
              </div>
            </div>
            <div v-else class="no-data">暂无小题数据</div>
          </div>

          <div v-if="subjectDetail?.stuOrder?.scoreGap" class="section">
            <div class="section-title">统计数据</div>
            <div class="gap-table">
              <div class="gap-row gap-header">
                <span class="gap-col"></span>
                <span class="gap-col">人数</span>
                <span class="gap-col">最高分</span>
                <span class="gap-col">平均分</span>
              </div>
              <div class="gap-row">
                <span class="gap-col gap-label">班级</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.classNum ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.classTop ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.classAvg ?? '-' }}</span>
              </div>
              <div class="gap-row">
                <span class="gap-col gap-label">学校</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.schoolNum ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.schoolTop ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.schoolAvg ?? '-' }}</span>
              </div>
              <div class="gap-row">
                <span class="gap-col gap-label">联考</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.unionNum ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.unionTop ?? '-' }}</span>
                <span class="gap-col">{{ subjectDetail.stuOrder.scoreGap.unionAvg ?? '-' }}</span>
              </div>
            </div>
          </div>

          <div v-if="subjectDetail?.questRates?.length" class="section">
            <div class="section-title">大题得分率</div>
            <div class="rates-list">
              <div v-for="r in subjectDetail.questRates" :key="r.title" class="rate-item">
                <span class="rate-title">{{ r.title }}</span>
                <div class="rate-bars">
                  <div class="rate-bar-row">
                    <span class="rate-label">个人</span>
                    <div class="rate-bar"><div class="rate-fill" :style="{ width: r.scoreRate }"></div></div>
                    <span class="rate-val">{{ r.scoreRate }}</span>
                  </div>
                  <div class="rate-bar-row">
                    <span class="rate-label">班级</span>
                    <div class="rate-bar"><div class="rate-fill rate-fill-class" :style="{ width: r.classScoreRate }"></div></div>
                    <span class="rate-val">{{ r.classScoreRate }}</span>
                  </div>
                  <div class="rate-bar-row">
                    <span class="rate-label">学校</span>
                    <div class="rate-bar"><div class="rate-fill rate-fill-school" :style="{ width: r.schoolScoreRate }"></div></div>
                    <span class="rate-val">{{ r.schoolScoreRate || '-' }}</span>
                  </div>
                  <div class="rate-bar-row">
                    <span class="rate-label">联考</span>
                    <div class="rate-bar"><div class="rate-fill rate-fill-union" :style="{ width: r.unionScoreRate }"></div></div>
                    <span class="rate-val">{{ r.unionScoreRate || '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
        <button class="scroll-btn scroll-down" @click="scrollList(detailContentEl, 1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ycj {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  color: #e0e0e0;
  overflow: hidden;
}

/* ── Login ── */
.login-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.login-header {
  text-align: center;
}

.login-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.login-title {
  font-size: 22px;
  font-weight: 600;
  color: #fff;
}

.login-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 4px;
}

.login-form {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login-input {
  padding: 10px 16px;
  font-size: 15px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: #fff;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
}

.login-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.login-input:focus {
  border-color: rgba(99, 102, 241, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.login-error {
  font-size: 13px;
  color: #f87171;
  text-align: center;
}

.login-btn {
  padding: 10px;
  font-size: 15px;
  font-weight: 500;
  background: rgba(99, 102, 241, 0.5);
  border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.login-btn:hover {
  background: rgba(99, 102, 241, 0.7);
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── View header ── */
.view-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.view-title {
  font-size: 16px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.exam-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}

/* ── Loading / Empty ── */
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

/* ── Exam list ── */
.exam-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.exam-list::-webkit-scrollbar {
  width: 6px;
}

.exam-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.exam-card {
  position: relative;
  padding: 14px 36px 14px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.exam-card:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
}

.exam-name {
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  margin-bottom: 6px;
}

.exam-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  flex-wrap: wrap;
}

.exam-type {
  padding: 1px 6px;
  background: rgba(99, 102, 241, 0.2);
  border-radius: 4px;
  color: rgba(165, 180, 252, 0.9);
}

.exam-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.2);
}

/* ── Custom exam bar ── */
.custom-exam-bar {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-shrink: 0;
}

.custom-exam-input {
  flex: 1;
  padding: 8px 14px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #fff;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
}

.custom-exam-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.custom-exam-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(255, 255, 255, 0.08);
}

.custom-exam-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(99, 102, 241, 0.4);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}

.custom-exam-btn:hover {
  background: rgba(99, 102, 241, 0.6);
}

/* ── Scroll wrapper & buttons ── */
.scroll-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.scroll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 28px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}

.scroll-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.scroll-up {
  border-radius: 8px 8px 0 0;
}

.scroll-down {
  border-radius: 0 0 8px 8px;
}

.detail-scroll {
  flex: 1;
  overflow: hidden;
}

/* ── Detail ── */
.detail-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.detail-content::-webkit-scrollbar {
  width: 6px;
}

.detail-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

/* ── Total banner ── */
.total-banner {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 20px;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(79, 70, 229, 0.15));
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 12px;
}

.total-score {
  font-size: 36px;
  font-weight: 700;
  color: #fff;
}

.total-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
}

.total-ranks {
  display: flex;
  gap: 12px;
  margin-left: auto;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.total-rank {
  display: flex;
  gap: 4px;
  align-items: center;
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

/* ── Score table ── */
.score-table {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
}

.score-row {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}

.score-row:last-child {
  border-bottom: none;
}

.score-header {
  background: rgba(255, 255, 255, 0.05);
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.score-row.clickable {
  cursor: pointer;
}

.score-row.clickable:hover {
  background: rgba(99, 102, 241, 0.1);
}

.score-row.active {
  background: rgba(99, 102, 241, 0.2);
  border-left: 3px solid #6366f1;
}

.col-subject {
  flex: 1;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.col-score {
  width: 70px;
  text-align: center;
  font-weight: 600;
  color: #fff;
}

.col-rank {
  width: 55px;
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
}

.score-full {
  font-weight: 400;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
}

.score-excellent { color: #34d399; }
.score-pass { color: #fbbf24; }
.score-fail { color: #f87171; }

.gap-table {
  width: 100%;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  overflow: hidden;
}
.gap-row {
  display: flex;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 13px;
}
.gap-row:last-child { border-bottom: none; }
.gap-header {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  font-weight: 600;
  text-transform: uppercase;
}
.gap-col {
  flex: 1;
  text-align: center;
  color: rgba(255,255,255,0.75);
}
.gap-label {
  color: rgba(255,255,255,0.5);
  font-size: 12px;
}

.order-top { color: #34d399; font-weight: 600; }
.order-good { color: #60a5fa; font-weight: 500; }

/* ── Subject detail ── */
.subject-detail {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.no-data {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.3);
  padding: 8px 0;
}

/* ── Question grid ── */
.question-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.question-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 10px;
  min-width: 60px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  font-size: 12px;
}

.q-title {
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 2px;
}

.q-score {
  font-weight: 600;
  color: #fff;
}

.question-item.score-excellent .q-score { color: #34d399; }
.question-item.score-pass .q-score { color: #fbbf24; }
.question-item.score-fail .q-score { color: #f87171; }

/* ── Difficulty grid ── */
.difficulty-grid {
  display: flex;
  gap: 8px;
}

.diff-card {
  flex: 1;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
}

.diff-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 4px;
}

.diff-value {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.diff-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 2px;
}

/* ── Rate bars ── */
.rates-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rate-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rate-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
}

.rate-bars {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rate-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rate-label {
  width: 28px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
}

.rate-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.rate-fill {
  height: 100%;
  background: rgba(99, 102, 241, 0.7);
  border-radius: 3px;
  transition: width 0.3s;
}

.rate-fill-class {
  background: rgba(52, 211, 153, 0.5);
}

.rate-fill-school {
  background: rgba(251, 191, 36, 0.6);
}

.rate-fill-union {
  background: rgba(244, 114, 182, 0.6);
}

.rate-val {
  width: 40px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  text-align: right;
  flex-shrink: 0;
}
</style>
