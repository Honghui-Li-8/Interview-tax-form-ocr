import { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'

export type AuthUser = {
  username: string
}

export type AuthenticatedRequest = Express.Request & {
  user: AuthUser
}

type TokenPayload = {
  sub: string
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is required')
  }
  return secret
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as TokenPayload
    if (!payload.sub) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    Object.assign(req, { user: { username: payload.sub } })
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
