export function safeRelativeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

export function authOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (process.env.VERCEL_ENV === "preview") throw new Error("Preview login unavailable");
  if (url.origin !== "https://founder-ops.findmydoc.eu" && !(process.env.NODE_ENV === "development" && url.hostname === "localhost" && url.protocol === "http:")) throw new Error("Unapproved application origin");
  return url.origin;
}
