const RELEASE_DETAIL_PATH = /^\/team\/platform-releases\/v\d+\.\d+\.\d+$/;

export function taskDetailHrefWithReturnTo(href: string, returnTo: string) {
  const url = new URL(href, "http://founder-ops.local");
  url.searchParams.set("returnTo", returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function safeTaskDetailReturnTo(value?: string | string[]) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;

  try {
    const url = new URL(candidate, "http://founder-ops.local");
    if (url.origin !== "http://founder-ops.local" || !RELEASE_DETAIL_PATH.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
