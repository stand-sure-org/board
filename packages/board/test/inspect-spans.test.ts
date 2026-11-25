import { describe, expect, it } from 'vitest'
import type { BoardEventView } from '../src/api/routes.ts'
import { handoffsOf, lanesOf, spansOf } from '../src/inspect/app/spans.ts'

const by = (actor: string) => ({ actor, principal: actor, profile: null })
let cursor = 0
const at = (minute: number) => new Date(Date.UTC(2026, 10, 25, 15, minute)).toISOString()
function event(type: string, minute: number, payload: Record<string, unknown>): BoardEventView {
  cursor += 1
  return { cursor: String(cursor), type, createdAt: at(minute), payload } as unknown as BoardEventView
}
const now = Date.parse(at(30))

describe('claims as spans', () => {
  it('ends a claim the way the board says, and a lease that runs out with no event at its until', () => {
    const events = [
      event('task.claimed', 0, { id: '2', epoch: 1, until: at(15), by: by('claude') }),
      event('task.completed', 5, { id: '2', epoch: 1, by: by('claude') }),
      event('task.claimed', 1, { id: '4', epoch: 1, until: at(10), by: by('codex') }),
      event('task.renewed', 9, { id: '4', epoch: 1, until: at(20), by: by('codex') }),
      event('task.claimed', 2, { id: '6', epoch: 1, until: at(40), by: by('claude') }),
    ]
    const spans = spansOf(events, now)
    expect(spans.map((s) => [s.task, s.actor, s.how, s.end])).toEqual([
      ['2', 'claude', 'completed', Date.parse(at(5))],
      ['4', 'codex', 'lapsed', Date.parse(at(20))],
      ['6', 'claude', 'open', now],
    ])
    expect(lanesOf(spans)).toEqual(['claude', 'codex'])
  })

  it('closes an expired claim at its lease, not when the board noticed', () => {
    const spans = spansOf([event('task.claimed', 0, { id: '4', epoch: 1, until: at(1), by: by('codex') }), event('task.expired', 3, { id: '4', epoch: 1 })], now)
    expect(spans).toMatchObject([{ how: 'expired', end: Date.parse(at(1)) }])
  })

  it("draws a handoff from the claim that completed a task to the next claim of one that needed it", () => {
    const events = [
      event('task.created', 0, { id: '8', needs: [], by: by('chris') }),
      event('task.needs_changed', 0, { id: '8', needs: ['2'], by: by('chris') }),
      event('task.claimed', 1, { id: '2', epoch: 1, until: at(20), by: by('claude') }),
      event('task.completed', 6, { id: '2', epoch: 1, by: by('claude') }),
      event('task.claimed', 7, { id: '8', epoch: 1, until: at(22), by: by('codex') }),
    ]
    const spans = spansOf(events, now)
    expect(handoffsOf(events, spans).map((h) => [h.from.task, h.to.task, h.to.actor])).toEqual([['2', '8', 'codex']])
  })
})
