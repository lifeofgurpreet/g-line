// glanceline is now g-line. This stub keeps a 0.3/0.4 install loading after the
// rename, and says once per session how to switch. It draws nothing else and
// makes no network request.
import type { EngineInterface, Register } from 'claude-code'

const SWITCH = 'glanceline is now g-line. To switch: /plugin uninstall glanceline, then /plugin install g-line --marketplace lifeofgurpreet/g-line'

async function say($: EngineInterface): Promise<void> {
  $.ui.toast(SWITCH, { timeoutMs: 20_000 })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await say($)
    try {
      await $.command.register({ name: 'glanceline', description: 'glanceline is now g-line: how to switch' })
    } catch {
      // the toast says it
    }
    return next(e)
  })
  on('command.run', { command: 'glanceline' }, async ($) => {
    await say($)
    return {}
  })
}
