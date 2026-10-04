import { useEffect, useRef, useState } from 'react'
import { useEventsQuery, useLazyEventsQuery } from './api.js'

export function useSessionEvents(args, pollingInterval = 2000) {
  const query = useEventsQuery(args, {
    pollingInterval,
    refetchOnReconnect: true,
  })
  const [loadPage, older] = useLazyEventsQuery()
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const initialized = useRef(false)
  const merge = (page) =>
    setItems((previous) => {
      const merged = new Map(previous.map((e) => [e.id, e]))
      for (const e of page.items) merged.set(e.id, e)
      return [...merged.values()].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
    })
  useEffect(() => {
    if (!query.data) return
    merge(query.data)
    if (!initialized.current) {
      initialized.current = true
      setCursor(query.data.nextCursor)
    }
  }, [query.data])
  async function loadOlder() {
    if (!cursor || older.isFetching) return
    try {
      const page = await loadPage({ ...args, before: cursor }).unwrap()
      merge(page)
      setCursor(page.nextCursor)
    } catch {
      /* The view shows the error. */
    }
  }
  return {
    items,
    cursor,
    loadOlder,
    loadingOlder: older.isFetching,
    error: query.error || older.error,
    refetch: query.refetch,
    isLoading: query.isLoading,
  }
}

export function displayEvent(event) {
  const p = event.payload || {}
  const type = event.type
  if (type === 'apprentice.transcript')
    return {
      who: p.participantName || 'You',
      text: p.text,
      category: 'Speech',
    }
  if (type === 'apprentice.question')
    return {
      who: 'Ari',
      text: p.question,
      category: 'Clarification',
      delivery: 'Speaking…',
    }
  if (type === 'apprentice.question_delivered')
    return { who: 'Ari', text: p.question, category: 'Clarification' }
  if (type === 'apprentice.question_failed')
    return {
      who: 'Ari',
      text: p.question,
      category: 'Voice failed',
      failed: true,
    }
  if (type === 'apprentice.agent_said')
    return {
      who: 'Ari',
      text: p.text,
      category:
        p.phase === 'debrief'
          ? 'Debrief'
          : p.phase === 'done'
            ? 'Wrap-up'
            : 'Conversation',
    }
  if (type === 'apprentice.teach.alert')
    return { who: 'Ari', text: p.alert, category: 'correction' }
  if (type === 'apprentice.teach.replay')
    return {
      who: 'Ari',
      text: `Showing the expert’s screen: ${p.caption}`,
      category: 'Replay',
    }
  if (type === 'apprentice.screen_event')
    return { who: 'Screen', text: p.text, category: 'Screen' }
  if (type === 'apprentice.off_record')
    return {
      who: 'Ari',
      text: p.active
        ? 'Off the record. Nothing is being saved.'
        : 'Back on the record.',
      category: 'Privacy',
    }
  if (type === 'apprentice.debrief.teachback')
    return {
      who: 'Ari',
      text: p.confirmed
        ? 'The expert confirmed the teach-back.'
        : 'The teach-back was not confirmed yet.',
      category: 'Teach-back',
    }
  if (type === 'apprentice.teach.lesson')
    return {
      who: 'Ari',
      text: `Mastered: ${(p.mastered || []).join('; ') || 'nothing yet'}. Practice next: ${(p.practice || []).join('; ') || 'nothing'}.`,
      category: 'Lesson result',
    }
  if (type === 'apprentice.knowledge')
    return { who: 'Work Map', text: p.statement, category: p.kind }
  if (type === 'apprentice.reply')
    return {
      who: 'Ari',
      text: p.speech,
      category: 'Answer',
      delivery: 'Speaking…',
    }
  if (type === 'apprentice.reply_delivered')
    return { who: 'Ari', text: p.speech, category: 'Answer' }
  if (type === 'apprentice.reply_failed')
    return {
      who: 'Ari',
      text: p.speech,
      category: 'Voice failed',
      failed: true,
    }
  if (type === 'apprentice.reply_interrupted')
    return { who: 'Ari', text: p.speech, category: 'Interrupted' }
  if (type === 'apprentice.teach.speech')
    return {
      who: 'Ari',
      text: p.speech,
      category: p.category,
      delivery: 'Speaking…',
    }
  if (type === 'apprentice.teach.speech_delivered')
    return { who: 'Ari', text: p.speech, category: p.category }
  if (type === 'apprentice.teach.speech_failed')
    return {
      who: 'Ari',
      text: p.speech,
      category: 'Voice failed',
      failed: true,
    }
  if (type === 'apprentice.teach.speech_interrupted')
    return { who: 'Ari', text: p.speech, category: 'Interrupted' }
  return null
}
// Hide a "started" entry once its delivery outcome is present.
export function visibleEvents(items) {
  return items
    .filter((event, index) => {
      if (
        ![
          'apprentice.question',
          'apprentice.reply',
          'apprentice.teach.speech',
        ].includes(event.type)
      )
        return true
      const text = event.payload?.speech || event.payload?.question
      return !items
        .slice(index + 1)
        .some(
          (later) =>
            later.type.startsWith(event.type + '_') &&
            (later.payload?.speech || later.payload?.question) === text,
        )
    })
    .map((event) => ({ ...event, display: displayEvent(event) }))
    .filter((event) => event.display?.text)
}
