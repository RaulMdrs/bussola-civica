/**
 * Etapas de ingestão.
 *
 * Direção obrigatória: `votações → votos → deputados` (docs/FONTES.md §1.3).
 * Não existe endpoint de votações por deputado — `/deputados/{id}/votacoes`
 * devolve 405 —, então o acervo é varrido pelo lado da votação.
 *
 * Todas as etapas são idempotentes: podem ser re-executadas sem duplicar. É
 * requisito, não conveniência — com 504 intermitente (§1.9), retomar coleta
 * interrompida é o caso normal, não a exceção.
 */

import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Banco } from "../db/client.ts";
import * as s from "../db/schema.ts";
import {
  camara,
  extrairPlacar,
  idObjetoVotado,
  ID_ORGAO_PLENARIO,
  type ProposicaoResumo,
} from "./camara.ts";
import { janelas, type OpcoesFetch } from "../lib/http.ts";
import { CLASSIFICACAO_VERSAO, classificarDiscurso } from "../lib/classificar.ts";
import {
  normalizarCpf,
  normalizarData,
  normalizarOrientacao,
  normalizarSigla,
  normalizarVoto,
} from "../lib/normalizar.ts";
import type { HistoricoItem } from "./camara.ts";

export interface Contexto {
  db: Banco;
  legislatura: number;
  uf: string;
  /** Avisos que exigem olho humano (ex.: código de voto desconhecido). */
  avisos: string[];
  log: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Auditoria de coleta (§1.9)
// ---------------------------------------------------------------------------

/**
 * Envolve uma operação de coleta e registra o resultado.
 *
 * Uma linha por operação, não por requisição HTTP: o que precisa ser auditável
 * é "este recurso foi coletado por inteiro?", para que lacuna de coleta nunca
 * seja confundida com ausência de voto.
 */
async function comAuditoria<T>(
  ctx: Contexto,
  recurso: string,
  fn: (o: OpcoesFetch) => Promise<{ dados: T; tentativas: number; url: string }>,
): Promise<T> {
  const iniciadoEm = new Date().toISOString();
  let falhas = 0;
  const opcoes: OpcoesFetch = { aoFalhar: () => falhas++ };
  try {
    const r = await fn(opcoes);
    await ctx.db.insert(s.coleta).values({
      fonte: "camara",
      recurso,
      url: r.url,
      iniciadoEm,
      concluidoEm: new Date().toISOString(),
      status: "ok",
      httpStatus: 200,
      tentativas: r.tentativas,
      registros: Array.isArray(r.dados) ? r.dados.length : 1,
    });
    if (falhas > 0) ctx.log(`    (${recurso}: ${falhas} falha(s) antes de completar)`);
    return r.dados;
  } catch (e) {
    const erro = e as Error & { status?: number };
    await ctx.db.insert(s.coleta).values({
      fonte: "camara",
      recurso,
      url: recurso,
      iniciadoEm,
      concluidoEm: new Date().toISOString(),
      status: "falha",
      httpStatus: erro.status ?? null,
      tentativas: falhas + 1,
      erro: erro.message.slice(0, 500),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cache de partidos
// ---------------------------------------------------------------------------

const cachePartidos = new Map<string, number>();

async function idPartido(db: Banco, siglaBruta: string): Promise<number> {
  const sigla = normalizarSigla(siglaBruta);
  const emCache = cachePartidos.get(sigla);
  if (emCache) return emCache;

  await db.insert(s.partido).values({ sigla }).onConflictDoNothing();
  const [row] = await db
    .select({ id: s.partido.id })
    .from(s.partido)
    .where(eq(s.partido.sigla, sigla));
  cachePartidos.set(sigla, row!.id);
  return row!.id;
}

// ---------------------------------------------------------------------------
// Etapa 1 — referências
// ---------------------------------------------------------------------------

export async function ingerirReferencias(ctx: Contexto) {
  ctx.log("referências");

  const leg = await comAuditoria(ctx, `legislaturas/${ctx.legislatura}`, (o) =>
    camara.legislatura(ctx.legislatura, o),
  );
  await ctx.db
    .insert(s.legislatura)
    .values({
      numero: leg.id,
      dataInicio: leg.dataInicio,
      dataFim: leg.dataFim,
    })
    .onConflictDoUpdate({
      target: s.legislatura.numero,
      set: { dataInicio: leg.dataInicio, dataFim: leg.dataFim },
    });
  ctx.log(`  legislatura ${leg.id}: ${leg.dataInicio} → ${leg.dataFim}`);

  const orgaos = await comAuditoria(ctx, "orgaos?sigla=PLEN", (o) =>
    camara.orgaoPorSigla("PLEN", o),
  );
  for (const o of orgaos) {
    await ctx.db
      .insert(s.orgao)
      .values({
        casa: "camara",
        idExterno: String(o.id),
        sigla: o.sigla,
        nome: o.nome,
        tipo: o.tipoOrgao,
      })
      .onConflictDoNothing();
  }

  // 32 temas oficiais — insumo dos eixos temáticos da Fase 2 (§1.7)
  const temas = await comAuditoria(ctx, "referencias/codTema", (o) => camara.temas(o));
  for (const t of temas) {
    await ctx.db
      .insert(s.tema)
      .values({ id: t.cod, nome: t.nome })
      .onConflictDoUpdate({ target: s.tema.id, set: { nome: t.nome } });
  }
  ctx.log(`  ${orgaos.length} órgão(s), ${temas.length} temas`);
}

// ---------------------------------------------------------------------------
// Etapa 2 — deputados do recorte
// ---------------------------------------------------------------------------

/**
 * Deriva intervalos de filiação a partir do histórico (§1.2).
 *
 * O histórico é uma sequência de eventos; a filiação é o intervalo entre trocas.
 * 6 dos 31 deputados do RS trocaram de legenda desde 2022, então isto não é caso
 * raro.
 */
export function derivarFiliacoes(hist: HistoricoItem[]) {
  const eventos = hist
    .filter((h) => h.siglaPartido)
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));

  const out: { sigla: string; inicio: string; fim: string | null }[] = [];
  for (const h of eventos) {
    const sigla = normalizarSigla(h.siglaPartido!);
    const ultimo = out.at(-1);
    if (!ultimo || ultimo.sigla !== sigla) {
      const data = h.dataHora.slice(0, 10);
      if (ultimo) ultimo.fim = data;
      out.push({ sigla, inicio: data, fim: null });
    }
  }
  return out;
}

/**
 * Deriva períodos de exercício efetivo (§1.8).
 *
 * É o que impede que suplente apareça como faltoso: Carlos Gomes e Sérgio Turra
 * têm 0% de participação no 1º sem/2025 porque só entraram em exercício em 2026.
 * Um mandato pode ter vários períodos (posse, licença, retorno).
 */
export function derivarExercicios(hist: HistoricoItem[], legislatura: number) {
  const eventos = hist
    .filter((h) => h.idLegislatura === legislatura && h.situacao)
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));

  const out: {
    inicio: string;
    fim: string | null;
    situacao: string;
    descricao: string | null;
  }[] = [];

  for (const h of eventos) {
    const data = h.dataHora.slice(0, 10);
    const aberto = out.at(-1);
    if (h.situacao === "Exercício") {
      if (!aberto || aberto.fim !== null) {
        out.push({
          inicio: data,
          fim: null,
          situacao: h.situacao,
          descricao: h.descricaoStatus,
        });
      }
    } else if (aberto && aberto.fim === null) {
      aberto.fim = data;
    }
  }
  return out;
}

export async function ingerirDeputados(ctx: Contexto) {
  ctx.log(`deputados ${ctx.uf}`);
  const lista = await comAuditoria(ctx, `deputados?siglaUf=${ctx.uf}`, (o) =>
    camara.deputadosPorUf(ctx.uf, o),
  );
  ctx.log(`  ${lista.length} na bancada`);

  for (const dep of lista) {
    const detalhe = await comAuditoria(ctx, `deputados/${dep.id}`, (o) =>
      camara.deputado(dep.id, o),
    );
    const fonteUrl = `https://dadosabertos.camara.leg.br/api/v2/deputados/${dep.id}`;

    const politicoId = await upsertPolitico(ctx.db, {
      idExterno: String(dep.id),
      cpf: normalizarCpf(detalhe.cpf),
      nomeCivil: detalhe.nomeCivil,
      nomeParlamentar: dep.nome,
      dataNascimento: detalhe.dataNascimento,
      dataFalecimento: detalhe.dataFalecimento,
      sexo: detalhe.sexo,
      ufNascimento: detalhe.ufNascimento,
      municipioNascimento: detalhe.municipioNascimento,
      escolaridade: detalhe.escolaridade,
      urlFoto: dep.urlFoto,
      perfilCompleto: true,
      fonteUrl,
    });

    const hist = await comAuditoria(ctx, `deputados/${dep.id}/historico`, (o) =>
      camara.historico(dep.id, o),
    );
    const histUrl = `${fonteUrl}/historico`;

    // filiações
    for (const f of derivarFiliacoes(hist)) {
      const partidoId = await idPartido(ctx.db, f.sigla);
      await ctx.db
        .insert(s.filiacao)
        .values({
          politicoId,
          partidoId,
          dataInicio: f.inicio,
          dataFim: f.fim,
          fonteUrl: histUrl,
        })
        .onConflictDoUpdate({
          target: [s.filiacao.politicoId, s.filiacao.partidoId, s.filiacao.dataInicio],
          set: { dataFim: f.fim },
        });
    }

    // mandato + exercícios
    const naLegislatura = hist.filter((h) => h.idLegislatura === ctx.legislatura);
    const condicao =
      naLegislatura.find((h) => h.condicaoEleitoral)?.condicaoEleitoral ?? "Titular";

    await ctx.db
      .insert(s.mandato)
      .values({
        politicoId,
        casa: "camara",
        legislaturaNumero: ctx.legislatura,
        uf: dep.siglaUf,
        condicaoEleitoral: condicao.toLowerCase().includes("suplente")
          ? "suplente"
          : "titular",
        fonteUrl: histUrl,
      })
      .onConflictDoNothing();

    const [mandato] = await ctx.db
      .select({ id: s.mandato.id })
      .from(s.mandato)
      .where(
        and(
          eq(s.mandato.politicoId, politicoId),
          eq(s.mandato.casa, "camara"),
          eq(s.mandato.legislaturaNumero, ctx.legislatura),
        ),
      );

    for (const ex of derivarExercicios(hist, ctx.legislatura)) {
      await ctx.db
        .insert(s.exercicio)
        .values({
          mandatoId: mandato!.id,
          dataInicio: ex.inicio,
          dataFim: ex.fim,
          situacao: ex.situacao,
          descricaoStatus: ex.descricao,
          fonteUrl: histUrl,
        })
        .onConflictDoUpdate({
          target: [s.exercicio.mandatoId, s.exercicio.dataInicio],
          set: { dataFim: ex.fim, situacao: ex.situacao },
        });
    }
  }
}

async function upsertPolitico(
  db: Banco,
  v: {
    idExterno: string;
    cpf?: string | null;
    nomeCivil?: string | null;
    nomeParlamentar: string;
    dataNascimento?: string | null;
    dataFalecimento?: string | null;
    sexo?: string | null;
    ufNascimento?: string | null;
    municipioNascimento?: string | null;
    escolaridade?: string | null;
    urlFoto?: string | null;
    perfilCompleto: boolean;
    fonteUrl: string;
  },
): Promise<number> {
  const [existente] = await db
    .select({ politicoId: s.identidadeExterna.politicoId })
    .from(s.identidadeExterna)
    .where(
      and(
        eq(s.identidadeExterna.fonte, "camara"),
        eq(s.identidadeExterna.idExterno, v.idExterno),
      ),
    );

  if (existente) {
    // não rebaixa perfil completo para mínimo em re-execução
    await db
      .update(s.politico)
      .set({
        nomeParlamentar: v.nomeParlamentar,
        ...(v.perfilCompleto
          ? {
              cpf: v.cpf ?? null,
              nomeCivil: v.nomeCivil ?? null,
              dataNascimento: v.dataNascimento ?? null,
              dataFalecimento: v.dataFalecimento ?? null,
              sexo: v.sexo ?? null,
              ufNascimento: v.ufNascimento ?? null,
              municipioNascimento: v.municipioNascimento ?? null,
              escolaridade: v.escolaridade ?? null,
              urlFoto: v.urlFoto ?? null,
              perfilCompleto: true,
            }
          : {}),
      })
      .where(eq(s.politico.id, existente.politicoId));
    return existente.politicoId;
  }

  await db.insert(s.politico).values({
    cpf: v.cpf ?? null,
    nomeCivil: v.nomeCivil ?? null,
    nomeParlamentar: v.nomeParlamentar,
    dataNascimento: v.dataNascimento ?? null,
    dataFalecimento: v.dataFalecimento ?? null,
    sexo: v.sexo ?? null,
    ufNascimento: v.ufNascimento ?? null,
    municipioNascimento: v.municipioNascimento ?? null,
    escolaridade: v.escolaridade ?? null,
    urlFoto: v.urlFoto ?? null,
    perfilCompleto: v.perfilCompleto,
    fonteUrl: v.fonteUrl,
  });
  const [novo] = await db
    .select({ id: s.politico.id })
    .from(s.politico)
    .orderBy(sql`id DESC`)
    .limit(1);

  await db
    .insert(s.identidadeExterna)
    .values({
      politicoId: novo!.id,
      fonte: "camara",
      idExterno: v.idExterno,
      fonteUrl: v.fonteUrl,
    })
    .onConflictDoNothing();

  return novo!.id;
}

// ---------------------------------------------------------------------------
// Etapa 3 — votações, votos e orientações
// ---------------------------------------------------------------------------

export async function ingerirVotacoes(
  ctx: Contexto,
  inicio: string,
  fim: string,
) {
  ctx.log(`votações do plenário ${inicio} → ${fim}`);

  const [orgao] = await ctx.db
    .select({ id: s.orgao.id })
    .from(s.orgao)
    .where(
      and(eq(s.orgao.casa, "camara"), eq(s.orgao.idExterno, ID_ORGAO_PLENARIO)),
    );

  // janela máxima de 3 meses imposta pela origem (§1.3)
  const partes = janelas(inicio, fim, 3);
  const listadas: { id: string; data: string; descricao: string; aprovacao: number | null }[] = [];

  for (const j of partes) {
    const lote = await comAuditoria(ctx, `votacoes ${j.inicio}..${j.fim}`, (o) =>
      camara.votacoes(ID_ORGAO_PLENARIO, j.inicio, j.fim, o),
    );
    listadas.push(...lote);
    ctx.log(`  ${j.inicio}..${j.fim}: ${lote.length} votações`);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  let nominais = 0;
  let simbolicas = 0;
  let puladas = 0;

  for (const v of listadas) {
    // Votação passada é imutável: se já foi coletada, não recoletar (§6).
    const [existente] = await ctx.db
      .select({ id: s.votacao.id, nominal: s.votacao.nominal })
      .from(s.votacao)
      .where(
        and(eq(s.votacao.casa, "camara"), eq(s.votacao.idExterno, v.id)),
      );
    if (existente && v.data < hoje) {
      puladas++;
      if (existente.nominal) nominais++;
      else simbolicas++;
      continue;
    }

    const votos = await comAuditoria(ctx, `votacoes/${v.id}/votos`, (o) =>
      camara.votos(v.id, o),
    );

    // A ÚNICA forma de distinguir nominal de simbólica: lista de votos vazia
    // significa simbólica (§1.4). Não há campo equivalente na origem.
    const nominal = votos.length > 0;
    nominal ? nominais++ : simbolicas++;

    const placar = extrairPlacar(v.descricao);
    const fonteUrl = `https://dadosabertos.camara.leg.br/api/v2/votacoes/${v.id}`;

    await ctx.db
      .insert(s.votacao)
      .values({
        casa: "camara",
        idExterno: v.id,
        orgaoId: orgao?.id ?? null,
        data: v.data,
        descricao: v.descricao,
        aprovacao: v.aprovacao === null ? null : Boolean(v.aprovacao),
        nominal,
        secreta: false, // votação secreta é fenômeno do Senado (§2.4)
        totalSim: placar?.sim ?? null,
        totalNao: placar?.nao ?? null,
        fonteUrl,
      })
      .onConflictDoUpdate({
        target: [s.votacao.casa, s.votacao.idExterno],
        set: { nominal, descricao: v.descricao },
      });

    const [reg] = await ctx.db
      .select({ id: s.votacao.id })
      .from(s.votacao)
      .where(and(eq(s.votacao.casa, "camara"), eq(s.votacao.idExterno, v.id)));
    const votacaoId = reg!.id;

    if (!nominal) continue;

    for (const voto of votos) {
      const d = voto.deputado_;
      // Deputados de fora do recorte entram com perfil mínimo: são necessários
      // para apurar a maioria NACIONAL do partido no eixo 2 (§1.6.1).
      const politicoId = await upsertPolitico(ctx.db, {
        idExterno: String(d.id),
        nomeParlamentar: d.nome,
        perfilCompleto: false,
        fonteUrl: `https://dadosabertos.camara.leg.br/api/v2/deputados/${d.id}`,
      });

      const n = normalizarVoto(voto.tipoVoto, "camara", false);
      if (n.desconhecido) {
        ctx.avisos.push(
          `voto não reconhecido "${voto.tipoVoto}" (votação ${v.id}, deputado ${d.nome})`,
        );
      }

      await ctx.db
        .insert(s.voto)
        .values({
          votacaoId,
          politicoId,
          partidoId: d.siglaPartido ? await idPartido(ctx.db, d.siglaPartido) : null,
          voto: n.voto,
          tipoVotoOriginal: voto.tipoVoto,
          computavel: n.computavel,
          dataRegistro: normalizarData(voto.dataRegistroVoto),
        })
        .onConflictDoUpdate({
          target: [s.voto.votacaoId, s.voto.politicoId],
          set: { voto: n.voto, computavel: n.computavel },
        });
    }

    const orientacoes = await comAuditoria(ctx, `votacoes/${v.id}/orientacoes`, (o) =>
      camara.orientacoes(v.id, o),
    );
    for (const o of orientacoes) {
      const { orientacao, liberado } = normalizarOrientacao(o.orientacaoVoto);
      // partido_id só é resolvível quando a liderança é de PARTIDO ('P').
      // Blocos vêm com sigla truncada e codPartidoBloco null (§1.6) — deixar
      // NULL é o correto: adivinhar membros seria dado não rastreável.
      const partidoId =
        o.codTipoLideranca === "P" && o.siglaPartidoBloco
          ? await idPartido(ctx.db, o.siglaPartidoBloco)
          : null;

      await ctx.db
        .insert(s.orientacao)
        .values({
          votacaoId,
          siglaBruta: o.siglaPartidoBloco,
          tipoLideranca: o.codTipoLideranca === "P" ? "P" : "B",
          partidoId,
          orientacao,
          liberado,
        })
        .onConflictDoUpdate({
          target: [s.orientacao.votacaoId, s.orientacao.siglaBruta],
          set: { orientacao, liberado },
        });
    }
  }

  ctx.log(
    `  total ${listadas.length}: ${nominais} nominais, ${simbolicas} simbólicas` +
      (puladas ? ` (${puladas} já em cache)` : ""),
  );
  return { nominais, simbolicas, total: listadas.length };
}

// ---------------------------------------------------------------------------
// Etapa 3b — proposições: vincula cada votação à matéria
// ---------------------------------------------------------------------------

/**
 * Grava a proposição (se ainda não existir) e devolve o id interno.
 *
 * `onConflictDoNothing` + select: a mesma matéria costuma reaparecer em dezenas
 * de votações (urgência, destaques, redação final), então a maioria das
 * chamadas não gera escrita.
 */
async function upsertProposicao(
  db: Banco,
  p: ProposicaoResumo,
): Promise<number> {
  const fonteUrl = `https://dadosabertos.camara.leg.br/api/v2/proposicoes/${p.id}`;
  await db
    .insert(s.proposicao)
    .values({
      casa: "camara",
      idExterno: String(p.id),
      siglaTipo: p.siglaTipo,
      numero: p.numero,
      ano: p.ano,
      ementa: p.ementa,
      dataApresentacao: normalizarData(p.dataApresentacao),
      fonteUrl,
    })
    .onConflictDoUpdate({
      target: [s.proposicao.casa, s.proposicao.idExterno],
      set: { ementa: p.ementa, siglaTipo: p.siglaTipo },
    });
  const [row] = await db
    .select({ id: s.proposicao.id })
    .from(s.proposicao)
    .where(
      and(
        eq(s.proposicao.casa, "camara"),
        eq(s.proposicao.idExterno, String(p.id)),
      ),
    );
  return row!.id;
}

/**
 * Vincula votações às proposições e coleta os temas.
 *
 * Duas ligações distintas, por precisão (ver `votacao.objetoVotadoId`):
 *   - `proposicaoId`   = matéria de fundo, de `proposicoesAfetadas`;
 *   - `objetoVotadoId` = o que foi formalmente votado, do prefixo do id.
 *
 * Quando diferem, a votação é procedimental (urgência, retirada de pauta) a
 * respeito da matéria — e afirmar que o parlamentar "votou o projeto" seria
 * impreciso.
 *
 * Só percorre votações ainda sem vínculo, então é retomável e barata em
 * re-execução.
 */
export async function ingerirProposicoes(ctx: Contexto) {
  ctx.log("proposições");

  const pendentes = await ctx.db
    .select({ id: s.votacao.id, idExterno: s.votacao.idExterno })
    .from(s.votacao)
    .where(and(eq(s.votacao.casa, "camara"), isNull(s.votacao.proposicaoId)));

  if (pendentes.length === 0) {
    ctx.log("  todas as votações já vinculadas");
    return;
  }
  ctx.log(`  ${pendentes.length} votações sem vínculo`);

  const cacheProp = new Map<number, number>();
  const temasFeitos = new Set<number>();
  let vinculadas = 0;
  let semAfetada = 0;
  let procedimentais = 0;

  for (const v of pendentes) {
    const det = await comAuditoria(ctx, `votacoes/${v.idExterno}`, (o) =>
      camara.votacao(v.idExterno, o),
    );

    const afetada = det.proposicoesAfetadas?.[0] ?? null;
    let proposicaoId: number | null = null;
    if (afetada) {
      proposicaoId = cacheProp.get(afetada.id) ?? null;
      if (!proposicaoId) {
        proposicaoId = await upsertProposicao(ctx.db, afetada);
        cacheProp.set(afetada.id, proposicaoId);
      }
    } else {
      semAfetada++;
    }

    // objeto formalmente votado: o prefixo do id da votação
    let objetoVotadoId: number | null = null;
    const idObj = idObjetoVotado(v.idExterno);
    if (idObj) {
      if (afetada && idObj === afetada.id) {
        objetoVotadoId = proposicaoId; // votação de mérito
      } else {
        objetoVotadoId = cacheProp.get(idObj) ?? null;
        if (!objetoVotadoId) {
          try {
            const p = await comAuditoria(ctx, `proposicoes/${idObj}`, (o) =>
              camara.proposicao(idObj, o),
            );
            objetoVotadoId = await upsertProposicao(ctx.db, p);
            cacheProp.set(idObj, objetoVotadoId);
          } catch {
            // objeto sem proposição resolvível — deixa NULL em vez de inventar
            ctx.avisos.push(
              `objeto votado ${idObj} não resolvido (votação ${v.idExterno})`,
            );
          }
        }
        if (objetoVotadoId && proposicaoId && objetoVotadoId !== proposicaoId) {
          procedimentais++;
        }
      }
    }

    await ctx.db
      .update(s.votacao)
      .set({ proposicaoId, objetoVotadoId })
      .where(eq(s.votacao.id, v.id));
    if (proposicaoId) vinculadas++;
  }

  // temas de cada matéria distinta — insumo dos eixos temáticos (§1.7)
  let comTema = 0;
  for (const [idExterno, propId] of cacheProp) {
    if (temasFeitos.has(idExterno)) continue;
    temasFeitos.add(idExterno);
    try {
      const temas = await comAuditoria(ctx, `proposicoes/${idExterno}/temas`, (o) =>
        camara.temasProposicao(idExterno, o),
      );
      for (const t of temas) {
        await ctx.db
          .insert(s.tema)
          .values({ id: t.codTema, nome: t.tema })
          .onConflictDoNothing();
        await ctx.db
          .insert(s.proposicaoTema)
          .values({
            proposicaoId: propId,
            temaId: t.codTema,
            relevancia: t.relevancia,
          })
          .onConflictDoNothing();
      }
      if (temas.length) comTema++;
    } catch {
      ctx.avisos.push(`temas da proposição ${idExterno} não coletados`);
    }
  }

  ctx.log(
    `  ${vinculadas} vinculadas, ${cacheProp.size} proposições resolvidas ` +
      `(matérias + objetos votados), ${comTema} com tema`,
  );
  if (procedimentais)
    ctx.log(`  ${procedimentais} votações procedimentais (objeto ≠ matéria)`);
  // Sem `proposicoesAfetadas` na origem: ficam pendentes de propósito, para que
  // uma correção futura da Câmara seja capturada numa re-execução. Custa poucas
  // requisições e evita gravar ausência como se fosse fato.
  if (semAfetada) ctx.log(`  ${semAfetada} sem proposição afetada na origem`);
}

// ---------------------------------------------------------------------------
// Etapa 4 — discursos (substituem plano de governo, §3.3/§4)
// ---------------------------------------------------------------------------

export async function ingerirDiscursos(
  ctx: Contexto,
  inicio: string,
  fim: string,
) {
  ctx.log(`discursos ${inicio} → ${fim}`);

  const alvos = await ctx.db
    .select({
      politicoId: s.politico.id,
      idExterno: s.identidadeExterna.idExterno,
      nome: s.politico.nomeParlamentar,
    })
    .from(s.politico)
    .innerJoin(
      s.identidadeExterna,
      and(
        eq(s.identidadeExterna.politicoId, s.politico.id),
        eq(s.identidadeExterna.fonte, "camara"),
      ),
    )
    .where(eq(s.politico.perfilCompleto, true));

  let total = 0;
  for (const alvo of alvos) {
    const id = Number(alvo.idExterno);
    const lote = await comAuditoria(ctx, `deputados/${id}/discursos`, (o) =>
      camara.discursos(id, inicio, fim, o),
    );
    for (const d of lote) {
      // Dedupe por conteudo: o instante NAO e unico (ver `chaveConteudo`).
      //
      // A transcricao ENTRA no hash porque os metadados sozinhos nao bastam:
      // Bibo Nunes tem duas falas em 2025-05-27T17:28 com mesmo tipo, sumario e
      // urlTexto, diferindo apenas na transcricao. Sem ela, uma se perderia.
      //
      // Custo aceito: se a Camara revisar uma transcricao ("sem revisao do
      // orador" -> versao revisada), o hash muda e a re-ingestao cria um segundo
      // registro. Preferivel a descartar em silencio a fala de um parlamentar.
      const chaveConteudo = createHash("sha256")
        .update(
          [
            d.dataHoraInicio,
            d.tipoDiscurso ?? "",
            d.sumario ?? "",
            d.urlTexto ?? "",
            d.transcricao ?? "",
          ].join(" "),
        )
        .digest("hex")
        .slice(0, 32);

      const cls = classificarDiscurso(d.tipoDiscurso, d.sumario);

      await ctx.db
        .insert(s.discurso)
        .values({
          politicoId: alvo.politicoId,
          dataHoraInicio: normalizarData(d.dataHoraInicio)!,
          tipoDiscurso: d.tipoDiscurso,
          sumario: d.sumario,
          transcricao: d.transcricao,
          urlTexto: d.urlTexto, // link para o Diário da Câmara
          urlAudio: d.urlAudio,
          urlVideo: d.urlVideo,
          chaveConteudo,
          categoria: cls.categoria,
          relevante: cls.relevante,
          classificacaoVersao: CLASSIFICACAO_VERSAO,
          fonteUrl: `https://dadosabertos.camara.leg.br/api/v2/deputados/${id}/discursos`,
        })
        .onConflictDoNothing();
    }
    total += lote.length;
  }
  const porCategoria = await ctx.db
    .select({ categoria: s.discurso.categoria, n: sql<number>`count(*)` })
    .from(s.discurso)
    .groupBy(s.discurso.categoria);
  ctx.log(`  ${total} discursos de ${alvos.length} parlamentares`);
  for (const c of porCategoria) ctx.log(`    ${c.categoria}: ${c.n}`);
}

/**
 * Reclassifica discursos já coletados, sem recoletar.
 *
 * Existe porque a regra de classificação é interpretação, e interpretação se
 * revisa. Mudou `CLASSIFICACAO_VERSAO`, roda-se esta etapa: 839 UPDATEs locais
 * em vez de 31 requisições e uma janela de instabilidade da API.
 */
export async function reclassificarDiscursos(ctx: Contexto) {
  ctx.log("reclassificando discursos");
  const linhas = await ctx.db
    .select({
      id: s.discurso.id,
      tipoDiscurso: s.discurso.tipoDiscurso,
      sumario: s.discurso.sumario,
      categoria: s.discurso.categoria,
    })
    .from(s.discurso);

  let mudou = 0;
  for (const l of linhas) {
    const cls = classificarDiscurso(l.tipoDiscurso, l.sumario);
    if (cls.categoria !== l.categoria) mudou++;
    await ctx.db
      .update(s.discurso)
      .set({
        categoria: cls.categoria,
        relevante: cls.relevante,
        classificacaoVersao: CLASSIFICACAO_VERSAO,
      })
      .where(eq(s.discurso.id, l.id));
  }
  ctx.log(`  ${linhas.length} discursos, ${mudou} mudaram de categoria (versão ${CLASSIFICACAO_VERSAO})`);
}
