// Synthetic external protocol responses for the real session browser acceptance server.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-browser-sts" });
  if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-browser-directory", expireTime: new Date(Date.now()+3600000).toISOString() });
  if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
  if (url.hostname === "openidconnect.googleapis.com") return Response.json({ sub: "synthetic-google-subject", email: "synthetic@findmydoc.eu", email_verified: true, hd: "findmydoc.eu" });
  return original(input, init);
};
