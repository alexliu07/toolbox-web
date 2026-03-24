import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserData, setUserData } from '../db.js'

const router = express.Router()

// GET /api/data/:key — returns stored value or null
router.get('/:key', requireAuth, (req, res) => {
  try {
    const value = getUserData(req.user.id, req.params.key)
    res.json(value)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/data/:key — store value (any JSON body)
router.put('/:key', requireAuth, (req, res) => {
  try {
    setUserData(req.user.id, req.params.key, req.body)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
