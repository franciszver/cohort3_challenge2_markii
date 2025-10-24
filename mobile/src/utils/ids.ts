let localIdCounter = 0;

export function generateLocalId(prefix = 'local'): string {
  const ts = Date.now();
  const ctr = (localIdCounter = (localIdCounter + 1) % 1_000_000);
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}-${ts}-${ctr}-${rand}`;
}


