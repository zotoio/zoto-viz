let writes = 0;

export function resetPluginConfigWriteMetrics(): void {
  writes = 0;
}

export function readPluginConfigWriteMetrics(): { writes: number } {
  return { writes };
}

export function recordPluginConfigWrite(): void {
  writes += 1;
}
