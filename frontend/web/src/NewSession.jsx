import { useRef, useState } from 'react'
import {
  useCreateWorkflowMutation,
  useCreateSessionMutation,
  useWorkflowQuery,
} from './api.js'
import {
  ErrorNotice,
  Loading,
  fieldClass,
  buttonClass,
  secondaryClass,
  MEET,
} from './ui.jsx'
import { linkProcess, processById } from './knowledge.js'

export default function NewSession({ workflowId, processId, onCreated, go }) {
  const existing = useWorkflowQuery(workflowId, { skip: !workflowId })
  const [title, setTitle] = useState(() => processById(processId)?.name || '')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [consent, setConsent] = useState(false)
  const [createdWorkflow, setCreatedWorkflow] = useState(null)
  const [creationFailed, setCreationFailed] = useState(false)
  const [createWorkflow, workflowRequest] = useCreateWorkflowMutation()
  const [createSession, sessionRequest] = useCreateSessionMutation()
  const request = useRef(null)
  const submitting = useRef(false)
  const selected = workflowId || createdWorkflow?.id
  const busy = workflowRequest.isLoading || sessionRequest.isLoading
  const valid =
    (selected || title.trim()) && MEET.test(meetingUrl.trim()) && consent
  async function submit(e) {
    e.preventDefault()
    if (!valid || submitting.current || creationFailed) return
    submitting.current = true
    try {
      const workflow = selected
        ? { id: selected }
        : await createWorkflow({ title: title.trim() }).unwrap()
      setCreatedWorkflow(workflow)
      if (processId) linkProcess(workflow.id, processId)
      const fingerprint = `${workflow.id}:${meetingUrl.trim()}`
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() }
      try {
        const session = await createSession({
          workflowId: workflow.id,
          meetingUrl: meetingUrl.trim(),
          requestKey: request.current.key,
        }).unwrap()
        onCreated(session)
      } catch (error) {
        // Creation failures can leave a real Recall bot: do not silently create another.
        setCreationFailed(true)
        if (error.data?.sessionId)
          go({
            name: 'live',
            workflowId: workflow.id,
            sessionId: error.data.sessionId,
          })
      }
    } catch {
      /* API errors are displayed below. */
    } finally {
      submitting.current = false
    }
  }
  if (workflowId && existing.isLoading)
    return <Loading>Loading workflow…</Loading>
  if (existing.error)
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorNotice error={existing.error} retry={existing.refetch} />
      </div>
    )
  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-5 p-6">
      <button
        type="button"
        className="text-sm text-zinc-500"
        onClick={() => go({ name: 'home' })}
      >
        ← Back to dashboard
      </button>
      <div>
        <h1 className="text-2xl font-semibold">
          {workflowId ? 'Continue teaching Ari' : 'New workflow'}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Start a Google Meet, paste its link, and admit Ari when it asks to
          join.
        </p>
      </div>
      {selected ? (
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="text-xs text-zinc-500">Selected workflow</div>
          <p className="mt-1 font-medium">{existing.data?.title || title}</p>
        </div>
      ) : (
        <label className="block space-y-1.5 text-sm">
          <span>Workflow name</span>
          <input
            required
            maxLength={120}
            disabled={busy}
            className={fieldClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Customer refund process"
          />
        </label>
      )}
      <label className="block space-y-1.5 text-sm">
        <span>Google Meet link</span>
        <input
          required
          type="url"
          disabled={busy || creationFailed}
          className={fieldClass}
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
        />
        {meetingUrl && !MEET.test(meetingUrl.trim()) && (
          <span className="text-xs text-red-700">
            Enter a complete Google Meet meeting URL.
          </span>
        )}
      </label>
      <div className="rounded-xl border border-line bg-panel p-4 text-sm">
        <div className="font-medium">Ari learns from you</div>
        <p className="mt-1 text-zinc-500">
          Share your screen, explain what you do and why, and answer Ari’s
          questions inside Meet. Saved knowledge becomes available to employees
          after learning finishes.
        </p>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-panel p-3 text-sm text-zinc-600">
        <input
          type="checkbox"
          disabled={busy}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 accent-zinc-900"
        />
        <span>
          Everyone on the call knows Ari observes audio and the shared screen to
          learn this workflow.
        </span>
      </label>
      <ErrorNotice error={workflowRequest.error || sessionRequest.error} />
      {creationFailed && (
        <p className="text-sm text-zinc-600">
          Check your sessions on the dashboard before starting another bot.
        </p>
      )}
      <button
        disabled={!valid || busy || creationFailed}
        className={`${buttonClass} w-full`}
      >
        {busy ? 'Getting Ari ready…' : 'Start Expert Learn session'}
      </button>
      {createdWorkflow && (
        <button
          type="button"
          className={secondaryClass}
          onClick={() => go({ name: 'map', workflowId: createdWorkflow.id })}
        >
          View saved workflow
        </button>
      )}
    </form>
  )
}
