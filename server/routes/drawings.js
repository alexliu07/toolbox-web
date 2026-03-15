import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAVES_DIR = path.join(__dirname, '..', 'drawings')

fs.mkdirSync(SAVES_DIR, { recursive: true })

function safeName(name) {
  return path.basename(name.replace(/[^\w\u4e00-\u9fa5 \-]/g, '_').trim())
}

// GET /api/drawings — list saves
router.get('/', (_req, res) => {
  const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'))
  const list = files.map(f => {
    const stat = fs.statSync(path.join(SAVES_DIR, f))
    return { name: f.slice(0, -5), mtime: stat.mtime.toISOString() }
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
  res.json(list)
})

// POST /api/drawings — save { name, strokes, viewport }
router.post('/', (req, res) => {
  const { name, strokes, viewport } = req.body
  if (!name || !Array.isArray(strokes)) return res.status(400).json({ error: 'name and strokes required' })
  const file = path.join(SAVES_DIR, safeName(name) + '.json')
  fs.writeFileSync(file, JSON.stringify({ strokes, viewport: viewport || { x: 0, y: 0 } }), 'utf8')
  res.json({ ok: true })
})

// GET /api/drawings/:name — load drawing
router.get('/:name', (req, res) => {
  const file = path.join(SAVES_DIR, safeName(req.params.name) + '.json')
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
})

// DELETE /api/drawings/:name — delete save
router.delete('/:name', (req, res) => {
  const file = path.join(SAVES_DIR, safeName(req.params.name) + '.json')
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  fs.unlinkSync(file)
  res.json({ ok: true })
})

export default router
