import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strategy = fs.readFileSync(path.join(root, 'src/components/StrategyView.tsx'), 'utf8');
const paper = fs.readFileSync(path.join(root, 'src/components/PaperChip.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/components/CoinDetail.tsx'), 'utf8');
const charts = fs.readFileSync(path.join(root, 'src/components/ChartPanels.tsx'), 'utf8');
const screener = fs.readFileSync(path.join(root, 'src/components/ScreenerList.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsView.tsx'), 'utf8');

let failed = false;
function check(label: string, pass: boolean) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) failed = true;
}

check('balanced risk guard is visible first', strategy.includes('data-testid="strategy-risk-summary"') && strategy.includes('balanced-v1'));
check('strategy lab reads server-owned summary', strategy.includes("fetch('/strategy-lab'"));
check('why no entry is explicit', strategy.includes('而家唔入場'));
check('research limitations use progressive disclosure', strategy.includes('<details className="card strategy-details">'));
check('legacy 20x is not used as a main ranking metric', !strategy.includes('20x ROI'));
check('old A/B/C framework is not on the main screen', !strategy.includes('A/B/C framework'));
check('H1 failed strategies are labelled shadow, not collecting', strategy.includes('H1 歷史失敗 · 影子'));
check('validated remediation cohorts are forward-shadow only', strategy.includes('top-t1-reversal-v2') && strategy.includes('wbottom-w2-uncrowded-v2') && strategy.includes('H1 validation pass · 前向影子') && strategy.includes('未開 badge、Telegram 或 paper'));
check('spot candidate is consolidated to real semantics', strategy.includes('現貨帶動候選（真實語義）') && !strategy.includes("strategyId: 'organic-spot-v0'"));
check('paper chip defaults to confirmed book', paper.includes("paperBook(paper, 'confirmed')"));
check('paper fill details are collapsed', paper.includes('<details className="paper-more">'));
check('coin detail reads only confirmed paper ledger', detail.includes('paper.confirmed?.ledger.filter'));
check('coin detail loads symbol-filtered signal events', detail.includes('/signal-events?symbol='));
check('chart contains TG and confirmed-paper marker sources', charts.includes('tgMarkers') && charts.includes('paperMarkers'));
check('legacy generic buy marker is absent', !charts.includes('text: `買 ${fmtPrice(f.px)}`'));
check('retired screener signals are badge-gated by one policy', ['flushBreakout', 'earlyAccum', 'spotPump', 'rebuildBreakout', 'virginBreakout'].every((key) => screener.includes(`H1_EVIDENCE_DECISION.badges.${key}`)));
check('screener explains ranking-only shadow mode', screener.includes('H1 · 影子模式') && screener.includes('強度／TOP10 只作排名參考'));
check('S15 automatic test feed is visibly locked off', settings.includes('H1 歷史 gate 已失敗，自動測試 TG 已關閉') && settings.includes('disabled={!H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed}'));

if (failed) process.exit(1);
console.log('\nALL PASS');
