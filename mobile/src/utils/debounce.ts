export function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number, options?: { leading?: boolean; trailing?: boolean }) {
  let timeout: any = null;
  let lastArgs: any[] | null = null;
  const leading = options?.leading ?? false;
  const trailing = options?.trailing ?? true;
  let didLead = false;

  function invoke() {
    if (lastArgs) {
      fn.apply(null, lastArgs as any);
      lastArgs = null;
    }
  }

  const debounced = (...args: any[]) => {
    lastArgs = args;
    if (leading && !didLead) {
      didLead = true;
      fn.apply(null, args as any);
    }
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (trailing) invoke();
      didLead = false;
      timeout = null;
    }, waitMs);
  };

  (debounced as any).flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (trailing) invoke();
    didLead = false;
  };

  (debounced as any).cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastArgs = null;
    didLead = false;
  };

  return debounced as T & { flush: () => void; cancel: () => void };
}


