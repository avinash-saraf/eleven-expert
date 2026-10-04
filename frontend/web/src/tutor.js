// Mock tutor, grounded in the Work Map node being taught.
// Replace `reply` with the ElevenLabs Conversational AI agent (give it the map as context).
export async function reply(text, node, expertName) {
  await new Promise((r) => setTimeout(r, 450))
  const t = text.toLowerCase()
  const first = expertName.split(' ')[0]
  if (/why|reason|matter/.test(t)) return `Here's the judgment behind it: ${node.why}`
  if (/except|unless|special|ever|edge/.test(t))
    return node.exceptions.length
      ? `Exceptions ${first} flagged: ${node.exceptions.join(' ')}`
      : `${first} didn't name an exception here. I've flagged it as a gap for her debrief.`
  if (/rule|never|guardrail|limit|policy|mistake|wrong|risk/.test(t))
    return node.guardrails.length
      ? `Hard rules from ${first}: ${node.guardrails.join(' ')}`
      : `No hard rule was captured for this step. I've flagged it for ${first}.`
  return `Short version from ${first}: ${node.action} The key is the why: ${node.why}`
}

export function speak(text, { onStart, onEnd } = {}) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ''))
  u.rate = 1.03
  u.onstart = onStart
  u.onend = onEnd
  u.onerror = onEnd
  window.speechSynthesis.speak(u)
}

export function listen({ onResult, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return null
  const rec = new SR()
  rec.lang = 'en-US'
  rec.onresult = (e) => onResult(e.results[0][0].transcript)
  rec.onend = onEnd
  rec.onerror = onEnd
  rec.start()
  return rec
}
