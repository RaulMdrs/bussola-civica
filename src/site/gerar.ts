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
 * Saída em Markdown com front matter, não HTML: o diff de cada rebuild mostra
 * o que mudou nos números — o site vira parte do registro auditável, não um
 * artefato opaco. O Jekyll converte, e `docs/_layouts/default.html` mais
 * `docs/assets/bussola.css` dão a forma.
 *
 * As células de tabela carregam HTML inline (`<span class="valor">`, `.n`,
 * `.aviso-n`) e cada tabela declara sua classe pelo IAL do kramdown
 * (`{: .t-indice}`) — é o que permite ao CSS transformar tabela em blocos no
 * celular sem esconder coluna nenhuma.
 *
 * Regra que atravessa o arquivo: **nenhum número sai sem seu `n` e sem link
 * para a fonte.** É a tradução do princípio do projeto para HTML.
 */

import {
  mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
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

/**
 * Escape de HTML. Obrigatório: 73 votações trazem `<`, `>` ou `&` na descrição
 * vinda da fonte, e a descrição é reproduzida sem edição — é o que torna o
 * dado conferível. Sem escape, o texto oficial vira marcação.
 */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (v: number) => (v * 100).toFixed(1).replace(".", ",");

/**
 * Colapsa espaço em branco. Obrigatório para texto de fonte dentro de célula
 * de tabela: **17 descrições de votação trazem quebra de linha da origem**, e
 * em Markdown a quebra encerra a linha da tabela — a célula seguinte virava
 * uma linha órfã, sem referência, sem voto e sem fonte. Eram 425 evidências
 * assim antes de isto existir.
 *
 * Trocar quebra por espaço é o mínimo para o texto caber numa célula, e não
 * altera uma palavra do que a origem publicou.
 */
const umaLinha = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * O `n` é conteúdo, não metadado: sai rotulado e em corpo legível.
 *
 * Reservado para **a base de um percentual** — em quantas observações aquele
 * número foi apurado. Contagem que não sustenta percentual nenhum sai como
 * número simples, por `contagem()`: rotular tudo de `n` gastaria o símbolo
 * justamente onde ele precisa parar o leitor.
 */
const enne = (n: number) => `<span class="n">n&nbsp;=&nbsp;<b>${n}</b></span>`;

/** Contagem sem percentual atrás. Mesmo corpo e mesma fonte, sem o rótulo. */
const contagem = (n: number) => `<span class="n"><b>${n}</b></span>`;

/**
 * Etiqueta de amostra pequena. Substitui o `⚠️` solto, que o CSS não alcança:
 * emoji não recebe borda, fundo nem caixa alta, então o aviso ficava mais
 * fraco que o número que ele contesta — exatamente ao contrário do necessário.
 */
const FRAGIL = 20;
const avisoN = (n: number) =>
  n < FRAGIL ? ` <span class="aviso-n">amostra pequena</span>` : "";

/** Barra de proporção. Um tom só: é proporção, não nota. */
const barra = (v: number, n: number) =>
  `<span class="barra"${n < FRAGIL ? ` data-fragil` : ""}>` +
  `<i style="width:${(v * 100).toFixed(1)}%"></i></span>`;

/** Link de fonte: sempre rotulado, nunca só ícone, alvo de toque de 44px. */
const fonte = (url: string) =>
  `<a class="fonte" href="${esc(url)}">Ver votação na fonte oficial</a>`;

const ESCOPO_ROTULO: Record<string, string> = {
  merito: "Mérito",
  procedimental: "Procedimental",
  unico: "Todas as votações abertas",
};

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

const legislatura = um<{ n: number }>(
  `SELECT legislatura_numero n FROM posicao GROUP BY legislatura_numero
   ORDER BY COUNT(*) DESC LIMIT 1`,
).n;

/**
 * Números do acervo que aparecem em prosa.
 *
 * Ficavam digitados no texto — na home e no aviso do Senado. Número digitado
 * não desvia no dia em que é escrito; desvia depois, calado, e aí a página
 * afirma um acervo que não é o que está no banco. Estes saem daqui.
 *
 * O eixo do Senado não é nominal × simbólica, é aberta × secreta: em votação
 * secreta a origem confirma que o senador votou, não como.
 */
const acervo = um<{
  nominaisCamara: number;
  totalSenado: number;
  secretasSenado: number;
}>(`
  SELECT (SELECT SUM(nominal) FROM votacao WHERE casa='camara')  nominaisCamara,
         (SELECT COUNT(*)     FROM votacao WHERE casa='senado')  totalSenado,
         (SELECT SUM(secreta) FROM votacao WHERE casa='senado')  secretasSenado`);

/**
 * Base pública do site, derivada do acervo — não digitada.
 *
 * `eixo.metodologia_url` já guarda a URL absoluta da metodologia, gravada pelo
 * cálculo das posições. A base do site é ela sem o último trecho. Assim o
 * `sitemap.xml`, o `robots.txt` e as etiquetas de compartilhamento saem do
 * mesmo lugar de onde sai o rodapé — e trocar de domínio continua sendo uma
 * mudança só, como o CHECKPOINT registra nas dívidas.
 */
const BASE_SITE = metodologia.url.replace(/metodologia\/?$/, "").replace(/\/$/, "");

const abertasSenado = acervo.totalSenado - acervo.secretasSenado;
const sigiloSenado = Math.round((acervo.secretasSenado / acervo.totalSenado) * 100);
const milhar = (n: number) => n.toLocaleString("pt-BR");

interface Parlamentar {
  id: number;
  nome: string;
  sigla: string | null;
  condicao: string;
  exercicio: string | null;
}

const daCasa = (casa: "camara" | "senado") =>
  todos<Parlamentar>(
    `SELECT p.id, p.nome_parlamentar nome, pt.sigla,
            m.condicao_eleitoral condicao,
            (SELECT MIN(data_inicio) FROM exercicio WHERE mandato_id = m.id) exercicio
     FROM politico p
     JOIN mandato m ON m.politico_id = p.id AND m.casa = ?
     LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
     LEFT JOIN partido pt ON pt.id = f.partido_id
     WHERE p.perfil_completo = 1
     ORDER BY p.nome_parlamentar`,
    casa,
  );

const parlamentares = daCasa("camara");
const senadores = daCasa("senado");

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
  voto: string;
  fonte: string;
}

/**
 * Amostra de evidência: divergências primeiro.
 *
 * São 2.786 evidências por parlamentar. Listar todas daria ~320 KB por página —
 * ilegível para pessoa e para buscador. A amostra existe para provar que a
 * decomposição existe e é verificável; o acervo inteiro continua no banco, e o
 * link leva à votação na origem.
 *
 * O voto individual vem de `voto`, por `posicao_evidencia.voto_id`. Não se
 * deduz de `concordou = 0`: o vocabulário tem `abstencao`, `obstrucao`,
 * `ausente` e `presidente`, e divergir não implica ter votado o contrário.
 * Hoje as divergências são todas `sim`/`nao` — ler mesmo assim é a diferença
 * entre exibir dado e inferi-lo.
 */
const evidenciasDe = (
  politicoId: number,
  eixo: string,
  concordou: 0 | 1,
  limite = 5,
  escopo = "merito",
) =>
  todos<Evidencia>(
    `SELECT v.descricao, v.data, pe.referencia, vo.voto, v.fonte_url fonte
     FROM posicao_evidencia pe
     JOIN posicao po ON po.id = pe.posicao_id AND po.tema_id IS NULL AND po.escopo = ?
     JOIN eixo e ON e.id = po.eixo_id AND e.chave = ?
     JOIN votacao v ON v.id = pe.votacao_id
     JOIN voto vo ON vo.id = pe.voto_id
     WHERE po.politico_id = ? AND pe.concordou = ?
       AND po.periodo_inicio = ? AND po.periodo_fim = ?
     ORDER BY v.data DESC LIMIT ?`,
    escopo,
    eixo,
    politicoId,
    concordou,
    periodo.ini,
    periodo.fim,
    limite,
  );

// ---------------------------------------------------------------------------
// Discursos
//
// Entraram no MVP como substituto do plano de governo, que não existe para
// deputado federal — a interseção medida foi zero. São a única coisa no acervo
// em que o parlamentar fala por si, em vez de ser medido contra uma régua.
//
// **A transcrição não vem para o site.** São 11 MB, que entrariam no git e
// seriam reescritos a cada rebuild semanal, para reproduzir um texto que já
// está publicado no Diário — e o `url_texto` leva exatamente até lá. O que o
// site exibe é o sumário oficial, que é o que permite varrer 981 discursos e
// achar o que interessa.
//
// **Uma página por ano**, e não uma por parlamentar: o mais falante tem 981
// discursos e 451 KB só de sumário. Ano é divisão que a fonte já traz — não é
// recorte editorial, e ninguém precisa decidir o que fica de fora.

interface Discurso {
  id: number;
  data: string;
  tipo: string | null;
  sumario: string | null;
  urlTexto: string | null;
  fonte: string;
  relevante: number;
  categoria: string;
}

const COLUNAS_DISCURSO = `d.id, d.data_hora_inicio data, d.tipo_discurso tipo,
  d.sumario, d.url_texto urlTexto, d.fonte_url fonte, d.relevante, d.categoria`;

/** Anos em que o parlamentar discursou, do mais recente para o mais antigo. */
const anosDeDiscurso = (politicoId: number) =>
  todos<{ ano: string; n: number; substantivos: number }>(
    `SELECT substr(data_hora_inicio, 1, 4) ano, COUNT(*) n, SUM(relevante) substantivos
     FROM discurso WHERE politico_id = ?
     GROUP BY ano ORDER BY ano DESC`,
    politicoId,
  );

const discursosDoAno = (politicoId: number, ano: string, relevante: 0 | 1) =>
  todos<Discurso>(
    `SELECT ${COLUNAS_DISCURSO} FROM discurso d
     WHERE d.politico_id = ? AND substr(d.data_hora_inicio, 1, 4) = ?
       AND d.relevante = ?
     ORDER BY d.data_hora_inicio DESC`,
    politicoId,
    ano,
    relevante,
  );

/** O parlamentar é do Senado? Decide rótulo e prosa, nunca conteúdo. */
const daCasaSenado = (p: Parlamentar) => senadores.some((x) => x.id === p.id);

const NOME_CATEGORIA: Record<string, string> = {
  orientacao_voto: "orientação de bancada",
  registro_presenca: "registro de presença",
};

/** As categorias não substantivas que este parlamentar de fato tem, por extenso. */
function listaDeCategorias(politicoId: number): string {
  const cats = todos<{ c: string }>(
    `SELECT DISTINCT categoria c FROM discurso
     WHERE politico_id = ? AND relevante = 0 ORDER BY categoria`,
    politicoId,
  ).map((r) => NOME_CATEGORIA[r.c] ?? r.c);
  if (cats.length <= 1) return cats[0] ?? "de outra natureza";
  return cats.slice(0, -1).join(", ") + " e " + cats[cats.length - 1];
}

/** Qual regra classificou os discursos deste parlamentar. Gravada por discurso. */
const classificacaoDe = (politicoId: number) =>
  um<{ v: string | null }>(
    `SELECT classificacao_versao v FROM discurso WHERE politico_id = ? LIMIT 1`,
    politicoId,
  )?.v ?? null;

const ultimosDiscursos = (politicoId: number, limite: number) =>
  todos<Discurso>(
    `SELECT ${COLUNAS_DISCURSO} FROM discurso d
     WHERE d.politico_id = ? AND d.relevante = 1
     ORDER BY d.data_hora_inicio DESC LIMIT ?`,
    politicoId,
    limite,
  );

/** `2023-02-28T15:12` → `2023-02-28 · 15:12`. Sem reformatar a data. */
const dataHora = (s: string) => s.replace("T", " · ");

/**
 * O `url_texto` da coleção `J` não abre.
 *
 * Medido contra a origem: **20 de 20** links com `selCodColecaoCsv=J` devolvem
 * "Documento não encontrado no Banco de Dados"; numa amostra de 30 do acervo
 * geral (98% coleção `D`), nenhum falhou. São 101 dos 5.549 discursos que têm
 * `url_texto`.
 *
 * O defeito é da origem, e não cabe a nós consertar o link dela — cabe não
 * repassar como "texto integral no Diário" um endereço que sabidamente entrega
 * página de erro. Esses caem no mesmo tratamento dos 302 sem `url_texto`.
 */
const diarioAusente = (url: string) => url.includes("selCodColecaoCsv=J");

/**
 * Link do discurso. Preferência pelo Diário, que traz o texto integral; onde
 * ele não existe ou não abre, o endpoint que entregou o discurso é a fonte. Os
 * rótulos são diferentes porque os destinos são diferentes — mandar o leitor
 * para JSON dizendo "Diário" seria mentira pequena, mas mentira.
 */
function fonteDoDiscurso(d: Discurso): string {
  const url = d.urlTexto && !diarioAusente(d.urlTexto) ? d.urlTexto : d.fonte;
  return `<a class="fonte" href="${esc(url)}">${rotuloDaFonte(url)}</a>`;
}

/**
 * O rótulo sai do **destino**, não de uma suposição sobre a casa do
 * parlamentar. É a mesma regra de antes — não dizer "Diário" mandando para
 * JSON — estendida a uma segunda origem: o Senado publica o pronunciamento em
 * página própria, não em Diário, e chamá-la de Diário da Câmara seria a mesma
 * mentira pequena com outro nome.
 */
function rotuloDaFonte(url: string): string {
  const doSenado = url.includes("senado.leg.br") || url.includes("senado.gov.br");
  const daApi = url.includes("dadosabertos");
  if (doSenado) return daApi ? "Ver na API do Senado" : "Ver o pronunciamento no Senado";
  return daApi ? "Ver na API da Câmara" : "Ver no Diário da Câmara";
}

function blocoDiscurso(d: Discurso): string {
  return (
    `<blockquote class="evidencia discurso" id="d-${d.id}">\n` +
    `<span class="data">${esc(dataHora(d.data))}</span>\n` +
    `<div class="corpo">\n` +
    (d.tipo ? `<p class="tipo">${esc(d.tipo)}</p>\n` : "") +
    (d.sumario
      ? `<p>${esc(d.sumario)}</p>\n`
      : `<p class="sem-sumario">A fonte não publicou sumário para este discurso. ` +
        `O texto está no link abaixo.</p>\n`) +
    fonteDoDiscurso(d) +
    `\n</div>\n</blockquote>\n\n`
  );
}

/**
 * A descrição da fonte costuma terminar no placar ("... Sim: 182; Não: 182;").
 * Separar os dois deixa o texto escaneável sem alterar uma vírgula do que a
 * origem publicou — a pontuação original fica como está, inclusive.
 */
function partirDescricao(d: string): { texto: string; placar: string } {
  const i = d.search(/\bSim:/);
  return i < 0
    ? { texto: d.trim(), placar: "" }
    : { texto: d.slice(0, i).trim(), placar: d.slice(i).trim() };
}

function blocoEvidencia(e: Evidencia): string {
  const { texto, placar } = partirDescricao(e.descricao);
  return (
    `<blockquote class="evidencia">\n` +
    `<span class="data">${esc(e.data)}</span>\n` +
    `<div class="corpo">\n` +
    `<p>${esc(texto)}` +
    (placar ? ` <span class="placar">${esc(placar)}</span>` : "") +
    `</p>\n` +
    `<p class="referencia">${esc(e.referencia)} — voto registrado: <b>${esc(e.voto)}</b>.</p>\n` +
    fonte(e.fonte) +
    `\n</div>\n</blockquote>\n\n`
  );
}

const frontMatter = (titulo: string, descricao: string, kind: string) =>
  `---\nlayout: default\nkind: ${kind}\n` +
  `title: "${titulo.replace(/"/g, "'")}"\n` +
  `description: "${descricao.replace(/"/g, "'")}"\n---\n\n`;

// ---------------------------------------------------------------------------

function gerarPerfil(p: Parlamentar): string {
  const pos = posicoesDe(p.id);
  const geral = pos.filter((x) => !x.tema);
  const tematicas = pos.filter((x) => x.tema && x.eixo === "alinhamento_governo");

  let md = frontMatter(
    `${p.nome}${p.sigla ? ` (${p.sigla})` : ""}`,
    `Como ${p.nome} vota: alinhamento com o governo federal e coesão partidária, a partir de votações nominais da Câmara.`,
    "perfil",
  );

  md += `# ${p.nome}\n\n`;
  md += `<p class="subtitulo"><b>${esc(p.sigla ?? "sem filiação registrada")}</b> · `;
  md += `deputado federal pelo RS · ${esc(p.condicao)}`;
  md += p.exercicio ? ` · em exercício desde <b>${esc(p.exercicio)}</b>` : "";
  md += `</p>\n\n`;

  md += `## Os dois eixos\n\n`;
  md += `Duas medidas, apuradas em separado para o **mérito** das matérias e para\n`;
  md += `votações **procedimentais** — votar a urgência de um projeto não é votar o\n`;
  md += `projeto. Os denominadores mudam de parlamentar para parlamentar: dependem de\n`;
  md += `quantas votações ocorreram no período de exercício de cada um.\n\n`;

  md += `| Eixo | Escopo | Valor | Base de cálculo |\n|---|---|---:|---|\n`;
  for (const x of geral) {
    const classe = x.eixo === "alinhamento_governo" ? "eixo-gov" : "eixo-par";
    md += `| <span class="${classe}">${esc(x.rotulo)}</span> `;
    md += `| <span class="escopo">${ESCOPO_ROTULO[x.escopo] ?? x.escopo}</span> `;
    md += `| [<span class="valor">${pct(x.valor)}%</span>](evidencia/${slugEvidencia(x.eixo, x.escopo)}/) `;
    md += `| <span class="n-detalhe">${x.n} <span>votações computáveis</span></span>`;
    md += `<span class="n-detalhe">${x.opo} <span>votações no exercício</span></span> |\n`;
  }
  md += `{: .t-eixos}\n\n`;

  md += `**Cada percentual acima é um link** para a sua decomposição completa —\n`;
  md += `todas as votações que entraram na conta, uma por linha, com o voto\n`;
  md += `registrado e o link para a fonte. Nenhum número deste site fica sem isso.\n\n`;

  md += `> **Coesão alta não é virtude, coesão baixa não é defeito.** Dois\n`;
  md += `> parlamentares de partidos opostos, votando em direções contrárias, podem\n`;
  md += `> ambos ter 100% de coesão. O eixo mede quanto o voto coincidiu com a\n`;
  md += `> maioria dos próprios pares — nada além disso.\n\n`;

  if (tematicas.length) {
    md += `## Alinhamento com o governo, por tema\n\n`;
    md += `> Isto **não é posição sobre o tema**. A classificação vem da fonte oficial\n`;
    md += `> e diz apenas que a matéria trata daquele assunto — não se aprová-la\n`;
    md += `> favorece ou contraria o assunto. Leia o percentual junto do \`n\`: em temas\n`;
    md += `> com poucas votações, uma única sessão move o número dezenas de pontos.\n\n`;

    md += `| Tema | Alinhamento | Votações (n) |\n|---|---:|---:|\n`;
    for (const t of tematicas) {
      md += `| [${t.tema}](../../temas/${slug(t.tema!)}/) `;
      md += `| <span class="valor">${pct(t.valor)}%</span> `;
      md += `| ${enne(t.n)}${avisoN(t.n)} |\n`;
    }
    md += `{: .t-temas}\n\n`;
    md += `<span class="aviso-n">amostra pequena</span> marca temas com menos de\n`;
    md += `${FRAGIL} votações. Nesses casos a porcentagem é frágil e o \`n\` é a\n`;
    md += `informação mais importante da linha.\n\n`;
  }

  md += `## Por que estes números\n\n`;
  md += `Uma amostra das votações em que o voto de ${p.nome} **divergiu** da\n`;
  md += `referência de cada eixo. As descrições são o texto original da fonte\n`;
  md += `oficial, reproduzido sem edição — é o que torna o dado conferível.\n\n`;

  for (const [eixo, titulo, classe] of [
    ["alinhamento_governo", "Divergências da orientação do Governo", "eixo-gov"],
    ["coesao_partidaria", "Divergências da maioria do próprio partido", "eixo-par"],
  ] as const) {
    const divergiu = evidenciasDe(p.id, eixo, 0, 3);
    if (!divergiu.length) continue;
    md += `### <span class="${classe}">${titulo}</span>\n\n`;
    for (const e of divergiu) md += blocoEvidencia(e);
  }
  md += `### A conta inteira\n\n`;
  md += `Acima é amostra, e diz que é. A decomposição completa — **todas** as\n`;
  md += `votações que entraram em cada número, coincidências inclusive — está em\n`;
  md += `uma página por eixo e escopo:\n\n`;
  for (const x of geral) {
    md += `- [${ROTULO_EIXO[x.eixo] ?? x.rotulo}, `;
    md += `${(ESCOPO_ROTULO[x.escopo] ?? x.escopo).toLowerCase()}`;
    md += `](evidencia/${slugEvidencia(x.eixo, x.escopo)}/) — ${x.n} votações\n`;
  }
  md += `\n`;

  md += secaoDiscursos(p);

  return md;
}

/**
 * Seção de discursos do perfil.
 *
 * Os eixos medem o parlamentar contra uma régua externa — a orientação do
 * Governo, a maioria do partido. O discurso é a única coisa aqui em que ele
 * fala por si. Por isso a seção existe, e por isso ela não interpreta nada:
 * lista o que a fonte publicou, em ordem, com link.
 */
function secaoDiscursos(p: Parlamentar): string {
  const anos = anosDeDiscurso(p.id);
  let md = `## O que disse em plenário\n\n`;

  if (!anos.length) {
    md += `> **Nenhum discurso deste parlamentar consta no acervo** para o período.\n`;
    md += `> A ausência é do que a origem devolveu para o identificador dele, não\n`;
    md += `> uma escolha desta página.\n\n`;
    return md;
  }

  const total = anos.reduce((s, a) => s + a.n, 0);
  const substantivos = anos.reduce((s, a) => s + a.substantivos, 0);

  const um = total === 1;
  md += `${um ? "É" : "São"} **${total} ${um ? "discurso" : "discursos"}** `;
  md += `coletado${um ? "" : "s"} no período, `;
  if (total === substantivos) {
    // Repetir o número quando todos são substantivos não informa nada.
    md += `${um ? "e ele é substantivo" : "todos substantivos"}`;
  } else {
    md += `dos quais **${substantivos} `;
    md += `${substantivos === 1 ? "substantivo" : "substantivos"}**`;
  }
  if (total > substantivos) {
    // Nomear só as categorias que este parlamentar realmente tem. A Câmara
    // produz registro de presença; o Senado, não — dizer "e registro de
    // presença" num perfil sem nenhum seria descrever outra fonte.
    md += ` — os outros ${total - substantivos} são\n`;
    md += `${listaDeCategorias(p.id)}, que a classificação separa do perfil e\n`;
    md += `**não descarta**: estão nas páginas por ano, na íntegra`;
  }
  md += `.\n\n`;

  if (classificacaoDe(p.id) === "oficial:TipoUsoPalavra") {
    md += `> No Senado, quem separa é a **própria fonte**: cada pronunciamento vem\n`;
    md += `> com o tipo de uso da palavra publicado pela Casa, e é dele que sai a\n`;
    md += `> classificação — não de uma regra nossa. A regra da Câmara foi calibrada\n`;
    md += `> contra texto da Câmara, e aplicá-la aqui repetiria o erro que este\n`;
    md += `> projeto recusou no recorte entre mérito e procedimental.\n\n`;
  }

  md += `O que aparece abaixo é o sumário publicado pel${daCasaSenado(p) ? "o Senado" : "a Câmara"}.\n`;
  md += `O texto integral não é reproduzido aqui — o link de cada discurso leva à\n`;
  md += `fonte que o publicou.\n\n`;

  const ultimos = ultimosDiscursos(p.id, 5);
  if (ultimos.length) {
    md += `### Os ${ultimos.length} mais recentes\n\n`;
    for (const d of ultimos) md += blocoDiscurso(d);
  }

  md += `### Todos, por ano\n\n`;
  md += `| Ano | Discursos | Substantivos |\n|---|---:|---:|\n`;
  for (const a of anos) {
    md += `| [${a.ano}](discursos/${a.ano}/) | ${contagem(a.n)} `;
    md += `| ${a.substantivos} |\n`;
  }
  md += `{: .t-anos}\n\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Busca nos discursos
//
// **Aqui o site passa a ter JavaScript pela primeira vez.** Não havia caminho
// sem: procurar uma palavra em 5.851 sumários exige o texto do lado do leitor,
// e não há servidor. Uma página por termo daria dezenas de milhares de páginas
// com o mesmo texto repetido; uma página única com tudo daria 2,8 MB.
//
// Três condições foram impostas à decisão:
//
//  1. **script escrito à mão, sem dependência** — a folha de estilo já é assim,
//     e uma biblioteca de busca traria mais bytes que o próprio acervo;
//  2. **nada essencial depende dele** — sem JavaScript a página continua
//     listando todos os parlamentares e seus anos, que é a navegação que
//     existia antes desta busca. Ela acrescenta, não substitui;
//  3. **o custo é declarado na página**, porque ~700 KB não é grátis no celular
//     e o leitor merece saber antes de pagar.
//
// A busca **não classifica nada**: casa a palavra que o parlamentar disse,
// contra o sumário que a Câmara publicou. É o oposto de rotular — é devolver o
// texto da fonte para quem perguntou.

interface LinhaBusca {
  id: number;
  politicoId: number;
  data: string;
  tipo: string | null;
  sumario: string;
  relevante: number;
}

/**
 * Um arquivo por ano, buscado sob demanda.
 *
 * Medido, comprimido: 2023 · 167 KB · 2024 · 181 KB · 2025 · 267 KB ·
 * 2026 · 91 KB. Num arquivo só seriam 701 KB de uma vez. Fatiado, o resultado
 * do primeiro ano aparece enquanto os outros ainda chegam, e ano é a mesma
 * divisão que as páginas de discurso já usam.
 *
 * Formato colunar, não lista de objetos: as chaves não se repetem 1.900 vezes.
 * Rende 46 KB sobre o JSON de objetos, medido — pouco, mas de graça.
 */
function escreverFragmentosDeBusca(): {
  anos: string[];
  bytes: number;
  comprimido: number;
} {
  const anos = todos<{ ano: string }>(
    `SELECT DISTINCT substr(data_hora_inicio, 1, 4) ano FROM discurso ORDER BY ano`,
  ).map((r) => r.ano);

  mkdirSync(join(SAIDA, "busca"), { recursive: true });
  let bytes = 0;
  // O custo que a página declara é o que o leitor realmente paga: o GitHub
  // Pages serve estes arquivos com gzip. Medir é uma linha; estimar erraria.
  let comprimido = 0;

  for (const ano of anos) {
    const linhas = todos<LinhaBusca>(
      `SELECT d.id, d.politico_id politicoId, d.data_hora_inicio data,
              d.tipo_discurso tipo, d.sumario, d.relevante
       FROM discurso d
       WHERE substr(d.data_hora_inicio, 1, 4) = ?
         AND d.sumario IS NOT NULL AND d.sumario <> ''
       ORDER BY d.data_hora_inicio DESC`,
      ano,
    );
    // O sumário dobrado (sem acento, minúsculo) **não** é enviado: dobrar no
    // cliente uma vez, ao carregar, custa milissegundos; enviá-lo pronto
    // dobrava o payload — 5,7 MB contra 2,9 MB, medido.
    const corpo = JSON.stringify({
      id: linhas.map((l) => l.id),
      p: linhas.map((l) => l.politicoId),
      d: linhas.map((l) => l.data.slice(0, 10)),
      t: linhas.map((l) => l.tipo ?? ""),
      r: linhas.map((l) => l.relevante),
      s: linhas.map((l) => l.sumario),
    });
    writeFileSync(join(SAIDA, "busca", `${ano}.json`), corpo);
    bytes += Buffer.byteLength(corpo);
    comprimido += gzipSync(corpo).length;
  }
  return { anos, bytes, comprimido };
}

function gerarBusca(busca: { anos: string[]; bytes: number; comprimido: number }): string {
  const anos = busca.anos;
  const totalDiscursos = um<{ n: number }>(`SELECT COUNT(*) n FROM discurso`).n;

  // O custo declarado ao leitor, arredondado **para cima**.
  //
  // `gzipSync` aqui usa o nível padrão do zlib; o GitHub Pages comprime com
  // outro, e serve 3,7% a mais — medido contra o site publicado: 747 KB
  // servidos contra 720 KB medidos aqui. O nível do CDN não é nosso para
  // controlar e pode mudar.
  //
  // Então: margem de 5% e arredondamento para cima, na dezena. Subestimar o
  // que o leitor vai baixar é o lado errado de errar, e "cerca de" é o que a
  // página diz — precisão que não temos não se finge.
  const kb = Math.ceil((busca.comprimido * 1.05) / 1024 / 10) * 10;
  let md = frontMatter(
    "Buscar nos discursos",
    "Procure uma palavra nos discursos dos deputados federais e senadores gaúchos, pelo sumário publicado pela casa.",
    "busca",
  );

  const comDiscurso = [...parlamentares, ...senadores].filter(
    (x) => anosDeDiscurso(x.id).length > 0,
  );

  md += `# Buscar nos discursos\n\n`;
  md += `<p class="subtitulo">Procura a palavra no <b>sumário publicado pela\n`;
  md += `casa</b> — o texto da fonte, não uma classificação nossa. São\n`;
  md += `<b>${milhar(totalDiscursos)} discursos</b> de ${parlamentares.length} `;
  md += `deputados e ${senadores.length} senadores.</p>\n\n`;

  // Metadados pequenos vão inline: 34 nomes e slugs. Evita uma requisição a
  // mais antes da primeira tecla. A quarta posição é a seção — deputado e
  // senador moram em diretórios diferentes, e o resultado precisa saber qual.
  const meta = {
    p: Object.fromEntries(
      [...parlamentares.map((x) => [x, "parlamentares"] as const),
       ...senadores.map((x) => [x, "senadores"] as const)].map(([x, secao]) => [
        x.id,
        [x.nome, slug(x.nome), x.sigla ?? "", secao],
      ]),
    ),
    anos,
    kb, // o script declara o custo ao leitor; medido, não estimado
  };
  md += `<form class="busca" id="busca" role="search">\n`;
  md += `<label for="q">Palavra ou expressão</label>\n`;
  md += `<input type="search" id="q" name="q" autocomplete="off" `;
  md += `placeholder="enchente, arroz, segurança pública…">\n`;
  md += `<div class="busca-filtros">\n`;
  md += `<label><input type="checkbox" id="protocolares"> incluir os classificados como protocolares</label>\n`;
  md += `</div>\n`;
  md += `<p class="busca-estado" id="estado" aria-live="polite">O índice pesa\n`;
  md += `cerca de <b>${kb} KB</b> comprimido e só é baixado quando você busca a\n`;
  md += `primeira vez.</p>\n`;
  md += `</form>\n\n`;
  md += `<div id="resultados"></div>\n\n`;

  md += `<noscript>\n`;
  md += `<div class="interrompe">\n`;
  md += `<h4>A busca precisa de JavaScript — o resto do site não</h4>\n`;
  md += `<p>Procurar uma palavra em ${milhar(totalDiscursos)} sumários exige o\n`;
  md += `texto do lado do\n`;
  md += `leitor, e este site não tem servidor. Sem JavaScript, a navegação\n`;
  md += `abaixo continua inteira: cada parlamentar das duas casas, cada ano,\n`;
  md += `todos os\n`;
  md += `discursos, com link para a fonte.</p>\n`;
  md += `</div>\n`;
  md += `</noscript>\n\n`;

  md += `## Todos os parlamentares, por ano\n\n`;
  md += `Esta lista não depende de script, e é a mesma navegação que existia\n`;
  md += `antes da busca.\n\n`;
  md += `| Parlamentar | Casa | Discursos | Anos |\n|---|---|---:|---|\n`;
  for (const [pessoa, secao, casa] of [
    ...parlamentares.map((x) => [x, "parlamentares", "Câmara"] as const),
    ...senadores.map((x) => [x, "senadores", "Senado"] as const),
  ]) {
    const anosDele = anosDeDiscurso(pessoa.id);
    const total = anosDele.reduce((n, a) => n + a.n, 0);
    md += `| [${pessoa.nome}](../${secao}/${slug(pessoa.nome)}/) `;
    md += `| <span class="escopo">${casa}</span> | ${contagem(total)} | `;
    md += anosDele.length
      ? anosDele
          .map((a) => `[${a.ano}](../${secao}/${slug(pessoa.nome)}/discursos/${a.ano}/)`)
          .join(" · ")
      : "—";
    md += ` |\n`;
  }
  md += `{: .t-busca}\n\n`;

  md += `<script id="busca-meta" type="application/json">${JSON.stringify(meta)}</script>\n`;
  md += `<script src="../assets/busca.js" defer></script>\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Decomposição completa da evidência
//
// A promessa do projeto é "por que este político está aqui?" — respondível até
// a votação que compõe o número. Até agora o perfil mostrava **3 votações de
// amostra** e dizia que era amostra; as outras existiam só no banco, para quem
// roda SQL. Estas páginas fecham isso.
//
// **São as 47.441 evidências gerais, não as 86.315.** A diferença são 38.874
// evidências de posições por tema, que são as *mesmas votações* recontadas uma
// vez por tema — uma matéria pertence a vários. Publicá-las repetiria o mesmo
// fato três vezes e faria o site parecer maior do que o acervo é.
//
// **Uma página por (parlamentar, eixo, escopo)** — 127 no total, mediana de 388
// linhas, máximo 545. É a mesma granularidade da tabela "Os dois eixos" do
// perfil: cada número exibido lá ganha um link para a sua própria decomposição,
// e nenhum fica sem.
//
// Tabela, não bloco de citação: o CSS já converte tabela em cartões no celular,
// e é a forma mais densa que sobrevive a 545 linhas. O texto da votação é o da
// fonte, sem edição.

interface EvidenciaCompleta {
  data: string;
  descricao: string;
  referencia: string;
  voto: string;
  concordou: number;
  idExterno: string;
  fonte: string;
}

const evidenciaCompleta = (politicoId: number, eixo: string, escopo: string) =>
  todos<EvidenciaCompleta>(
    `SELECT v.data, v.descricao, pe.referencia, vo.voto, pe.concordou,
            v.id_externo idExterno, v.fonte_url fonte
     FROM posicao_evidencia pe
     JOIN posicao po ON po.id = pe.posicao_id AND po.tema_id IS NULL
                    AND po.escopo = ? AND po.politico_id = ?
                    AND po.periodo_inicio = ? AND po.periodo_fim = ?
     JOIN eixo e ON e.id = po.eixo_id AND e.chave = ?
     JOIN votacao v ON v.id = pe.votacao_id
     JOIN voto vo ON vo.id = pe.voto_id
     ORDER BY v.data DESC, v.id_externo`,
    escopo,
    politicoId,
    periodo.ini,
    periodo.fim,
    eixo,
  );

/** `alinhamento_governo` + `merito` → `alinhamento-governo-merito`. */
const slugEvidencia = (eixo: string, escopo: string) =>
  `${eixo.replace(/_/g, "-")}-${escopo}`;

const ROTULO_EIXO: Record<string, string> = {
  alinhamento_governo: "Alinhamento com o governo federal",
  coesao_partidaria: "Coesão com o próprio partido",
};

function gerarEvidencia(p: Parlamentar, x: Posicao): string {
  const linhas = evidenciaCompleta(p.id, x.eixo, x.escopo);
  const coincidiu = linhas.filter((l) => l.concordou).length;
  const divergiu = linhas.length - coincidiu;
  const casa = senadores.some((s) => s.id === p.id) ? "senador" : "deputado federal";

  // Guarda: a página tem de **reproduzir** o número que diz decompor. Se um dia
  // a consulta daqui e a de `posicoes.ts` divergirem — filtro diferente, período
  // diferente, evidência perdida —, o site publicaria uma decomposição que não
  // fecha com o percentual exibido ao lado dela, em silêncio. Melhor não gerar.
  if (linhas.length !== x.n || pct(coincidiu / linhas.length) !== pct(x.valor)) {
    throw new Error(
      `decomposição não fecha para ${p.nome} · ${x.eixo} · ${x.escopo}: ` +
        `${linhas.length} evidências e ${pct(coincidiu / (linhas.length || 1))}% ` +
        `contra n=${x.n} e ${pct(x.valor)}% gravados em posicao`,
    );
  }

  let md = frontMatter(
    `${p.nome} — ${ROTULO_EIXO[x.eixo]}, ${ESCOPO_ROTULO[x.escopo] ?? x.escopo}`,
    `A decomposição completa: todas as ${linhas.length} votações que compõem o número de ${p.nome}, uma por linha, com link para a fonte.`,
    "evidencia",
  );

  md += `# ${ROTULO_EIXO[x.eixo]}\n\n`;
  md += `<p class="subtitulo"><b><a href="../../">${esc(p.nome)}</a></b>`;
  md += p.sigla ? ` · ${esc(p.sigla)}` : "";
  md += ` · ${casa} · escopo <b>${ESCOPO_ROTULO[x.escopo] ?? x.escopo}</b></p>\n\n`;

  md += `<div class="interrompe">\n`;
  md += `<h4>A conta inteira, votação por votação</h4>\n`;
  md += `<p><b>${pct(x.valor)}%</b> é <b>${coincidiu}</b> coincidências em\n`;
  md += `<b>${linhas.length}</b> votações computáveis — as outras ${divergiu} estão\n`;
  md += `aqui também. Esta página não é amostra: é a decomposição completa do\n`;
  md += `número, e some ou cresce junto com ele.</p>\n`;
  md += `</div>\n\n`;

  md += `> **Coincidiu e divergiu não são acerto e erro.** São o que a conta mede:\n`;
  md += `> se o voto foi igual ou diferente da referência daquele eixo. A referência\n`;
  md += `> está em cada linha, e o texto da votação é o da fonte, sem edição.\n\n`;

  md += `| Data | Votação | Referência | Voto | | Fonte |\n|---|---|---|---|---|---|\n`;
  for (const l of linhas) {
    const marca = l.concordou
      ? `<span class="coincidiu">coincidiu</span>`
      : `<span class="divergiu">divergiu</span>`;
    md += `| ${esc(l.data)} | ${esc(umaLinha(l.descricao))} `;
    md += `| ${esc(umaLinha(l.referencia))} `;
    md += `| <b>${esc(l.voto)}</b> | ${marca} `;
    md += `| [${esc(l.idExterno)}](${esc(l.fonte)}) |\n`;
  }
  md += `{: .t-evid}\n\n`;

  md += `O identificador da última coluna é o da votação na fonte oficial, e o\n`;
  md += `link abre o registro dela na API da Câmara. Nada nesta página é\n`;
  md += `interpretação: são votos registrados e a referência contra a qual cada um\n`;
  md += `foi comparado.\n`;

  return md;
}

/**
 * Página para imprensa.
 *
 * Escrita para editor com pressa, e por isso a seção mais longa é **como errar
 * com estes números** — não o que eles dizem. Repórter que publica "o deputado
 * mais fiel do RS" a partir da coesão erra de um jeito que o site não consegue
 * desmentir depois, e o erro fica com a assinatura dele. Avisar antes é o que
 * protege os dois lados.
 *
 * Nada aqui é institucional: não há "sobre nós", missão nem pedido de apoio.
 * O que a página oferece é conferência.
 */
function gerarImprensa(): string {
  const nCam = parlamentares.length;
  const nSen = senadores.length;
  const totalDiscursos = um<{ n: number }>(`SELECT COUNT(*) n FROM discurso`).n;
  const evid = um<{ n: number }>(`SELECT COUNT(*) n FROM posicao_evidencia`).n;

  let md = frontMatter(
    "Para jornalistas",
    "O que estes números dizem, como citá-los, e as cinco maneiras de errar com eles.",
    "prosa",
  );

  md += `# Para jornalistas\n\n`;
  md += `<p class="subtitulo">Como usar, como citar, e — principalmente — como\n`;
  md += `<b>não</b> errar com estes números.</p>\n\n`;

  md += `## O que este site é\n\n`;
  md += `Um registro de **como ${nCam} deputados federais e ${nSen} senadores do\n`;
  md += `Rio Grande do Sul votaram** na legislatura ${legislatura}, montado só a\n`;
  md += `partir das APIs oficiais da Câmara e do Senado. Cada número exibido é\n`;
  md += `decomponível até a votação que o compõe, com link para o registro na\n`;
  md += `origem — são ${milhar(evid)} evidências e ${milhar(totalDiscursos)}\n`;
  md += `discursos.\n\n`;

  md += `> **O site não classifica ninguém.** Não há nota, ranking, selo ou\n`;
  md += `> espectro ideológico. Os dois eixos medem coincidência de voto com\n`;
  md += `> referências declaradas na fonte — a orientação da liderança do Governo\n`;
  md += `> e a maioria do próprio partido. Nada aqui diz se um voto foi bom.\n\n`;

  md += `Isso é limitação deliberada, não falta de ambição: não existe fonte\n`;
  md += `oficial que classifique parlamentar em espectro ideológico, e atribuir\n`;
  md += `um seria opinião nossa vestida de dado.\n\n`;

  md += `## Cinco maneiras de errar com estes números\n\n`;
  md += `Nesta ordem de frequência esperada.\n\n`;

  md += `### 1. Ler coesão partidária como fidelidade, disciplina ou qualidade\n\n`;
  md += `É o erro mais fácil e o mais grave. **Coesão alta não é virtude.**\n`;
  md += `Marcel van Hattem (NOVO) tem 99% de coesão; Bohn Gass (PT), 98%. Os dois\n`;
  md += `quase nunca destoam dos seus, e votam em direções opostas. Uma frase como\n`;
  md += `"os mais fiéis da bancada" juntaria os dois numa lista que não significa\n`;
  md += `nada.\n\n`;
  md += `O eixo mede **quanto o voto coincidiu com a maioria do próprio partido**,\n`;
  md += `e nada além disso.\n\n`;

  md += `### 2. Comparar coesão entre partidos diferentes\n\n`;
  md += `Cada coesão é medida contra a maioria de **um** partido, e são maiorias\n`;
  md += `diferentes. Dizer que A é mais coeso que B, sendo de legendas distintas,\n`;
  md += `compara distâncias de dois pontos de referência que não têm relação. É\n`;
  md += `por isso que a visualização do site separa cada partido em sua faixa: a\n`;
  md += `comparação inválida foi tornada impossível de desenhar.\n\n`;

  md += `### 3. Ler alinhamento com o governo como ideologia\n\n`;
  md += `O eixo mede coincidência com a orientação do Executivo **do momento**.\n`;
  md += `Um partido troca de posição sem mudar uma vírgula do seu programa, e o\n`;
  md += `mesmo parlamentar mudaria de ponta se o governo mudasse. "Alinhamento com\n`;
  md += `o governo federal" é o rótulo correto; "esquerda" e "direita", não.\n\n`;

  md += `### 4. Comparar número do Senado com número da Câmara\n\n`;
  md += `Os universos não se comparam. **68% das votações do Senado são\n`;
  md += `secretas** — nelas a origem confirma que o senador votou, não como —, e\n`;
  md += `sobram ${abertasSenado} votações abertas contra\n`;
  md += `${milhar(acervo.nominaisCamara)} nominais da Câmara. Além disso, no\n`;
  md += `Senado **não existe o eixo de alinhamento com o governo**: a Casa não\n`;
  md += `publica orientação de bancada em dados abertos.\n\n`;

  md += `### 5. Usar um percentual sem o \`n\`\n\n`;
  md += `Todo número vem de um número de votações, e os denominadores **variam\n`;
  md += `entre parlamentares** porque cada um é medido só no seu período de\n`;
  md += `exercício — suplente que assumiu em 2025 não é "ausente" nas votações de\n`;
  md += `2023. Nos recortes por tema o \`n\` cai muito: 100% sobre 3 votações não\n`;
  md += `é 100%, e o site marca esses casos como amostra pequena.\n\n`;

  md += `## Como citar\n\n`;
  md += `Uma frase citável tem quatro partes: o número, o que ele mede, o \`n\` e\n`;
  md += `o período. Por exemplo:\n\n`;
  md += `> O deputado X votou conforme a orientação da liderança do Governo em\n`;
  md += `> **49,6% das 353 votações nominais de mérito** em que seu voto foi\n`;
  md += `> computável, entre fevereiro de 2023 e ${periodo.fim}.\n\n`;
  md += `Cada perfil traz esses quatro elementos, e cada percentual é um link\n`;
  md += `para a decomposição completa — todas as votações que entraram na conta,\n`;
  md += `uma por linha, com o voto registrado e o link para a fonte oficial.\n\n`;
  md += `**Confira antes de publicar.** A decomposição existe justamente para\n`;
  md += `isso, e um número que você não conseguiu refazer não deveria sair.\n\n`;

  md += `## Os dados\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| [posicoes.csv](../dados/posicoes.csv) | Os números de manchete das duas casas, uma linha por parlamentar, eixo e escopo. Separador vírgula, **decimal com ponto**, UTF-8 |\n`;
  md += `| [Metodologia](../metodologia/) | Como cada número é calculado, com o SQL. Versão \`${metodologia.versao}\` |\n`;
  md += `| [Fontes](../FONTES) | Os endpoints oficiais usados, o que cada um entrega e onde falha |\n`;
  md += `| [Repositório](https://github.com/RaulMdrs/bussola-civica) | Código sob MIT. O acervo inteiro é reconstruível com um comando |\n`;
  md += `{: .t-docs}\n\n`;

  md += `O acervo é atualizado automaticamente **duas vezes por semana**, e o\n`;
  md += `período apurado aparece no rodapé de toda página. Números citados em\n`;
  md += `matéria devem trazer a data.\n\n`;

  md += `## O que o site não tem, e por quê\n\n`;
  md += `Declarar limite é parte do método. Nenhum destes é "ainda não fizemos":\n\n`;
  md += `| Não existe | Motivo |\n|---|---|\n`;
  md += `| Alinhamento com o governo no Senado | A Casa não publica orientação de bancada em dados abertos. Nove endpoints testados |\n`;
  md += `| Posição do parlamentar sobre um tema | A fonte diz que a matéria trata do assunto, não se aprová-la o favorece |\n`;
  md += `| Plano de governo de deputado | Não existe: a exigência do TSE alcança candidatura majoritária |\n`;
  md += `| Cruzamento de senador com o TSE | Não há CPF na API do Senado, e nome de urna não é chave |\n`;
  md += `| Voto individual em votação simbólica ou secreta | A origem não o registra — são 82% do plenário da Câmara |\n`;
  md += `{: .t-docs}\n\n`;

  md += `## Contato\n\n`;
  md += `Dúvida sobre um número, pedido de recorte ou correção:\n`;
  md += `[abra uma questão no repositório](https://github.com/RaulMdrs/bussola-civica/issues).\n`;
  md += `Erro apontado com a votação específica é o mais rápido de verificar —\n`;
  md += `e, se o erro for nosso, a correção entra no acervo e no registro público\n`;
  md += `de defeitos.\n\n`;

  return md;
}

/** Uma página por parlamentar e ano. O porquê está no bloco no topo do arquivo. */
function gerarDiscursosAno(p: Parlamentar, ano: string): string {
  const substantivos = discursosDoAno(p.id, ano, 1);
  const protocolares = discursosDoAno(p.id, ano, 0);
  const anos = anosDeDiscurso(p.id);

  let md = frontMatter(
    `${p.nome} — discursos de ${ano}`,
    `Os discursos de ${p.nome} em ${ano}, com o sumário oficial e link para a fonte que o publicou.`,
    "discursos",
  );

  md += `# Discursos de ${ano}\n\n`;
  md += `<p class="subtitulo"><b><a href="../../">${esc(p.nome)}</a></b>`;
  md += p.sigla ? ` · ${esc(p.sigla)}` : "";
  md += ` · ${substantivos.length + protocolares.length} discursos em ${ano}</p>\n\n`;

  if (anos.length > 1) {
    md += `<p class="anos">Outros anos: `;
    md += anos
      .map((a) =>
        a.ano === ano
          ? `<b>${a.ano}</b>`
          : `<a href="../${a.ano}/">${a.ano}</a>`,
      )
      .join(" · ");
    md += `</p>\n\n`;
  }

  const senado = daCasaSenado(p);
  md += `> O que segue é o **sumário publicado pel${senado ? "o Senado" : "a Câmara"}**,\n`;
  md += `> sem edição — nada aqui é resumo nosso. O texto integral não é reproduzido\n`;
  md += `> neste site: o link de cada discurso leva ${senado ? "à página oficial do" : "ao **Diário da Câmara**"}\n`;
  md += `> ${senado ? "**pronunciamento**" : ""}, onde ele está publicado${senado ? "" : ", ou à **API** quando a origem não o publicou no Diário"}.\n\n`;

  md += `## Substantivos — ${substantivos.length}\n\n`;
  if (substantivos.length) {
    for (const d of substantivos) md += blocoDiscurso(d);
  } else {
    md += `Nenhum discurso deste ano foi classificado como substantivo.\n\n`;
  }

  if (protocolares.length) {
    md += `## Classificados como protocolares — ${protocolares.length}\n\n`;
    md += `<div class="ausencia">\n`;
    md += `<h4>Fora do perfil, dentro do acervo</h4>\n`;
    md += `<p>Estes discursos não entram na seção do perfil porque são ato de\n`;
    md += `procedimento, não posição: <b>orientação de bancada</b> (que já está\n`;
    md += `estruturada em <code>orientacao</code>, e é de onde sai o eixo 1) e\n`;
    md += `<b>registro de presença</b>. A classificação separa; ela não exclui — por\n`;
    md += `isso eles estão aqui, inteiros, com o mesmo link para a fonte.</p>\n`;
    md += `</div>\n\n`;
    for (const d of protocolares) md += blocoDiscurso(d);
  }

  return md;
}

/**
 * Aviso de incomparabilidade — repetido em toda página do Senado.
 *
 * O risco desta seção não é o número estar errado; é o leitor comparar 88% de
 * senador com 88% de deputado. Os universos não se comparam: 114 votações
 * abertas contra 1.117 nominais, vocabulário de voto diferente, e 68% das
 * votações do Senado sem voto individual recuperável. Por isso o aviso está no
 * corpo, antes da tabela, e num bloco que interrompe — não em rodapé.
 */
const AVISO_SENADO =
  `<div class="interrompe">\n` +
  `<h4>Não compare estes números com os dos deputados</h4>\n` +
  `<p>O Senado tem outro universo: <b>${abertasSenado} votações abertas</b> no\n` +
  `período, contra ${milhar(acervo.nominaisCamara)} nominais da Câmara, porque\n` +
  `<b>${sigiloSenado}% das votações do Senado são secretas</b> — nelas a origem\n` +
  `confirma que o senador votou, não como.</p>\n` +
  `</div>\n\n`;

/** A ausência do eixo 1 é informação, não falha de layout. */
const AUSENCIA_SENADO =
  `<div class="ausencia">\n` +
  `<h4>Alinhamento com o governo federal — não calculável</h4>\n` +
  `<p>O Senado não publica orientação de bancada em dados abertos, e sem\n` +
  `referência oficial não há contra o que comparar. Escolher uma seria rotular\n` +
  `por conta própria, que é o que este projeto não faz. Aqui existe um eixo só.</p>\n` +
  `</div>\n\n`;

function gerarPerfilSenador(p: Parlamentar): string {
  const pos = posicoesDe(p.id).filter((x) => !x.tema);
  let md = frontMatter(
    `${p.nome}${p.sigla ? ` (${p.sigla})` : ""} — senador`,
    `Como ${p.nome} vota no Senado: coesão com o próprio partido, a partir das votações abertas.`,
    "perfil",
  );
  md += `# ${p.nome}\n\n`;
  md += `<p class="subtitulo"><b>${esc(p.sigla ?? "sem filiação registrada")}</b> · `;
  md += `senador pelo RS · ${esc(p.condicao)}`;
  md += p.exercicio ? ` · em exercício desde <b>${esc(p.exercicio)}</b>` : "";
  md += `</p>\n\n`;
  md += AVISO_SENADO;
  md += AUSENCIA_SENADO;

  md += `## Coesão com o próprio partido\n\n`;
  md += `| Eixo | Escopo | Valor | Base de cálculo |\n|---|---|---:|---|\n`;
  for (const x of pos) {
    md += `| <span class="eixo-par">${esc(x.rotulo)}</span> `;
    md += `| <span class="escopo">${ESCOPO_ROTULO[x.escopo] ?? x.escopo}</span> `;
    md += `| [<span class="valor">${pct(x.valor)}%</span>](evidencia/${slugEvidencia(x.eixo, x.escopo)}/) `;
    md += `| <span class="n-detalhe">${x.n} <span>votações computáveis</span></span>`;
    md += `<span class="n-detalhe">${x.opo} <span>votações no exercício</span></span> |\n`;
  }
  md += `{: .t-eixos}\n\n`;
  md += `Não há recorte entre mérito e procedimental aqui: a regra que separa os\n`;
  md += `dois foi calibrada contra a descrição de votação da Câmara, e não foi\n`;
  md += `validada para o texto do Senado. Sem recorte medido, não se inventa recorte.\n\n`;

  const divergiu = evidenciasDe(p.id, "coesao_partidaria", 0, 3, "unico");
  if (divergiu.length) {
    md += `## Por que este número\n\n`;
    md += `Amostra das votações em que o voto divergiu da maioria do próprio partido.\n`;
    md += `As descrições são o texto original da fonte oficial.\n\n`;
    for (const e of divergiu) md += blocoEvidencia(e);
  }

  md += `### A conta inteira\n\n`;
  for (const x of pos) {
    md += `- [${ROTULO_EIXO[x.eixo] ?? x.rotulo}, `;
    md += `${(ESCOPO_ROTULO[x.escopo] ?? x.escopo).toLowerCase()}`;
    md += `](evidencia/${slugEvidencia(x.eixo, x.escopo)}/) — ${x.n} votações,\n`;
    md += `  coincidências inclusive\n`;
  }
  md += `\n`;

  md += secaoDiscursos(p);

  return md;
}

function gerarIndiceSenadores(senadores: Parlamentar[]): string {
  let md = frontMatter(
    "Senadores do Rio Grande do Sul",
    "Os 3 senadores gaúchos: coesão partidária a partir das votações abertas do Senado.",
    "indice",
  );
  md += `# Senadores do Rio Grande do Sul\n\n`;
  md += `<p class="subtitulo">${senadores.length} parlamentares, em ordem alfabética. `;
  md += `A ordem é navegação, não classificação.</p>\n\n`;
  md += AVISO_SENADO;
  md += AUSENCIA_SENADO;

  const doSenado = corposDaCasa("senado");
  if (doSenado.length) {
    // Sem eixo, de propósito: os três senadores são de três partidos, e coesão
    // medida contra três maiorias diferentes não vira posição num eixo comum.
    // Pô-los numa régua diria "Paim > Heinze > Mourão", que é ranking de
    // grandezas incomparáveis — o erro que a §6.10 impede na Câmara e que aqui
    // seria mais fácil de cometer, porque só há um eixo para desenhar.
    md += `<div class="orbita-quadro">\n`;
    md += gerarOrbita(
      doSenado,
      null,
      "sem eixo horizontal: o alinhamento com o governo não é calculável no Senado",
    );
    md += `</div>\n\n`;

    md += `**Como ler.** A órbita mede o quanto o voto se afasta da maioria da\n`;
    md += `própria bancada — órbita pequena é quem quase nunca destoa dos seus.\n`;
    md += `**Não há posição horizontal**, e o vazio à direita é isso mesmo: o eixo\n`;
    md += `de alinhamento com o governo existe na Câmara e não existe aqui.\n\n`;

    md += `> **As órbitas destes três não se comparam entre si.** Cada uma é medida\n`;
    md += `> contra a maioria do próprio partido, e são três partidos. Órbita menor\n`;
    md += `> não é mais disciplina que a do vizinho — é menos distância de outra\n`;
    md += `> referência. Por isso cada um tem sua faixa, e não há régua ligando\n`;
    md += `> uma à outra.\n\n`;

    const ns = doSenado.map((c) => c.n).filter((n) => n != null);
    md += `O \`n\` não está no gráfico: vai de **${Math.min(...ns)} a\n`;
    md += `${Math.max(...ns)} votações abertas**, e está na tabela abaixo.\n\n`;
  }

  md += `| Senador | Partido | Coesão partidária | Votações (n) |\n|---|---|---:|---:|\n`;
  for (const p of senadores) {
    const x = posicoesDe(p.id).find((y) => !y.tema);
    md += `| [${p.nome}](${slug(p.nome)}/) `;
    md += `| <span class="sigla">${esc(p.sigla ?? "—")}</span> `;
    md += `| ${x ? `<span class="valor">${pct(x.valor)}%</span>` : "—"} `;
    md += `| ${x ? enne(x.n) + avisoN(x.n) : "—"} |\n`;
  }
  md += `{: .t-senado}\n`;
  return md;
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
    "tema",
  );
  md += `# ${tema}\n\n`;
  md += `<p class="subtitulo"><b>${votacoes.n} votações nominais de mérito</b> sobre `;
  md += `este tema no período.</p>\n\n`;
  md += `> O que a tabela mede é **alinhamento com a orientação do Governo dentro\n`;
  md += `> deste tema** — não posição a favor ou contra o assunto. Essa direção não\n`;
  md += `> existe em fonte oficial, e atribuí-la seria rotular por conta própria.\n\n`;

  md += `| Parlamentar | Partido | Alinhamento | Votações (n) |\n|---|---|---|---:|\n`;
  for (const l of linhas) {
    md += `| [${l.nome}](../../parlamentares/${slug(l.nome)}/) `;
    md += `| <span class="sigla">${esc(l.sigla ?? "—")}</span> `;
    md += `| ${barra(l.valor, l.n)} <span class="valor">${pct(l.valor)}%</span> `;
    md += `| ${enne(l.n)}${avisoN(l.n)} |\n`;
  }
  md += `{: .t-bancada}\n\n`;

  const fracos = linhas.filter((l) => l.n < FRAGIL).length;
  if (fracos) {
    md += `**${fracos} de ${linhas.length} parlamentares têm menos de ${FRAGIL}\n`;
    md += `votações** neste tema. Nesses casos a porcentagem é frágil e o \`n\` é a\n`;
    md += `informação mais importante da linha.\n`;
  }
  return md;
}


// ---------------------------------------------------------------------------
// Órbita — o panorama da bancada
//
// Estava no plano original como "visualização orbital", e o risco dela nunca
// foi técnico: é a única forma de exibição em que o **eixo 2 mente sozinho**.
//
// Marcel van Hattem (NOVO) tem 99% de coesão; Bohn Gass (PT), 98%. Num
// espalhamento 2D com coesão no eixo Y, os dois ficam colados — e proximidade
// lê-se como semelhança, sem que ninguém tenha escrito uma frase falsa. São
// 99% de fidelidade ao NOVO contra 98% ao PT: mesmo número, política oposta.
//
// A saída não foi avisar; foi **tornar a comparação inexprimível**:
//
//  1. **Uma faixa por partido.** Coesão só é comparável dentro da mesma
//     legenda, porque a referência dela é a maioria daquele partido. Em faixas
//     separadas, ninguém compara a coesão de dois partidos por acidente.
//  2. **Coesão não ocupa eixo nenhum.** Vira o raio da órbita de cada corpo —
//     atributo da marca, não posição num espaço compartilhado. Dois pontos com
//     órbita do mesmo tamanho em faixas diferentes não sugerem nada.
//  3. **Só o alinhamento é posição**, e essa comparação é legítima: a
//     referência é a mesma para todos, a orientação declarada do Governo.
//
// SVG estático, gerado aqui. **Sem JavaScript** — funciona sem script, em
// impressão e em leitor de tela, e cada corpo é um link para o perfil. A busca
// precisou de script porque casar texto exige o texto do lado do leitor; um
// panorama de 31 pontos, não.

type Casa = "camara" | "senado";

interface Corpo {
  nome: string;
  sigla: string;
  alinhamento: number;
  coesao: number;
  n: number;
}

/**
 * Corpos de uma casa. `escopo` difere porque o Senado não tem recorte entre
 * mérito e procedimental — a regra que os separa foi calibrada contra texto da
 * Câmara e não foi validada lá (§6.1).
 *
 * `alinhamento` volta NULL no Senado, e é assim que deve ser: não há orientação
 * de bancada em dados abertos, então o eixo não existe. `COALESCE` aqui
 * inventaria zero, que é uma posição — e posição inventada é rótulo nosso.
 */
const corposDaCasa = (casa: Casa) =>
  todos<Corpo>(
    `SELECT p.nome_parlamentar nome, COALESCE(pt.sigla, '—') sigla,
            MAX(CASE WHEN e.chave = 'alinhamento_governo' THEN po.valor END) alinhamento,
            MAX(CASE WHEN e.chave = 'coesao_partidaria'   THEN po.valor END) coesao,
            MAX(po.n_observacoes) n
     FROM posicao po
     JOIN eixo e ON e.id = po.eixo_id
     JOIN politico p ON p.id = po.politico_id
     JOIN mandato m ON m.politico_id = p.id AND m.casa = ?
     LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
     LEFT JOIN partido pt ON pt.id = f.partido_id
     WHERE po.tema_id IS NULL AND po.escopo = ?
       AND po.periodo_inicio = ? AND po.periodo_fim = ?
     GROUP BY p.id`,
    casa,
    casa === "camara" ? "merito" : "unico",
    periodo.ini,
    periodo.fim,
  );

/**
 * O rótulo é o **nome parlamentar inteiro**, como a Câmara o publica.
 *
 * A primeira versão cortava para o sobrenome, e inventava dois problemas: o
 * acervo tem "Mauricio Marcon" (PL) e "Marcon" (PT), que viravam o mesmo
 * rótulo; e "Covatti Filho" virava "Filho", que não é sobrenome de ninguém.
 * Como cada parlamentar tem sua própria linha, o nome cabe — e nome oficial
 * não se abrevia por conveniência de layout.
 */

/**
 * Eixo horizontal, quando existe. `null` quando a casa não o tem.
 *
 * Só entra aqui grandeza cuja **referência é a mesma para todos os corpos do
 * gráfico** — hoje, o alinhamento com o governo, medido contra a orientação
 * declarada do Governo. Coesão nunca pode entrar: são tantas referências
 * quantos partidos, e pô-la num eixo é o erro que a §6.10 existe para impedir.
 */
interface EixoOrbita {
  rotulo: string;
  valor: (c: Corpo) => number | null;
}

/**
 * Órbita de um conjunto de parlamentares.
 *
 * Recebe a lista pronta — não consulta o banco — para que o mesmo desenho sirva
 * a uma casa, a uma bancada estadual ou a um recorte qualquer sem duplicar
 * layout. É a preparação para a expansão nacional; o que ela ainda **não**
 * resolve está anotado em `TETO_LEGIVEL`.
 */
const TETO_LEGIVEL = 60;
/*
 * Uma linha por parlamentar a 30px: 31 deputados dão 1.244px, o que se lê. Os
 * 513 da Câmara dariam ~16.000px, que não se lê de jeito nenhum. Quando a
 * expansão nacional vier, o recorte terá de vir junto — por UF é o corte que a
 * fonte já traz e que o leitor já entende —, e este teto é o aviso de que
 * chamar esta função com a bancada inteira não produz gráfico, produz rolo.
 */

function gerarOrbita(
  corpos: Corpo[],
  eixo: EixoOrbita | null,
  semEixo?: string,
): string {
  const validos = corpos.filter((c) => c.coesao != null);
  if (!validos.length) return "";
  if (validos.length > TETO_LEGIVEL) {
    throw new Error(
      `órbita com ${validos.length} corpos — acima do teto de ${TETO_LEGIVEL}.\n` +
        `Uma linha por parlamentar deixa de ser legível muito antes disso.\n` +
        `Divida o conjunto (por UF, por casa) e gere um gráfico por recorte.`,
    );
  }

  const porPartido = new Map<string, Corpo[]>();
  for (const c of validos) {
    if (!porPartido.has(c.sigla)) porPartido.set(c.sigla, []);
    porPartido.get(c.sigla)!.push(c);
  }
  // Ordem alfabética da sigla. Ordenar por valor faria ranking de partido, que
  // este projeto não produz — e a média de duas pessoas não é posição de legenda.
  const partidos = [...porPartido.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  const ESQ = 104;
  const DIR = 30;
  const L = 900;
  const x0 = ESQ;
  const x1 = L - DIR;
  const TOPO = eixo ? 52 : 60;
  const LINHA = 30;  // uma linha por parlamentar — nada se empilha
  const GRUPO = 14;
  const px = (v: number) => x0 + v * (x1 - x0);
  /** Raio da órbita: o quanto o voto se afasta da maioria da própria bancada. */
  const raio = (coesao: number) => 3.5 + (1 - coesao) * 24;
  /** Sem eixo, todo corpo fica na mesma coluna: posição sem grandeza é ruído. */
  const X_FIXO = x0 + 120;

  const H = TOPO + partidos.reduce((n, [, m]) => n + m.length * LINHA + GRUPO, 0) + 16;

  let svg = `<svg class="orbita" viewBox="0 0 ${L} ${H}" role="img" aria-label="`;
  svg += eixo
    ? `Panorama: ${esc(eixo.rotulo)} na horizontal, e a órbita de cada parlamentar em torno da maioria do próprio partido.`
    : `Panorama: a órbita de cada parlamentar em torno da maioria do próprio partido. ${esc(semEixo ?? "")}`;
  svg += ` Os mesmos números estão na tabela abaixo.">\n`;

  if (eixo) {
    svg += `<g class="regua">\n`;
    for (let v = 0; v <= 100; v += 25) {
      const x = px(v / 100).toFixed(1);
      svg += `<line x1="${x}" y1="${TOPO - 14}" x2="${x}" y2="${H - 12}" class="grade"/>\n`;
      svg += `<text x="${x}" y="${TOPO - 22}" class="tick">${v}%</text>\n`;
    }
    svg += `<text x="${x0}" y="20" class="eixo-rot">${esc(eixo.rotulo)} →</text>\n`;
    svg += `</g>\n`;
  } else {
    // A ausência do eixo é desenhada, não só escrita: o leitor vê a dimensão
    // que falta em vez de ler que ela falta. Mesmo princípio do bloco
    // `.ausencia` no perfil do senador (§6.4).
    svg += `<g class="sem-eixo">\n`;
    svg += `<rect x="${x0}" y="${TOPO - 34}" width="${x1 - x0}" height="${H - TOPO + 22}" `;
    svg += `class="vazio"/>\n`;
    svg += `<text x="${x0 + 12}" y="${TOPO - 16}" class="eixo-rot">`;
    svg += `${esc(semEixo ?? "eixo horizontal não calculável nesta casa")}</text>\n`;
    svg += `</g>\n`;
  }

  let y = TOPO + 6;
  for (const [sigla, membros] of partidos) {
    const ordenados = eixo
      ? [...membros].sort((a, b) => (eixo.valor(b) ?? 0) - (eixo.valor(a) ?? 0))
      : [...membros].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const yIni = y;

    ordenados.forEach((c, k) => {
      const cy = y + k * LINHA + LINHA / 2;
      const v = eixo?.valor(c);
      const cx = eixo && v != null ? px(v) : X_FIXO;
      const r = raio(c.coesao);
      const aDireita = !eixo || (v ?? 0) < 0.62;
      const lx = aDireita ? cx + r + 8 : cx - r - 8;

      svg += `<a href="${slug(c.nome)}/">\n`;
      svg += `<title>${esc(c.nome)} (${esc(c.sigla)})`;
      if (eixo && v != null) svg += ` — ${esc(eixo.rotulo)} ${pct(v)}%,`;
      else svg += ` —`;
      svg += ` coesão com o próprio partido ${pct(c.coesao)}%, apurados em ${c.n} votações</title>\n`;
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" class="orbe"/>\n`;
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.8" class="corpo"/>\n`;
      svg += `<text x="${lx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" `;
      svg += `text-anchor="${aDireita ? "start" : "end"}" class="rotulo">${esc(c.nome)}</text>\n`;
      svg += `</a>\n`;
    });

    const yFim = y + ordenados.length * LINHA;
    svg += `<line x1="${ESQ - 14}" y1="${yIni + 6}" x2="${ESQ - 14}" y2="${yFim - 6}" class="chave"/>\n`;
    svg += `<text x="${ESQ - 22}" y="${((yIni + yFim) / 2 + 4).toFixed(1)}" class="sigla-faixa">`;
    svg += `${esc(sigla)}</text>\n`;
    y = yFim + GRUPO;
  }

  svg += `</svg>\n`;
  return svg;
}

/** O eixo da Câmara. O Senado passa `null` — lá ele não existe. */
const EIXO_GOVERNO: EixoOrbita = {
  rotulo: "alinhamento com o governo federal, no mérito",
  valor: (c) => c.alinhamento,
};

function gerarIndiceParlamentares(): string {
  let md = frontMatter(
    "Deputados federais do Rio Grande do Sul",
    "Os 31 deputados federais do Rio Grande do Sul: alinhamento com o governo e coesão partidária, a partir de votações nominais.",
    "indice",
  );
  md += `# Deputados federais do Rio Grande do Sul\n\n`;
  md += `<p class="subtitulo">${parlamentares.length} parlamentares da legislatura 57, `;
  md += `em ordem alfabética. A ordem é navegação, não classificação.</p>\n\n`;

  const daCamara = corposDaCasa("camara").filter((c) => c.alinhamento != null);
  md += `<div class="orbita-quadro">\n${gerarOrbita(daCamara, EIXO_GOVERNO)}</div>\n\n`;
  md += `<p class="orbita-dica">O panorama acima rola para o lado — ou role a\n`;
  md += `página até a tabela, que traz os mesmos números em texto.</p>\n\n`;
  md += `**Como ler.** Cada corpo é um parlamentar; a posição horizontal é o\n`;
  md += `alinhamento com o governo, e essa comparação vale entre todos, porque a\n`;
  md += `referência é a mesma — a orientação declarada do Governo. **A órbita ao\n`;
  md += `redor é outra coisa**: mede o quanto o voto se afasta da maioria da\n`;
  md += `própria bancada. Órbita pequena é quem quase nunca destoa dos seus.\n\n`;

  md += `> **Por isso cada partido tem sua faixa.** Coesão só significa alguma\n`;
  md += `> coisa dentro da mesma legenda: a referência dela é a maioria daquele\n`;
  md += `> partido, e são maiorias diferentes. Marcel van Hattem tem 99% de coesão\n`;
  md += `> com o NOVO e Bohn Gass tem 98% com o PT — órbitas quase idênticas, e\n`;
  md += `> política oposta. Num gráfico que pusesse coesão num eixo, os dois\n`;
  md += `> ficariam colados, e a proximidade diria algo falso sem que ninguém\n`;
  md += `> tivesse escrito uma frase falsa.\n\n`;

  // A regra do §6.3 diz que o `n` nunca é tooltip. Num gráfico não há número
  // impresso para acompanhar, então ele entra em prosa, com a amplitude real —
  // e a tabela logo abaixo traz o de cada um, linha a linha.
  const ns = daCamara.map((c) => c.n).filter((n) => n != null);
  if (ns.length) {
    md += `**O gráfico não mostra o \`n\`**, e nenhum ponto deve ser lido sem\n`;
    md += `ele: os denominadores vão de **${Math.min(...ns)} a ${Math.max(...ns)}\n`;
    md += `votações**, porque cada parlamentar é medido só no seu período de\n`;
    md += `exercício. O \`n\` de cada um está na tabela abaixo e no perfil — e\n`;
    md += `aparece ao passar o cursor sobre o corpo, que é acréscimo, não\n`;
    md += `substituto.\n\n`;
  }

  md += `> **Estas duas colunas não se comparam entre si e não ordenam ninguém.**\n`;
  md += `> Alinhamento mede coincidência com a orientação declarada pela liderança do\n`;
  md += `> Governo; coesão mede coincidência com a maioria do próprio partido. Um\n`;
  md += `> valor alto não é melhor que um baixo — é outro. E os dois só significam\n`;
  md += `> alguma coisa ao lado do \`n\`: o número de votações de que foram extraídos.\n\n`;

  md += `| Parlamentar | Partido | Alinh. c/ governo | Coesão partidária | Votações (n) |\n`;
  md += `|---|---|---:|---:|---:|\n`;

  for (const p of parlamentares) {
    const pos = posicoesDe(p.id).filter((x) => !x.tema && x.escopo === "merito");
    const al = pos.find((x) => x.eixo === "alinhamento_governo");
    const co = pos.find((x) => x.eixo === "coesao_partidaria");
    md += `| [${p.nome}](${slug(p.nome)}/) `;
    md += `| <span class="sigla">${esc(p.sigla ?? "—")}</span> `;
    md += `| ${al ? `<span class="valor">${pct(al.valor)}%</span>` : "—"} `;
    md += `| ${co ? `<span class="valor">${pct(co.valor)}%</span>` : "—"} `;
    md += `| ${al ? enne(al.n) + avisoN(al.n) : "—"} |\n`;
  }
  md += `{: .t-indice}\n\n`;

  md += `Valores do escopo de **mérito** — o principal. Cada perfil traz também o\n`;
  md += `escopo procedimental e os recortes por tema.\n`;
  return md;
}

/**
 * Home. Gerada como as demais, e pelo mesmo motivo: os números que ela cita
 * — quantos deputados, quantos temas, quantas votações — mudam com o acervo.
 * Escritos à mão, ficariam certos no dia e errados na semana seguinte, sem
 * ninguém perceber. A prosa é fixa; só os números vêm do banco.
 */
function gerarHome(temas: { id: number; nome: string }[]): string {
  let md = frontMatter(
    "Bússola Cívica",
    "Como parlamentares votam, a partir de fontes oficiais rastreáveis.",
    "home",
  );
  md += `# Bússola Cívica\n\n`;
  md += `<p class="subtitulo">Plataforma que mostra como parlamentares votam, a `;
  md += `partir de fontes oficiais. Câmara e Senado, bancada do Rio Grande do Sul, `;
  md += `<b>${legislatura}ª legislatura</b>.</p>\n\n`;

  md += `> **Princípio inegociável:** nunca rotular político por conta própria.\n`;
  md += `> Todo dado exibido deriva de fonte oficial e carrega link para ela. O\n`;
  md += `> usuário tira a conclusão.\n\n`;

  md += `## [Deputados federais do Rio Grande do Sul →](./parlamentares/)\n\n`;
  md += `Os **${parlamentares.length} deputados federais** da legislatura\n`;
  md += `${legislatura}, cada um com seus dois eixos, os recortes por tema e amostra\n`;
  md += `da evidência que sustenta cada número — com link para a votação na fonte\n`;
  md += `oficial.\n\n`;
  md += `Também por [tema](./temas/): **${temas.length} assuntos** com votação\n`;
  md += `suficiente para sustentar um recorte.\n\n`;

  md += `## [Senadores do Rio Grande do Sul →](./senadores/)\n\n`;
  md += `Os **${senadores.length} senadores gaúchos**, com coesão partidária apurada\n`;
  md += `sobre as votações abertas. O universo do Senado é outro —\n`;
  md += `**${abertasSenado} votações abertas** contra\n`;
  md += `${milhar(acervo.nominaisCamara)} nominais da Câmara — e lá existe **um eixo\n`;
  md += `só**: não há orientação de bancada em dados abertos, então o alinhamento com\n`;
  md += `o governo não é calculável.\n\n`;

  md += `## [Metodologia dos eixos →](./metodologia/)\n\n`;
  md += `**É por isso que este site existe.** A plataforma exibe números que\n`;
  md += `posicionam parlamentares, e o princípio acima exige que qualquer pessoa\n`;
  md += `consiga refazer a conta. A metodologia é um documento vivo — hoje na versão\n`;
  md += `\`${metodologia.versao}\` — e as versões superadas ficam\n`;
  md += `[arquivadas](./metodologia/versoes/), porque um número calculado sob uma\n`;
  md += `regra antiga só é explicado pelo documento daquela regra.\n\n`;

  md += `Os dois eixos, em uma linha cada:\n\n`;
  md += `- **Alinhamento com o governo federal** — proporção de votos conforme a\n`;
  md += `  orientação da liderança do Governo. Mede posição relativa ao Executivo do\n`;
  md += `  momento, **não ideologia**.\n`;
  md += `- **Coesão com o próprio partido** — proporção de votos com a maioria do\n`;
  md += `  próprio partido, excluído o voto de quem está sendo medido. Mede\n`;
  md += `  comportamento, **não ideologia**: dois parlamentares de partidos opostos\n`;
  md += `  com 100% ocupam o mesmo ponto.\n\n`;
  md += `Ambos são apurados separadamente no **mérito** das matérias e em votações\n`;
  md += `**procedimentais** — votar a urgência de um projeto não é votar o projeto.\n\n`;

  md += `## Documentação técnica\n\n`;
  md += `| Documento | O que traz |\n|---|---|\n`;
  md += `| [Para jornalistas](./imprensa/) | Como citar, os dados em CSV, e as cinco maneiras de errar com estes números |\n`;
  md += `| [FONTES](./FONTES) | Reconhecimento das APIs oficiais: o que cada endpoint entrega e onde falha |\n`;
  md += `| [MODELO-DADOS](./MODELO-DADOS) | Por que o schema tem a forma que tem — as formas de mentir que ele bloqueia |\n`;
  md += `| [INGESTOR](./INGESTOR) | Arquitetura de coleta: idempotência, auditoria, retomada incremental |\n`;
  md += `{: .t-docs}\n\n`;

  md += `Código: [github.com/RaulMdrs/bussola-civica](https://github.com/RaulMdrs/bussola-civica) · MIT\n\n`;
  md += `O acervo é integralmente reconstruível a partir das fontes oficiais, com um\n`;
  md += `comando. Nada aqui depende de dado que não possa ser recoletado e conferido.\n`;

  return md;
}

function gerarIndiceTemas(temas: { id: number; nome: string }[]): string {
  let md = frontMatter(
    "Temas",
    "Alinhamento com o governo federal recortado pelos 12 temas com votação suficiente.",
    "indice",
  );
  md += `# Temas\n\n`;
  md += `<p class="subtitulo">Os eixos também são apurados <b>dentro de um tema</b>. `;
  md += `Um tema vira recorte quando tem ao menos 30 votações nominais de mérito no `;
  md += `período — hoje são <b>${temas.length}</b>, dos 32 da classificação oficial `;
  md += `da Câmara.</p>\n\n`;
  md += `| Tema | Votações nominais | Média da bancada |\n|---|---:|---:|\n`;
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
    md += `| [${t.nome}](${slug(t.nome)}/) | ${contagem(r.v)} `;
    md += `| <span class="valor">${pct(r.media)}%</span> |\n`;
  }
  md += `{: .t-lista-temas}\n`;
  return md;
}

// ---------------------------------------------------------------------------

function escrever(caminho: string, conteudo: string) {
  mkdirSync(join(SAIDA, caminho), { recursive: true });
  writeFileSync(join(SAIDA, caminho, "index.md"), conteudo);
}

/**
 * CSV dos números de manchete, para quem vai conferir numa planilha.
 *
 * O site inteiro é decomponível página a página, mas repórter em fechamento
 * abre planilha, não 127 páginas. São ~130 linhas: cada parlamentar, cada eixo,
 * cada escopo, com os dois denominadores e o link do perfil que sustenta a
 * linha.
 *
 * Sem recorte por tema, de propósito: são 744 linhas de posições temáticas,
 * várias com `n` pequeno, e num CSV elas perdem o aviso que a página carrega
 * ao lado. Quem precisar delas tem o acervo inteiro no repositório.
 */
function escreverCsv(): number {
  const linhas = todos<{
    nome: string; casa: string; sigla: string | null; eixo: string;
    escopo: string; valor: number; n: number; opo: number;
  }>(
    `SELECT p.nome_parlamentar nome, m.casa, pt.sigla, e.nome_exibicao eixo,
            po.escopo, po.valor, po.n_observacoes n, po.n_oportunidades opo
     FROM posicao po
     JOIN eixo e ON e.id = po.eixo_id
     JOIN politico p ON p.id = po.politico_id
     JOIN mandato m ON m.politico_id = p.id
     LEFT JOIN filiacao f ON f.politico_id = p.id AND f.data_fim IS NULL
     LEFT JOIN partido pt ON pt.id = f.partido_id
     WHERE po.tema_id IS NULL AND p.perfil_completo = 1
       AND po.periodo_inicio = ? AND po.periodo_fim = ?
     ORDER BY m.casa, p.nome_parlamentar, e.chave, po.escopo`,
    periodo.ini,
    periodo.fim,
  );

  /** Campo de CSV: aspas duplicadas, e aspas sempre — nome tem vírgula. */
  const campo = (v: string | number | null) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;

  const cab = [
    "nome", "casa", "partido", "eixo", "escopo", "valor_pct",
    "n_observacoes", "n_oportunidades", "periodo_inicio", "periodo_fim",
    "metodologia_versao", "url_perfil",
  ];
  const corpo =
    cab.join(",") + "\n" +
    linhas
      .map((l) =>
        [
          campo(l.nome), campo(l.casa), campo(l.sigla ?? ""), campo(l.eixo),
          // Ponto decimal, não vírgula: o CSV é para ser lido por planilha **e**
          // por script, e vírgula decimal quebra a segunda sem garantir a
          // primeira, que depende do idioma da planilha. A página declara.
          campo(l.escopo), campo((l.valor * 100).toFixed(1)), campo(l.n), campo(l.opo),
          campo(periodo.ini), campo(periodo.fim), campo(metodologia.versao),
          campo(`${BASE_SITE}/${l.casa === "camara" ? "parlamentares" : "senadores"}/${slug(l.nome)}/`),
        ].join(","),
      )
      .join("\n") + "\n";

  mkdirSync(join(SAIDA, "dados"), { recursive: true });
  writeFileSync(join(SAIDA, "dados", "posicoes.csv"), corpo);
  return linhas.length;
}

/**
 * `sitemap.xml` e `robots.txt`.
 *
 * O sitemap é varrido do que foi escrito, não de uma lista à mão: são 305
 * páginas e uma lista digitada envelheceria no primeiro parlamentar novo —
 * o mesmo motivo pelo qual a home passou a ser gerada.
 *
 * `lastmod` é a data do acervo, não o mtime do arquivo. No CI todo arquivo é
 * recém-escrito, e mtime diria "tudo mudou agora" em toda execução. A data do
 * acervo é o que de fato determina o conteúdo.
 */
function escreverSitemap() {
  const urls: string[] = [];
  const varrer = (dir: string) => {
    for (const item of readdirSync(join(SAIDA, dir), { withFileTypes: true })) {
      if (item.name.startsWith("_") || item.name === "busca") continue;
      const rel = dir ? `${dir}/${item.name}` : item.name;
      if (item.isDirectory()) varrer(rel);
      else if (item.name === "index.md") urls.push(dir ? `${dir}/` : "");
      else if (item.name.endsWith(".md") && item.name !== "CHECKPOINT.md") {
        urls.push(rel.replace(/\.md$/, ""));
      }
    }
  };
  varrer("");

  const corpo =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .sort()
      .map(
        (u) =>
          `  <url><loc>${BASE_SITE}/${u}</loc>` +
          `<lastmod>${periodo.fim}</lastmod></url>\n`,
      )
      .join("") +
    `</urlset>\n`;
  writeFileSync(join(SAIDA, "sitemap.xml"), corpo);

  writeFileSync(
    join(SAIDA, "robots.txt"),
    `# Bússola Cívica — dados públicos, derivados de fontes oficiais.\n` +
      `# Nada aqui é privado, e o acervo inteiro é reconstruível da origem.\n` +
      `User-agent: *\n` +
      `Allow: /\n\n` +
      `Sitemap: ${BASE_SITE}/sitemap.xml\n`,
  );
  return urls.length;
}

/**
 * Metadados do rodapé, para o layout. Escritos aqui, a partir do banco, na
 * mesma execução que escreve as páginas: rodapé mantido à mão desvia em
 * silêncio, e o dia em que desviar o site vai afirmar que os números foram
 * calculados sob uma metodologia que não os produziu.
 */
function escreverMeta() {
  mkdirSync(join(SAIDA, "_data"), { recursive: true });
  writeFileSync(
    join(SAIDA, "_data", "meta.yml"),
    `# Gerado por 'npm run site' a partir do acervo. Não editar à mão.\n` +
      `periodo_inicio: "${periodo.ini}"\n` +
      `periodo_fim: "${periodo.fim}"\n` +
      `legislatura: ${legislatura}\n` +
      `metodologia_versao: "${metodologia.versao}"\n` +
      `metodologia_url: "${metodologia.url}"\n`,
  );
}

/**
 * Guarda contra publicar um acervo mais velho que o já publicado.
 *
 * Desde que a atualização virou automática existem **duas cópias do banco**: a
 * da máquina e a do cache do Actions. Elas avançam sozinhas, e em 2026-09-02 a
 * local estava 12 dias atrás da do CI. Gerar da máquina atrasada e commitar
 * faria as 305 páginas **retrocederem, sem erro nenhum** — o gerador é
 * determinístico sobre o banco que recebe, e o banco é que estava velho.
 *
 * O `meta.yml` publicado é a prova de até quando o site já afirmou ter apurado.
 * Se o banco atual não alcança aquela data, a geração para aqui, antes do
 * `rmSync` — falhar depois de apagar as páginas trocaria um problema por outro.
 *
 * Igual passa: regenerar o mesmo estado é a propriedade determinística que a
 * Action usa para não commitar ruído. Só **retroceder** é erro.
 *
 * Escotilha: `BUSSOLA_PERMITIR_RETROCESSO=1`, para o caso legítimo de reverter
 * um acervo ruim. Guarda que não pode ser desligada vira obstáculo no dia em
 * que a resposta certa for exatamente retroceder.
 */
function exigirAcervoNaoRetrocedido() {
  const caminho = join(SAIDA, "_data", "meta.yml");
  if (!existsSync(caminho)) return; // primeira geração, nada a comparar

  const publicado = readFileSync(caminho, "utf8").match(/^periodo_fim:\s*"([^"]+)"/m)?.[1];

  // Se o arquivo existe mas o campo não casa, o formato mudou e esta guarda
  // parou de guardar — em silêncio, que é o modo de falha que ela existe para
  // impedir. Melhor quebrar aqui, ao lado do `escreverMeta()` que produz o
  // formato, do que voltar a publicar retrocesso sem ninguém perceber.
  if (!publicado) {
    throw new Error(
      `${caminho} existe mas não traz 'periodo_fim' no formato esperado.\n` +
        `A guarda contra retrocesso depende dele. Se o formato mudou em ` +
        `escreverMeta(), atualize a leitura aqui também.`,
    );
  }

  if (periodo.fim >= publicado) return;

  if (process.env.BUSSOLA_PERMITIR_RETROCESSO === "1") {
    console.warn(
      `AVISO: retrocedendo o site de ${publicado} para ${periodo.fim} ` +
        `(BUSSOLA_PERMITIR_RETROCESSO=1).`,
    );
    return;
  }

  throw new Error(
    `o acervo está atrás do site publicado — geração abortada.\n\n` +
      `  site publicado apurado até  ${publicado}\n` +
      `  este banco apura até        ${periodo.fim}\n\n` +
      `Gerar agora faria as páginas retrocederem ${diasEntre(periodo.fim, publicado)} dia(s).\n` +
      `Atualize o acervo antes:\n\n` +
      `  npm run ingerir:incremental && npm run site\n\n` +
      `Se retroceder for mesmo a intenção: BUSSOLA_PERMITIR_RETROCESSO=1 npm run site`,
  );
}

/** Diferença em dias entre duas datas `YYYY-MM-DD`, para a mensagem de erro. */
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

exigirAcervoNaoRetrocedido();

// Regenera do zero: parlamentar que sai da bancada tem de sumir do site, e
// deixar página órfã é afirmar que ele ainda está lá.
for (const dir of ["parlamentares", "temas", "senadores"]) {
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

escreverMeta();

escrever("", gerarHome(temas));

const busca = escreverFragmentosDeBusca();
escrever("discursos", gerarBusca(busca));
escrever("imprensa", gerarImprensa());

escrever("parlamentares", gerarIndiceParlamentares());
let paginasDeDiscurso = 0;
let paginasDeEvidencia = 0;
for (const p of parlamentares) {
  escrever(`parlamentares/${slug(p.nome)}`, gerarPerfil(p));
  for (const { ano } of anosDeDiscurso(p.id)) {
    escrever(`parlamentares/${slug(p.nome)}/discursos/${ano}`, gerarDiscursosAno(p, ano));
    paginasDeDiscurso++;
  }
  for (const x of posicoesDe(p.id).filter((y) => !y.tema)) {
    escrever(
      `parlamentares/${slug(p.nome)}/evidencia/${slugEvidencia(x.eixo, x.escopo)}`,
      gerarEvidencia(p, x),
    );
    paginasDeEvidencia++;
  }
}

escrever("senadores", gerarIndiceSenadores(senadores));
for (const p of senadores) {
  escrever(`senadores/${slug(p.nome)}`, gerarPerfilSenador(p));
  for (const x of posicoesDe(p.id).filter((y) => !y.tema)) {
    escrever(
      `senadores/${slug(p.nome)}/evidencia/${slugEvidencia(x.eixo, x.escopo)}`,
      gerarEvidencia(p, x),
    );
    paginasDeEvidencia++;
  }
  for (const { ano } of anosDeDiscurso(p.id)) {
    escrever(`senadores/${slug(p.nome)}/discursos/${ano}`, gerarDiscursosAno(p, ano));
    paginasDeDiscurso++;
  }
}

escrever("temas", gerarIndiceTemas(temas));
for (const t of temas) escrever(`temas/${slug(t.nome)}`, gerarTema(t.nome, t.id));

const linhasNoCsv = escreverCsv();
const urlsNoSitemap = escreverSitemap();

console.log(`site gerado em ${SAIDA}/`);
console.log(`  ${parlamentares.length} deputados · ${senadores.length} senadores · ${temas.length} temas · 3 índices`);
console.log(`  ${paginasDeDiscurso} páginas de discurso (uma por parlamentar e ano)`);
console.log(`  ${paginasDeEvidencia} páginas de evidência (uma por parlamentar, eixo e escopo)`);
console.log(`  sitemap: ${urlsNoSitemap} URLs · robots.txt · base ${BASE_SITE}`);
console.log(`  dados/posicoes.csv: ${linhasNoCsv} linhas`);
console.log(`  busca: ${busca.anos.length} fragmentos, ${(busca.bytes / 1024 / 1024).toFixed(1)} MB antes do gzip`);
console.log(`  período ${periodo.ini} → ${periodo.fim} · metodologia ${metodologia.versao}`);

db.close();
