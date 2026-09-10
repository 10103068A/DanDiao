/* 管理者頁面（§7.2） */

const A = {
  members: null,   // members.json
  active: null,    // active.json
  history: null,   // history.json
  sortKey: 'id',
  sortAsc: true,
  search: ''
};

/* ---------- 密碼閘 ---------- */
function initGate() {
  if (U.unlocked()) { start(); return; }
  U.$('#gate').style.display = 'block';
  const go = () => {
    if (U.unlock(U.$('#pass').value)) {
      U.$('#gate').style.display = 'none';
      start();
    } else {
      U.$('#passErr').textContent = '密碼錯誤';
    }
  };
  U.$('#passBtn').addEventListener('click', go);
  U.$('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

async function start() {
  U.$('#app').style.display = 'block';
  await Store.init();
  if (Store.demo) {
    U.$('#demoBadge').style.display = 'inline-block';
    U.$('#resetBtn').style.display = 'inline-block';
  }
  bind();
  renderAccount();      // 登入狀態立刻可知，先畫出來，
  renderSetup();        // 不必等雲端資料，也避免載入期間按鈕是亮的
  applyWriteGuard();
  await Promise.all([reload(), Store.ownerReady]);   // 讀取與權限探測同時跑
  renderAll();          // 探測結果回來後再畫一次
}

async function reload() {
  // 還沒設定檔案 ID 時不去讀（一定會失敗），先讓使用者跑初始化
  if (!Store.configured()) {
    A.members = { updatedAt: null, members: [] };
    A.active = { event: null };
    A.history = { events: [] };
    renderAll();
    return;
  }
  // 先給安全預設值：讀取失敗時 renderAll 才不會踩到 null
  A.members = A.members || { updatedAt: null, members: [] };
  A.active = A.active || { event: null };
  A.history = A.history || { events: [] };

  // 再用上次的快取把畫面填滿，避免切頁面時空白好幾秒
  const cm = Store.readLocal('members'), ca = Store.readLocal('active'), ch = Store.readLocal('history');
  if (cm && ca && ch) {
    A.members = cm; A.active = ca; A.history = ch;
    renderAll();
  }

  U.busy(true);
  try {
    const [members, active, history] = await Promise.all([
      Store.read('members'), Store.read('active'), Store.read('history')
    ]);
    A.members = members || { updatedAt: null, members: [] };
    A.active = active || { event: null };
    A.history = history || { events: [] };
  } catch (e) {
    U.toast('讀取雲端資料失敗：' + e.message, 'err');
  } finally {
    U.busy(false);
  }
  renderAll();
}

function renderAll() {
  renderAccount();
  renderSetup();
  renderActive();
  renderAnomalies();
  renderHistory();
  renderMembers();
  applyWriteGuard();
}

/* 幹部可見全部 UI，寫入按鈕 disabled 而非隱藏（§3.2） */
function applyWriteGuard() {
  const why = !Store.connected ? '先行登入Google，方可驗明聖職'
            : !Store.configured() ? '請先選定聖所位置'
            : '僅有神選之人能編寫紀事';
  U.$$('[data-write]').forEach(b => {
    b.disabled = !Store.canWrite();
    if (b.disabled) b.title = why;
    else b.removeAttribute('title');
  });

  /* 創立 / 另擇聖所只要登入就能按：
     還沒選定聖所時要能創立，登入了別的帳號時要能把聖所遷過去。 */
  const init = U.$('#initBtn');
  init.disabled = !Store.connected;
  if (init.disabled) init.title = '先行登入Google，方可驗明聖職';
  else init.removeAttribute('title');
}

/* ---------- 帳號 ---------- */
function renderAccount() {
  U.$('#acct').textContent = Store.email ? U.maskEmail(Store.email) : '未登入';
  U.$('#connBtn').style.display = Store.connected ? 'none' : 'inline-block';
  U.$('#switchBtn').style.display = Store.connected ? 'inline-block' : 'none';

  // 連上了但沒有寫入權限 = 這不是會長的帳號
  let warn = U.$('#ownerWarn');
  if (!warn) {
    warn = U.el('span', { id: 'ownerWarn', class: 'tag form_error' });
    U.$('#acct').parentNode.appendChild(warn);
  }
  const notOwner = Store.connected && Store.isOwner === false;
  warn.style.display = notOwner ? 'inline-block' : 'none';
  warn.textContent = notOwner ? '僅有神選之人能編寫紀事' : '';
}

/* ---------- 儲存位置 ---------- */
function renderSetup() {
  const first = !Store.configured();
  U.$('#setupTitle').textContent = first ? '教典紀事未建立' : '教典紀事已安放';
  U.$('#initBtn').textContent = first ? '創立教典紀事' : '另擇聖所安置';

  /* 所在只對「本人」揭露：能編輯這些檔案才代表你就是它的擁有者。
     其他人（含未登入、幹部、非擁有者）一律不透露檔案在誰的硬碟。 */
  const where = U.$('#ownerWhere');
  if (first) {
    where.textContent = '聖所選定中';
    where.className = 'muted';
  } else if (Store.isOwner === true && Store.email) {
    where.textContent = U.maskEmail(Store.email);
    where.className = '';
  } else {
    where.textContent = '神選之人的訊息不可被透漏';
    where.className = 'muted';
  }

  U.$('#setupHint').innerHTML = first
    ? '尚未尋得神諭記載。請由神選之人連線後創立教典紀事，' +
      '會在該帳號的雲端硬碟建立三份紀事並設為「知道連結的人可讀」。'
    : '「另擇聖所安置」會在<strong>目前登入的帳號</strong>建立三份全新的空紀事，' +
      '現有資料完全不受影響（不會被刪除，也不會被搬過去）。<br>' +
      '真的要換位置，必須把新的識別碼交給開發者處理才會生效。';
}

async function initFiles() {
  const first = !Store.configured();
  const msg = first
    ? '要在目前登入的 Google 帳號建立三個資料檔嗎？\n\n' +
      '請確認現在登入的是教主指定的帳號——檔案建在誰的雲端硬碟，之後就只有那個帳號能寫入。'
    : '要在目前登入的帳號建立三份全新的空資料檔嗎？\n\n' +
      '現有資料不會被刪除也不會被搬移。\n' +
      '必須把新的三行 ID 交給開發者處理才能奏效，未來只有此帳號能寫入';
  if (!confirm(msg)) return;

  const btn = U.$('#initBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '建立中…';
  U.busy(true, '建立教典紀事…');
  try {
    const ids = await Store.initFiles();
    U.$('#initIds').textContent =
      "    FILE_IDS: {\n" +
      "      members: '" + ids.members + "',\n" +
      "      active:  '" + ids.active + "',\n" +
      "      history: '" + ids.history + "'\n" +
      "    }";
    U.$('#initResult').style.display = 'block';
    btn.textContent = label;
    U.toast('三個資料檔已建立');      // 按鈕保持 disabled，避免手滑連按；重整即可再執行
  } catch (e) {
    U.toast('初始化失敗：' + e.message, 'err');
    btn.textContent = label;
    btn.disabled = false;             // 失敗要能重試
  } finally {
    U.busy(false);
  }
}

/* ---------- 進行中活動 ---------- */
function renderActive() {
  const box = U.$('#activeBox');
  box.textContent = '';
  const ev = A.active.event;
  if (!ev) {
    box.appendChild(U.el('p', { class: 'empty', text: '目前沒有進行中的活動。' }));
    return;
  }
  const total = A.members.members.length;
  const valid = Matching.valid(ev.registrations || []).length;

  box.appendChild(U.el('div', { class: 'row' }, [
    U.el('strong', { text: U.fmtDateTime(ev.eventAt) + '　' + ev.name }),
    U.el('span', { class: 'tag ' + (ev.status === 'open' ? 'ok' : 'duplicate'), text: statusText(ev.status) }),
    U.el('span', { class: 'muted', text: '參加人數 ' + valid + '/' + total })
  ]));

  const link = U.el('div', { class: 'row', style: 'margin-top:8px' }, [
    U.el('span', { class: 'small muted', text: '報名表單：' }),
    // 沒有網址就給純文字，不要 href="#" + target=_blank（會開新分頁載入本頁並跳密碼閘）
    ev.signupFormUrl
      ? U.el('a', { href: ev.signupFormUrl, target: '_blank', rel: 'noopener',
                    class: 'mono small', text: ev.signupFormUrl })
      : U.el('span', { class: 'mono small muted', text: '（未產生）' })
  ]);
  if (ev.signupFormUrl) {
    link.appendChild(U.el('button', { class: 'ghost sm', text: '複製',
      onclick: () => U.copy(ev.signupFormUrl) }));
  }
  box.appendChild(link);

  const acts = U.el('div', { class: 'row', style: 'margin-top:10px' });
  acts.appendChild(U.el('button', { 'data-write': '1', text: '拉取報名資料', onclick: pullResponses }));
  if (!ev.deadline) {
    acts.appendChild(U.el('button', { 'data-write': '1', class: 'ghost', text: '截止報名',
      onclick: closeSignup }));
  }
  const regs = ev.registrations || [];
  acts.appendChild(U.el('span', { class: 'small muted', style: 'margin-left:auto',
    text: regs.length ? '報名 ' + regs.length + ' 筆，有效 ' + valid + ' 筆' : '尚未拉取報名資料' }));
  box.appendChild(acts);

  box.appendChild(U.el('p', { class: 'hint',
    text: ev.deadline ? '報名已於 ' + U.fmtDateTime(ev.deadline) + ' 截止' : '報名進行中，尚未截止' }));
}

/* 報名異常：純顯示，不提供處理功能（§10.3）。獨立在右欄 */
function renderAnomalies() {
  const box = U.$('#anomBox');
  box.textContent = '';
  const regs = (A.active.event || {}).registrations || [];
  if (!regs.length) {
    box.appendChild(U.el('p', { class: 'empty', text: '尚未拉取報名資料' }));
    return;
  }
  const an = Matching.anomalies(regs);
  const items = [
    ['不在成員清單中', an.unknown, true],
    ['重複報名（以最後為準）', an.duplicate, false],
    ['表單防呆錯誤', an.form_error, true],
    ['逾時報名', an.late, true],
    ['公會與名單不符（不影響有效性）', an.guildMismatch, false]
  ].filter(([, arr]) => arr.length);

  const total = items.reduce((s, it) => s + it[1].length, 0);
  U.$('#anomTitle').textContent = total ? '報名異常（' + total + ' 筆）' : '報名異常';

  if (!items.length) {
    box.appendChild(U.el('p', { class: 'empty', text: '報名資料無異常 🎉' }));
    return;
  }
  // 面板有自己的欄位，直接攤開列出，不再收合
  items.forEach(([label, arr, copyable]) => {
    const h = U.el('div', { class: 'row' }, [U.el('h3', { text: label + '（' + arr.length + '）' })]);
    if (copyable) {
      h.appendChild(U.el('button', { class: 'ghost sm', text: '複製清單',
        onclick: () => U.copy(arr.map(r => r.rawId).join(', ')) }));
    }
    box.appendChild(h);
    const ul = U.el('ul');
    arr.forEach(r => ul.appendChild(U.el('li', { class: 'mono',
      text: r.rawId + '，' + r.guild + '公會' +
            (r.issues && r.issues.length ? '（' + r.issues.join('、') + '）' : '') })));
    box.appendChild(ul);
  });
}

async function pullResponses() {
  const ev = A.active.event;
  if (!ev) return;
  try {
    const raw = await FormService.fetchSignupResponses(ev, A.members.members);
    // status / matchedId 每次全部重算（§10.1.1）
    ev.registrations = Matching.recompute(raw, A.members.members, ev);
    await Store.write('active', A.active);
    renderAll();
    U.toast('已拉取 ' + raw.length + ' 筆報名資料並重新比對');
  } catch (e) { U.toast('拉取失敗：' + e.message, 'err'); }
}

/* 截止報名：關閉表單，並把當下時間記為截止時間。
   之後才送出的報名會在下次拉取時標為逾時（§8.3 的保險機制）。 */
async function closeSignup() {
  const ev = A.active.event;
  if (!ev) return;
  if (!confirm('要停止接受報名嗎？\n\n表單會關閉，之後送出的報名會被標為逾時，不進抽獎池。')) return;
  try {
    await FormService.closeForm(ev.signupFormId);
    ev.deadline = new Date().toISOString();
    ev.status = 'closed';
    if ((ev.registrations || []).length) {
      ev.registrations = Matching.recompute(ev.registrations, A.members.members, ev);
    }
    await Store.write('active', A.active);
    renderAll();
    U.toast('報名已截止');
  } catch (e) { U.toast('截止失敗：' + e.message, 'err'); }
}

function statusText(s) {
  return ({ open: '報名中', closed: '已截止', checkin: '簽到中', lottery: '抽獎中', done: '待歸檔' })[s] || s;
}

/* ---------- 歷史 ---------- */
function renderHistory() {
  const box = U.$('#histBox');
  box.textContent = '';
  const evs = (A.history.events || []).slice().sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt));
  if (!evs.length) { box.appendChild(U.el('p', { class: 'empty', text: '尚無歷史活動。' })); return; }

  const t = U.el('table');
  t.appendChild(U.el('thead', {}, [U.el('tr', {}, [
    U.el('th', { text: '日期' }), U.el('th', { text: '活動名稱' }),
    U.el('th', { text: '報名' }), U.el('th', { text: '簽到' })
  ])]));
  const tb = U.el('tbody');
  evs.forEach(e => {
    tb.appendChild(U.el('tr', {}, [
      U.el('td', { text: U.fmtDate(e.eventAt) }),
      U.el('td', { text: e.name }),
      U.el('td', { text: e.registered + '/' + e.memberCount }),
      U.el('td', { text: String(e.checkedIn) })
    ]));
  });
  t.appendChild(tb);
  box.appendChild(t);
}

/* ---------- 成員 ---------- */
function renderMembers() {
  const tb = U.$('#memTable tbody');
  tb.textContent = '';
  let list = A.members.members.slice();
  if (A.search) {
    const q = A.search.toLowerCase();
    list = list.filter(m => m.id.toLowerCase().includes(q) || (m.guild || '').toLowerCase().includes(q));
  }
  list.sort((x, y) => {
    const a = x[A.sortKey], b = y[A.sortKey];
    const r = (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b));
    return A.sortAsc ? r : -r;
  });

  // 表格唯讀：所有異動走「更新成員」或「新增成員」，兩者都需會長權限
  list.forEach(m => {
    tb.appendChild(U.el('tr', {}, [
      U.el('td', { class: 'mono', text: m.id }),
      U.el('td', { text: m.guild || '' }),
      U.el('td', { text: String(m.attended || 0) }),
      U.el('td', { text: String(m.leaves || 0) }),
      U.el('td', { text: String(m.heretic || 0) })
    ]));
  });
  U.$('#memCount').textContent = '共 ' + A.members.members.length + ' 人' +
    (A.members.updatedAt ? '　最後更新：' + U.fmtDateTime(A.members.updatedAt) : '');
}

/* ---------- 動作 ---------- */
async function createEvent() {
  const date = U.$('#nvDate').value, time = U.$('#nvTime').value, name = U.$('#nvName').value.trim();
  if (!date || !time || !name) return U.toast('請填寫日期、時間與活動名稱', 'err');
  if (A.active.event && !confirm('已有進行中活動，建立新活動會覆蓋。確定？')) return;

  const eventAt = U.localToIso(date, time);
  const opt = Matching.buildTimeOptions(eventAt);
  const ev = {
    id: date + '-' + name.replace(/\s+/g, '-'),
    name: name,
    eventAt: eventAt,
    deadline: null,          // 按下「截止報名」的當下才記錄，之後送出的回覆標為逾時（§8.3）
    status: 'open',
    signupFormId: null, signupFormUrl: null,
    signupTimeOptions: opt.options,
    signupTimeCorrectIndex: opt.correctIndex,
    checkinFormId: null, checkinFormUrl: null, checkinCode: null,
    registrations: [],
    checkins: [],
    lottery: { participants: [], prizes: [], drawnAt: null }
  };

  const btn = U.$('#createBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '建立中…';
  U.busy(true, '建立報名表單…');
  try {
    const form = await FormService.createSignup(ev);
    ev.signupFormId = form.formId;
    ev.signupFormUrl = form.url;
    A.active.event = ev;
    await Store.write('active', A.active);
    U.toast('活動已建立，報名表單已產生');
  } catch (e) {
    U.toast('建立失敗：' + e.message, 'err');
  } finally {
    U.busy(false);
    btn.textContent = label;
    renderAll();          // 內含 applyWriteGuard，按鈕的啟用狀態交給它決定
  }
}

/* 匯入成員名單：純文字檔，每行「角色ID,公會」，記事本可直接編輯。
   這是整份名單取代 —— 檔案裡沒有的人視同退會移除。
   參與活動 / 請假次數 / 企圖成為異教徒不在檔案中，既有成員沿用系統內的累計值，新成員從 0 起算。
   前端 FileReader 讀取，不上傳任何伺服器。 */
function importMembers(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    const lines = String(fr.result).replace(/^﻿/, '').split(/\r?\n/)
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (!lines.length) return U.toast('檔案是空的', 'err');

    const old = new Map(A.members.members.map(m => [m.id, m]));
    const seen = new Set();
    const roster = [];
    const badLines = [];

    lines.forEach((line, i) => {
      const parts = line.split(/[,\t、，]|\s+/).map(s => s.trim()).filter(s => s);
      const id = parts[0];
      const guild = parts[1];
      if (!id || !guild) { badLines.push('第 ' + (i + 1) + ' 行：' + line); return; }
      if (!CONFIG.GUILDS.includes(guild)) { badLines.push('第 ' + (i + 1) + ' 行公會不是 ' +
        CONFIG.GUILDS.join(' / ') + '：' + line); return; }
      if (seen.has(id)) { badLines.push('第 ' + (i + 1) + ' 行 ID 重複：' + id); return; }
      seen.add(id);
      const prev = old.get(id);
      roster.push({ id: id, guild: guild,
                    attended: prev ? prev.attended || 0 : 0,
                    leaves: prev ? prev.leaves || 0 : 0,
                    heretic: prev ? prev.heretic || 0 : 0 });
    });

    if (badLines.length) {
      return alert('格式有誤，未匯入。每行請寫「角色ID,公會」：\n\n' + badLines.slice(0, 10).join('\n') +
        (badLines.length > 10 ? '\n…共 ' + badLines.length + ' 行' : ''));
    }
    if (!roster.length) return U.toast('沒有讀到任何成員', 'err');

    const added = roster.filter(m => !old.has(m.id)).length;
    const removed = A.members.members.filter(m => !seen.has(m.id));
    const msg = '匯入後名單共 ' + roster.length + ' 人\n新增 ' + added + ' 人\n' +
      '移除 ' + removed.length + ' 人' +
      (removed.length ? '：' + removed.slice(0, 15).map(m => m.id).join('、') +
        (removed.length > 15 ? ' …' : '') : '') +
      '\n\n被移除的成員連同累計次數一起刪除，確定嗎？';
    if (!confirm(msg)) return U.toast('已取消');

    A.members.members = roster;
    await saveMembers('已更新名單：共 ' + roster.length + ' 人（新增 ' + added + '、移除 ' + removed.length + '）');
  };
  fr.readAsText(file, 'utf-8');
}

/* 匯出成員名單：與匯入相同格式的純文字檔 */
function exportMembers() {
  const text = A.members.members.map(m => m.id + ',' + m.guild).join('\r\n');
  U.downloadText('成員名單-' + new Date().toISOString().slice(0, 10) + '.txt', text, 'text/plain');
}

async function saveMembers(msg) {
  A.members.updatedAt = new Date().toISOString();
  try {
    await Store.write('members', A.members);
    U.toast((msg || '成員庫已更新') + '，已儲存');
    renderMembers();
  } catch (e) {
    U.toast(e.message, 'err');
    await reload();          // 寫入失敗就退回已存檔的狀態，避免畫面與資料不一致
  }
}

/* ---------- 綁定 ---------- */
function bind() {
  U.$('#ownerToggle').addEventListener('click', () => {
    const body = U.$('#ownerBody');
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    U.$('#ownerToggle').textContent = open ? '收合' : '展開';
    sessionStorage.setItem('dd_owner_open', open ? '1' : '0');
  });
  if (sessionStorage.getItem('dd_owner_open') === '1') U.$('#ownerToggle').click();

  U.$('#initBtn').addEventListener('click', initFiles);
  U.$('#initCopy').addEventListener('click', () => U.copy(U.$('#initIds').textContent));

  U.$('#connBtn').addEventListener('click', async () => {
    try { await Store.connect(); renderAll(); U.toast('已連線'); }
    catch (e) { U.toast('連線失敗：' + e.message, 'err'); }
  });
  U.$('#switchBtn').addEventListener('click', async () => {
    Store.disconnect();
    renderAll();
    try { await Store.connect(); renderAll(); } catch (e) { /* 使用者取消 */ }
  });

  U.$('#tabEvent').addEventListener('click', e => { e.preventDefault(); switchTab('event'); });
  U.$('#tabMember').addEventListener('click', e => { e.preventDefault(); switchTab('member'); });

  const cb = U.$('#createBtn'); cb.setAttribute('data-write', '1');
  cb.addEventListener('click', createEvent);

  U.$('#exportBtn').addEventListener('click', async () => {
    U.download('guild-backup-' + new Date().toISOString().slice(0, 10) + '.json', await Store.exportAll());
  });
  U.$('#importBtn').addEventListener('click', () => U.$('#importFile').click());
  U.$('#importFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        await Store.importAll(JSON.parse(fr.result));
        U.toast('匯入完成');
        await reload();
      } catch (err) { U.toast('匯入失敗：' + err.message, 'err'); }
    };
    fr.readAsText(f);
    e.target.value = '';
  });
  U.$('#resetBtn').addEventListener('click', async () => {
    if (!confirm('重置 DEMO 資料？現有的活動與歷史會被還原為預設值。')) return;
    await Store.resetDemo();
    await reload();
    U.toast('已重置');
  });

  const impBtn = U.$('#memImport');
  impBtn.setAttribute('data-write', '1');
  impBtn.addEventListener('click', () => U.$('#memFile').click());
  U.$('#memFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) importMembers(f);
    e.target.value = '';
  });
  U.$('#memExport').addEventListener('click', exportMembers);

  const addBtn = U.$('#addMemBtn');
  addBtn.setAttribute('data-write', '1');
  addBtn.addEventListener('click', async () => {
    const id = prompt('新成員的角色 ID（完全字串比對，請確認大小寫）');
    if (!id) return;
    if (A.members.members.some(m => m.id === id)) return U.toast('ID 已存在', 'err');
    const guild = prompt('公會（' + CONFIG.GUILDS.join(' / ') + '）', CONFIG.GUILDS[0]);
    if (!guild) return;
    if (!CONFIG.GUILDS.includes(guild)) return U.toast('公會只能是 ' + CONFIG.GUILDS.join(' / '), 'err');
    A.members.members.push({ id: id, guild: guild, attended: 0, leaves: 0, heretic: 0 });
    await saveMembers('已新增 ' + id);
  });

  U.$('#memSearch').addEventListener('input', e => { A.search = e.target.value; renderMembers(); });
  U.$$('#memTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (A.sortKey === k) A.sortAsc = !A.sortAsc; else { A.sortKey = k; A.sortAsc = true; }
      renderMembers();
    });
  });

  // 預設日期：今天
  U.$('#nvDate').value = new Date().toISOString().slice(0, 10);
}

function switchTab(which) {
  U.$('#tabEvent').classList.toggle('active', which === 'event');
  U.$('#tabMember').classList.toggle('active', which === 'member');
  U.$('#paneEvent').style.display = which === 'event' ? 'block' : 'none';
  U.$('#paneMember').style.display = which === 'member' ? 'block' : 'none';
}

initGate();
