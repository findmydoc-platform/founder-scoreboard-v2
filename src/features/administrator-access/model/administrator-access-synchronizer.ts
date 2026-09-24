export type AdministratorAccessReadToken = Readonly<{
  epoch: number;
  sequence: number;
}>;

export type AdministratorAccessSynchronizer = Readonly<{
  beginRead: () => AdministratorAccessReadToken;
  acceptsRead: (token: AdministratorAccessReadToken) => boolean;
  recordAuthoritativeChange: () => void;
}>;

export function createAdministratorAccessSynchronizer(): AdministratorAccessSynchronizer {
  let epoch = 0;
  let latestReadSequence = 0;

  return {
    beginRead() {
      latestReadSequence += 1;
      return { epoch, sequence: latestReadSequence };
    },
    acceptsRead(token) {
      return token.epoch === epoch && token.sequence === latestReadSequence;
    },
    recordAuthoritativeChange() {
      epoch += 1;
    },
  };
}
