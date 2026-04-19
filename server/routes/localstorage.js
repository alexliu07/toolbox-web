import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  getUserLocalStorage,
  setUserLocalStorageItem,
  removeUserLocalStorageItem,
  clearUserLocalStorage
} from '../db.js'

const router = express.Router()

// GET /api/localstorage — 获取用户所有localStorage数据
router.get('/', requireAuth, (req, res) => {
  try {
    const storage = getUserLocalStorage(req.user.id)
    res.json(storage)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/localstorage/:key — 获取单个item
router.get('/:key', requireAuth, (req, res) => {
  try {
    const storage = getUserLocalStorage(req.user.id)
    const value = storage[req.params.key] ?? null
    res.json({ key: req.params.key, value })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/localstorage/:key — 设置单个item
router.put('/:key', requireAuth, (req, res) => {
  try {
    setUserLocalStorageItem(req.user.id, req.params.key, req.body.value)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/localstorage/:key — 删除单个item
router.delete('/:key', requireAuth, (req, res) => {
  try {
    removeUserLocalStorageItem(req.user.id, req.params.key)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/localstorage — 清空用户所有localStorage
router.delete('/', requireAuth, (req, res) => {
  try {
    clearUserLocalStorage(req.user.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
