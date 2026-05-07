import { useState } from 'react'
import { login, setStoredUser, setToken, type AuthUser } from '../api/auth'

type LoginState = 'idle' | 'submitting' | 'error'

type Props = {
  onSuccess: (user: AuthUser) => void
}

export default function LoginPage({ onSuccess }: Props) {
  const params = new URLSearchParams(window.location.search)
  const [username, setUsername] = useState(params.get('username') ?? '')
  const [password, setPassword] = useState(params.get('password') ?? '')
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
    <main className="auth-page">
      <section className="auth-panel">
        <div className="login-brand">
          <div className="brand-mark">1040</div>
          <h1>Tax Form OCR</h1>
        </div>
        <p className="page-subtitle">Sign in to upload a 1040 PDF and review the extracted tax fields.</p>

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {message && (
            <p className="alert alert-error">{message}</p>
          )}

          <button className="button button-primary button-wide" type="submit" disabled={isSubmitting || !username.trim() || !password}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
