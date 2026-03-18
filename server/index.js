import express from 'express'
import cors from 'cors'
import filesRouter from './routes/files.js'
import dataRouter from './routes/data.js'
import desmosRouter from './routes/desmos.js'
import drawingsRouter from './routes/drawings.js'
import sharedFoldersRouter from './routes/shared-folders.js'

const app = express()
const PORT = 8081

app.use(cors())
app.use(express.json())

app.use('/api/files', filesRouter)
app.use('/api/data', dataRouter)
app.use('/api/desmos', desmosRouter)
app.use('/api/drawings', drawingsRouter)
app.use('/api/shared-folders', sharedFoldersRouter)

app.listen(PORT, () => {
  console.log(`[server] Express running on http://localhost:${PORT}`)
})
