# 邊坡圖資編號查詢

Google Apps Script 網頁應用程式。輸入編號定位點位，可看街景、導航、顯示現在位置，底圖可切換國土測繪中心、OpenTopoMap、OpenStreetMap 與 Google（選用）。

圖資存放在擁有者的 Google 雲端硬碟，**本 repo 不存放任何圖資**。誰能看、誰能換圖，完全由雲端硬碟的共用設定決定：

- 圖資檔共用為「檢視者」：可以查詢
- 共用為「編輯者」：可以更換圖資（上傳 KML/KMZ，或從我的地圖同步）
- 沒被共用的帳號：打開只會看到「沒有權限」

## 部署

1. 到 script.google.com 建立新專案
2. 把 `apps-script/Code.gs`、`apps-script/index.html` 貼進去（HTML 檔名用 `index`）
3. 專案設定 → 勾「在編輯器中顯示 appsscript.json」，貼上 `apps-script/appsscript.json`
4. 在編輯器選 `setup` 按「執行」，授權後記錄會出現圖資檔網址
5. 部署 → 新增部署作業 → 網頁應用程式
   - 執行身分：存取網頁應用程式的使用者
   - 存取權：任何擁有 Google 帳戶的使用者
6. 打開部署網址，按「更換圖資」→「立即同步」匯入我的地圖
7. 到雲端硬碟把「邊坡圖資資料.json」共用給要使用的人

## Google 底圖（選用）

到 Google Cloud 啟用 Map Tiles API、建立 API 金鑰（建議限制只能用 Map Tiles API），在 Apps Script「專案設定 → 指令碼屬性」新增 `GOOGLE_MAPS_KEY`。需要綁定帳單帳戶。
