import { useSyncExternalStore } from 'react'
import { universeRepository } from './UniverseRepository'

export function useUniverse() {
  return useSyncExternalStore(
    universeRepository.subscribe,
    universeRepository.getSnapshot,
    universeRepository.getSnapshot,
  )
}
