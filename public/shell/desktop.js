// Window manager for the retro desktop shell. No framework.
// Markup contract: .win elements (data-title, data-path, data-x/y/w/h) inside #desktop,
// [data-open="id"] buttons open window #win-id, [data-icon="name"] spans get a pixel icon.
const ICONS = {
  folder: '<path d="M3 8h9l3 3h14v16H3z"/><path d="M3 13h26"/>',
  document: '<path d="M7 3h14l5 5v21H7z"/><path d="M21 3v5h5M11 14h10M11 18h10M11 22h7"/>',
  briefcase: '<path d="M3 10h26v17H3z"/><path d="M11 10V5h10v5M3 17h26M14 16v4h4v-4"/>',
  journal: '<path d="M6 3h20v26H6z"/><path d="M10 3v26M14 9h8M14 13h8M14 17h5"/>',
  envelope: '<path d="M3 7h26v18H3z"/><path d="M3 7l13 11L29 7"/>',
  floppy: '<path d="M4 4h20l4 4v20H4z"/><path d="M9 4v8h13V4M9 28v-9h14v9M18 6v4"/>',
  shield: '<path d="M16 3l10 4v8c0 7-4 11-10 14C10 26 6 22 6 15V7z"/><path d="M11 15l4 4 7-8"/>',
};
const svg = (name) => `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', svg(el.dataset.icon)); });

const STAGE_W = 1060;
const STAGE_H = 840;
const desktop = document.getElementById('desktop');
const tasks = document.querySelector('.tasks');
const wins = new Map();
let z = 10;
let active = null;

function fit() {
  const small = matchMedia('(max-width: 719px)').matches;
  const s = small ? 1 : Math.min(innerWidth / (STAGE_W + 40), innerHeight / (STAGE_H + 30), 1.25);
  document.documentElement.style.setProperty('--scale', String(s));
}
addEventListener('resize', fit);
fit();

function focus(id) {
  active = id;
  for (const [k, w] of wins) {
    w.el.classList.toggle('active', k === id);
    w.task?.classList.toggle('active', k === id);
  }
  const w = wins.get(id);
  if (w) w.el.style.zIndex = String(++z);
}

function build(el) {
  const id = el.id.replace(/^win-/, '');
  el.hidden = !el.hasAttribute("data-default-open");
  const title = el.dataset.title ?? id;
  const body = document.createElement('div');
  body.className = 'win-body';
  while (el.firstChild) body.appendChild(el.firstChild);
  const bar = document.createElement('div');
  bar.className = 'win-bar';
  bar.innerHTML = `<span class="win-title">${title}</span>
    <button type="button" class="win-btn" data-act="max" aria-label="Maximize ${title}">□</button>
    <button type="button" class="win-btn" data-act="close" aria-label="Close ${title}">×</button>`;
  const crumb = document.createElement('div');
  crumb.className = 'win-crumb';
  crumb.innerHTML = `Desktop / <b>${el.dataset.path ?? title}</b>`;
  el.append(bar, crumb, body);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', title);
  Object.assign(el.style, { left: `${el.dataset.x ?? 120}px`, top: `${el.dataset.y ?? 24}px`, width: `${el.dataset.w ?? 560}px`, height: `${el.dataset.h ?? 420}px` });

  const task = document.createElement('button');
  task.type = 'button';
  task.className = 'task';
  task.textContent = title;
  task.hidden = true;
  task.addEventListener('click', () => (active === id && !el.hidden ? close(id) : open(id)));
  tasks.appendChild(task);
  wins.set(id, { el, task });

  el.addEventListener('pointerdown', () => focus(id));
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close(id);
    if (act === 'max') el.classList.toggle('max');
  });
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-act]')) el.classList.toggle('max'); });
  // drag by the title bar (pointer events, so touch works too); stage scale is accounted for
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-act]') || el.classList.contains('max') || matchMedia('(max-width: 719px)').matches) return;
    const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const maxX = desktop.clientWidth - 80, maxY = desktop.clientHeight - 30;
      el.style.left = `${Math.min(Math.max(ox + (ev.clientX - sx) / s, -el.offsetWidth + 80), maxX)}px`;
      el.style.top = `${Math.min(Math.max(oy + (ev.clientY - sy) / s, 0), maxY)}px`;
    };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(id); });
}

export function open(id) {
  const w = wins.get(id);
  if (!w) return;
  w.el.hidden = false;
  w.task.hidden = false;
  focus(id);
}
export function close(id) {
  const w = wins.get(id);
  if (!w) return;
  w.el.hidden = true;
  w.task.hidden = true;
  w.task.classList.remove('active');
  if (active === id) {
    active = null;
    const next = [...wins.entries()].filter(([, x]) => !x.el.hidden).sort((a, b) => Number(b[1].el.style.zIndex) - Number(a[1].el.style.zIndex))[0];
    if (next) focus(next[0]);
  }
}

desktop.querySelectorAll('.win').forEach(build);
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
document.querySelectorAll('.win[data-default-open]').forEach((el) => open(el.id.replace(/^win-/, '')));

const clock = document.getElementById('clock');
const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
tick();
setInterval(tick, 15000);

window.desk = { open, close };
