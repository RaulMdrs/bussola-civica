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

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  return d.urlTexto && !diarioAusente(d.urlTexto)
    ? `<a class="fonte" href="${esc(d.urlTexto)}">Ver no Diário da Câmara</a>`
    : `<a class="fonte" href="${esc(d.fonte)}">Ver na API da Câmara</a>`;
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
    md += `| <span class="valor">${pct(x.valor)}%</span> `;
    md += `| <span class="n-detalhe">${x.n} <span>votações computáveis</span></span>`;
    md += `<span class="n-detalhe">${x.opo} <span>votações no exercício</span></span> |\n`;
  }
  md += `{: .t-eixos}\n\n`;

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
  md += `Esta é uma amostra. A decomposição completa existe no acervo, votação por\n`;
  md += `votação, e é reconstruível a partir das fontes oficiais.\n\n`;

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

  md += `São **${total} discursos** coletados no período, dos quais\n`;
  md += `**${substantivos} substantivos** — os outros ${total - substantivos} são\n`;
  md += `orientação de bancada e registro de presença, que a classificação separa\n`;
  md += `do perfil e **não descarta**: estão nas páginas por ano, na íntegra.\n\n`;

  md += `O que aparece abaixo é o sumário publicado pela Câmara. O texto integral\n`;
  md += `não é reproduzido aqui — o link de cada discurso leva à fonte que o publicou.\n\n`;

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
    "Procure uma palavra nos discursos dos deputados federais gaúchos, pelo sumário publicado pela Câmara.",
    "busca",
  );

  md += `# Buscar nos discursos\n\n`;
  md += `<p class="subtitulo">Procura a palavra no <b>sumário publicado pela\n`;
  md += `Câmara</b> — o texto da fonte, não uma classificação nossa. São\n`;
  md += `<b>${milhar(totalDiscursos)} discursos</b> de ${parlamentares.length} `;
  md += `deputados.</p>\n\n`;

  // Metadados pequenos vão inline: 31 nomes e slugs. Evita uma requisição a
  // mais antes da primeira tecla.
  const meta = {
    base: "../parlamentares/",
    p: Object.fromEntries(parlamentares.map((p) => [p.id, [p.nome, slug(p.nome), p.sigla ?? ""]])),
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
  md += `abaixo continua inteira: cada parlamentar, cada ano, todos os\n`;
  md += `discursos, com link para a fonte.</p>\n`;
  md += `</div>\n`;
  md += `</noscript>\n\n`;

  md += `## Todos os parlamentares, por ano\n\n`;
  md += `Esta lista não depende de script, e é a mesma navegação que existia\n`;
  md += `antes da busca.\n\n`;
  md += `| Parlamentar | Discursos | Anos |\n|---|---:|---|\n`;
  for (const p of parlamentares) {
    const anosDele = anosDeDiscurso(p.id);
    const total = anosDele.reduce((s, a) => s + a.n, 0);
    md += `| [${p.nome}](../parlamentares/${slug(p.nome)}/) | ${contagem(total)} | `;
    md += anosDele.length
      ? anosDele
          .map((a) => `[${a.ano}](../parlamentares/${slug(p.nome)}/discursos/${a.ano}/)`)
          .join(" · ")
      : "—";
    md += ` |\n`;
  }
  md += `{: .t-busca}\n\n`;

  md += `<script id="busca-meta" type="application/json">${JSON.stringify(meta)}</script>\n`;
  md += `<script src="../assets/busca.js" defer></script>\n`;

  return md;
}

/** Uma página por parlamentar e ano. O porquê está no bloco no topo do arquivo. */
function gerarDiscursosAno(p: Parlamentar, ano: string): string {
  const substantivos = discursosDoAno(p.id, ano, 1);
  const protocolares = discursosDoAno(p.id, ano, 0);
  const anos = anosDeDiscurso(p.id);

  let md = frontMatter(
    `${p.nome} — discursos de ${ano}`,
    `Os discursos de ${p.nome} em ${ano}, com o sumário publicado pela Câmara e link para o Diário.`,
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

  md += `> O que segue é o **sumário publicado pela Câmara**, sem edição — nada aqui\n`;
  md += `> é resumo nosso. O texto integral não é reproduzido neste site: o link de\n`;
  md += `> cada discurso leva ao **Diário da Câmara**, onde ele está publicado, ou à\n`;
  md += `> **API** quando a origem não publicou o discurso no Diário.\n\n`;

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
    md += `| <span class="valor">${pct(x.valor)}%</span> `;
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

function gerarIndiceParlamentares(): string {
  let md = frontMatter(
    "Deputados federais do Rio Grande do Sul",
    "Os 31 deputados federais do Rio Grande do Sul: alinhamento com o governo e coesão partidária, a partir de votações nominais.",
    "indice",
  );
  md += `# Deputados federais do Rio Grande do Sul\n\n`;
  md += `<p class="subtitulo">${parlamentares.length} parlamentares da legislatura 57, `;
  md += `em ordem alfabética. A ordem é navegação, não classificação.</p>\n\n`;

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

escrever("parlamentares", gerarIndiceParlamentares());
let paginasDeDiscurso = 0;
for (const p of parlamentares) {
  escrever(`parlamentares/${slug(p.nome)}`, gerarPerfil(p));
  for (const { ano } of anosDeDiscurso(p.id)) {
    escrever(`parlamentares/${slug(p.nome)}/discursos/${ano}`, gerarDiscursosAno(p, ano));
    paginasDeDiscurso++;
  }
}

escrever("senadores", gerarIndiceSenadores(senadores));
for (const p of senadores) escrever(`senadores/${slug(p.nome)}`, gerarPerfilSenador(p));

escrever("temas", gerarIndiceTemas(temas));
for (const t of temas) escrever(`temas/${slug(t.nome)}`, gerarTema(t.nome, t.id));

console.log(`site gerado em ${SAIDA}/`);
console.log(`  ${parlamentares.length} deputados · ${senadores.length} senadores · ${temas.length} temas · 3 índices`);
console.log(`  ${paginasDeDiscurso} páginas de discurso (uma por parlamentar e ano)`);
console.log(`  busca: ${busca.anos.length} fragmentos, ${(busca.bytes / 1024 / 1024).toFixed(1)} MB antes do gzip`);
console.log(`  período ${periodo.ini} → ${periodo.fim} · metodologia ${metodologia.versao}`);

db.close();
