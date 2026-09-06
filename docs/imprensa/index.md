---
layout: default
kind: prosa
title: "Para jornalistas"
description: "O que estes números dizem, como citá-los, e as cinco maneiras de errar com eles."
---

# Para jornalistas

<p class="subtitulo">Como usar, como citar, e — principalmente — como
<b>não</b> errar com estes números.</p>

## O que este site é

Um registro de **como 31 deputados federais e 3 senadores do
Rio Grande do Sul votaram** na legislatura 57, montado só a
partir das APIs oficiais da Câmara e do Senado. Cada número exibido é
decomponível até a votação que o compõe, com link para o registro na
origem — são 87.244 evidências e 6.619
discursos.

> **O site não classifica ninguém.** Não há nota, ranking, selo ou
> espectro ideológico. Os dois eixos medem coincidência de voto com
> referências declaradas na fonte — a orientação da liderança do Governo
> e a maioria do próprio partido. Nada aqui diz se um voto foi bom.

Isso é limitação deliberada, não falta de ambição: não existe fonte
oficial que classifique parlamentar em espectro ideológico, e atribuir
um seria opinião nossa vestida de dado.

## Cinco maneiras de errar com estes números

Nesta ordem de frequência esperada.

### 1. Ler coesão partidária como fidelidade, disciplina ou qualidade

É o erro mais fácil e o mais grave. **Coesão alta não é virtude.**
Marcel van Hattem (NOVO) tem 99% de coesão; Bohn Gass (PT), 98%. Os dois
quase nunca destoam dos seus, e votam em direções opostas. Uma frase como
"os mais fiéis da bancada" juntaria os dois numa lista que não significa
nada.

O eixo mede **quanto o voto coincidiu com a maioria do próprio partido**,
e nada além disso.

### 2. Comparar coesão entre partidos diferentes

Cada coesão é medida contra a maioria de **um** partido, e são maiorias
diferentes. Dizer que A é mais coeso que B, sendo de legendas distintas,
compara distâncias de dois pontos de referência que não têm relação. É
por isso que a visualização do site separa cada partido em sua faixa: a
comparação inválida foi tornada impossível de desenhar.

### 3. Ler alinhamento com o governo como ideologia

O eixo mede coincidência com a orientação do Executivo **do momento**.
Um partido troca de posição sem mudar uma vírgula do seu programa, e o
mesmo parlamentar mudaria de ponta se o governo mudasse. "Alinhamento com
o governo federal" é o rótulo correto; "esquerda" e "direita", não.

### 4. Comparar número do Senado com número da Câmara

Os universos não se comparam. **68% das votações do Senado são
secretas** — nelas a origem confirma que o senador votou, não como —, e
sobram 117 votações abertas contra
1.125 nominais da Câmara. Além disso, no
Senado **não existe o eixo de alinhamento com o governo**: a Casa não
publica orientação de bancada em dados abertos.

### 5. Usar um percentual sem o `n`

Todo número vem de um número de votações, e os denominadores **variam
entre parlamentares** porque cada um é medido só no seu período de
exercício — suplente que assumiu em 2025 não é "ausente" nas votações de
2023. Nos recortes por tema o `n` cai muito: 100% sobre 3 votações não
é 100%, e o site marca esses casos como amostra pequena.

## Como citar

Uma frase citável tem quatro partes: o número, o que ele mede, o `n` e
o período. Por exemplo:

> O deputado X votou conforme a orientação da liderança do Governo em
> **49,6% das 353 votações nominais de mérito** em que seu voto foi
> computável, entre fevereiro de 2023 e 2026-09-06.

Cada perfil traz esses quatro elementos, e cada percentual é um link
para a decomposição completa — todas as votações que entraram na conta,
uma por linha, com o voto registrado e o link para a fonte oficial.

**Confira antes de publicar.** A decomposição existe justamente para
isso, e um número que você não conseguiu refazer não deveria sair.

## Os dados

| | |
|---|---|
| [posicoes.csv](../dados/posicoes.csv) | Os números de manchete das duas casas, uma linha por parlamentar, eixo e escopo. Separador vírgula, **decimal com ponto**, UTF-8 |
| [Metodologia](../metodologia/) | Como cada número é calculado, com o SQL. Versão `2026-08-11.2` |
| [Fontes](../FONTES) | Os endpoints oficiais usados, o que cada um entrega e onde falha |
| [Repositório](https://github.com/RaulMdrs/bussola-civica) | Código sob MIT. O acervo inteiro é reconstruível com um comando |
{: .t-docs}

O acervo é atualizado automaticamente **duas vezes por semana**, e o
período apurado aparece no rodapé de toda página. Números citados em
matéria devem trazer a data.

## O que o site não tem, e por quê

Declarar limite é parte do método. Nenhum destes é "ainda não fizemos":

| Não existe | Motivo |
|---|---|
| Alinhamento com o governo no Senado | A Casa não publica orientação de bancada em dados abertos. Nove endpoints testados |
| Posição do parlamentar sobre um tema | A fonte diz que a matéria trata do assunto, não se aprová-la o favorece |
| Plano de governo de deputado | Não existe: a exigência do TSE alcança candidatura majoritária |
| Cruzamento de senador com o TSE | Não há CPF na API do Senado, e nome de urna não é chave |
| Voto individual em votação simbólica ou secreta | A origem não o registra — são 82% do plenário da Câmara |
{: .t-docs}

## Contato

Dúvida sobre um número, pedido de recorte ou correção:
[abra uma questão no repositório](https://github.com/RaulMdrs/bussola-civica/issues).
Erro apontado com a votação específica é o mais rápido de verificar —
e, se o erro for nosso, a correção entra no acervo e no registro público
de defeitos.

