# Credential verification measurements

## Scope and method

These are local acceptance measurements, not a production latency guarantee. Before is `facc2e42ba0a95a8411e9d939cb909973b598122`; After is runtime source `17955b50917034c49ebb1b758635d8c07c8dccbc`. These measurements preceded the later bounded session-lifecycle and module-coverage correction; their source metadata and values are historical and unchanged. Both versions ran serially on the same Darwin arm64 host with Node v26.11.1 and Next.js 16.3.8, Postgres 17.6, synthetic users and fixed fixture dates. The Workweek DDL shared by both versions is byte-identical. Before used its actual 26-migration ledger; After used its actual 29-migration ledger. No new-schema assumption was imposed on the baseline.

Auth, Directory and Google login proof were scripted, zero-delay protocols. PostgREST and storage authorization used the real disposable database. External network access remained denied. No actual Google/GitHub/Notion/Chat request was sent. HTTPS used an owned certificate and browser-context trust; global TLS validation remained enabled.

The warm HTTP series uses development webpack Next.js, one untimed route warmup and 30 serialized samples per persisted state and version. TTFB stops at response headers; total stops after consuming the body. All 32 matched symbolic response digests agree. Canonicalization removes synthetic UUID differences and sorts owner-membership sets. Within calendar history it sorts only ties with the same effective date and publication revision, where the baseline secondary order is a random UUID. Meaningful chronology, weekdays, windows and presentation order remain unchanged.

The recorder observes actual fetch attempts and four unchanged function bodies: Proxy, route and the entry authority function. It adds file-writing overhead to both versions; this overhead is not calibrated. Entry-authority timings are not total verification time: the old route performs additional verification after its initial guard. Phase durations overlap and must not be added or subtracted from TTFB as independent costs. Request counts include actual permit issue/release and binding checks; data-only timing is not claimed.

Every summary below is median / nearest-rank p95 / maximum in milliseconds. Every recorded outlier remains included. Warm rows have n=30 per version. Request-category cells show exact counts or observed minimum–maximum per sample, not a rounded average.

## Matched warm HTTP

| Persisted state | Before TTFB | After TTFB | Before total | After total |
| --- | --- | --- | --- | --- |
| `calendar-empty` | 30.65 / 77.47 / 143.71 | 25.30 / 32.15 / 225.93 | 30.82 / 77.58 / 143.82 | 25.42 / 32.28 / 226.03 |
| `private-initial` | 42.42 / 50.54 / 56.10 | 29.80 / 35.13 / 35.81 | 42.52 / 50.63 / 56.20 | 29.89 / 35.22 / 35.92 |
| `private-explicit-week` | 32.76 / 37.11 / 53.78 | 23.68 / 28.40 / 34.73 | 32.84 / 37.22 / 53.87 | 23.77 / 28.49 / 34.82 |
| `private-existing-draft` | 50.78 / 59.72 / 74.66 | 42.08 / 49.83 / 51.09 | 50.87 / 59.82 / 74.75 | 42.16 / 49.88 / 51.18 |
| `calendar-history-no-range` | 28.67 / 34.46 / 35.98 | 20.60 / 26.28 / 26.38 | 28.76 / 34.56 / 36.07 | 20.68 / 26.41 / 26.47 |
| `calendar-history-range` | 27.46 / 34.29 / 35.56 | 20.89 / 26.91 / 55.00 | 27.57 / 34.42 / 35.66 | 21.01 / 27.04 / 55.10 |
| `calendar-exclusion-no-range` | 28.26 / 33.61 / 36.25 | 21.11 / 25.81 / 33.10 | 28.36 / 33.74 / 36.34 | 21.25 / 25.96 / 33.17 |
| `calendar-exclusion-range` | 28.33 / 33.13 / 34.06 | 21.29 / 26.58 / 26.71 | 28.40 / 33.27 / 34.19 | 21.40 / 26.70 / 26.83 |
| `calendar-timestamped-no-range` | 27.99 / 34.32 / 35.59 | 27.19 / 88.24 / 137.58 | 28.09 / 34.40 / 35.69 | 27.29 / 88.38 / 137.66 |
| `calendar-timestamped-range` | 28.49 / 36.31 / 39.13 | 22.80 / 32.72 / 34.00 | 28.60 / 36.42 / 39.19 | 22.93 / 32.92 / 34.13 |
| `calendar-empty-replaced-future-no-range` | 27.95 / 33.78 / 36.38 | 21.72 / 29.39 / 30.07 | 28.05 / 33.88 / 36.51 | 21.81 / 29.47 / 30.16 |
| `calendar-empty-replaced-future-range` | 28.82 / 35.23 / 35.41 | 21.72 / 26.48 / 27.62 | 28.95 / 35.33 / 35.53 | 21.82 / 26.57 / 27.71 |
| `private-preparing` | 50.38 / 56.67 / 60.06 | 34.88 / 43.62 / 43.87 | 50.48 / 56.76 / 60.18 | 35.01 / 43.71 / 43.98 |
| `private-published` | 53.90 / 63.31 / 81.43 | 34.38 / 42.94 / 50.09 | 53.99 / 63.39 / 81.52 | 34.51 / 43.02 / 50.17 |
| `private-current-future` | 49.86 / 63.32 / 65.39 | 35.75 / 44.27 / 48.21 | 49.94 / 63.42 / 65.44 | 35.83 / 44.36 / 48.33 |
| `private-selected-future` | 50.78 / 59.47 / 65.06 | 44.82 / 51.18 / 55.08 | 50.89 / 59.58 / 65.12 | 44.91 / 51.27 / 55.24 |
| `private-pinned` | 53.05 / 63.58 / 64.53 | 44.25 / 53.37 / 54.20 | 53.14 / 63.68 / 64.78 | 44.35 / 53.46 / 54.31 |
| `private-pinned-current` | 54.46 / 67.23 / 68.87 | 43.17 / 50.40 / 60.45 | 54.53 / 67.30 / 68.96 | 43.27 / 50.49 / 60.54 |
| `private-conflict` | 62.85 / 111.27 / 138.03 | 51.32 / 60.99 / 65.94 | 62.94 / 111.40 / 138.12 | 51.41 / 61.08 / 66.08 |
| `private-automatic` | 57.23 / 64.90 / 72.05 | 41.29 / 48.73 / 49.82 | 57.30 / 64.96 / 72.17 | 41.38 / 48.85 / 49.95 |
| `private-automatic-private` | 50.13 / 56.86 / 58.91 | 43.53 / 54.32 / 58.26 | 50.21 / 56.98 / 58.97 | 43.66 / 54.44 / 58.38 |
| `private-automatic-history` | 58.15 / 71.82 / 72.84 | 42.63 / 49.34 / 52.53 | 58.23 / 71.91 / 72.93 | 42.75 / 49.46 / 52.67 |
| `private-recovery` | 49.17 / 59.20 / 71.98 | 35.32 / 41.74 / 45.52 | 49.25 / 59.25 / 72.06 | 35.41 / 41.83 / 45.64 |
| `private-recovery-no-journal` | 49.07 / 54.63 / 55.02 | 34.83 / 43.87 / 44.12 | 49.18 / 54.68 / 55.10 | 34.91 / 43.96 / 44.25 |
| `private-recovery-expired` | 51.19 / 58.00 / 59.13 | 35.75 / 66.26 / 106.64 | 51.27 / 58.06 / 59.21 | 35.84 / 66.37 / 106.76 |
| `private-recovery-restarted` | 49.58 / 71.29 / 78.64 | 33.19 / 39.49 / 41.01 | 49.66 / 71.35 / 78.73 | 33.27 / 39.59 / 41.12 |
| `private-recovery-identity` | 47.63 / 55.73 / 69.40 | 34.19 / 41.23 / 41.32 | 47.72 / 55.82 / 69.51 | 34.32 / 41.36 / 41.40 |
| `private-timestamped` | 50.60 / 71.51 / 162.78 | 37.58 / 63.52 / 67.86 | 50.69 / 71.64 / 162.94 | 37.67 / 63.61 / 67.96 |
| `private-current-future-explicit` | 44.37 / 50.28 / 51.78 | 31.33 / 38.43 / 40.04 | 44.43 / 50.35 / 51.86 | 31.43 / 38.56 / 40.16 |
| `private-automatic-explicit` | 34.22 / 60.64 / 137.59 | 24.82 / 30.02 / 31.60 | 34.34 / 60.76 / 137.77 | 24.91 / 30.14 / 31.67 |
| `private-automatic-private-explicit` | 43.66 / 51.27 / 53.49 | 38.34 / 45.44 / 47.34 | 43.74 / 51.39 / 53.57 | 38.45 / 45.52 / 47.43 |
| `private-automatic-history-explicit` | 43.76 / 50.92 / 57.67 | 31.06 / 36.29 / 36.97 | 43.84 / 51.04 / 57.79 | 31.14 / 36.36 / 37.10 |

## Actual request categories

Auth means Auth user/session transport. EvidenceStore means profile, identity binding and session context. Directory includes the service credential protocol and membership probe. Permit means issue/release. Data means application reads. No Unknown category was accepted. Counts can differ from the historical recorder because its category names grouped some context reads as application data; the original category projection remains in raw samples.

| State | Before requests per sample | After requests per sample |
| --- | --- | --- |
| `calendar-empty` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `private-initial` | Auth 15, Data 5, Directory 7, EvidenceStore 22, Permit 12 | Auth 9, Data 5, EvidenceStore 9, Permit 12 |
| `private-explicit-week` | Auth 15, Data 5, Directory 7, EvidenceStore 22, Permit 12 | Auth 9, Data 5, EvidenceStore 9, Permit 12 |
| `private-existing-draft` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `calendar-history-no-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-history-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-exclusion-no-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-exclusion-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-timestamped-no-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-timestamped-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-empty-replaced-future-no-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `calendar-empty-replaced-future-range` | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | Auth 6, Data 2, EvidenceStore 6, Permit 6 |
| `private-preparing` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-published` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-current-future` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-selected-future` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `private-pinned` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `private-pinned-current` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `private-conflict` | Auth 19, Data 8, Directory 9, EvidenceStore 28, Permit 16 | Auth 12, Data 8, EvidenceStore 13, Permit 18 |
| `private-automatic` | Auth 19, Data 7, Directory 9, EvidenceStore 28, Permit 16 | Auth 11, Data 7, EvidenceStore 11, Permit 16 |
| `private-automatic-private` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `private-automatic-history` | Auth 19, Data 7, Directory 9, EvidenceStore 28, Permit 16 | Auth 11, Data 7, EvidenceStore 11, Permit 16 |
| `private-recovery` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-recovery-no-journal` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-recovery-expired` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-recovery-restarted` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-recovery-identity` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-timestamped` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-current-future-explicit` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |
| `private-automatic-explicit` | Auth 15, Data 5, Directory 7, EvidenceStore 22, Permit 12 | Auth 9, Data 5, EvidenceStore 9, Permit 12 |
| `private-automatic-private-explicit` | Auth 17, Data 7, Directory 8, EvidenceStore 25, Permit 14 | Auth 11, Data 7, EvidenceStore 12, Permit 16 |
| `private-automatic-history-explicit` | Auth 17, Data 6, Directory 8, EvidenceStore 25, Permit 14 | Auth 10, Data 6, EvidenceStore 10, Permit 14 |

## Observed server phases

The phase columns retain Proxy, entry authority and route separately. Each cell reports median / p95 / maximum of the sum of that phase within each sample. A phase with multiple calls therefore remains visible without presenting each call as an independent request sample.

| State/version | Proxy | Entry authority | Route |
| --- | --- | --- | --- |
| `calendar-empty` Before | 0.48 / 0.78 / 0.85 | 14.71 / 19.40 / 58.88 | 25.97 / 71.70 / 139.61 |
| `calendar-empty` After | 0.63 / 0.79 / 0.79 | 12.00 / 17.54 / 207.65 | 20.81 / 26.98 / 221.18 |
| `private-initial` Before | 0.44 / 0.57 / 0.61 | 13.95 / 18.62 / 18.82 | 38.46 / 46.90 / 52.18 |
| `private-initial` After | 0.57 / 0.67 / 0.68 | 9.82 / 13.69 / 13.84 | 25.34 / 30.58 / 31.25 |
| `private-explicit-week` Before | 0.44 / 0.50 / 0.53 | 13.13 / 18.31 / 28.59 | 28.97 / 33.30 / 49.80 |
| `private-explicit-week` After | 0.56 / 0.62 / 0.63 | 9.25 / 12.93 / 17.20 | 19.65 / 23.58 / 30.17 |
| `private-existing-draft` Before | 0.45 / 0.58 / 0.74 | 13.42 / 22.89 / 23.32 | 46.40 / 55.19 / 67.05 |
| `private-existing-draft` After | 0.57 / 0.64 / 0.70 | 9.58 / 14.65 / 14.95 | 38.04 / 45.81 / 46.92 |
| `calendar-history-no-range` Before | 0.46 / 0.52 / 0.54 | 13.93 / 18.44 / 18.65 | 24.36 / 30.58 / 31.78 |
| `calendar-history-no-range` After | 0.57 / 0.63 / 0.65 | 9.40 / 14.00 / 14.02 | 16.38 / 22.04 / 22.38 |
| `calendar-history-range` Before | 0.45 / 0.50 / 0.51 | 13.42 / 18.23 / 19.49 | 23.59 / 28.57 / 31.02 |
| `calendar-history-range` After | 0.58 / 0.65 / 0.67 | 9.67 / 15.45 / 38.22 | 16.66 / 22.08 / 51.01 |
| `calendar-exclusion-no-range` Before | 0.44 / 0.55 / 0.56 | 13.54 / 19.78 / 21.47 | 24.22 / 29.58 / 31.79 |
| `calendar-exclusion-no-range` After | 0.57 / 0.61 / 0.61 | 9.73 / 14.04 / 14.05 | 16.85 / 21.52 / 23.60 |
| `calendar-exclusion-range` Before | 0.42 / 0.51 / 0.51 | 13.97 / 18.20 / 20.17 | 24.40 / 29.55 / 30.26 |
| `calendar-exclusion-range` After | 0.56 / 0.63 / 0.69 | 9.83 / 14.74 / 15.21 | 17.28 / 22.59 / 23.02 |
| `calendar-timestamped-no-range` Before | 0.44 / 0.50 / 0.52 | 13.56 / 19.65 / 20.17 | 23.88 / 30.53 / 30.62 |
| `calendar-timestamped-no-range` After | 0.64 / 1.10 / 1.38 | 11.97 / 18.63 / 31.33 | 21.68 / 42.53 / 83.88 |
| `calendar-timestamped-range` Before | 0.47 / 0.54 / 0.60 | 13.74 / 18.99 / 22.62 | 24.07 / 32.46 / 33.98 |
| `calendar-timestamped-range` After | 0.57 / 0.85 / 1.07 | 10.50 / 16.19 / 16.43 | 17.95 / 26.97 / 29.25 |
| `calendar-empty-replaced-future-no-range` Before | 0.45 / 0.49 / 0.62 | 13.76 / 18.86 / 19.82 | 23.93 / 30.07 / 32.44 |
| `calendar-empty-replaced-future-no-range` After | 0.55 / 0.64 / 0.65 | 9.96 / 15.53 / 15.85 | 17.23 / 22.84 / 23.18 |
| `calendar-empty-replaced-future-range` Before | 0.46 / 0.55 / 0.59 | 14.09 / 19.06 / 20.31 | 24.77 / 31.14 / 31.44 |
| `calendar-empty-replaced-future-range` After | 0.55 / 0.62 / 0.62 | 9.80 / 14.85 / 14.90 | 17.35 / 22.36 / 22.95 |
| `private-preparing` Before | 0.48 / 0.58 / 0.60 | 14.00 / 20.72 / 23.72 | 46.36 / 52.62 / 55.53 |
| `private-preparing` After | 0.61 / 0.68 / 0.68 | 9.69 / 15.30 / 16.66 | 30.15 / 38.99 / 39.25 |
| `private-published` Before | 0.49 / 0.55 / 0.60 | 15.15 / 21.48 / 22.04 | 49.50 / 59.35 / 75.85 |
| `private-published` After | 0.61 / 0.71 / 0.93 | 9.46 / 15.04 / 15.28 | 29.95 / 38.80 / 44.88 |
| `private-current-future` Before | 0.48 / 0.53 / 0.53 | 14.19 / 20.21 / 20.74 | 44.96 / 58.91 / 61.45 |
| `private-current-future` After | 0.60 / 0.69 / 0.69 | 9.59 / 16.73 / 17.55 | 31.57 / 40.27 / 44.01 |
| `private-selected-future` Before | 0.48 / 0.53 / 0.53 | 13.82 / 20.25 / 20.41 | 46.08 / 55.34 / 58.18 |
| `private-selected-future` After | 0.62 / 0.73 / 0.82 | 10.13 / 14.44 / 14.60 | 39.35 / 46.50 / 47.46 |
| `private-pinned` Before | 0.48 / 0.61 / 1.43 | 14.24 / 20.58 / 20.65 | 48.66 / 59.21 / 59.72 |
| `private-pinned` After | 0.61 / 0.69 / 0.75 | 9.94 / 14.73 / 15.11 | 39.37 / 49.22 / 49.89 |
| `private-pinned-current` Before | 0.48 / 0.54 / 0.56 | 14.38 / 18.16 / 18.48 | 49.02 / 58.21 / 64.92 |
| `private-pinned-current` After | 0.61 / 0.69 / 0.70 | 9.84 / 12.62 / 15.56 | 38.24 / 45.69 / 56.44 |
| `private-conflict` Before | 0.45 / 0.95 / 2.27 | 14.24 / 26.75 / 45.38 | 58.52 / 75.28 / 106.69 |
| `private-conflict` After | 0.60 / 0.71 / 0.73 | 10.26 / 16.40 / 19.84 | 46.01 / 56.62 / 61.39 |
| `private-automatic` Before | 0.44 / 0.54 / 0.58 | 13.84 / 19.68 / 22.73 | 52.49 / 61.20 / 66.81 |
| `private-automatic` After | 0.61 / 0.68 / 0.71 | 9.66 / 12.44 / 15.29 | 36.23 / 43.62 / 44.72 |
| `private-automatic-private` Before | 0.46 / 0.54 / 0.59 | 13.97 / 18.64 / 19.44 | 45.37 / 53.11 / 54.77 |
| `private-automatic-private` After | 0.62 / 0.67 / 0.74 | 9.96 / 16.16 / 16.94 | 37.67 / 49.07 / 53.01 |
| `private-automatic-history` Before | 0.46 / 0.53 / 0.56 | 13.82 / 19.88 / 19.98 | 52.98 / 67.09 / 67.51 |
| `private-automatic-history` After | 0.61 / 0.69 / 0.71 | 9.78 / 14.38 / 15.12 | 37.13 / 44.13 / 47.64 |
| `private-recovery` Before | 0.44 / 0.56 / 0.56 | 13.88 / 20.09 / 21.02 | 44.81 / 55.57 / 67.86 |
| `private-recovery` After | 0.58 / 0.77 / 1.19 | 9.91 / 15.04 / 15.61 | 30.72 / 37.75 / 40.66 |
| `private-recovery-no-journal` Before | 0.45 / 0.52 / 0.52 | 13.76 / 19.06 / 19.97 | 44.39 / 50.68 / 50.82 |
| `private-recovery-no-journal` After | 0.57 / 0.70 / 0.70 | 9.72 / 16.67 / 16.73 | 30.56 / 39.66 / 39.85 |
| `private-recovery-expired` Before | 0.46 / 0.56 / 0.73 | 14.51 / 20.89 / 21.16 | 47.25 / 54.30 / 54.40 |
| `private-recovery-expired` After | 0.57 / 0.70 / 0.77 | 9.71 / 14.89 / 16.37 | 30.72 / 47.19 / 62.21 |
| `private-recovery-restarted` Before | 0.44 / 0.55 / 0.67 | 14.19 / 20.46 / 41.37 | 45.01 / 67.55 / 73.98 |
| `private-recovery-restarted` After | 0.58 / 0.63 / 0.64 | 9.81 / 14.31 / 14.66 | 29.03 / 35.36 / 36.00 |
| `private-recovery-identity` Before | 0.45 / 0.56 / 4.38 | 14.04 / 22.41 / 32.23 | 43.34 / 51.67 / 61.19 |
| `private-recovery-identity` After | 0.58 / 1.00 / 1.00 | 9.71 / 13.78 / 15.11 | 29.65 / 36.76 / 36.82 |
| `private-timestamped` Before | 0.44 / 0.56 / 2.69 | 14.15 / 22.24 / 82.27 | 46.28 / 62.29 / 157.84 |
| `private-timestamped` After | 0.60 / 0.72 / 0.84 | 9.88 / 15.12 / 21.22 | 32.87 / 47.24 / 63.84 |
| `private-current-future-explicit` Before | 0.45 / 0.53 / 0.57 | 14.86 / 20.55 / 20.90 | 39.93 / 46.13 / 47.68 |
| `private-current-future-explicit` After | 0.58 / 0.74 / 1.33 | 9.98 / 13.77 / 14.03 | 26.60 / 33.41 / 35.16 |
| `private-automatic-explicit` Before | 0.45 / 0.50 / 0.50 | 14.34 / 22.05 / 24.01 | 29.79 / 43.61 / 133.60 |
| `private-automatic-explicit` After | 0.57 / 0.67 / 0.79 | 9.82 / 11.25 / 16.04 | 20.51 / 25.66 / 27.12 |
| `private-automatic-private-explicit` Before | 0.45 / 0.54 / 0.57 | 14.74 / 20.73 / 21.09 | 39.56 / 47.27 / 48.53 |
| `private-automatic-private-explicit` After | 0.59 / 0.65 / 0.66 | 10.22 / 13.08 / 17.15 | 33.24 / 39.44 / 42.58 |
| `private-automatic-history-explicit` Before | 0.46 / 0.51 / 0.59 | 14.73 / 20.45 / 20.90 | 39.71 / 46.15 / 52.78 |
| `private-automatic-history-explicit` After | 0.59 / 0.67 / 0.67 | 9.92 / 13.89 / 14.54 | 26.16 / 32.23 / 32.52 |

## Separate actual Next process cold series

Each route/version has three fresh Next process starts. Persistent webpack build caches and the same running disposable database are retained. This is process/first-route cold behavior, not a fresh host, container, FaaS region or database cold start. Calendar readiness is its first successful calendar response. Private readiness uses an uncredentialed login-mode endpoint before the first private request. Startup/readiness polling is disclosed separately and is not pooled into the 30 warm observations.

| Version/route (n=3) | Process spawn to readiness | First route TTFB | First route total |
| --- | --- | --- | --- |
| Before calendar | 1920.02 / 1936.28 / 1936.28 | 881.43 / 931.65 / 931.65 | 882.24 / 932.71 / 932.71 |
| Before private | 1937.00 / 1952.51 / 1952.51 | 253.66 / 264.55 / 264.55 | 253.84 / 264.76 / 264.76 |
| After calendar | 2648.74 / 2654.28 / 2654.28 | 1645.12 / 1650.12 / 1650.12 | 1646.00 / 1650.99 / 1650.99 |
| After private | 2722.60 / 2736.26 / 2736.26 | 346.01 / 349.11 / 349.11 | 346.18 / 349.29 / 349.29 |

## Separate module verification and deadlines

These five scenarios use isolated Node public-route protocols, controlled Date and real monotonic timing, with n=30 per scenario/version. They do not measure Next, browser or real-database latency. Module/verification-cold is a new module and original evidence miss. Expiry is exactly the original 900-second deadline, without sliding. Renewal requires fresh evidence; outage returns 503. Directory credential renewal advances its own service credential lifetime. Controlled clocks are never applied to the Next process or database.

| Scenario/version | Elapsed | Requests per sample | Status |
| --- | --- | --- | --- |
| `cold-authority-miss` Before | 1.56 / 2.40 / 9.54 | Auth 8, Data 2, Directory 6, EvidenceStore 13, Permit 6 | 200 |
| `warm-evidence` Before | 0.65 / 0.86 / 0.93 | Auth 8, Data 2, Directory 4, EvidenceStore 13, Permit 6 | 200 |
| `evidence-expiry-renewal` Before | 0.60 / 0.75 / 0.78 | Auth 8, Data 2, Directory 4, EvidenceStore 13, Permit 6 | 200 |
| `evidence-expiry-outage` Before | 0.10 / 0.13 / 0.16 | Auth 1, Directory 1, EvidenceStore 1 | 503 |
| `directory-credential-renewal` Before | 0.59 / 0.71 / 0.87 | Auth 8, Data 2, Directory 6, EvidenceStore 13, Permit 6 | 200 |
| `cold-authority-miss` After | 1.62 / 2.50 / 11.03 | Auth 4–5, Data 2, Directory 3, EvidenceStore 6, Permit 6 | 200 |
| `warm-evidence` After | 0.62 / 0.87 / 0.90 | Auth 4, Data 2, EvidenceStore 6, Permit 6 | 200 |
| `evidence-expiry-renewal` After | 0.57 / 0.76 / 0.78 | Auth 4–5, Data 2, Directory 1, EvidenceStore 6, Permit 6 | 200 |
| `evidence-expiry-outage` After | 0.26 / 0.34 / 0.58 | Auth 1, Directory 1, EvidenceStore 2 | 503 |
| `directory-credential-renewal` After | 0.63 / 0.87 / 1.04 | Auth 4–5, Data 2, Directory 3, EvidenceStore 6, Permit 6 | 200 |

## Controlled mixed-snapshot race

Before and After each execute 30 actual HTTP attempts with a controlled read barrier. The selected edit-context RPC completes, the persisted publication revision changes, and the later publication read observes that change. Every response is 409 and every attempt consumes the selected context once. This is an intentionally interleaved correctness series, not a normal warm latency row; the first route/module miss and all outliers remain included.

| Version (n=30) | TTFB | Total | Requests per sample |
| --- | --- | --- | --- |
| Before | 48.00 / 185.72 / 212.75 | 48.63 / 186.47 / 213.07 | Auth 17, Data 6, Directory 8–10, EvidenceStore 25, Permit 14 |
| After | 33.67 / 202.51 / 348.01 | 34.13 / 203.12 / 348.30 | Auth 10, Data 6, Directory 0–3, EvidenceStore 10, Permit 14 |

## Matched production HTTPS browser

Both versions use a production webpack build, Chromium 151.0.7922.34, a 1440×900 viewport, real Google login start/PKCE/callback through the controlled provider protocol, and cookie-only browser API transport. The controlled authorization hop forwards only to the already bound callback. Existing product-news dialogs are dismissed through their normal UI before warmup. Build, readiness and login are outside timed warm interactions.

Calendar samples wait for a fresh200 response with the requested range, completed body, final rendered empty state and two animation frames. Private samples reload the page and wait for the editor; navigation-to-editor, HTTP response and editor interaction remain separate. Each version has 30 calendar and 30 private samples. The historical development-HTTP browser baseline is retained but is not paired with this production-HTTPS series.

| Version/interaction (n=30) | Browser completion | HTTP TTFB | HTTP total |
| --- | --- | --- | --- |
| Before calendar | 66.45 / 75.90 / 83.60 | 36.90 / 42.85 / 46.58 | 38.13 / 44.10 / 48.56 |
| Before privateInitial | 500.10 / 519.60 / 521.80 | 67.01 / 81.15 / 85.42 | 68.05 / 82.08 / 86.99 |
| After calendar | 65.55 / 67.60 / 67.70 | 31.57 / 35.15 / 37.43 | 32.91 / 36.41 / 38.96 |
| After privateInitial | 483.45 / 500.30 / 505.10 | 55.51 / 65.98 / 70.41 | 57.39 / 68.28 / 71.87 |

| Browser row | Requests per sample | Proxy | Entry authority | Route |
| --- | --- | --- | --- | --- |
| Before calendar | Auth 9, Data 2, Directory 4, EvidenceStore 13, Permit 6 | 0.57 / 0.93 / 1.05 | 22.28 / 25.82 / 27.96 | 34.15 / 39.87 / 43.23 |
| Before privateInitial | Auth 86–89, Data 29–37, Directory 29–32, EvidenceStore 100–110, Permit 38–42 | 9.64 / 11.81 / 12.52 | 170.89 / 200.15 / 226.74 | 112.45 / 135.50 / 135.63 |
| After calendar | Auth 6, Data 2, EvidenceStore 6, Permit 6 | 0.62 / 0.72 / 0.93 | 19.82 / 21.60 / 21.82 | 28.91 / 32.24 / 33.75 |
| After privateInitial | Auth 89–91, Data 25–33, EvidenceStore 104–129, Permit 78–100 | 10.15 / 11.23 / 12.03 | 316.63 / 363.85 / 400.95 | 77.39 / 92.23 / 93.78 |

## Retained failures, exclusions and evidence

The original four-row HTTP and development-browser artifacts are preserved with a 12-file hash manifest. They are historical evidence, not overwritten by expanded measurements. The first expanded Before calendar-empty row accidentally included foreign history and is excluded because it used the wrong dataset. Its corrected 30-sample run is retained separately. An intermediate canonicalization sorted too broadly; it is not used. The final pairing canonicalizes only the justified UUID ties described above. The extra repeated timestamped-private temporal row remains retained and is not pooled or selected for better timing.

Initial acceptance fixture failures were a foreign-key cleanup dependency, an invalid persisted error class, and an incorrect expectation after deliberately creating a second module instance. Production behavior was unchanged. Two final browser acceptance builds exposed missing JavaScript fixture result typing; the third run passed 17/17. Earlier Before browser launch attempts exposed the instrumentation wrapper return type, controlled redirect handling and an existing modal interception. All failed logs remain retained. None is reclassified as a passing sample, and no timeout or production assertion was weakened.

Per-sample raw evidence retains timings, statuses, synthetic identifiers, category/phase counts and source/schema metadata. It omits URLs, authorization headers, cookie values, provider payloads and private endpoints. Every measurement fixture restores configuration and records zero owned users, profiles, versions and publications after cleanup. The final metadata records the original and instrumented hashes for four functions and verifies all other runtime source bytes against the stated source commit.

The root-owned final verification cycle is complete and is recorded in the [acceptance evidence](credential-verification-acceptance.md#completed-initial-verification-cycle). The corrected ordinary full suite passed 1,999 tests across 308 files; migration/security/Auth/database-lint/lint/build/architecture checks also passed. These local measurements do not establish a hosted-provider performance guarantee or authorize deployment.

## Source and cleanup metadata

The Before runtime source digest is `a31c51ac4ca93fdd76d1d7e9a0dddd092ab03b14e5513a65c57772c82c2ac495`; After is `2678e40788ae8924cdbf5a13f795b3f490b924a704d7b135f45dc32c3a6db5e7`. The sorted digest covers each runtime source path and its original bytes. The recorder verified the snapshot against those originals, allowing only the four declared function wrappers. After uses a 29-migration ledger, latest `20261017144737`; Before uses a 26-migration ledger, latest `20261016170256`. Both use Postgres 17.6. Each final measurement records zero owned users, profiles, versions and publications after cleanup. The test-target portability change occurred after measurements and changes no runtime source or workflow.

The measured After production build’s client scan passed across 183 chunks/maps and 2,390,345 bytes. This is distinct from ticket 502’s original 63-artifact scan and from the final global build, whose separate scan passed across 63 chunks/maps and 2,231,432 bytes. The original 12-file baseline hash manifest was rechecked after all series and every hash matched.

## Untimed browser setup and private editor interaction

Build/readiness/login are one setup observation per version, outside the 30 warm samples. The editor click has 30 separate samples per version.

| Version | Build (n=1) | Readiness (n=1) | Actual login (n=1) | Editor click median / p95 / max (n=30) |
| --- | --- | --- | --- | --- |
| Before | 12158.83 | 342.97 | 1415.33 | 63.15 / 76.00 / 77.20 |
| After | 23368.73 | 374.37 | 1856.66 | 64.05 / 76.00 / 77.00 |

## Final verification source

The earlier complete global checks passed on test-source candidate `ae655c595a9e15641beaaae4eb12c9c2e773709d`, after two fixture-only repairs retained with their observed failures. At that measured checkpoint, runtime source was `17955b50917034c49ebb1b758635d8c07c8dccbc`. The matched measurements retain that source and schema metadata. The subsequent session-lifecycle correction has a different executable source and new regression evidence in the [post-acceptance record](credential-verification-acceptance.md#post-acceptance-session-lifecycle-and-module-coverage); these historical measurements are not a measurement of that correction. The final global client scan is 63 chunks/maps and 2,231,432 bytes; it is separate from both the measurement build (183/2,390,345) and ticket 502’s earlier build (63/2,231,293).
