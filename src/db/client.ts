/**
 * Cliente do banco.
 *
 * Usa `node:sqlite` (nativo desde o Node 22) por baixo do adaptador genérico
 * `sqlite-proxy` do Drizzle. O Drizzle ainda não publica driver próprio para
 * `node:sqlite`, e `better-sqlite3` exige compilação nativa que falha no Node 26.
 * Este caminho mantém a tipagem do Drizzle com zero dependência nativa.
 */

import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";

export const CAMINHO_DB = process.env.BUSSOLA_DB ?? "./data/bussola.db";

/** node:sqlite aceita apenas null | number | bigint | string | Uint8Array. */
function saneia(v: unknown): null | number | bigint | string | Uint8Array {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v as number | bigint | string | Uint8Array;
}

export function abrirBanco(caminho = CAMINHO_DB) {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const sqlite = new DatabaseSync(caminho);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA journal_mode = WAL");

  const db = drizzle(
    async (sql, params, method) => {
      const p = params.map(saneia);
      const stmt = sqlite.prepare(sql);

      if (method === "run") {
        stmt.run(...p);
        return { rows: [] };
      }

      // columns() preserva a ordem real do resultado — necessário porque joins
      // podem repetir nomes de coluna, e o proxy espera arrays posicionais.
      const nomes = stmt.columns().map((c) => c.name);
      const linhas = stmt.all(...p) as Record<string, unknown>[];
      const rows = linhas.map((l) => nomes.map((n) => l[n] ?? null));

      if (method === "get") return { rows: rows[0] ?? [] };
      return { rows };
    },
    { schema, casing: "snake_case" },
  );

  /**
   * SQL analítico, devolvendo objetos.
   *
   * Existe porque `db.all()` sobre o sqlite-proxy devolve **arrays posicionais**,
   * não objetos — o proxy é um transporte, e o mapeamento para colunas nomeadas
   * só acontece nas queries construídas pelo ORM. Os cálculos de posição usam
   * CTEs e agregações que o query builder não expressa bem, então vão por aqui,
   * onde `politico_id` é de fato `politico_id`.
   */
  const consultar = <T>(sql: string, ...params: unknown[]): T[] =>
    sqlite.prepare(sql).all(...(params.map(saneia) as never[])) as T[];

  return { db, sqlite, consultar };
}

export type Banco = ReturnType<typeof abrirBanco>["db"];
export type Consultar = ReturnType<typeof abrirBanco>["consultar"];
export { schema };
