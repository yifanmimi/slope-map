# 邊坡圖資編號查詢

輸入編號就能定位到 Google 我的地圖匯出的點位，可看街景、開 Google 地圖導航。底圖有國土測繪中心電子地圖、正射影像和 OpenStreetMap。

## 圖資來源

`map.kml` 由 GitHub Actions 自動從 Google 我的地圖下載，每天同步一次。在我的地圖上修改點位後，想立刻更新：到 Actions →「同步我的地圖」→ Run workflow。

要換成另一張地圖：編輯 `map-source.txt`，貼上新地圖的網址（含 `mid=` 的那種），存檔後會自動同步。地圖要設成「知道連結的人都能檢視」才抓得到。
