import { shortenScene } from './short-corridor.mjs?v=1';
import { moveMerchBackdrop } from './merch-backdrop.mjs?v=1';

export const VENUE_PREPARATION_VERSION = 'short-corridor-merch-v1';

/** Prepare an independently parsed venue. No browser state or shared model cache. */
export function prepareVenueModel(scene, THREE) {
  const version = scene.userData.one16VenuePreparation;
  if (version === VENUE_PREPARATION_VERSION) return scene;
  if (version) throw new Error('The venue was already prepared with a different version');
  shortenScene(scene, THREE);
  moveMerchBackdrop(scene, THREE);
  scene.userData.one16VenuePreparation = VENUE_PREPARATION_VERSION;
  return scene;
}
