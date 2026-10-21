import { expect, test } from 'claude-code/testing'

import {
  DEFAULTS, SETTINGS, changed, findSetting, merge, nextValue, originOf, parseCommand, patchOf, said, shown, withPatch,
  withoutSetting,
} from '../hooks/settings'
import type { Setting } from '../hooks/settings'

const named = (key: string): Setting => {
  const setting = findSetting(key)
  if (!setting) throw new Error(`no setting ${key}`)
  return setting
}

test('every setting has a unique key, alias and pane hotkey', () => {
  const keys = SETTINGS.map(s => s.key)
  expect(new Set(keys).size).toBe(keys.length)
  const hotkeys = SETTINGS.map(s => s.hotkey)
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
  // The settings view's own buttons: back to details and clearing choices.
  expect(hotkeys.filter(h => h === 'd' || h === 'z')).toEqual([])
  for (const h of hotkeys) expect(h).toMatch(/^[a-z]$/)
  const names = SETTINGS.flatMap(s => [s.key, ...s.aliases])
  expect(new Set(names).size).toBe(names.length)
})

test('each toggle set on and off through a layer reads back, and only that setting moves', () => {
  for (const setting of SETTINGS) {
    if (setting.kind !== 'toggle') continue
    for (const value of [true, false]) {
      const after = merge(DEFAULTS, patchOf(setting, value))
      expect(setting.get(after)).toBe(value)
      for (const other of SETTINGS) {
        if (other !== setting) expect(shown(other, after)).toBe(shown(other, DEFAULTS))
      }
    }
  }
})

test('each choice set through a layer reads back', () => {
  for (const setting of SETTINGS) {
    if (setting.kind !== 'choice') continue
    for (const option of setting.options) expect(shown(setting, merge(DEFAULTS, patchOf(setting, option)))).toBe(option)
  }
  expect(said(named('lines'), DEFAULTS)).toBe('two lines')
  expect(said(named('lines'), merge(DEFAULTS, { lines: 'receipts' }))).toBe('receipts only')
  expect(shown(named('receipt'), merge(DEFAULTS, { receipt: 'cost,tools' }))).toBe('custom')
})

test('merge reads every config.json key, and ignores malformed values', () => {
  const c = merge(DEFAULTS, {
    lines: 1, pulse: true, git: true, short_hints: false, preset: 'full', icons: 'nerd', toasts: false, cache_ttl: '5m',
    account_command: ['echo', 'x'], notify: { cache: false, reset: false, long_turn: true, agents: true },
    long_turn_seconds: 90, reset_threshold: 50, receipt: 'short', spinner: false, footer_labels: false, coach: true,
    claude_reads: true, tool_streak: 5, today_budget: 20, export_state: true, pulse_speed: 'paused', pulse_mute: [' 𝕏 ', 3, ''],
  })
  expect(c).toEqual({
    lines: 1, pulse: true, git: true, shortHints: false, preset: 'full', icons: 'nerd', toasts: false, cacheTtl: '5m',
    accountCommand: ['echo', 'x'], notify: { cache: false, reset: false, longTurn: true, agents: true },
    longTurnSeconds: 90, resetThreshold: 50, receipt: ['cost', 'cache', 'tools'], spinner: false, footerLabels: false,
    coach: true, claudeReads: true, toolStreak: 5, budget: 20, exportState: true, pulseSpeed: 'paused', pulseMute: ['𝕏'], guard: { on: true, rules: [], errors: [] },
  })
  expect(merge(DEFAULTS, { pulse: 'yes', lines: 7, notify: 'loud', reset_threshold: 400, icons: 'emoji' })).toEqual(DEFAULTS)
  expect(merge(DEFAULTS, { notify: false }).notify).toEqual({ cache: false, reset: false, longTurn: false, agents: false })
  expect(merge(DEFAULTS, { segments: 'model,context' }).lines).toBe(1)
  expect(merge(DEFAULTS, { receipt: false }).receipt).toEqual([])
})

test('a saved notification choice keeps the others, from an object or the 0.5 boolean', () => {
  expect(withPatch({ pulse: true, notify: { cache: false } }, patchOf(named('agents'), true)))
    .toEqual({ pulse: true, notify: { cache: false, agents: true } })
  const fromOff = withPatch({ notify: false }, patchOf(named('cache'), true))
  expect(merge(DEFAULTS, fromOff).notify).toEqual({ cache: true, reset: false, longTurn: false, agents: false })
  const fromOn = withPatch({ notify: true }, patchOf(named('long_turn'), true))
  expect(merge(DEFAULTS, fromOn).notify).toEqual({ cache: true, reset: true, longTurn: true, agents: false })
})

test('resetting one setting drops it from the saved layer and nothing else', () => {
  expect(withoutSetting({ pulse: true, git: true }, named('pulse'))).toEqual({ git: true })
  expect(withoutSetting({ notify: { cache: false, agents: true } }, named('cache'))).toEqual({ notify: { agents: true } })
  expect(withoutSetting({ notify: { cache: false } }, named('cache'))).toEqual({})
  expect(withoutSetting({ notify: false }, named('agents'))).toEqual({ notify: { cache: false, reset: false, long_turn: false } })
})

test('a value comes from the highest layer that names it', () => {
  const layers = [
    { name: 'plugin config.json', raw: undefined },
    { name: '~/.config/g-line/config.json', raw: { pulse: true, notify: { cache: false } } },
    { name: '/config', raw: { notify: false } },
    { name: '/g-line', raw: { git: true } },
  ]
  expect(originOf(named('pulse'), layers)).toBe('~/.config/g-line/config.json')
  expect(originOf(named('cache'), layers)).toBe('/config')
  expect(originOf(named('git'), layers)).toBe('/g-line')
  expect(originOf(named('coach'), layers)).toBe('default')
  expect(originOf(named('lines'), [{ name: 'f', raw: { segments: 'model' } }])).toBe('f')
  expect(changed(named('pulse'), merge(DEFAULTS, { pulse: true }))).toBe(true)
  expect(changed(named('pulse'), DEFAULTS)).toBe(false)
})

test('a press moves a toggle over and a choice to its next option, wrapping', () => {
  expect(nextValue(named('pulse'), DEFAULTS)).toBe(true)
  expect(nextValue(named('lines'), DEFAULTS)).toBe('1')
  expect(nextValue(named('lines'), merge(DEFAULTS, { lines: 'receipts' }))).toBe('2')
  expect(nextValue(named('receipt'), merge(DEFAULTS, { receipt: 'off' }))).toBe('adaptive')
})

test('/g-line arguments: the pane, settings, set, toggle, reset, all, and the 0.5 spellings', () => {
  expect(parseCommand('')).toEqual({ kind: 'pane' })
  expect(parseCommand('card')).toEqual({ kind: 'card' })
  expect(parseCommand('settings')).toEqual({ kind: 'settings' })
  expect(parseCommand(' OFF ')).toEqual({ kind: 'hide' })
  expect(parseCommand('on')).toEqual({ kind: 'show' })
  expect(parseCommand('set pulse on')).toEqual({ kind: 'set', setting: named('pulse'), value: true })
  expect(parseCommand('set Claude-Reads yes')).toEqual({ kind: 'set', setting: named('claude_reads'), value: true })
  expect(parseCommand('set notify.long_turn off')).toEqual({ kind: 'set', setting: named('notify.long_turn'), value: false })
  expect(parseCommand('set cold cache off')).toEqual({ kind: 'set', setting: named('notify.cache'), value: false })
  expect(parseCommand('set layout one')).toEqual({ kind: 'set', setting: named('lines'), value: '1' })
  expect(parseCommand('set receipt full')).toEqual({ kind: 'set', setting: named('receipt'), value: 'full' })
  expect(parseCommand('toggle git')).toEqual({ kind: 'set', setting: named('git'), value: 'toggle' })
  expect(parseCommand('set spinner')).toEqual({ kind: 'set', setting: named('spinner'), value: 'toggle' })
  expect(parseCommand('pulse')).toEqual({ kind: 'set', setting: named('pulse'), value: 'toggle' })
  expect(parseCommand('pulse off')).toEqual({ kind: 'set', setting: named('pulse'), value: false })
  expect(parseCommand('set all on')).toEqual({ kind: 'all', value: true })
  expect(parseCommand('reset')).toEqual({ kind: 'reset' })
  expect(parseCommand('reset footer')).toEqual({ kind: 'reset', setting: named('footer_labels') })
  expect(parseCommand('set pulse maybe').kind).toBe('error')
  expect(parseCommand('set receipt huge').kind).toBe('error')
  expect(parseCommand('set warp on').kind).toBe('error')
  expect(parseCommand('set').kind).toBe('error')
  expect(parseCommand('reset warp').kind).toBe('error')
})

test('/g-line guard: status, once, pause with a time, resume, on and off; guard on/off keeps the rules the files wrote', () => {
  expect(parseCommand('guard')).toEqual({ kind: 'guard', action: 'status' })
  expect(parseCommand('guard once')).toEqual({ kind: 'guard', action: 'once' })
  expect(parseCommand('guard pause')).toEqual({ kind: 'guard', action: 'pause', seconds: 3600 })
  expect(parseCommand('guard pause 30m')).toEqual({ kind: 'guard', action: 'pause', seconds: 1800 })
  expect(parseCommand('guard pause forever').kind).toBe('error')
  expect(parseCommand('guard resume')).toEqual({ kind: 'guard', action: 'resume' })
  expect(parseCommand('guard off')).toEqual({ kind: 'guard', action: 'off' })
  expect(parseCommand('guard sideways').kind).toBe('error')
  const file = merge(DEFAULTS, { guard: { rules: [{ left: 10, stop: true }] } })
  const off = merge(file, { guard: false })
  expect([off.guard.on, off.guard.rules.length]).toEqual([false, 1])
  expect(merge(off, { guard: true }).guard.on).toBe(true)
  // `/g-line set all on` never turns a guard on: it isn't a toggle.
  expect(SETTINGS.some(s => s.key === 'guard')).toBe(false)
})
