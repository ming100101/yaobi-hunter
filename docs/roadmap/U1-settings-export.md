# U1 — ⚙️ 設定 tab 擴充 + 匯出/匯入備份

**層級**: 支援層 · **工作量**: S/M · **依賴**: P0(kv 儲存)、R2(設定 tab 已存在)

## zh-HK TL;DR
R2 已經起咗「設定」tab(`SettingsView.tsx`,通知 section)。呢個 spec 擴充佢:加 模擬盤參數、主題、篩選預設 sections,全部存 kv;加「匯出/匯入 JSON」備份 pins + settings(port bug 嗰課學到嘅保險)。

## Context (verified facts)
- **設定 tab 已存在**(R2):`src/components/SettingsView.tsx` — 3rd nav tab(`NavTabs.tsx` 的 `'settings'`),用 `.card.set-section` + `.set-head/.set-field/.set-row/.set-actions` pattern(theme.css `.set-*`),寫 kv `notify`。**新 sections 直接加落呢個 view,唔好另起 modal 或 ⚙️ 掣。**
- 其餘 hardcoded knobs: `STRENGTH_THRESHOLD = 70` (`src/types.ts:169`), paper cfg (M1 kv `paper-state.cfg`), theme (F1 kv `theme`).
- kv layer from P0 (`kvGet`/`kvSet`, server-backed keys). Add `settings` to `SERVER_KEYS` in `cache.ts`(`notify` 已加咗).

## Design (decided)
- kv key `settings`:
```json
{ "notify": { "toast": true, "cooldownH": 6 }, "paper": { "riskPct": 1, "startEquity": 10000, "enabled": true },
  "theme": "dark", "screener": { "minVol24h": 0, "regimeFilter": null } }
```
  (Telegram token stays in the raw kv `notify` key — R2 的通知 section 已處理 token,佢個 show/hide 做法唔使掂;export 一定唔可以帶 token。)
- 新 sections 順序加落 SettingsView(通知 section 之後):模擬盤 / 外觀 / 篩選 / 備份,每個一張 `.card.set-section`,照抄 R2 嘅 markup pattern.
- 備份: 匯出 = download `yaobi-backup.json` containing `{pinned, settings, notify(sans token), paper-state.cfg}` via Blob URL; 匯入 = `<input type="file">`, parse, validate keys exist, write each via kvSet, then location.reload().

## Steps
1. `src/components/SettingsView.tsx` — append the four new sections after the existing 通知 section(R2 pattern:`.card.set-section` → `.set-head` → `.set-field`s).
2. Load `settings` on mount (alongside the existing `notify` load); each control writes through to kv on change (no Save button; instant-apply matches the app's live feel and the R2 section's behaviour).
3. Consumers read settings: notify cooldown (browser notify.ts + R2 helper), paper cfg (M1 merges kv settings over defaults), screener filter (U2 reads `settings.screener`), theme (F1).
4. Export/import as designed; import validates with a whitelist of known keys — unknown keys dropped with a console.warn.
5. zh-TW labels: 設定 / 通知 / 模擬盤 / 外觀 / 篩選 / 匯出備份 / 匯入備份.

## Verification
- Change cooldown → kv.json updates; restart app → persists (P0). Export → file contains pins; wipe a pin, import → pin restored after reload. `npm run typecheck`.

## Acceptance
- [ ] 設定 tab 有齊 通知(已有)/模擬盤/外觀/篩選/備份 五個 section,instant-apply.
- [ ] Token never rendered in exports. Import whitelist enforced.
- [ ] Settings survive port changes (server KV).

## 陷阱 / Do-NOT
- Do NOT put the Telegram token in exports (shareable file).
- Do NOT add a settings item without a consumer — every control must already do something. Consumer 未 land(例如 M1 未做 → 冇模擬盤 section 好加)就 skip 嗰個 section,喺 results block 註明.
- Do NOT 重寫 R2 嘅通知 section — 只加新 sections,唔好改佢嘅 endpoints/邏輯.
