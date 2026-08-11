# Versões arquivadas da metodologia

A [metodologia vigente](../) é um documento vivo: descreve sempre a regra em
uso. Este diretório guarda as versões **superadas**, congeladas como estavam
quando produziram números.

Existe por uma razão prática. Toda posição gravada no banco carrega o campo
`metodologia_versao`, e um número calculado sob a `2026-08-04.1` não é
explicado pelo documento que descreve a `2026-08-04.3`. Sem o arquivo, a
rastreabilidade quebraria na primeira mudança de regra — e rastreabilidade é o
que sustenta o princípio do projeto.

## Regra de arquivamento

Quando a metodologia muda:

1. o documento vigente é copiado para cá **sem nenhuma edição**, num diretório
   com o nome da versão que ele descrevia — `2026-08-04.2/index.md`, não
   `2026-08-04.2.md`. Nome de versão é todo ponto, e diretório com `index.md`
   publica numa URL com barra final, sem depender de como o gerador resolve
   extensão;
2. a página viva passa a descrever a versão nova;
3. a tabela de versões da página viva ganha uma linha, com o que mudou.

O endereço é derivado da versão gravada em cada posição, por `urlDaVersao()`
em [`src/calc/posicoes.ts`](https://github.com/RaulMdrs/bussola-civica/blob/main/src/calc/posicoes.ts)
— então basta seguir a convenção do nome para o link existir.

Versão arquivada não se corrige. Se estiver errada, o erro faz parte do
registro: foi sob ela que os números daquele período foram calculados. A
correção entra como versão nova.

## Arquivo

Nenhuma ainda — `2026-08-04.2` é a primeira versão publicada e está vigente.
