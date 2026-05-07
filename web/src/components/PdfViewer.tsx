import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const BASE_SCALE = 1.5
const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

type Props = {
  url: string
  onOpenInTab: () => void
}

export default function PdfViewer({ url, onOpenInTab }: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const naturalHeight = useRef(0)
  const [zoom, setZoom] = useState(0.5)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  function clampY(y: number): number {
    const viewportH = viewportRef.current?.clientHeight ?? 0
    const minY = Math.min(0, viewportH - naturalHeight.current * zoom)
    return Math.max(minY, Math.min(0, y))
  }

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    let cancelled = false
    el.innerHTML = ''

    ;(async () => {
      const pdf = await pdfjsLib.getDocument(url).promise
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) break
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: BASE_SCALE })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        canvas.style.cssText = 'display:block;margin-bottom:8px'
        el.appendChild(canvas)
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      }
      naturalHeight.current = el.scrollHeight
    })()

    return () => {
      cancelled = true
      el.innerHTML = ''
    }
  }, [url])

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current) return
    setOffset({
      x: drag.current.ox + e.clientX - drag.current.x,
      y: clampY(drag.current.oy + e.clientY - drag.current.y),
    })
  }

  function onMouseUp() {
    drag.current = null
    setDragging(false)
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    setOffset(o => ({ x: o.x, y: clampY(o.y - e.deltaY) }))
  }

  return (
    <>
    <div className="pdf-thumbnail">
      <div className="pdf-viewer-toolbar">
        <button
          className="pdf-zoom-btn"
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
        >−</button>
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="pdf-zoom-btn"
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
        >+</button>
        <button
          className="pdf-zoom-btn pdf-reset-btn"
          onClick={() => { setZoom(0.5); setOffset({ x: 0, y: 0 }) }}
          title="Reset view"
        >↺</button>
      </div>

      <div
        ref={viewportRef}
        className="pdf-viewer-viewport"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: 'top center',
          }}
        />
      </div>

      <button className="pdf-thumbnail-hint" onClick={onOpenInTab}>
        Open PDF ↗
      </button>
    </div>
    <p className="pdf-auth-heading">Opened PDF:</p>
    <ul className="pdf-auth-note">
      <li>Served through an auth-gated endpoint — owner access only.</li>
      <li>Link is valid for this browser session only.</li>
    </ul>
    </>
  )
}
