/**
 * Single source of truth for the SDK version. Lives in its own module so
 * `FetchTransport` can read it for the `User-Agent` header without pulling
 * in the whole public surface (avoids circular imports through `index.ts`).
 *
 * Keep this in sync with the `version` field in `package.json` when cutting
 * a release.
 */
export const VERSION = '0.1.0';
