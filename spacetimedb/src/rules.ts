// FIXTURE until TL-03 merges. Same signature and formula as C's readyAt on
// c/tl-03-dispatch-rules (spacetimedb/src/domain/dispatch.ts @ 1643c69).
// After the merge, replace this file's body with:
//   export { readyAt, type DispatchOption } from './domain/dispatch';
// Times are epoch milliseconds.

const MIN = 60_000;

export interface DispatchOption {
  routeId: string;
  driverId: string;
  assetId: string;
  assetKind: string;
  driverFreeAt: number;
  assetFreeAt: number;
  driverToAssetMin: number;
  pickupMin: number;
  assetToHomeMin: number;
  setupMin: number;
  confirmedDelayMin: number;
}

export function readyAt(option: DispatchOption, now: number): number {
  const atAsset = Math.max(now, option.driverFreeAt) + option.driverToAssetMin * MIN;
  const depart = Math.max(atAsset, option.assetFreeAt) + option.pickupMin * MIN;
  return depart + (option.assetToHomeMin + option.confirmedDelayMin + option.setupMin) * MIN;
}
