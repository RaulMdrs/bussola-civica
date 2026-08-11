# Metodologia dos eixos — Bússola Cívica

> ⚠️ **Versão arquivada.** Esta é a `2026-08-11.1`, **superada** pela
> [`2026-08-11.2`](../../). O que mudou depois: entrou o Senado Federal, com um
> eixo só e escopo próprio. Os eixos da Câmara descritos abaixo não mudaram.

**Versão `2026-08-11.1`** · apurada sobre a legislatura 57
(2023-02-01 → 2026-08-11), Câmara dos Deputados, bancada do Rio Grande do Sul.

Este é o **documento vivo**: descreve sempre a metodologia em vigor. Cada número
exibido pela plataforma carrega a versão da regra que o produziu, e as versões
anteriores ficam em [versoes/](./versoes/). Se um número foi calculado com a
`2026-08-04.2`, é [aquele documento](./versoes/2026-08-04.2/) que o explica —
não este.

---

## O que estes números não são

O projeto tem um princípio inegociável: **nunca rotular político por conta
própria**. Tudo aqui deriva de voto registrado em fonte oficial, e cada valor
pode ser aberto até a votação individual que o compõe, com link para a API da
Câmara.

Em consequência:

- **Não existe eixo "esquerda–direita".** Não há fonte oficial que classifique
  parlamentar em espectro ideológico, e atribuir um seria exatamente o que o
  princípio proíbe.
- **Nenhum eixo mede qualidade, coerência ou desempenho.** Medem
  comportamento de voto, e só.
- **Nenhum eixo tem lado bom.** 100% em qualquer um dos dois não é elogio nem
  acusação; é descrição.

---

## Regras comuns aos dois eixos

Valem para todo cálculo, em todos os escopos:

| Regra | Por quê |
|---|---|
| Só votações **nominais** | Votação simbólica não registra voto individual — a origem devolve lista vazia. São 82% do plenário |
| Só votações **não secretas** | Voto secreto não é atribuível |
| Só votos **`sim`** e **`nao`** | `Obstrução`, `Abstenção`, `Artigo 17` e ausência ficam no acervo, mas não entram na conta (veja abaixo) |
| Denominador **individualizado** | Cada parlamentar é medido apenas nas votações ocorridas dentro do seu período de exercício |
| Toda posição grava **evidência** | Votação por votação, com o link oficial |

### Por que obstrução não vira "voto contra"

`Obstrução` é instrumento regimental: a bancada declara que não participa da
votação para dificultar quórum. Tratá-la como "votou contra" inflaria a
divergência de bancadas minoritárias, que obstruem mais. Ela é registrada como
categoria própria e fica fora do numerador e do denominador.

`Artigo 17` é o voto do presidente da sessão, que só desempata. Também fica
fora.

### Por que o denominador é individualizado

Suplente que assume no meio da legislatura, titular licenciado para exercer
cargo no Executivo, mandato fragmentado — todos teriam menos votações
disponíveis. Um denominador fixo transformaria qualquer um deles em "ausente
contumaz".

Exemplo real: Paulo Pimenta (PT) foi ministro durante parte do período e tem
**272 oportunidades** no escopo de mérito, contra **571** de quem serviu a
legislatura inteira. Os dois são comparáveis porque a fração é calculada sobre o
que cada um pôde votar.

---

## Dois escopos, não um

**536 das 1.117 votações nominais (48%) são sobre requerimentos** — urgência,
retirada de pauta, adiamento, encerramento de discussão. Votar a urgência de um
projeto não é votar o projeto: mede disciplina de pauta e estratégia regimental,
não concordância com o conteúdo.

Somados num índice único, produziam um número que não respondia a pergunta
nenhuma. Separados, revelam comportamento oposto em alguns parlamentares:

| Parlamentar | Mérito | Procedimental |
|---|---|---|
| Marcel van Hattem (NOVO) | 27,8% | 12,5% |
| Marcelo Moraes (PL) | 31,1% | 16,7% |
| Franciane Bayer (REPUBLICANOS) | 57,7% | **64,1%** |

A oposição concorda com o governo em matérias consensuais e diverge
sistematicamente na disputa de pauta. Franciane Bayer faz o inverso: apoia a
pauta mais do que o conteúdo.

**O escopo `merito` é o principal** — é o que se entende por "posição do
parlamentar". O procedimental é exibido como o que é, nunca como substituto.

Distribuição atual das 1.117 nominais: **mérito 571 · procedimental 536 ·
formal 10**. O terceiro grupo (redação final) consolida texto já aprovado, não
expressa posição, e fica fora dos dois escopos.

A classificação deriva de dois sinais oficiais — a descrição padronizada pela
Câmara e a divergência entre o objeto votado e a matéria de fundo. A regra é
revisável sem recoletar nada.

---

## Eixo 1 — alinhamento com o governo federal

Compara o voto do parlamentar com a **orientação da liderança do Governo**,
publicada pela própria Câmara para cada votação.

```sql
SELECT vt.politico_id,
       SUM(CASE WHEN vt.voto = o.orientacao THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS valor,
       COUNT(*) AS n_observacoes
FROM voto vt
JOIN votacao v    ON v.id = vt.votacao_id AND v.nominal = 1 AND v.secreta = 0
                 AND v.natureza = 'merito'          -- ou 'procedimental'
JOIN orientacao o ON o.votacao_id = v.id AND o.sigla_bruta = 'Governo'
                 AND o.liberado = 0 AND o.orientacao IN ('sim','nao')
WHERE vt.computavel = 1
GROUP BY vt.politico_id;
```

Votação em que o Governo libera a bancada (`liberado = 1`) não entra: não há
orientação a comparar.

**Rótulo obrigatório: "alinhamento com o governo federal".** Nunca
"esquerda/direita". O eixo mede posição relativa ao Executivo **do momento** —
um partido troca de lado sem mudar uma vírgula do seu programa, e o mesmo
parlamentar mudaria de ponta se o governo mudasse.

Amplitude atual no mérito: média de **62,6%** entre os 31 parlamentares.

---

## Eixo 2 — coesão com o próprio partido

Não sai da tabela de orientações: **11 dos 12 partidos da bancada nunca orientam
pela própria sigla** — quem orienta é o bloco ou os agregados Governo/Oposição.

Sai dos votos. A posição majoritária do partido é apurada empiricamente em cada
votação, **excluindo o voto do parlamentar que está sendo medido** — senão ele
ajuda a definir a régua contra a qual é comparado.

```sql
WITH cont AS (
  SELECT votacao_id, partido_id,
         SUM(CASE WHEN voto='sim' THEN 1 ELSE 0 END) AS sim,
         SUM(CASE WHEN voto='nao' THEN 1 ELSE 0 END) AS nao
  FROM voto WHERE computavel = 1
  GROUP BY votacao_id, partido_id
)
SELECT vt.politico_id,
       AVG(CASE WHEN vt.voto =
             CASE WHEN (c.sim - (vt.voto='sim')) >= (c.nao - (vt.voto='nao'))
                  THEN 'sim' ELSE 'nao' END
           THEN 1.0 ELSE 0.0 END) AS valor
FROM voto vt
JOIN cont c    ON c.votacao_id = vt.votacao_id AND c.partido_id = vt.partido_id
JOIN votacao v ON v.id = vt.votacao_id AND v.nominal = 1 AND v.secreta = 0
WHERE vt.computavel = 1
GROUP BY vt.politico_id;
```

A maioria é apurada sobre os votos de **toda a bancada nacional** do partido,
não só os do Rio Grande do Sul: a régua é o partido, não a delegação estadual.
Empate entre os pares não gera observação.

**Rótulo obrigatório: "coesão com o próprio partido".** É medida de
comportamento, não de ideologia. **Dois parlamentares de partidos opostos, ambos
com 100%, ocupam o mesmo ponto neste eixo e são politicamente opostos.** Uma
visualização que não deixe isso óbvio engana, e o eixo não deve ser exibido
assim.

Amplitude atual no mérito: de **51,0%** a **99,2%**, média **84,8%**.

---

## Recorte por tema

Desde a versão `2026-08-11.1`, os dois eixos também são apurados **dentro de um
tema**: "alinhamento com o governo federal em Meio Ambiente", "coesão partidária
em Saúde". A metodologia é exatamente a mesma; só o universo de votações muda.

O que isso acrescenta é *onde*, não *quanto*. Um parlamentar com 77% de
alinhamento geral pode ter 32% em Direito Penal — e essa diferença é a
informação, não a média.

### O que o recorte por tema não é

**Não é posição do parlamentar *sobre* o tema.** A Câmara classifica cada
proposição por assunto, e é dela que sai o tema. Mas a fonte diz apenas que a
proposição **trata** de meio ambiente; **não diz se aprová-la protege ou
desprotege**. Sem essa direção, "votou a favor do meio ambiente" é uma frase que
nenhuma fonte oficial sustenta — e atribuí-la seria rotular por conta própria,
que é o que este projeto não faz.

Então o que se mede continua sendo alinhamento com o governo e coesão com o
partido. Dentro do tema.

### Quais temas

Um tema vira recorte quando tem **pelo menos 30 votações nominais de mérito** no
período. Hoje são **12**, dos 32 da classificação oficial. O limiar é do tema,
não do parlamentar: define quais recortes existem, e é aplicado
automaticamente — tema que cruze o limiar depois passa a ter eixo, sem decisão
editorial.

Só no **mérito**. O recorte responde "onde o parlamentar diverge", e "onde" só
faz sentido sobre o conteúdo; disciplina de pauta por tema seria um número sobre
pouquíssimas votações respondendo a pergunta nenhuma.

### O `n` é parte do número

Um tema ter 40 votações não significa que todo parlamentar votou nas 40. Suplente
que assumiu tarde, licença, missão oficial — o `n` individual varia muito dentro
do mesmo tema. Em Viação, Transporte e Mobilidade, há parlamentar com `n = 3`.

**Nada é suprimido**, e por isso o `n` é exibido junto do valor, não como nota
de rodapé. Uma porcentagem sobre 3 votações não é uma porcentagem sobre 3
votações: é uma porcentagem que parece igual a todas as outras. Ao ler qualquer
número temático, leia o `n` antes.

## Como conferir por conta própria

Cada posição é decomposta em evidências — uma linha por votação, com o voto, a
referência comparada e o link para a fonte. São **47.158 evidências** para as
124 posições atuais.

Um exemplo do que a plataforma consegue responder para "por que este
parlamentar está aqui?":

```
Pedro Westphalen divergiu em:
  votação: Aprovada a Emenda de Plenário nº 4. Sim: 150; não: 122; total: 272.
  maioria do partido: nao (5 sim / 18 não entre os pares)
  fonte: https://dadosabertos.camara.leg.br/api/v2/votacoes/2345368-50
```

Todo o acervo é reconstruível a partir das fontes oficiais, com um comando. O
código que produz estes números é aberto:
[`src/calc/posicoes.ts`](https://github.com/RaulMdrs/bussola-civica/blob/main/src/calc/posicoes.ts).

---

## Limitações conhecidas

Declaradas porque afetam a leitura dos números:

1. **A taxa de votações nominais varia muito por período** — 34,2% no 1º
   semestre de 2025, 17,8% na legislatura inteira. Não existe valor de
   referência universal; só faz sentido comparar recortes iguais.
2. **Orientação de bloco não é resolvível em partido.** Quando a liderança é de
   bloco, a origem devolve a sigla truncada e sem identificador. O campo fica
   nulo em vez de ser adivinhado.
3. **O eixo 1 depende de o Governo ter orientado.** Onde não houve orientação, a
   votação não entra — não é tratada como concordância nem como divergência.
4. **Ausência não é medida aqui.** Não votar pode ser licença, missão oficial ou
   falta, e a origem nem sempre distingue. O acervo registra, os eixos não
   interpretam.

---

## Versões

Cada linha de posição no banco carrega o campo `metodologia_versao`. É por ele
que se sabe qual documento explica qual número.

| Versão | Situação | Mudança |
|---|---|---|
| `2026-08-11.1` | **vigente** | Acrescenta o recorte por tema (12 temas, só no mérito). Os dois eixos não mudaram — os valores gerais são idênticos aos da versão anterior |
| [`2026-08-04.2`](./versoes/2026-08-04.2/) | superada | Primeira versão publicada. Introduz a separação entre os escopos `merito` e `procedimental` |

Quando a metodologia mudar, esta página passa a descrever a versão nova e a
anterior é arquivada, sem edição, em [versoes/](./versoes/). Números já
calculados continuam apontando para o documento que os produziu.
