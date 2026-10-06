import { useState } from 'react'
import { processInventory, levelWeight } from './data.js'

// Frontend-only state for the Knowledge at risk panel.
// The backend has no retirement horizon or process inventory yet, so both live in localStorage.
const LINKS_KEY = 'ee:process-links' // { [workflowId]: processId }
const horizonKey = (userId) => `ee:horizon:${userId}`
const DEFAULT_HORIZON = { retireMonths: 18, tenureYears: 24 }

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be unavailable (private mode); the panel still works for this session */
  }
}

export const processById = (id) => processInventory.find((p) => p.id === id)

// Remember which process a workflow was created for.
export function linkProcess(workflowId, processId) {
  write(LINKS_KEY, { ...read(LINKS_KEY, {}), [workflowId]: processId })
}

export function useHorizon(userId) {
  const [horizon, setHorizon] = useState(() => ({
    ...DEFAULT_HORIZON,
    ...read(horizonKey(userId), {}),
  }))
  const update = (patch) => {
    const next = { ...horizon, ...patch }
    setHorizon(next)
    write(horizonKey(userId), next)
  }
  return [horizon, update]
}

const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// A process is captured when a READY workflow is linked to it (or has the same title),
// and in progress when a matching workflow exists but is not READY yet.
export function coverageOf(workflows) {
  const links = read(LINKS_KEY, {})
  const inventory = processInventory.map((p) => {
    const matches = workflows.filter(
      (w) => links[w.id] === p.id || norm(w.title) === norm(p.name),
    )
    const state = matches.some((w) => w.status === 'READY')
      ? 'captured'
      : matches.length
        ? 'progress'
        : 'todo'
    return { ...p, state }
  })
  const weight = (p) => levelWeight[p.level]
  const total = inventory.reduce((a, p) => a + weight(p), 0)
  const done = inventory.reduce(
    (a, p) =>
      a + weight(p) * (p.state === 'captured' ? 1 : p.state === 'progress' ? 0.4 : 0),
    0,
  )
  const critical = inventory.filter((p) => p.level === 'critical')
  return {
    inventory,
    coverage: Math.round((done / total) * 100),
    critical: { done: critical.filter((p) => p.state === 'captured').length, total: critical.length },
    captured: inventory.filter((p) => p.state === 'captured').length,
    remaining: inventory.filter((p) => p.state !== 'captured').length,
    next: inventory
      .filter((p) => p.state === 'todo')
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, 3),
  }
}
