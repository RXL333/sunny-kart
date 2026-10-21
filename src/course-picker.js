import { TRACK_CATALOG, DEFAULT_TRACK_ID, createTrack } from './game/track.js';

const previewCache = new Map();
function routePreview(id) {
  if (previewCache.has(id)) return previewCache.get(id);
  const track = createTrack(id), b = track.bounds;
  const scale = Math.min(206 / b.width, 116 / b.depth);
  const points = track.points.filter((_, i) => i % 10 === 0).map(p => `${(120 + (p.x - b.centerX) * scale).toFixed(1)},${(72 + (p.z - b.centerZ) * scale).toFixed(1)}`).join(' ');
  const svg = `<svg viewBox="0 0 240 144" aria-hidden="true"><path class="preview-island" d="M18 79C4 18 66 1 119 16S236 11 226 74 168 142 108 130 29 141 18 79Z"/><polyline class="preview-shadow" points="${points}"/><polyline class="preview-road" points="${points}"/><circle cx="${(120 + (track.points[0].x-b.centerX)*scale).toFixed(1)}" cy="${(72+(track.points[0].z-b.centerZ)*scale).toFixed(1)}" r="4" class="preview-start"/></svg>`;
  previewCache.set(id, svg);
  return svg;
}

export class CoursePicker {
  constructor(root, { onSelect } = {}) {
    this.root = root; this.onSelect = onSelect; this.selected = DEFAULT_TRACK_ID;
    this.button = root.ownerDocument.createElement('button');
    this.button.type = 'button'; this.button.className = 'course-picker-button';
    this.button.innerHTML = '<span class="course-choice-icon" aria-hidden="true">⚑</span><span><small>这次，去哪里？</small><strong class="chosen-course-name"></strong></span><span class="course-choice-arrow">换条赛道 ↗</span>';
    this.button.setAttribute('aria-haspopup', 'dialog');
    root.querySelector('.difficulty-row').before(this.button);
    this.overlay = root.ownerDocument.createElement('section');
    this.overlay.className = 'overlay courses-overlay'; this.overlay.hidden = true;
    this.overlay.innerHTML = `<div class="dialog courses-dialog" role="dialog" aria-modal="true" aria-labelledby="courses-title"><button class="close-button courses-close" type="button" aria-label="关闭赛道选择">×</button><span class="dialog-eyebrow">A NEW ROAD, A NEW ADVENTURE</span><h2 id="courses-title">下一站，快乐。</h2><p>四条路线，四种好心情。选一条去追风。</p><div class="course-cards">${TRACK_CATALOG.map((course, i) => `<button type="button" class="course-card" data-course="${course.id}" aria-pressed="false" style="--course-color:${course.color || '#80c9b4'}"><div class="course-preview"><span class="course-index">0${i+1}</span>${routePreview(course.id)}<span class="course-tag">${course.difficulty}</span></div><div class="course-card-copy"><small>${course.english || course.subtitle}</small><strong>${course.name}<span class="course-check" aria-hidden="true">✓</span></strong><p>${course.description}</p><span class="course-feature">${course.feature || course.subtitle}</span></div></button>`).join('')}</div><div class="courses-footnote">单人自由选择 · 好友房间使用房主选中的赛道</div></div>`;
    root.append(this.overlay);
    this.button.addEventListener('click', () => this.open());
    this.closeButton = this.overlay.querySelector('.courses-close');
    this.closeButton.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', event => { if (event.target === this.overlay) this.close(); });
    this.overlay.querySelectorAll('[data-course]').forEach(button => button.addEventListener('click', () => {
      if (this.busy) return;
      this.close(); this.onSelect?.(button.dataset.course);
    }));
    this.overlay.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key !== 'Tab') return;
      const targets = [...this.overlay.querySelectorAll('button:not(:disabled)')], first = targets[0], last = targets.at(-1);
      if (event.shiftKey && root.ownerDocument.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && root.ownerDocument.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    this.setSelected(DEFAULT_TRACK_ID);
  }
  setSelected(id) {
    const course = TRACK_CATALOG.find(course => course.id === id) || TRACK_CATALOG[0];
    this.selected = course.id;
    this.button.querySelector('.chosen-course-name').textContent = course.name;
    this.button.style.setProperty('--course-color', course.color || '#80c9b4');
    this.overlay.querySelectorAll('[data-course]').forEach(button => {
      const selected = button.dataset.course === course.id;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  setBusy(busy) { this.busy = busy; this.button.disabled = busy; }
  open() {
    if (this.busy || this.root.classList.contains('in-race')) return;
    this.overlay.hidden = false;
    (this.overlay.querySelector('[aria-pressed="true"]') || this.closeButton).focus();
  }
  close() { this.overlay.hidden = true; if (this.button.isConnected) this.button.focus(); }
}
