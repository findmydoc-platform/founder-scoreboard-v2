export function createLatestTeamWorkweekRequestRunner<T>({
  load,
  onError,
  onSettled,
  onStart,
  onSuccess,
}: {
  load: () => Promise<T>;
  onError: (error: unknown) => void;
  onSettled: () => void;
  onStart: () => void;
  onSuccess: (value: T) => void;
}) {
  let latestRequestId = 0;
  let loadRequest = load;

  return {
    invalidate() {
      latestRequestId += 1;
    },
    async run() {
      const requestId = ++latestRequestId;
      onStart();
      try {
        const value = await loadRequest();
        if (requestId === latestRequestId) onSuccess(value);
      } catch (error) {
        if (requestId === latestRequestId) onError(error);
      } finally {
        if (requestId === latestRequestId) onSettled();
      }
    },
    setLoad(nextLoad: () => Promise<T>) {
      loadRequest = nextLoad;
    },
  };
}
