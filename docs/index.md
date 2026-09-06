---
layout: default
kind: home
title: "Bússola Cívica"
description: "Como parlamentares votam, a partir de fontes oficiais rastreáveis."
---

# Bússola Cívica

<p class="subtitulo">Plataforma que mostra como parlamentares votam, a partir de fontes oficiais. Câmara e Senado, bancada do Rio Grande do Sul, <b>57ª legislatura</b>.</p>

> **Princípio inegociável:** nunca rotular político por conta própria.
> Todo dado exibido deriva de fonte oficial e carrega link para ela. O
> usuário tira a conclusão.

## O que foi votado por último

| Data | Votação | Casa |
|---|---|---|
| 2026-09-03 | [PLP 74/2026 — Aprovada a Subemenda Substitutiva ao Projeto de Lei Complementar n](./votacoes/2611313-31/) | <span class="escopo">Câmara</span> |
| 2026-09-03 | [Votação nominal do Projeto de Lei Complementar nº 74, de 2026, nos termos do par](./votacoes/7105/) | <span class="escopo">Senado</span> |
| 2026-09-02 | [PDL 995/2026 — Aprovado o Projeto de Decreto Legislativo nº 995, de 2026 (Aprova](./votacoes/2645346-18/) | <span class="escopo">Câmara</span> |
| 2026-09-01 | [PL 4921/2026 — Aprovado o Requerimento de Urgência (Art. 155 do RICD).](./votacoes/2643915-8/) | <span class="escopo">Câmara</span> |
| 2026-08-12 | [PLP 230/2025 — Aprovado o Substitutivo ao Projeto de Lei Complementar nº 230, de](./votacoes/2580259-24/) | <span class="escopo">Câmara</span> |
{: .t-recentes}

[Todas as 1.242 votações com chamada nominal →](./votacoes/)

O acervo é atualizado **duas vezes por semana**, automaticamente. A
última sessão com votação registrada aqui é de
**2026-09-03**.

## [Deputados federais do Rio Grande do Sul →](./parlamentares/)

Os **31 deputados federais** da legislatura
57, cada um com seus dois eixos, os recortes por tema e amostra
da evidência que sustenta cada número — com link para a votação na fonte
oficial.

Também por [tema](./temas/): **12 assuntos** com votação
suficiente para sustentar um recorte.

## [Senadores do Rio Grande do Sul →](./senadores/)

Os **3 senadores gaúchos**, com coesão partidária apurada
sobre as votações abertas. O universo do Senado é outro —
**117 votações abertas** contra
1.125 nominais da Câmara — e lá existe **um eixo
só**: não há orientação de bancada em dados abertos, então o alinhamento com
o governo não é calculável.

## [Metodologia dos eixos →](./metodologia/)

**É por isso que este site existe.** A plataforma exibe números que
posicionam parlamentares, e o princípio acima exige que qualquer pessoa
consiga refazer a conta. A metodologia é um documento vivo — hoje na versão
`2026-08-11.2` — e as versões superadas ficam
[arquivadas](./metodologia/versoes/), porque um número calculado sob uma
regra antiga só é explicado pelo documento daquela regra.

Os dois eixos, em uma linha cada:

- **Alinhamento com o governo federal** — proporção de votos conforme a
  orientação da liderança do Governo. Mede posição relativa ao Executivo do
  momento, **não ideologia**.
- **Coesão com o próprio partido** — proporção de votos com a maioria do
  próprio partido, excluído o voto de quem está sendo medido. Mede
  comportamento, **não ideologia**: dois parlamentares de partidos opostos
  com 100% ocupam o mesmo ponto.

Ambos são apurados separadamente no **mérito** das matérias e em votações
**procedimentais** — votar a urgência de um projeto não é votar o projeto.

## Documentação técnica

| Documento | O que traz |
|---|---|
| [Votações](./votacoes/) | Cada votação com chamada nominal recuperável, e como a bancada gaúcha votou em cada uma |
| [Para jornalistas](./imprensa/) | Como citar, os dados em CSV, e as cinco maneiras de errar com estes números |
| [FONTES](./FONTES) | Reconhecimento das APIs oficiais: o que cada endpoint entrega e onde falha |
| [MODELO-DADOS](./MODELO-DADOS) | Por que o schema tem a forma que tem — as formas de mentir que ele bloqueia |
| [INGESTOR](./INGESTOR) | Arquitetura de coleta: idempotência, auditoria, retomada incremental |
{: .t-docs}

Código: [github.com/RaulMdrs/bussola-civica](https://github.com/RaulMdrs/bussola-civica) · MIT

O acervo é integralmente reconstruível a partir das fontes oficiais, com um
comando. Nada aqui depende de dado que não possa ser recoletado e conferido.
