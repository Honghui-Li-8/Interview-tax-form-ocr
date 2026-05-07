import { useState } from 'react'
import { login, setStoredUser, setToken, type AuthUser } from '../api/auth'

type LoginState = 'idle' | 'submitting' | 'error'

type Props = {
  onSuccess: (user: AuthUser) => void
}

export default function LoginPage({ onSuccess }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<LoginState>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('submitting')
    setMessage(null)

    try {
      const { token, user } = await login(username.trim(), password)
      setToken(token)
      setStoredUser(user)
      onSuccess(user)
    } catch {
      setState('error')
      setMessage('Invalid username or password.')
    }
  }

  const isSubmitting = state === 'submitting'

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '360px' }}>
      <h1>Tax Form OCR</h1>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>Username</label>
          <input
            type="text"
            placeholder="user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isSubmitting}
            style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>Password</label>
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
          />
        </div>

        {message && (
          <p style={{ color: 'red', marginBottom: '1rem' }}>{message}</p>
        )}

        <button type="submit" disabled={isSubmitting || !username.trim() || !password}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
