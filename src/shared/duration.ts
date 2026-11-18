/** "45s", "12m", "7h 59m": a duration as short as a refusal line or a toast wants it (server and client alike). */
export function shortDuration(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
