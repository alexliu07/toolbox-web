import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

fs.mkdirSync(DATA_DIR, { recursive: true })

function keyFile(key) {
  // sanitize: only allow alphanumeric, dash, underscore
  const safe = path.basename(key).replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(DATA_DIR, safe + '.json')
}

// GET /api/data/:key — returns stored value or null
router.get('/:key', (req, res) => {
  const file = keyFile(req.params.key)
  if (!fs.existsSync(file)) return res.json(null)
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    res.json(null)
  }
})

// PUT /api/data/:key — store value (any JSON body)
router.put('/:key', (req, res) => {
  const file = keyFile(req.params.key)
  try {
    fs.writeFileSync(file, JSON.stringify(req.body), 'utf8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
