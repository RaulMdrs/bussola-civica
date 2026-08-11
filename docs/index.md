# Bússola Cívica

Plataforma que mostra como parlamentares votam, a partir de fontes oficiais.
Fase 0: deputados federais do Rio Grande do Sul, legislatura 57.

> **Princípio inegociável:** nunca rotular político por conta própria. Todo dado
> exibido deriva de fonte oficial e carrega link para ela. O usuário tira a
> conclusão.

---

## [Bancada gaúcha na Câmara →](./parlamentares/)

Os **31 deputados federais do Rio Grande do Sul** na legislatura 57, cada um com
seus dois eixos, os recortes por tema e amostra da evidência que sustenta cada
número — com link para a votação na fonte oficial.

Também por [tema](./temas/): 12 assuntos com votação suficiente para sustentar
um recorte.

## [Metodologia dos eixos →](./metodologia/)

**É por isso que este site existe.** A plataforma exibe números que posicionam
parlamentares, e o princípio acima exige que qualquer pessoa consiga refazer a
conta. A metodologia é um documento vivo; as versões superadas ficam
[arquivadas](./metodologia/versoes/), porque um número calculado sob uma regra
antiga só é explicado pelo documento daquela regra.

Os dois eixos, em uma linha cada:

- **Alinhamento com o governo federal** — proporção de votos conforme a
  orientação da liderança do Governo. Mede posição relativa ao Executivo do
  momento, **não ideologia**.
- **Coesão com o próprio partido** — proporção de votos com a maioria do próprio
  partido, excluído o voto de quem está sendo medido. Mede comportamento, **não
  ideologia**: dois parlamentares de partidos opostos com 100% ocupam o mesmo
  ponto.

Ambos são apurados separadamente no **mérito** das matérias e em votações
**procedimentais** — votar a urgência de um projeto não é votar o projeto.

---

## Documentação técnica

| | |
|---|---|
| [FONTES.md](./FONTES.md) | Reconhecimento das APIs oficiais: 26 endpoints testados, com o que cada um entrega e onde falha |
| [MODELO-DADOS.md](./MODELO-DADOS.md) | Por que o schema tem a forma que tem — as quatro formas de mentir que ele bloqueia |
| [INGESTOR.md](./INGESTOR.md) | Arquitetura de coleta: idempotência, auditoria, retomada incremental |

Código: [github.com/RaulMdrs/bussola-civica](https://github.com/RaulMdrs/bussola-civica) · MIT

O acervo é integralmente reconstruível a partir das fontes oficiais, com um
comando. Nada aqui depende de dado que não possa ser recoletado e conferido.
