import { useState } from 'react'
import { clearToken, getStoredUser, getToken, type AuthUser } from './api/auth'
import LoginPage from './pages/LoginPage'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'
import './App.css'

type Page = 'upload' | 'review'

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()))
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())
  const [page, setPage] = useState<Page>('upload')
  const [documentId, setDocumentId] = useState<number | null>(null)

  function goToReview(id: number) {
    setDocumentId(id)
    setPage('review')
  }

  function goToUpload() {
    setDocumentId(null)
    setPage('upload')
  }

  function handleLogout() {
    clearToken()
    setAuthed(false)
    setUser(null)
    setDocumentId(null)
    setPage('upload')
  }

  if (!authed) {
    return <LoginPage onSuccess={(nextUser) => {
      setUser(nextUser)
      setAuthed(true)
    }} />
  }

  const authHeader = (
    <header className="app-header">
      <div>
        <p className="eyebrow">Tax Form OCR</p>
        <strong>Document review workspace</strong>
      </div>
      <div className="user-actions">
        <span>Signed in as {user?.username ?? 'unknown user'}</span>
        <button className="button button-secondary" onClick={handleLogout}>Logout</button>
      </div>
    </header>
  )

  if (page === 'review' && documentId !== null) {
    return (
      <main className="app-shell">
        {authHeader}
        <ReviewPage documentId={documentId} onBack={goToUpload} onUnauthorized={handleLogout} />
      </main>
    )
  }

  return (
    <main className="app-shell">
      {authHeader}
      <UploadPage onReview={goToReview} onUnauthorized={handleLogout} />
    </main>
  )
}
