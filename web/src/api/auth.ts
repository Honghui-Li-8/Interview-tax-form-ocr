const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const TOKEN_KEY = 'authToken'
const USER_KEY = 'authUser'

export type AuthUser = {
  username: string
}

type LoginResponse = {
  token: string
  user: AuthUser
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (res.status === 401) {
    throw new UnauthorizedError('Invalid username or password')
  }

  if (!res.ok) {
    throw new Error('Login failed')
  }

  return res.json()
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getStoredUser(): AuthUser | null {
  const value = localStorage.getItem(USER_KEY)
  if (!value) return null

  try {
    return JSON.parse(value) as AuthUser
  } catch {
    return null
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof UnauthorizedError
}
