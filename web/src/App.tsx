import { useState } from 'react'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

type HealthStatus = 'idle' | 'loading' | 'ok' | 'error'

function App() {
  const [status, setStatus] = useState<HealthStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function checkHealth() {
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(`${SERVER_URL}/health`)
      const data = await res.json()
      setStatus('ok')
      setMessage(JSON.stringify(data))
    } catch {
      setStatus('error')
      setMessage(`Could not reach server at ${SERVER_URL}`)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Tax Form OCR</h1>
      <button onClick={checkHealth} disabled={status === 'loading'}>
        {status === 'loading' ? 'Checking...' : 'Check server health'}
      </button>
      {message && (
        <p style={{ marginTop: '1rem', color: status === 'error' ? 'red' : 'green' }}>
          {message}
        </p>
      )}
    </div>
  )
}

export default App
