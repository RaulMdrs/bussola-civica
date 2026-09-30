/**
 * Achador da home — Bússola Cívica
 *
 * Segundo e último JavaScript do site. À mão, sem dependência, sem build.
 *
 * **Ele não busca nada.** As 34 linhas já vieram escritas no HTML pelo gerador:
 * este arquivo só esconde as que não casam com o que foi digitado. Nada é
 * baixado, nada é montado, nada é ordenado.
 *
 * Sem ele, a home mostra a bancada inteira em ordem alfabética — que é um
 * destino legítimo, não um erro. É por isso que o campo começa vazio e a
 * tabela começa completa: o estado inicial da página é o estado sem script.
 *
 * O que ele deliberadamente **não** faz, e não deve passar a fazer: ordenar por
 * valor, somar ou tirar média por partido. Filtrar é recortar quem se quer ver;
 * ordenar por valor seria produzir ranking, que este projeto não produz.
 */
(function () {
  "use strict";

  var nome = document.getElementById("ache-nome");
  var partido = document.getElementById("ache-partido");
  var lista = document.getElementById("ache-lista");
  var estado = document.getElementById("ache-estado");
  if (!nome || !partido || !lista || !estado) return;

  var linhas = [].slice.call(lista.tBodies[0].rows);

  /** Idêntica à do gerador, que escreveu `data-nome`. Divergir é não achar. */
  function dobrar(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function filtrar() {
    var termo = dobrar(nome.value.trim());
    var sigla = partido.value;
    var visiveis = 0;

    linhas.forEach(function (tr) {
      var casa =
        (!termo || tr.getAttribute("data-nome").indexOf(termo) !== -1) &&
        (!sigla || tr.getAttribute("data-sigla") === sigla);
      tr.hidden = !casa;
      if (casa) visiveis++;
    });

    // O estado é sempre declarado, inclusive quando não há nada: lista que
    // encolhe sem dizer por quê parece site quebrado.
    if (visiveis === linhas.length) {
      estado.textContent = linhas.length + " parlamentares.";
    } else if (visiveis === 0) {
      estado.textContent =
        "Nenhum parlamentar" +
        (termo ? ' com "' + nome.value.trim() + '"' : "") +
        (sigla ? " no " + sigla : "") +
        ". A bancada aqui é só a do Rio Grande do Sul.";
    } else {
      estado.textContent =
        (visiveis === 1 ? "1 parlamentar" : visiveis + " parlamentares") +
        " de " + linhas.length + ".";
    }
  }

  nome.addEventListener("input", filtrar);
  partido.addEventListener("change", filtrar);
  // `type=search` no iOS dispara o X de limpar como `search`, não `input`.
  nome.addEventListener("search", filtrar);

  // Permite chegar filtrado por link: /?partido=PL
  var inicial = new URLSearchParams(location.search);
  var q = inicial.get("nome");
  var p = inicial.get("partido");
  if (q) nome.value = q;
  if (p) {
    // Só aceita sigla que existe no select — parâmetro de URL é entrada de
    // terceiro, e atribuir valor livre deixaria a lista vazia sem explicação.
    var opcoes = [].map.call(partido.options, function (o) { return o.value; });
    if (opcoes.indexOf(p) !== -1) partido.value = p;
  }
  if (q || p) filtrar();
})();
