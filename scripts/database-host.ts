// The host of a connection string, or null when it doesn't parse. Never throws and never exposes
// the input: a failed `new URL` error carries the full string, password included.
export function databaseHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
