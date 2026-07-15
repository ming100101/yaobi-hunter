// Evidence shown in live product surfaces must distinguish a frozen research
// window from forward observations. Keep this copy centralised so badges,
// detail reads, desktop notifications and Telegram cards cannot silently drift.

export const EVIDENCE_AUDIT_AS_OF = '2026-07-14';

export const FORWARD_REVALIDATION_NOTE = 'Binance 前向重驗中，最新結果請看「記錄」';
export const FLUSH_FORWARD_NOTE = `截至 ${EVIDENCE_AUDIT_AS_OF}，Binance 前向未證實 24h 優勢，最新結果請看「記錄」`;

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
    badge: '早期蓄力 — 舊研究窗觀察級；Binance 前向重驗中，非進場訊號',
  },
  spotPump: {
    badge: '現貨帶動 — 現貨量Z 驅動；舊研究窗結果，Binance 前向重驗中，非進場訊號',
  },
  rebuildBreakout: {
    badge: '增倉突破 — OI 縮完重建後帶量突破；舊研究窗結果，Binance 前向重驗中，非進場訊號',
    notify: '舊研究窗曾見提升，但期望值薄；Binance 前向重驗中，最新結果見「記錄」（僅供排序參考）',
  },
  virginBreakout: {
    badge: '處女增倉 — 48h 零 flush 純增倉擴張突破；舊研究窗結果，Binance 前向重驗中，非進場訊號',
    notify: '舊研究窗曾見提升，但期望值薄；Binance 前向重驗中，最新結果見「記錄」（僅供排序參考）',
  },
} as const;
