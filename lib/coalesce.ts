/**
 * Wraps `run` so concurrent calls per key are coalesced without serving stale
 * work: a call made while a run for its key is in flight cannot join that run
 * (it began before the caller's latest change), so it waits for one follow-up
 * run, which every caller arriving meanwhile shares. N simultaneous calls cost
 * at most two runs, and every caller's result started after it called.
 */
export function createCoalescedRunner(run: (key: string) => Promise<void>) {
  const runs = new Map<
    string,
    { running: Promise<void>; queued: Promise<void> | null }
  >();

  const start = (key: string): Promise<void> =>
    run(key).finally(() => {
      const current = runs.get(key);

      // A queued run takes the entry over when it starts.
      if (current && !current.queued) {
        runs.delete(key);
      }
    });

  return (key: string): Promise<void> => {
    const state = runs.get(key);

    if (!state) {
      const running = start(key);
      runs.set(key, { running, queued: null });
      return running;
    }

    state.queued ??= state.running
      .catch(() => undefined)
      .then(() => {
        const running = start(key);
        runs.set(key, { running, queued: null });
        return running;
      });

    return state.queued;
  };
}
