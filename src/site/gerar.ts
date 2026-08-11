/**
 * Gerador do site — lê o acervo e escreve páginas em `docs/`.
 *
 *   npm run site
 *
 * Estático de propósito. Nada aqui muda entre execuções do ingestor: o acervo
 * é atualizado uma vez por semana, e toda página é derivável no momento da
 * geração. Um servidor teria de hospedar os 80 MB do banco para responder o que
 * um arquivo já responde — mais infraestrutura, mais superfície, zero ganho.
 *
 * Saída em Markdown com front matter, não HTML: o GitHub Pages já serve `docs/`
 * com tema, então as páginas herdam estilo sem CSS próprio, e o diff de cada
 * rebuild mostra o que mudou nos números — o site vira parte do registro
 * auditável, não um artefato opaco.
 *
 * Regra que atravessa o arquivo: **nenhum número sai sem seu `n` e sem link
 * para a fonte.** É a tradução do princípio do projeto para HTML.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CAMINHO_DB } from "../db/client.ts";

const SAIDA = "docs";
const db = new DatabaseSync(process.env.BUSSOLA_DB ?? CAMINHO_DB, { readOnly: true });
const todos = <T>(sql: string, ...p: unknown[]): T[] =>
  db.prepare(sql).all(...(p as never[])) as T[];
const um = <T>(sql: string, ...p: unknown[]): T =>
  db.prepare(sql).get(...(p as never[])) as T;

export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const pct = (v: number) => (v * 100).toFixed(1).replace(".", ",");

/** Barra em blocos — legível em texto puro e sem depender de CSS. */
const barra = (v: number) => "█".repeat(Math.round(v * 20)).padEnd(20, "·");

/**
 * Período apurado. O acervo pode conter mais de um recorte; o site exibe o mais
 * abrangente e **declara qual é** — número sem período é número sem sentido.
 */
const periodo = um<{ ini: string; fim: string }>(`
  SELECT periodo_inicio ini, periodo_fim fim FROM posicao
  GROUP BY periodo_inicio, periodo_fim
  ORDER BY julianday(periodo_fim) - julianday(periodo_inicio) DESC LIMIT 1`);

const metodologia = um<{ url: string; versao: string }>(
  `SELECT metodologia_url url, metodologia_versao versao FROM eixo LIMIT 1`,
);

interface Parlamentar {
  id: number;
  nome: string;
  sigla: string | null;
  condicao: string;
  exercicio: string | null;
}

const parlamentares = todos<Parlamentar>(`
  SELECT p.id, p.nome_parlamentar nome, pt.sigla,
         m.condicao_eleitoral condicao,
         (SELECT MIN(data_inicio) FROM exercicio WHERE mandato_id = m.id) exercicio
  FROM politico p
  JOIN mandato m ON m.politico_id = p.id
  LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
  LEFT JOIN partido pt ON pt.id = f.partido_id
  WHERE p.perfil_completo = 1
  ORDER BY p.nome_parlamentar`);

interface Posicao {
  eixo: string;
  rotulo: string;
  escopo: string;
  tema: string | null;
  valor: number;
  n: number;
  opo: number;
}

const posicoesDe = (politicoId: number) =>
  todos<Posicao>(
    `SELECT e.chave eixo, e.nome_exibicao rotulo, po.escopo, t.nome tema,
            po.valor, po.n_observacoes n, po.n_oportunidades opo
     FROM posicao po
     JOIN eixo e ON e.id = po.eixo_id
     LEFT JOIN tema t ON t.id = po.tema_id
     WHERE po.politico_id = ? AND po.periodo_inicio = ? AND po.periodo_fim = ?
     ORDER BY po.tema_id IS NOT NULL, e.chave, po.escopo, po.valor DESC`,
    politicoId,
    periodo.ini,
    periodo.fim,
  );

interface Evidencia {
  descricao: string;
  data: string;
  referencia: string;
  concordou: number;
  fonte: string;
}

/**
 * Amostra de evidência: divergências primeiro.
 *
 * São 2.786 evidências por parlamentar. Listar todas daria ~320 KB por página —
 * ilegível para pessoa e para buscador. A amostra existe para provar que a
 * decomposição existe e é verificável; o acervo inteiro continua no banco, e o
 * link leva à votação na origem.
 */
const evidenciasDe = (politicoId: number, eixo: string, concordou: 0 | 1, limite = 5) =>
  todos<Evidencia>(
    `SELECT v.descricao, v.data, pe.referencia, pe.concordou, v.fonte_url fonte
     FROM posicao_evidencia pe
     JOIN posicao po ON po.id = pe.posicao_id AND po.tema_id IS NULL AND po.escopo = 'merito'
     JOIN eixo e ON e.id = po.eixo_id AND e.chave = ?
     JOIN votacao v ON v.id = pe.votacao_id
     WHERE po.politico_id = ? AND pe.concordou = ?
       AND po.periodo_inicio = ? AND po.periodo_fim = ?
     ORDER BY v.data DESC LIMIT ?`,
    eixo,
    politicoId,
    concordou,
    periodo.ini,
    periodo.fim,
    limite,
  );

const frontMatter = (titulo: string, descricao: string) =>
  `---\ntitle: "${titulo.replace(/"/g, "'")}"\ndescription: "${descricao.replace(/"/g, "'")}"\n---\n\n`;

/** Repetido em toda página: o número sozinho não se defende. */
const rodape = () =>
  `\n---\n\n` +
  `Apurado sobre a legislatura 57, período **${periodo.ini} → ${periodo.fim}**.\n` +
  `Metodologia \`${metodologia.versao}\`: <${metodologia.url}>\n\n` +
  `> Nenhum eixo mede ideologia, qualidade ou desempenho. Todos derivam de voto\n` +
  `> registrado em fonte oficial, e cada valor é decomponível até a votação que\n` +
  `> o compõe. O leitor tira a conclusão.\n`;

// ---------------------------------------------------------------------------

function gerarPerfil(p: Parlamentar): string {
  const pos = posicoesDe(p.id);
  const geral = pos.filter((x) => !x.tema);
  const tematicas = pos.filter((x) => x.tema && x.eixo === "alinhamento_governo");

  let md = frontMatter(
    `${p.nome}${p.sigla ? ` (${p.sigla})` : ""}`,
    `Como ${p.nome} vota: alinhamento com o governo federal e coesão partidária, a partir de votações nominais da Câmara.`,
  );

  md += `# ${p.nome}\n\n`;
  md += `**${p.sigla ?? "sem filiação registrada"}** · deputado federal pelo RS · `;
  md += `${p.condicao}${p.exercicio ? ` · em exercício desde ${p.exercicio}` : ""}\n\n`;

  md += `## Os dois eixos\n\n`;
  md += `| Eixo | Escopo | Valor | Observações |\n|---|---|---:|---|\n`;
  for (const x of geral) {
    md += `| ${x.rotulo} | ${x.escopo} | **${pct(x.valor)}%** | ${x.n} de ${x.opo} votações |\n`;
  }
  md += `\n`;
  md += `*Observações* é em quantas votações o voto foi computável; o segundo número\n`;
  md += `é quantas ocorreram dentro do período de exercício deste parlamentar — por\n`;
  md += `isso os denominadores variam entre perfis.\n\n`;

  if (tematicas.length) {
    md += `## Alinhamento com o governo, por tema\n\n`;
    md += `Mesma metodologia, universo menor. **Não é posição sobre o tema**: a fonte\n`;
    md += `diz que a matéria trata do assunto, não se aprová-la o favorece.\n\n`;
    md += `| Tema | Alinhamento | n |\n|---|---:|---:|\n`;
    for (const t of tematicas) {
      const alerta = t.n < 20 ? ` ⚠️` : "";
      md += `| [${t.tema}](../../temas/${slug(t.tema!)}/) | ${pct(t.valor)}% | ${t.n}${alerta} |\n`;
    }
    md += `\n⚠️ = menos de 20 votações do tema. Leia o \`n\` antes da porcentagem:\n`;
    md += `100% sobre 3 votações não é 100%.\n\n`;
  }

  md += `## Por que estes números\n\n`;
  for (const [eixo, titulo] of [
    ["alinhamento_governo", "Alinhamento com o governo federal"],
    ["coesao_partidaria", "Coesão com o próprio partido"],
  ] as const) {
    const divergiu = evidenciasDe(p.id, eixo, 0, 3);
    if (!divergiu.length) continue;
    md += `### ${titulo} — amostra de divergência\n\n`;
    for (const e of divergiu) {
      md += `- **${e.data}** · ${e.descricao.slice(0, 110)}\n`;
      md += `  ${e.referencia} · [fonte oficial](${e.fonte})\n`;
    }
    md += `\n`;
  }
  md += `Esta é uma amostra. A decomposição completa existe no acervo, votação por\n`;
  md += `votação, e é reconstruível a partir das fontes oficiais.\n`;

  return md + rodape();
}

function gerarTema(tema: string, temaId: number): string {
  const linhas = todos<{ nome: string; sigla: string | null; valor: number; n: number }>(
    `SELECT p.nome_parlamentar nome, pt.sigla, po.valor, po.n_observacoes n
     FROM posicao po
     JOIN eixo e ON e.id = po.eixo_id AND e.chave = 'alinhamento_governo'
     JOIN politico p ON p.id = po.politico_id
     LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
     LEFT JOIN partido pt ON pt.id = f.partido_id
     WHERE po.tema_id = ? AND po.escopo = 'merito'
       AND po.periodo_inicio = ? AND po.periodo_fim = ?
     ORDER BY po.valor DESC`,
    temaId,
    periodo.ini,
    periodo.fim,
  );

  const votacoes = um<{ n: number }>(
    `SELECT COUNT(DISTINCT v.id) n FROM votacao v
     JOIN proposicao_tema pt ON pt.proposicao_id = v.proposicao_id
     WHERE pt.tema_id = ? AND v.nominal = 1 AND v.secreta = 0 AND v.natureza = 'merito'`,
    temaId,
  );

  let md = frontMatter(
    `${tema} — alinhamento com o governo`,
    `Como a bancada gaúcha vota em ${tema}, medido contra a orientação da liderança do Governo.`,
  );
  md += `# ${tema}\n\n`;
  md += `**${votacoes.n} votações nominais de mérito** sobre este tema no período.\n\n`;
  md += `O que a tabela mede é **alinhamento com a orientação do Governo dentro deste\n`;
  md += `tema** — não posição a favor ou contra o assunto. Essa direção não existe em\n`;
  md += `fonte oficial, e atribuí-la seria rotular por conta própria.\n\n`;

  md += `| Parlamentar | | Alinhamento | n |\n|---|---|---:|---:|\n`;
  for (const l of linhas) {
    const alerta = l.n < 20 ? ` ⚠️` : "";
    md += `| [${l.nome}](../../parlamentares/${slug(l.nome)}/) | ${l.sigla ?? "—"} `;
    md += `| \`${barra(l.valor)}\` ${pct(l.valor)}% | ${l.n}${alerta} |\n`;
  }
  const fracos = linhas.filter((l) => l.n < 20).length;
  md += `\n`;
  if (fracos) {
    md += `⚠️ **${fracos} de ${linhas.length} parlamentares têm menos de 20 votações**\n`;
    md += `neste tema. Nesses casos a porcentagem é frágil e o \`n\` é a informação\n`;
    md += `mais importante da linha.\n\n`;
  }
  return md + rodape();
}

function gerarIndiceParlamentares(): string {
  let md = frontMatter(
    "Bancada gaúcha na Câmara",
    "Os 31 deputados federais do Rio Grande do Sul: alinhamento com o governo e coesão partidária, a partir de votações nominais.",
  );
  md += `# Bancada gaúcha na Câmara\n\n`;
  md += `Os **31 deputados federais do Rio Grande do Sul** na legislatura 57.\n`;
  md += `Clique no nome para ver a decomposição de cada número.\n\n`;
  md += `| Parlamentar | Partido | Alinhamento c/ governo | Coesão partidária | n |\n`;
  md += `|---|---|---:|---:|---:|\n`;

  for (const p of parlamentares) {
    const pos = posicoesDe(p.id).filter((x) => !x.tema && x.escopo === "merito");
    const al = pos.find((x) => x.eixo === "alinhamento_governo");
    const co = pos.find((x) => x.eixo === "coesao_partidaria");
    md += `| [${p.nome}](${slug(p.nome)}/) | ${p.sigla ?? "—"} `;
    md += `| ${al ? pct(al.valor) + "%" : "—"} | ${co ? pct(co.valor) + "%" : "—"} `;
    md += `| ${al?.n ?? "—"} |\n`;
  }

  md += `\nValores do escopo de **mérito** — o principal. Cada perfil traz também o\n`;
  md += `escopo procedimental e os recortes por tema.\n\n`;
  md += `**Nenhuma destas colunas mede ideologia.** Dois parlamentares de partidos\n`;
  md += `opostos podem ter a mesma coesão partidária e votar em direções contrárias.\n`;
  return md + rodape();
}

function gerarIndiceTemas(temas: { id: number; nome: string }[]): string {
  let md = frontMatter(
    "Temas",
    "Alinhamento com o governo federal recortado pelos 12 temas com votação suficiente.",
  );
  md += `# Temas\n\n`;
  md += `Os eixos também são apurados **dentro de um tema**. Um tema vira recorte\n`;
  md += `quando tem ao menos 30 votações nominais de mérito no período — hoje são\n`;
  md += `**${temas.length}**, dos 32 da classificação oficial da Câmara.\n\n`;
  md += `| Tema | Votações | Média da bancada |\n|---|---:|---:|\n`;
  for (const t of temas) {
    const r = um<{ n: number; media: number; v: number }>(
      `SELECT COUNT(*) n, AVG(po.valor) media,
              (SELECT COUNT(DISTINCT v.id) FROM votacao v
               JOIN proposicao_tema x ON x.proposicao_id = v.proposicao_id
               WHERE x.tema_id = ? AND v.nominal=1 AND v.secreta=0 AND v.natureza='merito') v
       FROM posicao po
       JOIN eixo e ON e.id = po.eixo_id AND e.chave='alinhamento_governo'
       WHERE po.tema_id = ? AND po.escopo='merito'
         AND po.periodo_inicio = ? AND po.periodo_fim = ?`,
      t.id,
      t.id,
      periodo.ini,
      periodo.fim,
    );
    md += `| [${t.nome}](${slug(t.nome)}/) | ${r.v} | ${pct(r.media)}% |\n`;
  }
  return md + rodape();
}

// ---------------------------------------------------------------------------

function escrever(caminho: string, conteudo: string) {
  mkdirSync(join(SAIDA, caminho), { recursive: true });
  writeFileSync(join(SAIDA, caminho, "index.md"), conteudo);
}

// Regenera do zero: parlamentar que sai da bancada tem de sumir do site, e
// deixar página órfã é afirmar que ele ainda está lá.
for (const dir of ["parlamentares", "temas"]) {
  rmSync(join(SAIDA, dir), { recursive: true, force: true });
}

const temas = todos<{ id: number; nome: string }>(
  `SELECT DISTINCT t.id, t.nome FROM tema t
   JOIN posicao p ON p.tema_id = t.id
   WHERE p.periodo_inicio = ? AND p.periodo_fim = ?
   ORDER BY t.nome`,
  periodo.ini,
  periodo.fim,
);

escrever("parlamentares", gerarIndiceParlamentares());
for (const p of parlamentares) escrever(`parlamentares/${slug(p.nome)}`, gerarPerfil(p));

escrever("temas", gerarIndiceTemas(temas));
for (const t of temas) escrever(`temas/${slug(t.nome)}`, gerarTema(t.nome, t.id));

console.log(`site gerado em ${SAIDA}/`);
console.log(`  ${parlamentares.length} perfis · ${temas.length} temas · 2 índices`);
console.log(`  período ${periodo.ini} → ${periodo.fim} · metodologia ${metodologia.versao}`);

db.close();
