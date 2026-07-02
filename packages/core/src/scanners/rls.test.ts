import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRls,
  generateRlsMigration,
  inferOwnershipColumn,
  type TableInfo,
  type PolicyInfo,
} from "./rls.js";

function table(over: Partial<TableInfo>): TableInfo {
  return {
    schema: "public",
    name: "profiles",
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "bio", type: "text" },
    ],
    rlsEnabled: true,
    policies: [],
    ...over,
  };
}

const ownerSelect: PolicyInfo = {
  name: "p_select_own",
  command: "SELECT",
  usingExpr: "auth.uid() = user_id",
  withCheckExpr: null,
  roles: ["authenticated"],
};

test("flags RLS disabled on a public table as critical", () => {
  const f = analyzeRls({ tables: [table({ rlsEnabled: false })] });
  assert.equal(f.length, 1);
  assert.equal(f[0]!.issue, "rls_disabled");
  assert.equal(f[0]!.severity, "critical");
  assert.equal(f[0]!.fixable, true);
});

test("does not flag tables outside API-exposed schemas", () => {
  const f = analyzeRls({
    tables: [table({ schema: "auth", rlsEnabled: false })],
  });
  assert.equal(f.length, 0);
});

test("ignores views even in public schema", () => {
  const f = analyzeRls({
    tables: [table({ isView: true, rlsEnabled: false })],
  });
  assert.equal(f.length, 0);
});

test("flags a permissive USING(true) policy as critical", () => {
  const f = analyzeRls({
    tables: [
      table({
        policies: [
          { name: "open", command: "ALL", usingExpr: "true", withCheckExpr: null, roles: ["anon"] },
        ],
      }),
    ],
  });
  assert.equal(f[0]!.issue, "permissive_policy");
  assert.equal(f[0]!.severity, "critical");
});

test("flags ownership column not scoped by auth.uid() as high", () => {
  const f = analyzeRls({
    tables: [
      table({
        policies: [
          {
            name: "by_org",
            command: "SELECT",
            usingExpr: "org_id = current_setting('x')",
            withCheckExpr: null,
            roles: ["authenticated"],
          },
        ],
      }),
    ],
  });
  assert.equal(f[0]!.issue, "owner_not_scoped");
  assert.equal(f[0]!.severity, "high");
});

test("a correctly owner-scoped table produces no finding", () => {
  const f = analyzeRls({ tables: [table({ policies: [ownerSelect] })] });
  assert.equal(f.length, 0);
});

test("RLS enabled with no policies is a low-severity misconfig", () => {
  const f = analyzeRls({ tables: [table({ policies: [] })] });
  assert.equal(f[0]!.issue, "rls_no_policies");
  assert.equal(f[0]!.severity, "low");
});

test("sorts findings most-severe first", () => {
  const f = analyzeRls({
    tables: [
      table({ name: "notes", policies: [] }), // low
      table({ name: "orders", rlsEnabled: false }), // critical
    ],
  });
  assert.equal(f[0]!.severity, "critical");
  assert.equal(f[1]!.severity, "low");
});

test("infers uuid ownership column preferentially", () => {
  const col = inferOwnershipColumn(
    table({
      columns: [
        { name: "created_by", type: "text" },
        { name: "user_id", type: "uuid" },
      ],
    }),
  );
  assert.equal(col, "user_id");
});

test("generateRlsMigration emits owner-scoped policies and quotes identifiers", () => {
  const sql = generateRlsMigration({ schema: "public", name: "profiles" }, "user_id");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select using \(\(select auth\.uid\(\)\) = "user_id"\)/);
  assert.match(sql, /"public"\."profiles"/);
  // covers all four commands
  for (const cmd of ["select", "insert", "update", "delete"]) {
    assert.ok(sql.includes(`for ${cmd}`), `missing ${cmd} policy`);
  }
});

test("fingerprint is stable across identical snapshots", () => {
  const snap = { tables: [table({ rlsEnabled: false })] };
  assert.equal(analyzeRls(snap)[0]!.fingerprint, analyzeRls(snap)[0]!.fingerprint);
});
