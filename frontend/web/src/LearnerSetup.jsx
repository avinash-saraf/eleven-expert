import { useRef, useState } from 'react'
import { useWorkflowQuery, useCreateSessionMutation } from './api.js'
import {
  ErrorNotice,
  Loading,
  fieldClass,
  buttonClass,
  knowledgeOf,
  MEET,
} from './ui.jsx'

export default function LearnerSetup({ workflowId, onCreated, go }) {
  const workflow = useWorkflowQuery(workflowId)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [consent, setConsent] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [createSession, { isLoading, error }] = useCreateSessionMutation()
  const request = useRef(null)
  const submitting = useRef(false)
  const valid =
    workflow.data?.status === 'READY' && MEET.test(meetingUrl.trim()) && consent
  async function submit(e) {
    e.preventDefault()
    if (!valid || submitting.current || blocked) return
    submitting.current = true
    const url = meetingUrl.trim()
    if (request.current?.url !== url)
      request.current = { url, key: crypto.randomUUID() }
    try {
      onCreated(
        await createSession({
          workflowId,
          meetingUrl: url,
          requestKey: request.current.key,
        }).unwrap(),
      )
    } catch (failure) {
      setBlocked(true)
      if (failure.data?.sessionId)
        go({ name: 'live', workflowId, sessionId: failure.data.sessionId })
    } finally {
      submitting.current = false
    }
  }
  if (workflow.isLoading)
    return <Loading>Loading your expert’s workflow…</Loading>
  if (workflow.error)
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <ErrorNotice error={workflow.error} retry={workflow.refetch} />
        <button onClick={() => go({ name: 'home' })}>← Back</button>
      </div>
    )
  const w = workflow.data
  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-5 p-6">
      <button
        type="button"
        onClick={() => go({ name: 'home' })}
        className="text-sm text-zinc-500"
      >
        ← Back
      </button>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          You’re learning
        </div>
        <h1 className="mt-1 text-xl font-semibold">{w.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          By {w.createdBy?.name || 'your expert'} · {knowledgeOf(w).length}{' '}
          saved knowledge items
        </p>
        <p className="mt-3 text-sm text-zinc-600">
          Ari loads the expert’s full saved workflow. Share your screen and ask
          it for guidance, explanations, or help in your language.
        </p>
      </div>
      <ol className="space-y-2 text-sm text-zinc-600">
        {[
          'Start Google Meet and paste the link below',
          'Admit Ari when it requests to join',
          'Share your screen and speak to Ari',
        ].map((text, i) => (
          <li key={text} className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs">
              {i + 1}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <label className="block space-y-1.5 text-sm">
        <span>Google Meet link</span>
        <input
          required
          type="url"
          disabled={isLoading || blocked}
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
          className={fieldClass}
        />
        {meetingUrl && !MEET.test(meetingUrl.trim()) && (
          <span className="text-xs text-red-700">
            Enter a complete Google Meet meeting URL.
          </span>
        )}
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-panel p-3 text-sm text-zinc-600">
        <input
          type="checkbox"
          disabled={isLoading}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 accent-zinc-900"
        />
        <span>
          Everyone on the call knows Ari observes audio and the shared screen to
          coach me.
        </span>
      </label>
      <ErrorNotice error={error} />
      {blocked && (
        <p className="text-sm text-zinc-600">
          Check your sessions on the dashboard before starting another bot.
        </p>
      )}
      <button
        disabled={!valid || isLoading || blocked}
        className={`${buttonClass} w-full`}
      >
        {isLoading ? 'Getting Ari ready…' : 'Start Employee Teach session'}
      </button>
    </form>
  )
}
