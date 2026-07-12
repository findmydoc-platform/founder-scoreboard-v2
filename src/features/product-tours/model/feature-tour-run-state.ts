export type FeatureTourRunClaim = {
  driverStarted: boolean;
  tourId: string;
};

export function featureTourRunOwnsClaim(
  run: FeatureTourRunClaim,
  claimedTourId: string,
) {
  return claimedTourId === run.tourId;
}

export function shouldReleaseFeatureTourClaim(
  run: FeatureTourRunClaim,
  claimedTourId: string,
) {
  return !run.driverStarted
    && featureTourRunOwnsClaim(run, claimedTourId);
}
