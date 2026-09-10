/* 共用小工具 */
const U = {
  $(sel, root) { return (root || document).querySelector(sel); },
  $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

  el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  },

  /* 可收合區塊。展開狀態記在 sessionStorage，重繪後不會跳回去。
     items = [[小標題, 陣列, 是否提供「複製清單」], ...] */
  collapsible(title, items, stateKey, lineOf, copyValueOf) {
    const total = items.reduce((s, it) => s + it[1].length, 0);
    const wrap = U.el('div');
    const label = open => (open ? '▾ ' : '▸ ') + title + '（' + total + ' 筆）';
    const open = sessionStorage.getItem(stateKey) === '1';

    const head = U.el('button', { class: 'ghost sm collapse-head', text: label(open) });
    const body = U.el('div', { style: open ? '' : 'display:none' });
    head.addEventListener('click', () => {
      const nowOpen = body.style.display === 'none';
      body.style.display = nowOpen ? '' : 'none';
      head.textContent = label(nowOpen);
      sessionStorage.setItem(stateKey, nowOpen ? '1' : '0');
    });
    wrap.appendChild(head);

    items.forEach(([sub, arr, copyable]) => {
      const h = U.el('div', { class: 'row' }, [U.el('h3', { text: sub + '（' + arr.length + '）' })]);
      if (copyable) {
        h.appendChild(U.el('button', { class: 'ghost sm', text: '複製清單',
          onclick: () => U.copy(arr.map(copyValueOf || (r => r)).join(', ')) }));
      }
      body.appendChild(h);
      const ul = U.el('ul');
      arr.forEach(r => ul.appendChild(U.el('li', { class: 'mono', text: lineOf(r) })));
      body.appendChild(ul);
    });

    wrap.appendChild(body);
    return wrap;
  },

  /* 一張牌：預設蓋著，revealed = true 直接正面朝上 */
  flipCard(text, big, revealed) {
    const card = U.el('div', {
      class: 'flip-card' + (big ? ' big' : '') + (revealed ? ' revealed' : '') });
    card.appendChild(U.el('div', { class: 'flip-inner' }, [
      U.el('div', { class: 'flip-face flip-back', text: '?' }),
      U.el('div', { class: 'flip-face flip-front', text: text })
    ]));
    return card;
  },

  /* 先在桌上擺 n 張蓋著的牌 */
  dealCards(container, n, big) {
    container.textContent = '';
    const cards = [];
    for (let i = 0; i < n; i++) {
      const c = U.flipCard('', big, false);
      container.appendChild(c);
      cards.push(c);
    }
    return cards;
  },

  /* 一張一張翻開已經擺好的牌。牌數多時翻快一點，避免整場拖太久。
     texts 少於牌數時，多出來的牌翻成「—」 */
  async revealCards(cards, texts) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gap = cards.length <= 3 ? 850 : (cards.length <= 8 ? 600 : 420);
    for (let i = 0; i < cards.length; i++) {
      cards[i].querySelector('.flip-front').textContent =
        texts[i] === undefined ? '—' : texts[i];
      if (!reduce) await new Promise(r => setTimeout(r, gap));
      cards[i].classList.add('revealed');
    }
    if (!reduce) await new Promise(r => setTimeout(r, 500));
  },

  /* 擺牌 + 翻牌一次做完 */
  async flipReveal(container, winners, big) {
    await U.revealCards(U.dealCards(container, winners.length, big), winners);
  },

  /* 直接把已知結果攤在畫面上（重新整理後回復顯示用） */
  flipStatic(container, winners, big) {
    container.textContent = '';
    winners.forEach(w => container.appendChild(U.flipCard(w, big, true)));
  },

  uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  },

  /* 4 位數簽到碼（§9） */
  checkinCode() {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return String(b[0] % 10000).padStart(4, '0');
  },

  maskEmail(email) {
    if (!email) return '';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    const head = name.slice(0, 2);
    const tail = name.length > 3 ? name.slice(-1) : '';
    return head + '****' + tail + '@' + domain;
  },

  fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate());
  },

  fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return U.fmtDate(iso) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  /* 本地日期時間字串 -> ISO（含時區） */
  localToIso(dateStr, timeStr) {
    return new Date(dateStr + 'T' + (timeStr || '00:00') + ':00').toISOString();
  },

  /* 右上角的背景更新指示器。畫面已經有（快取的）內容時，
     用它告訴使用者「正在跟雲端對答案」，而不是讓人以為定格。 */
  busy(on, text) {
    // 各頁在標題旁留一個 #busySlot；沒有的話退回右上角的浮動徽章
    let el = U.$('#busySlot');
    if (!el) {
      el = U.$('#busyBadge');
      if (!el) {
        el = U.el('div', { id: 'busyBadge', class: 'busy-badge' });
        document.body.appendChild(el);
      }
    }
    el.textContent = text || '更新中…';
    el.classList.toggle('show', !!on);
  },

  toast(msg, type) {
    let box = U.$('#toastBox');
    if (!box) {
      box = U.el('div', { id: 'toastBox', class: 'toast-box' });
      document.body.appendChild(box);
    }
    const t = U.el('div', { class: 'toast ' + (type || ''), text: msg });
    box.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  },

  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      U.toast('已複製');
    } catch (e) {
      const ta = U.el('textarea', { class: 'offscreen' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      U.toast('已複製');
    }
  },

  download(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = U.el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  },

  downloadText(filename, text, mime) {
    const blob = new Blob(['\ufeff' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const a = U.el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  },

  /* 通過共用密碼才能看到管理 UI（§7.1） */
  unlocked() { return sessionStorage.getItem('dd_unlocked') === '1'; },
  unlock(input) {
    if (input === CONFIG.PASSCODE) { sessionStorage.setItem('dd_unlocked', '1'); return true; }
    return false;
  },
  lock() { sessionStorage.removeItem('dd_unlocked'); }
};
