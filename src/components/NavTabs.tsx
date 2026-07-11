export type AppTab = 'scan' | 'search' | 'pushes' | 'strategy' | 'history' | 'settings';

export default function NavTabs({ tab, onTab }: { tab: AppTab; onTab: (t: AppTab) => void }) {
  return (
    <div className="nav-tabs" role="tablist" aria-label="主要頁面">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'scan'}
        className={`nav-tab${tab === 'scan' ? ' active' : ''}`}
        onClick={() => onTab('scan')}
      >
        掃描
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'search'}
        className={`nav-tab${tab === 'search' ? ' active' : ''}`}
        onClick={() => onTab('search')}
      >
        搜尋
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'pushes'}
        className={`nav-tab${tab === 'pushes' ? ' active' : ''}`}
        onClick={() => onTab('pushes')}
      >
        推送
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'strategy'}
        className={`nav-tab${tab === 'strategy' ? ' active' : ''}`}
        onClick={() => onTab('strategy')}
      >
        策略
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'history'}
        className={`nav-tab${tab === 'history' ? ' active' : ''}`}
        onClick={() => onTab('history')}
      >
        記錄
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'settings'}
        className={`nav-tab${tab === 'settings' ? ' active' : ''}`}
        onClick={() => onTab('settings')}
      >
        設定
      </button>
    </div>
  );
}
