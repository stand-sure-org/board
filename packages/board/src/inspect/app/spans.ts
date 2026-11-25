import type { BoardEventView } from '../../api/routes.ts'

// A task's claims as spans of time on the agent that held them, read from the board's events: when
// each claim began, how long its lease ran, and how it ended. The board keeps a task's state as it is
// now; its feed is the only place a claim's history is, so the timeline reads the feed.

/** How a claim ended, or `open` while its lease runs, or `lapsed` when its lease ran out with no event to say so. */
export type SpanEnd = 'open' | 'lapsed' | 'completed' | 'failed' | 'released' | 'expired' | 'blocked' | 'canceled'

export type Span = {
  task: string
  /** Who held it: the actor ID the claim was made as, a profile's included. */
  actor: string
  epoch: number
  start: number
  /** When it ended, or now while it runs. */
  end: number
  /** Where its lease stood last: renewals move it on. */
  until: number
  how: SpanEnd
}

/** One task finishing what another waited for, and that one's next claim: an arrow from one span to the other. */
export type Handoff = { from: Span; to: Span }

const ENDS: Record<string, SpanEnd> = {
  'task.completed': 'completed',
  'task.failed': 'failed',
  'task.released': 'released',
  'task.expired': 'expired',
  'task.blocked': 'blocked',
  'task.canceled': 'canceled',
}

type Payload = { id?: string; epoch?: number; until?: string; needs?: string[]; by?: { actor?: string } }

/** Every claim the events show, oldest first, as it stands at `now`. Events are in the feed's order. */
export function spansOf(events: readonly BoardEventView[], now: number): Span[] {
  const done: Span[] = []
  const open = new Map<string, Span>()
  for (const event of events) {
    const payload = event.payload as Payload
    const id = payload.id
    if (id === undefined) continue
    const at = Date.parse(event.createdAt)
    if (event.type === 'task.claimed') {
      // A claim over one whose lease ran out: the board says expired first, but a feed read from the middle may not.
      const before = open.get(id)
      if (before) done.push({ ...before, end: Math.min(before.until, at), how: 'expired' })
      open.set(id, {
        task: id,
        actor: payload.by?.actor ?? event.actor?.id ?? 'unknown',
        epoch: payload.epoch ?? 0,
        start: at,
        end: at,
        until: Date.parse(payload.until ?? event.createdAt),
        how: 'open',
      })
      continue
    }
    const span = open.get(id)
    if (!span) continue
    if (event.type === 'task.renewed') {
      if (payload.until) span.until = Date.parse(payload.until)
      continue
    }
    const how = ENDS[event.type]
    if (how === undefined) continue
    open.delete(id)
    // A lease ends at its `until`, though the board may say so later.
    done.push({ ...span, end: how === 'expired' ? Math.min(span.until, at) : at, how })
  }
  for (const span of open.values()) done.push(span.until <= now ? { ...span, end: span.until, how: 'lapsed' } : { ...span, end: now, how: 'open' })
  return done.sort((a, b) => a.start - b.start || Number(a.task) - Number(b.task))
}

/**
 * The handoffs the events show: a task that waited for another, claimed after that one completed.
 * Its arrow runs from the claim that completed it to the dependent's first claim after.
 */
export function handoffsOf(events: readonly BoardEventView[], spans: readonly Span[]): Handoff[] {
  const needs = new Map<string, string[]>()
  for (const event of events) {
    const payload = event.payload as Payload
    if ((event.type === 'task.created' || event.type === 'task.needs_changed') && payload.id && payload.needs) needs.set(payload.id, payload.needs)
  }
  const out: Handoff[] = []
  for (const [task, wanted] of needs) {
    for (const need of wanted) {
      const from = spans.filter((s) => s.task === need && s.how === 'completed').at(-1)
      if (!from) continue
      const to = spans.find((s) => s.task === task && s.start >= from.end)
      if (to) out.push({ from, to })
    }
  }
  return out
}

/** The lanes, one per actor, in the order each first claimed something. */
export function lanesOf(spans: readonly Span[]): string[] {
  return [...new Set(spans.map((s) => s.actor))]
}
