import * as THREE from 'three';

// Fixed pools reuse geometry and materials throughout a race and track preview.
export class ItemObjectView {
  constructor(scene, track) {
    this.track = track;
    this.pool = [];
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const ring = new THREE.TorusGeometry(1, .08, 4, 16);
    const bubble = new THREE.MeshStandardMaterial({ color: 0x8bd9ff, roughness: .18, transparent: true, opacity: .75 });
    const jelly = new THREE.MeshStandardMaterial({ color: 0xb797ee, roughness: .35 });
    const light = new THREE.MeshBasicMaterial({ color: 0xfff9e6 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x354559 });
    for (let i = 0; i < 48; i++) {
      const root = new THREE.Group(), type = i < 24 ? 'bubble' : 'jelly';
      const body = new THREE.Mesh(sphere, type === 'bubble' ? bubble : jelly);
      body.scale.set(type === 'bubble' ? .95 : 1.4, type === 'bubble' ? .95 : .45, type === 'bubble' ? .95 : 1.1);
      root.add(body);
      if (type === 'bubble') {
        const hoop = new THREE.Mesh(ring, light);
        hoop.rotation.x = Math.PI / 3;
        root.add(hoop);
        const shine = new THREE.Mesh(sphere, light);
        shine.scale.set(.15, .28, .08); shine.position.set(-.4, .4, .75); root.add(shine);
      } else {
        for (const x of [-.4, .4]) {
          const eye = new THREE.Mesh(sphere, dark);
          eye.scale.set(.1, .13, .07); eye.position.set(x, .15, .92); root.add(eye);
        }
      }
      root.visible = false;
      scene.add(root);
      this.pool.push({ root, type, id: null, used: false });
    }
  }
  update(race, time, menu = false) {
    for (const entry of this.pool) entry.used = false;
    if (!menu && race.mode === 'items') for (const object of (race.itemObjects || [])) {
      let entry = this.pool.find(candidate => candidate.id === object.id && candidate.type === object.type);
      if (!entry) entry = this.pool.find(candidate => candidate.type === object.type && !candidate.used && candidate.id === null);
      if (!entry) continue;
      entry.used = true; entry.id = object.id;
      const p = this.track.sample(object.distance), root = entry.root;
      root.position.set(p.x + p.nx * object.offset, p.y + (object.type === 'bubble' ? 1.2 + Math.sin(time * 8) * .1 : .2), p.z + p.nz * object.offset);
      root.rotation.y = p.heading;
      root.scale.setScalar(object.type === 'jelly' ? 1 + Math.sin(time * 5) * .04 : 1);
      root.visible = object.life > .8 || Math.sin(time * 18) > -.4;
    }
    for (const entry of this.pool) if (!entry.used) { entry.root.visible = false; entry.id = null; }
  }
}
