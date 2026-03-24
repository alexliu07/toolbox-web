import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mime from 'mime-types'
import { requireAuth } from '../middleware/auth.js'
import {
  addUserFile,
  getUserFiles,
  getUserFile,
  deleteUserFile,
  renameUserFile,
} from '../db.js'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'storage')

// ensure base storage dir exists
fs.mkdirSync(STORAGE_DIR, { recursive: true })

// Get (and create if needed) per-user directory
function getUserDir(username) {
  const dir = path.join(STORAGE_DIR, username)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// multer with dynamic per-user destination
const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, getUserDir(req.user.username)),
  filename: (req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const userDir = getUserDir(req.user.username)
    const target = path.join(userDir, name)
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

// GET /api/files — list user's files from DB
router.get('/', requireAuth, (req, res) => {
  try {
    const rows = getUserFiles(req.user.id)
    const files = rows.map(r => ({
      name: r.file_name,
      size: r.file_size,
      mtime: r.created_at,
      mime: r.mime_type,
    }))
    res.json(files)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/files/upload — upload files to user's directory
router.post('/upload', requireAuth, upload.array('file'), (req, res) => {
  try {
    const uploaded = req.files.map(f => {
      const relPath = path.join(req.user.username, f.filename)
      addUserFile(req.user.id, f.filename, relPath, f.size, f.mimetype)
      return { name: f.filename, size: f.size, mime: f.mimetype }
    })
    res.json({ uploaded })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/files/rename — rename a user's file
router.put('/rename', requireAuth, (req, res) => {
  const { oldName, newName } = req.body
  if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' })
  try {
    const fileRecord = getUserFile(req.user.id, oldName)
    if (!fileRecord) return res.status(404).json({ error: 'File not found' })

    const userDir = getUserDir(req.user.username)
    const oldPath = path.join(userDir, path.basename(oldName))
    const newPath = path.join(userDir, path.basename(newName))

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found on disk' })
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists' })

    fs.renameSync(oldPath, newPath)
    const newRelPath = path.join(req.user.username, path.basename(newName))
    renameUserFile(req.user.id, oldName, path.basename(newName), newRelPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/files/:name — delete a user's file
router.delete('/:name', requireAuth, (req, res) => {
  try {
    const fileRecord = getUserFile(req.user.id, req.params.name)
    if (!fileRecord) return res.status(404).json({ error: 'File not found' })

    const filePath = path.join(STORAGE_DIR, fileRecord.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    deleteUserFile(req.user.id, req.params.name)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/files/raw/:name — serve raw file content (preview)
router.get('/raw/:name', requireAuth, (req, res) => {
  try {
    const fileRecord = getUserFile(req.user.id, req.params.name)
    if (!fileRecord) return res.status(404).json({ error: 'File not found' })

    const filePath = path.join(STORAGE_DIR, fileRecord.file_path)
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' })

    const mimeType = mime.lookup(filePath) || 'application/octet-stream'
    res.setHeader('Content-Type', mimeType)
    res.sendFile(filePath)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
