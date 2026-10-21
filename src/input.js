import { DEFAULT_KEY_BINDINGS, isActionPressed } from './keyboard-bindings.js';

const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
export function drivingInput(keys,touch={},autoThrottle=false,{sensitivity=1,blocked=false,bindings=DEFAULT_KEY_BINDINGS}={}) {
  if(blocked)return {throttle:0,brake:1,steer:0,drift:false,nitro:false};
  const pressed=action=>isActionPressed(keys,bindings,action);
  const left=pressed('left'),right=pressed('right');
  // Karts face +Z and the chase camera looks forward from -Z. Positive world
  // yaw projects left on screen, so convert human right-positive controls once.
  const strength=Number.isFinite(sensitivity)?clamp(sensitivity,.35,1):1;
  const steer=clamp(Number(left)-Number(right)-(Number(touch.steer)||0),-1,1)*strength;
  return {
    throttle:pressed('throttle')||touch.throttle||autoThrottle?1:0,
    brake:pressed('brake')||touch.brake?1:0,
    steer,
    drift:pressed('drift')||Boolean(touch.drift),
    nitro:pressed('nitro')||Boolean(touch.nitro),
  };
}
