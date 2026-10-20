export function collisionProfile(impact=1) {
  const severity=Math.min(1,Math.max(0,((Number(impact)||1)-.7)/11));
  return {duration:.065+severity*.055,noiseGain:.055+severity*.085,bodyGain:.07+severity*.07,frequency:100+severity*35,cutoff:480+severity*700,cooldown:.22+severity*.08};
}
export class CollisionLimiter {
  constructor(){this.lastTime=-Infinity;}
  take(time,impact){const profile=collisionProfile(impact);if(time-this.lastTime<profile.cooldown)return null;this.lastTime=time;return profile;}
}
