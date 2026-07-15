import { useEffect } from 'react';
import { EVIDENCE_AUDIT_AS_OF } from '../lib/evidenceCopy';

// U3 help modal. Deliberately does NOT hardcode per-signal lift numbers (×2.04
// etc.): those are under active monthly revalidation (E1 / the 2026-07-08 baseline
// audit put several in flux), and the U3 spec's 陷阱 says the modal must track E1
// conclusions rather than parrot stale stats. So signals are explained by what
// they MEAN + the honest "demonstrative, revalidated monthly" framing, with the
// numbers living in the roadmap reports where they can change without a UI edit.
export default function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-modal card"
        role="dialog"
        aria-modal="true"
        aria-label="使用說明"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-close" type="button" onClick={onClose} aria-label="關閉">
          ✕
        </button>
        <h2 className="help-title">妖幣獵手 · 使用說明</h2>

        <section>
          <h3>符號</h3>
          <ul>
            <li>
              <b>⚡ 縮倉突破</b> — 歷史研究衍生嘅突破訊號，有通知；現時仍做 Binance 前向重驗。
            </li>
            <li>
              <b>蓄 早期蓄力</b> — 觀察名單級,非進場訊號,無通知。
            </li>
            <li>
              <b>增 增倉突破 / 擴 處女增倉</b> — 歷史研究衍生嘅突破變體，前向重驗中，非進場。
            </li>
            <li>
              <b>現 現貨帶動</b> — 現貨量驅動嘅拉升,排序參考。
            </li>
            <li>
              <b>T10 · 時長</b> — 入強度前十有幾耐。 <b>📌</b> — 置頂並優先掃描。
            </li>
          </ul>
        </section>

        <section>
          <h3>欄位</h3>
          <ul>
            <li>
              <b>階段</b>(蓄力 / 拉升 / 出貨)— 資金動態分類。
            </li>
            <li>
              <b>強度</b>(0-100)— 綜合示範性評分。
            </li>
            <li>
              <b>OI 4h</b> — 未平倉合約 4 小時變化。 <b>資金</b> — funding rate。 <b>風險</b> — 風險旗標數。
            </li>
          </ul>
        </section>

        <section>
          <h3>點用</h3>
          <p>每 15 分鐘全市場掃描 · 搜尋 tab 查任何幣 · 詳情頁 20 秒自動更新。</p>
        </section>

        <section className="help-honest">
          <h3>誠實聲明</h3>
          <p>
            強度與階段為示範性評分。訊號嘅回測數字都有單一市況窗口等限制,<b>每月重驗證</b>
            (數字隨之更新,詳見 roadmap 報告),部分訊號嘅預測力仍在覆核中。畫面標示嘅「舊研究窗」唔係現時命中率；
            截至 {EVIDENCE_AUDIT_AS_OF}，⚡ 嘅 Binance 前向資料未證實 24h 優勢，最新數字請睇「記錄」。<b>非投資建議。</b>
          </p>
        </section>
      </div>
    </div>
  );
}
