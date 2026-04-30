import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { requireAuth } from '../middleware/auth.js'
import {
  addUserWallpaper, getUserWallpapers, getUserWallpaper, deleteUserWallpaper,
  getUserData, setUserData,
} from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WALLPAPER_DIR = path.join(__dirname, '..', 'wallpapers')
fs.mkdirSync(WALLPAPER_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, WALLPAPER_DIR),
  filename: (req, file, cb) => {
    const extname = path.extname(file.originalname)
    cb(null, `${req.user.id}_${Date.now()}${extname}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('只能上传图片文件'))
    }
  },
})

const router = express.Router()

// 列出当前用户所有壁纸
router.get('/', requireAuth, (req, res) => {
  const wallpapers = getUserWallpapers(req.user.id)
  res.json(wallpapers)
})

// 上传壁纸
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未选择文件' })
  }
  const id = addUserWallpaper(
    req.user.id,
    req.file.filename,
    req.file.path,
    req.file.size
  )
  res.json({ id, file_name: req.file.filename, file_size: req.file.size })
})

// 删除壁纸
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const wallpaper = getUserWallpaper(req.user.id, id)
  if (!wallpaper) {
    return res.status(404).json({ error: '壁纸不存在' })
  }
  // 删除磁盘文件
  try { fs.unlinkSync(wallpaper.file_path) } catch {}
  deleteUserWallpaper(req.user.id, id)
  // 如果删除的是当前壁纸，清除选择
  const current = getUserData(req.user.id, 'wallpaper_current')
  if (current && current.id === id) {
    setUserData(req.user.id, 'wallpaper_current', null)
  }
  res.json({ success: true })
})

// 获取当前壁纸
router.get('/current', requireAuth, (req, res) => {
  const current = getUserData(req.user.id, 'wallpaper_current')
  if (!current) {
    return res.json({ current: null })
  }
  // 验证壁纸是否还存在
  const wallpaper = getUserWallpaper(req.user.id, current.id)
  if (!wallpaper) {
    setUserData(req.user.id, 'wallpaper_current', null)
    return res.json({ current: null })
  }
  res.json({ current })
})

// 设置当前壁纸
router.put('/current/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const wallpaper = getUserWallpaper(req.user.id, id)
  if (!wallpaper) {
    return res.status(404).json({ error: '壁纸不存在' })
  }
  setUserData(req.user.id, 'wallpaper_current', { id, file_name: wallpaper.file_name })
  res.json({ success: true })
})

// 清除壁纸（恢复默认）
router.put('/clear', requireAuth, (req, res) => {
  setUserData(req.user.id, 'wallpaper_current', null)
  res.json({ success: true })
})

// 获取壁纸图片
router.get('/image/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const wallpaper = getUserWallpaper(req.user.id, id)
  if (!wallpaper) {
    return res.status(404).json({ error: '壁纸不存在' })
  }
  res.sendFile(wallpaper.file_path)
})

export default router
