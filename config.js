// 前台設定（這兩個值公開沒關係，真正的權限由後台檢查）
window.SLOPE_CONFIG = {
  // Apps Script「部署 → 網頁應用程式」的網址，結尾是 /exec
  API_URL: '貼上 Apps Script 部署網址',
  // Google Cloud「憑證 → OAuth 用戶端 ID（網頁應用程式）」
  CLIENT_ID: '貼上 OAuth 用戶端 ID'
};
