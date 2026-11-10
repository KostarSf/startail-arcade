export function isDevelopmentClient(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== "production";
  }

  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  return false;
}
