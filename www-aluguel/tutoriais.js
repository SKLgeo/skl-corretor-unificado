// Menu lateral → Tutoriais: KB — Knowledge Base (base de conhecimento) com todos os POPs do sistema.
// Conteúdo: kb/indice.js (window.SKL_KB) e kb/<código>.html, gerados por docs/unificado/pops/gerar_kb.js a partir dos POPs oficiais.
// Abre cada POP dentro do app (janela com o documento), com busca, filtro por área e impressão/PDF. Disponível para todos os papéis.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const lista = () => Array.isArray(window.SKL_KB) ? window.SKL_KB : [];
    let area = "", termo = "", montado = false;

    function montar() {
        const pagina = $("tutoriaisPagina");
        if (!pagina || montado) return;
        montado = true;
        const total = lista().length;
        const areas = [ ...new Set(lista().map(t => t.area)) ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        pagina.innerHTML = `
          <div class="panel kb-cabecalho">
            <span class="eyebrow">KB · KNOWLEDGE BASE</span>
            <h2>KB — Knowledge Base</h2>
            <p class="kb-sub">Base de conhecimento da SKL Gestão Imobiliária: os <b>Procedimentos Operacionais Padrão (POP)</b> de cada tarefa,
              com passo a passo, imagens e pontos de atenção — para que cada procedimento seja feito sempre do mesmo jeito, por qualquer pessoa da equipe.</p>
            <div class="kb-numeros"><span><b>${total}</b> procedimentos</span><span><b>${areas.length}</b> áreas</span><span>Atualizada com o sistema</span></div>
            <label class="kb-busca"><span class="visually-hidden">Buscar na KB</span>
              <input id="kbBusca" type="search" placeholder="Buscar: contrato, comissão, portal, foto, senha…" autocomplete="off"></label>
            <div class="kb-areas" id="kbAreas">
              <button type="button" class="kb-chip ativo" data-area="">Todas</button>
              ${areas.map(a => `<button type="button" class="kb-chip" data-area="${h(a)}">${h(a)}</button>`).join("")}
            </div>
          </div>
          <div id="kbLista" class="kb-lista"></div>`;
        if (!$("kbDialog")) {
            const d = document.createElement("dialog");
            d.id = "kbDialog";
            d.className = "kb-dialog";
            d.innerHTML = `<div class="kb-dialog-barra"><div class="kb-dialog-titulo"><span id="kbDialogCodigo" class="kb-codigo"></span><strong id="kbDialogTitulo"></strong></div>
                <div class="kb-dialog-acoes"><button type="button" class="secondary-button" id="kbImprimir">🖨 Imprimir / PDF</button>
                <button type="button" class="secondary-button" id="kbFechar" aria-label="Fechar">✕</button></div></div>
              <iframe id="kbQuadro" title="Tutorial" loading="lazy"></iframe>`;
            document.body.appendChild(d);
            $("kbFechar").addEventListener("click", () => d.close());
            $("kbImprimir").addEventListener("click", () => { try { $("kbQuadro").contentWindow.print(); } catch { window.open($("kbQuadro").src, "_blank"); } });
            d.addEventListener("close", () => { $("kbQuadro").src = "about:blank"; });
        }
        $("kbBusca").addEventListener("input", e => { termo = e.target.value; desenhar(); });
        $("kbAreas").addEventListener("click", e => {
            const b = e.target.closest("[data-area]"); if (!b) return;
            area = b.dataset.area;
            $("kbAreas").querySelectorAll(".kb-chip").forEach(x => x.classList.toggle("ativo", x === b));
            desenhar();
        });
        desenhar();
    }
    function desenhar() {
        const q = norm(termo).split(/\s+/).filter(Boolean);
        const itens = lista().filter(t => (!area || t.area === area) && q.every(p => t.busca.includes(p) || norm(t.codigo).includes(p)));
        const grupos = {};
        for (const t of itens) (grupos[t.area] = grupos[t.area] || []).push(t);
        const nomes = Object.keys(grupos).sort((a, b) => a.localeCompare(b, "pt-BR"));
        $("kbLista").innerHTML = itens.length ? nomes.map(g => `
          <section class="kb-grupo"><h3>${h(g)} <small>${grupos[g].length}</small></h3>
            <div class="kb-cartoes">${grupos[g].map(t => `
              <button type="button" class="kb-cartao" data-kb="${h(t.codigo)}">
                <span class="kb-codigo">${h(t.codigo)}</span>
                <strong>${h(t.titulo)}</strong>
                <span class="kb-objetivo">${h(t.objetivo)}</span>
                <span class="kb-rodape"><span>📍 ${h(t.modulo.replace(/^SKL Gestão Imobiliária\s*·\s*/i, ""))}</span><span>Vigência ${h(t.vigencia)}</span></span>
              </button>`).join("")}</div></section>`).join("")
            : `<p class="kb-vazio">Nenhum tutorial encontrado para “${h(termo)}”. Tente outra palavra (ex.: contrato, portal, comissão, foto).</p>`;
        $("kbLista").querySelectorAll("[data-kb]").forEach(b => b.addEventListener("click", () => abrir(b.dataset.kb)));
    }
    function existe(codigo) { return lista().some(t => t.codigo === codigo); }
    function abrir(codigo) {
        montar();
        const t = lista().find(x => x.codigo === codigo);
        if (!t) return false;
        $("kbDialogCodigo").textContent = t.codigo;
        $("kbDialogTitulo").textContent = t.titulo;
        $("kbQuadro").src = `kb/${encodeURIComponent(t.codigo)}.html`;
        const d = $("kbDialog");
        if (!d.open) d.showModal();
        return true;
    }
    function aoMostrar() { montar(); }
    window.SKLTutoriais = { aoMostrar, abrir, existe };
})();
