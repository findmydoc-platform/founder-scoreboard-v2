import { addRows } from "./failures.mjs";

export async function verifyStorageSecurity(client, failures) {
  const previewBucket = await client.query(
    `select public, file_size_limit, allowed_mime_types
     from storage.buckets
     where id = 'fmd-tool-previews'`,
  );
  const bucket = previewBucket.rows[0];
  const allowedMimeTypes = new Set(bucket?.allowed_mime_types || []);
  if (
    previewBucket.rowCount !== 1
    || bucket.public !== true
    || Number(bucket.file_size_limit) !== 5 * 1024 * 1024
    || allowedMimeTypes.size !== 4
    || ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ].every((mimeType) => allowedMimeTypes.has(mimeType))
  ) {
    failures.push("fmd-tool-previews bucket constraints are missing or broader than expected");
  }

  const clientStorageWritePolicies = await client.query(
    `select policyname, cmd
     from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (
         'public'::name = any(roles)
         or 'anon'::name = any(roles)
         or 'authenticated'::name = any(roles)
       )
     order by policyname`,
  );
  addRows(
    failures,
    "client storage write policies",
    clientStorageWritePolicies.rows,
    ["policyname", "cmd"],
  );
}
