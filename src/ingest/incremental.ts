/**
 * Ingestão incremental — descobre sozinha de onde continuar.
 *
 *   npm run ingerir:incremental
 *   npm run ingerir:incremental -- --legislatura 57 --uf RS
 *
 * Envelope fino sobre `src/ingest/index.ts`: não reimplementa etapa nenhuma,
 * apenas resolve as datas que o operador teria de informar na mão e dispara a
 * CLI existente. Manter o pipeline num lugar só é o que garante que a coleta
 * incremental e a completa não divirjam com o tempo.
 *
 * Duas janelas, não uma — é a razão principal deste script existir:
 *
 *   coleta   menor horizonte entre as etapas → hoje
 *   derivação início da legislatura → hoje
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
import { descobrirJanelas, type Origem } from "./horizonte.ts";

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url));

/** Dependem da janela: coletam de uma fonte externa recortada por data. */
const ETAPAS_COLETA = "referencias,deputados,votacoes,proposicoes,discursos,senado";

/**
 * Não dependem da janela de coleta: re-derivam do que já está no banco. Rodam
 * **sempre**, inclusive quando não há nada novo a coletar — mudança de regra de
 * classificação ou de metodologia de eixo precisa poder ser aplicada sem que a
 * origem tenha publicado uma sessão nova.
 */
const ETAPAS_DERIVACAO = "reclassificar,posicoes";

const FLAGS_ACEITAS = new Set(["uf", "legislatura"]);

function args() {
  const a = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const chave = process.argv[i]?.replace(/^--/, "");
    if (chave) a.set(chave, process.argv[i + 1] ?? "");
  }

  // Ignorar flag desconhecida em silêncio é o pior comportamento possível aqui:
  // quem escreve `--inicio 2026-01-01` acredita ter restringido a janela, e o
  // script coletaria desde a última data coberta sem dizer nada.
  const desconhecidas = [...a.keys()].filter((k) => !FLAGS_ACEITAS.has(k));
  if (desconhecidas.length) {
    console.error(`✗ flag não aceita: ${desconhecidas.map((f) => `--${f}`).join(", ")}`);
    console.error(`  aceitas aqui: ${[...FLAGS_ACEITAS].map((f) => `--${f}`).join(", ")}`);
    console.error(`  as datas são descobertas no banco — para escolher a janela na mão,`);
    console.error(`  use: npm run ingerir -- --inicio <data> --fim <data> [--etapas ...]`);
    process.exit(1);
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
  db.close();
  console.error(`✗ legislatura ${legislatura} não está no banco`);
  console.error(`  rode a etapa 'referencias' antes: npm run ingerir -- --etapas referencias`);
  process.exit(1);
}

/**
 * A retomada recomeça **na** data coberta, não no dia seguinte: a votação do
 * dia em que a coleta anterior rodou pode ter sido gravada com a sessão ainda
 * em curso, e o pipeline só trata como imutável votação anterior a hoje.
 *
 * A decisão em si mora em `horizonte.ts`, para poder ser verificada em
 * `npm run db:validar` sem tocar na rede.
 */
const j = descobrirJanelas((sql, ...p) => um(sql, ...p), leg, hoje());

db.close();

console.log(`Bússola Cívica — ingestão incremental`);
console.log(`banco           ${caminho}`);
console.log(`horizontes      votações  ${j.votacoes.ate}${nota(j.votacoes.origem)}`);
console.log(`                discursos ${j.discursos.ate}${nota(j.discursos.origem)}`);
console.log(`                senado    ${j.senado.ate}${nota(j.senado.origem)}`);
console.log(`coleta          ${j.inicio} → ${j.fim}`);
console.log(`derivação       ${leg.ini} → ${j.fim}  (legislatura inteira)\n`);

if (!j.coletar) {
  console.log(`nada novo a coletar — a cobertura (${j.inicio}) já passa do fim da janela (${j.fim}).`);
  console.log(`re-derivando assim mesmo: classificação e eixos saem do que já está no banco.\n`);
} else {
  rodar(["--inicio", j.inicio, "--fim", j.fim, "--etapas", ETAPAS_COLETA]);
}

// Sempre — ver ETAPAS_DERIVACAO.
rodar(["--inicio", leg.ini, "--fim", j.fim, "--etapas", ETAPAS_DERIVACAO]);

console.log(`\n✓ incremental concluído — confira com: npm run relatorio`);

function rodar(janela: string[]) {
  const argv = ["--uf", uf, "--legislatura", String(legislatura), ...janela];
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

/** Diz de onde veio a data, para que "sem registro" não pareça "coletado até". */
function nota(origem: Origem) {
  if (origem === "coleta") return "";
  if (origem === "votacao") return "  (sem registro em coleta; inferido de votacao.data)";
  return "  (sem registro em coleta; assumindo nenhuma cobertura)";
}
