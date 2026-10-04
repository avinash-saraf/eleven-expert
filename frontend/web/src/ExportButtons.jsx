import { useState } from 'react'
import { useSelector } from 'react-redux'
import { apiBase } from './api.js'
import { secondaryClass } from './ui.jsx'

// Exports the Work Map as instructions an agent can load: same steps, same stop points.
export default function ExportButtons({ workflowId }) {
  const token = useSelector((state) => state.auth.accessToken)
  const [note, setNote] = useState('')
  async function load() {
    const response = await fetch(`${apiBase}/workflows/${workflowId}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error('Export failed')
    return response.text()
  }
  async function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([await load()], { type: 'text/markdown' }),
      )
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: 'agent-instructions.md',
      })
      link.click()
      URL.revokeObjectURL(url)
      setNote('')
    } catch {
      setNote('Export failed')
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(await load())
      setNote('Copied')
    } catch {
      setNote('Copy failed')
    }
  }
  return (
    <>
      <button className={secondaryClass} onClick={download}>
        Export for agents
      </button>
      <button className={secondaryClass} onClick={copy}>
        Copy
      </button>
      {note && <span className="text-xs text-zinc-500">{note}</span>}
    </>
  )
}
