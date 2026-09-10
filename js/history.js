/* 歷史活動頁（公開，§7.4） */

(async function () {
  await Store.init();
  const box = U.$('#list');

  const draw = data => {
    box.textContent = '';
    const events = (data && data.events || []).slice()
      .sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt));
    if (!events.length) {
      box.appendChild(U.el('p', { class: 'empty', text: '目前沒有歷史活動。' }));
      return;
    }
    events.forEach(ev => box.appendChild(card(ev)));
  };

  // 先畫上次的快取，再背景更新
  const cached = Store.readLocal('history');
  if (cached) draw(cached);

  U.busy(true);
  try {
    draw(await Store.read('history'));
  } catch (e) {
    if (!cached) box.appendChild(U.el('p', { class: 'empty', text: '讀取失敗：尚未找到聖所位置' }));
  } finally {
    U.busy(false);
  }

  /* 匯出該場的中獎名單（CSV，Excel 可開） */
  function exportWinners(ev) {
    const rows = [['活動', '獎項', '加碼', '得獎者']];
    ((ev.lottery || {}).prizes || []).forEach(p => {
      (p.winners || []).forEach(w => rows.push([ev.name, p.name, p.allowRepeat ? 'Y' : '', w]));
    });
    if (rows.length === 1) return U.toast('這場沒有中獎紀錄', 'err');
    U.downloadText(U.fmtDate(ev.eventAt).replace(/\//g, '') + '-' + ev.name + '-中獎名單.csv',
      rows.map(r => r.join(',')).join('\n'));
  }

  function card(ev) {
    const c = U.el('div', { class: 'card' });
    const head = U.el('div', { class: 'row' }, [
      U.el('strong', { text: U.fmtDate(ev.eventAt) + '　' + ev.name }),
      U.el('span', { class: 'muted small',
        text: '報名 ' + ev.registered + '/' + ev.memberCount + '　簽到 ' + ev.checkedIn })
    ]);
    const toggle = U.el('button', { class: 'ghost sm', text: '展開' });
    head.appendChild(toggle);
    c.appendChild(head);

    const body = U.el('div', { style: 'display:none;margin-top:10px' });
    toggle.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? '展開' : '收合';
    });

    const lot = ev.lottery || {};

    // 中獎名單
    const t = U.el('table');
    t.appendChild(U.el('thead', {}, [U.el('tr', {}, [
      U.el('th', { text: '獎項' }), U.el('th', { text: '數量' }),
      U.el('th', { text: '加碼' }), U.el('th', { text: '得獎者' })
    ])]));
    const tb = U.el('tbody');
    (lot.prizes || []).forEach(p => {
      tb.appendChild(U.el('tr', {}, [
        U.el('td', { text: p.name }),
        U.el('td', { text: String(p.count) }),
        U.el('td', {}, [p.allowRepeat ? U.el('span', { class: 'tag bonus', text: '加碼' })
                                      : U.el('span', { text: '' })]),
        U.el('td', { class: 'mono', text: (p.winners || []).join('、') })
      ]));
    });
    t.appendChild(tb);
    body.appendChild(U.el('h3', { text: '中獎名單' }));
    body.appendChild(t);

    body.appendChild(U.el('div', { class: 'small muted', style: 'margin-top:8px',
      text: '抽出時間：' + (lot.drawnAt ? U.fmtDateTime(lot.drawnAt) : '—') }));

    body.appendChild(U.el('h3', { text: '參加者名單（' + (lot.participants || []).length + ' 人）',
      style: 'margin-top:12px' }));
    body.appendChild(U.el('div', { class: 'mono small', text: (lot.participants || []).join('、') }));

    body.appendChild(U.el('button', { class: 'ghost sm', style: 'margin-top:14px',
      text: '匯出中獎名單', onclick: () => exportWinners(ev) }));

    c.appendChild(body);
    return c;
  }
})();
