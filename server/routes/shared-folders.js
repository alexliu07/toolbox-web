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

// Security: prevent path traversal
function isPathSafe(basePath, requestedPath) {
  const resolved = path.resolve(basePath, requestedPath)
  return resolved.startsWith(basePath)
}

// GET /api/shared-folders/:folderId/files — list files and folders in a shared folder
router.get('/:folderId/files', (req, res) => {
  try {
    const config = loadConfig()
    const folder = config.folders.find(f => f.id === req.params.folderId)
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const basePath = resolveFolderPath(folder.path)
    if (!fs.existsSync(basePath)) {
      return res.status(404).json({ error: 'Folder path does not exist' })
    }

    // Get subpath from query parameter
    const subPath = req.query.path || ''
    const targetPath = path.join(basePath, subPath)

    // Security check: prevent path traversal
    if (!isPathSafe(basePath, subPath)) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Path does not exist' })
    }

    const entries = fs.readdirSync(targetPath)
    const items = entries
      .filter(name => {
        // Filter out system files
        const lowerName = name.toLowerCase()
        return lowerName !== 'desktop.ini' &&
               lowerName !== '.ds_store' &&
               lowerName !== 'thumbs.db'
      })
      .map(name => {
        const fullPath = path.join(targetPath, name)
        const stat = fs.statSync(fullPath)
        const isDirectory = stat.isDirectory()
        return {
          name,
          type: isDirectory ? 'folder' : 'file',
          size: isDirectory ? 0 : stat.size,
          mtime: stat.mtime.toISOString(),
          mime: isDirectory ? 'folder' : (mime.lookup(name) || 'application/octet-stream'),
        }
      })
      .sort((a, b) => {
        // Folders first, then by mtime
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return new Date(b.mtime) - new Date(a.mtime)
      })
    res.json(items)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shared-folders/:folderId/raw/* — serve raw file from shared folder (supports subpaths)
router.get('/:folderId/raw/*', (req, res) => {
  try {
    const config = loadConfig()
    const folder = config.folders.find(f => f.id === req.params.folderId)
    if (!folder) return res.status(404).json({ error: 'Folder not found' })

    const basePath = resolveFolderPath(folder.path)
    // Get the file path after /raw/
    const filePath = req.params[0] || ''
    const fullPath = path.join(basePath, filePath)

    // Security check: prevent path traversal
    if (!isPathSafe(basePath, filePath)) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' })

    const mimeType = mime.lookup(fullPath) || 'application/octet-stream'
    res.setHeader('Content-Type', mimeType)
    res.sendFile(fullPath)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
