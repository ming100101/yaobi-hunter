import type {
  IChartApi,
  ISeriesApi,
  LogicalRange,
  MouseEventParams,
  SeriesType,
} from 'lightweight-charts';

export interface SyncEntry {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
}

/**
 * Keeps a set of stacked charts aligned: shared visible range and a
 * crosshair that follows the hovered chart across every panel.
 */
export class ChartSync {
  private entries: SyncEntry[] = [];
  private applyingRange = false;
  private applyingCross = false;

  register(entry: SyncEntry): () => void {
    this.entries.push(entry);

    const onRange = (range: LogicalRange | null) => {
      if (!range || this.applyingRange) return;
      this.applyingRange = true;
      for (const e of this.entries) {
        if (e !== entry) e.chart.timeScale().setVisibleLogicalRange(range);
      }
      this.applyingRange = false;
    };

    const onCross = (param: MouseEventParams) => {
      if (this.applyingCross) return;
      this.applyingCross = true;
      const logical = param.logical == null ? null : Math.round(param.logical as number);
      for (const e of this.entries) {
        if (e === entry) continue;
        if (logical == null || param.time == null) {
          e.chart.clearCrosshairPosition();
          continue;
        }
        const bar = e.series.dataByIndex(logical) as { value?: number; close?: number } | null;
        const v = bar == null ? undefined : bar.value ?? bar.close;
        if (v == null) {
          e.chart.clearCrosshairPosition();
        } else {
          e.chart.setCrosshairPosition(v, param.time, e.series);
        }
      }
      this.applyingCross = false;
    };

    entry.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    entry.chart.subscribeCrosshairMove(onCross);

    return () => {
      entry.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      entry.chart.unsubscribeCrosshairMove(onCross);
      this.entries = this.entries.filter((e) => e !== entry);
    };
  }
}
