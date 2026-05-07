import { useState } from 'react'
import { clearToken, getStoredUser, getToken, type AuthUser } from './api/auth'
import LoginPage from './pages/LoginPage'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'

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
    <div style={{ margin: '1rem 0 0 2rem', fontFamily: 'sans-serif' }}>
      <span style={{ marginRight: '1rem' }}>Signed in as {user?.username ?? 'unknown user'}</span>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )

  if (page === 'review' && documentId !== null) {
    return (
      <div>
        {authHeader}
        <ReviewPage documentId={documentId} onBack={goToUpload} onUnauthorized={handleLogout} />
      </div>
    )
  }

  return (
    <div>
      {authHeader}
      <UploadPage onReview={goToReview} onUnauthorized={handleLogout} />
    </div>
  )
}
