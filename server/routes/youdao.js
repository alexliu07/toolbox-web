import express from 'express'

const router = express.Router()

// GET /api/youdao/suggest — 联想建议
router.get('/suggest', async (req, res) => {
  const { q, num = 15 } = req.query
  if (!q) return res.status(400).json({ error: 'q required' })
  try {
    const url = `http://dict.youdao.com/suggest?q=${encodeURIComponent(q)}&le=eng&num=${num}&doctype=json`
    const resp = await fetch(url)
    const data = await resp.json()
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/youdao/define — 词典释义
router.get('/define', async (req, res) => {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'q required' })
  try {
    const url = `http://dict.youdao.com/jsonapi?q=${encodeURIComponent(q)}&client=mobile&jsonversion=2`
    const resp = await fetch(url)
    const data = await resp.json()
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

// GET /api/youdao/audio — 发音音频代理
router.get('/audio', async (req, res) => {
  const { word, type = 1 } = req.query
  if (!word) return res.status(400).json({ error: 'word required' })
  try {
    const url = `http://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`
    const resp = await fetch(url)
    res.set('Content-Type', resp.headers.get('content-type') || 'audio/mpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    const buf = Buffer.from(await resp.arrayBuffer())
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message })
  }
})

export default router
