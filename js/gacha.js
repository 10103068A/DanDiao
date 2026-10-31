/* 命運扭蛋：只抽物品，不牽涉名單。
   獎品、機率、圖片與紀錄存在 localStorage，重新整理、關掉瀏覽器再開都還在。
   圖片上傳時先縮成小圖，避免撐爆 localStorage（約 5MB）。 */

const G = {
  items: [],      // { id, name, weight, img, limited, stock }；limited = 抽中一次 stock 扣 1
  log: [],        // { id, name, at }，新的在前
  spinning: false
};

const GC_KEY = 'dd_gacha';
const IMG_MAX = 240;          // 圖片長邊縮到這個像素
const LOG_SHOW = 100;         // 紀錄最多列出幾筆（統計仍算全部）

/* 扭蛋外殼的顏色，依獎品在表格的順序輪流取用 */
const COLORS = ['#e8505b', '#f6a623', '#3fb27f', '#3e8ef7', '#a35de0',
                '#ff7eb6', '#14b8c4', '#f2c94c', '#7a8cff', '#ff8a3d'];

function colorOf(item) {
  const i = G.items.indexOf(item);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
}

function save() {
  try {
    localStorage.setItem(GC_KEY, JSON.stringify({ items: G.items, log: G.log }));
    return true;
  } catch (e) {
    U.toast('瀏覽器空間不足，圖片太多存不下了', 'err');
    return false;
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(GC_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    G.items = Array.isArray(d.items) ? d.items : [];
    G.log = Array.isArray(d.log) ? d.log : [];
  } catch (e) { /* 壞掉或讀不到就當作空的 */ }
}

/* ---------- 機率 ---------- */
function soldOut(it) { return !!it.limited && !(it.stock > 0); }

/* 還抽得到：機率大於 0，而且不是已抽完的限量獎品 */
function available(it) { return it.weight > 0 && !soldOut(it); }

/* 只算還抽得到的獎品；限量獎品抽完後，其餘獎品自動依比例換算 */
function totalWeight() {
  return G.items.reduce((s, it) => s + (available(it) ? it.weight : 0), 0);
}

/* 依權重抽一個。權重可以有小數，先放大成整數再用 crypto 亂數 */
function pickItem() {
  const pool = G.items.filter(available);
  const scaled = pool.map(it => Math.round(it.weight * 1000));
  const sum = scaled.reduce((s, w) => s + w, 0);
  if (!sum) return null;
  let r = randomInt(sum);
  for (let i = 0; i < pool.length; i++) {
    if (r < scaled[i]) return pool[i];
    r -= scaled[i];
  }
  return pool[pool.length - 1];
}

function fmtPct(n) {
  return (Math.round(n * 100) / 100) + '%';
}

/* ---------- 圖片 ---------- */
/* 讀檔 → 等比縮小 → 轉成 data URL。webp 保留透明背景，瀏覽器不支援時會自動退回 png */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('請選擇圖片檔'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, IMG_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片讀不出來')); };
    img.src = url;
  });
}

async function setImage(item, file) {
  try {
    const before = item.img;
    item.img = await shrinkImage(file);
    if (!save()) { item.img = before; return; }
    renderItems();
    renderDome();
  } catch (e) {
    U.toast(e.message, 'err');
  }
}

let uploadTarget = null;
U.$('#gcFile').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';               // 同一張圖再選一次也要觸發
  if (f && uploadTarget) setImage(uploadTarget, f);
});

/* ---------- 獎品表格 ---------- */
function renderItems() {
  const tb = U.$('#gcTable tbody');
  tb.textContent = '';
  const total = totalWeight();
  const normalize = total > 0 && Math.abs(total - 100) > 0.001;

  G.items.forEach((it, i) => {
    const tr = U.el('tr', { class: 'gc-row' + (soldOut(it) ? ' soldout' : '') });

    // 圖片：點一下上傳，也可以直接把圖片拖進來
    const pic = U.el('button', { class: 'gc-pic', title: it.img ? '點一下換圖片' : '點一下上傳圖片' });
    if (it.img) pic.appendChild(U.el('img', { src: it.img, alt: it.name }));
    else pic.appendChild(U.el('span', { text: '＋' }));
    pic.style.setProperty('--cap', colorOf(it));
    pic.addEventListener('click', () => { uploadTarget = it; U.$('#gcFile').click(); });
    pic.addEventListener('dragover', e => { e.preventDefault(); pic.classList.add('drop'); });
    pic.addEventListener('dragleave', () => pic.classList.remove('drop'));
    pic.addEventListener('drop', e => {
      e.preventDefault();
      pic.classList.remove('drop');
      if (e.dataTransfer.files[0]) setImage(it, e.dataTransfer.files[0]);
    });
    tr.appendChild(U.el('td', {}, [pic]));

    const nameIn = U.el('input', { value: it.name, size: 10 });
    nameIn.addEventListener('change', () => {
      it.name = nameIn.value.trim() || it.name;
      nameIn.value = it.name;
      save();
      renderLog();
    });
    tr.appendChild(U.el('td', {}, [nameIn]));

    const wIn = U.el('input', { type: 'number', min: 0, step: 'any', value: it.weight });
    wIn.style.width = '72px';
    wIn.addEventListener('change', () => {
      it.weight = Math.max(0, parseFloat(wIn.value) || 0);
      save();
      renderItems();
      renderStage();
    });
    const wCell = U.el('td', {}, [wIn]);
    if (normalize && available(it)) {
      wCell.appendChild(U.el('div', { class: 'small muted', text: '實際 ' + fmtPct(it.weight / total * 100) }));
    }
    tr.appendChild(wCell);

    tr.appendChild(stockCell(it));

    const del = U.el('button', { class: 'ghost sm', text: '✕', title: '刪除' });
    del.addEventListener('click', () => {
      G.items.splice(i, 1);
      save();
      renderItems();
      renderDome();
      renderStage();
    });
    tr.appendChild(U.el('td', {}, [del]));

    tb.appendChild(tr);
  });

  tb.appendChild(draftRow());

  const box = U.$('#gcTotal');
  if (!G.items.length) { box.textContent = ''; box.className = 'gc-total'; return; }
  const out = G.items.filter(soldOut).length;
  box.textContent = '合計 ' + fmtPct(total) + (out ? '（不含已抽完的 ' + out + ' 項）' : '') +
    (total <= 0 ? (out ? '，獎品都抽完了' : '，請至少給一個獎品大於 0 的機率')
      : (normalize ? '，抽獎時依比例換算成 100%' : ''));
  box.className = 'gc-total ' + (total > 0 && !normalize ? 'ok' : 'warn');
}

/* 限量：勾選後才能填數量，抽中一次扣 1，扣到 0 就不會再被抽到 */
function stockCell(it) {
  const td = U.el('td', { class: 'gc-stock' });
  const lim = U.el('input', { type: 'checkbox', title: '勾選後每抽中一次數量扣 1' });
  lim.checked = !!it.limited;
  const qty = U.el('input', { type: 'number', min: 0, step: 1, value: it.stock || 0 });
  qty.style.width = '56px';

  const line = U.el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [lim]);
  if (it.limited) line.appendChild(qty);
  else line.appendChild(U.el('span', { class: 'small muted', text: '不限' }));
  td.appendChild(line);
  if (soldOut(it)) td.appendChild(U.el('span', { class: 'tag soldout', text: '已抽完' }));

  const changed = () => { save(); renderItems(); renderDome(); renderStage(); };
  lim.addEventListener('change', () => {
    it.limited = lim.checked;
    if (it.limited && !(it.stock >= 0)) it.stock = 1;     // 第一次勾選給個起始數量
    changed();
  });
  qty.addEventListener('change', () => {
    it.stock = Math.max(0, parseInt(qty.value, 10) || 0);
    changed();
  });
  return td;
}

/* 固定留在最後一列的待輸入列 */
function draftRow() {
  const tr = U.el('tr', { class: 'gc-row draft' });
  const nameIn = U.el('input', { placeholder: '輸入獎品名稱', size: 10 });
  const wIn = U.el('input', { type: 'number', min: 0, step: 'any', placeholder: '10' });
  wIn.style.width = '72px';

  // Enter 會同時觸發 keydown 與 change，用旗標擋掉第二次
  let done = false;
  const commit = () => {
    if (done || !nameIn.value.trim()) return;
    done = true;
    const w = parseFloat(wIn.value);
    G.items.push({ id: U.uid('gc'), name: nameIn.value.trim(),
                   weight: isNaN(w) ? 10 : Math.max(0, w), img: null });
    save();
    renderItems();
    renderDome();
    renderStage();
    const next = U.$('#gcTable tbody tr.draft input');
    if (next) next.focus();
  };
  nameIn.addEventListener('change', commit);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
  wIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });

  tr.appendChild(U.el('td', {}, [U.el('div', { class: 'gc-pic blank' })]));
  tr.appendChild(U.el('td', {}, [nameIn]));
  tr.appendChild(U.el('td', {}, [wIn]));
  tr.appendChild(U.el('td', {}));
  tr.appendChild(U.el('td', {}));
  return tr;
}

/* ---------- 扭蛋機 ---------- */
/* 球罩裡堆滿扭蛋：由下往上一層一層排進圓裡，堆到大約六成高。
   顏色跟著獎品走，沒有獎品時用彩虹色 */
function renderDome() {
  const dome = U.$('#gmDome');
  dome.querySelectorAll('.gm-ball').forEach(b => b.remove());
  const left = G.items.filter(available);                 // 抽完的獎品不再出現在球罩裡
  const colors = left.length ? left.map(colorOf) : COLORS;
  const S = 348, R = S / 2, D = 54;     // 球罩內徑（360 扣掉邊框）、扭蛋直徑，跟 CSS 對齊
  let n = 0;
  for (let row = 0; ; row++) {
    const y = S - D / 2 - 4 - row * D * 0.82;
    if (y < S * 0.36) break;
    const half = Math.sqrt(Math.max(0, R * R - (y - R) * (y - R))) - D / 2 - 2;
    const count = Math.max(1, Math.floor(half * 2 / (D * 0.9)) + 1);
    const step = count > 1 ? half * 2 / (count - 1) : 0;
    for (let i = 0; i < count; i++) {
      const b = U.el('div', { class: 'gm-ball' });
      b.style.left = (R - half + i * step + (row % 2 ? 4 : -4)) + 'px';
      b.style.top = y + 'px';
      b.style.setProperty('--cap', colors[n % colors.length]);
      b.style.setProperty('--rot', ((n * 47) % 360) + 'deg');
      b.style.setProperty('--d', ((n * 37) % 300) + 'ms');
      dome.appendChild(b);
      n++;
    }
  }
}

function renderStage() {
  if (G.spinning) return;
  const ok = totalWeight() > 0;
  U.$('#gcSpin').disabled = !ok;
  U.$('#gmKnob').disabled = !ok;
  U.$('#gcHint').textContent = !G.items.length ? '請先在左邊新增獎品'
    : (ok ? '' : (G.items.some(soldOut) ? '獎品都抽完了，到左邊補數量就能繼續'
                                        : '所有獎品的機率都是 0，沒有東西可以抽'));
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function spin() {
  if (G.spinning) return;
  const item = pickItem();
  if (!item) return U.toast('沒有東西可以抽', 'err');

  G.spinning = true;
  U.$('#gcSpin').disabled = true;
  U.$('#gmKnob').disabled = true;
  const gm = U.$('#gm');
  const out = U.$('#gmOut');
  out.className = 'gm-out';
  out.style.setProperty('--cap', colorOf(item));

  try {
    if (!reduceMotion()) {
      gm.classList.add('spinning');           // 把手轉、扭蛋晃
      await wait(1400);
      gm.classList.remove('spinning');
      out.classList.add('drop');               // 一顆掉到出口
      await wait(700);
    } else {
      out.classList.add('shown');
    }

    G.log.unshift({ id: item.id, name: item.name, at: new Date().toISOString() });
    if (item.limited) item.stock = Math.max(0, (item.stock || 0) - 1);
    save();
    renderLog();
    renderItems();
    await reveal(item);
    renderDome();                              // 開獎畫面關掉後，抽完的扭蛋才從球罩消失
  } finally {
    G.spinning = false;
    renderStage();
  }
}

/* 全螢幕開獎：扭蛋從中間裂開，露出獎品圖片 */
function reveal(item) {
  return new Promise(resolve => {
    const gr = U.$('#gr');
    const prize = U.$('#grPrize');
    gr.style.setProperty('--cap', colorOf(item));
    prize.textContent = '';
    prize.appendChild(item.img ? U.el('img', { src: item.img, alt: item.name })
                               : U.el('span', { class: 'gr-noimg', text: '🎁' }));
    U.$('#grName').textContent = item.name;

    gr.className = 'gr';
    gr.hidden = false;
    void gr.offsetWidth;                       // 讓動畫從頭播
    gr.classList.add('show');
    setTimeout(() => gr.classList.add('open'), reduceMotion() ? 0 : 650);

    const close = () => {
      U.$('#grClose').removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      gr.hidden = true;
      gr.className = 'gr';
      U.$('#gmOut').className = 'gm-out';
      resolve();
    };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    U.$('#grClose').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    setTimeout(() => U.$('#grClose').focus(), 50);
  });
}

/* ---------- 紀錄 ---------- */
function renderLog() {
  U.$('#gcLogCount').textContent = G.log.length;

  // 統計：每種獎品扭到幾次，依次數排序
  const counts = {};
  G.log.forEach(l => { counts[l.name] = (counts[l.name] || 0) + 1; });
  const sum = U.$('#gcSummary');
  sum.textContent = '';
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(name => {
    sum.appendChild(U.el('span', { class: 'gc-chip', text: name + ' × ' + counts[name] }));
  });

  const ol = U.$('#gcLog');
  ol.textContent = '';
  G.log.slice(0, LOG_SHOW).forEach((l, i) => {
    const it = G.items.find(x => x.id === l.id);
    const li = U.el('li', {});
    li.appendChild(U.el('span', { class: 'gc-no muted', text: '#' + (G.log.length - i) }));
    const thumb = U.el('span', { class: 'gc-thumb' });
    if (it && it.img) thumb.appendChild(U.el('img', { src: it.img, alt: '' }));
    else thumb.style.background = it ? colorOf(it) : '#ccc';
    li.appendChild(thumb);
    li.appendChild(U.el('span', { text: it ? it.name : l.name }));
    li.appendChild(U.el('span', { class: 'small muted gc-time', text: U.fmtDateTime(l.at).slice(5) }));
    ol.appendChild(li);
  });
}

/* ---------- 綁定 ---------- */
U.$('#gcSpin').addEventListener('click', spin);
U.$('#gmKnob').addEventListener('click', spin);

U.$('#gcClearItems').addEventListener('click', () => {
  if (!G.items.length) return;
  if (!confirm('清空所有獎品（含圖片）？')) return;
  G.items = [];
  save();
  renderItems();
  renderDome();
  renderStage();
  renderLog();
});

U.$('#gcClearLog').addEventListener('click', () => {
  if (!G.log.length) return U.toast('還沒有紀錄', 'err');
  if (!confirm('清空所有扭蛋紀錄？')) return;
  G.log = [];
  save();
  renderLog();
});

U.$('#gcCopyLog').addEventListener('click', () => {
  if (!G.log.length) return U.toast('還沒有紀錄', 'err');
  const lines = G.log.slice().reverse().map((l, i) => (i + 1) + '. ' + l.name);
  U.copy(lines.join('\n'));
});

restore();
renderItems();
renderDome();
renderStage();
renderLog();
