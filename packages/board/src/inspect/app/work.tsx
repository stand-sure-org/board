import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as board from './board.ts'
import { Ago, here, navigate, useTypeToFocus } from './nav.tsx'
import { nameOf, stateNow, tasks, type State, type TaskRoot, type TaskState } from './store.ts'
import { Lease, Needs, StateMark } from './task.tsx'
import { Header } from './ui.tsx'
import { firstLine } from './words.ts'

// The board's work as a team would pin it to a wall: one column per stage, the cards in each, and
// how much is in flight against a limit. A card's stage is its state as it stands now, so a claim
// whose lease has run out shows back in Ready, flagged, though the board may still say claimed.

type Column = { key: string; title: string; states: TaskState[] }

const COLUMNS: Column[] = [
  { key: 'backlog', title: 'backlog', states: ['waiting'] },
  { key: 'ready', title: 'ready', states: ['ready'] },
  { key: 'doing', title: 'in progress', states: ['claimed'] },
  { key: 'blocked', title: 'blocked', states: ['blocked'] },
  { key: 'done', title: 'done', states: ['completed', 'failed', 'canceled'] },
]

/** How many claimed tasks a team takes on at once before the column shows as over. */
const DEFAULT_LIMIT = 4
/** How far back the done column reaches. */
const DONE_WINDOW = 24 * 60 * 60 * 1000

/** The limit on work in progress, from the URL: `/work?limit=3`. */
function readLimit(params: URLSearchParams): number {
  const n = Number(params.get('limit'))
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIMIT
}

export function Work(props: { state: State; now: number; lead: ReactNode; params: URLSearchParams }) {
  const { state } = props
  useTypeToFocus('main')
  const limit = readLimit(props.params)
  // Read every task once, so the columns hold the done ones too; the feed keeps them current after.
  const [loading, setLoading] = useState(true)
  const [refused, setRefused] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void board.loadTasks({ state: 'all', label: [] }).then((page) => {
      if (!current) return
      setLoading(false)
      setRefused('refused' in page ? page.refused : null)
    })
    return () => {
      current = false
    }
  }, [])
  // A second's clock, so a lease that runs out moves its card without a reload.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const all = useMemo(() => tasks(state, { state: 'all', label: [] }, now), [state.messages, state.ops, state.actors, now])
  const byColumn = useMemo(() => {
    const out = new Map<string, TaskRoot[]>(COLUMNS.map((c) => [c.key, []]))
    for (const root of all) {
      if (root.deleted) continue
      const current = stateNow(root.task, now)
      if (COLUMNS[4]!.states.includes(current) && now - Date.parse(root.createdAt) > DONE_WINDOW) continue
      const column = COLUMNS.find((c) => c.states.includes(current))
      if (column) out.get(column.key)!.push(root)
    }
    // Done reads newest first; every other column oldest first, the order work is taken in.
    out.get('done')!.reverse()
    return out
  }, [all, now])
  const lapsed = all.filter((r) => r.task.state === 'claimed' && stateNow(r.task, now) === 'ready').length
  const inFlight = byColumn.get('doing')!.length
  return (
    <>
      <Header title="work" meta={`${inFlight} of ${limit} in progress${lapsed ? ` · ${lapsed} lease${lapsed === 1 ? '' : 's'} ran out` : ''}`} live={state.live} lead={props.lead} />
      <div className="page work-page">
        {refused !== null ? (
          <p className="empty error">{refused}</p>
        ) : all.length === 0 ? (
          <p className="empty">{loading ? 'loading…' : 'no tasks yet'}</p>
        ) : (
          <div className="work-board">
            {COLUMNS.map((column) => {
              const cards = byColumn.get(column.key)!
              const over = column.key === 'doing' && cards.length > limit
              return (
                <section key={column.key} className={`work-column ${column.key}${over ? ' over' : ''}`}>
                  <h2>
                    {column.title}
                    <span className="count">
                      {cards.length}
                      {column.key === 'doing' && ` / ${limit}`}
                      {column.key === 'done' && ' · 24h'}
                    </span>
                  </h2>
                  {cards.map((root) => (
                    <WorkCard key={root.id} root={root} state={state} now={now} />
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/** One card: what the task says, who holds it, and the one thing about it that matters now. Opens its thread. */
function WorkCard({ root, state, now }: { root: TaskRoot; state: State; now: number }) {
  const { task } = root
  const current = stateNow(task, now)
  const lapsed = task.state === 'claimed' && current === 'ready'
  const open = () => navigate(here({ thread: root.id }))
  return (
    <div
      className={`work-card${lapsed ? ' lapsed' : ''}`}
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('a')) open()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open()
      }}
    >
      <span className="work-title">
        <span className="faint">#{root.id}</span> {firstLine(root.text) || (root.attachments ?? []).map((file) => file.name).join(', ') || 'message removed'}
      </span>
      <span className="work-meta">
        {current === 'claimed' && task.claim && (
          <>
            {nameOf(state, task.claim.actor)} · <Lease until={task.claim.until} />
          </>
        )}
        {lapsed && task.claim && <span className="work-flag">lease ran out · was {nameOf(state, task.claim.actor)}</span>}
        {current === 'ready' && !lapsed && task.for && `for ${nameOf(state, task.for)}`}
        {current === 'waiting' && (
          <>
            needs <Needs ids={task.needs} state={state} />
          </>
        )}
        {current === 'blocked' && (task.blocked?.kind ?? task.blocked?.reason)}
        {(current === 'completed' || current === 'failed' || current === 'canceled') && <StateMark state={current} />}
      </span>
      <span className="work-foot">
        <span className="task-where">#{root.channel}</span>
        <Ago iso={root.createdAt} />
      </span>
    </div>
  )
}
