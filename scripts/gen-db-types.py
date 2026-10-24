#!/usr/bin/env python3
"""Generate src/types/database.ts from a live Postgres schema.

Output follows the shape of `supabase gen types typescript` (Tables / Views /
Functions / Enums / CompositeTypes, with Relationships), but only needs `psql`,
so it works without Docker or the Supabase CLI.

Usage: scripts/gen-db-types.py "postgresql://postgres@127.0.0.1:54322/postgres" > src/types/database.ts
"""
import json
import subprocess
import sys

SCHEMA = "public"

CATALOG_SQL = r"""
WITH cols AS (
  SELECT c.relname AS tbl, c.relkind, a.attname AS col, a.attnum,
         NOT a.attnotnull AS nullable,
         (a.atthasdef OR a.attidentity <> '') AS has_default,
         a.attgenerated <> '' AS generated,
         t.typname AS typ, t.typcategory AS cat,
         et.typname AS elem_typ, et.typtype AS elem_kind, t.typtype AS kind
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
   WHERE n.nspname = :'schema' AND c.relkind IN ('r', 'v', 'm', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
),
fks AS (
  SELECT con.conname AS name, src.relname AS tbl, dst.relname AS ref,
         (SELECT array_agg(attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
            JOIN pg_attribute ON attrelid = con.conrelid AND attnum = k.n) AS cols,
         (SELECT array_agg(attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
            JOIN pg_attribute ON attrelid = con.confrelid AND attnum = k.n) AS ref_cols,
         EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = con.conrelid AND i.indisunique
                    AND i.indkey::int2[] @> con.conkey AND array_length(i.indkey::int2[], 1) = array_length(con.conkey, 1)) AS one_to_one
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace sn ON sn.oid = src.relnamespace
    JOIN pg_namespace dn ON dn.oid = dst.relnamespace
   WHERE con.contype = 'f' AND sn.nspname = :'schema' AND dn.nspname = :'schema'
),
enums AS (
  SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = :'schema' GROUP BY t.typname
),
fns AS (
  SELECT p.proname AS name, p.pronargdefaults AS n_defaults, p.proretset AS returns_set,
         rt.typname AS ret_typ, rt.typtype AS ret_kind, rt.typcategory AS ret_cat, rrel.relname AS ret_rel,
         COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
         COALESCE(p.proargmodes::text[], ARRAY[]::text[]) AS arg_modes,
         (SELECT array_agg(t.typname ORDER BY o.ord)
            FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) WITH ORDINALITY o(oid, ord)
            JOIN pg_type t ON t.oid = o.oid) AS arg_types,
         (SELECT array_agg(COALESCE(et.typname, t.typname) || CASE WHEN t.typcategory = 'A' THEN '[]' ELSE '' END ORDER BY o.ord)
            FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) WITH ORDINALITY o(oid, ord)
            JOIN pg_type t ON t.oid = o.oid LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A') AS arg_types_full
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type rt ON rt.oid = p.prorettype
    LEFT JOIN pg_class rrel ON rrel.oid = rt.typrelid AND rt.typtype = 'c'
   WHERE n.nspname = :'schema' AND p.prokind = 'f'
     AND rt.typname NOT IN ('trigger', 'event_trigger')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
)
SELECT json_build_object(
  'cols',  (SELECT json_agg(cols ORDER BY tbl, attnum) FROM cols),
  'fks',   (SELECT COALESCE(json_agg(fks ORDER BY tbl, name), '[]') FROM fks),
  'enums', (SELECT COALESCE(json_agg(enums ORDER BY name), '[]') FROM enums),
  'fns',   (SELECT COALESCE(json_agg(fns ORDER BY name), '[]') FROM fns)
);
"""

SCALARS = {
    "uuid": "string", "text": "string", "varchar": "string", "bpchar": "string", "citext": "string",
    "date": "string", "time": "string", "timetz": "string", "timestamp": "string", "timestamptz": "string",
    "interval": "string", "inet": "string", "bytea": "string", "regclass": "string",
    "int2": "number", "int4": "number", "int8": "number", "float4": "number", "float8": "number", "numeric": "number",
    "bool": "boolean", "json": "Json", "jsonb": "Json", "void": "undefined",
}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    raw = subprocess.run(
        ["psql", sys.argv[1], "-X", "-q", "-t", "-A", "-v", f"schema={SCHEMA}", "-v", "ON_ERROR_STOP=1"],
        input=CATALOG_SQL, capture_output=True, text=True, check=True,
    ).stdout
    cat = json.loads(raw)
    enum_names = {e["name"] for e in cat["enums"]}

    def ts(typname: str) -> str:
        if typname.endswith("[]"):
            return f"{ts(typname[:-2])}[]"
        if typname in enum_names:
            return f'Database["{SCHEMA}"]["Enums"]["{typname}"]'
        return SCALARS.get(typname, "unknown")

    def col_ts(c: dict) -> str:
        base = ts(c["elem_typ"] + "[]") if c["cat"] == "A" and c["elem_typ"] else ts(c["typ"])
        return f"{base} | null" if c["nullable"] else base

    relations: dict[str, dict] = {}
    for c in cat["cols"]:
        relations.setdefault(c["tbl"], {"kind": c["relkind"], "cols": []})["cols"].append(c)

    out: list[str] = [
        "// Generated by scripts/gen-db-types.py — do not edit by hand.",
        "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
        "",
        "export type Database = {",
        f"  {SCHEMA}: {{",
    ]

    def relationships(tbl: str) -> list[str]:
        lines = ["      Relationships: ["]
        for fk in (f for f in cat["fks"] if f["tbl"] == tbl):
            lines += [
                "          {",
                f'            foreignKeyName: "{fk["name"]}";',
                f'            columns: {json.dumps(fk["cols"])};',
                f'            isOneToOne: {"true" if fk["one_to_one"] else "false"};',
                f'            referencedRelation: "{fk["ref"]}";',
                f'            referencedColumns: {json.dumps(fk["ref_cols"])};',
                "          },",
            ]
        lines.append("        ];")
        return ["  " + l if i else l for i, l in enumerate(lines)]

    for section, kinds in (("Tables", {"r", "p"}), ("Views", {"v", "m"})):
        names = sorted(t for t, r in relations.items() if r["kind"] in kinds)
        if not names:
            out.append(f"    {section}: {{ [_ in never]: never }};")
            continue
        out.append(f"    {section}: {{")
        for t in names:
            cols = relations[t]["cols"]
            out.append(f"      {t}: {{")
            out.append("        Row: {")
            out += [f"          {c['col']}: {col_ts(c)};" for c in cols]
            out.append("        };")
            if section == "Tables":
                out.append("        Insert: {")
                for c in cols:
                    if c["generated"]:
                        out.append(f"          {c['col']}?: never;")
                    else:
                        opt = "?" if c["nullable"] or c["has_default"] else ""
                        out.append(f"          {c['col']}{opt}: {col_ts(c)};")
                out.append("        };")
                out.append("        Update: {")
                out += [f"          {c['col']}?: {'never' if c['generated'] else col_ts(c)};" for c in cols]
                out.append("        };")
            out += relationships(t)
            out.append("      };")
        out.append("    };")

    out.append("    Functions: {")
    for f in cat["fns"]:
        names, modes = f["arg_names"], f["arg_modes"]
        types = f["arg_types_full"] or []
        if not modes:
            modes = ["i"] * len(types)
        in_args = [(n, t) for n, t, m in zip(names or [""] * len(types), types, modes) if m in ("i", "b")]
        out_cols = [(n, t) for n, t, m in zip(names, types, modes) if m in ("o", "t")]
        first_default = len(in_args) - f["n_defaults"]
        args = "; ".join(f"{n}{'?' if i >= first_default else ''}: {ts(t)}" for i, (n, t) in enumerate(in_args))
        if out_cols:
            ret = "{ " + "; ".join(f"{n}: {ts(t)}" for n, t in out_cols) + " }"
        elif f["ret_rel"]:
            ret = f'Database["{SCHEMA}"]["Tables"]["{f["ret_rel"]}"]["Row"]'
        else:
            ret = ts(f["ret_typ"] if f["ret_cat"] != "A" else f["ret_typ"].lstrip("_") + "[]")
        if f["returns_set"]:
            ret = f"{ret}[]"
        out.append(f"      {f['name']}: {{ Args: {{ {args} }}; Returns: {ret} }};" if args
                   else f"      {f['name']}: {{ Args: Record<PropertyKey, never>; Returns: {ret} }};")
    out.append("    };")

    out.append("    Enums: {")
    out += [f"      {e['name']}: {' | '.join(json.dumps(l) for l in e['labels'])};" for e in cat["enums"]]
    out.append("    };")
    out += ["    CompositeTypes: { [_ in never]: never };", "  };", "};", ""]

    out += [
        f'type PublicSchema = Database["{SCHEMA}"];',
        'export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];',
        'export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];',
        'export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];',
        'export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];',
        "",
    ]
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
