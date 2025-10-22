export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const oneMinute = 60 * 1000;
    const oneHour = 60 * oneMinute;
    const oneDay = 24 * oneHour;
    if (diffMs < oneMinute) return 'just now';
    if (diffMs < oneHour) return `${Math.floor(diffMs / oneMinute)}m ago`;
    if (diffMs < oneDay) return `${Math.floor(diffMs / oneHour)}h ago`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function formatLastSeen(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const oneMinute = 60 * 1000;
    const oneHour = 60 * oneMinute;
    const oneDay = 24 * oneHour;
    if (diffMs < oneMinute) return 'last seen just now';
    if (diffMs < oneHour) return `last seen ${Math.floor(diffMs / oneMinute)}m ago`;
    if (diffMs < oneDay) return `last seen ${Math.floor(diffMs / oneHour)}h ago`;
    return `last seen ${d.toLocaleString()}`;
  } catch {
    return undefined;
  }
}


