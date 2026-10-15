// Perfil de atuação (corretor) e perfil do cliente: Econômico, Médio padrão, Alto padrão, Rural, Aluguéis, Vendas.
// O imóvel ganha o perfil pela finalidade, por ser rural e pelo padrão do valor (faixas de Configurações).
// O corretor vê primeiro os imóveis que combinam com o perfil dele (continua vendo todos).
// A regra de "combina" é a mesma da função _perfil_combina do banco (usada na roleta).
(function () {
    "use strict";
    const ROTULOS = { economico: "Econômico", medio: "Médio padrão", alto: "Alto padrão", rural: "Rural", locacao: "Aluguéis", venda: "Vendas" };
    const PADRAO = [ "economico", "medio", "alto" ], FINALIDADE = [ "locacao", "venda" ];
    const FAIXAS_PADRAO = { venda: { medio: 350000, alto: 900000 }, locacao: { medio: 2500, alto: 7000 } };
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function faixas() {
        const crm = window.SKLCRM && window.SKLCRM.interno;
        return (crm && typeof crm.faixas === "function" && crm.faixas()) || FAIXAS_PADRAO;
    }
    function padrao(valor, fx) {
        const v = Number(valor);
        if (!(v > 0) || !fx) return null;
        return v >= Number(fx.alto) ? "alto" : v >= Number(fx.medio) ? "medio" : "economico";
    }
    function doImovel(c) {
        if (!c) return [];
        const fx = faixas(), s = new Set();
        if (c.rural) s.add("rural");
        if (c.para_aluguel !== false) { s.add("locacao"); const p = padrao(c.valor_aluguel, fx.locacao); if (p) s.add(p); }
        if (c.para_venda) { s.add("venda"); const p = padrao(c.valor_venda, fx.venda); if (p) s.add(p); }
        return [ ...s ];
    }
    function combina(meus, alvo) {
        const c = meus || [], a = alvo || [];
        if (!c.length || !a.length) return false;
        if (c.includes("rural") && a.includes("rural")) return true;
        if (!c.some(x => a.includes(x)) || !c.some(x => PADRAO.includes(x) || FINALIDADE.includes(x))) return false;
        const grupoOk = grupo => !c.some(x => grupo.includes(x)) || !a.some(x => grupo.includes(x)) || c.some(x => grupo.includes(x) && a.includes(x));
        return grupoOk(PADRAO) && grupoOk(FINALIDADE);
    }
    // Lista em ordem: primeiro os que combinam com o perfil, mantendo a ordem original dentro de cada grupo.
    function ordenar(lista, meus) {
        if (!meus || !meus.length) return lista;
        return lista.map((c, i) => ({ c, i, ok: combina(meus, doImovel(c)) }))
            .sort((x, y) => (y.ok - x.ok) || (x.i - y.i)).map(x => x.c);
    }
    function chips(lista, vazio) {
        const l = (lista || []).filter(p => ROTULOS[p]);
        if (!l.length) return vazio == null ? "" : `<span class="muted-text">${h(vazio)}</span>`;
        return `<span class="perfil-chips">${l.map(p => `<span class="perfil-chip perfil-${p}">${h(ROTULOS[p])}</span>`).join("")}</span>`;
    }
    // Caixas de marcar (dentro de box); ler(box) devolve a lista marcada.
    function editor(box, selecionados) {
        const sel = selecionados || [];
        box.innerHTML = `<div class="perfil-editor">${Object.entries(ROTULOS).map(([ k, r ]) =>
            `<label class="perfil-opcao perfil-${k}"><input type="checkbox" value="${k}" ${sel.includes(k) ? "checked" : ""} /> ${h(r)}</label>`).join("")}</div>`;
    }
    function ler(box) {
        return [ ...box.querySelectorAll(".perfil-editor input:checked") ].map(i => i.value);
    }

    window.SKLPerfis = { ROTULOS, doImovel, combina, ordenar, chips, editor, ler };
})();
