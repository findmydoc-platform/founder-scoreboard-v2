import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const supabaseCli = resolve(root, "node_modules/.bin/supabase");

function localDatabaseUrl() {
  const status = JSON.parse(execFileSync(supabaseCli, ["status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
  }));
  const databaseUrl = new URL(status.DB_URL);
  if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "54322") {
    throw new Error("Profile-color verification refuses a non-local database.");
  }
  return status.DB_URL;
}

function profilePatch(color, duplicateMode) {
  return JSON.stringify({
    profile_color: color,
    profile_color_duplicate_mode: duplicateMode,
  });
}

async function updateOwnColor(client, profileId, color, duplicateMode, userAgent) {
  const result = await client.query(
    `select public.update_profile_settings_transaction(
      $1,
      $2::jsonb,
      null::jsonb,
      '{}'::jsonb,
      null,
      $3
    ) as result`,
    [profileId, profilePatch(color, duplicateMode), userAgent],
  );
  return result.rows[0]?.result?.profile;
}

async function updateAdminColor(client, profileId, actorProfileId, color, duplicateMode, userAgent) {
  const result = await client.query(
    `select public.update_profile_admin_transaction(
      $1,
      $2,
      $3::jsonb,
      '{}'::jsonb,
      null,
      $4
    ) as result`,
    [profileId, actorProfileId, profilePatch(color, duplicateMode), userAgent],
  );
  return result.rows[0]?.result?.profile;
}

async function updateOwnPreferences(client, profileId, uiPreferences, userAgent) {
  return client.query(
    `select public.update_profile_settings_transaction(
      $1,
      '{}'::jsonb,
      $2::jsonb,
      '{}'::jsonb,
      null,
      $3
    ) as result`,
    [profileId, JSON.stringify(uiPreferences), userAgent],
  );
}

let savepointCounter = 0;

async function expectDatabaseError(client, expectedCode, label, operation) {
  savepointCounter += 1;
  const savepoint = `profile_color_expected_${savepointCounter}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    if (error?.code !== expectedCode) {
      throw new Error(`${label}: expected ${expectedCode}, received ${error?.code || "no database code"}.`, { cause: error });
    }
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`${label}: operation unexpectedly succeeded.`);
}

async function insertProfile(client, id, name) {
  const result = await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, $2, 'member', 'founder')
     returning id, profile_color`,
    [id, name],
  );
  return result.rows[0];
}

async function verifyTransactionalRules(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("begin");

  try {
    const palette = (await client.query("select public.profile_color_palette() as colors")).rows[0]?.colors;
    if (!Array.isArray(palette) || palette.length !== 20) {
      throw new Error("Database profile-color palette does not contain exactly 20 colors.");
    }

    const profiles = (await client.query("select id from public.profiles order by id")).rows;
    const ceoId = (await client.query(
      "select id from public.profiles where platform_role='ceo' order by id limit 1",
    )).rows[0]?.id;
    if (profiles.length < 3 || !ceoId) {
      throw new Error("Profile-color verification needs the local seeded profiles and one CEO.");
    }

    const privileges = (await client.query(
      `select
        has_table_privilege('authenticated', 'public.profiles', 'update') as authenticated_update,
        has_function_privilege(
          'authenticated',
          'public.apply_profile_color_change(text,text,boolean)',
          'execute'
        ) as authenticated_apply,
        has_function_privilege(
          'service_role',
          'public.apply_profile_color_change(text,text,boolean)',
          'execute'
        ) as service_apply`,
    )).rows[0];
    if (privileges.authenticated_update || privileges.authenticated_apply || !privileges.service_apply) {
      throw new Error("Profile-color database privileges broaden the authenticated write boundary.");
    }

    await client.query("update public.profiles set profile_color=$1", [palette[0]]);
    const suffix = Date.now();
    const firstCreated = await insertProfile(client, `verify-profile-color-${suffix}-created-1`, "Profile color created one");
    const secondCreated = await insertProfile(client, `verify-profile-color-${suffix}-created-2`, "Profile color created two");
    if (firstCreated.profile_color !== palette[1] || secondCreated.profile_color !== palette[2]) {
      throw new Error("New profiles did not receive deterministic free colors.");
    }

    const firstTarget = profiles[0].id;
    const secondTarget = profiles[1].id;
    const thirdTarget = profiles[2].id;
    const selfUpdated = await updateOwnColor(
      client,
      firstTarget,
      palette[3],
      false,
      "Profile color self-service verifier",
    );
    if (selfUpdated?.profile_color !== palette[3]) {
      throw new Error("Self-service did not persist a free profile color.");
    }

    await expectDatabaseError(
      client,
      "P0001",
      "occupied self-service color",
      () => updateOwnColor(client, secondTarget, palette[3], false, "Profile color occupied verifier"),
    );

    const unchanged = await updateOwnColor(
      client,
      firstTarget,
      palette[3],
      true,
      "Profile color unchanged verifier",
    );
    if (unchanged?.profile_color !== palette[3]) {
      throw new Error("An unchanged profile color was not treated as a no-op.");
    }

    const adminUpdated = await updateAdminColor(
      client,
      secondTarget,
      ceoId,
      palette[4],
      false,
      "Profile color admin verifier",
    );
    if (adminUpdated?.profile_color !== palette[4]) {
      throw new Error("Admin profile transaction did not use the shared color rule.");
    }

    await expectDatabaseError(
      client,
      "22023",
      "invalid RPC color",
      () => updateOwnColor(client, firstTarget, "#ffffff", false, "Profile color invalid verifier"),
    );
    await expectDatabaseError(
      client,
      "23514",
      "invalid direct color",
      () => client.query("update public.profiles set profile_color='#ffffff' where id=$1", [firstTarget]),
    );

    const canonicalPreference = {
      default_workspace: "planning",
      default_task_view: "board",
      planning_filters: {},
      expanded_item_ids: [],
    };
    await expectDatabaseError(
      client,
      "22023",
      "legacy packageId profile preference",
      () => updateOwnPreferences(client, firstTarget, {
        ...canonicalPreference,
        planning_filters: { packageId: "legacy-package" },
      }, "Profile color legacy package preference verifier"),
    );
    await expectDatabaseError(
      client,
      "22023",
      "legacy owner profile preference",
      () => updateOwnPreferences(client, firstTarget, {
        ...canonicalPreference,
        planning_filters: { owner: "legacy-owner" },
      }, "Profile color legacy owner preference verifier"),
    );
    const legacyExpandedPreference = await updateOwnPreferences(client, firstTarget, {
      default_workspace: "planning",
      default_task_view: "board",
      planning_filters: {},
      expanded_package_ids: ["legacy-package"],
    }, "Profile color legacy expanded preference verifier");
    const expandedItemIds = legacyExpandedPreference.rows[0]?.result?.ui_preference?.expanded_item_ids;
    if (!Array.isArray(expandedItemIds) || expandedItemIds.length !== 0) {
      throw new Error("Legacy expanded_package_ids unexpectedly changed canonical profile preferences.");
    }

    for (let index = 5; index < palette.length; index += 1) {
      const created = await insertProfile(
        client,
        `verify-profile-color-${suffix}-full-${index}`,
        `Profile color full ${index}`,
      );
      if (created.profile_color !== palette[index]) {
        throw new Error(`Profile creation did not allocate palette position ${index + 1}.`);
      }
    }

    const representedAtFull = Number((await client.query(
      "select count(distinct profile_color)::integer as count from public.profiles",
    )).rows[0]?.count);
    if (representedAtFull !== 20) {
      throw new Error(`Full palette setup represented ${representedAtFull} colors instead of 20.`);
    }

    const extraProfile = await insertProfile(
      client,
      `verify-profile-color-${suffix}-extra`,
      "Profile color extra",
    );
    const extraColorCount = Number((await client.query(
      "select count(*)::integer as count from public.profiles where profile_color=$1",
      [extraProfile.profile_color],
    )).rows[0]?.count);
    if (!palette.includes(extraProfile.profile_color) || extraColorCount < 2) {
      throw new Error("A profile created with a full palette did not receive a valid duplicate.");
    }

    const deliberateDuplicate = await updateOwnColor(
      client,
      thirdTarget,
      palette[1],
      true,
      "Profile color duplicate-mode verifier",
    );
    if (deliberateDuplicate?.profile_color !== palette[1]) {
      throw new Error("Full-palette duplicate mode did not persist the chosen color.");
    }

    const uniqueLastColorProfile = (await client.query(
      "select id from public.profiles where profile_color=$1 order by id limit 1",
      [palette.at(-1)],
    )).rows[0]?.id;
    if (!uniqueLastColorProfile) throw new Error("Could not locate the last palette color fixture.");
    await client.query("update public.profiles set profile_color=$1 where id=$2", [palette[0], uniqueLastColorProfile]);

    const existingDuplicateCount = Number((await client.query(
      "select count(*)::integer as count from public.profiles where profile_color=$1",
      [palette[1]],
    )).rows[0]?.count);
    if (existingDuplicateCount < 2) {
      throw new Error("Existing duplicates changed when another color became free.");
    }

    await expectDatabaseError(
      client,
      "P0001",
      "stale duplicate mode",
      () => updateOwnColor(client, thirdTarget, palette.at(-1), true, "Profile color stale duplicate verifier"),
    );
    await expectDatabaseError(
      client,
      "P0001",
      "new duplicate while a color is free",
      () => updateOwnColor(client, thirdTarget, palette[2], false, "Profile color duplicate while free verifier"),
    );

    const newlyFreeColor = await updateOwnColor(
      client,
      thirdTarget,
      palette.at(-1),
      false,
      "Profile color newly-free verifier",
    );
    if (newlyFreeColor?.profile_color !== palette.at(-1)) {
      throw new Error("A newly free color could not be selected with duplicate mode disabled.");
    }
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForBlockedQuery(observer, backendPid, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `select wait_event is not null as blocked
       from pg_catalog.pg_stat_activity
       where pid=$1`,
      [backendPid],
    );
    if (result.rows[0]?.blocked) return;
    await delay(25);
  }
  throw new Error(`${label}: database query did not reach a blocked lock state.`);
}

async function settleAndRollback(client, operation) {
  try {
    return await operation;
  } finally {
    await client.query("rollback").catch(() => undefined);
  }
}

async function runSelfAdminLockScenario({
  admin,
  adminProfileId,
  blocker,
  ceoId,
  firstColor,
  observer,
  secondColor,
  self,
  selfProfileId,
  suffix,
}) {
  await Promise.all([self.query("begin"), admin.query("begin")]);
  await Promise.all([
    self.query("set local statement_timeout = '5s'"),
    admin.query("set local statement_timeout = '5s'"),
  ]);
  await blocker.query("select pg_catalog.pg_advisory_lock(59301, 384)");

  const selfPid = Number((await self.query("select pg_backend_pid() as pid")).rows[0]?.pid);
  const adminPid = Number((await admin.query("select pg_backend_pid() as pid")).rows[0]?.pid);
  const selfOperation = updateOwnColor(
    self,
    selfProfileId,
    firstColor,
    false,
    `Profile color self-admin lock verifier ${suffix} self`,
  );
  await waitForBlockedQuery(observer, selfPid, "self-service color update");

  const adminOperation = updateAdminColor(
    admin,
    adminProfileId,
    ceoId,
    secondColor,
    false,
    `Profile color self-admin lock verifier ${suffix} admin`,
  );
  await waitForBlockedQuery(observer, adminPid, "admin color update");
  await blocker.query("select pg_catalog.pg_advisory_unlock(59301, 384)");

  const results = await Promise.allSettled([
    settleAndRollback(self, selfOperation),
    settleAndRollback(admin, adminOperation),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    throw new Error(`Concurrent self-service and admin color updates failed with ${failure.reason?.code || "an unknown error"}.`, {
      cause: failure.reason,
    });
  }
}

async function verifySelfAdminLockOrder(databaseUrl) {
  const self = new pg.Client({ connectionString: databaseUrl });
  const admin = new pg.Client({ connectionString: databaseUrl });
  const blocker = new pg.Client({ connectionString: databaseUrl });
  const observer = new pg.Client({ connectionString: databaseUrl });
  await Promise.all([self.connect(), admin.connect(), blocker.connect(), observer.connect()]);

  try {
    const palette = (await observer.query("select public.profile_color_palette() as colors")).rows[0]?.colors;
    const profiles = (await observer.query(
      "select id, platform_role from public.profiles order by id",
    )).rows;
    const ceoId = profiles.find((profile) => profile.platform_role === "ceo")?.id;
    const nonCeoIds = profiles.filter((profile) => profile.id !== ceoId).map((profile) => profile.id);
    if (!Array.isArray(palette) || palette.length !== 20 || !ceoId || nonCeoIds.length < 2) {
      throw new Error("Self-service and admin lock verification needs the local palette, one CEO, and two other profiles.");
    }

    const suffix = Date.now();
    await runSelfAdminLockScenario({
      admin,
      adminProfileId: nonCeoIds[0],
      blocker,
      ceoId,
      firstColor: palette[10],
      observer,
      secondColor: palette[11],
      self,
      selfProfileId: nonCeoIds[0],
      suffix: `${suffix} same-profile`,
    });
    await runSelfAdminLockScenario({
      admin,
      adminProfileId: nonCeoIds[1],
      blocker,
      ceoId,
      firstColor: palette[12],
      observer,
      secondColor: palette[13],
      self,
      selfProfileId: nonCeoIds[0],
      suffix: `${suffix} different-profiles`,
    });
  } finally {
    await blocker.query("select pg_catalog.pg_advisory_unlock_all()").catch(() => undefined);
    await Promise.all([
      self.query("rollback").catch(() => undefined),
      admin.query("rollback").catch(() => undefined),
    ]);
    await Promise.all([
      self.end().catch(() => undefined),
      admin.end().catch(() => undefined),
      blocker.end().catch(() => undefined),
      observer.end().catch(() => undefined),
    ]);
  }
}

async function verifyLastFreeColorRace(databaseUrl) {
  const setup = new pg.Client({ connectionString: databaseUrl });
  const first = new pg.Client({ connectionString: databaseUrl });
  const second = new pg.Client({ connectionString: databaseUrl });
  const cleanup = new pg.Client({ connectionString: databaseUrl });
  const suffix = Date.now();
  const marker = `Profile color race verifier ${suffix}`;
  const temporaryProfileIds = [];
  let racers = [];

  await setup.connect();
  await first.connect();
  await second.connect();
  await cleanup.connect();

  try {
    const palette = (await setup.query("select public.profile_color_palette() as colors")).rows[0]?.colors;
    racers = (await setup.query(
      "select id, profile_color from public.profiles order by id limit 2",
    )).rows;
    if (!Array.isArray(palette) || palette.length !== 20 || racers.length !== 2) {
      throw new Error("Last-free race needs the local palette and two seeded profiles.");
    }

    await setup.query("begin");
    await setup.query("update public.profiles set profile_color=$1 where id=any($2::text[])", [
      palette[0],
      racers.map((profile) => profile.id),
    ]);

    let represented = Number((await setup.query(
      "select count(distinct profile_color)::integer as count from public.profiles",
    )).rows[0]?.count);
    while (represented < 19) {
      const id = `verify-profile-color-${suffix}-race-${temporaryProfileIds.length}`;
      temporaryProfileIds.push(id);
      await insertProfile(setup, id, `Profile color race ${temporaryProfileIds.length}`);
      represented = Number((await setup.query(
        "select count(distinct profile_color)::integer as count from public.profiles",
      )).rows[0]?.count);
    }
    if (represented !== 19) {
      throw new Error(`Last-free race setup represented ${represented} colors instead of 19.`);
    }
    await setup.query("commit");

    const usedColors = new Set((await setup.query("select distinct profile_color from public.profiles")).rows.map((row) => row.profile_color));
    const lastFreeColor = palette.find((color) => !usedColors.has(color));
    if (!lastFreeColor) throw new Error("Last-free race setup did not leave one color free.");

    const race = await Promise.allSettled([
      updateOwnColor(first, racers[0].id, lastFreeColor, false, `${marker} first`),
      updateOwnColor(second, racers[1].id, lastFreeColor, false, `${marker} second`),
    ]);
    const successes = race.filter((result) => result.status === "fulfilled");
    const conflicts = race.filter((result) => result.status === "rejected" && result.reason?.code === "P0001");
    if (successes.length !== 1 || conflicts.length !== 1) {
      throw new Error("Concurrent last-free selection did not produce exactly one success and one conflict.");
    }

    const winnerId = successes[0].value.id;
    const loserId = racers.find((profile) => profile.id !== winnerId)?.id;
    if (!loserId) throw new Error("Last-free race could not identify the losing profile.");

    const representedAfterRace = Number((await setup.query(
      "select count(distinct profile_color)::integer as count from public.profiles",
    )).rows[0]?.count);
    if (representedAfterRace !== 20) {
      throw new Error("Winning the last free color did not produce a full palette.");
    }

    const deliberateRetry = await updateOwnColor(
      setup,
      loserId,
      lastFreeColor,
      true,
      `${marker} deliberate retry`,
    );
    if (deliberateRetry?.profile_color !== lastFreeColor) {
      throw new Error("The losing profile could not deliberately retry after observing the full palette.");
    }
  } finally {
    await setup.query("rollback").catch(() => undefined);
    if (temporaryProfileIds.length) {
      await cleanup.query("delete from public.profiles where id=any($1::text[])", [temporaryProfileIds]).catch(() => undefined);
    }
    for (const racer of racers) {
      await cleanup.query("update public.profiles set profile_color=$1 where id=$2", [racer.profile_color, racer.id]).catch(() => undefined);
    }
    await cleanup.query("delete from public.audit_log where user_agent like $1", [`${marker}%`]).catch(() => undefined);
    await Promise.all([
      setup.end().catch(() => undefined),
      first.end().catch(() => undefined),
      second.end().catch(() => undefined),
      cleanup.end().catch(() => undefined),
    ]);
  }
}

const databaseUrl = localDatabaseUrl();
await verifyTransactionalRules(databaseUrl);
await verifySelfAdminLockOrder(databaseUrl);
await verifyLastFreeColorRace(databaseUrl);
console.log(JSON.stringify({ status: "profile-color-allocation-verified" }));
