/**
 * Ingestão incremental — descobre sozinha de onde continuar.
 *
 *   npm run ingerir:incremental
 *   npm run ingerir:incremental -- --legislatura 57 --uf RS
 *
 * Envelope fino sobre `src/ingest/index.ts`: não reimplementa etapa nenhuma,
 * apenas resolve as duas datas que o operador teria de informar na mão e
 * dispara a CLI existente. Manter o pipeline num lugar só é o que garante que
 * a coleta incremental e a completa não divirjam com o tempo.
 *
 * Duas janelas, não uma — é a razão principal deste script existir:
 *
 *   coleta   última data coberta → hoje
 *   posições início da legislatura → hoje
 *
 * `posicao` é gravada com chave `(periodo_inicio, periodo_fim)`
 * (src/calc/posicoes.ts). Rodar a etapa `posicoes` na janela incremental não
 * atualizaria as posições da legislatura: criaria um segundo conjunto,
 * referente só aos dias novos, com denominador de poucas votações. O relatório
 * escolhe o período mais abrangente e esconderia o engano.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CAMINHO_DB } from "../db/client.ts";
import { hoje } from "../lib/normalizar.ts";

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url));

/** Etapas de coleta: rodam na janela nova. `posicoes` fica de fora de propósito. */
const ETAPAS_COLETA =
  "referencias,deputados,votacoes,proposicoes,discursos,reclassificar";

function args() {
  const a = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const chave = process.argv[i]?.replace(/^--/, "");
    if (chave) a.set(chave, process.argv[i + 1] ?? "");
  }
  return {
    uf: a.get("uf") ?? "RS",
    legislatura: Number(a.get("legislatura") ?? 57),
  };
}

const { uf, legislatura } = args();
const caminho = process.env.BUSSOLA_DB ?? CAMINHO_DB;

// Sem banco não há "última data coletada" — e rodar assim produziria um acervo
// truncado com aparência de acervo completo. Falhar aqui é o comportamento
// correto: o acervo inteiro se reconstrói com a CLI normal, e a mensagem diz como.
if (!existsSync(caminho)) {
  console.error(`✗ banco não encontrado: ${caminho}`);
  console.error(`  este comando continua uma coleta; não inicia uma.`);
  console.error(
    `  para reconstruir do zero:\n` +
      `    npm run ingerir -- --inicio <início da legislatura> --fim ${hoje()}`,
  );
  process.exit(1);
}

const db = new DatabaseSync(caminho);
const um = <T>(sql: string, ...p: string[]): T | undefined =>
  db.prepare(sql).get(...p) as T | undefined;

const leg = um<{ ini: string; fim: string }>(
  "SELECT data_inicio ini, data_fim fim FROM legislatura WHERE numero = ?",
  String(legislatura),
);
if (!leg) {
  console.error(`✗ legislatura ${legislatura} não está no banco`);
  console.error(`  rode a etapa 'referencias' antes: npm run ingerir -- --etapas referencias`);
  process.exit(1);
}

/**
 * Última data **coberta** pela coleta, que não é a última data com votação.
 *
 * `coleta` registra a janela pedida à origem (`votacoes 2023-02-01..2023-05-01`),
 * então diz até onde se olhou. `MAX(votacao.data)` diz só onde houve sessão — em
 * recesso as duas divergem por semanas, e recomeçar pela segunda refaria janelas
 * já varridas. O fallback existe para banco coletado antes desta auditoria.
 */
const coberto = um<{ ate: string }>(`
  SELECT MAX(substr(recurso, -10)) ate
  FROM coleta
  WHERE status = 'ok'
    AND recurso GLOB 'votacoes ????-??-??..????-??-??'`);

const comVotacao = um<{ ate: string | null }>("SELECT MAX(data) ate FROM votacao");

const ultima = coberto?.ate ?? comVotacao?.ate ?? leg.ini;
db.close();

/**
 * Recomeça **na** última data coberta, não no dia seguinte. A votação do próprio
 * dia da última execução pode ter sido coletada com a sessão ainda em curso; o
 * pipeline só trata como imutável votação anterior a hoje. Re-varrer um dia é
 * barato (cache) — perder uma votação de fecho de sessão, não.
 */
const inicio = ultima;
// A legislatura tem fim; coletar além dele pediria à origem votações de outra.
const fim = menor(hoje(), leg.fim);

console.log(`Bússola Cívica — ingestão incremental`);
console.log(`banco           ${caminho}`);
console.log(`última coberta  ${ultima}${coberto?.ate ? "" : "  (inferida de votacao.data)"}`);
console.log(`coleta          ${inicio} → ${fim}`);
console.log(`posições        ${leg.ini} → ${fim}  (legislatura inteira)\n`);

if (inicio > fim) {
  console.log(`nada a coletar: o acervo já cobre até o fim da legislatura (${leg.fim}).`);
  process.exit(0);
}

rodar(["--uf", uf, "--legislatura", String(legislatura), "--inicio", inicio, "--fim", fim, "--etapas", ETAPAS_COLETA]);
rodar(["--uf", uf, "--legislatura", String(legislatura), "--inicio", leg.ini, "--fim", fim, "--etapas", "posicoes"]);

console.log(`\n✓ incremental concluído — confira com: npm run relatorio`);

function rodar(argv: string[]) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...argv], {
    stdio: "inherit",
  });
  // Interrompida no meio: o que já entrou está gravado e `coleta` registra até
  // onde foi. Rodar de novo continua daqui — mas seguir para a etapa seguinte
  // calcularia posições sobre acervo sabidamente incompleto.
  if (r.status !== 0) {
    console.error(`\n✗ etapa falhou (código ${r.status}) — rode o comando de novo para continuar`);
    process.exit(r.status ?? 1);
  }
}

function menor(a: string, b: string) {
  return a < b ? a : b;
}
