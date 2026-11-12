# 邊坡圖資編號查詢

前台：GitHub Pages（本 repo 根目錄的 `index.html`、`config.js`）
後台：Google Apps Script（`apps-script/`），圖資存在擁有者的 Google 雲端硬碟，本 repo 不存放任何圖資。

使用者在前台用 Google 帳號登入，後台驗證身分後，依試算表「邊坡圖資權限」決定權限：「查看」可以查詢，「編輯」可以更換圖資和管理權限，其他帳號一律拒絕。權限可以直接改試算表，也可以在網頁的「管理」裡新增、修改、移除。

## 一、建立 OAuth 用戶端 ID

1. 到 Google Cloud Console 建立（或選擇）專案
2. 「API 和服務 → OAuth 同意畫面」：使用者類型選「外部」，填應用程式名稱與信箱，範圍不用加，最後按「發布應用程式」
3. 「憑證 → 建立憑證 → OAuth 用戶端 ID」：類型選「網頁應用程式」，「已授權的 JavaScript 來源」填 `https://yifanmimi.github.io`
4. 複製用戶端 ID

## 二、部署後台

1. script.google.com 建立新專案，貼上 `apps-script/Code.gs`
2. 專案設定：勾「在編輯器中顯示 appsscript.json」，貼上 `apps-script/appsscript.json`；在「指令碼屬性」新增 `CLIENT_ID` = 上一步的用戶端 ID
3. 編輯器選 `setup` 按「執行」並授權（只有你自己需要授權一次）
4. 部署 → 新增部署作業 → 網頁應用程式，執行身分「我」，存取權「所有人」，複製網址（結尾 `/exec`）

## 三、設定前台

編輯 `config.js`，填入 `API_URL`（後台網址）與 `CLIENT_ID`。

## 四、匯入圖資與開權限

1. 打開 https://yifanmimi.github.io/slope-map/ 登入，按「更換圖資」→「立即同步」
2. 在「管理 → 權限管理」新增同事帳號，或直接編輯試算表「邊坡圖資權限」
3. 權限有 5 分鐘快取，想立刻生效可在 Apps Script 執行 `clearAccessCache`

## Google 底圖（選用）

Google Cloud 啟用 Map Tiles API、建立 API 金鑰（應用程式限制：網站 `https://yifanmimi.github.io/*`；API 限制：Map Tiles API），在指令碼屬性新增 `GOOGLE_MAPS_KEY`。需要綁定帳單帳戶。
