import express from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { getNeteaseCredentials, saveNeteaseCredentials, deleteNeteaseCredentials } from '../db.js'

const router = express.Router()

let api
try {
  const mod = await import('NeteaseCloudMusicApi')
  api = mod.default || mod.module.exports
} catch (e) {
  console.error('[netease] Failed to load NeteaseCloudMusicApi:', e.message)
}

// Helper: get cookies string for a user, or undefined if not logged in
function getCookies(userId) {
  if (!userId) return undefined
  try {
    const cred = getNeteaseCredentials(userId)
    if (!cred?.cookies) return undefined
    // cookies stored as string[], API expects '; '-joined string
    return Array.isArray(cred.cookies) ? cred.cookies.join('; ') : cred.cookies
  } catch {
    return undefined
  }
}

// ── Login endpoints ──

// GET /api/netease/qr/key — get QR code unikey
router.get('/qr/key', requireAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  try {
    const result = await api.login_qr_key()
    const body = result.body || result
    if (body.code !== 200) return res.status(502).json({ error: 'upstream error', code: body.code })
    res.json({ unikey: body.data.unikey })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/qr/create?key=xxx — generate QR code base64 image
router.get('/qr/create', requireAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { key } = req.query
  if (!key) return res.status(400).json({ error: 'key required' })
  try {
    const result = await api.login_qr_create({ key, qrimg: true })
    const body = result.body || result
    if (body.code !== 200) return res.status(502).json({ error: 'upstream error', code: body.code })
    res.json({ qrimg: body.data.qrimg })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/qr/check?key=xxx — poll QR scan status
router.get('/qr/check', requireAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { key } = req.query
  if (!key) return res.status(400).json({ error: 'key required' })
  try {
    const result = await api.login_qr_check({ key })
    const body = result.body || result
    // 800=expired, 801=waiting, 802=scanned/confirmed, 803=success
    if (body.code === 803) {
      // Login success — extract cookies from response
      const cookieArr = result.cookie || body.cookie || []
      // Get user account info
      let neteaseUid = null, nickname = null, avatarUrl = null
      try {
        const cookieStr = Array.isArray(cookieArr) ? cookieArr.join('; ') : cookieArr
        const accountRes = await api.user_account({ cookie: cookieStr })
        const accountBody = accountRes.body || accountRes
        if (accountBody.code === 200 && accountBody.profile) {
          neteaseUid = accountBody.profile.userId
          nickname = accountBody.profile.nickname
          avatarUrl = accountBody.profile.avatarUrl
        }
      } catch {}
      saveNeteaseCredentials(req.user.id, {
        cookies: cookieArr,
        netease_uid: neteaseUid,
        nickname,
        avatar_url: avatarUrl,
      })
    }
    res.json({ code: body.code, message: body.message })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/login/status — check current login status
router.get('/login/status', requireAuth, async (req, res) => {
  try {
    const cred = getNeteaseCredentials(req.user.id)
    if (!cred) return res.json({ loggedIn: false })

    // 调用网易云 API 验证 cookie 是否仍然有效
    try {
      const cookie = Array.isArray(cred.cookies) ? cred.cookies.join('; ') : cred.cookies
      const accountRes = await api.user_account({ cookie })
      const accountBody = accountRes.body || accountRes
      if (accountBody.code === 200 && accountBody.profile) {
        // cookie 有效，返回最新用户信息
        const profile = accountBody.profile
        // 如果用户信息有变化，更新数据库
        if (profile.userId !== cred.netease_uid || profile.nickname !== cred.nickname || profile.avatarUrl !== cred.avatar_url) {
          saveNeteaseCredentials(req.user.id, {
            cookies: cred.cookies,
            netease_uid: profile.userId,
            nickname: profile.nickname,
            avatar_url: profile.avatarUrl,
          })
        }
        return res.json({
          loggedIn: true,
          netease_uid: profile.userId,
          nickname: profile.nickname,
          avatar_url: profile.avatarUrl,
        })
      }
      // cookie 已失效（code 非 200 或无 profile）
      deleteNeteaseCredentials(req.user.id)
      return res.json({ loggedIn: false })
    } catch (apiErr) {
      // API 调用失败，降级使用本地数据
      console.warn('[netease] login/status upstream check failed, falling back to local:', apiErr.message)
      return res.json({
        loggedIn: true,
        netease_uid: cred.netease_uid,
        nickname: cred.nickname,
        avatar_url: cred.avatar_url,
      })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/netease/logout — logout from Netease
router.post('/logout', requireAuth, async (req, res) => {
  try {
    // 先调用网易云 API 登出，清除服务端 session
    try {
      const cred = getNeteaseCredentials(req.user.id)
      if (cred?.cookies) {
        const cookie = Array.isArray(cred.cookies) ? cred.cookies.join('; ') : cred.cookies
        await api.logout({ cookie })
      }
    } catch (apiErr) {
      console.warn('[netease] logout upstream call failed:', apiErr.message)
    }
    // 无论 API 调用是否成功，都删除本地凭证
    deleteNeteaseCredentials(req.user.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Music endpoints ──

// GET /api/netease/search — 搜索歌曲
router.get('/search', optionalAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { keywords, limit = 30, offset = 0 } = req.query
  if (!keywords) return res.status(400).json({ error: 'keywords required' })
  try {
    const cookie = getCookies(req.user?.id)
    const result = await api.search({ keywords, type: 1, limit: Number(limit), offset: Number(offset), cookie })
    const body = result.body || result
    if (body.code !== 200) return res.status(502).json({ error: 'upstream error', code: body.code })
    const songs = (body.result?.songs || []).map(s => ({
      id: s.id,
      name: s.name,
      artists: s.artists?.map(a => a.name).join(' / ') || '',
      album: s.album?.name || '',
      duration: s.duration,
      fee: s.fee,
    }))
    res.json({ songs, songCount: body.result?.songCount || 0 })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/url — 获取歌曲播放 URL
router.get('/url', optionalAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const cookie = getCookies(req.user?.id)
    const result = await api.song_url({ id: Number(id), cookie })
    const body = result.body || result
    const song = body.data?.[0]
    if (!song?.url) return res.status(404).json({ error: 'no url available' })
    res.json({ url: song.url, br: song.br, type: song.type, size: song.size })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/stream — 音频流代理
router.get('/stream', optionalAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })

  try {
    const cookie = getCookies(req.user?.id)
    const result = await api.song_url({ id: Number(id), cookie })
    const body = result.body || result
    const song = body.data?.[0]
    if (!song?.url) return res.status(404).json({ error: 'no url available' })

    // 请求音频流，透传 Range header 以支持拖动进度
    const headers = {}
    if (req.headers.range) {
      headers.Range = req.headers.range
    }
    const audioResp = await fetch(song.url, { headers })

    // 转发响应头
    res.status(audioResp.status)
    const contentType = audioResp.headers.get('content-type')
    const contentLength = audioResp.headers.get('content-length')
    const contentRange = audioResp.headers.get('content-range')
    const acceptRanges = audioResp.headers.get('accept-ranges')

    if (contentType) res.set('Content-Type', contentType)
    if (contentLength) res.set('Content-Length', contentLength)
    if (contentRange) res.set('Content-Range', contentRange)
    if (acceptRanges) res.set('Accept-Ranges', acceptRanges)
    res.set('Cache-Control', 'public, max-age=600')

    // Pipe 音频流
    const reader = audioResp.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { res.end(); return }
        res.write(value)
      }
    }
    await pump()
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'upstream error', detail: e.message })
    } else {
      res.end()
    }
  }
})

// GET /api/netease/lyric — 获取歌词
router.get('/lyric', optionalAuth, async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const cookie = getCookies(req.user?.id)
    const result = await api.lyric({ id: Number(id), cookie })
    const body = result.body || result
    res.json({
      lrc: body.lrc?.lyric || '',
      tlyric: body.tlyric?.lyric || '',
    })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

export default router
