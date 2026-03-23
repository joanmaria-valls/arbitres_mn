export function formatDurationSeconds(totalSeconds?: number) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)))
  const mm = Math.floor(safe / 60)
  const ss = safe % 60
  return `${mm} min ${String(ss).padStart(2, '0')} s`
}

export function formatDurationShort(totalSeconds?: number) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)))
  const mm = Math.floor(safe / 60)
  const ss = safe % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}
