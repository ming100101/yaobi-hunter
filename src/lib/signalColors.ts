// Fixed, ordered palette for Signal Read (型態解讀) colour-coding. A signal's
// colour is its DISPLAY-ORDER index in the insight list (never by id) — at most
// MAX_INSIGHTS (6) show at once, so the first entries never repeat within a view.
// The same index → same colour in both the Signal Read list and the K-line
// marker, which is what visually ties a read to its candle.
//
// Hues are bright and mutually well-separated so they read clearly on the dark
// violet background (#0b0716) and don't blend with the semantic up/down/accent
// colours. First six are the most hue-separated (that's the common case).
export const SIGNAL_COLORS = [
  '#2dd4bf', // teal
  '#fbbf24', // amber
  '#f472b6', // pink
  '#a3e635', // lime
  '#818cf8', // indigo
  '#fb923c', // orange
  '#e879f9', // fuchsia
  '#facc15', // gold
];

export function signalColor(i: number): string {
  return SIGNAL_COLORS[((i % SIGNAL_COLORS.length) + SIGNAL_COLORS.length) % SIGNAL_COLORS.length];
}
