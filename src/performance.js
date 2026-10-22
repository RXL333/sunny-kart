// Time based hysteresis keeps short loading spikes from changing quality and
// prevents automatic resolution from oscillating near the frame budget.
export class AdaptiveQuality {
  constructor() { this.reset(); }
  reset() { this.level=0; this.averageMs=16.67; this.observed=0; this.slow=0; this.fast=0; }
  sample(seconds) {
    if (!Number.isFinite(seconds)||seconds<=0||seconds>2) return false;
    this.observed+=seconds;
    this.averageMs+=(seconds*1000-this.averageMs)*Math.min(1,seconds*3);
    if(this.observed<1) return false;
    this.slow=this.averageMs>24?this.slow+seconds:0;
    this.fast=this.averageMs<18?this.fast+seconds:0;
    if(this.slow>=2&&this.level<2){this.level++;this.slow=0;this.fast=0;return true;}
    if(this.fast>=7&&this.level>0){this.level--;this.slow=0;this.fast=0;return true;}
    return false;
  }
  get particleLimit() { return [112,64,32][this.level]; }
}
