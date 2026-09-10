/* 簡易抽獎：與活動流程完全無關，不寫檔、不進雲端。
   獎項與名單暫存在 sessionStorage，切分頁不會不見，關掉分頁就清掉。
   操作方式與進行中活動頁一致：先建獎項，點選要抽的那項，按下去翻牌。 */

const S = {
  names: [],       // 參加者
  prizes: [],      // { id, name, count, allowRepeat, winners }
  selected: null,  // 目前選取的獎項 id
  drawing: false
};

/* 暫存在 sessionStorage：切分頁、重新整理都保留，關掉分頁就清掉。
   不寫檔、不進雲端，與活動資料完全無關。 */
const SP_KEY = 'dd_simple';

function save() {
  try {
    sessionStorage.setItem(SP_KEY, JSON.stringify({
      names: S.names, prizes: S.prizes, selected: S.selected
    }));
  } catch (e) { /* 存不進去就算了，不影響操作 */ }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(SP_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    S.names = Array.isArray(d.names) ? d.names : [];
    S.prizes = Array.isArray(d.prizes) ? d.prizes : [];
    S.selected = d.selected || null;
  } catch (e) { /* 壞掉就當作空的 */ }
}

/* ---------- 名單 ---------- */
function renderNames() {
  const box = U.$('#spList');
  box.textContent = '';
  S.names.forEach((n, i) => {
    const item = U.el('div', { class: 'name-item' }, [U.el('span', { text: n })]);
    item.appendChild(U.el('button', { text: '✕', title: '移除',
      onclick: () => { S.names.splice(i, 1); renderNames(); } }));
    box.appendChild(item);
  });
  U.$('#spTotal').textContent = S.names.length;
  save();
  renderStage();
}

function addNames(raw) {
  const parts = String(raw).split(/[\n,，、\t]/).map(s => s.trim()).filter(s => s);
  let added = 0, dup = 0;
  parts.forEach(n => {
    if (S.names.includes(n)) { dup++; return; }
    S.names.push(n);
    added++;
  });
  renderNames();
  if (dup) U.toast('加入 ' + added + ' 人，略過重複 ' + dup + ' 人');
  else if (added) U.toast('加入 ' + added + ' 人');
}

/* ---------- 獎項 ---------- */
function selectedPrize() { return S.prizes.find(p => p.id === S.selected) || null; }
function prizeDrawn(p) { return !!(p && p.winners && p.winners.length); }

function ensureSelection() {
  if (selectedPrize()) return;
  const next = S.prizes.find(p => !prizeDrawn(p)) || S.prizes[S.prizes.length - 1];
  S.selected = next ? next.id : null;
}

function selectPrize(id) {
  if (S.drawing) return;
  S.selected = id;
  save();
  renderPrizes();
  renderStage();
}

function renderPrizes() {
  const tb = U.$('#spPrizeTable tbody');
  tb.textContent = '';

  S.prizes.forEach((p, i) => {
    const locked = prizeDrawn(p);
    const tr = U.el('tr', { class: 'prize-row' + (locked ? ' locked' : '') +
                                   (p.id === S.selected ? ' selected' : '') });
    tr.addEventListener('click', e => {
      if (e.target.closest('input, button')) return;
      selectPrize(p.id);
    });

    const nameIn = U.el('input', { value: p.name, size: 8 });
    nameIn.disabled = locked;
    nameIn.addEventListener('change', () => { p.name = nameIn.value; save(); renderStage(); });
    tr.appendChild(U.el('td', {}, [nameIn]));

    const cntIn = U.el('input', { type: 'number', min: 1, value: p.count });
    cntIn.style.width = '52px';
    cntIn.disabled = locked;
    cntIn.addEventListener('change', () => {
      p.count = Math.max(1, parseInt(cntIn.value, 10) || 1);
      save();
      renderStage();
    });
    tr.appendChild(U.el('td', {}, [cntIn]));

    // 可重複：勾選後本獎項可抽到其他獎項的中獎者（加碼）
    const repIn = U.el('input', { type: 'checkbox',
      title: '勾選後本獎項可抽到其他獎項已中獎的人（加碼用）' });
    repIn.checked = !!p.allowRepeat;
    repIn.disabled = locked;
    repIn.addEventListener('change', () => { p.allowRepeat = repIn.checked; save(); renderStage(); });
    tr.appendChild(U.el('td', {}, [repIn]));

    const w = U.el('td', { class: 'small', text: (p.winners || []).join('、') });
    if (p.allowRepeat) w.appendChild(U.el('span', { class: 'tag bonus', text: '加碼' }));
    tr.appendChild(w);

    const del = U.el('button', { class: 'ghost sm', text: '✕' });
    del.addEventListener('click', () => {
      S.prizes.splice(i, 1);
      if (p.id === S.selected) S.selected = null;
      save();
      renderPrizes();
      renderStage();
    });
    tr.appendChild(U.el('td', {}, [del]));

    tb.appendChild(tr);
  });

  tb.appendChild(draftRow());
}

/* 固定留在最後一列的待輸入列 */
function draftRow() {
  const tr = U.el('tr', { class: 'prize-row draft' });
  const nameIn = U.el('input', { placeholder: '輸入獎項名稱', size: 8 });
  const cntIn = U.el('input', { type: 'number', min: 1, value: 1 });
  cntIn.style.width = '52px';
  const repIn = U.el('input', { type: 'checkbox',
    title: '勾選後本獎項可抽到其他獎項已中獎的人（加碼用）' });

  // Enter 會同時觸發 keydown 與 change，用旗標擋掉第二次
  let done = false;
  const commit = () => {
    if (done || !nameIn.value.trim()) return;
    done = true;
    const added = { id: U.uid('sp'), name: nameIn.value.trim(),
                    count: Math.max(1, parseInt(cntIn.value, 10) || 1),
                    allowRepeat: repIn.checked, winners: [] };
    S.prizes.push(added);
    if (!selectedPrize() || prizeDrawn(selectedPrize())) S.selected = added.id;
    save();
    renderPrizes();
    renderStage();
    const next = U.$('#spPrizeTable tbody tr.draft input');
    if (next) next.focus();
  };
  nameIn.addEventListener('change', commit);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
  cntIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });

  tr.appendChild(U.el('td', {}, [nameIn]));
  tr.appendChild(U.el('td', {}, [cntIn]));
  tr.appendChild(U.el('td', {}, [repIn]));
  tr.appendChild(U.el('td', { class: 'small muted', text: '按 Enter 新增' }));
  tr.appendChild(U.el('td', {}));
  return tr;
}

/* ---------- 舞台 ---------- */
function renderStage() {
  ensureSelection();
  const p = selectedPrize();
  const cw = U.$('#spWinners');
  const btn = U.$('#spDraw');

  U.$('#spCurPrize').textContent = p ? p.name : '—';
  U.$('#spBonus').style.display = p && p.allowRepeat ? 'inline-block' : 'none';
  if (S.drawing) return;

  if (!p) {
    btn.disabled = true;
    cw.textContent = '';
    U.$('#spHint').textContent = '請先在左邊新增獎項';
    return;
  }
  if (prizeDrawn(p)) {
    btn.disabled = true;
    U.$('#spHint').textContent = '這個獎項已經抽過了，點左邊其他獎項繼續';
    U.flipStatic(cw, p.winners, false);
    return;
  }

  const pool = poolFor(p);
  btn.disabled = !pool.length;
  U.$('#spHint').textContent = !S.names.length ? '請先輸入名單'
    : (!pool.length ? '沒有人可以抽了（都中過獎）'
    : (pool.length < p.count ? '可抽人數只有 ' + pool.length + ' 人，少於名額 ' + p.count : ''));
  U.dealCards(cw, p.count, false);
}

/* 本獎項的抽獎池：勾了「可重複」才吃得到其他獎項的中獎者 */
function poolFor(prize) {
  if (prize.allowRepeat) return S.names.slice();
  const won = new Set();
  S.prizes.forEach(p => { if (p !== prize) (p.winners || []).forEach(w => won.add(w)); });
  return S.names.filter(n => !won.has(n));
}

async function draw() {
  const p = selectedPrize();
  if (!p || S.drawing || prizeDrawn(p)) return;
  const pool = poolFor(p);
  if (!pool.length) return U.toast('沒有人可以抽了', 'err');

  S.drawing = true;
  U.$('#spDraw').disabled = true;
  U.$('#spHint').textContent = '';
  try {
    const winners = shuffleTake(pool, p.count);
    const cards = U.dealCards(U.$('#spWinners'), p.count, false);
    await U.revealCards(cards, winners);
    p.winners = winners;
    save();
  } catch (e) {
    U.toast('抽獎發生錯誤：' + e.message, 'err');
  } finally {
    S.drawing = false;
    renderPrizes();
    renderStage();
  }
}

/* ---------- 綁定 ---------- */
U.$('#spAdd').addEventListener('click', () => {
  const v = U.$('#spOne').value.trim();
  if (!v) return;
  addNames(v);
  U.$('#spOne').value = '';
  U.$('#spOne').focus();
});
U.$('#spOne').addEventListener('keydown', e => { if (e.key === 'Enter') U.$('#spAdd').click(); });

U.$('#spBulkAdd').addEventListener('click', () => {
  const v = U.$('#spBulk').value.trim();
  if (!v) return;
  addNames(v);
  U.$('#spBulk').value = '';
});

U.$('#spClear').addEventListener('click', () => {
  if (!S.names.length) return;
  if (!confirm('清空整份名單？')) return;
  S.names = [];
  renderNames();
});

U.$('#spReset').addEventListener('click', () => {
  if (!S.prizes.some(prizeDrawn)) return U.toast('還沒有中獎結果', 'err');
  if (!confirm('要把目前所有中獎結果蛋雕掉，重新抽一次嗎？')) return;
  S.prizes.forEach(p => { p.winners = []; });
  S.selected = null;
  save();
  renderPrizes();
  renderStage();
  U.toast('已蛋雕，可以重新抽獎');
});

U.$('#spDraw').addEventListener('click', draw);

U.$('#spCopy').addEventListener('click', () => {
  const lines = S.prizes.filter(prizeDrawn).map(p => p.name + '：' + p.winners.join('、'));
  if (!lines.length) return U.toast('還沒有中獎結果', 'err');
  U.copy(lines.join('\n'));
});

restore();
renderPrizes();
renderNames();
