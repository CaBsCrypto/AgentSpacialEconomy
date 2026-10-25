/** Actual restart click handler. Resetting never invents a rendering capability. */
export function bindEntranceReset(button, context) {
 const reset = () => {
  const layout = context.getLayout();
  if (!layout?.spawn) return false;
  context.clearInput();
  context.closeHelp();
  const ready = context.isWalkReady();
  const pose = {...layout.spawn, pitch: layout.spawn.pitch ?? 0, mode: ready ? 'walk' : 'plan'};
  context.setPose(pose);
  if (ready) context.resetOrbit();
  context.setMode(pose.mode);
  context.announce(ready ? 'Inicio del recorrido · listo para comenzar de nuevo' : 'Inicio seleccionado en el plano · 3D no disponible');
  button.focus?.({preventScroll:true});
  return true;
 };
 button.addEventListener('click', reset);
 return {reset, dispose:()=>button.removeEventListener('click',reset)};
}
