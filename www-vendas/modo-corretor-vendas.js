// Unificado (app Android e link): quem é da Central também abre a tela do corretor de Vendas (mapa, ficha e pedidos),
// quando ela existe ao lado (www-vendas-corretor/). No programa Windows e no app Base avulso o botão não aparece.
(function () {
    "use strict";
    const botao = document.getElementById("modoCorretorVendasButton");
    if (!botao) return;
    const destino = "../www-vendas-corretor/index.html";
    fetch(destino, { cache: "no-store" }).then(r => { if (r.ok) botao.hidden = false; }).catch(() => {});
    botao.addEventListener("click", () => { location.href = destino + location.search; });
})();
