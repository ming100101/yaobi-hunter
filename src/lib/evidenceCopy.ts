// Evidence shown in live product surfaces must distinguish a frozen research
// window from forward observations. Keep this copy centralised so badges,
// detail reads, desktop notifications and Telegram cards cannot silently drift.

export const EVIDENCE_AUDIT_AS_OF = '2026-07-21';

export const FORWARD_REVALIDATION_NOTE = '2026 H1 歷史 gate 已失敗；只保留 shadow evidence，最新結果請看「記錄」';
export const FLUSH_FORWARD_NOTE = `截至 ${EVIDENCE_AUDIT_AS_OF}，H1 歷史 gate 已失敗；badge、通知同新 paper entry 已關閉，只保留 shadow evidence`;

export function oldStudyEvidence(summary: string, forwardNote = FORWARD_REVALIDATION_NOTE): string {
  return `舊研究窗：${summary}。${forwardNote}；非現時命中率，僅供排序參考。`;
}

export const SIGNAL_EVIDENCE_COPY = {
  flushBreakout: {
    badge:
      `縮倉突破 — 舊研究窗曾見 lift ×2.0；${FLUSH_FORWARD_NOTE}`,
    filter:
      `只顯示縮倉突破訊號。舊研究窗曾見提升；${FLUSH_FORWARD_NOTE}`,
    empty: '目前沒有縮倉突破訊號。此訊號本身稀少；歷史出現次數不代表現時頻率，最新結果請看「記錄」。',
    notify:
      `舊研究窗曾見提升；${FLUSH_FORWARD_NOTE}（僅供排序參考）`,
  },
  earlyAccum: {
    badge: '早期蓄力 — H1 歷史 gate 已失敗；只保留 shadow evidence，非進場訊號',
  },
  spotPump: {
    badge: '現貨帶動 — H1 只列細樣本候選；只保留真實語義 forward shadow，非進場訊號',
  },
  rebuildBreakout: {
    badge: '增倉突破 — H1 歷史 gate 已失敗；只保留 shadow evidence，非進場訊號',
    notify: 'H1 歷史 gate 已失敗；通知已關閉，只保留 shadow evidence',
  },
  virginBreakout: {
    badge: '處女增倉 — H1 歷史 gate 已失敗；只保留 shadow evidence，非進場訊號',
    notify: 'H1 歷史 gate 已失敗；通知已關閉，只保留 shadow evidence',
  },
} as const;
