import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { initDatabase } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 8081

app.use(cors())
app.use(express.json())

// Dynamic route loading: scan routes/ directory
const routesDir = path.join(__dirname, 'routes')
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'))

for (const file of routeFiles) {
  const name = path.basename(file, '.js')
  const mod = await import(pathToFileURL(path.join(routesDir, file)).href)
  app.use(`/api/${name}`, mod.default)
  console.log(`[server] route loaded: /api/${name} ← ${file}`)
}

// Initialize database then start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] Express running on http://localhost:${PORT}`)
  })
}).catch(err => {
  console.error('[server] Failed to initialize database:', err)
  process.exit(1)
})
