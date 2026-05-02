import express from 'express'
import https from 'https'
import http from 'http'
import crypto from 'crypto'
import { URL } from 'url'
import zlib from 'zlib'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { getBilibiliCredentials, saveBilibiliCredentials, deleteBilibiliCredentials } from '../db.js'
import QRCode from 'qrcode'

const router = express.Router()

// XML 转义（MPD 清单中的 URL 可能包含特殊字符）
function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// 弹幕内存缓存 (参考 DPlayer-node)
const danmakuCache = new Map()

// WBI 签名相关配置
let wbiKeys = {
  imgKey: '',
  subKey: '',
  lastUpdate: 0
}
const WBI_KEY_CACHE_MS = 3600000 // 1小时缓存

// MIME类型映射
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4s': 'video/mp4',
  '.mpd': 'application/dash+xml',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/m4a',
}

// WBI mixin key 混淆表
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

// 生成 mixin_key
function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.slice(0, 32).map(i => orig[i]).join('')
}

// 生成 WBI 签名
function signWBI(params) {
  const now = Math.floor(Date.now() / 1000)
  const params2 = { ...params, wts: now }
  const keys = Object.keys(params2).sort()
  const str = keys.map(k => `${k}=${params2[k]}`).join('&')
  const mixinKey = getMixinKey(wbiKeys.imgKey + wbiKeys.subKey)
  const w_rid = crypto.createHash('md5').update(str + mixinKey).digest('hex')
  params2.w_rid = w_rid
  return params2
}

// 获取 WBI keys
async function fetchWbiKeys() {
  const now = Date.now()
  if (wbiKeys.imgKey && now - wbiKeys.lastUpdate < WBI_KEY_CACHE_MS) {
    return
  }
  try {
    const navData = await fetchUrl('https://api.bilibili.com/x/web-interface/nav', {})
    const wbiImg = navData?.data?.wbi_img
    if (wbiImg?.img_url && wbiImg?.sub_url) {
      const imgUrl = new URL(wbiImg.img_url)
      const subUrl = new URL(wbiImg.sub_url)
      wbiKeys.imgKey = imgUrl.pathname.slice('/bfs/wbi/'.length).replace('.png', '')
      wbiKeys.subKey = subUrl.pathname.slice('/bfs/wbi/'.length).replace('.png', '')
      wbiKeys.lastUpdate = now
    }
  } catch (e) {
    console.error('Failed to fetch WBI keys:', e.message)
  }
}

// 获取用户 Bilibili cookie 字符串
function getCookiesString(userId) {
  if (!userId) return undefined
  try {
    const cred = getBilibiliCredentials(userId)
    if (!cred?.cookies) return undefined
    return Object.entries(cred.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  } catch {
    return undefined
  }
}

// 通用 HTTP 请求函数
function fetchUrl(targetUrl, params, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl)
    const isHttps = urlObj.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const queryParams = new URLSearchParams(urlObj.search)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        queryParams.append(k, v)
      }
    }
    const queryString = queryParams.toString()
    const path = urlObj.pathname + (queryString ? '?' + queryString : '')

    const options2 = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: path,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
        'Origin': 'https://www.bilibili.com',
        ...(options.cookies ? { 'Cookie': options.cookies } : {}),
        ...options.headers
      },
      timeout: 15000
    }
    const req = httpModule.request(options2, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)

        // 解压 Content-Encoding (gzip / deflate / br)
        let decoded = buffer
        const encoding = res.headers['content-encoding']
        if (encoding === 'gzip') {
          try { decoded = zlib.gunzipSync(buffer) } catch {}
        } else if (encoding === 'deflate') {
          try { decoded = zlib.inflateSync(buffer) } catch {}
        } else if (encoding === 'br') {
          try { decoded = zlib.brotliDecompressSync(buffer) } catch {}
        }

        const contentType = res.headers['content-type'] || ''
        if (options.rawResponse) {
          let body
          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            try { body = JSON.parse(decoded.toString()) } catch { body = decoded.toString() }
          } else {
            body = decoded.toString()
          }
          return resolve({ statusCode: res.statusCode, headers: res.headers, body })
        }
        if (contentType.includes('application/json') || contentType.includes('text/plain')) {
          try {
            resolve(JSON.parse(decoded.toString()))
          } catch {
            resolve(decoded.toString())
          }
        } else if (contentType.includes('image') || options.responseType === 'buffer') {
          resolve(buffer)
        } else {
          resolve(decoded.toString())
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

// ── 登录相关端点 ──

// GET /login/qr/generate — 生成二维码
router.get('/login/qr/generate', requireAuth, async (req, res) => {
  try {
    const data = await fetchUrl('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {})
    if (data.code !== 0 || !data.data?.url) {
      return res.status(502).json({ error: 'Failed to generate QR code', code: data.code })
    }
    const qrimg = await QRCode.toDataURL(data.data.url, { width: 200, margin: 2 })
    res.json({ qrcode_key: data.data.qrcode_key, qrimg })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /login/qr/poll — 轮询扫码状态
// B站API: 顶层 code 永远为 0，实际扫码状态在 data.code
// data.code: 86101=未扫码, 86090=已扫码未确认, 0=登录成功, 86038=二维码失效
router.get('/login/qr/poll', requireAuth, async (req, res) => {
  const { qrcode_key } = req.query
  if (!qrcode_key) return res.status(400).json({ error: 'qrcode_key required' })
  try {
    const resp = await fetchUrl(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcode_key)}`,
      {}, { rawResponse: true }
    )
    const body = resp.body
    const status = body.data?.code

    if (status === 0) {
      // 登录成功 — 从 Set-Cookie 提取 cookies
      const setCookies = resp.headers['set-cookie'] || []
      const cookies = {}
      for (const sc of setCookies) {
        const match = sc.match(/^([^=]+)=([^;]*)/)
        if (match) cookies[match[1]] = match[2]
      }
      // 请求 www.bilibili.com 获取更多 cookie
      const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
      try {
        const homepageResp = await fetchUrl('https://www.bilibili.com/', {}, { rawResponse: true, headers: { Cookie: cookieStr } })
        const extraCookies = homepageResp.headers['set-cookie'] || []
        for (const sc of extraCookies) {
          const match = sc.match(/^([^=]+)=([^;]*)/)
          if (match) cookies[match[1]] = match[2]
        }
      } catch (e) {
        console.warn('[bilibili] failed to fetch homepage cookies:', e.message)
      }

      // 获取用户信息
      const cookieStr2 = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
      const navData = await fetchUrl('https://api.bilibili.com/x/web-interface/nav', {}, { cookies: cookieStr2 })
      const profile = navData?.data || {}
      saveBilibiliCredentials(req.user.id, {
        cookies,
        bilibili_mid: profile.mid || parseInt(cookies.DedeUserID) || null,
        nickname: profile.uname || null,
        avatar_url: profile.face || null,
      })
      return res.json({
        code: 0, message: 'success',
        user: { mid: profile.mid, nickname: profile.uname, avatar_url: profile.face }
      })
    }

    // 86101=未扫码, 86090=已扫码未确认, 86038=二维码失效
    res.json({ code: status, message: body.data?.message || body.message })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /login/status — 检查登录状态
router.get('/login/status', requireAuth, async (req, res) => {
  try {
    const cred = getBilibiliCredentials(req.user.id)
    if (!cred) return res.json({ loggedIn: false })
    try {
      const cookieStr = Object.entries(cred.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
      const navData = await fetchUrl('https://api.bilibili.com/x/web-interface/nav', {}, { cookies: cookieStr })
      if (navData?.data?.isLogin) {
        const p = navData.data
        if (p.uname !== cred.nickname || p.face !== cred.avatar_url) {
          saveBilibiliCredentials(req.user.id, {
            cookies: cred.cookies, bilibili_mid: p.mid,
            nickname: p.uname, avatar_url: p.face,
          })
        }
        return res.json({ loggedIn: true, mid: p.mid, nickname: p.uname, avatar_url: p.face })
      }
      deleteBilibiliCredentials(req.user.id)
      return res.json({ loggedIn: false })
    } catch (apiErr) {
      console.warn('[bilibili] login/status upstream check failed, falling back to local:', apiErr.message)
      return res.json({
        loggedIn: true, mid: cred.bilibili_mid,
        nickname: cred.nickname, avatar_url: cred.avatar_url,
      })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /logout — 登出
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const cred = getBilibiliCredentials(req.user.id)
    if (cred?.cookies) {
      try {
        const cookieStr = Object.entries(cred.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
        await fetchUrl('https://passport.bilibili.com/login/exit/v2', {}, {
          method: 'POST', cookies: cookieStr,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRF-Token': cred.cookies.bili_jct || ''
          }
        })
      } catch (apiErr) {
        console.warn('[bilibili] logout upstream call failed:', apiErr.message)
      }
    }
    deleteBilibiliCredentials(req.user.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 视频相关端点 ──

// 搜索（视频/番剧/直播）
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { keyword, page = 1, search_type = 'video' } = req.query
    if (!keyword) {
      return res.status(400).json({ code: -400, message: 'keyword is required' })
    }

    const validTypes = ['video', 'media_bangumi', 'live']
    const type = validTypes.includes(search_type) ? search_type : 'video'

    await fetchWbiKeys()
    const wbiParams = {
      search_type: type,
      keyword: keyword,
      page: parseInt(page),
    }
    if (type === 'video') {
      wbiParams.order = 'totalrank'
      wbiParams.duration = 0
      wbiParams.tids = 0
    } else if (type === 'live') {
      wbiParams.order = 'online'
    }
    const params = signWBI(wbiParams)
    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/wbi/search/type', params, cookieStr ? { cookies: cookieStr } : {})

    // live搜索返回的是 { result: { live_room: [...], live_user: [...] } }
    // 统一为 { data: { result: [...] } } 格式
    if (type === 'live' && data.code === 0 && data.data?.result) {
      const rooms = data.data.result.live_room || []
      data.data.result = rooms
      data.data.numResults = data.data.pageinfo?.live_room?.numResults || rooms.length
    }

    res.json(data)
  } catch (e) {
    console.error('Bilibili search error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取视频分页信息（获取cid）
router.get('/pagelist', optionalAuth, async (req, res) => {
  try {
    const { bvid, season_id } = req.query
    if (!bvid && !season_id) {
      return res.status(400).json({ code: -400, message: 'bvid or season_id is required' })
    }
    const cookieStr = getCookiesString(req.user?.id)
    if (season_id) {
      // 番剧分集信息
      const data = await fetchUrl('https://api.bilibili.com/pgc/view/web/season', { season_id }, cookieStr ? { cookies: cookieStr } : {})
      if (data.code === 0 && data.result?.episodes?.length) {
        const eps = data.result.episodes.map(ep => ({
          aid: ep.aid,
          bvid: ep.bvid,
          cid: ep.cid,
          title: ep.title + ' ' + (ep.long_title || ''),
          id: ep.id,
        }))
        res.json({ code: 0, data: eps })
      } else {
        res.json(data)
      }
    } else {
      const data = await fetchUrl('https://api.bilibili.com/x/player/pagelist', { bvid }, cookieStr ? { cookies: cookieStr } : {})
      res.json(data)
    }
  } catch (e) {
    console.error('Bilibili pagelist error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取视频详细信息（UP主、简介、统计数据等）
router.get('/videoinfo', optionalAuth, async (req, res) => {
  try {
    const { bvid } = req.query
    if (!bvid) {
      return res.status(400).json({ code: -400, message: 'bvid is required' })
    }
    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/view', { bvid }, cookieStr ? { cookies: cookieStr } : {})
    if (data.code !== 0) {
      return res.json({ code: data.code, message: data.message || 'videoinfo error' })
    }
    const d = data.data
    res.json({
      code: 0,
      data: {
        title: d.title,
        desc: d.desc,
        desc_v2: d.desc_v2 || [],
        pubdate: d.pubdate,
        owner: d.owner ? { mid: d.owner.mid, name: d.owner.name, face: d.owner.face } : null,
        stat: d.stat ? {
          view: d.stat.view,
          danmaku: d.stat.danmaku,
          reply: d.stat.reply,
          favorite: d.stat.favorite,
          coin: d.stat.coin,
          share: d.stat.share,
          like: d.stat.like,
        } : null,
        pages: d.pages || [],
      }
    })
  } catch (e) {
    console.error('Bilibili videoinfo error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 生成 MPD 清单文件（供 dash.js 播放）
router.get('/mpd', optionalAuth, async (req, res) => {
  try {
    const { bvid, cid } = req.query
    if (!bvid || !cid) {
      return res.status(400).json({ code: -400, message: 'bvid and cid are required' })
    }

    await fetchWbiKeys()
    const params = signWBI({
      bvid: bvid,
      cid: parseInt(cid),
      fnval: 4048,
      fourk: 1,
      fnver: 0,
    })
    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/player/wbi/playurl', params, cookieStr ? { cookies: cookieStr } : {})

    if (data.code !== 0) {
      return res.status(502).json({ code: data.code, message: data.message || 'playurl error' })
    }

    const dash = data.data?.dash
    if (!dash || !dash.video?.length) {
      return res.status(502).json({ code: -502, message: 'no DASH streams' })
    }

    const duration = dash.duration || 0

    // 构建清晰度 id → 描述 的映射
    const qualityMap = {}
    const acceptQuality = data.data?.accept_quality || []
    const acceptDescription = data.data?.accept_description || []
    for (let i = 0; i < acceptQuality.length; i++) {
      qualityMap[acceptQuality[i]] = acceptDescription[i] || ''
    }

    // 构建代理 URL（绝对路径，dash.js 会直接请求这些 URL）
    const streamBase = '/api/bilibili/stream'

    // 视频 AdaptationSet — 包含所有清晰度的 Representation
    let videoRepresentations = ''
    let cnt = 0;
    for (let i = 0; i < dash.video.length; i++) {
      const v = dash.video[i]
      if(v.codecid !== 7)continue;
      const proxyVideoUrl = `${streamBase}?url=${encodeURIComponent(v.baseUrl)}`
      const codecs = v.codecs || 'avc1.640032'
      const bandwidth = v.bandwidth || 1000000
      const width = v.width || 1920
      const height = v.height || 1080
      const fps = `${parseFloat(v.frameRate) * 1000}/1000`
      const label = qualityMap[v.id] || `${height}P`
      videoRepresentations += `
        <Representation id="${cnt++}" bandwidth="${bandwidth}" codecs="${codecs}" width="${width}" height="${height}" frameRate="${fps}" label="${label}">
          <BaseURL>${escapeXml(proxyVideoUrl)}</BaseURL>
        </Representation>`
    }

    let adaptationSets = `
    <AdaptationSet mimeType="video/mp4">
      ${videoRepresentations}
    </AdaptationSet>`

    // 音频 AdaptationSet — 包含所有音质的 Representation
    if (dash.audio?.length) {
      let audioRepresentations = ''
      for (let i = 0; i < dash.audio.length; i++) {
        const a = dash.audio[i]
        const proxyAudioUrl = `${streamBase}?url=${encodeURIComponent(a.baseUrl)}`
        const codecs = a.codecs || 'mp4a.40.2'
        const bandwidth = a.bandwidth || 128000
        audioRepresentations += `
        <Representation id="${i}" bandwidth="${bandwidth}" codecs="${codecs}">
          <BaseURL>${escapeXml(proxyAudioUrl)}</BaseURL>
        </Representation>`
      }
      adaptationSets += `
    <AdaptationSet mimeType="audio/mp4">
      ${audioRepresentations}
    </AdaptationSet>`
    }

    const mpdXml = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S">
  <Period>
    ${adaptationSets}
  </Period>
</MPD>`

    // 同时返回上次播放进度（复用同一个 playurl 响应，无需额外请求）
    const lastPlayTime = data.data?.last_play_time ?? null
    if (lastPlayTime != null) {
      res.setHeader('X-Last-Play-Time', lastPlayTime)
    }

    res.setHeader('Content-Type', 'application/dash+xml')
    res.send(mpdXml)
  } catch (e) {
    console.error('MPD generation error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 番剧视频流 MPD 清单生成
router.get('/bangumi-mpd', optionalAuth, async (req, res) => {
  try {
    const { avid, cid, ep_id } = req.query
    if (!cid || (!avid && !ep_id)) {
      return res.status(400).json({ code: -400, message: 'cid and (avid or ep_id) are required' })
    }

    const params = {
      cid: parseInt(cid),
      fnval: 4048,
      fourk: 1,
      fnver: 0,
    }
    if (avid) params.avid = parseInt(avid)
    if (ep_id) params.ep_id = parseInt(ep_id)

    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/pgc/player/web/playurl', params, cookieStr ? { cookies: cookieStr } : {})

    if (data.code !== 0) {
      console.error('Bangumi playurl error:', data.code, data.message)
      return res.status(502).json({ code: data.code, message: data.message || 'bangumi playurl error' })
    }

    // 番剧接口返回 result 而非 data
    const result = data.result || data.data
    const dash = result?.dash
    if (!dash || !dash.video?.length) {
      console.error('Bangumi no DASH streams, response keys:', Object.keys(data), 'result keys:', result ? Object.keys(result) : 'null')
      return res.status(502).json({ code: -502, message: 'no DASH streams' })
    }

    const duration = dash.duration || 0

    // 构建清晰度 id → 描述 的映射
    const qualityMap = {}
    const acceptQuality = result?.accept_quality || []
    const acceptDescription = result?.accept_description || []
    for (let i = 0; i < acceptQuality.length; i++) {
      qualityMap[acceptQuality[i]] = acceptDescription[i] || ''
    }

    const streamBase = '/api/bilibili/stream'

    // 视频 AdaptationSet — 仅 AVC 编码
    let videoRepresentations = ''
    let cnt = 0
    for (let i = 0; i < dash.video.length; i++) {
      const v = dash.video[i]
      if (v.codecid !== 7) continue
      const proxyVideoUrl = `${streamBase}?url=${encodeURIComponent(v.baseUrl)}`
      const codecs = v.codecs || 'avc1.640032'
      const bandwidth = v.bandwidth || 1000000
      const width = v.width || 1920
      const height = v.height || 1080
      const fps = `${parseFloat(v.frameRate) * 1000}/1000`
      const label = qualityMap[v.id] || `${height}P`
      videoRepresentations += `
        <Representation id="${cnt++}" bandwidth="${bandwidth}" codecs="${codecs}" width="${width}" height="${height}" frameRate="${fps}" label="${label}">
          <BaseURL>${escapeXml(proxyVideoUrl)}</BaseURL>
        </Representation>`
    }

    let adaptationSets = `
    <AdaptationSet mimeType="video/mp4">
      ${videoRepresentations}
    </AdaptationSet>`

    // 音频 AdaptationSet
    if (dash.audio?.length) {
      let audioRepresentations = ''
      for (let i = 0; i < dash.audio.length; i++) {
        const a = dash.audio[i]
        const proxyAudioUrl = `${streamBase}?url=${encodeURIComponent(a.baseUrl)}`
        const codecs = a.codecs || 'mp4a.40.2'
        const bandwidth = a.bandwidth || 128000
        audioRepresentations += `
        <Representation id="${i}" bandwidth="${bandwidth}" codecs="${codecs}">
          <BaseURL>${escapeXml(proxyAudioUrl)}</BaseURL>
        </Representation>`
      }
      adaptationSets += `
    <AdaptationSet mimeType="audio/mp4">
      ${audioRepresentations}
    </AdaptationSet>`
    }

    const mpdXml = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S">
  <Period>
    ${adaptationSets}
  </Period>
</MPD>`

    // 返回上次播放进度
    const lastPlayTime = result?.last_play_time ?? null
    if (lastPlayTime != null) {
      res.setHeader('X-Last-Play-Time', lastPlayTime)
    }

    res.setHeader('Content-Type', 'application/dash+xml')
    res.send(mpdXml)
  } catch (e) {
    console.error('Bangumi MPD generation error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 番剧信息（标题、简介、追番状态等）
router.get('/bangumi-info', optionalAuth, async (req, res) => {
  try {
    const { season_id } = req.query
    if (!season_id) return res.status(400).json({ code: -400, message: 'season_id is required' })
    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/pgc/view/web/season', { season_id }, cookieStr ? { cookies: cookieStr } : {})
    if (data.code !== 0) return res.json({ code: data.code, message: data.message })
    const r = data.result || data.data
    res.json({
      code: 0,
      data: {
        title: r?.season_title || r?.title || '',
        evaluate: r?.evaluate || '',
        areas: r?.areas || [],
        styles: r?.styles || [],
        publish: r?.publish || {},
        rating: r?.rating || null,
        total: r?.total || 0,
        new_ep: r?.new_ep || {},
        user_status: r?.user_status || {},
      }
    })
  } catch (e) {
    console.error('Bangumi info error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 追番
router.post('/bangumi/follow', optionalAuth, async (req, res) => {
  try {
    const { season_id } = req.body
    if (!season_id) return res.status(400).json({ code: -400, message: 'season_id is required' })
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) return res.json({ code: -101, message: '账号未登录' })
    const cred = getBilibiliCredentials(req.user?.id)
    const csrf = cred?.cookies?.bili_jct || ''
    const params = new URLSearchParams({ season_id: String(season_id), csrf })
    const data = await fetchUrl('https://api.bilibili.com/pgc/web/follow/add', {}, {
      method: 'POST', cookies: cookieStr,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
    res.json(data)
  } catch (e) {
    console.error('Bangumi follow error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 取消追番
router.post('/bangumi/unfollow', optionalAuth, async (req, res) => {
  try {
    const { season_id } = req.body
    if (!season_id) return res.status(400).json({ code: -400, message: 'season_id is required' })
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) return res.json({ code: -101, message: '账号未登录' })
    const cred = getBilibiliCredentials(req.user?.id)
    const csrf = cred?.cookies?.bili_jct || ''
    const params = new URLSearchParams({ season_id: String(season_id), csrf })
    const data = await fetchUrl('https://api.bilibili.com/pgc/web/follow/del', {}, {
      method: 'POST', cookies: cookieStr,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
    res.json(data)
  } catch (e) {
    console.error('Bangumi unfollow error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 直播间信息
router.get('/live-info', async (req, res) => {
  try {
    const { room_id } = req.query
    if (!room_id) return res.status(400).json({ code: -400, message: 'room_id is required' })
    const data = await fetchUrl('https://api.live.bilibili.com/room/v1/Room/get_info', { room_id })
    if (data.code !== 0) return res.json({ code: data.code, message: data.message })
    const d = data.data
    res.json({
      code: 0,
      data: {
        room_id: d.room_id,
        short_id: d.short_id,
        uid: d.uid,
        title: d.title,
        description: d.description,
        cover: d.user_cover,
        keyframe: d.keyframe,
        live_status: d.live_status,
        online: d.online,
        area_name: d.area_name,
        parent_area_name: d.parent_area_name,
        live_time: d.live_time,
        tags: d.tags,
      }
    })
  } catch (e) {
    console.error('Live info error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 直播流地址
router.get('/live-stream', async (req, res) => {
  try {
    const { room_id, qn = 150 } = req.query
    if (!room_id) return res.status(400).json({ code: -400, message: 'room_id is required' })
    const data = await fetchUrl('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo', {
      room_id,
      protocol: '0,1',
      format: '0,1,2',
      codec: '0,1',
      qn: parseInt(qn),
      platform: 'web',
      ptype: 8,
    })
    if (data.code !== 0) return res.json({ code: data.code, message: data.message })
    const playurl = data.data?.playurl_info?.playurl
    if (!playurl) return res.json({ code: -502, message: 'no playurl' })

    // 提取所有可用流
    const streams = []
    for (const protocol of (playurl.stream || [])) {
      for (const format of (protocol.format || [])) {
        for (const codec of (format.codec || [])) {
          if (!codec.url_info?.length) continue
          const urlObj = codec.url_info[0]
          streams.push({
            protocol: protocol.protocol_name,
            format: format.format_name,
            codec: codec.codec_name,
            url: urlObj.host + codec.base_url + urlObj.extra,
            current_qn: codec.current_qn,
            accept_qn: codec.accept_qn,
          })
        }
      }
    }

    // 画质描述
    const qnDesc = (playurl.g_qn_desc || []).map(q => ({ qn: q.qn, desc: q.desc }))

    res.json({ code: 0, data: { streams, qn_desc: qnDesc, current_qn: playurl.stream?.[0]?.format?.[0]?.codec?.[0]?.current_qn || 0 } })
  } catch (e) {
    console.error('Live stream error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 直播主播信息
router.get('/live-anchor', async (req, res) => {
  try {
    const { roomid } = req.query
    if (!roomid) return res.status(400).json({ code: -400, message: 'roomid is required' })
    const data = await fetchUrl('https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room', { roomid })
    if (data.code !== 0) return res.json({ code: data.code, message: data.message })
    const info = data.data?.info
    if (!info) return res.json({ code: -502, message: 'no anchor info' })
    res.json({
      code: 0,
      data: {
        uid: info.uid,
        uname: info.uname,
        face: info.face,
        gender: info.gender,
        official_verify: info.official_verify,
      }
    })
  } catch (e) {
    console.error('Live anchor error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 图片代理
router.get('/image', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) {
      return res.status(400).json({ code: -400, message: 'url is required' })
    }

    let targetUrl = url
    if (url.startsWith('//')) {
      targetUrl = 'https:' + url
    }

    const urlObj = new URL(targetUrl)
    const isHttps = urlObj.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    }

    const proxyReq = httpModule.request(options, (proxyRes) => {
      const ext = urlObj.pathname.split('.').pop()?.toLowerCase() || 'jpg'
      const contentType = MIME_MAP['.' + ext] || proxyRes.headers['content-type'] || 'image/jpeg'

      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=86400')
      proxyRes.pipe(res)
    })

    proxyReq.on('error', (e) => {
      console.error('Image proxy error:', e.message)
      if (!res.headersSent) {
        res.status(500).json({ code: -500, message: e.message })
      }
    })

    proxyReq.end()
  } catch (e) {
    console.error('Image proxy error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 视频流代理
router.get('/stream', optionalAuth, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Range')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.status(204).end()
      return
    }
    const { url } = req.query
    if (!url) {
      return res.status(400).json({ code: -400, message: 'url is required' })
    }

    let targetUrl = url
    if (url.startsWith('//')) {
      targetUrl = 'https:' + url
    }

    const urlObj = new URL(targetUrl)
    const isHttps = urlObj.protocol === 'https:'
    const httpModule = isHttps ? https : http
    const cookieStr = getCookiesString(req.user?.id)
    const rangeHeader = req.headers['range']

    function makeRequest(includeRange) {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
        'Origin': 'https://www.bilibili.com',
        ...(cookieStr ? { 'Cookie': cookieStr } : {})
      }
      if (includeRange && rangeHeader) {
        headers['Range'] = rangeHeader
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers
      }

      const proxyReq = httpModule.request(options, (proxyRes) => {
        // 正常响应（200 或 206）→ 直接 pipe
        const contentType = proxyRes.headers['content-type'] || 'video/mp4'

        res.status(proxyRes.statusCode)
        res.setHeader('Content-Type', contentType)
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', 'Range')
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range'])
        }
        res.setHeader('Accept-Ranges', proxyRes.headers['accept-ranges'] || 'bytes')
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length'])
        }
        proxyRes.pipe(res)
      })

      proxyReq.on('error', (e) => {
        console.error('Stream proxy error:', e.message)
        if (!res.headersSent) {
          res.status(500).json({ code: -500, message: e.message })
        }
      })

      proxyReq.end()
    }

    makeRequest(true)
  } catch (e) {
    console.error('Stream proxy error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// DPlayer 弹幕 API - GET /api/bilibili/danmaku/v3/?id=xxx
// 参考 DPlayer-node: https://github.com/MoePlayer/DPlayer-node
router.get('/danmaku/', async (req, res) => {
  const id = req.query.id
  if (!id) {
    return res.json({ code: 1, msg: 'id is required' })
  }

  // 检查内存缓存
  const cached = danmakuCache.get(id)
  if (cached) {
    console.log(`Danmaku cache hit: ${id}`)
    return res.json({ code: 0, data: cached })
  }

  // 获取 Bilibili 弹幕 XML
  const options = {
    hostname: 'comment.bilibili.com',
    port: 443,
    path: `/${id}.xml`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com',
      'Accept-Encoding': 'deflate, gzip, br'
    }
  }

  try {
    const xmlBuffer = await new Promise((resolve, reject) => {
      const proxyReq = https.request(options, (proxyRes) => {
        const chunks = []
        proxyRes.on('data', chunk => chunks.push(chunk))
        proxyRes.on('end', () => resolve(Buffer.concat(chunks)))
      })
      proxyReq.on('error', reject)
      proxyReq.end()
    })

    // 解压数据
    let xmlData
    xmlData = zlib.inflateRawSync(xmlBuffer).toString('utf8')

    // 解析 XML 并转换为 DPlayer 格式
    const danmakuList = []
    const dMatches = xmlData.matchAll(/<d p="([^"]+)">([^<]+)<\/d>/g)
    for (const match of dMatches) {
      const p = match[1]
      const text = match[2]
      const attrs = p.split(',')
      if (text && attrs.length >= 5) {
        const time = parseFloat(attrs[0]) || 0
        const rawType = parseInt(attrs[1]) || 1
        const color = parseInt(attrs[3]) || 16777215
        const author = attrs[6] || 'anonymous'
        danmakuList.push([time, rawType, color, author, text.trim()])
      }
    }

    // 存入缓存 (10分钟)
    danmakuCache.set(id, danmakuList)
    setTimeout(() => danmakuCache.delete(id), 10 * 60 * 1000)

    console.log(`Danmaku v3: id=${id}, count=${danmakuList.length}`)
    res.json({ code: 0, data: danmakuList })
  } catch (e) {
    console.error('Danmaku error:', e.message)
    res.json({ code: 1, msg: e.message })
  }
})

// 获取历史记录列表（游标分页）
router.get('/history', optionalAuth, async (req, res) => {
  try {
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) {
      return res.json({ code: -101, message: '账号未登录' })
    }

    const { max, business, view_at, type, ps } = req.query
    const params = {}
    if (max) params.max = max
    if (business) params.business = business
    if (view_at) params.view_at = view_at
    if (type) params.type = type
    params.ps = ps || 20

    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/history/cursor', params, { cookies: cookieStr })
    res.json(data)
  } catch (e) {
    console.error('Bilibili history error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取首页视频推荐列表
router.get('/recommend', optionalAuth,async (req, res) => {
  try {
    await fetchWbiKeys()
    const { fresh_idx = '1', ps = '12' } = req.query
    const freshIdxNum = parseInt(fresh_idx)
    const psNum = parseInt(ps)
    const params = signWBI({
      ps: psNum,
      fresh_idx: freshIdxNum,
      fresh_idx_1h: freshIdxNum,
      brush: freshIdxNum,
      fetch_row: freshIdxNum * psNum,
    })
    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd', params, cookieStr ? { cookies: cookieStr } : {})
    res.json(data)
  } catch (e) {
    console.error('Bilibili recommend error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取稍后再看列表
router.get('/toview', optionalAuth, async (req, res) => {
  try {
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) {
      return res.json({ code: -101, message: '账号未登录' })
    }

    const data = await fetchUrl('https://api.bilibili.com/x/v2/history/toview', {}, { cookies: cookieStr })
    res.json(data)
  } catch (e) {
    console.error('Bilibili toview error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 添加稍后再看
router.post('/toview/add', optionalAuth, async (req, res) => {
  try {
    const { aid } = req.body
    if (!aid) return res.status(400).json({ code: -400, message: 'aid is required' })
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) return res.json({ code: -101, message: '账号未登录' })
    const cred = getBilibiliCredentials(req.user?.id)
    const csrf = cred?.cookies?.bili_jct || ''
    const params = new URLSearchParams({ aid: String(aid), csrf })
    const data = await fetchUrl('https://api.bilibili.com/x/v2/history/toview/add', {}, {
      method: 'POST', cookies: cookieStr,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
    res.json(data)
  } catch (e) {
    console.error('Bilibili toview add error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取用户收藏夹列表
router.get('/favorites', optionalAuth, async (req, res) => {
  try {
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) {
      return res.json({ code: -101, message: '账号未登录' })
    }

    // 先获取用户 mid
    const navData = await fetchUrl('https://api.bilibili.com/x/web-interface/nav', {}, { cookies: cookieStr })
    const mid = navData?.data?.mid
    if (!mid) {
      return res.json({ code: -101, message: '无法获取用户信息' })
    }

    const { rid } = req.query
    const params = { up_mid: mid, type: 2 }
    if (rid) params.rid = rid
    const data = await fetchUrl('https://api.bilibili.com/x/v3/fav/folder/created/list-all', params, { cookies: cookieStr })
    res.json(data)
  } catch (e) {
    console.error('Bilibili favorites error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取收藏夹内容列表
router.get('/favorites/detail', optionalAuth, async (req, res) => {
  try {
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) {
      return res.json({ code: -101, message: '账号未登录' })
    }

    const { media_id, pn = 1, ps = 20 } = req.query
    if (!media_id) {
      return res.status(400).json({ code: -400, message: 'media_id is required' })
    }

    const data = await fetchUrl('https://api.bilibili.com/x/v3/fav/resource/list', {
      media_id: parseInt(media_id),
      pn: parseInt(pn),
      ps: parseInt(ps),
      platform: 'web',
    }, { cookies: cookieStr })
    res.json(data)
  } catch (e) {
    console.error('Bilibili favorites detail error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// ── 观众操作端点 ──

// 获取收藏状态
router.get('/fav/status', optionalAuth, async (req, res) => {
  try {
    const { aid } = req.query
    if (!aid) return res.status(400).json({ code: -400, message: 'aid is required' })
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) return res.json({ code: -101, message: '账号未登录' })
    const data = await fetchUrl('https://api.bilibili.com/x/v2/fav/video/favoured', { aid }, { cookies: cookieStr })
    res.json(data)
  } catch (e) {
    console.error('Fav status error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 收藏/取消收藏
router.post('/fav', optionalAuth, async (req, res) => {
  try {
    const { rid, add_media_ids = '', del_media_ids = '' } = req.body
    if (!rid) return res.status(400).json({ code: -400, message: 'rid is required' })
    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) return res.json({ code: -101, message: '账号未登录' })
    const cred = getBilibiliCredentials(req.user?.id)
    const csrf = cred?.cookies?.bili_jct || ''
    const params = new URLSearchParams({
      rid: String(rid), type: '2',
      add_media_ids: String(add_media_ids),
      del_media_ids: String(del_media_ids),
      csrf
    })
    const data = await fetchUrl('https://api.bilibili.com/x/v3/fav/resource/deal', {}, {
      method: 'POST', cookies: cookieStr,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
    res.json(data)
  } catch (e) {
    console.error('Fav error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 上报观看进度
router.post('/report', optionalAuth, async (req, res) => {
  try {
    const { aid, cid, progress } = req.body
    if (!aid || !cid) {
      return res.status(400).json({ code: -400, message: 'aid and cid are required' })
    }

    const cookieStr = getCookiesString(req.user?.id)
    if (!cookieStr) {
      return res.json({ code: -101, message: 'not logged in' })
    }

    // 从 cookie 中提取 csrf (bili_jct)
    const cred = getBilibiliCredentials(req.user?.id)
    const csrf = cred?.cookies?.bili_jct || ''

    const params = new URLSearchParams({
      aid: String(aid),
      cid: String(cid),
      progress: String(Math.floor(progress || 0)),
      platform: 'android',
      csrf
    })

    const data = await fetchUrl('https://api.bilibili.com/x/v2/history/report', {}, {
      method: 'POST',
      cookies: cookieStr,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    })

    res.json(data)
  } catch (e) {
    console.error('Bilibili report error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

export default router
