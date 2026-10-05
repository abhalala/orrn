/**
 * Stand-in for expo-network, which orrn neither installs nor links (metro-shims.js
 * maps the import here). @better-auth/expo imports it lazily to refetch the session
 * when the phone comes back online; with the JS resolvable but no native module,
 * that import threw "Cannot find native module 'ExpoNetwork'" as a fatal error on
 * sign-out. This never reports a change, so Better Auth treats the phone as online,
 * which is its own fallback when expo-network is missing. React Query's refetch on
 * foreground (lib/app-focus.ts) still re-checks the session.
 */
type NetworkState = { isConnected?: boolean; isInternetReachable?: boolean };

export function addNetworkStateListener(_listener: (state: NetworkState) => void): { remove(): void } {
  return { remove() {} };
}
