import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  getUserDrawings,
  getUserDrawing,
  saveUserDrawing,
  deleteUserDrawing,
} from '../db.js'

const router = express.Router()

// GET /api/drawings — list saves
router.get('/', requireAuth, (req, res) => {
  try {
    const list = getUserDrawings(req.user.id)
    res.json(list)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/drawings — save { name, strokes, viewport }
router.post('/', requireAuth, (req, res) => {
  const { name, strokes, viewport } = req.body
  if (!name || !Array.isArray(strokes)) return res.status(400).json({ error: 'name and strokes required' })
  try {
    saveUserDrawing(req.user.id, name, { strokes, viewport: viewport || { x: 0, y: 0 } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/drawings/:name — load drawing
router.get('/:name', requireAuth, (req, res) => {
  try {
    const data = getUserDrawing(req.user.id, req.params.name)
    if (data === null) return res.status(404).json({ error: 'Not found' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/drawings/:name — delete save
router.delete('/:name', requireAuth, (req, res) => {
  try {
    deleteUserDrawing(req.user.id, req.params.name)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
