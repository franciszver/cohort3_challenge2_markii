type Listener = (msg: string) => void;

const listeners = new Set<Listener>();

export function showToast(message: string) {
  for (const l of Array.from(listeners)) {
    try { l(message); } catch {}
  }
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}


