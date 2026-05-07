import { useState } from 'react'
import UploadPage from './pages/UploadPage'
import ReviewPage from './pages/ReviewPage'

type Page = 'upload' | 'review'

export default function App() {
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

  if (page === 'review' && documentId !== null) {
    return <ReviewPage documentId={documentId} onBack={goToUpload} />
  }

  return <UploadPage onReview={goToReview} />
}
