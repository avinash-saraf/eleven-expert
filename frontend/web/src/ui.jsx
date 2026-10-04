import { errorMessage } from './api.js'

export const fieldClass =
  'w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none focus:border-zinc-900 disabled:opacity-50'
export const buttonClass =
  'rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40'
export const secondaryClass =
  'rounded-full border border-line px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-40'
export const MEET =
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s#]*)?$/i
export const isTerminal = (status) =>
  ['ENDED', 'COMPLETED', 'FAILED'].includes(status)
export const statusLabel = (status) =>
  ({
    CREATING: 'Preparing bot',
    JOINING: 'Joining meeting',
    WAITING_ROOM: 'Waiting for admission',
    IN_CALL: 'In meeting',
    RECORDING: 'Learning / coaching',
    STOPPING: 'Stopping',
    ENDED: 'Call ended',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    DRAFT: 'Draft',
    READY: 'Ready',
  })[status] ||
  status ||
  'Connecting'

export function ErrorNotice({ error, message, retry }) {
  if (!error && !message) return null
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <p>{message || errorMessage(error)}</p>
      {retry && (
        <button type="button" onClick={retry} className="mt-2 underline">
          Try again
        </button>
      )}
    </div>
  )
}
export function Loading({ children = 'Loading…' }) {
  return (
    <p role="status" className="p-6 text-sm text-zinc-500">
      {children}
    </p>
  )
}
export function knowledgeOf(workflow) {
  const items = workflow?.definition?.apprentice?.knowledge
  return Array.isArray(items) ? items : []
}
