/**
 * Parses `vm_stat` output. On macOS os.freemem() reports only completely free
 * pages, ignoring inactive pages the kernel can reclaim, which makes a normal
 * Mac look almost out of memory. Following psutil, we treat free + inactive
 * pages as available.
 */
export function availableBytesFromVmStat(output: string): number {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  const pages = (label: string) => Number(new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'm').exec(output)?.[1]);

  const free = pages('free');
  const inactive = pages('inactive');
  if (![pageSize, free, inactive].every(Number.isFinite)) {
    throw new Error('Unrecognised vm_stat output');
  }
  return (free + inactive) * pageSize;
}
