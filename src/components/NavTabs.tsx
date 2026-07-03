export type AppTab = 'scan' | 'search';

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
    </div>
  );
}
