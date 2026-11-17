type PendingLookup = {
  start: () => void;
};

const MAX_PARALLEL_LIBRESPOT_LOOKUPS = 2;

export const runLibrespotArtistDisplayLookup = createTaskLimiter(
  MAX_PARALLEL_LIBRESPOT_LOOKUPS,
);

function createTaskLimiter(maxParallel: number) {
  let activeCount = 0;
  const pending: PendingLookup[] = [];

  return async function run<T>(
    task: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    await acquire(signal);
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      release();
    }
  };

  function acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());

    return new Promise<void>((resolve, reject) => {
      const entry: PendingLookup = {
        start: () => {
          signal.removeEventListener("abort", cancel);
          activeCount += 1;
          resolve();
        },
      };
      const cancel = () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
        reject(abortError());
      };

      if (activeCount < maxParallel) {
        entry.start();
        return;
      }

      pending.push(entry);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  function release() {
    activeCount = Math.max(0, activeCount - 1);
    pending.shift()?.start();
  }
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}
