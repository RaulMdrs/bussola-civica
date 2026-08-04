/**
 * Aplica as migrations geradas pelo drizzle-kit.
 *
 * O `drizzle-kit migrate` exige um driver suportado; como usamos `node:sqlite`
 * via proxy (ver client.ts), aplicamos o SQL diretamente. Controle de quais
 * migrations já rodaram fica em `_migrations`.
 *
 *   uso:  npm run db:migrar
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CAMINHO_DB } from "./client.ts";

const DIR = "drizzle";

export function migrar(caminho = CAMINHO_DB): number {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    nome TEXT PRIMARY KEY,
    aplicada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )`);

  const aplicadas = new Set(
    (db.prepare("SELECT nome FROM _migrations").all() as { nome: string }[]).map(
      (r) => r.nome,
    ),
  );
  const pendentes = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !aplicadas.has(f));

  for (const arquivo of pendentes) {
    const sql = readFileSync(join(DIR, arquivo), "utf8");
    db.exec("BEGIN");
    try {
      for (const stmt of sql.split("--> statement-breakpoint")) {
        const s = stmt.trim();
        if (s) db.exec(s);
      }
      db.prepare("INSERT INTO _migrations (nome) VALUES (?)").run(arquivo);
      db.exec("COMMIT");
      console.log(`  ✓ ${arquivo}`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`falha em ${arquivo}: ${(e as Error).message}`);
    }
  }
  db.close();
  return pendentes.length;
}

if (import.meta.filename === process.argv[1]) {
  const n = migrar();
  console.log(n === 0 ? "banco já atualizado" : `${n} migration(s) aplicada(s)`);
}
