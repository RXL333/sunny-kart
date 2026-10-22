// One entry per asset base URL, retained for this page's lifetime. Multiple
// scenes share immutable model geometries; disposing a scene must not free them.
export class ModelCache {
  constructor(load) { this.load=load; this.entries=new Map(); this.loads=0; }
  get(key) {
    if(!this.entries.has(key)){
      this.loads++;
      const promise=Promise.resolve().then(()=>this.load(key)).catch(error=>{this.entries.delete(key);throw error;});
      this.entries.set(key,promise);
    }
    return this.entries.get(key);
  }
}
