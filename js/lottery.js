/* 抽獎演算法
   刻意「不」採用確定性 PRNG：每次抽獎都取用 crypto 的真亂數。
   同一份名單重抽必然得到不同結果，避免「重抽卻抽出一樣的人」被誤認為黑箱。 */

/* [0, max) 的均勻亂數，用拒絕取樣避免模數偏差 */
function randomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(4294967296 / max) * max;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return v % max;
}

/* Fisher–Yates 洗牌後取前 n 位 */
function shuffleTake(pool, n) {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, Math.min(n, a.length));
}

/* 抽出第 index 個獎項。獎項可以任意順序抽，不必照列表由上而下。
   allowRepeat = false：池為基礎名單扣除「其他所有已抽出獎項」的得獎者
   allowRepeat = true ：池為完整基礎名單（加碼），但同一獎項內仍不重複
   池中人數不足時抽到池空為止，shortage 為缺額 */
function drawPrize(base, prizes, index) {
  const prize = prizes[index];
  const won = new Set();
  prizes.forEach((p, i) => {
    if (i !== index) (p.winners || []).forEach(w => won.add(w));
  });

  const pool = prize.allowRepeat ? base.slice() : base.filter(id => !won.has(id));
  const winners = shuffleTake(pool, prize.count);
  return { winners: winners, shortage: Math.max(0, prize.count - winners.length) };
}

/* 已抽出的獎項數（不分順序） */
function drawnCount(prizes) {
  return prizes.filter(p => p.winners && p.winners.length > 0).length;
}

function isDrawn(prize) {
  return !!(prize && prize.winners && prize.winners.length > 0);
}
