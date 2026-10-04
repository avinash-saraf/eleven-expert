import { useState } from 'react'
import Face from './Face.jsx'
import Logo from './Logo.jsx'
import { useLoginMutation } from './api.js'
import { ErrorNotice } from './ui.jsx'

const input =
  'w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-zinc-900'

export default function Auth({ onAuth }) {
  const [role, setRole] = useState('expert')
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')
  const ok = name.trim() && org.trim()
  const [login, { isLoading, error }] = useLoginMutation()
  const submit = async (identity) => {
    if (isLoading) return
    try {
      onAuth(await login(identity).unwrap())
    } catch {
      /* The form shows the API error. */
    }
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto] p-6">
      <Logo size={22} />
      <div className="mx-auto grid w-full max-w-5xl items-center gap-12 py-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
            Capture what your experts know.
            <br />
            <span className="text-zinc-500">Teach it to everyone.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-500">
            Ari joins your Google Meet, watches you work, and asks{' '}
            <em className="not-italic text-zinc-900">why</em> at the right
            moments. Your judgment becomes a Work Map and a voice tutor for
            every new hire.
          </p>
          <div className="mt-8 flex items-center gap-3 text-sm text-zinc-500">
            {['Capture', 'Map', 'Teach'].map((s, i) => (
              <span key={s} className="flex items-center gap-3">
                <span className="font-medium text-zinc-900">{s}</span>
                {i < 2 && <span className="text-zinc-300">→</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-line bg-panel p-7 shadow-sm">
          <div className="mb-5 flex items-center gap-4">
            <Face state="listening" size={64} />
            <div>
              <div className="font-medium">Meet Ari</div>
              <div className="text-sm text-zinc-500">Your AI apprentice</div>
            </div>
          </div>
          <div className="grid grid-cols-2 rounded-xl bg-zinc-100 p-1 text-sm">
            {[
              ['expert', "I'm an expert"],
              ['employee', "I'm learning"],
            ].map(([k, l]) => (
              <button
                key={k}
                disabled={isLoading}
                onClick={() => setRole(k)}
                className={`rounded-lg py-2 transition ${role === k ? 'bg-panel font-medium shadow-sm' : 'text-zinc-500'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              ok &&
                submit({
                  role,
                  name: name.trim(),
                  organizationName: org.trim(),
                })
            }}
            className="mt-4 space-y-3"
          >
            <input
              required
              maxLength={120}
              aria-label="Your name"
              disabled={isLoading}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={input}
            />
            <input
              required
              maxLength={120}
              aria-label="Organization name"
              disabled={isLoading}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder={
                role === 'expert' ? 'Organization name' : 'Organization to join'
              }
              className={input}
            />
            <ErrorNotice error={error} />
            <button
              disabled={!ok || isLoading}
              className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-30"
            >
              {isLoading
                ? 'Signing in…'
                : role === 'expert'
                  ? 'Create workspace'
                  : 'Join workspace'}
            </button>
          </form>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-zinc-500">
            <span>Try the demo</span>
            <div className="flex gap-2">
              <button
                disabled={isLoading}
                onClick={() =>
                  submit({
                    role: 'expert',
                    name: 'Sabine Keller',
                    organizationName: 'Schwabe Maschinenbau',
                  })
                }
                className="rounded-full border border-line px-3 py-1 text-zinc-600 hover:bg-zinc-100"
              >
                Sabine · expert
              </button>
              <button
                disabled={isLoading}
                onClick={() =>
                  submit({
                    role: 'employee',
                    name: 'Lena Fischer',
                    organizationName: 'Schwabe Maschinenbau',
                  })
                }
                className="rounded-full border border-line px-3 py-1 text-zinc-600 hover:bg-zinc-100"
              >
                Lena · new hire
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="text-xs text-zinc-500">
        Built with ElevenLabs voice agents
      </div>
    </div>
  )
}
