/**
 * Busca nos discursos — Bússola Cívica
 *
 * Único JavaScript do site. Escrito à mão, sem dependência, sem build, como a
 * folha de estilo. Uma biblioteca de busca traria mais bytes que o acervo que
 * ela procuraria.
 *
 * O que ele faz: baixa os fragmentos por ano sob demanda, casa os termos
 * digitados contra o sumário publicado pela Câmara e devolve os discursos que
 * contêm todos eles. **Não classifica nada.** Não infere assunto, não agrupa
 * por tema, não ordena por relevância inventada — ordena por data, que é o que
 * a fonte traz. Casar palavra que o parlamentar disse é o oposto de rotular.
 *
 * Nada essencial depende deste arquivo: sem ele a página continua listando
 * todos os parlamentares e seus anos.
 */
(function () {
  "use strict";

  var form = document.getElementById("busca");
  var campo = document.getElementById("q");
  var protocolares = document.getElementById("protocolares");
  var estado = document.getElementById("estado");
  var saida = document.getElementById("resultados");
  var metaTag = document.getElementById("busca-meta");
  if (!form || !campo || !saida || !metaTag) return;

  var meta = JSON.parse(metaTag.textContent);
  var TETO = 60; // resultados exibidos; o total sempre é declarado
  var fragmentos = null; // preenchido na primeira busca
  var carregando = null;

  /** Idêntica a `dobrar()` no gerador. Se divergirem, a busca mente. */
  function dobrar(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function texto(s) {
    return document.createTextNode(s);
  }

  function elemento(tag, classe) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    return e;
  }

  /**
   * Destaque por nó de texto, nunca por innerHTML: o sumário é texto de
   * terceiro, e montá-lo como marcação deixaria a página à mercê do que a
   * origem publicar. Mesmo motivo do escape no gerador.
   */
  function destacar(sumario, dobrado, termos) {
    var frag = document.createDocumentFragment();
    var marcas = [];
    termos.forEach(function (t) {
      var i = dobrado.indexOf(t);
      while (i !== -1) {
        marcas.push([i, i + t.length]);
        i = dobrado.indexOf(t, i + t.length);
      }
    });
    if (!marcas.length) return frag.appendChild(texto(sumario)), frag;

    marcas.sort(function (a, b) {
      return a[0] - b[0];
    });
    var unidas = [marcas[0]];
    for (var k = 1; k < marcas.length; k++) {
      var ultimo = unidas[unidas.length - 1];
      if (marcas[k][0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], marcas[k][1]);
      else unidas.push(marcas[k]);
    }

    var pos = 0;
    unidas.forEach(function (m) {
      if (m[0] > pos) frag.appendChild(texto(sumario.slice(pos, m[0])));
      var mark = document.createElement("mark");
      mark.appendChild(texto(sumario.slice(m[0], m[1])));
      frag.appendChild(mark);
      pos = m[1];
    });
    if (pos < sumario.length) frag.appendChild(texto(sumario.slice(pos)));
    return frag;
  }

  function carregar() {
    if (fragmentos) return Promise.resolve(fragmentos);
    if (carregando) return carregando;
    estado.textContent = "Baixando o índice…";
    carregando = Promise.all(
      meta.anos.map(function (ano) {
        return fetch("../busca/" + ano + ".json").then(function (r) {
          if (!r.ok) throw new Error("falha ao baixar o índice de " + ano);
          return r.json().then(function (j) {
            j.ano = ano;
            return j;
          });
        });
      }),
    )
      .then(function (todos) {
        // Dobra uma vez, ao carregar. O gerador não envia esta coluna: enviá-la
        // pronta dobrava o download, e dobrar aqui custa milissegundos.
        todos.forEach(function (f) {
          f.b = f.s.map(dobrar);
        });
        fragmentos = todos;
        return todos;
      });
    return carregando;
  }

  function bloco(f, i, termos) {
    var pessoa = meta.p[f.p[i]];
    var nome = pessoa ? pessoa[0] : "parlamentar não identificado";
    var caminho = pessoa
      ? meta.base + pessoa[1] + "/discursos/" + f.ano + "/#d-" + f.id[i]
      : null;

    var bq = elemento("blockquote", "evidencia discurso");
    var data = elemento("span", "data");
    data.appendChild(texto(f.d[i]));
    bq.appendChild(data);

    var corpo = elemento("div", "corpo");

    var quem = elemento("p", "quem");
    var forte = document.createElement("b");
    forte.appendChild(texto(nome));
    quem.appendChild(forte);
    if (pessoa && pessoa[2]) quem.appendChild(texto(" · " + pessoa[2]));
    if (f.t[i]) quem.appendChild(texto(" · " + f.t[i]));
    if (!f.r[i]) {
      var etiqueta = elemento("span", "protocolar");
      etiqueta.appendChild(texto("protocolar"));
      quem.appendChild(texto(" "));
      quem.appendChild(etiqueta);
    }
    corpo.appendChild(quem);

    var p = document.createElement("p");
    p.appendChild(destacar(f.s[i], f.b[i], termos));
    corpo.appendChild(p);

    if (caminho) {
      var link = elemento("a", "fonte");
      link.href = caminho;
      link.appendChild(texto("Ver o discurso na página do parlamentar"));
      corpo.appendChild(link);
    }

    bq.appendChild(corpo);
    return bq;
  }

  function buscar() {
    var bruto = campo.value.trim();
    saida.textContent = "";
    if (bruto.length < 3) {
      estado.textContent = bruto
        ? "Digite ao menos 3 letras."
        : "O índice pesa cerca de " + meta.kb + " KB comprimido e só é " +
          "baixado quando você busca a primeira vez.";
      return;
    }

    var termos = dobrar(bruto).split(/\s+/).filter(Boolean);

    carregar().then(
      function (todos) {
        var achados = [];
        todos.forEach(function (f) {
          for (var i = 0; i < f.b.length; i++) {
            if (!f.r[i] && !protocolares.checked) continue;
            var ok = true;
            for (var t = 0; t < termos.length; t++) {
              if (f.b[i].indexOf(termos[t]) === -1) {
                ok = false;
                break;
              }
            }
            if (ok) achados.push([f, i]);
          }
        });

        achados.sort(function (a, b) {
          return a[0].d[a[1]] < b[0].d[b[1]] ? 1 : -1;
        });

        if (!achados.length) {
          estado.textContent =
            'Nenhum discurso com "' + bruto + '" no sumário publicado pela Câmara.';
          return;
        }

        estado.textContent =
          achados.length === 1
            ? "1 discurso encontrado."
            : achados.length.toLocaleString("pt-BR") + " discursos encontrados." +
              (achados.length > TETO ? " Mostrando os " + TETO + " mais recentes." : "");

        var frag = document.createDocumentFragment();
        achados.slice(0, TETO).forEach(function (par) {
          frag.appendChild(bloco(par[0], par[1], termos));
        });
        saida.appendChild(frag);
      },
      function (erro) {
        estado.textContent =
          "Não foi possível baixar o índice (" + erro.message + "). " +
          "A lista por parlamentar abaixo continua funcionando.";
      },
    );
  }

  var espera;
  function agendar() {
    clearTimeout(espera);
    espera = setTimeout(buscar, 200);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    buscar();
  });
  campo.addEventListener("input", agendar);
  protocolares.addEventListener("change", buscar);

  // Permite chegar com a busca pronta por link: /discursos/?q=enchente
  var inicial = new URLSearchParams(location.search).get("q");
  if (inicial) {
    campo.value = inicial;
    buscar();
  }
})();
