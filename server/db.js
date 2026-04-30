import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_DIR = path.join(__dirname, 'database')
const DB_PATH = path.join(DB_DIR, 'main.db')

fs.mkdirSync(DB_DIR, { recursive: true })

let db = null

/**
 * Initialize SQLite database (must be called before using db)
 */
export async function initDatabase() {
  const SQL = await initSqlJs()

  // Load existing database file or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Enable WAL mode for better concurrency
  db.run('PRAGMA journal_mode=WAL')

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      data_key TEXT NOT NULL,
      data_value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, data_key)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT 'application/octet-stream',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_desmos_saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_netease_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cookies TEXT NOT NULL,
      netease_uid INTEGER,
      nickname TEXT,
      avatar_url TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_bilibili_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cookies TEXT NOT NULL,
      bilibili_mid INTEGER,
      nickname TEXT,
      avatar_url TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_localstorage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ls_key TEXT NOT NULL,
      ls_value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, ls_key)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_wallpapers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  // Save to disk
  saveDatabase()

  console.log('[db] SQLite database initialized at', DB_PATH)
  return db
}

/**
 * Persist database to disk
 */
export function saveDatabase() {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(DB_PATH, buffer)
}

// ── User operations ──

export function createUser(username, passwordHash, displayName) {
  const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
  stmt.run([username, passwordHash, displayName])
  stmt.free()
  saveDatabase()
  const result = db.exec('SELECT last_insert_rowid() as id')
  return result[0].values[0][0]
}

export function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?')
  stmt.bind([username])
  let user = null
  if (stmt.step()) {
    user = stmt.getAsObject()
  }
  stmt.free()
  return user
}

export function getUserById(id) {
  const stmt = db.prepare('SELECT id, username, display_name, created_at, last_login FROM users WHERE id = ?')
  stmt.bind([id])
  let user = null
  if (stmt.step()) {
    user = stmt.getAsObject()
  }
  stmt.free()
  return user
}

export function updateLastLogin(userId) {
  db.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [userId])
  saveDatabase()
}

// ── Token operations ──

export function createToken(userId, token, expiresInHours = 168) {
  db.run(
    "INSERT INTO user_tokens (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' hours'))",
    [userId, token, expiresInHours]
  )
  saveDatabase()
}

export function getTokenRecord(token) {
  const stmt = db.prepare("SELECT * FROM user_tokens WHERE token = ? AND expires_at > datetime('now')")
  stmt.bind([token])
  let record = null
  if (stmt.step()) {
    record = stmt.getAsObject()
  }
  stmt.free()
  return record
}

export function deleteToken(token) {
  db.run('DELETE FROM user_tokens WHERE token = ?', [token])
  saveDatabase()
}

export function cleanExpiredTokens() {
  db.run("DELETE FROM user_tokens WHERE expires_at <= datetime('now')")
  saveDatabase()
}

// ── User data (key-value) operations ──

export function getUserData(userId, key) {
  const stmt = db.prepare('SELECT data_value FROM user_data WHERE user_id = ? AND data_key = ?')
  stmt.bind([userId, key])
  let value = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    value = row.data_value
  }
  stmt.free()
  return value ? JSON.parse(value) : null
}

export function setUserData(userId, key, value) {
  db.run(
    "INSERT OR REPLACE INTO user_data (user_id, data_key, data_value, updated_at) VALUES (?, ?, ?, datetime('now'))",
    [userId, key, JSON.stringify(value)]
  )
  saveDatabase()
}

// ── User files operations ──

export function addUserFile(userId, fileName, filePath, fileSize, mimeType) {
  db.run(
    'INSERT INTO user_files (user_id, file_name, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?)',
    [userId, fileName, filePath, fileSize, mimeType]
  )
  saveDatabase()
}

export function getUserFiles(userId) {
  const results = db.exec(
    'SELECT * FROM user_files WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  )
  if (!results.length) return []
  return results[0].values.map(row => ({
    id: row[0],
    user_id: row[1],
    file_name: row[2],
    file_path: row[3],
    file_size: row[4],
    mime_type: row[5],
    created_at: row[6],
  }))
}

export function getUserFile(userId, fileName) {
  const stmt = db.prepare('SELECT * FROM user_files WHERE user_id = ? AND file_name = ?')
  stmt.bind([userId, fileName])
  let file = null
  if (stmt.step()) {
    file = stmt.getAsObject()
  }
  stmt.free()
  return file
}

export function deleteUserFile(userId, fileName) {
  db.run('DELETE FROM user_files WHERE user_id = ? AND file_name = ?', [userId, fileName])
  saveDatabase()
}

export function renameUserFile(userId, oldName, newName, newPath) {
  db.run(
    "UPDATE user_files SET file_name = ?, file_path = ?, created_at = datetime('now') WHERE user_id = ? AND file_name = ?",
    [newName, newPath, userId, oldName]
  )
  saveDatabase()
}

// ── Desmos saves operations ──

export function getUserDesmosSaves(userId) {
  const results = db.exec(
    'SELECT name, updated_at FROM user_desmos_saves WHERE user_id = ? ORDER BY updated_at DESC',
    [userId]
  )
  if (!results.length) return []
  return results[0].values.map(row => ({
    name: row[0],
    mtime: row[1],
  }))
}

export function getUserDesmosSave(userId, name) {
  const stmt = db.prepare('SELECT state FROM user_desmos_saves WHERE user_id = ? AND name = ?')
  stmt.bind([userId, name])
  let state = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    state = JSON.parse(row.state)
  }
  stmt.free()
  return state
}

export function saveUserDesmos(userId, name, state) {
  db.run(
    "INSERT OR REPLACE INTO user_desmos_saves (user_id, name, state, updated_at) VALUES (?, ?, ?, datetime('now'))",
    [userId, name, JSON.stringify(state)]
  )
  saveDatabase()
}

export function deleteUserDesmos(userId, name) {
  db.run('DELETE FROM user_desmos_saves WHERE user_id = ? AND name = ?', [userId, name])
  saveDatabase()
}

// ── Drawings operations ──

export function getUserDrawings(userId) {
  const results = db.exec(
    'SELECT name, updated_at FROM user_drawings WHERE user_id = ? ORDER BY updated_at DESC',
    [userId]
  )
  if (!results.length) return []
  return results[0].values.map(row => ({
    name: row[0],
    mtime: row[1],
  }))
}

export function getUserDrawing(userId, name) {
  const stmt = db.prepare('SELECT data FROM user_drawings WHERE user_id = ? AND name = ?')
  stmt.bind([userId, name])
  let data = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    data = JSON.parse(row.data)
  }
  stmt.free()
  return data
}

export function saveUserDrawing(userId, name, data) {
  db.run(
    "INSERT OR REPLACE INTO user_drawings (user_id, name, data, updated_at) VALUES (?, ?, ?, datetime('now'))",
    [userId, name, JSON.stringify(data)]
  )
  saveDatabase()
}

export function deleteUserDrawing(userId, name) {
  db.run('DELETE FROM user_drawings WHERE user_id = ? AND name = ?', [userId, name])
  saveDatabase()
}

// ── Netease credentials operations ──

export function getNeteaseCredentials(userId) {
  const stmt = db.prepare('SELECT cookies, netease_uid, nickname, avatar_url FROM user_netease_credentials WHERE user_id = ?')
  stmt.bind([userId])
  let cred = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    cred = {
      cookies: JSON.parse(row.cookies),
      netease_uid: row.netease_uid,
      nickname: row.nickname,
      avatar_url: row.avatar_url,
    }
  }
  stmt.free()
  return cred
}

export function saveNeteaseCredentials(userId, { cookies, netease_uid, nickname, avatar_url }) {
  db.run(
    "INSERT OR REPLACE INTO user_netease_credentials (user_id, cookies, netease_uid, nickname, avatar_url, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    [userId, JSON.stringify(cookies), netease_uid || null, nickname || null, avatar_url || null]
  )
  saveDatabase()
}

export function deleteNeteaseCredentials(userId) {
  db.run('DELETE FROM user_netease_credentials WHERE user_id = ?', [userId])
  saveDatabase()
}

// ── Bilibili credentials operations ──

export function getBilibiliCredentials(userId) {
  const stmt = db.prepare('SELECT cookies, bilibili_mid, nickname, avatar_url FROM user_bilibili_credentials WHERE user_id = ?')
  stmt.bind([userId])
  let cred = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    cred = {
      cookies: JSON.parse(row.cookies),
      bilibili_mid: row.bilibili_mid,
      nickname: row.nickname,
      avatar_url: row.avatar_url,
    }
  }
  stmt.free()
  return cred
}

export function saveBilibiliCredentials(userId, { cookies, bilibili_mid, nickname, avatar_url }) {
  db.run(
    "INSERT OR REPLACE INTO user_bilibili_credentials (user_id, cookies, bilibili_mid, nickname, avatar_url, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    [userId, JSON.stringify(cookies), bilibili_mid || null, nickname || null, avatar_url || null]
  )
  saveDatabase()
}

export function deleteBilibiliCredentials(userId) {
  db.run('DELETE FROM user_bilibili_credentials WHERE user_id = ?', [userId])
  saveDatabase()
}

// ── User localStorage operations ──

export function getUserLocalStorage(userId) {
  const stmt = db.prepare('SELECT ls_key, ls_value FROM user_localstorage WHERE user_id = ?')
  stmt.bind([userId])
  const storage = {}
  while (stmt.step()) {
    const row = stmt.getAsObject()
    storage[row.ls_key] = row.ls_value
  }
  stmt.free()
  return storage
}

export function setUserLocalStorageItem(userId, key, value) {
  db.run(
    "INSERT OR REPLACE INTO user_localstorage (user_id, ls_key, ls_value, updated_at) VALUES (?, ?, ?, datetime('now'))",
    [userId, key, value]
  )
  saveDatabase()
}

export function removeUserLocalStorageItem(userId, key) {
  db.run('DELETE FROM user_localstorage WHERE user_id = ? AND ls_key = ?', [userId, key])
  saveDatabase()
}

export function clearUserLocalStorage(userId) {
  db.run('DELETE FROM user_localstorage WHERE user_id = ?', [userId])
  saveDatabase()
}

// ── Wallpapers operations ──

export function addUserWallpaper(userId, fileName, filePath, fileSize) {
  db.run(
    'INSERT INTO user_wallpapers (user_id, file_name, file_path, file_size) VALUES (?, ?, ?, ?)',
    [userId, fileName, filePath, fileSize]
  )
  saveDatabase()
  const result = db.exec('SELECT last_insert_rowid() as id')
  return result[0].values[0][0]
}

export function getUserWallpapers(userId) {
  const results = db.exec(
    'SELECT id, file_name, file_size, created_at FROM user_wallpapers WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  )
  if (!results.length) return []
  return results[0].values.map(row => ({
    id: row[0],
    file_name: row[1],
    file_size: row[2],
    created_at: row[3],
  }))
}

export function getUserWallpaper(userId, id) {
  const stmt = db.prepare('SELECT * FROM user_wallpapers WHERE user_id = ? AND id = ?')
  stmt.bind([userId, id])
  let wallpaper = null
  if (stmt.step()) {
    wallpaper = stmt.getAsObject()
  }
  stmt.free()
  return wallpaper
}

export function deleteUserWallpaper(userId, id) {
  db.run('DELETE FROM user_wallpapers WHERE user_id = ? AND id = ?', [userId, id])
  saveDatabase()
}

// Auto-save database periodically (every 30 seconds)
const autoSaveTimer = setInterval(() => {
  if (db && !shuttingDown) saveDatabase()
}, 30000)

// Save on process exit
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  // Clear the auto-save interval to prevent re-entrant saves
  clearInterval(autoSaveTimer)
  // db.export() / db.close() use Emscripten sync file I/O which may fail
  // during Node teardown (especially under concurrently).  The 30s auto-save
  // already keeps data current, so just exit cleanly.
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
