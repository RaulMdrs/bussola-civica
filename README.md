# Bússola Cívica

Ecossistema cívico que ajuda o cidadão brasileiro a entender as conexões entre
políticos, partidos e posicionamentos — a partir de **dados oficiais
rastreáveis**, nunca de rótulos atribuídos.

> **Princípio inegociável.** A plataforma não classifica ninguém como "de
> esquerda" ou "de direita". Todo posicionamento exibido deriva de comportamento
> registrado (votações nominais) e carrega link para a fonte oficial. O usuário
> tira a conclusão.

**Fase atual:** 0 — deputados federais do Rio Grande do Sul.
Backend funcional (coleta, modelo e cálculo). Web e app ainda não iniciados.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [CHECKPOINT.md](docs/CHECKPOINT.md) | **Comece aqui** — estado consolidado, metodologias, endpoints, lacunas |
| [FONTES.md](docs/FONTES.md) | Reconhecimento das APIs, com request/response verificados |
| [MODELO-DADOS.md](docs/MODELO-DADOS.md) | Schema e as decisões que o motivaram |
| [INGESTOR.md](docs/INGESTOR.md) | Coleta, normalização e classificação |

**Site publicado:** <https://raulmdrs.github.io/bussola-civica/> — perfis dos 31
parlamentares, recortes por tema e a metodologia.

## Fontes

- **Câmara dos Deputados** — [dadosabertos.camara.leg.br](https://dadosabertos.camara.leg.br)
- **Senado Federal** — [legis.senado.leg.br/dadosabertos](https://legis.senado.leg.br/dadosabertos) *(Fase 1)*
- **TSE** — [dadosabertos.tse.jus.br](https://dadosabertos.tse.jus.br), via CSV de candidaturas

Todas públicas, gratuitas e sem autenticação.

## Como rodar

Requer **Node 22.6+** (`node:sqlite` nativo chegou no 22.5, o type-stripping no
22.6; sem passo de build). Declarado em `engines` — `npm install` avisa se a
versão não servir, em vez de falhar depois com erro obscuro de sintaxe.

```bash
npm install
```

```bash
npm run ingerir -- --inicio 2025-01-01 --fim 2025-06-30
```

Cria `data/bussola.db` e coleta o período. Um semestre leva ~9 min (~700
requisições contra uma API instável, com retry); a legislatura inteira
(`--inicio 2023-02-01`) leva **~91 min** e produz um banco de ~80 MB com 6.291
votações e 452 mil votos. Re-execuções usam cache.

```bash
npm run ingerir:incremental
```

Continua de onde a última coleta parou — descobre a data no próprio banco, não
precisa de argumento. É o comando da manutenção periódica.

```bash
npm run relatorio
```

Confere o acervo contra os números medidos no reconhecimento e imprime os dois
eixos.

```bash
npm run site
```

Gera o site estático em `docs/` a partir do banco: 31 perfis, 12 temas e 2
índices. Rode após cada `ingerir:incremental` — o diff mostra o que mudou nos
números.

```bash
npm run db:validar
```

74 verificações do modelo contra casos de borda reais.

### Etapas isoladas

```bash
npm run ingerir -- --etapas votacoes --inicio 2025-07-01 --fim 2025-12-31
```

Etapas: `referencias`, `deputados`, `votacoes`, `proposicoes`, `discursos`,
`reclassificar`, `tse`, `posicoes`. Todas idempotentes.

A etapa `tse` cruza a bancada com as candidaturas de 2022 por CPF (31/31) e
baixa um CSV de 4 MB. Não entra no `ingerir:incremental`: eleição é anual, não
semanal.

## Os dois eixos

Ambos derivam de votação nominal; nenhum usa rótulo atribuído.
**Metodologia completa: <https://raulmdrs.github.io/bussola-civica/metodologia/>**
— documento vivo, com as versões superadas arquivadas.

**Alinhamento com o governo federal** — proporção de votos conforme a orientação
da liderança do Governo. Mede posição relativa ao Executivo do momento, **não
ideologia**: um partido muda de lado sem mudar de programa.

**Coesão com o próprio partido** — proporção de votos com a maioria dos demais
deputados da legenda, excluído o próprio voto da apuração. Mede comportamento:
dois parlamentares de partidos opostos com 100% ocupam o mesmo ponto.

Cada posição é decomposta votação por votação em `posicao_evidencia`, com link
oficial — "por que este político está aqui?" é sempre respondível.

## Dados

O banco **não guarda CPF**. Ele é a única chave confiável de reconciliação entre
Câmara e TSE, mas é chave de junção, não dado a exibir — então o que entra é o
`HMAC-SHA256` do CPF, com segredo em `.env` (veja `.env.example`). A junção
funciona igual, aplicando o mesmo HMAC aos dois lados.

Hash sem segredo não serviria: CPF tem 11 dígitos, e 10¹¹ combinações se
percorrem em segundos. Perder o segredo não perde dado — `npm run ingerir --
--etapas deputados` traz os CPFs da origem e re-deriva tudo.

O banco **não é versionado** mesmo assim: é artefato de build, 80 MB, e
integralmente reconstruível com `npm run ingerir`. Não sincronize a pasta
`data/` por Dropbox, OneDrive ou similar — SQLite com WAL corrompe em pasta de
sincronização.

## Licença

Código sob [MIT](LICENSE).

Os dados vêm de fontes públicas oficiais (Câmara, Senado, TSE) e não são
cobertos por esta licença — ao redistribuí-los, mantenha a atribuição à fonte,
como o próprio modelo faz via `fonte_url`.
