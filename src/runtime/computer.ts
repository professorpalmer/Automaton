import { join } from 'node:path'
import { automatonHome } from './keys'

/** One shared Automaton computer. Mouths are users of this machine, not VMs. */
export function computerRoot(home = automatonHome()): string {
  return home
}

export function desktopsRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'desktops')
}

export function configsDir(home = automatonHome()): string {
  return join(computerRoot(home), 'configs')
}

export function sandboxesDir(home = automatonHome()): string {
  return join(computerRoot(home), 'sandboxes')
}

export function inboxRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'inbox')
}

export function skillsRoot(home = automatonHome()): string {
  return join(computerRoot(home), 'skills')
}

export function connectorsPath(home = automatonHome()): string {
  return join(computerRoot(home), 'connectors.json')
}
