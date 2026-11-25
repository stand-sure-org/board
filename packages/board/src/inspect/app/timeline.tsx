import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BoardEventView } from '../../api/routes.ts'
import * as board from './board.ts'
import { here, Link, navigate } from './nav.tsx'
import { handoffsOf, lanesOf, spansOf, type Span } from './spans.ts'
import { nameOf, type State } from './store.ts'
import { Header } from './ui.tsx'
import { clock, refusal } from './words.ts'

// Who held what, and when: a lane per agent, a bar per claim from when it began to how it ended,
// and an arrow where one task finishing let another start. A lease that ran out is hatched, so work
// that went quiet shows as clearly as work that finished.

const LANE = 34
const BAR = 20
const AXIS = 22
const MIN_WINDOW = 10 * 60 * 1000
const MAX_WINDOW = 24 * 60 * 60 * 1000

/** The window to show, from the URL: `/timeline?hours=2`. Without one, it fits what the events show. */
function readWindow(params: URLSearchParams): number | null {
  const hours = Number(params.get('hours'))
  return Number.isFinite(hours) && hours > 0 ? Math.min(Math.max(hours * 3_600_000, MIN_WINDOW), MAX_WINDOW) : null
}

/** Round times for the axis: about six of them across the window. */
function ticks(from: number, to: number): number[] {
  const steps = [60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 2 * 3_600_000, 3 * 3_600_000, 6 * 3_600_000]
  const step = steps.find((s) => (to - from) / s <= 7) ?? 12 * 3_600_000
  const out: number[] = []
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t)
  return out
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function Timeline(props: { state: State; lead: ReactNode; params: URLSearchParams }) {
  const { state } = props
  const [events, setEvents] = useState<BoardEventView[] | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  // The newest events once, then each one the feed brings, task events only.
  useEffect(() => {
    let current = true
    const live: BoardEventView[] = []
    const off = board.onLive((event) => {
      if (!event.type.startsWith('task.')) return
      if (current) setEvents((prev) => (prev === null ? (live.push(event), prev) : prev.some((e) => e.cursor === event.cursor) ? prev : [...prev, event]))
    })
    board.recentEvents().then(
      (read) => {
        if (!current) return
        const seen = new Set(read.map((e) => e.cursor))
        setEvents([...read.filter((e) => e.type.startsWith('task.')), ...live.filter((e) => !seen.has(e.cursor))])
      },
      (error: unknown) => current && setRefused(refusal(error)),
    )
    return () => {
      current = false
      off()
    }
  }, [])
  // A second's clock, so an open claim grows and a lapsed one shows the moment it lapses.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const spans = useMemo(() => (events ? spansOf(events, now) : []), [events, now])
  const handoffs = useMemo(() => (events ? handoffsOf(events, spans) : []), [events, spans])
  const lanes = lanesOf(spans)
  const chosen = readWindow(props.params)
  const earliest = spans.length > 0 ? Math.min(...spans.map((s) => s.start)) : now - MIN_WINDOW
  const width = chosen ?? Math.min(Math.max(now - earliest, MIN_WINDOW) * 1.05, MAX_WINDOW)
  const from = now - width
  const x = (t: number) => `${(Math.max(0, Math.min(1, (t - from) / width)) * 100).toFixed(3)}%`
  const y = (actor: string) => AXIS + lanes.indexOf(actor) * LANE + (LANE - BAR) / 2
  const shown = spans.filter((s) => s.end >= from)
  const lapsed = spans.filter((s) => s.how === 'lapsed' || s.how === 'expired').length
  const height = AXIS + lanes.length * LANE

  return (
    <>
      <Header
        title="timeline"
        meta={`${lanes.length} agent${lanes.length === 1 ? '' : 's'} · ${spans.length} claim${spans.length === 1 ? '' : 's'}${lapsed ? ` · ${lapsed} ran out` : ''}`}
        live={state.live}
        lead={props.lead}
      />
      <nav className="tabs plain">
        {[null, '1', '6', '24'].map((hours) => (
          <Link key={hours ?? 'fit'} to={here({ params: { hours } })} className="tab" current={(props.params.get('hours') ?? null) === hours}>
            {hours ? `${hours}h` : 'fit'}
          </Link>
        ))}
      </nav>
      <div className="page">
        {refused !== null ? (
          <p className="empty error">{refused}</p>
        ) : events === null ? (
          <p className="empty">loading…</p>
        ) : lanes.length === 0 ? (
          <p className="empty">no claims in the board's newest events</p>
        ) : (
          <div className="timeline">
            <div className="timeline-lanes" style={{ paddingTop: AXIS }}>
              {lanes.map((actor) => (
                <div key={actor} className="timeline-lane" style={{ height: LANE }} title={actor}>
                  {nameOf(state, actor)}
                </div>
              ))}
            </div>
            <svg className="timeline-chart" width="100%" height={height} role="img" aria-label="claims by agent over time">
              <defs>
                <pattern id="timeline-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" className="timeline-hatch" />
                </pattern>
                <marker id="timeline-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="timeline-arrowhead" />
                </marker>
              </defs>
              {ticks(from, now).map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={AXIS - 4} y2={height} className="timeline-grid" />
                  <text x={x(t)} y={12} className="timeline-tick">
                    {time(t)}
                  </text>
                </g>
              ))}
              {lanes.map((actor, i) => (
                <line key={actor} x1="0" x2="100%" y1={AXIS + (i + 1) * LANE} y2={AXIS + (i + 1) * LANE} className="timeline-rule" />
              ))}
              {shown.map((span) => (
                <Bar key={`${span.task}:${span.epoch}:${span.start}`} span={span} x={x} y={y(span.actor)} now={now} state={state} />
              ))}
              {handoffs
                .filter((h) => h.to.end >= from)
                .map((h) => (
                  <line
                    key={`${h.from.task}>${h.to.task}`}
                    x1={x(h.from.end)}
                    y1={y(h.from.actor) + BAR / 2}
                    x2={x(h.to.start)}
                    y2={y(h.to.actor) + BAR / 2}
                    className="timeline-handoff"
                    markerEnd="url(#timeline-arrow)"
                  >
                    <title>{`#${h.from.task} completed, then #${h.to.task} began`}</title>
                  </line>
                ))}
              <line x1="100%" x2="100%" y1={AXIS - 4} y2={height} className="timeline-now" />
            </svg>
          </div>
        )}
        {events !== null && (
          <p className="hint timeline-key">
            solid: done · outlined: in progress · hatched: lease ran out · red: failed · arrows: what one task's finish let start. Reads the board's newest
            100 events, then follows the feed.
          </p>
        )}
      </div>
    </>
  )
}

function Bar({ span, x, y, now, state }: { span: Span; x: (t: number) => string; y: number; now: number; state: State }) {
  const left = x(span.start)
  const width = `${Math.max(parseFloat(x(span.end)) - parseFloat(left), 0.4).toFixed(3)}%`
  const said =
    span.how === 'open'
      ? `${clock(span.until - now)} left`
      : span.how === 'lapsed' || span.how === 'expired'
        ? 'lease ran out'
        : span.how
  return (
    <g className={`timeline-span ${span.how}`} role="link" tabIndex={0} onClick={() => navigate(here({ thread: span.task }))} onKeyDown={(e) => e.key === 'Enter' && navigate(here({ thread: span.task }))}>
      <title>{`#${span.task} · ${nameOf(state, span.actor)} · ${time(span.start)} to ${span.how === 'open' ? 'now' : time(span.end)} · ${said}`}</title>
      <rect x={left} y={y} width={width} height={BAR} />
      <text x={left} dx={4} y={y + BAR / 2 + 4}>
        #{span.task}
      </text>
    </g>
  )
}
