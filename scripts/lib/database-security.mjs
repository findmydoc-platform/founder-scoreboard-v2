import { verifyAuthorizationSecurity } from "./database-security/authorization-security.mjs";
import { verifyCatalogSecurity } from "./database-security/catalog-security.mjs";
import { verifyDefaultPrivileges } from "./database-security/default-privileges.mjs";
import { throwIfDatabaseSecurityFailed } from "./database-security/failures.mjs";
import { verifyStorageSecurity } from "./database-security/storage-security.mjs";

export async function verifyDatabaseSecurity(client) {
  const failures = [];

  const summary = await verifyCatalogSecurity(client, failures);
  await verifyAuthorizationSecurity(client, failures);
  await verifyDefaultPrivileges(client, failures);
  await verifyStorageSecurity(client, failures);

  throwIfDatabaseSecurityFailed(failures);
  return summary;
}
