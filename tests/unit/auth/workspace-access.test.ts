import { describe, expect, it } from "vitest";
import { authorizeWorkspaceIdentity, workspaceIdentity } from "@/lib/workspace-identity";

const google = { provider: "google", identity_data: { sub: "google-123", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } } };
const user = { id: "existing-user", identities: [google], user_metadata: {} };

describe("Workspace access", () => {
  it("accepts the verified provider identity without deriving roles or profiles", async () => {
    expect(await authorizeWorkspaceIdentity(user, async email => email === "member@findmydoc.eu")).toEqual({ subject: "google-123", email: "member@findmydoc.eu", userId: "existing-user" });
  });
  it.each([
    { identities: [], user_metadata: google.identity_data },
    { identities: [{ ...google, identity_data: { ...google.identity_data, email_verified: false } }] },
    { identities: [{ ...google, identity_data: { ...google.identity_data, custom_claims: { hd: "other.eu" } } }] },
    { identities: [{ ...google, identity_data: { ...google.identity_data, iss: "https://attacker.example" } }] },
    { identities: [google, google] },
  ])("rejects untrusted, incomplete and ambiguous identity", change => {
    expect(() => workspaceIdentity({ ...user, ...change })).toThrow();
  });
  it("checks membership again on the next request and fails closed on provider failure", async () => {
    let member = true;
    const check = async () => member;
    await expect(authorizeWorkspaceIdentity(user, check)).resolves.toBeDefined();
    member = false;
    await expect(authorizeWorkspaceIdentity(user, check)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeWorkspaceIdentity(user, async () => { throw new Error("Directory unavailable"); })).rejects.toMatchObject({ status: 503 });
  });
});
