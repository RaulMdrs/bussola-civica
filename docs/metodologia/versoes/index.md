---
layout: default
kind: prosa
title: "Versões arquivadas da metodologia"
description: "As regras superadas, congeladas como estavam quando produziram números."
---

# Versões arquivadas da metodologia

A [metodologia vigente](../) é um documento vivo: descreve sempre a regra em
uso. Este diretório guarda as versões **superadas**, congeladas como estavam
quando produziram números.

Existe por uma razão prática. Toda posição gravada no banco carrega o campo
`metodologia_versao`, e um número calculado sob a `2026-08-04.2` não é
explicado pelo documento que descreve a `2026-08-11.1`. Sem o arquivo, a
rastreabilidade quebraria na primeira mudança de regra — e rastreabilidade é o
que sustenta o princípio do projeto.

## Regra de arquivamento

Quando a metodologia muda:

1. o documento vigente é copiado para cá num diretório com o nome da versão que
   ele descrevia — `2026-08-04.2/index.md`, não `2026-08-04.2.md`. Nome de
   versão é todo ponto, e diretório com `index.md` publica numa URL com barra
   final, sem depender de como o gerador resolve extensão;
2. acrescenta-se no topo um **aviso de versão superada**, com link para a
   vigente, uma linha sobre o que mudou, e a ressalva de que os links do corpo
   apontam para os caminhos de quando aquela página era o documento vivo — com
   link para o arquivo e para a vigente, que é a navegação que o leitor precisa.
   **É a única alteração permitida** — o corpo do documento fica congelado;
3. a página viva passa a descrever a versão nova;
4. a tabela de versões da página viva ganha uma linha, com o que mudou.

O aviso do passo 2 existe porque o leitor pode chegar direto à página arquivada,
por link antigo ou por busca, e precisa saber em uma linha que está lendo regra
que não vale mais. Sem ele, o arquivo deixaria de ser registro e viraria
armadilha.

> A primeira redação desta regra dizia "copiado sem nenhuma edição". Não
> sobreviveu ao primeiro arquivamento real: uma página arquivada sem aviso é
> indistinguível da vigente para quem chega de fora. A regra foi corrigida aqui,
> na página viva — que é onde regra se corrige.
>
> A ressalva sobre links entrou depois, por outro motivo prático: arquivar move
> o documento de endereço, e todo link relativo do corpo passa a apontar para o
> lugar errado. Corrigi-los seria editar o corpo. Não corrigi-los, sem avisar,
> deixaria o leitor clicando em nada. O aviso resolve os dois: o corpo continua
> byte a byte como estava, e a navegação de que o leitor precisa está no topo.

O endereço é derivado da versão gravada em cada posição, por `urlDaVersao()`
em [`src/calc/posicoes.ts`](https://github.com/RaulMdrs/bussola-civica/blob/main/src/calc/posicoes.ts)
— então basta seguir a convenção do nome para o link existir.

**O corpo de uma versão arquivada não se corrige.** Se estiver errado, o erro
faz parte do registro: foi sob ele que os números daquele período foram
calculados. A correção entra como versão nova, nunca por edição retroativa.

## Arquivo

| Versão | Vigorou até | O que mudou depois |
|---|---|---|
| [`2026-08-04.2`](./2026-08-04.2/) | 2026-08-11 | Acrescentou-se o recorte por tema. Os dois eixos não mudaram: os valores são idênticos nas duas versões |
| [`2026-08-11.1`](./2026-08-11.1/) | 2026-08-12 | Entrou o Senado Federal, com um eixo só e escopo próprio. Nada da Câmara mudou |
