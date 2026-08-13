import type { Shape3 } from './logical_volume'
import type { PrototypeFovBounds } from './adaptive_streaming_fov_prototype'

export interface RenewableReadSession {
  renew(): void
}

export interface RefocusableStainVolume {
  setMaxDetail(levelIndex: number): void
  setFocus(focus: Shape3, bounds?: PrototypeFovBounds[]): void
}

export interface StainRefocusRequest {
  readSession: RenewableReadSession
  controller: RefocusableStainVolume
  targetLevel: number
  focus: Shape3
  bounds: PrototypeFovBounds[]
}

/**
 * Cancel every obsolete read before scheduling any replacement plan. NiiVue
 * debounces these controller calls, so a newer layout/zoom can replace the
 * pending plan before it reaches the renderer.
 */
export function refocusLoadedStainVolumes(
  requests: readonly StainRefocusRequest[],
): void {
  for (const request of requests) request.readSession.renew()
  for (const request of requests) {
    request.controller.setMaxDetail(request.targetLevel)
    request.controller.setFocus(request.focus, request.bounds)
  }
}
