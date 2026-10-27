'use strict';

// ---------- ข้อมูลเกม (แก้ค่าบาลานซ์ได้ที่นี่) ----------
const DISHES = [
  { name: 'ไข่เจียว',          emoji: '🍳', unlock: 0,     baseCost: 5,     profit: 1,    cookTime: 2 },
  { name: 'ข้าวผัด',           emoji: '🍚', unlock: 60,    baseCost: 60,    profit: 6,    cookTime: 3 },
  { name: 'ก๋วยเตี๋ยว',        emoji: '🍜', unlock: 700,   baseCost: 700,   profit: 40,   cookTime: 4 },
  { name: 'ส้มตำ',             emoji: '🥗', unlock: 8e3,   baseCost: 8e3,   profit: 250,  cookTime: 5 },
  { name: 'ไก่ทอด',            emoji: '🍗', unlock: 9e4,   baseCost: 9e4,   profit: 1600, cookTime: 6 },
  { name: 'ชาไทย',             emoji: '🧋', unlock: 1e6,   baseCost: 1e6,   profit: 1e4,  cookTime: 7 },
  { name: 'ข้าวเหนียวมะม่วง',  emoji: '🥭', unlock: 1.2e7, baseCost: 1.2e7, profit: 7e4,  cookTime: 8 },
  { name: 'ต้มยำกุ้ง',         emoji: '🦐', unlock: 1.5e8, baseCost: 1.5e8, profit: 5e5,  cookTime: 10 },
];

const UPGRADES = [
  { id: 'ads',  icon: '📣', name: 'ป้ายโฆษณา',  desc: 'ลูกค้ามาถี่ขึ้น 15%',     baseCost: 50,  growth: 3, max: 10 },
  { id: 'chef', icon: '👨‍🍳', name: 'เชฟมือไว',   desc: 'ทำอาหารเร็วขึ้น 10%',     baseCost: 100, growth: 4, max: 10 },
  { id: 'tips', icon: '💵', name: 'กล่องทิป',    desc: 'รายได้ทุกเมนู x1.5',       baseCost: 500, growth: 6, max: 10 },
  { id: 'seat', icon: '🪑', name: 'เพิ่มที่นั่ง', desc: 'ลูกค้ารอต่อเมนูได้ +1 คน', baseCost: 200, growth: 8, max: 4 },
];

const COST_GROWTH = 1.13;          // ราคาอัปเกรดเพิ่มขึ้นต่อเลเวล
const MILESTONES = [10, 25, 50, 100, 200, 300, 400]; // ถึงเลเวลนี้ รายได้ x2
const MANAGER_COST_MULT = 15;      // ราคาผู้จัดการ = baseCost x ค่านี้
const BASE_ARRIVAL = 3;            // วินาทีต่อลูกค้า 1 คน
const BASE_QUEUE = 3;              // ลูกค้ารอต่อเมนู
const STAR_BONUS = 0.1;            // ดาวละ +10%
const PRESTIGE_REQ = 1e7;          // รายได้ขั้นต่ำก่อนเปิดสาขาใหม่
const OFFLINE_CAP = 2 * 3600;      // รายได้ออฟไลน์สูงสุด (วินาที)
const SAVE_KEY = 'idle-restaurant-save-v1';
const CUSTOMERS = ['🧑', '👩', '👨', '👧', '👦', '👵', '👴', '🧔', '👱‍♀️', '🧕'];

// ---------- สถานะ ----------
let state = newState(0, 0);
let buyMode = 0; // index ของ BUY_MODES
const BUY_MODES = [1, 10, 'MAX'];
let arrivalTimer = 0;

function newState(stars, branch) {
  return {
    money: 10,
    runEarned: 0,
    stars,
    branch,
    stations: DISHES.map((d, i) => ({ level: i === 0 ? 1 : 0, manager: false, queue: [], cooking: false, t: 0 })),
    upgrades: { ads: 0, chef: 0, tips: 0, seat: 0 },
    lastSeen: Date.now(),
  };
}

// ---------- สูตรคำนวณ ----------
const globalMult = () => Math.pow(1.5, state.upgrades.tips) * (1 + STAR_BONUS * state.stars);
const milestoneCount = (lv) => MILESTONES.filter((m) => lv >= m).length;
const nextMilestone = (lv) => MILESTONES.find((m) => lv < m);
const profitOf = (i) => DISHES[i].profit * state.stations[i].level * Math.pow(2, milestoneCount(state.stations[i].level)) * globalMult();
const cookTimeOf = (i) => DISHES[i].cookTime * Math.pow(0.9, state.upgrades.chef);
const arrivalInterval = () => BASE_ARRIVAL * Math.pow(0.85, state.upgrades.ads);
const queueCap = () => BASE_QUEUE + state.upgrades.seat;
const managerCost = (i) => DISHES[i].baseCost * MANAGER_COST_MULT;
const upgradeCost = (u) => u.baseCost * Math.pow(u.growth, state.upgrades[u.id]);
const unlockedCount = () => state.stations.filter((s) => s.level > 0).length;

// ราคาอัปเลเวล n ขั้นจากเลเวลปัจจุบัน (ผลรวมอนุกรมเรขาคณิต)
function levelCost(i, n) {
  const first = DISHES[i].baseCost * Math.pow(COST_GROWTH, state.stations[i].level - 1);
  return first * (Math.pow(COST_GROWTH, n) - 1) / (COST_GROWTH - 1);
}

function buyCount(i) {
  const mode = BUY_MODES[buyMode];
  if (mode !== 'MAX') return mode;
  const first = DISHES[i].baseCost * Math.pow(COST_GROWTH, state.stations[i].level - 1);
  const n = Math.floor(Math.log(state.money * (COST_GROWTH - 1) / first + 1) / Math.log(COST_GROWTH));
  return Math.max(1, n);
}

// รายได้อัตโนมัติต่อวินาที (เฉพาะเมนูที่มีผู้จัดการ) ใช้แสดงผลและคิดรายได้ออฟไลน์
function autoRate() {
  const n = unlockedCount();
  if (!n) return 0;
  const custPerStation = 1 / arrivalInterval() / n;
  let rate = 0;
  state.stations.forEach((s, i) => {
    if (s.level > 0 && s.manager) rate += Math.min(custPerStation, 1 / cookTimeOf(i)) * profitOf(i);
  });
  return rate;
}

const prestigeGain = () => (state.runEarned < PRESTIGE_REQ ? 0 : Math.floor(Math.sqrt(state.runEarned / 1e6)));

// ---------- แสดงตัวเลข ----------
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af'];
function fmt(n) {
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
  const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIX.length - 1);
  const v = n / Math.pow(1000, tier);
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v)) + SUFFIX[tier];
}

// ---------- การกระทำของผู้เล่น ----------
function earn(amount) {
  state.money += amount;
  state.runEarned += amount;
}

function startCook(i) {
  const s = state.stations[i];
  if (s.level === 0 || s.cooking || s.queue.length === 0) return false;
  s.cooking = true;
  s.t = 0;
  return true;
}

function tapStation(i) {
  if (!startCook(i) && state.stations[i].queue.length === 0) floatText(stationEls[i].dish, 'ยังไม่มีลูกค้า', true);
}

function buyLevel(i) {
  const s = state.stations[i];
  if (s.level === 0) {
    if (state.money < DISHES[i].unlock) return;
    state.money -= DISHES[i].unlock;
    s.level = 1;
    return;
  }
  const n = buyCount(i);
  const cost = levelCost(i, n);
  if (state.money < cost) return;
  state.money -= cost;
  s.level += n;
}

function buyManager(i) {
  const s = state.stations[i];
  if (s.manager || s.level === 0 || state.money < managerCost(i)) return;
  state.money -= managerCost(i);
  s.manager = true;
  startCook(i);
}

function buyUpgrade(u) {
  if (state.upgrades[u.id] >= u.max) return;
  const cost = upgradeCost(u);
  if (state.money < cost) return;
  state.money -= cost;
  state.upgrades[u.id]++;
}

function prestige() {
  const gain = prestigeGain();
  if (!gain) return;
  state = newState(state.stars + gain, state.branch + 1);
  save();
  showModal(`🎉 เปิดสาขาที่ ${state.branch + 1} แล้ว!<br>ได้รับ ${gain} ⭐ รวมเป็น ${state.stars} ⭐<br>(รายได้ +${Math.round(state.stars * STAR_BONUS * 100)}%)`);
}

// ---------- ลูปเกม ----------
function spawnCustomer() {
  const cap = queueCap();
  const open = state.stations.map((s, i) => i).filter((i) => state.stations[i].level > 0 && state.stations[i].queue.length < cap);
  if (!open.length) return;
  const i = open[Math.floor(Math.random() * open.length)];
  state.stations[i].queue.push(CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)]);
  if (state.stations[i].manager) startCook(i);
}

function update(dt) {
  arrivalTimer += dt;
  const interval = arrivalInterval();
  while (arrivalTimer >= interval) {
    arrivalTimer -= interval;
    spawnCustomer();
  }
  state.stations.forEach((s, i) => {
    if (!s.cooking) return;
    s.t += dt;
    if (s.t < cookTimeOf(i)) return;
    s.cooking = false;
    s.queue.shift();
    const p = profitOf(i);
    earn(p);
    floatText(stationEls[i].dish, '+' + fmt(p));
    if (s.manager) startCook(i);
  });
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const stationEls = [];
const upgradeEls = [];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function buildStations() {
  const root = $('stations');
  DISHES.forEach((d, i) => {
    const card = el('div', 'card station');
    const dish = el('div', 'dish', `${d.emoji}<span class="lv"></span>`);
    const info = el('div', 'info');
    const head = el('div', 'row', `<span class="name">${d.name}</span><span class="profit"></span>`);
    const queue = el('div', 'queue');
    const bar = el('div', 'bar', '<div></div>');
    const btns = el('div', 'btns');
    const up = el('button', 'btn');
    const mgr = el('button', 'btn alt');
    btns.append(up, mgr);
    info.append(head, queue, bar, btns);
    card.append(dish, info);
    root.append(card);

    dish.addEventListener('click', () => tapStation(i));
    up.addEventListener('click', () => { buyLevel(i); render(); });
    mgr.addEventListener('click', () => { buyManager(i); render(); });

    stationEls.push({
      card, dish, up, mgr, queue,
      lv: dish.querySelector('.lv'),
      profit: head.querySelector('.profit'),
      fill: bar.firstChild,
      queueKey: '',
    });
  });
}

function buildUpgrades() {
  const root = $('upgrades');
  UPGRADES.forEach((u) => {
    const card = el('div', 'card');
    const text = el('div', '', `<div class="name">${u.name} <span class="lvl"></span></div><div class="desc">${u.desc}</div>`);
    const btn = el('button', 'btn');
    card.append(el('div', 'icon', u.icon), text, btn);
    root.append(card);
    btn.addEventListener('click', () => { buyUpgrade(u); render(); });
    upgradeEls.push({ u, btn, lvl: text.querySelector('.lvl') });
  });
}

function render() {
  $('money').textContent = fmt(state.money);
  $('rate').textContent = fmt(autoRate());
  $('stars').textContent = state.stars;
  $('branch-name').textContent = `สาขา ${state.branch + 1}`;
  $('buy-mult').textContent = 'ซื้อ x' + BUY_MODES[buyMode];

  let shownLocked = false;
  state.stations.forEach((s, i) => {
    const e = stationEls[i];
    const d = DISHES[i];
    const locked = s.level === 0;
    // แสดงเมนูที่ล็อกอยู่แค่เมนูถัดไปเมนูเดียว
    e.card.style.display = locked && shownLocked ? 'none' : '';
    if (locked) shownLocked = true;
    e.card.classList.toggle('locked', locked);
    e.lv.textContent = locked ? '🔒' : 'Lv' + s.level;

    if (locked) {
      e.profit.textContent = '';
      e.up.innerHTML = `ปลดล็อก<small>💰 ${fmt(d.unlock)}</small>`;
      e.up.disabled = state.money < d.unlock;
      e.mgr.style.display = 'none';
      e.fill.style.width = '0';
      if (e.queueKey !== 'locked') { e.queue.innerHTML = ''; e.queueKey = 'locked'; }
      return;
    }

    const next = nextMilestone(s.level);
    e.profit.textContent = `💰${fmt(profitOf(i))} · ${cookTimeOf(i).toFixed(1)}วิ` + (next ? ` · x2 ที่ Lv${next}` : '');
    const n = buyCount(i);
    const cost = levelCost(i, n);
    e.up.innerHTML = `อัป +${n}<small>💰 ${fmt(cost)}</small>`;
    e.up.disabled = state.money < cost;

    e.mgr.style.display = '';
    if (s.manager) {
      e.mgr.className = 'btn owned';
      e.mgr.innerHTML = 'ผู้จัดการ ✓<small>ทำอัตโนมัติ</small>';
      e.mgr.disabled = true;
    } else {
      e.mgr.className = 'btn alt';
      e.mgr.innerHTML = `จ้างผู้จัดการ<small>💰 ${fmt(managerCost(i))}</small>`;
      e.mgr.disabled = state.money < managerCost(i);
    }

    e.fill.style.width = s.cooking ? Math.min(100, (s.t / cookTimeOf(i)) * 100) + '%' : '0';
    e.dish.classList.toggle('ready', !s.manager && !s.cooking && s.queue.length > 0);

    const key = s.queue.join('') + (s.manager ? 'm' : '');
    if (key !== e.queueKey) {
      e.queueKey = key;
      e.queue.innerHTML = s.queue.length
        ? s.queue.map((c) => `<span>${c}</span>`).join('')
        : `<span class="hint">${s.manager ? 'รอลูกค้า...' : 'รอลูกค้า แล้วแตะจานเพื่อทำอาหาร'}</span>`;
    }
  });

  upgradeEls.forEach(({ u, btn, lvl }) => {
    const lv = state.upgrades[u.id];
    lvl.textContent = `(${lv}/${u.max})`;
    if (lv >= u.max) {
      btn.textContent = 'สูงสุด';
      btn.disabled = true;
    } else {
      btn.innerHTML = `ซื้อ<small>💰 ${fmt(upgradeCost(u))}</small>`;
      btn.disabled = state.money < upgradeCost(u);
    }
  });

  $('prestige-req').textContent = fmt(PRESTIGE_REQ);
  $('run-earned').textContent = fmt(state.runEarned);
  $('prestige-gain').textContent = prestigeGain();
  $('prestige-btn').disabled = prestigeGain() === 0;
}

function floatText(anchor, text, warn) {
  if (document.hidden) return;
  const r = anchor.getBoundingClientRect();
  const f = el('div', 'float', text);
  if (warn) f.style.color = 'var(--muted)';
  f.style.left = r.left + r.width / 2 - 20 + (Math.random() * 20 - 10) + 'px';
  f.style.top = r.top + 'px';
  $('fx').append(f);
  setTimeout(() => f.remove(), 900);
}

function showModal(html) {
  $('modal-text').innerHTML = html;
  $('modal').classList.remove('hidden');
}

// ---------- เซฟ / โหลด ----------
function save() {
  state.lastSeen = Date.now();
  const data = {
    money: state.money, runEarned: state.runEarned, stars: state.stars, branch: state.branch,
    upgrades: state.upgrades, lastSeen: state.lastSeen,
    stations: state.stations.map((s) => ({ level: s.level, manager: s.manager })),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* โหมดส่วนตัว ฯลฯ */ }
}

function load() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return; }
  if (!data) return;
  state = newState(data.stars || 0, data.branch || 0);
  state.money = data.money ?? state.money;
  state.runEarned = data.runEarned || 0;
  Object.assign(state.upgrades, data.upgrades);
  (data.stations || []).forEach((s, i) => {
    if (state.stations[i]) Object.assign(state.stations[i], { level: s.level, manager: s.manager });
  });

  const away = Math.min((Date.now() - (data.lastSeen || Date.now())) / 1000, OFFLINE_CAP);
  const offline = autoRate() * away;
  if (away > 30 && offline > 0) {
    earn(offline);
    showModal(`ยินดีต้อนรับกลับ! 👋<br>ผู้จัดการขายได้ระหว่างที่คุณไม่อยู่<br><b>💰 ${fmt(offline)}</b>`);
  }
}

// ---------- เริ่มเกม ----------
function init() {
  buildStations();
  buildUpgrades();
  load();

  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  }));
  $('buy-mult').addEventListener('click', () => { buyMode = (buyMode + 1) % BUY_MODES.length; render(); });
  $('prestige-btn').addEventListener('click', () => {
    if (confirm(`เปิดสาขาใหม่และรับ ${prestigeGain()} ⭐? ความคืบหน้าในสาขานี้จะหายไป`)) prestige();
  });
  $('reset-btn').addEventListener('click', () => {
    if (!confirm('ลบเซฟทั้งหมดจริงไหม? กู้คืนไม่ได้')) return;
    state = newState(0, 0);
    save();
  });
  $('modal-ok').addEventListener('click', () => $('modal').classList.add('hidden'));
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else load(); });

  let last = performance.now();
  let renderAcc = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1);
    last = now;
    update(dt);
    renderAcc += dt;
    if (renderAcc > 0.05) { renderAcc = 0; render(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(save, 5000);
}

init();
