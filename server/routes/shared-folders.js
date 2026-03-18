import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mime from 'mime-types'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', 'shared-folders.json')

// Load shared folders config
function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(data)
  } catch {
    return { folders: [] }
  }
}

// Resolve folder path (relative to server dir)
function resolveFolderPath(configPath) {
  const serverDir = path.join(__dirname, '..')
  return path.resolve(serverDir, configPath)
}

// GET /api/shared-folders — list all configured shared folders
router.get('/', (_req, res) => {
  try {
    const config = loadConfig()
    res.json(config.folders || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shared-folders/:folderId/files — list files in a shared folder
router.get('/:folderId/files', (req, res) => {
  try {
    const config = loadConfig()
    const folder = config.folders.find(f => f.id === req.params.folderId)
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const folderPath = resolveFolderPath(folder.path)
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: 'Folder path does not exist' })
    }

    const entries = fs.readdirSync(folderPath)
    const files = entries
      .filter(name => {
        const fullPath = path.join(folderPath, name)
        return fs.statSync(fullPath).isFile()
      })
      .map(name => {
        const fullPath = path.join(folderPath, name)
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

// GET /api/shared-folders/:folderId/raw/:name — serve raw file from shared folder
router.get('/:folderId/raw/:name', (req, res) => {
  try {
    const config = loadConfig()
    const folder = config.folders.find(f => f.id === req.params.folderId)
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const folderPath = resolveFolderPath(folder.path)
    const filePath = path.join(folderPath, path.basename(req.params.name))

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' })

    const mimeType = mime.lookup(filePath) || 'application/octet-stream'
    res.setHeader('Content-Type', mimeType)
    res.sendFile(filePath)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
