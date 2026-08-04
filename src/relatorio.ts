/**
 * Relatório do banco ingerido.
 *
 * Serve para conferir o resultado da ingestão contra os números medidos no
 * reconhecimento (docs/FONTES.md). Divergência aqui é sinal de coleta parcial
 * ou de bug de normalização — não de mudança na realidade.
 *
 *   npm run relatorio
 */

import { DatabaseSync } from "node:sqlite";
import { CAMINHO_DB } from "./db/client.ts";

const db = new DatabaseSync(process.env.BUSSOLA_DB ?? CAMINHO_DB);
const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
const um = <T>(sql: string): T => db.prepare(sql).get() as T;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "0.0");

console.log("═══ ACERVO ═══\n");

const v = um<{ total: number; nominais: number; simbolicas: number }>(`
  SELECT COUNT(*) total,
         SUM(nominal) nominais,
         SUM(CASE WHEN nominal=0 THEN 1 ELSE 0 END) simbolicas
  FROM votacao`);
console.log(`votações        ${v.total} (${v.nominais} nominais, ${v.simbolicas} simbólicas)`);
console.log(`taxa nominal    ${pct(v.nominais, v.total)}%   [reconhecimento: 34,2%]`);

const c = um<{ votos: number; pol: number; comp: number }>(`
  SELECT COUNT(*) votos, COUNT(DISTINCT politico_id) pol, SUM(computavel) comp FROM voto`);
console.log(`votos           ${c.votos} de ${c.pol} parlamentares (${c.comp} computáveis)`);
console.log(`orientações     ${um<{ n: number }>("SELECT COUNT(*) n FROM orientacao").n}`);
console.log(`discursos       ${um<{ n: number }>("SELECT COUNT(*) n FROM discurso").n}`);

console.log("\n═══ PROPOSIÇÕES E TEMAS ═══\n");
{
  const p = um<{ prop: number; vinc: number; nom: number; nomVinc: number; nomTema: number; proc: number }>(`
    SELECT (SELECT COUNT(*) FROM proposicao) prop,
           (SELECT COUNT(*) FROM votacao WHERE proposicao_id IS NOT NULL) vinc,
           (SELECT COUNT(*) FROM votacao WHERE nominal=1) nom,
           (SELECT COUNT(*) FROM votacao WHERE nominal=1 AND proposicao_id IS NOT NULL) nomVinc,
           (SELECT COUNT(DISTINCT v.id) FROM votacao v
              JOIN proposicao_tema pt ON pt.proposicao_id = v.proposicao_id
             WHERE v.nominal=1) nomTema,
           (SELECT COUNT(*) FROM votacao
             WHERE objeto_votado_id IS NOT NULL AND proposicao_id IS NOT NULL
               AND objeto_votado_id <> proposicao_id) proc`);
  console.log(`proposições distintas   ${p.prop}`);
  console.log(`votações vinculadas     ${p.vinc}/${v.total} (${pct(p.vinc, v.total)}%)`);
  console.log(`  entre as nominais     ${p.nomVinc}/${p.nom} (${pct(p.nomVinc, p.nom)}%)`);
  console.log(`  nominais com tema     ${p.nomTema}/${p.nom} (${pct(p.nomTema, p.nom)}%)`);
  console.log(`votações procedimentais ${p.proc} (objeto votado ≠ matéria de fundo)`);

  const temas = all<{ nome: string; n: number }>(`
    SELECT t.nome, COUNT(DISTINCT v.id) n
    FROM votacao v
    JOIN proposicao_tema pt ON pt.proposicao_id = v.proposicao_id
    JOIN tema t ON t.id = pt.tema_id
    WHERE v.nominal = 1
    GROUP BY t.id ORDER BY n DESC LIMIT 8`);
  if (temas.length) {
    console.log(`\n  temas mais votados (votações nominais):`);
    for (const t of temas) console.log(`    ${String(t.n).padStart(3)}  ${t.nome}`);
  }
}

console.log("\n═══ DISCURSOS: CLASSIFICAÇÃO ═══\n");
{
  const linhas = all<{ c: string; rel: number; n: number; media: number }>(`
    SELECT categoria c, relevante rel, COUNT(*) n, ROUND(AVG(LENGTH(transcricao))) media
    FROM discurso GROUP BY c, rel ORDER BY n DESC`);
  for (const l of linhas) {
    console.log(
      `  ${String(l.n).padStart(4)}  ${l.c.padEnd(18)} ` +
        `${l.rel ? "exibido " : "filtrado"}  transcrição média ${l.media}`,
    );
  }
  const t = um<{ n: number }>("SELECT COUNT(*) n FROM discurso").n;
  const r = um<{ n: number }>("SELECT COUNT(*) n FROM discurso WHERE relevante=1").n;
  if (t) {
    console.log(`\n  exibidos no perfil: ${r}/${t} (${pct(r, t)}%)`);
    const zerados = um<{ n: number }>(`
      SELECT COUNT(*) n FROM (
        SELECT politico_id FROM discurso GROUP BY politico_id HAVING SUM(relevante) = 0
      )`).n;
    console.log(`  parlamentares que ficariam sem nenhum discurso: ${zerados}`);
    const versoes = all<{ v: string; n: number }>(
      `SELECT classificacao_versao v, COUNT(*) n FROM discurso GROUP BY v`,
    );
    console.log(`  versão da regra: ${versoes.map((x) => `${x.v} (${x.n})`).join(", ")}`);
  }
}

console.log("\n═══ TIPOS DE VOTO ═══\n");
for (const r of all<{ voto: string; orig: string; n: number }>(`
  SELECT voto, tipo_voto_original orig, COUNT(*) n FROM voto
  GROUP BY voto, tipo_voto_original ORDER BY n DESC`)) {
  console.log(`  ${r.n.toString().padStart(6)}  ${r.orig.padEnd(12)} → ${r.voto}`);
}

console.log("\n═══ ORIENTAÇÕES: RESOLVÍVEIS vs. BLOCO ═══\n");
for (const r of all<{ tipo: string; n: number; com_partido: number }>(`
  SELECT tipo_lideranca tipo, COUNT(*) n, SUM(partido_id IS NOT NULL) com_partido
  FROM orientacao GROUP BY tipo_lideranca`)) {
  const rotulo = r.tipo === "P" ? "partido (P)" : "bloco/agregado (B)";
  console.log(`  ${rotulo.padEnd(20)} ${r.n} registros, ${r.com_partido} com partido_id resolvido`);
}

console.log("\n═══ COLETA ═══\n");
for (const r of all<{ status: string; n: number; t: number }>(`
  SELECT status, COUNT(*) n, SUM(tentativas) t FROM coleta GROUP BY status`)) {
  console.log(`  ${r.status.padEnd(8)} ${r.n} operações, ${r.t} requisições`);
}
const retentadas = um<{ n: number }>(
  `SELECT COUNT(*) n FROM coleta WHERE tentativas > 1`,
).n;
console.log(`  operações que precisaram de retry: ${retentadas}`);

console.log("\n═══ EIXO 1 — ALINHAMENTO COM O GOVERNO ═══\n");
mostrarEixo("alinhamento_governo");

console.log("\n═══ EIXO 2 — COESÃO COM O PRÓPRIO PARTIDO ═══\n");
mostrarEixo("coesao_partidaria");

function mostrarEixo(chave: string) {
  const linhas = all<{
    nome: string;
    sigla: string;
    valor: number;
    n: number;
    opo: number;
  }>(`
    SELECT p.nome_parlamentar nome,
           COALESCE(pt.sigla,'?') sigla,
           po.valor, po.n_observacoes n, po.n_oportunidades opo
    FROM posicao po
    JOIN eixo e     ON e.id = po.eixo_id AND e.chave = '${chave}'
    JOIN politico p ON p.id = po.politico_id
    LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
    LEFT JOIN partido pt ON pt.id = f.partido_id
    ORDER BY po.valor DESC`);

  if (!linhas.length) {
    console.log("  (sem posições calculadas — rode a etapa 'posicoes')");
    return;
  }
  for (const l of linhas) {
    const barra = "█".repeat(Math.round(l.valor * 20)).padEnd(20, "·");
    console.log(
      `  ${(l.valor * 100).toFixed(1).padStart(5)}% ${barra} ` +
        `${l.nome} (${l.sigla})  n=${l.n}/${l.opo}`,
    );
  }
  const media = linhas.reduce((a, b) => a + b.valor, 0) / linhas.length;
  console.log(`\n  ${linhas.length} parlamentares · média ${(media * 100).toFixed(1)}%`);
}

console.log("\n═══ RASTREABILIDADE ═══\n");
const ev = um<{ n: number; posicoes: number }>(`
  SELECT COUNT(*) n, COUNT(DISTINCT posicao_id) posicoes FROM posicao_evidencia`);
console.log(`  ${ev.n} evidências para ${ev.posicoes} posições`);

const amostra = all<{
  nome: string;
  descricao: string;
  referencia: string;
  concordou: number;
  fonte: string;
}>(`
  SELECT p.nome_parlamentar nome, v.descricao, pe.referencia, pe.concordou, v.fonte_url fonte
  FROM posicao_evidencia pe
  JOIN posicao po ON po.id = pe.posicao_id
  JOIN eixo e     ON e.id = po.eixo_id AND e.chave = 'coesao_partidaria'
  JOIN politico p ON p.id = po.politico_id
  JOIN votacao v  ON v.id = pe.votacao_id
  WHERE pe.concordou = 0
  LIMIT 3`);
if (amostra.length) {
  console.log(`\n  exemplo — "por que este político está aqui?":`);
  for (const a of amostra) {
    console.log(`\n  ${a.nome} divergiu em:`);
    console.log(`    votação: ${a.descricao.slice(0, 70)}`);
    console.log(`    ${a.referencia}`);
    console.log(`    fonte:   ${a.fonte}`);
  }
}
db.close();
