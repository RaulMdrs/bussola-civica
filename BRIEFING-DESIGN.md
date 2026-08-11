# Briefing de design — Bússola Cívica

Documento para ser colado no Claude Design. Escrito para quem não conhece o
projeto: tudo que é necessário está aqui.

O retorno esperado é **HTML + CSS**, não imagem. A seção final explica o
formato.

---

## 1. O que é

Plataforma cívica brasileira que mostra **como parlamentares votam**, a partir
de dados oficiais do Congresso Nacional. Hoje cobre os 31 deputados federais e
os 3 senadores do Rio Grande do Sul, na legislatura 57 (2023–2027).

O público é **cidadão comum**, não jornalista nem cientista político. A pessoa
chega pelo nome de um parlamentar — provavelmente por busca, provavelmente no
celular — e quer entender um número que viu.

Site estático, hospedado no GitHub Pages. Hoje usa o tema padrão do GitHub, sem
estilo próprio: legível para quem já entende do assunto, opaco para o resto. É
esse problema que o design resolve.

## 2. O princípio que governa tudo

> **Nunca rotular político por conta própria.** Todo dado exibido deriva de
> fonte oficial rastreável, e carrega link para ela. O leitor tira a conclusão.

Isto não é um valor de marca. É a restrição técnica central do produto, e o
design pode violá-la com mais eficiência do que qualquer bug — porque violaria
de forma bonita.

Três coisas que o site **mede**:

- **Alinhamento com o governo federal** — em que proporção o voto do
  parlamentar coincidiu com a orientação declarada pela liderança do Governo
  naquela votação. Mede posição relativa ao Executivo do momento.
- **Coesão com o próprio partido** — em que proporção votou com a maioria do
  próprio partido, excluído o voto de quem está sendo medido.
- Ambos, separadamente, no **mérito** das matérias e em votações
  **procedimentais** (votar a urgência de um projeto não é votar o projeto).

Três coisas que o site **não mede, e o design não pode sugerir que meça**:
ideologia, qualidade e desempenho.

O caso que torna isso concreto: **coesão de 100% não é virtude.** Dois
parlamentares de partidos opostos, votando em direções contrárias, podem ambos
ter 100% de coesão. Qualquer escala visual que vá de "ruim" a "bom" está
mentindo sobre o que o número significa.

## 3. Restrições de design inegociáveis

Estas não são preferências. São a tradução do princípio acima para a tela.

**O `n` é conteúdo, não metadado.** Todo percentual nasce de um número de
votações — o `n`. Um alinhamento de 83,3% sobre 24 votações e um de 100% sobre
3 votações não são comparáveis, e o segundo é quase ruído. O `n` **não pode**
virar tooltip, legenda cinza, nota de rodapé ou texto de 11px. Onde aparece a
porcentagem, aparece o `n`, com peso visual suficiente para ser lido antes de
qualquer decisão.

**Link para a fonte é elemento de primeira classe.** Cada evidência aponta para
a votação na API oficial da Câmara ou do Senado. Nunca reduzir a um ícone sem
rótulo, nunca esconder atrás de hover — no celular não existe hover.

**Nada de cor ideológica ou avaliativa.** Sem eixo vermelho↔azul, sem verde para
alto e vermelho para baixo, sem semáforo, sem emoji de aprovação. Alinhamento de
27,8% não é pior que 97,5% — é diferente. A cor pode diferenciar *eixos* e
*seções*; não pode ordenar *pessoas*.

**Sem ranking implícito.** As tabelas são ordenadas por valor porque isso ajuda
a leitura, mas o design não deve acrescentar pódio, medalha, posição numerada,
ou destacar topo e base. Ordenação é navegação, não julgamento.

**O aviso de amostra pequena (⚠️, n < 20) precisa de peso visual real.** O
padrão da indústria é opacidade reduzida, que faz o aviso desaparecer
exatamente quando mais importa. Aqui ele tem de competir com o número, não
sumir atrás dele.

**Nenhum parlamentar recebe destaque editorial.** Sem "em foco", "mais
alinhado", "destaque da semana". A ordem alfabética do índice é uma decisão de
neutralidade, não uma limitação a corrigir.

**As ressalvas em prosa não são enfeite.** O site tem vários blocos de texto
explicando o que um número não significa — eles são parte do produto e precisam
de tratamento tipográfico que convide à leitura, não de um estilo de "aviso
legal" que ensina o leitor a pular.

## 4. Restrições técnicas

- **Jekyll no GitHub Pages.** O conteúdo é gerado em Markdown por um script e
  convertido pelo Jekyll. O design vive em `_layouts/*.html` + um CSS. O HTML do
  corpo (tabelas, títulos, listas, blockquotes) é o que o Markdown produz — o
  design estiliza essa saída, não inventa marcação nova dentro do conteúdo.
- **Zero JavaScript** nesta etapa, e **zero dependência externa**: sem CDN, sem
  Google Fonts, sem framework CSS. Preferir *system font stack*. Se uma fonte
  for essencial ao conceito, ela precisa ser autohospedada e justificada.
- **CSS escrito à mão**, sem build step. O projeto inteiro tem uma única
  dependência de runtime, por decisão. Não introduzir Tailwind, Sass ou similar.
- **Mobile-first de verdade.** As tabelas de 5 colunas são o problema central de
  layout: precisam funcionar em 360px de largura sem scroll horizontal da
  página. Solução esperada em nível de design, não "deixa rolar".
- **Modo claro e escuro** via `prefers-color-scheme`.
- **Acessibilidade** — contraste AA no mínimo. É serviço de informação pública;
  parte do público lê com leitor de tela ou com fonte aumentada.

## 5. Inventário de páginas

Sete tipos, em ordem de importância.

### 5.1 Perfil de deputado (31 páginas) — a página mais importante

É onde a maioria das visitas termina. Estrutura real, com dados reais:

**Cabeçalho:** nome (`Afonso Hamm`), partido (`PP`), cargo (`deputado federal
pelo RS`), condição (`titular`), início do exercício (`2023-02-01`).

**Bloco "Os dois eixos"** — tabela de 4 linhas:

| Eixo | Escopo | Valor | Observações |
|---|---|---:|---|
| Alinhamento com o governo federal | merito | **49,0%** | 349 de 571 votações |
| Alinhamento com o governo federal | procedimental | **50,2%** | 307 de 536 votações |
| Coesão com o próprio partido | merito | **70,3%** | 445 de 571 votações |
| Coesão com o próprio partido | procedimental | **67,5%** | 388 de 536 votações |

Os dois números da última coluna são diferentes entre si e ambos importam: o
primeiro é em quantas votações o voto foi computável, o segundo quantas
ocorreram no período de exercício daquele parlamentar. Por isso os
denominadores variam de perfil para perfil — e o design não pode esconder essa
variação normalizando tudo em "de 100".

**Bloco "Alinhamento com o governo, por tema"** — até 12 linhas, ordenadas por
valor decrescente. Cada linha: nome do tema (link), percentual, `n`, e ⚠️ quando
`n < 20`:

| Tema | Alinhamento | n |
|---|---:|---:|
| Indústria, Comércio e Serviços | 83,3% | 24 |
| Energia, Recursos Hídricos e Minerais | 75,0% | 28 |
| Trabalho e Emprego | 61,1% | 18 ⚠️ |
| Finanças Públicas e Orçamento | 50,3% | 179 |
| Direito Penal e Processual Penal | 20,0% | 20 |

Vem precedido de uma ressalva que precisa ser lida: *não é posição sobre o
tema* — a fonte diz que a matéria trata do assunto, não se aprová-la o favorece.

**Bloco "Por que estes números"** — a decomposição, e o que sustenta o
princípio. Para cada eixo, uma amostra de até 3 votações em que o parlamentar
**divergiu**. Cada item traz data, descrição da votação, a referência que
explica a divergência, e o link oficial:

> **2026-05-20** · Resultado. Sim: 182; Não: 182; Abstenção: 2; Total: 366.
> Orientação do Governo: nao · [fonte oficial](https://dadosabertos.camara.leg.br/api/v2/votacoes/2613731-65)

> **2026-05-06** · Mantido o texto. Sim: 343; Não: 97; Abstenção: 1; Total: 441.
> Maioria do partido: sim (29 sim / 8 não entre os pares) · [fonte oficial](…)

As descrições vêm da fonte oficial e são secas, longas e cheias de números.
Não dá para reescrevê-las — é justamente o texto original que torna o dado
verificável. O design precisa torná-las escaneáveis assim como são.

**Rodapé** (em todas as páginas): período apurado, versão da metodologia com
link, e a ressalva final de que nenhum eixo mede ideologia, qualidade ou
desempenho.

### 5.2 Índice de deputados

Tabela de 31 linhas, ordem alfabética, 5 colunas: nome (link), partido,
alinhamento, coesão, `n`. É a tabela mais difícil no celular.

| Parlamentar | Partido | Alinhamento c/ governo | Coesão partidária | n |
|---|---|---:|---:|---:|
| Afonso Hamm | PP | 49,0% | 70,3% | 349 |
| Alexandre Lindenmeyer | PT | 96,0% | 96,6% | 374 |
| Bibo Nunes | PL | 32,8% | 95,0% | 399 |
| Marcel van Hattem | NOVO | 27,8% | 99,2% | 399 |
| Paulo Pimenta | PT | 97,5% | 98,4% | 200 |

Os partidos aparecem por sigla: PP, PT, PL, MDB, PSD, PSDB, PDT, PSOL, PCdoB,
NOVO, UNIÃO, REPUBLICANOS. **Não usar as cores oficiais dos partidos** — isso
reintroduz a leitura ideológica pela porta dos fundos.

### 5.3 Perfil de senador (3 páginas)

Igual ao de deputado, com duas diferenças que o design precisa acomodar:

- **Um eixo só.** Não há alinhamento com o governo, porque o Senado não publica
  orientação de bancada em dados abertos. O layout não pode parecer quebrado ou
  incompleto por isso — a ausência é informação, não falha.
- **Um aviso de incomparabilidade** que aparece *antes* da tabela, no corpo, e
  não em rodapé: o Senado tem 114 votações abertas contra 1.117 nominais da
  Câmara, porque 68% das votações do Senado são secretas. O risco real não é o
  número estar errado — é o leitor comparar 88% de senador com 88% de deputado.
  Este bloco precisa de tratamento visual forte o bastante para interromper.

### 5.4 Índice de senadores

Tabela de 3 linhas, mesmo aviso no topo.

### 5.5 Página de tema (12 páginas)

Ranking da bancada dentro de um tema. Cada linha: parlamentar (link), sigla,
uma **barra** de proporção, percentual, `n` com ⚠️. Hoje a barra é feita de
caracteres `█` e `·` — é o lugar mais óbvio para um elemento visual de verdade,
desde que não vire escala avaliativa.

Ao final, quando aplicável: *"7 de 31 parlamentares têm menos de 20 votações
neste tema. Nesses casos a porcentagem é frágil e o `n` é a informação mais
importante da linha."*

### 5.6 Índice de temas

12 linhas: tema (link), número de votações, média da bancada.

### 5.7 Home e metodologia

A **home** apresenta o projeto, o princípio, e leva aos três índices.

A **metodologia** é um documento longo, em prosa, com fórmulas e tabelas — é a
página que sustenta a credibilidade de todas as outras. Precisa de tratamento de
leitura longa: medida de linha confortável, hierarquia clara, sumário. Existe
também um arquivo de versões antigas da metodologia, cada uma com um aviso de
"versão superada" no topo, que precisa de um estilo próprio e reconhecível.

## 6. Duas páginas que ainda não existem

Serão construídas depois, sobre este mesmo design. Vale considerá-las agora
para o sistema não precisar ser refeito.

**Discursos.** Há 4.947 discursos substantivos coletados, classificados e com
link para o Diário da Câmara. Campos: data e hora, tipo (`PELA ORDEM`,
`BREVES COMUNICAÇÕES`, …), sumário, transcrição completa, e link para o Diário.
Um parlamentar chega a ter 124 discursos, e o conjunto soma 9,9 MB de
transcrição — então a página exige recorte, com acesso ao acervo inteiro. Um
discurso tem sumário curto e transcrição longa; ambos precisam caber.

**Evidência completa.** Hoje o perfil mostra 3 votações de amostra. Existem
86.315 evidências no acervo, e a promessa de "por que este político está aqui?"
só fecha quando todas forem alcançáveis. Uma página paginada por eixo, com
muitas linhas de votação, cada uma com data, descrição, referência e link.

## 7. Tom

Serviço público, não startup cívica. Sóbrio, denso, confiável — mais próximo de
um relatório bem tipografado do que de um dashboard. O leitor deve sair com a
impressão de que os números foram apurados com cuidado e podem ser conferidos,
não de que são um produto.

Referências úteis de atitude: a tipografia de jornal impresso de qualidade, e a
clareza de documentação técnica bem feita. Nada de gradiente, glassmorphism,
card flutuante, número gigante isolado ou ilustração decorativa.

## 8. O que entregar

1. **Um CSS único**, comentado, com variáveis para cor, espaçamento e
   tipografia, cobrindo os elementos que o Markdown gera: `h1`–`h4`, `p`,
   `table`, `blockquote`, `ul`, `a`, `code`, `strong`, `hr`.
2. **Um layout HTML** com cabeçalho de navegação, área de conteúdo e rodapé,
   marcando onde entra o conteúdo da página.
3. **Duas telas de exemplo** em HTML completo, com os dados reais deste
   documento: o **perfil de deputado** e o **índice de deputados** — as duas
   páginas que decidem se o design funciona.
4. Cada tela em **360px e em desktop**.

O tratamento das tabelas no celular e o tratamento do `n` são os dois pontos em
que este design é aprovado ou reprovado.
