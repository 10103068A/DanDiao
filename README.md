# 公會活動抽獎系統

純靜態網頁，無建置流程、無框架、無第三方函式庫，也不連任何雲端服務。

## 檔案結構

```
index.html      簡易抽獎（唯一的頁面）
serve.js        本機開發用靜態伺服器

css/style.css
js/util.js      共用工具（DOM、翻牌、提示訊息）
js/lottery.js   crypto 真亂數 + Fisher–Yates 洗牌
js/simple.js    簡易抽獎
```

## 執行

不能用 `file://` 直接開，需要走 http。

```bash
node serve.js
```

會印出網址（預設 http://localhost:4173），換 port 就在後面加數字。

## 使用方式

畫面分三欄：**獎項 / 名單 / 抽獎**。

1. 獎項表格最後一列輸入名稱按 Enter 就新增一列；「可重複」＝加碼（可抽到其他獎項已中獎的人）
2. 名單可逐一輸入，或在「批次輸入」貼上（換行或逗號分隔）
3. **點選要抽的獎項**（右邊會擺上等同名額數的蓋牌），按「阿拉花光」翻牌抽出。獎項可任意順序抽
4. 「複製全部中獎名單」一次複製所有結果；「把結果蛋雕」清空抽獎結果

獎項與名單暫存在 `sessionStorage`：切分頁、重新整理都保留，關掉分頁就清掉。

## 抽獎規則

- 採 crypto 真亂數，**刻意不可重現**：同一份名單重抽必然得到不同結果
- 非加碼獎項的池一律排除「其他所有已抽出獎項」的得獎者，與抽的先後無關
- 加碼獎項可抽到其他獎項的中獎者，但同一獎項內不重複
- 池中人數不足時抽到池空，多出來的牌翻成「—」並顯示缺額提示
- 揭曉用翻牌：先擺上蓋著的牌，再一張一張翻開；遵守 `prefers-reduced-motion`

## 公會名稱

頁首的「蛋雕教」是純 CSS 文字（`css/style.css` 的 `.brand`），不是圖片。
要改名稱就改 `index.html` 裡的 `<span class="guild">`；要換配色改 `.brand` 與 `.guild` 的 `background`。

## 部署（GitHub Pages）

純靜態、無建置流程，推上 `main` 就是部署。
repo 的 Settings → Pages → Source 選 `Deploy from a branch`、分支 `main`、資料夾 `/ (root)`。
