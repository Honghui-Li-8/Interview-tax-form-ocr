import { useState, useCallback } from 'react'
import { clearToken, getStoredUser, getToken, type AuthUser } from './api/auth'
import LoginPage from './pages/LoginPage'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'
import SavedRecordsPage from './pages/SavedRecordsPage'
import './App.css'

type Page = 'upload' | 'review' | 'saved'

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()))
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())
  const [page, setPage] = useState<Page>('upload')
  const [documentId, setDocumentId] = useState<number | null>(null)

  function goToReview(id: number) {
    setDocumentId(id)
    setPage('review')
  }

  const goToUpload = useCallback(() => {
    setDocumentId(null)
    setPage('upload')
  }, [])

  const goToSaved = useCallback(() => {
    setDocumentId(null)
    setPage('saved')
  }, [])

  const handleLogout = useCallback(() => {
    clearToken()
    setAuthed(false)
    setUser(null)
    setDocumentId(null)
    setPage('upload')
  }, [])

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
        <span>Signed in as: <span className="username-badge">{user?.username ?? 'unknown user'}</span></span>
        <button className="button button-secondary" onClick={goToSaved}>Saved records</button>
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

  if (page === 'saved') {
    return (
      <main className="app-shell">
        {authHeader}
        <SavedRecordsPage onBack={goToUpload} onReview={goToReview} onUnauthorized={handleLogout} />
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
