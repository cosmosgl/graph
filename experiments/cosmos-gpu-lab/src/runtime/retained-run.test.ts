import { afterEach, expect, it, vi } from 'vitest'
import { createRetainedRun } from './retained-run'
import type { ExperimentDefinition, ExperimentInstance } from './experiment'

const hosts: HTMLElement[] = []
function parent (): HTMLElement { const element = document.createElement('div'); document.body.append(element); hosts.push(element); return element }
function definition (id: string, create: ExperimentDefinition['create']): ExperimentDefinition {
  return { id, create, title: id, summary: '', tags: [], pages: [] }
}
afterEach(() => { hosts.splice(0).forEach(host => host.remove()) })

it('retains the same controls, canvas and state across documentation, with one owned run', async () => {
  const run = createRetainedRun(); const first = parent(); const second = parent(); const pause = vi.fn(); const destroy = vi.fn()
  const create = vi.fn(async (host: HTMLElement): Promise<ExperimentInstance> => {
    host.innerHTML = '<canvas></canvas><input value="initial">'; return { pause, destroy }
  })
  await run.show(definition('one', create), first)
  const input = first.querySelector('input')!; const canvas = first.querySelector('canvas')!
  input.value = 'tick 17, changed settings'; run.hide()
  expect(pause).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled(); expect(canvas.isConnected).toBe(false)
  await run.show(definition('one', create), second)
  expect(create).toHaveBeenCalledTimes(1); expect(second.querySelector('input')).toBe(input)
  expect(input.value).toBe('tick 17, changed settings'); expect(second.querySelector('canvas')).toBe(canvas)
  const nextDestroy = vi.fn()
  await run.show(definition('two', async (): Promise<ExperimentInstance> => ({ destroy: nextDestroy })), first)
  expect(destroy).toHaveBeenCalledTimes(1); expect(run.id).toBe('two')
  run.destroy(); run.destroy(); expect(nextDestroy).toHaveBeenCalledTimes(1)
})

it('does not recreate a loading run and pauses it if documentation wins the setup race', async () => {
  const run = createRetainedRun(); let finish!: (instance: ExperimentInstance) => void
  const create = vi.fn(() => new Promise<ExperimentInstance>(resolve => { finish = resolve }))
  const pending = run.show(definition('one', create), parent()); await Promise.resolve()
  run.hide(); const pause = vi.fn(); const destroy = vi.fn(); finish({ pause, destroy }); await pending
  expect(pause).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled()
  await run.show(definition('one', create), parent()); expect(create).toHaveBeenCalledTimes(1)
  run.destroy(); expect(destroy).toHaveBeenCalledTimes(1)
})

it('retires late setup results without replacing the newer run, and permits retry after failure', async () => {
  const run = createRetainedRun(); let finish!: (instance: ExperimentInstance) => void
  const pending = run.show(definition('old', () => new Promise(resolve => { finish = resolve })), parent()); await Promise.resolve()
  const next = parent(); const destroy = vi.fn()
  await run.show(definition('new', async (): Promise<ExperimentInstance> => ({ destroy })), next)
  const oldDestroy = vi.fn(); finish({ destroy: oldDestroy }); await pending
  expect(oldDestroy).toHaveBeenCalledTimes(1); expect(run.id).toBe('new'); expect(destroy).not.toHaveBeenCalled()
  run.destroy()
  await expect(run.show(definition('retry', async () => { throw new Error('setup failed') }), next)).rejects.toThrow('setup failed')
  expect(run.id).toBeUndefined()
  await run.show(definition('retry', async (): Promise<ExperimentInstance> => ({ destroy })), next)
  run.destroy(); expect(destroy).toHaveBeenCalledTimes(2)
})
