/**
 * Orquestrador de ingestão.
 *
 *   npm run ingerir -- --inicio 2025-01-01 --fim 2025-06-30
 *   npm run ingerir -- --uf RS --legislatura 57 --etapas votacoes,posicoes
 *
 * Etapas são idempotentes e podem ser executadas isoladamente. Votações
 * passadas ficam em cache permanente — são imutáveis (docs/FONTES.md §6).
 */

import { abrirBanco } from "../db/client.ts";
import { migrar } from "../db/migrar.ts";
import { calcularPosicoes } from "../calc/posicoes.ts";
import {
  ingerirDeputados,
  ingerirDiscursos,
  ingerirProposicoes,
  ingerirReferencias,
  ingerirVotacoes,
  reclassificarDiscursos,
  type Contexto,
} from "./pipeline.ts";

const ETAPAS = [
  "referencias",
  "deputados",
  "votacoes",
  "proposicoes",
  "discursos",
  "reclassificar",
  "posicoes",
] as const;
type Etapa = (typeof ETAPAS)[number];

function args(): {
  uf: string;
  legislatura: number;
  inicio: string;
  fim: string;
  etapas: Etapa[];
} {
  const a = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const chave = process.argv[i]?.replace(/^--/, "");
    if (chave) a.set(chave, process.argv[i + 1] ?? "");
  }
  const etapas = (a.get("etapas")?.split(",").filter(Boolean) ?? ETAPAS) as Etapa[];
  const invalidas = etapas.filter((e) => !ETAPAS.includes(e));
  if (invalidas.length) {
    console.error(`etapa inválida: ${invalidas.join(", ")}`);
    console.error(`disponíveis: ${ETAPAS.join(", ")}`);
    process.exit(1);
  }
  return {
    uf: a.get("uf") ?? "RS",
    legislatura: Number(a.get("legislatura") ?? 57),
    inicio: a.get("inicio") ?? "2025-01-01",
    fim: a.get("fim") ?? "2025-06-30",
    etapas,
  };
}

async function main() {
  const { uf, legislatura, inicio, fim, etapas } = args();
  const t0 = Date.now();

  console.log(`Bússola Cívica — ingestão`);
  console.log(`UF ${uf} · legislatura ${legislatura} · ${inicio} → ${fim}`);
  console.log(`etapas: ${etapas.join(", ")}\n`);

  const pendentes = migrar();
  if (pendentes) console.log(`${pendentes} migration(s) aplicada(s)\n`);

  const { db, sqlite, consultar } = abrirBanco();
  const ctx: Contexto = {
    db,
    legislatura,
    uf,
    avisos: [],
    log: (m) => console.log(m),
  };

  try {
    if (etapas.includes("referencias")) await ingerirReferencias(ctx);
    if (etapas.includes("deputados")) await ingerirDeputados(ctx);
    if (etapas.includes("votacoes")) await ingerirVotacoes(ctx, inicio, fim);
    if (etapas.includes("proposicoes")) await ingerirProposicoes(ctx);
    if (etapas.includes("discursos")) await ingerirDiscursos(ctx, inicio, fim);
    if (etapas.includes("reclassificar")) await reclassificarDiscursos(ctx);
    if (etapas.includes("posicoes")) {
      console.log("posições");
      await calcularPosicoes(db, consultar, { legislatura, inicio, fim }, (m) => console.log(m));
    }
  } finally {
    sqlite.close();
  }

  if (ctx.avisos.length) {
    console.log(`\n⚠ ${ctx.avisos.length} aviso(s) — exigem revisão:`);
    for (const a of new Set(ctx.avisos)) console.log(`  - ${a}`);
  }

  console.log(`\nconcluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(`\n✗ ingestão interrompida: ${(e as Error).message}`);
  console.error(`  a tabela 'coleta' registra o que foi obtido antes da falha`);
  process.exit(1);
});
