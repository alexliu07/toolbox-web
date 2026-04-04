import express from 'express'

const router = express.Router()

let api
try {
  const mod = await import('NeteaseCloudMusicApi')
  api = mod.default || mod.module.exports
} catch (e) {
  console.error('[netease] Failed to load NeteaseCloudMusicApi:', e.message)
}

// GET /api/netease/search — 搜索歌曲
router.get('/search', async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { keywords, limit = 30, offset = 0 } = req.query
  if (!keywords) return res.status(400).json({ error: 'keywords required' })
  try {
    const result = await api.search({ keywords, type: 1, limit: Number(limit), offset: Number(offset) })
    const body = result.body || result
    if (body.code !== 200) return res.status(502).json({ error: 'upstream error', code: body.code })
    const songs = (body.result?.songs || []).map(s => ({
      id: s.id,
      name: s.name,
      artists: s.artists?.map(a => a.name).join(' / ') || '',
      album: s.album?.name || '',
      duration: s.duration, // ms
      fee: s.fee, // 0=free, 1=VIP, 4=purchase album, 8=non-member low quality, member high quality
    }))
    res.json({ songs, songCount: body.result?.songCount || 0 })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/url — 获取歌曲播放 URL
router.get('/url', async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const result = await api.song_url({ id: Number(id) })
    const body = result.body || result
    const song = body.data?.[0]
    if (!song?.url) return res.status(404).json({ error: 'no url available' })
    res.json({ url: song.url, br: song.br, type: song.type, size: song.size })
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/netease/stream — 音频流代理
router.get('/stream', async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })

  try {
    // 获取歌曲 URL
    const result = await api.song_url({ id: Number(id) })
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
router.get('/lyric', async (req, res) => {
  if (!api) return res.status(500).json({ error: 'NeteaseCloudMusicApi not loaded' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const result = await api.lyric({ id: Number(id) })
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
