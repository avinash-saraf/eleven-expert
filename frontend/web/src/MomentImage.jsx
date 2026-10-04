import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { apiBase } from './api.js'

// Images need the bearer token, so fetch the frame and show it as a local blob.
export default function MomentImage({ workflowId, moment }) {
  const token = useSelector((state) => state.auth.accessToken)
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url
    let active = true
    setSrc(null)
    setFailed(false)
    fetch(`${apiBase}/workflows/${workflowId}/moments/${moment.id}/image`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error()
        return response.blob()
      })
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [workflowId, moment.id, token])
  if (failed)
    return (
      <p className="rounded-xl border border-line p-3 text-xs text-zinc-500">
        This screen moment is no longer available.
      </p>
    )
  if (!src)
    return <div className="aspect-video animate-pulse rounded-xl bg-zinc-100" />
  return (
    <img
      src={src}
      alt={moment.caption}
      className="w-full rounded-xl border border-line"
    />
  )
}
