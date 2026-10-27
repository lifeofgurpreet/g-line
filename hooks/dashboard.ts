// `/g-line dashboard`: one self-contained HTML page, a snapshot of what g-line
// holds at the moment it is asked. No script, nothing loaded from anywhere,
// nothing that updates itself. Pure, like extras.ts and deck.ts: the mod
// gathers the snapshot, writes the file and opens it; this turns the figures
// into words and markup, and the tests call it directly.
//
// Rule 4 (private by default): the page never takes a path, a repository name,
// a branch or an email from the snapshot. The account line shows only when the
// snapshot says the person set `account_command`.

import { clock, duration, modelName, pace, pct, tokens, utcLabel } from './core'
import type { Payload } from './core'
import { cacheNext, windowNext } from './deck'
import { addCounts, dayOf, emptyDay, money } from './extras'
import { rosterRow } from './roster'
import type { RosterEntry } from './roster'
import type { Day } from '../types'

export type DashboardGuard = {
  /** Each rule as `ruleText` writes it, and whether it is in force now. */
  rules: { text: string; inForce: boolean }[]
  /** `whyLines`: what is in force now. */
  why: string[]
  on: boolean
  /** The readings are simulated (`/g-line guard simulate`). */
  simulated: boolean
  /** Keep-warm as the pane words it, when configured. */
  keepWarm?: string
  errors: string[]
}

export type DashboardSnapshot = {
  /** Unix seconds when the snapshot was made. */
  nowSeconds: number
  /** Minutes east of UTC where the person is (their `tz`, else the machine's). */
  utcOffsetMinutes: number
  /** The IANA zone the person set under `tz`, if any. */
  tz?: string
  /** g-line's version, when it could be read. */
  version?: string | null
  /** The statusLine-shaped view the line is drawn from: windows, cache, model, context. */
  payload: Payload
  /** Sessions on this machine, this one included. */
  sessions: { entry: RosterEntry; mine: boolean }[]
  /** True only when the person set `account_command`. */
  showAccount: boolean
  /** The store's `d:<day>:<session>` entries. */
  ledger: { key: string; value: unknown }[]
  guard: DashboardGuard
}

/** Escapes a string for HTML text and attribute values. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const KEY = /^d:(\d{4}-\d{2}-\d{2}):/

/** The last `count` days ending today, oldest first, each summed over the sessions' entries. */
export function historyDays(entries: readonly { key: string; value: unknown }[], today: string, count = 14): Day[] {
  const days: string[] = []
  for (let i = count - 1; i >= 0; i--) days.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10))
  const sums = new Map(days.map(day => [day, emptyDay(day)]))
  for (const { key, value } of entries) {
    const day = KEY.exec(key)?.[1]
    const sum = day ? sums.get(day) : undefined
    if (!sum || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const n = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : 0)
    sum.cost += n('cost'); sum.turns += n('turns'); sum.tools += n('tools'); sum.colds += n('colds'); sum.agents += n('agents')
    if (n('warms')) {
      sum.warms = (sum.warms ?? 0) + n('warms')
      sum.warmCost = (sum.warmCost ?? 0) + n('warmCost')
    }
    sum.coldWhy = addCounts(sum.coldWhy, v.coldWhy)
    sum.sessions += 1
  }
  return days.map(day => sums.get(day) ?? emptyDay(day))
}

const WINDOWS = [['five_hour', '5-hour'], ['seven_day', 'weekly']] as const

function windowsSection(s: DashboardSnapshot): string {
  const now = s.nowSeconds
  const rows: string[] = []
  for (const [kind, name] of WINDOWS) {
    const w = s.payload.rate_limits?.[kind]
    const used = w?.used_percentage
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) continue
    const resets = typeof w?.resets_at === 'number' && w.resets_at > now ? w.resets_at : undefined
    const when = resets !== undefined ? `, resets ${clock(resets, now, s.utcOffsetMinutes)} (in ${duration(resets - now)})` : ''
    const state = pace(kind, w, now)
    const next = windowNext(s.payload, kind, { now, utcOffsetMinutes: s.utcOffsetMinutes })
    const paceText = state?.kind === 'full' ? 'The window is full.'
      : state?.kind === 'hot' ? `On pace to run out: ${next?.forms[0] ?? ''}.`
      : state?.kind === 'ok' ? 'On pace to last until the reset.' : 'Too early in the window to project a pace.'
    const tone = state?.kind === 'full' ? 'bad' : state?.kind === 'hot' || used >= 80 ? 'warn' : ''
    rows.push(`<div class="card ${tone}"><div class="big">${esc(pct(used))}</div><div><p class="strong">${esc(`${name} ${pct(used)} used${when}`)}</p>`
      + `<div class="meter"><span style="width:${Math.max(0, Math.min(100, used)).toFixed(0)}%"></span></div>`
      + `<p class="muted">${esc(paceText)}</p></div></div>`)
  }
  if (!rows.length) return '<p class="muted">No usage readings yet (an API key, a cloud provider, or no request so far).</p>'
  const zone = `Times are ${s.tz ? `in ${s.tz} (${utcLabel(s.utcOffsetMinutes)})` : `this machine's (${utcLabel(s.utcOffsetMinutes)})`}.`
  return `<div class="cards">${rows.join('')}</div><p class="muted">${esc(zone)}</p>`
}

function sessionsSection(s: DashboardSnapshot): string {
  if (!s.sessions.length) return '<p class="muted">No sessions reported on this machine yet.</p>'
  const now = s.nowSeconds * 1000
  const items = s.sessions.slice(0, 20).map(({ entry, mine }) => {
    const shown = s.showAccount ? entry : { ...entry, account: undefined }
    const tone = entry.state === 'waiting' ? 'warn' : entry.state === 'working' ? 'ok' : ''
    return `<li class="${tone}">${esc(rosterRow(shown, now, mine))}</li>`
  })
  return `<ul class="rows">${items.join('')}</ul>`
}

function bars(days: readonly Day[]): string {
  const top = Math.max(0, ...days.map(d => d.cost))
  const w = 28
  const h = 90
  const cells = days.map((d, i) => {
    const barH = top > 0 ? Math.max(d.cost > 0 ? 2 : 0, Math.round((d.cost / top) * (h - 16))) : 0
    const x = i * w + 4
    return `<g><title>${esc(`${d.day}: ${money(d.cost)}`)}</title>`
      + `<rect class="bar" x="${x}" y="${h - barH}" width="${w - 8}" height="${barH}" rx="2"/>`
      + `<text class="tick" x="${x + (w - 8) / 2}" y="${h + 12}" text-anchor="middle">${esc(d.day.slice(8))}</text></g>`
  })
  return `<svg class="chart" viewBox="0 0 ${days.length * w} ${h + 18}" role="img" aria-label="${esc(`Cost per day at API prices, last ${days.length} days, highest ${money(top)}`)}">${cells.join('')}</svg>`
}

function historySection(s: DashboardSnapshot): string {
  const today = dayOf(s.nowSeconds * 1000, s.utcOffsetMinutes)
  const days = historyDays(s.ledger, today, 14)
  if (!days.some(d => d.turns || d.cost)) {
    return '<p class="muted">No history yet: g-line counts turns from the sessions it runs in, and none has finished a turn in the last 14 days.</p>'
  }
  const cell = (n: number | undefined, text: string) => `<td class="num">${n ? esc(text) : '-'}</td>`
  const rows = [...days].reverse().map(d => `<tr><td>${esc(d.day)}</td>${cell(d.turns, String(d.turns))}${cell(d.cost, money(d.cost))}`
    + `${cell(d.colds, String(d.colds))}${cell(d.warms, String(d.warms ?? 0))}${cell(d.warmCost, money(d.warmCost ?? 0))}`
    + `${cell(d.tools, String(d.tools))}${cell(d.agents, String(d.agents))}</tr>`)
  const week = days.slice(-7)
  const sum = (f: (d: Day) => number) => week.reduce((t, d) => t + f(d), 0)
  const totals = `This week (last 7 days): ${sum(d => d.turns)} turns, ${money(sum(d => d.cost))} at API prices, ${sum(d => d.colds)} cold cache rebuilds, `
    + `${sum(d => d.warms ?? 0)} keep-warm re-reads (${money(sum(d => d.warmCost ?? 0))}), ${sum(d => d.tools)} tool calls, ${sum(d => d.agents)} agents.`
  // Why the week's cold rebuilds happened, as keep-warm saw it: the most common first.
  const why = Object.entries(week.reduce<Record<string, number>>((t, d) => addCounts(t, d.coldWhy) ?? t, {}))
    .sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`)
  const coldWhy = why.length ? `<p class="muted">${esc(`Why caches went cold this week: ${why.join(' · ')}.`)}</p>` : ''
  return `<p class="strong">${esc(totals)}</p>${coldWhy}${bars(days)}<p class="muted">Cost per day at API prices, oldest on the left. Only sessions g-line ran in are counted.</p>`
    + `<div class="scroll"><table><thead><tr><th>Day</th><th class="num">Turns</th><th class="num">Cost</th><th class="num">Cold rebuilds</th>`
    + `<th class="num">Keep-warm re-reads</th><th class="num">Re-read cost</th><th class="num">Tool calls</th><th class="num">Agents</th></tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table></div>`
}

function cacheSection(s: DashboardSnapshot): string {
  const seg = cacheNext(s.payload, s.nowSeconds)
  const model = s.payload.model?.display_name
  const ctx = s.payload.context_window?.used_percentage
  const facts = [model ? `Model ${modelName(model)}` : '', typeof ctx === 'number' ? `context ${pct(ctx)} used` : ''].filter(Boolean).join(', ')
  if (!seg) return `<p class="muted">No prompt cache observed in this session yet.</p>${facts ? `<p class="muted">${esc(facts)}.</p>` : ''}`
  const text = seg.forms[0] ?? ''
  return `<p class="strong ${seg.tone === 'warn' ? 'warn-text' : ''}">${esc(text)}</p>`
    + `<p class="muted">An estimate (the ~): from when the last request ran and the cache's lifetime, not the provider's own expiry.${facts ? ` ${esc(facts)}.` : ''}</p>`
}

function guardSection(g: DashboardGuard): string {
  if (!g.rules.length && !g.keepWarm) return '<p class="muted">No guard rules.</p>'
  const parts: string[] = []
  if (g.simulated) parts.push('<p class="warn-text strong">Simulated readings: these are not the real figures.</p>')
  if (!g.on) parts.push('<p class="muted">The guard is off.</p>')
  if (g.rules.length) {
    parts.push(`<ul class="rows">${g.rules.map(r => `<li class="${r.inForce ? 'warn' : ''}">${esc(r.inForce ? 'In force: ' : 'Not in force: ')}${esc(r.text)}</li>`).join('')}</ul>`)
    parts.push(`<h3>What is in force now</h3><ul class="plain">${g.why.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`)
  }
  if (g.keepWarm) parts.push(`<p class="muted">${esc(g.keepWarm)}</p>`)
  for (const error of g.errors) parts.push(`<p class="warn-text">${esc(`Not read: ${error}`)}</p>`)
  return parts.join('')
}

const CSS = `
:root{--bg:#faf8f5;--fg:#1f1d1a;--muted:#6b665e;--card:#fff;--line:#e4dfd7;--accent:#c4602d;--ok:#2f7d4a;--warn:#a86a00;--bad:#b3261e;color-scheme:light dark}
@media (prefers-color-scheme: dark){:root{--bg:#161513;--fg:#ece8e1;--muted:#a09a90;--card:#201e1b;--line:#37342f;--accent:#e08a5c;--ok:#6fcf8e;--warn:#e3b04b;--bad:#ff8a80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1.1rem;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:.95rem;margin:16px 0 4px}
p{margin:6px 0}
.muted{color:var(--muted);font-size:.9rem}
.strong{font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.card{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.card .big{font-size:1.8rem;font-weight:700;min-width:3.4ch;color:var(--ok)}
.card.warn .big{color:var(--warn)}.card.bad .big{color:var(--bad)}
.card>div:last-child{flex:1;min-width:0}
.meter{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin:6px 0}
.meter span{display:block;height:100%;background:var(--ok)}.card.warn .meter span{background:var(--warn)}.card.bad .meter span{background:var(--bad)}
.rows{list-style:none;margin:0;padding:0}
.rows li{background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:8px 12px;margin:6px 0;overflow-wrap:anywhere}
.rows li.ok{border-left-color:var(--ok)}.rows li.warn{border-left-color:var(--warn)}
.plain{margin:4px 0;padding-left:20px}
.warn-text{color:var(--warn)}
.chart{width:100%;max-width:700px;height:auto;display:block;margin:12px 0 4px}
.bar{fill:var(--accent)}
.tick{fill:var(--muted);font-size:9px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th.num,td.num{text-align:right}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}
`

/** The whole page. Pure: the same snapshot gives the same text. */
export function dashboardHtml(s: DashboardSnapshot): string {
  const at = new Date((s.nowSeconds + s.utcOffsetMinutes * 60) * 1000).toISOString()
  const made = `${at.slice(0, 10)} ${at.slice(11, 16)} (${utcLabel(s.utcOffsetMinutes)})`
  const version = s.version ? `g-line ${s.version}` : 'g-line (version unknown)'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>g-line dashboard</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>g-line dashboard</h1>
<p class="muted">What g-line held when you asked. It does not update by itself.</p>
<h2>Usage windows</h2>
${windowsSection(s)}
<h2>Sessions on this machine</h2>
${sessionsSection(s)}
<h2>History, last 14 days</h2>
${historySection(s)}
<h2>This session's cache</h2>
${cacheSection(s)}
<h2>Guard</h2>
${guardSection(s.guard)}
<footer class="muted">
<p>${esc(`Generated ${made} by ${version}.`)}</p>
<p>A snapshot: run /g-line dashboard again to refresh.</p>
</footer>
</main>
</body>
</html>
`
}
