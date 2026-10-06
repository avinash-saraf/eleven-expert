import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMeQuery } from './api.js'
import { signedIn, signedOut, identityUpdated } from './auth.js'
import { ErrorNotice, Loading, secondaryClass } from './ui.jsx'
import Auth from './Auth.jsx'
import Dashboard from './Dashboard.jsx'
import NewSession from './NewSession.jsx'
import WorkMap from './WorkMap.jsx'
import LiveCapture from './LiveCapture.jsx'
import LearnerLive from './LearnerLive.jsx'
import LearnerSummary from './LearnerSummary.jsx'
import LearnerSetup from './LearnerSetup.jsx'
import Logo from './Logo.jsx'

function readRoute() {
  const [name = 'home', workflowId, sessionId] = location.hash
    .slice(1)
    .split('/')
  return { name: name || 'home', workflowId, sessionId }
}

export default function App() {
  const dispatch = useDispatch()
  const { accessToken, user, expiresAt } = useSelector((state) => state.auth)
  const me = useMeQuery(undefined, {
    skip: !accessToken,
    pollingInterval: 60000,
    refetchOnMountOrArgChange: true,
  })
  useEffect(() => {
    if (me.data) dispatch(identityUpdated(me.data))
  }, [me.data, dispatch])
  useEffect(() => {
    if (!accessToken) return
    const timer = setTimeout(
      () => dispatch(signedOut()),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [accessToken, expiresAt, dispatch])
  if (!accessToken || !user)
    return (
      <Auth
        onAuth={(result) => {
          location.hash = 'home'
          dispatch(signedIn(result))
        }}
      />
    )
  if (me.isLoading) return <Loading>Opening your workspace…</Loading>
  if (me.error)
    return (
      <div className="mx-auto max-w-lg space-y-4 p-8">
        <ErrorNotice error={me.error} retry={me.refetch} />
        <button
          className={secondaryClass}
          onClick={() => dispatch(signedOut())}
        >
          Back to sign in
        </button>
      </div>
    )
  return (
    <Workspace
      key={user.id}
      user={user}
      onSignOut={() => {
        location.hash = 'home'
        dispatch(signedOut())
      }}
    />
  )
}

function Workspace({ user, onSignOut }) {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const update = () => setRoute(readRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const go = ({ name = 'home', workflowId, sessionId }) => {
    location.hash = [name, workflowId, sessionId].filter(Boolean).join('/')
    setRoute(readRoute())
  }
  const live = (session) =>
    go({ name: 'live', workflowId: session.workflowId, sessionId: session.id })
  let page
  if (route.name === 'new' && user.role === 'expert')
    page = (
      <NewSession
        key={route.workflowId || 'new'}
        workflowId={route.workflowId?.startsWith('process:') ? undefined : route.workflowId}
        processId={route.workflowId?.startsWith('process:') ? route.workflowId.slice(8) : undefined}
        onCreated={live}
        go={go}
      />
    )
  else if (['map', 'teach'].includes(route.name) && route.workflowId)
    page = (
      <WorkMap
        key={route.workflowId}
        workflowId={route.workflowId}
        user={user}
        go={go}
      />
    )
  else if (
    route.name === 'join' &&
    route.workflowId &&
    user.role === 'employee'
  )
    page = (
      <LearnerSetup
        key={route.workflowId}
        workflowId={route.workflowId}
        onCreated={live}
        go={go}
      />
    )
  else if (route.name === 'live' && route.workflowId && route.sessionId) {
    const props = {
      workflowId: route.workflowId,
      sessionId: route.sessionId,
      user,
      go,
    }
    page =
      user.role === 'expert' ? (
        <LiveCapture key={route.sessionId} {...props} />
      ) : (
        <LearnerLive key={route.sessionId} {...props} />
      )
  } else if (route.name === 'summary' && route.workflowId && route.sessionId)
    page = (
      <LearnerSummary
        key={route.sessionId}
        workflowId={route.workflowId}
        sessionId={route.sessionId}
        user={user}
        go={go}
      />
    )
  else page = <Dashboard user={user} go={go} />
  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel/80 px-4 py-3 backdrop-blur sm:px-6">
        <button onClick={() => go({ name: 'home' })}>
          <Logo />
        </button>
        <nav className="flex gap-1 text-sm">
          <button
            className={`rounded-full px-4 py-1.5 ${route.name === 'home' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-100'}`}
            onClick={() => go({ name: 'home' })}
          >
            Dashboard
          </button>
          {user.role === 'expert' && (
            <button
              className={`rounded-full px-4 py-1.5 ${route.name === 'new' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-100'}`}
              onClick={() => go({ name: 'new' })}
            >
              New workflow
            </button>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span className="hidden sm:inline">
            {user.name} · {user.organization.name}
          </span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs capitalize">
            {user.role}
          </span>
          <button onClick={onSignOut} className="text-xs hover:text-zinc-900">
            Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{page}</main>
    </div>
  )
}
