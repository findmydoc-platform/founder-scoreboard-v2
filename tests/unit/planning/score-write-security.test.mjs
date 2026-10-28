import { expect, test } from "vitest";
import { verifyCatalogSecurity } from "../../../scripts/lib/database-security/catalog-security.mjs";
async function inspect(rows) {
 const failures=[];
 await verifyCatalogSecurity({query:async sql=>({rows:sql.includes("relation.relkind in ('r', 'p', 'v', 'm', 'f')")?rows:[]})},failures);
 return failures.filter(message=>message.startsWith("authenticated transactional Score writes"));
}
test.each(["INSERT","UPDATE","DELETE"])("the production catalog verifier rejects authenticated Score %s without misclassifying its team reads",async privilege_name=>{
 expect(await inspect([{role_name:"authenticated",relation_name:"founder_sprint_scores",privilege_name}])).toEqual([`authenticated transactional Score writes: founder_sprint_scores:${privilege_name}`]);
});
test("Score SELECT, service-owned writes and unrelated existing table privileges remain permitted by the bounded invariant",async()=>{
 expect(await inspect([{role_name:"authenticated",relation_name:"founder_sprint_scores",privilege_name:"SELECT"},{role_name:"service_role",relation_name:"founder_sprint_scores",privilege_name:"INSERT"},{role_name:"authenticated",relation_name:"sprint_commitments",privilege_name:"UPDATE"}])).toEqual([]);
});
