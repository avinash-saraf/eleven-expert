import Face from './Face.jsx'
import { statusLabel } from './ui.jsx'

export default function InviteCard({ meetingUrl, status }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-6 text-center">
      <div className="mb-4 flex justify-center">
        <Face state="idle" size={100} />
      </div>
      <h2 className="text-xl font-semibold">Admit Ari to your Meet</h2>
      <p className="mt-2 text-sm text-zinc-500">
        Ari is joining the meeting link you provided. Accept its join request,
        then share your screen and speak to it.
      </p>
      <a
        href={meetingUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-4 block rounded-full border border-line py-2 text-sm hover:bg-zinc-100"
      >
        Open your Meet ↗
      </a>
      <div
        role="status"
        className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-500"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        {statusLabel(status)}
      </div>
    </section>
  )
}
