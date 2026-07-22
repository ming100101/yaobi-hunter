import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface CoinDetailModalProps {
  symbol: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
  children?: ReactNode;
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function CoinDetailModal({
  symbol,
  busy,
  error,
  onClose,
  onRetry,
  children,
}: CoinDetailModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="detail-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="detail-modal-chrome">
          <div>
            <div className="detail-modal-eyebrow">幣種詳情</div>
            <div className="detail-modal-title" id={titleId}>
              {symbol}<span>/USDT</span>
              {busy ? <i className="detail-modal-busy" aria-label="同步資料中" /> : null}
            </div>
          </div>
          <button ref={closeRef} className="detail-modal-close" type="button" onClick={onClose} aria-label="關閉幣種詳情">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="detail-modal-scroll">
          {children ?? (
            <div className="detail-modal-state" aria-live="polite">
              {error ? (
                <>
                  <div className="detail-modal-state-icon error" aria-hidden="true">!</div>
                  <h2>暫時拉唔到 {symbol} 資料</h2>
                  <p>{error}</p>
                  <div className="detail-modal-state-actions">
                    <button type="button" className="btn" onClick={onRetry}>再試一次</button>
                    <button type="button" className="btn ghost" onClick={onClose}>關閉</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="detail-skeleton-head">
                    <span className="detail-skeleton-block wide" />
                    <span className="detail-skeleton-block short" />
                  </div>
                  <div className="detail-skeleton-grid">
                    <span className="detail-skeleton-block" />
                    <span className="detail-skeleton-block" />
                    <span className="detail-skeleton-block" />
                    <span className="detail-skeleton-block" />
                  </div>
                  <span className="detail-skeleton-chart" />
                  <p>正在拉取 {symbol} 完整圖表與指標…</p>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
