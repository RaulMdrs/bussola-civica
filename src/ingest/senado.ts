/**
 * Ingestão do Senado Federal — Fase 1.
 *
 * Não é "o mesmo modelo com outra fonte". Três diferenças estruturais, todas
 * medidas contra a origem (docs/FONTES.md §2):
 *
 * 1. **68% das votações são secretas.** Em votação secreta a API informa que o
 *    senador votou, não como. Sobram 114 votações abertas em 2023–2026, contra
 *    1.117 nominais da Câmara.
 * 2. **Não existe orientação de bancada.** Nem no endpoint de votação, nem em
 *    endpoint próprio — nove candidatos testados, todos 404. Sem referência
 *    oficial, o eixo de alinhamento com o governo **não é calculável aqui**, e
 *    escolher uma referência seria rotular por conta própria.
 * 3. **O vocabulário de voto é outro** (`AP`, `P-NRV`, `LS`, `MIS`, `NCom`…).
 *    `normalizarVoto` já o cobre desde o reconhecimento: 12 códigos, zero
 *    desconhecidos quando exercitado contra as 114 abertas.
 *
 * O endpoint por senador (`/senador/{cod}/votacoes.json`) está depreciado com
 * desativação declarada para 2026-02-01 — data vencida, e ele ainda responde.
 * Nada aqui é construído sobre ele.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../db/schema.ts";
import { buscarJson } from "../lib/http.ts";
import { normalizarSigla, normalizarVoto } from "../lib/normalizar.ts";
import type { Contexto } from "./pipeline.ts";

const BASE = "https://legis.senado.leg.br/dadosabertos";

interface VotoSenado {
  codigoParlamentar: number;
  nomeParlamentar: string;
  siglaPartidoParlamentar: string | null;
  siglaUFParlamentar: string | null;
  siglaVotoParlamentar: string | null;
}

interface VotacaoSenado {
  codigoSessaoVotacao: number;
  dataSessao: string;
  identificacao: string | null;
  descricaoVotacao: string | null;
  votacaoSecreta: string; // "S" | "N"
  resultadoVotacao: string | null;
  totalVotosSim: number | null;
  totalVotosNao: number | null;
  votos: VotoSenado[] | null;
}

interface SenadorApi {
  IdentificacaoParlamentar: {
    CodigoParlamentar: string;
    NomeParlamentar: string;
    SiglaPartidoParlamentar: string | null;
    UfParlamentar: string | null;
  };
  /**
   * O mandato do Senado cobre **duas** legislaturas (8 anos). Para Paulo Paim,
   * eleito em 2018, a 57ª é a segunda; para quem se elegeu em 2022, é a
   * primeira. Por isso o início do exercício no recorte é o mais tardio entre
   * o começo do mandato e o começo da legislatura — nenhuma data é inventada,
   * as duas vêm da origem.
   */
  Mandato?: {
    DescricaoParticipacao?: string;
    PrimeiraLegislaturaDoMandato?: { NumeroLegislatura?: string; DataInicio?: string };
    SegundaLegislaturaDoMandato?: { NumeroLegislatura?: string; DataInicio?: string };
  };
}

/** URL pública da votação — é o link que o leitor vê, não o endpoint da API. */
const fonteVotacao = (cod: number) =>
  `${BASE}/votacao?codigoSessaoVotacao=${cod}`;

export async function ingerirSenado(ctx: Contexto, inicio: string, fim: string) {
  ctx.log(`Senado — ${inicio} → ${fim}`);

  await ingerirSenadores(ctx);

  const anos: number[] = [];
  for (let a = Number(inicio.slice(0, 4)); a <= Number(fim.slice(0, 4)); a++) anos.push(a);

  let total = 0;
  let abertas = 0;
  let secretas = 0;
  let votosGravados = 0;

  for (const ano of anos) {
    const url = `${BASE}/votacao?ano=${ano}`;
    const iniciadoEm = new Date().toISOString();
    const r = await buscarJson<VotacaoSenado[]>(url);
    await ctx.db.insert(s.coleta).values({
      fonte: "senado",
      recurso: `votacao ano=${ano}`,
      url,
      iniciadoEm,
      concluidoEm: new Date().toISOString(),
      status: "ok",
      httpStatus: 200,
      tentativas: r.tentativas,
      registros: r.dados.length,
    });

    for (const v of r.dados) {
      if (v.dataSessao < inicio || v.dataSessao > fim) continue;
      total++;
      const secreta = v.votacaoSecreta === "S";
      secreta ? secretas++ : abertas++;
      votosGravados += await gravarVotacao(ctx, v, secreta);
    }
  }

  ctx.log(`  ${total} votações · ${abertas} abertas, ${secretas} secretas`);
  ctx.log(`  ${votosGravados} votos gravados`);
  if (abertas === 0 && total > 0) {
    ctx.avisos.push("Senado: nenhuma votação aberta no período — nada apurável");
  }
}

/**
 * Senadores do recorte, com perfil completo, e os demais como contraparte.
 *
 * A maioria partidária do eixo de coesão é apurada sobre a bancada **nacional**
 * do partido, como na Câmara — então os 81 precisam existir. Só os do recorte
 * recebem `perfil_completo`.
 *
 * Não há CPF na API do Senado (verificado no endpoint de detalhe), então estes
 * políticos não têm `cpf_hmac` e **não cruzam com o TSE**. É lacuna da origem,
 * registrada como tal em vez de preenchida por nome — nome de urna não é chave.
 */
async function ingerirSenadores(ctx: Contexto) {
  const url = `${BASE}/senador/lista/atual.json`;
  const r = await buscarJson<{
    ListaParlamentarEmExercicio?: { Parlamentares?: { Parlamentar?: SenadorApi[] } };
  }>(url);
  const lista = r.dados.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ?? [];

  let doRecorte = 0;
  for (const p of lista) {
    const i = p.IdentificacaoParlamentar;
    const noRecorte = i.UfParlamentar === ctx.uf;
    const politicoId = await upsertSenador(ctx, i.CodigoParlamentar, i.NomeParlamentar, noRecorte, url);
    if (!noRecorte) continue;
    doRecorte++;

    await gravarMandato(ctx, politicoId, p, url);

    const partidoId = await idPartidoSenado(ctx, i.SiglaPartidoParlamentar);
    if (partidoId) {
      await ctx.db
        .insert(s.filiacao)
        .values({
          politicoId,
          partidoId,
          // A lista devolve só a filiação corrente, sem data de início. Gravar
          // uma data inventada seria pior que gravar o começo da legislatura.
          dataInicio: "2023-02-01",
          fonteUrl: url,
        })
        .onConflictDoNothing();
    }
  }
  ctx.log(`  ${lista.length} senadores em exercício, ${doRecorte} do ${ctx.uf}`);
}

/**
 * Mandato e exercício do senador na legislatura do recorte.
 *
 * Sem isto, `oportunidadesPorPolitico` devolve zero e o site exibe `n=104/0` —
 * um denominador que não existe. O denominador individualizado é a mesma regra
 * da Câmara (§1.8): o parlamentar é medido contra as votações que **podia**
 * votar.
 *
 * O início do exercício é o mais tardio entre o começo do mandato e o começo da
 * legislatura, ambos vindos da origem. Estar na lista já significa "em
 * exercício" — o endpoint é `ListaParlamentarEmExercicio` —, então não se grava
 * data de fim.
 */
async function gravarMandato(
  ctx: Contexto,
  politicoId: number,
  p: SenadorApi,
  url: string,
) {
  const m = p.Mandato;
  const legislaturas = [m?.PrimeiraLegislaturaDoMandato, m?.SegundaLegislaturaDoMandato];
  const daLegislatura = legislaturas.find(
    (l) => Number(l?.NumeroLegislatura) === ctx.legislatura,
  );
  if (!daLegislatura?.DataInicio) {
    ctx.avisos.push(
      `Senado: ${p.IdentificacaoParlamentar.NomeParlamentar} sem mandato na legislatura ${ctx.legislatura} — sem denominador`,
    );
    return;
  }

  const [leg] = await ctx.db
    .select({ ini: s.legislatura.dataInicio })
    .from(s.legislatura)
    .where(eq(s.legislatura.numero, ctx.legislatura));
  const inicio =
    daLegislatura.DataInicio > (leg?.ini ?? "") ? daLegislatura.DataInicio : leg!.ini;

  const condicao = /suplente/i.test(m?.DescricaoParticipacao ?? "") ? "suplente" : "titular";

  await ctx.db
    .insert(s.mandato)
    .values({
      politicoId,
      casa: "senado",
      legislaturaNumero: ctx.legislatura,
      uf: p.IdentificacaoParlamentar.UfParlamentar ?? ctx.uf,
      condicaoEleitoral: condicao,
      fonteUrl: url,
    })
    .onConflictDoNothing();

  const [mand] = await ctx.db
    .select({ id: s.mandato.id })
    .from(s.mandato)
    .where(
      and(
        eq(s.mandato.politicoId, politicoId),
        eq(s.mandato.casa, "senado"),
        eq(s.mandato.legislaturaNumero, ctx.legislatura),
      ),
    );
  if (!mand) return;

  await ctx.db
    .insert(s.exercicio)
    .values({
      mandatoId: mand.id,
      dataInicio: inicio,
      dataFim: null,
      situacao: "Exercício",
      fonteUrl: url,
    })
    .onConflictDoNothing();
}

/** Cache por código do Senado — a função é chamada uma vez por voto, ~9.200×. */
const cacheSenadores = new Map<string, number>();

async function upsertSenador(
  ctx: Contexto,
  codigo: string,
  nome: string,
  noRecorte: boolean,
  url: string,
): Promise<number> {
  const emCache = cacheSenadores.get(codigo);
  if (emCache && !noRecorte) return emCache;

  const [existente] = await ctx.db
    .select({ politicoId: s.identidadeExterna.politicoId })
    .from(s.identidadeExterna)
    .where(
      and(eq(s.identidadeExterna.fonte, "senado"), eq(s.identidadeExterna.idExterno, codigo)),
    );

  if (existente) {
    // Não rebaixa perfil completo: a lista do recorte roda antes da coleta de
    // votos, e lá o mesmo senador reaparece como contraparte.
    if (noRecorte) {
      await ctx.db
        .update(s.politico)
        .set({ nomeParlamentar: nome, perfilCompleto: true })
        .where(eq(s.politico.id, existente.politicoId));
    }
    cacheSenadores.set(codigo, existente.politicoId);
    return existente.politicoId;
  }

  await ctx.db.insert(s.politico).values({
    nomeParlamentar: nome,
    perfilCompleto: noRecorte,
    fonteUrl: url,
  });
  /**
   * Sem CPF na origem, não há chave natural para reler a linha recém-inserida.
   * `last_insert_rowid()` vem da mesma conexão que o Drizzle usa por baixo do
   * `sqlite-proxy`, então devolve o id desta inserção — e a ingestão é
   * estritamente sequencial, sem outra escrita capaz de se intercalar.
   */
  const { id } = ctx.sqlite.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };

  await ctx.db.insert(s.identidadeExterna).values({
    politicoId: id,
    fonte: "senado",
    idExterno: codigo,
    contexto: null,
    fonteUrl: url,
  });
  cacheSenadores.set(codigo, id);
  return id;
}

async function idPartidoSenado(ctx: Contexto, sigla: string | null | undefined) {
  const s2 = normalizarSigla(sigla);
  if (!s2) return null;
  await ctx.db.insert(s.partido).values({ sigla: s2 }).onConflictDoNothing();
  const [p] = await ctx.db.select({ id: s.partido.id }).from(s.partido).where(eq(s.partido.sigla, s2));
  return p?.id ?? null;
}

async function gravarVotacao(
  ctx: Contexto,
  v: VotacaoSenado,
  secreta: boolean,
): Promise<number> {
  const idExterno = String(v.codigoSessaoVotacao);
  const descricao = v.descricaoVotacao ?? v.identificacao ?? "(sem descrição na origem)";

  await ctx.db
    .insert(s.votacao)
    .values({
      casa: "senado",
      idExterno,
      orgaoId: null,
      data: v.dataSessao,
      descricao,
      aprovacao: v.resultadoVotacao ? /aprovad/i.test(v.resultadoVotacao) : null,
      // No Senado toda votação registrada é nominal no sentido de ter lista de
      // votos; o que muda é o sigilo. `secreta` é o eixo que decide se o voto
      // individual existe (§2.4).
      nominal: (v.votos?.length ?? 0) > 0,
      secreta,
      totalSim: v.totalVotosSim ?? null,
      totalNao: v.totalVotosNao ?? null,
      // `natureza` fica NULL: a regra de classificação foi calibrada contra
      // descrição da Câmara e não foi validada para o texto do Senado.
      fonteUrl: fonteVotacao(v.codigoSessaoVotacao),
    })
    .onConflictDoUpdate({
      target: [s.votacao.casa, s.votacao.idExterno],
      set: { descricao, secreta },
    });

  const [reg] = await ctx.db
    .select({ id: s.votacao.id })
    .from(s.votacao)
    .where(and(eq(s.votacao.casa, "senado"), eq(s.votacao.idExterno, idExterno)));
  const votacaoId = reg!.id;

  let n = 0;
  for (const voto of v.votos ?? []) {
    const politicoId = await upsertSenador(
      ctx,
      String(voto.codigoParlamentar),
      voto.nomeParlamentar,
      false,
      fonteVotacao(v.codigoSessaoVotacao),
    );
    const norm = normalizarVoto(voto.siglaVotoParlamentar, "senado", secreta);
    if (norm.desconhecido) {
      ctx.avisos.push(
        `voto do Senado não reconhecido "${voto.siglaVotoParlamentar}" (votação ${idExterno})`,
      );
    }
    await ctx.db
      .insert(s.voto)
      .values({
        votacaoId,
        politicoId,
        partidoId: await idPartidoSenado(ctx, voto.siglaPartidoParlamentar),
        voto: norm.voto,
        tipoVotoOriginal: voto.siglaVotoParlamentar ?? "(nulo na origem)",
        computavel: norm.computavel,
      })
      .onConflictDoUpdate({
        target: [s.voto.votacaoId, s.voto.politicoId],
        set: { voto: norm.voto, computavel: norm.computavel },
      });
    n++;
  }
  return n;
}
