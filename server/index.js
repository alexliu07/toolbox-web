import express from 'express'
import cors from 'cors'
import filesRouter from './routes/files.js'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

app.use('/api/files', filesRouter)

app.listen(PORT, () => {
  console.log(`[server] Express running on http://localhost:${PORT}`)
})
