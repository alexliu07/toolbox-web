import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  getUserDesmosSaves,
  getUserDesmosSave,
  saveUserDesmos,
  deleteUserDesmos,
} from '../db.js'

const router = express.Router()

// GET /api/desmos — list saves
router.get('/', requireAuth, (_req, res) => {
  try {
    const list = getUserDesmosSaves(_req.user.id)
    res.json(list)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/desmos — save { name, state }
router.post('/', requireAuth, (req, res) => {
  const { name, state } = req.body
  if (!name || !state) return res.status(400).json({ error: 'name and state required' })
  try {
    saveUserDesmos(req.user.id, name, state)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/desmos/:name — load state
router.get('/:name', requireAuth, (req, res) => {
  try {
    const state = getUserDesmosSave(req.user.id, req.params.name)
    if (state === null) return res.status(404).json({ error: 'Not found' })
    res.json(state)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/desmos/:name — delete save
router.delete('/:name', requireAuth, (req, res) => {
  try {
    deleteUserDesmos(req.user.id, req.params.name)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
