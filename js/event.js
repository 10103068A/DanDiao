/* 進行中活動頁 + 抽獎 + 直播模式（§7.3 §11 §12） */

const E = {
  members: null,
  active: null,
  history: null,
  ev: null,
  prizes: [],        // 工作副本（含 winners）
  base: [],          // 基礎名單
  drawing: false,
  dragFrom: null,
  selected: null,   // 目前選取的獎項 id
  partOpen: true    // 參加者清單是否展開
};

/* ---------- 密碼閘 ---------- */
function initGate() {
  if (U.unlocked()) { start(); return; }
  U.$('#gate').style.display = 'block';
  const go = () => {
    if (U.unlock(U.$('#pass').value)) { U.$('#gate').style.display = 'none'; start(); }
    else U.$('#passErr').textContent = '密碼錯誤';
  };
  U.$('#passBtn').addEventListener('click', go);
  U.$('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

async function start() {
  U.$('#app').style.display = 'block';
  await Store.init();
  bind();
  await Promise.all([load(), Store.ownerReady]);     // 讀取與權限探測同時跑
  if (E.ev) applyWriteGuard();
}

/* 進入抽獎前一次載入所有資料，抽獎過程零 API 呼叫（§11.3） */
async function load() {
  if (!Store.configured()) {
    U.$('#noEvent').textContent = '教典紀事未建立，請先到管理者頁面選定聖所，創立教典紀事。';
    U.$('#noEvent').style.display = 'block';
    return;
  }
  // 先用上次的快取把畫面撐起來，再背景跟雲端對答案
  const cm = Store.readLocal('members'), ca = Store.readLocal('active'), ch = Store.readLocal('history');
  if (cm && ca && ch) apply(cm, ca, ch);

  U.busy(true);
  try {
    const [members, active, history] = await Promise.all([
      Store.read('members'), Store.read('active'), Store.read('history')
    ]);
    apply(members, active, history);
  } catch (e) {
    U.toast('讀取雲端資料失敗：' + e.message, 'err');
    if (!E.ev) apply(null, null, null);
  } finally {
    U.busy(false);
  }
}

/* 把一組資料套進畫面。抽獎進行中不覆蓋，免得翻牌翻到一半被雲端資料洗掉 */
function apply(members, active, history) {
  if (E.drawing) return;

  E.members = members || { members: [] };
  E.active = active || { event: null };
  E.history = history || { events: [] };
  E.ev = E.active.event;

  if (!E.ev) {
    U.$('#noEvent').style.display = 'block';
    U.$('#main').style.display = 'none';
    return;
  }
  U.$('#noEvent').style.display = 'none';
  U.$('#main').style.display = 'block';

  if (!E.ev.lottery) E.ev.lottery = { participants: [], prizes: [], drawnAt: null };
  E.prizes = (E.ev.lottery.prizes || []).map(p => Object.assign({}, p, { winners: (p.winners || []).slice() }));

  restoreCache();       // localStorage 暫存優先（誤按重整不遺失，§11.3）
  computeBase();
  renderAll();
}

/* ---------- localStorage 暫存 ---------- */
function cacheKey() { return 'dd_lot_' + (E.ev ? E.ev.id : 'none'); }

function saveCache() {
  localStorage.setItem(cacheKey(), JSON.stringify({
    participants: E.base, prizes: E.prizes, at: Date.now()
  }));
  U.$('#cacheNote').textContent = '（已暫存於本機 ' + new Date().toLocaleTimeString() + '）';
}

function restoreCache() {
  const raw = localStorage.getItem(cacheKey());
  if (!raw) return;
  try {
    const c = JSON.parse(raw);
    const cached = c.prizes || [];
    const cachedDrawn = drawnCount(cached);
    const curDrawn = drawnCount(E.prizes);
    // 暫存比已存檔的內容「更新」才還原：抽得更多，或抽的進度相同但獎項設得更多
    const ahead = cachedDrawn > curDrawn ||
                  (cachedDrawn === curDrawn && cached.length > E.prizes.length);
    if (ahead) {
      E.prizes = cached;
      E.ev.lottery.participants = c.participants || [];
      U.$('#cacheNote').textContent = '（已還原本機暫存，尚未儲存）';
    }
  } catch (e) { /* 壞掉就忽略 */ }
}

/* ---------- 基礎名單 ---------- */
function computeBase() {
  const drawn = drawnCount(E.prizes);
  if (drawn > 0 && (E.ev.lottery.participants || []).length) {
    E.base = E.ev.lottery.participants.slice();      // 已開抽即鎖定名單
    return;
  }
  const regs = E.ev.registrations || [];
  const attending = Matching.attendingIds(regs);
  const mode = U.$('#poolMode') ? U.$('#poolMode').value : 'checkin';
  E.base = mode === 'all'
    ? attending.slice().sort()
    : (E.ev.checkins || []).filter(id => attending.includes(id)).slice().sort();
}

/* ---------- 繪製 ---------- */
function renderAll() {
  renderHeader();
  renderCheckin();
  renderPrizes();
  renderParticipants();
  renderStage();
  applyWriteGuard();
}

/* 獎項列表比參加者長時，讓參加者清單跟著長高對齊，不要留一大塊空白 */
const PART_MIN_HEIGHT = 380;
function syncPanelHeight() {
  const list = U.$('#pList');
  const prizeCard = U.$('#prizeCard');
  const partCard = U.$('#partCard');
  if (!list || !prizeCard || !partCard) return;

  if (document.body.classList.contains('live')) { list.style.maxHeight = ''; return; }

  requestAnimationFrame(() => {
    list.style.maxHeight = 'none';
    const chrome = partCard.offsetHeight - list.offsetHeight;   // 卡片內距 + 標題
    const target = Math.max(PART_MIN_HEIGHT, prizeCard.offsetHeight - chrome);
    list.style.maxHeight = target + 'px';
  });
}

/* 不能寫入的理由，null 代表可以。抽獎與蛋雕共用同一套說法 */
function writeBlockReason() {
  if (Store.canWrite()) return null;
  return !Store.connected ? '請先到管理頁面鄧入，確認聖職' : '僅有天選之人才能操作';
}

function applyWriteGuard() {
  const why = writeBlockReason();
  U.$$('[data-write]').forEach(b => {
    b.disabled = !Store.canWrite();
    b.title = b.disabled ? why : '';
  });
}

function renderHeader() {
  U.$('#evTitle').textContent = E.ev.name + '　' + U.fmtDateTime(E.ev.eventAt);
  U.$('#cntReg').textContent = Matching.valid(E.ev.registrations || []).length;
  U.$('#cntCi').textContent = (E.ev.checkins || []).length;
  U.$('#totalPrize').textContent = E.prizes.reduce((s, p) => s + (p.count || 0), 0);
}

function renderCheckin() {
  const url = E.ev.checkinFormUrl;
  const a = U.$('#ciUrl');
  a.textContent = url || '（未產生）';
  if (url) {
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.classList.remove('muted');
  } else {
    // 沒有網址就不是連結：href="#" 配 target=_blank 會開新分頁載入本頁，
    // 新分頁沒有 sessionStorage，使用者會莫名其妙看到密碼畫面
    a.removeAttribute('href');
    a.removeAttribute('target');
    a.classList.add('muted');
  }
  U.$('#ciCopy').disabled = !url;
  U.$('#ciCode').textContent = E.ev.checkinCode || '—';

  const box = U.$('#ciAnom');
  box.textContent = '';
  const bad = E.ev.checkinIssues || [];
  if (bad.length) {
    box.appendChild(U.collapsible('簽到異常',
      [['僅供顯示，由該成員自行重新簽到', bad, false]], '#dd_ci_open',
      b => b.rawId + '：' + b.reason));
  }
}

/* 獎項表格：拖移排序、新增、刪除、已抽出鎖定（§7.3） */
function renderPrizes() {
  const tb = U.$('#prizeTable tbody');
  tb.textContent = '';

  E.prizes.forEach((p, i) => {
    const locked = isDrawn(p);
    const tr = U.el('tr', { class: 'prize-row' + (locked ? ' locked' : '') +
                                   (p.id === E.selected ? ' selected' : '') });

    // 點列即選取該獎項，右邊會擺上對應張數的蓋牌
    tr.addEventListener('click', e => {
      if (e.target.closest('input, button')) return;   // 編輯欄位不算選取
      selectPrize(p.id);
    });

    // 拖曳把手（只綁把手，避免與欄位編輯衝突）
    const handle = U.el('td', { class: 'handle', text: locked ? '🔒' : '⠿' });
    if (!locked) {
      handle.draggable = true;
      handle.addEventListener('dragstart', e => {
        E.dragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
    }
    tr.appendChild(handle);

    tr.addEventListener('dragover', e => {
      if (E.dragFrom === null || locked) return;
      e.preventDefault();
      tr.classList.add('dragover');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('dragover'));
    tr.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      tr.classList.remove('dragover');
      if (E.dragFrom === null || locked) return;
      movePrize(E.dragFrom, i);
      E.dragFrom = null;
    });

    // 名稱
    const nameIn = U.el('input', { value: p.name, size: 8 });
    nameIn.disabled = locked;
    nameIn.addEventListener('change', () => { p.name = nameIn.value; renderStage(); saveCache(); });
    tr.appendChild(U.el('td', {}, [nameIn]));

    // 數量
    const cntIn = U.el('input', { type: 'number', min: 1, value: p.count });
    cntIn.style.width = '52px';
    cntIn.disabled = locked;
    cntIn.addEventListener('change', () => {
      p.count = Math.max(1, parseInt(cntIn.value, 10) || 1);
      renderHeader(); saveCache();
    });
    tr.appendChild(U.el('td', {}, [cntIn]));

    // 可重複
    const rep = U.el('input', { type: 'checkbox',
      title: '勾選後本獎項可抽到先前已中獎的成員（加碼用）' });
    rep.checked = !!p.allowRepeat;
    rep.disabled = locked;
    rep.addEventListener('change', () => { p.allowRepeat = rep.checked; renderStage(); saveCache(); });
    tr.appendChild(U.el('td', {}, [rep]));

    // 得獎者
    const w = U.el('td', { class: 'mono', text: (p.winners || []).join('、') });
    if (p.allowRepeat) w.appendChild(U.el('span', { class: 'tag bonus', text: '加碼' }));
    tr.appendChild(w);

    // 刪除
    const del = U.el('button', { class: 'ghost sm', text: '✕' });
    del.disabled = locked;
    del.addEventListener('click', () => {
      E.prizes.splice(i, 1);
      if (p.id === E.selected) E.selected = null;
      ensureSelection();
      renderPrizes(); renderHeader(); renderStage(); saveCache();
    });
    tr.appendChild(U.el('td', { class: 'hide-live' }, [del]));

    tb.appendChild(tr);
  });

  tb.appendChild(draftRow());
  syncPanelHeight();
}

/* 固定留在最後一列的待輸入列：填了名稱就變成正式獎項，並自動再長出一列空白 */
function draftRow() {
  const tr = U.el('tr', { class: 'prize-row draft hide-live' });
  tr.appendChild(U.el('td', { class: 'handle', text: '＋' }));

  const nameIn = U.el('input', { placeholder: '輸入獎項名稱', size: 8 });
  const cntIn = U.el('input', { type: 'number', min: 1, value: 1 });
  cntIn.style.width = '52px';
  const rep = U.el('input', { type: 'checkbox',
    title: '勾選後本獎項可抽到先前已中獎的成員（加碼用）' });

  // 按 Enter 會同時觸發 keydown 與 change，用旗標擋掉第二次，避免新增兩列
  let done = false;
  const commit = () => {
    const name = nameIn.value.trim();
    if (done || !name) return;
    done = true;
    const added = { id: U.uid('p'), name: name,
                    count: Math.max(1, parseInt(cntIn.value, 10) || 1),
                    allowRepeat: rep.checked, winners: [] };
    E.prizes.push(added);
    if (!selectedPrize() || isDrawn(selectedPrize())) E.selected = added.id;
    renderPrizes(); renderHeader(); renderStage(); saveCache();
    const next = U.$('#prizeTable tbody tr.draft input');
    if (next) next.focus();
  };
  nameIn.addEventListener('change', commit);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });

  tr.appendChild(U.el('td', {}, [nameIn]));
  tr.appendChild(U.el('td', {}, [cntIn]));
  tr.appendChild(U.el('td', {}, [rep]));
  tr.appendChild(U.el('td', { class: 'small muted', text: '按 Enter 新增' }));
  tr.appendChild(U.el('td', {}));
  return tr;
}

/* 已抽出的獎項不可移動，也不能被插隊到它的位置 */
function movePrize(from, to) {
  if (isDrawn(E.prizes[from]) || isDrawn(E.prizes[to])) {
    U.toast('已抽出的獎項不可移動', 'err');
    return;
  }
  const item = E.prizes.splice(from, 1)[0];
  E.prizes.splice(to, 0, item);
  renderPrizes(); saveCache();
}

/* ---------- 獎項選取 ---------- */
function selectedPrize() { return E.prizes.find(p => p.id === E.selected) || null; }
function selectedIndex() { return E.prizes.findIndex(p => p.id === E.selected); }

/* 沒有選取（或選到已被刪除的）時，自動挑第一個還沒抽的 */
function ensureSelection() {
  if (selectedPrize()) return;
  const next = E.prizes.find(p => !isDrawn(p)) || E.prizes[E.prizes.length - 1];
  E.selected = next ? next.id : null;
}

function selectPrize(id) {
  if (E.drawing) return U.toast('抽獎進行中', 'err');
  E.selected = id;
  renderPrizes();
  renderStage();
}

function renderParticipants() {
  const box = U.$('#pList');
  box.textContent = '';
  const live = document.body.classList.contains('live');
  const regs = E.ev.registrations || [];
  const attending = Matching.attendingIds(regs);
  const checkins = new Set(E.ev.checkins || []);
  const inPool = new Set(E.base);

  U.$('#pTitle').textContent = '抽獎池 ' + E.base.length + ' 人';

  // 只有直播模式需要收合（名單佔掉上方空間）；一般模式永遠展開
  const toggle = U.$('#pToggle');
  toggle.style.display = live ? '' : 'none';
  const open = live ? E.partOpen : true;
  box.style.display = open ? '' : 'none';
  toggle.textContent = E.partOpen ? '收合' : '展開';

  // 直播只列有抽獎資格的人，橫向排開省空間；沒資格的不必給觀眾看
  if (live) {
    const chips = U.el('div', { class: 'pool-chips' });
    E.base.forEach(id => chips.appendChild(U.el('span', { class: 'chip', text: id })));
    box.appendChild(chips);
    if (!E.base.length) box.appendChild(U.el('p', { class: 'empty', text: '抽獎池是空的' }));
    return;
  }

  const t = U.el('table');
  const tb = U.el('tbody');
  attending.forEach(id => {
    tb.appendChild(U.el('tr', {}, [
      U.el('td', { class: 'mono ' + (inPool.has(id) ? 'p-in' : 'p-out'), text: id }),
      U.el('td', { text: checkins.has(id) ? '✔ 已簽到' : '', class: 'small' })
    ]));
  });
  t.appendChild(tb);
  box.appendChild(t);
  if (!attending.length) box.appendChild(U.el('p', { class: 'empty', text: '尚無有效報名者，請先到管理者頁面按「拉取報名資料」。' }));
}

/* 舞台顯示「目前選取的獎項」：未抽的擺上等同名額數的蓋牌，已抽的攤開結果 */
function renderStage() {
  ensureSelection();
  const p = selectedPrize();
  const cw = U.$('#curWinners');
  const btn = U.$('#drawBtn');
  const big = document.body.classList.contains('live');

  U.$('#curPrize').textContent = p ? p.name : '—';
  U.$('#curBonus').style.display = p && p.allowRepeat ? 'inline-block' : 'none';
  btn.textContent = '阿拉花光';

  if (E.drawing) return;                    // 翻牌動畫進行中，不要重繪牌面

  if (!p) {
    btn.disabled = true;
    cw.textContent = '';
    U.$('#stageHint').textContent = E.prizes.length ? '點選左邊的獎項' : '請先在左邊建立獎項';
    return;
  }

  if (isDrawn(p)) {
    btn.disabled = true;
    U.$('#stageHint').textContent = '這個獎項已經抽過了，點左邊其他獎項繼續';
    U.flipStatic(cw, p.winners, big);
    return;
  }

  const blocked = writeBlockReason();
  btn.disabled = !E.base.length || !!blocked;
  btn.title = blocked || '';                       // 理由用 tooltip 就好，不佔畫面
  U.$('#stageHint').textContent = E.base.length ? '' : '抽獎池是空的';
  U.dealCards(cw, p.count, big);            // 蓋牌等著開
}

/* ---------- 抽獎 ---------- */
async function draw() {
  const idx = selectedIndex();
  const prize = E.prizes[idx];
  if (!prize || E.drawing || isDrawn(prize)) return;
  const blocked = writeBlockReason();
  if (blocked) return U.toast(blocked, 'err');
  if (!E.base.length) return U.toast('抽獎池是空的', 'err');

  E.drawing = true;
  E.ev.lottery.participants = E.base.slice();     // 首次開抽即鎖定名單
  U.$('#drawBtn').disabled = true;
  U.$('#shortageNote').textContent = '';
  U.$('#stageHint').textContent = '';

  // try / finally：任何意外都必須解開 drawing 旗標，否則直播中按鈕會永久卡死
  try {
    // 純前端運算，不呼叫任何 API
    const result = drawPrize(E.base, E.prizes, idx);
    const big = document.body.classList.contains('live');

    // 蓋牌一張一張翻開
    const cards = U.dealCards(U.$('#curWinners'), prize.count, big);
    await U.revealCards(cards, result.winners);

    E.prizes[idx] = Object.assign(E.prizes[idx], { winners: result.winners });
    if (result.shortage > 0) {
      U.$('#shortageNote').textContent = '⚠ 抽獎池人數不足，本獎項僅抽出 ' +
        result.winners.length + '/' + prize.count + ' 位';
    }
    saveCache();
  } catch (err) {
    U.toast('抽獎發生錯誤：' + err.message, 'err');
  } finally {
    E.drawing = false;
    renderPrizes();
    renderStage();
  }
}

function clearDraw() {
  const blocked = writeBlockReason();
  if (blocked) return U.toast(blocked, 'err');
  if (!confirm('要把目前所有中獎結果蛋雕掉，重新抽一次嗎？')) return;
  if (!confirm('再確認一次：清空後就找不回來了。')) return;
  E.prizes.forEach(p => { p.winners = []; });
  E.selected = null;
  E.ev.lottery.drawnAt = null;
  E.ev.lottery.participants = [];
  localStorage.removeItem(cacheKey());
  computeBase();
  renderAll();
  U.toast('已蛋雕，可以重新抽獎');
}

/* ---------- 簽到 ---------- */
async function makeCheckinForm() {
  try {
    const code = U.checkinCode();
    const f = await FormService.createCheckin(E.ev);
    E.ev.checkinFormId = f.formId;
    E.ev.checkinFormUrl = f.url;
    E.ev.checkinCode = code;
    E.ev.status = 'checkin';
    await Store.write('active', E.active);
    renderAll();
    U.toast('簽到表單已產生，簽到碼 ' + code);
  } catch (e) { U.toast('產生失敗：' + e.message, 'err'); }
}

async function pullCheckins() {
  if (!E.ev.checkinFormId) return U.toast('尚未產生簽到表單', 'err');
  try {
    const raw = await FormService.fetchCheckinResponses(E.ev);
    const validIds = new Set(Matching.attendingIds(E.ev.registrations || []));
    const ok = [];
    const bad = [];
    raw.forEach(r => {
      if (r.code !== E.ev.checkinCode) { bad.push({ rawId: r.rawId, reason: '簽到碼錯誤' }); return; }
      if (!validIds.has(r.rawId)) { bad.push({ rawId: r.rawId, reason: '不在有效報名名單中' }); return; }
      if (!ok.includes(r.rawId)) ok.push(r.rawId);
    });
    E.ev.checkins = ok;
    E.ev.checkinIssues = bad;
    await Store.write('active', E.active);
    computeBase();
    renderAll();
    U.toast('已簽到 ' + ok.length + ' 人，異常 ' + bad.length + ' 筆');
  } catch (e) { U.toast('拉取失敗：' + e.message, 'err'); }
}

async function closeCheckin() {
  try {
    await FormService.closeForm(E.ev.checkinFormId);
    E.ev.status = 'lottery';
    await Store.write('active', E.active);
    U.toast('簽到已結束');
    renderAll();
  } catch (e) { U.toast(e.message, 'err'); }
}

/* ---------- 歸檔（§10.4） ---------- */
async function archive() {
  if (!confirm('阿拉花光～ 這場活動已經結束了，可以在歷史活動匯出中獎清單')) return;
  const regs = E.ev.registrations || [];
  const validSet = new Map();
  Matching.valid(regs).forEach(r => validSet.set(r.matchedId, r));

  E.members.members.forEach(m => {
    m.heretic = (m.heretic || 0) + 1;                 // 全體成員 +1
    const r = validSet.get(m.id);
    if (r) {
      m.heretic = Math.max(0, m.heretic - 1);
      if (r.attend === '請假') m.leaves = (m.leaves || 0) + 1;
      else m.attended = (m.attended || 0) + 1;
    }
  });
  E.members.updatedAt = new Date().toISOString();

  E.history.events.push({
    id: E.ev.id,
    name: E.ev.name,
    eventAt: E.ev.eventAt,
    registered: Matching.valid(regs).length,
    memberCount: E.members.members.length,
    checkedIn: (E.ev.checkins || []).length,
    lottery: {
      participants: E.base.slice(),
      prizes: E.prizes.map(p => ({ id: p.id, name: p.name, count: p.count,
                                   allowRepeat: !!p.allowRepeat, winners: p.winners || [] })),
      drawnAt: E.ev.lottery.drawnAt || new Date().toISOString()
    }
  });

  try {
    await Store.write('members', E.members);
    await Store.write('history', E.history);
    await Store.write('active', { event: null });
    localStorage.removeItem(cacheKey());
    U.toast('已歸檔');
    location.href = 'index.html';
  } catch (e) { U.toast('歸檔失敗：' + e.message, 'err'); }
}

/* ---------- 直播模式（§12） ---------- */
function setLive(on) {
  document.body.classList.toggle('live', on);
  U.$('#liveExit').style.display = on ? 'block' : 'none';
  // 直播版面不同，牌面尺寸與清單高度都要重算
  U.$('#curWinners').textContent = '';
  renderParticipants();
  renderStage();
  syncPanelHeight();
}

/* ---------- 綁定 ---------- */
function bind() {
  const w = (id, fn) => {
    const b = U.$(id);
    b.setAttribute('data-write', '1');
    b.addEventListener('click', fn);
  };
  w('#ciMake', makeCheckinForm);
  w('#ciPull', pullCheckins);
  w('#ciClose', closeCheckin);
  w('#archiveBtn', archive);

  U.$('#ciCopy').addEventListener('click', () => U.copy(E.ev.checkinFormUrl || ''));
  U.$('#clearDraw').addEventListener('click', clearDraw);
  U.$('#drawBtn').addEventListener('click', draw);
  U.$('#pToggle').addEventListener('click', () => {
    E.partOpen = !E.partOpen;
    renderParticipants();
    syncPanelHeight();
  });

  U.$('#liveBtn').addEventListener('click', () => setLive(true));
  U.$('#liveExit').addEventListener('click', () => setLive(false));

  U.$('#poolMode').addEventListener('change', () => {
    if (drawnCount(E.prizes) > 0) {
      U.toast('已開始抽獎，名單已鎖定', 'err');
      U.$('#poolMode').value = 'checkin';
      return;
    }
    computeBase();
    renderAll();
  });

  window.addEventListener('resize', syncPanelHeight);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('live')) setLive(false);
  });
}

initGate();
