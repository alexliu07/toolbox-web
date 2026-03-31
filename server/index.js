import express from 'express'
import cors from 'cors'
import { initDatabase } from './db.js'
import filesRouter from './routes/files.js'
import dataRouter from './routes/data.js'
import desmosRouter from './routes/desmos.js'
import drawingsRouter from './routes/drawings.js'
import sharedFoldersRouter from './routes/shared-folders.js'
import youdaoRouter from './routes/youdao.js'
import yunchengjiRouter from './routes/yunchengji.js'
import authRouter from './routes/auth.js'

const app = express()
const PORT = 8081

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/files', filesRouter)
app.use('/api/data', dataRouter)
app.use('/api/desmos', desmosRouter)
app.use('/api/drawings', drawingsRouter)
app.use('/api/shared-folders', sharedFoldersRouter)
app.use('/api/youdao', youdaoRouter)
app.use('/api/yunchengji', yunchengjiRouter)

// Initialize database then start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] Express running on http://localhost:${PORT}`)
  })
}).catch(err => {
  console.error('[server] Failed to initialize database:', err)
  process.exit(1)
})
