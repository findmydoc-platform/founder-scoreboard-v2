export function safeRelativeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

export function authOrigin() {
  const configured = process.env.APP_URL || (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const url = new URL(configured || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : ""));
  const local = process.env.NODE_ENV === "development" && url.hostname === "localhost" && url.protocol === "http:";
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Unapproved application origin");
  }
  return url.origin;
}
