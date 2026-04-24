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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        const contentType = res.headers['content-type'] || ''
        if (options.rawResponse) {
          let body
          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            try { body = JSON.parse(buffer.toString()) } catch { body = buffer.toString() }
          } else {
            body = buffer.toString()
          }
          return resolve({ statusCode: res.statusCode, headers: res.headers, body })
        }
        if (contentType.includes('application/json') || contentType.includes('text/plain')) {
          try {
            resolve(JSON.parse(buffer.toString()))
          } catch {
            resolve(buffer.toString())
          }
        } else if (contentType.includes('image') || options.responseType === 'buffer') {
          resolve(buffer)
        } else {
          resolve(buffer.toString())
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
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
      // 获取用户信息
      const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
      const navData = await fetchUrl('https://api.bilibili.com/x/web-interface/nav', {}, { cookies: cookieStr })
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

// 搜索视频
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { keyword, page = 1 } = req.query
    if (!keyword) {
      return res.status(400).json({ code: -400, message: 'keyword is required' })
    }

    await fetchWbiKeys()
    const params = signWBI({
      search_type: 'video',
      keyword: keyword,
      page: parseInt(page),
      order: 'totalrank',
      duration: 0,
      tids: 0
    })

    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/wbi/search/type', params, cookieStr ? { cookies: cookieStr } : {})
    res.json(data)
  } catch (e) {
    console.error('Bilibili search error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取视频分页信息（获取cid）
router.get('/pagelist', optionalAuth, async (req, res) => {
  try {
    const { bvid } = req.query
    if (!bvid) {
      return res.status(400).json({ code: -400, message: 'bvid is required' })
    }

    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/player/pagelist', { bvid }, cookieStr ? { cookies: cookieStr } : {})
    res.json(data)
  } catch (e) {
    console.error('Bilibili pagelist error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

// 获取视频流地址
router.get('/playurl', optionalAuth, async (req, res) => {
  try {
    const { bvid, cid, qn = 16, fnval = 16, fnver = 0, fourk = 1 } = req.query
    if (!bvid || !cid) {
      return res.status(400).json({ code: -400, message: 'bvid and cid are required' })
    }

    await fetchWbiKeys()
    const params = signWBI({
      bvid: bvid,
      cid: parseInt(cid),
      qn: parseInt(qn),
      fnval: parseInt(fnval),
      fourk: parseInt(fourk)
    })

    const cookieStr = getCookiesString(req.user?.id)
    console.log(params)
    console.log(cookieStr)
    const data = await fetchUrl('https://api.bilibili.com/x/player/wbi/playurl', params, cookieStr ? { cookies: cookieStr } : {})
    res.json(data)
  } catch (e) {
    console.error('Bilibili playurl error:', e.message)
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
router.get('/stream', async (req, res) => {
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

    const rangeHeader = req.headers['range']
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
        'Origin': 'https://www.bilibili.com'
      }
    }

    // 如果有 Range header，添加到请求中
    if (rangeHeader) {
      options.headers['Range'] = rangeHeader
    }

    const proxyReq = httpModule.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode

      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Range')

      // 处理 Range 响应
      if (statusCode === 206) {
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range'])
        }
        res.setHeader('Accept-Ranges', 'bytes')
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length'])
        }
      }

      // 处理 200 响应（无 Range 或 Range 无效）
      if (statusCode === 200) {
        res.setHeader('Accept-Ranges', 'bytes')
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length'])
        }
      }

      // 设置正确的状态码
      res.status(statusCode)

      proxyRes.pipe(res)
    })

    proxyReq.on('error', (e) => {
      console.error('Stream proxy error:', e.message)
      if (!res.headersSent) {
        res.status(500).json({ code: -500, message: e.message })
      }
    })

    proxyReq.end()
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

// DPlayer 弹幕 API - GET /api/bilibili/danmaku/:id (直接格式)
// 参考 DPlayer-node: https://github.com/MoePlayer/DPlayer-node
// router.get('/danmaku/:id', async (req, res) => {
//   try {
//     const id = req.params.id
//     if (!id) {
//       return res.json({ code: 1, msg: 'id is required' })
//     }
//     console.log(id)
//     // 检查内存缓存
//     const cached = danmakuCache.get(id)
//     if (cached) {
//       console.log(`Danmaku cache hit: ${id}`)
//       return res.json({ code: 0, data: cached })
//     }
//
//     // 获取 Bilibili 弹幕 XML
//     const options = {
//       hostname: 'comment.bilibili.com',
//       port: 443,
//       path: `/${id}.xml`,
//       method: 'GET',
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
//         'Referer': 'https://www.bilibili.com',
//         'Accept-Encoding': 'deflate, gzip, br'
//       }
//     }
//
//     const xmlBuffer = await new Promise((resolve, reject) => {
//       const proxyReq = https.request(options, (proxyRes) => {
//         console.log('Danmaku response headers:', JSON.stringify(proxyRes.headers))
//         const chunks = []
//         proxyRes.on('data', chunk => chunks.push(chunk))
//         proxyRes.on('end', () => resolve(Buffer.concat(chunks)))
//       })
//       proxyReq.on('error', reject)
//       proxyReq.end()
//     })
//
//     console.log('Danmaku raw buffer:', xmlBuffer.length, 'bytes, first bytes:', xmlBuffer.slice(0, 30).toString('hex'))
//
//     // 解压数据 - 使用流式解压更可靠
//     let xmlData
//     try {
//       // 首先尝试 raw inflate（无 header）
//       xmlData = zlib.inflateRawSync(xmlBuffer).toString('utf8')
//     } catch (e1) {
//       try {
//         // 尝试 inflate（带 header）
//         xmlData = zlib.inflateSync(xmlBuffer).toString('utf8')
//       } catch (e2) {
//         try {
//           // 尝试 gzip
//           xmlData = zlib.gunzipSync(xmlBuffer).toString('utf8')
//         } catch (e3) {
//           try {
//             // 尝试 unzip
//             xmlData = zlib.unzipSync(xmlBuffer).toString('utf8')
//           } catch (e4) {
//             // 尝试 Brotli
//             try {
//               xmlData = zlib.brotliDecompressSync(xmlBuffer).toString('utf8')
//             } catch (e5) {
//               xmlData = xmlBuffer.toString('utf8')
//             }
//           }
//         }
//       }
//     }
//
//     // 解析 XML 并转换为 DPlayer 格式
//     // DPlayer 格式: [time, type, color, author, text]
//     // type: 0=滚动, 1=顶部, 2=底部
//     console.log('Danmaku decompressed XML (first 200 chars):', xmlData.slice(0, 200))
//
//     const danmakuList = []
//     const dMatches = xmlData.matchAll(/<d p="([^"]+)">([^<]+)<\/d>/g)
//     for (const match of dMatches) {
//       const p = match[1]
//       const text = match[2]
//       const attrs = p.split(',')
//       if (text && attrs.length >= 5) {
//         const time = parseFloat(attrs[0]) || 0
//         const rawType = parseInt(attrs[1]) || 1
//         // 转换弹幕类型: 4=底部->2, 5=顶部->1, 其他->0
//         let type = 0
//         if (rawType === 4) type = 2  // 底部
//         else if (rawType === 5) type = 1  // 顶部
//         const color = parseInt(attrs[2]) || 16777215
//         const author = attrs[3] || 'anonymous'
//         danmakuList.push([time, type, color, author, text.trim()])
//       }
//     }
//
//     // 存入缓存 (10分钟)
//     danmakuCache.set(id, danmakuList)
//     setTimeout(() => danmakuCache.delete(id), 10 * 60 * 1000)
//
//     console.log(`Danmaku: id=${id}, count=${danmakuList.length}`)
//     res.json({ code: 0, data: danmakuList })
//   } catch (e) {
//     console.error('Danmaku error:', e.message)
//     res.json({ code: 1, msg: e.message })
//   }
// })

// 获取视频信息
router.get('/videoinfo', optionalAuth, async (req, res) => {
  try {
    const { bvid } = req.query
    if (!bvid) {
      return res.status(400).json({ code: -400, message: 'bvid is required' })
    }

    const cookieStr = getCookiesString(req.user?.id)
    const data = await fetchUrl('https://api.bilibili.com/x/web-interface/view', { bvid }, cookieStr ? { cookies: cookieStr } : {})
    res.json(data)
  } catch (e) {
    console.error('Bilibili videoinfo error:', e.message)
    res.status(500).json({ code: -500, message: e.message })
  }
})

export default router
