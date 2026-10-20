const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
export function drivingInput(keys,touch={},autoThrottle=false) {
  const left=keys.has('KeyA')||keys.has('ArrowLeft'),right=keys.has('KeyD')||keys.has('ArrowRight');
  // Karts face +Z and the chase camera looks forward from -Z. Positive world
  // yaw projects left on screen, so convert human right-positive controls once.
  const steer=clamp(Number(left)-Number(right)-(Number(touch.steer)||0),-1,1);
  return {
    throttle:keys.has('KeyW')||keys.has('ArrowUp')||touch.throttle||autoThrottle?1:0,
    brake:keys.has('KeyS')||keys.has('ArrowDown')||touch.brake?1:0,
    steer,
    drift:keys.has('ShiftLeft')||keys.has('ShiftRight')||Boolean(touch.drift),
    nitro:keys.has('Space')||keys.has('KeyN')||Boolean(touch.nitro),
  };
}
