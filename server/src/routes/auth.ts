import { Router } from 'express'
import jwt from 'jsonwebtoken'

const router = Router()

type LoginRequest = {
  username?: string
  password?: string
}

function parseAuthUsers(): Map<string, string> {
  // Minimal exercise auth: preset env users avoid building account management.
  // Real production authentication will be some proper auth solution
  return new Map(
    (process.env.AUTH_USERS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [username, password] = entry.split(':')
        return [username, password] as [string, string]
      })
      .filter(([username, password]) => Boolean(username && password))
  )
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is required')
  }
  return secret
}

router.post('/login', (req, res) => {
  const { username, password } = req.body as LoginRequest

  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' })
    return
  }

  const expectedPassword = parseAuthUsers().get(username)
  if (expectedPassword !== password) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const token = jwt.sign({ sub: username }, getJwtSecret(), { expiresIn: '24h' })
  res.json({ token, user: { username } })
})

export default router
