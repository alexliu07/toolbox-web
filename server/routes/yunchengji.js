import express from 'express'

const router = express.Router()

const BASE = 'https://www.yunchengji.net'

// UA for POST endpoints (login, exams, logout)
const UA_POST = 'ycj/5.7.0(Android;12)<okhttp>(<okhttp/3.10.0>)<brand_HONOR,model_SDY-AN00,maker_HONOR,device_Sandy>'
// UA for GET endpoints (grade queries)
const UA_GET = 'Mozilla/5.0 (Linux; Android 12; SDY-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.72 MQQBrowser/6.2 Mobile Safari/537.36'

// POST /api/yunchengji/login  body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: '需要账号和密码' })
  try {
    const url = `${BASE}/app/login?j_username=${encodeURIComponent(username)}&j_password=${encodeURIComponent(password)}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA_POST,
        'Accept-Encoding': 'gzip',
        'content-length': '0',
      },
      redirect: 'manual',
    })
    // Extract SESSIONID from Set-Cookie
    const setCookie = resp.headers.getSetCookie?.() || []
    let sessionId = null
    for (const c of setCookie) {
      const m = c.match(/SESSIONID=([^;]+)/)
      if (m) sessionId = m[1]
    }
    // If redirected to /app/student/session/fail, login failed
    if (resp.status === 302) {
      const loc = resp.headers.get('location') || ''
      if (loc.includes('/session/fail')) {
        return res.status(401).json({ error: '账号或密码错误' })
      }
    }
    if (!sessionId) {
      // Try reading cookie from response even without redirect
      return res.status(401).json({ error: '登录失败，未获取到会话' })
    }
    res.json({ sessionId })
  } catch (e) {
    res.status(502).json({ error: '上游请求失败', detail: e.message })
  }
})

// Helper: make cookie header from session id
function cookieHeader(sessionId) {
  return `SESSIONID=${sessionId}`
}

// POST /api/yunchengji/exams  body: { session }
router.post('/exams', async (req, res) => {
  const { session } = req.body || {}
  if (!session) return res.status(400).json({ error: '需要session' })
  try {
    const resp = await fetch(`${BASE}/app/student/index`, {
      method: 'POST',
      headers: {
        'User-Agent': UA_POST,
        'Accept-Encoding': 'gzip',
        'content-length': '0',
        'Cookie': cookieHeader(session),
      },
    })
    const data = await resp.json()
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: '上游请求失败', detail: e.message })
  }
})

// Common GET proxy helper
async function proxyGet(session, upstreamUrl, res) {
  try {
    const resp = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': UA_GET,
        'Accept': 'application/json, text/plain, */*',
        'x-requested-with': 'com.wish.ycj',
        'referer': 'https://www.yunchengji.net/app/student/report/html/report.html',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': cookieHeader(session),
      },
    })
    const data = await resp.json()
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: '上游请求失败', detail: e.message })
  }
}

// GET /api/yunchengji/total?session=...&seid=...
router.get('/total', (req, res) => {
  const { session, seid } = req.query
  if (!session || !seid) return res.status(400).json({ error: '需要session和seid' })
  proxyGet(session, `${BASE}/app/student/cj/report-total?seid=${encodeURIComponent(seid)}`, res)
})

// GET /api/yunchengji/subjects?session=...&seid=...
router.get('/subjects', (req, res) => {
  const { session, seid } = req.query
  if (!session || !seid) return res.status(400).json({ error: '需要session和seid' })
  proxyGet(session, `${BASE}/app/student/cj/subject-list?seid=${encodeURIComponent(seid)}`, res)
})

// GET /api/yunchengji/subject?session=...&seid=...&subjectid=...
router.get('/subject', (req, res) => {
  const { session, seid, subjectid } = req.query
  if (!session || !seid || !subjectid) return res.status(400).json({ error: '需要session、seid和subjectid' })
  proxyGet(session, `${BASE}/app/student/cj/report-subject?seid=${encodeURIComponent(seid)}&subjectid=${encodeURIComponent(subjectid)}`, res)
})

// GET /api/yunchengji/questions?session=...&seid=...&subjectid=...
router.get('/questions', (req, res) => {
  const { session, seid, subjectid } = req.query
  if (!session || !seid || !subjectid) return res.status(400).json({ error: '需要session、seid和subjectid' })
  proxyGet(session, `${BASE}/app/student/cj/question-list?seid=${encodeURIComponent(seid)}&subjectid=${encodeURIComponent(subjectid)}`, res)
})

// POST /api/yunchengji/logout  body: { session }
router.post('/logout', async (req, res) => {
  const { session } = req.body || {}
  if (!session) return res.status(400).json({ error: '需要session' })
  try {
    await fetch(`${BASE}/app/logout`, {
      method: 'POST',
      headers: {
        'User-Agent': UA_POST,
        'Accept-Encoding': 'gzip',
        'content-length': '0',
        'Cookie': cookieHeader(session),
      },
    })
    res.json({ ok: true })
  } catch (e) {
    // Logout failure is non-critical
    res.json({ ok: true })
  }
})

export default router
