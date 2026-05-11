import express from 'express'
import screenshot from 'screenshot-desktop'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()
router.use(requireAuth)

// 内存缓存：最近一次截图的 Buffer + 时间戳
const cache = { buffer: null, timestamp: 0 }
const CACHE_TTL = 10000 // 10 秒

router.get('/capture', async (req, res) => {
  try {
    const now = Date.now()
    // 10 秒内有缓存，直接返回
    if (cache.buffer && now - cache.timestamp < CACHE_TTL) {
      res.set('Content-Type', 'image/png')
      res.set('X-Capture-Time', cache.timestamp.toString())
      res.set('X-Cache', 'hit')
      return res.end(cache.buffer)
    }

    // 截取新屏幕截图
    const imgBuffer = await screenshot({ format: 'png' })
    cache.buffer = imgBuffer
    cache.timestamp = now

    res.set('Content-Type', 'image/png')
    res.set('X-Capture-Time', now.toString())
    res.set('X-Cache', 'miss')
    res.end(imgBuffer)
  } catch (err) {
    console.error('Screenshot capture error:', err)
    res.status(500).json({ error: '截图失败', detail: err.message })
  }
})

export default router