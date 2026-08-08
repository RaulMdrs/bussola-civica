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

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url));

/** Dependem da janela: coletam de uma fonte externa recortada por data. */
const ETAPAS_COLETA = "referencias,deputados,votacoes,proposicoes,discursos";

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
 * Até que data uma etapa foi varrida, segundo `coleta`.
 *
 * As etapas recortadas por data gravam a janela no nome do recurso
 * (`votacoes 2023-02-01..2023-04-30`), então a auditoria responde "até onde se
 * **olhou**" — que é a pergunta certa. `MAX(votacao.data)` responde só "onde
 * houve sessão": em recesso as duas divergem por semanas, e retomar pela
 * segunda revarreria o recesso inteiro a cada execução.
 */
function horizonte(glob: string): string | null {
  const r = um<{ ate: string | null }>(
    `SELECT MAX(substr(recurso, -10)) ate
     FROM coleta
     WHERE status = 'ok' AND recurso GLOB ?`,
    glob,
  );
  return r?.ate ?? null;
}

const JANELA = "????-??-??..????-??-??";
const horizVotacoes = horizonte(`votacoes ${JANELA}`);
const horizDiscursos = horizonte(`deputados/*/discursos ${JANELA}`);

/**
 * Fallback do horizonte de votação, para banco coletado antes desta auditoria.
 * Impreciso de propósito para o lado seguro: revarre em vez de pular.
 */
const fallbackVotacoes = um<{ ate: string | null }>("SELECT MAX(data) ate FROM votacao")?.ate;

const deVotacoes = horizVotacoes ?? fallbackVotacoes ?? leg.ini;

/**
 * Sem horizonte de discurso, assume-se **nenhuma** cobertura.
 *
 * Vale para banco anterior a esta versão (o recurso não trazia a janela) e para
 * banco em que a etapa nunca rodou. Nos dois casos, provar cobertura é
 * impossível, e a alternativa — assumir que os discursos acompanham as
 * votações — é o que produzia a lacuna silenciosa: quem rodasse
 * `--etapas votacoes` isoladamente ficaria sem os discursos do período, para
 * sempre e sem sinal. Recoletar custa ~31 requisições e deduplica por hash de
 * conteúdo, então o pior caso é barato. Corrige-se sozinho na primeira execução.
 */
const deDiscursos = horizDiscursos ?? leg.ini;

db.close();

/**
 * A coleta recomeça pelo **menor** horizonte: adiantar qualquer etapa deixaria
 * a que está atrasada permanentemente para trás. Etapas já em dia apenas
 * revarrem janela conhecida, o que sai do cache.
 *
 * E recomeça **na** data coberta, não no dia seguinte: a votação do dia em que
 * a coleta anterior rodou pode ter sido gravada com a sessão ainda em curso; o
 * pipeline só trata como imutável votação anterior a hoje.
 */
const inicio = menor(deVotacoes, deDiscursos);
// A legislatura tem fim; coletar além dele pediria à origem votações de outra.
const fim = menor(hoje(), leg.fim);

console.log(`Bússola Cívica — ingestão incremental`);
console.log(`banco           ${caminho}`);
console.log(`horizontes      votações  ${deVotacoes}${proveniencia(horizVotacoes, fallbackVotacoes)}`);
console.log(`                discursos ${deDiscursos}${proveniencia(horizDiscursos, null)}`);
console.log(`coleta          ${inicio} → ${fim}`);
console.log(`derivação       ${leg.ini} → ${fim}  (legislatura inteira)\n`);

if (inicio > fim) {
  console.log(`nada novo a coletar — a cobertura (${inicio}) já passa do fim da janela (${fim}).`);
  console.log(`re-derivando assim mesmo: classificação e eixos saem do que já está no banco.\n`);
} else {
  rodar(["--inicio", inicio, "--fim", fim, "--etapas", ETAPAS_COLETA]);
}

// Sempre — ver ETAPAS_DERIVACAO.
rodar(["--inicio", leg.ini, "--fim", fim, "--etapas", ETAPAS_DERIVACAO]);

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
function proveniencia(daColeta: string | null, fallback: string | null | undefined) {
  if (daColeta) return "";
  if (fallback) return "  (sem registro em coleta; inferido de votacao.data)";
  return "  (sem registro em coleta; assumindo nenhuma cobertura)";
}

function menor(a: string, b: string) {
  return a < b ? a : b;
}
