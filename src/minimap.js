// The road is static; only the small racer markers need refreshing at 12 Hz.
export class Minimap {
  constructor(canvas, { createCanvas = () => document.createElement('canvas') } = {}) {
    this.canvas = canvas;
    this.createCanvas = createCanvas;
    this.track = null;
    this.lastDraw = -Infinity;
  }
  update(track, race, now) {
    if (!this.canvas) return;
    const changed = this.track !== track || this.width !== this.canvas.width || this.height !== this.canvas.height;
    if (!changed && now - this.lastDraw < 1000 / 12) return;
    const canvas = this.canvas, ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (changed) {
      this.track = track; this.width = canvas.width; this.height = canvas.height;
      this.background = this.createCanvas(); this.background.width = canvas.width; this.background.height = canvas.height;
      const bg = this.background.getContext('2d');
      const bounds = track.bounds ?? { centerX: 0, centerZ: 0, width: 220, depth: 185 };
      const scale = Math.min((canvas.width - 28) / bounds.width, (canvas.height - 24) / bounds.depth);
      this.sx = x => canvas.width / 2 + (x - bounds.centerX) * scale;
      this.sz = z => canvas.height / 2 + (z - bounds.centerZ) * scale;
      bg.lineCap = 'round'; bg.lineJoin = 'round'; bg.beginPath();
      track.points.forEach((p, i) => i ? bg.lineTo(this.sx(p.x), this.sz(p.z)) : bg.moveTo(this.sx(p.x), this.sz(p.z)));
      bg.closePath(); bg.strokeStyle = 'rgba(18,60,72,.13)'; bg.lineWidth = 13; bg.stroke(); bg.strokeStyle = '#fff8de'; bg.lineWidth = 7; bg.stroke();
    }
    this.lastDraw = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(this.background, 0, 0);
    const draw = (r, self) => {
      const p = track.sample(r.distance); ctx.beginPath(); ctx.arc(this.sx(p.x), this.sz(p.z), self ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = self ? '#f4a746' : r.color ?? '#53a99e'; ctx.fill();
      if (self) { ctx.strokeStyle = '#153e49'; ctx.lineWidth = 2; ctx.stroke(); }
    };
    for (const racer of race.racers) if (racer.id !== race.player.id) draw(racer, false);
    draw(race.player, true);
  }
}
