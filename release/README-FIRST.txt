妖幣獵手 · Yaobi Hunter — Public Beta
=====================================

系統要求
  Windows 10 / 11（64-bit）
  連線至 Binance / OKX 公開市場資料

開始使用
  1. 解壓整個 ZIP。
  2. 啟動 YaobiHunter.exe。
  3. 瀏覽器 App 視窗會在本機開啟。
  4. 如要 Telegram 提醒，到「設定」加入自己的 Bot Token 與 Chat ID。

安全重點
  - 本程式不需要交易所 API key，亦不會自動落單。
  - 只從 https://github.com/ming100101/yaobi-hunter/releases 下載。
  - 請用同一頁公布的 SHA256SUMS.txt 驗證檔案。
  - 未有付費 code-signing 憑證前，Windows SmartScreen 可能顯示未知發行者。
  - Telegram Token、Chat ID、備份及 kv.json 都屬敏感資料，切勿公開。

資料位置
  %LOCALAPPDATA%\YaobiHunter

停止背景記錄
  在專案原始碼目錄執行：
  powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 kill

重要聲明
  本程式只供市場研究及教育用途，不是投資或買賣建議。訊號、回測、
  模擬盤及圖表可能延誤、不完整或錯誤；加密貨幣及衍生品可導致全部
  本金損失。請自行核實資料及承擔所有決定。

完整說明
  https://github.com/ming100101/yaobi-hunter
  https://github.com/ming100101/yaobi-hunter/blob/master/PRIVACY.md
  https://github.com/ming100101/yaobi-hunter/blob/master/DISCLAIMER.md
