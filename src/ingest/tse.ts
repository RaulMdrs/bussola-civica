/**
 * Ingestão do TSE — candidaturas de 2022, via CSV de dados abertos.
 *
 * Não usa a API DivulgaCand de propósito. Lá, `cpf` vem `null` na listagem e só
 * aparece no detalhe, um candidato por requisição: cruzar por CPF custaria 546
 * requisições por UF (§3.1). O CSV traz tudo de uma vez, já separado por UF, num
 * arquivo de 4 MB (§3.4).
 *
 * O cruzamento é **por CPF**, único campo confiável: nome não serve (a Câmara
 * usa nome parlamentar, o TSE nome de urna em caixa alta) e partido menos ainda
 * (6 dos 31 trocaram de legenda desde a eleição). O CPF nunca é guardado — o
 * que entra no banco é o HMAC dos dois lados (`src/lib/identidade.ts`).
 */

import { and, eq } from "drizzle-orm";
import * as s from "../db/schema.ts";
import { extrairDoZip } from "../lib/zip.ts";
import { hmacCpf, segredoCpf } from "../lib/identidade.ts";
import { normalizarSigla } from "../lib/normalizar.ts";
import type { Contexto } from "./pipeline.ts";

const URL_ZIP =
  "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip";

/** O CDN do TSE recusa cliente sem User-Agent de navegador (§3). */
const CABECALHOS = { "User-Agent": "Mozilla/5.0 (compatible; bussola-civica)" };

const ANO = "2022";

/**
 * Situações que significam eleito.
 *
 * Filtrar por `/ELEITO/` é o erro clássico aqui: captura "NÃO ELEITO", que são
 * 178 dos 546. As duas formas válidas somam exatamente 31 — o mesmo número de
 * cadeiras que a Câmara devolve para o RS (§3.4).
 */
const ELEITO = new Set(["ELEITO POR QP", "ELEITO POR MÉDIA"]);

/**
 * Parser de CSV com aspas.
 *
 * `split(";")` quebraria em qualquer campo que contenha ponto e vírgula dentro
 * das aspas — e há 50 colunas de texto livre aqui, incluindo nome e descrição de
 * ocupação. Um separador mal lido desloca a linha inteira e o CPF passa a ser
 * lido de outra coluna, silenciosamente.
 */
export function lerCsv(texto: string, separador = ";"): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else dentroDeAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') dentroDeAspas = true;
    else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.length > 1);
}

export interface CandidatoTse {
  sqCandidato: string;
  cpf: string;
  nomeUrna: string;
  nomeCivil: string;
  siglaPartido: string;
  situacao: string;
  eleito: boolean;
}

/** Extrai os candidatos a deputado federal de um CSV já decodificado. */
export function candidatosDeputadoFederal(texto: string): CandidatoTse[] {
  const linhas = lerCsv(texto);
  const cab = linhas[0]!;
  const idx = (nome: string) => {
    const i = cab.indexOf(nome);
    // Coluna ausente significa que o layout do TSE mudou. Seguir com -1 leria
    // `undefined` como CPF e produziria zero cruzamentos, sem erro nenhum.
    if (i < 0) throw new Error(`coluna ausente no CSV do TSE: ${nome}`);
    return i;
  };

  const iCargo = idx("DS_CARGO");
  const iSq = idx("SQ_CANDIDATO");
  const iCpf = idx("NR_CPF_CANDIDATO");
  const iUrna = idx("NM_URNA_CANDIDATO");
  const iNome = idx("NM_CANDIDATO");
  const iPartido = idx("SG_PARTIDO");
  const iSit = idx("DS_SIT_TOT_TURNO");

  const out: CandidatoTse[] = [];
  for (const l of linhas.slice(1)) {
    if (l[iCargo] !== "DEPUTADO FEDERAL") continue;
    out.push({
      sqCandidato: l[iSq] ?? "",
      cpf: l[iCpf] ?? "",
      nomeUrna: l[iUrna] ?? "",
      nomeCivil: l[iNome] ?? "",
      siglaPartido: l[iPartido] ?? "",
      situacao: l[iSit] ?? "",
      eleito: ELEITO.has(l[iSit] ?? ""),
    });
  }
  return out;
}

export async function ingerirTse(ctx: Contexto) {
  ctx.log(`TSE — candidaturas ${ANO}, ${ctx.uf}`);
  const segredo = segredoCpf();

  const iniciadoEm = new Date().toISOString();
  const resposta = await fetch(URL_ZIP, { headers: CABECALHOS });
  if (!resposta.ok) {
    await ctx.db.insert(s.coleta).values({
      fonte: "tse",
      recurso: `consulta_cand_${ANO}`,
      url: URL_ZIP,
      iniciadoEm,
      concluidoEm: new Date().toISOString(),
      status: "falha",
      httpStatus: resposta.status,
      erro: `HTTP ${resposta.status}`,
    });
    throw new Error(`TSE: HTTP ${resposta.status} ao baixar ${URL_ZIP}`);
  }
  const zip = Buffer.from(await resposta.arrayBuffer());

  const nomeCsv = `consulta_cand_${ANO}_${ctx.uf}.csv`;
  // latin-1, não UTF-8: decodificar errado corrompe nome próprio e, pior,
  // passaria despercebido porque o CPF continuaria legível.
  const texto = extrairDoZip(zip, nomeCsv).toString("latin1");
  const candidatos = candidatosDeputadoFederal(texto);
  const eleitos = candidatos.filter((c) => c.eleito).length;

  await ctx.db.insert(s.coleta).values({
    fonte: "tse",
    recurso: `consulta_cand_${ANO}_${ctx.uf}`,
    url: URL_ZIP,
    iniciadoEm,
    concluidoEm: new Date().toISOString(),
    status: "ok",
    httpStatus: 200,
    registros: candidatos.length,
  });
  ctx.log(`  ${candidatos.length} candidatos a deputado federal, ${eleitos} eleitos`);

  if (eleitos !== 31) {
    // 31 é o nº de cadeiras do RS, conferido contra a Câmara no reconhecimento.
    // Divergência aqui é sinal de mudança de layout ou de filtro errado.
    ctx.avisos.push(
      `TSE: ${eleitos} eleitos no CSV, esperados 31 — conferir DS_SIT_TOT_TURNO`,
    );
  }

  const alias = await popularAliasPartido(ctx, candidatos);
  const { vinculados, criados, semCpf } = await vincular(ctx, candidatos, segredo);

  ctx.log(`  ${vinculados} vinculados a político existente, ${criados} criados`);
  ctx.log(`  ${alias} alias de partido, ${semCpf} sem CPF na origem`);
}

/**
 * Registra grafias do TSE que diferem da canônica adotada.
 *
 * O caso concreto é "PC do B" (TSE) × "PCdoB" (Câmara). Sem o alias, o
 * cruzamento futuro produz um falso positivo de troca de partido — afirmação
 * sobre uma pessoa real, que num produto de credibilidade não pode sair errada.
 */
async function popularAliasPartido(ctx: Contexto, candidatos: CandidatoTse[]) {
  const brutas = new Set(candidatos.map((c) => c.siglaPartido).filter(Boolean));
  let gravados = 0;

  for (const bruta of brutas) {
    const canonica = normalizarSigla(bruta);
    if (!canonica || canonica === bruta) continue; // grafia já é a canônica

    const [p] = await ctx.db
      .select({ id: s.partido.id })
      .from(s.partido)
      .where(eq(s.partido.sigla, canonica));
    if (!p) continue; // partido que a Câmara não conhece: nada a reconciliar

    await ctx.db
      .insert(s.partidoAlias)
      .values({ partidoId: p.id, alias: bruta, fonte: "tse" })
      .onConflictDoNothing();
    gravados++;
  }
  return gravados;
}

async function vincular(
  ctx: Contexto,
  candidatos: CandidatoTse[],
  segredo: string,
) {
  let vinculados = 0;
  let criados = 0;
  let semCpf = 0;

  for (const c of candidatos) {
    const hmac = hmacCpf(c.cpf, segredo);
    if (!hmac) {
      semCpf++;
      continue;
    }

    const [existente] = await ctx.db
      .select({ id: s.politico.id })
      .from(s.politico)
      .where(eq(s.politico.cpfHmac, hmac));

    let politicoId: number;
    if (existente) {
      politicoId = existente.id;
      vinculados++;
    } else {
      /**
       * Candidato sem correspondência na Câmara: não tem mandato, então não
       * tem voto, discurso nem posição. Entra com `perfil_completo = 0`, que é
       * a barreira que impede a interface de oferecer perfil de quem só tem
       * nome — lacuna de coleta não pode parecer perfil vazio.
       */
      await ctx.db.insert(s.politico).values({
        cpfHmac: hmac,
        nomeParlamentar: c.nomeUrna,
        nomeCivil: c.nomeCivil,
        perfilCompleto: false,
        fonteUrl: URL_ZIP,
      });
      const [novo] = await ctx.db
        .select({ id: s.politico.id })
        .from(s.politico)
        .where(eq(s.politico.cpfHmac, hmac));
      politicoId = novo!.id;
      criados++;
    }

    await ctx.db
      .insert(s.identidadeExterna)
      .values({
        politicoId,
        fonte: "tse",
        idExterno: c.sqCandidato,
        contexto: ANO,
        // A fonte é o CSV de onde o dado saiu, não uma URL de portal montada à
        // mão: `fonte_url` tem de levar ao arquivo que sustenta a afirmação.
        fonteUrl: URL_ZIP,
      })
      .onConflictDoNothing();
  }

  return { vinculados, criados, semCpf };
}
