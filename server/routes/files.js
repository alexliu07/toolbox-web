import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mime from 'mime-types'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'storage')

// ensure storage dir exists
fs.mkdirSync(STORAGE_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
  filename: (_req, file, cb) => {
    // multer decodes originalname as latin1; re-encode to utf8 for CJK filenames
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const target = path.join(STORAGE_DIR, name)
    if (fs.existsSync(target)) {
      const ext = path.extname(name)
      const base = path.basename(name, ext)
      cb(null, `${base}_${Date.now()}${ext}`)
    } else {
      cb(null, name)
    }
  },
})

const upload = multer({ storage })

// GET /api/files — list all files
router.get('/', (_req, res) => {
  try {
    const entries = fs.readdirSync(STORAGE_DIR)
    const files = entries
      .filter(name => name !== '.gitkeep')
      .map(name => {
        const fullPath = path.join(STORAGE_DIR, name)
        const stat = fs.statSync(fullPath)
        return {
          name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          mime: mime.lookup(name) || 'application/octet-stream',
        }
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
    res.json(files)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/upload — upload one or more files
router.post('/upload', upload.array('file'), (req, res) => {
  const uploaded = req.files.map(f => ({
    name: f.filename,
    size: f.size,
    mime: f.mimetype,
  }))
  res.json({ uploaded })
})

// PUT /api/files/rename — rename a file
router.put('/rename', (req, res) => {
  const { oldName, newName } = req.body
  if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' })
  const oldPath = path.join(STORAGE_DIR, path.basename(oldName))
  const newPath = path.join(STORAGE_DIR, path.basename(newName))
  try {
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' })
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists' })
    fs.renameSync(oldPath, newPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/files/:name — delete a file
router.delete('/:name', (req, res) => {
  const filePath = path.join(STORAGE_DIR, path.basename(req.params.name))
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
    fs.unlinkSync(filePath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/files/raw/:name — serve raw file content (preview)
router.get('/raw/:name', (req, res) => {
  const filePath = path.join(STORAGE_DIR, path.basename(req.params.name))
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
  const mimeType = mime.lookup(filePath) || 'application/octet-stream'
  res.setHeader('Content-Type', mimeType)
  res.sendFile(filePath)
})

export default router
