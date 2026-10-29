// Celular (tela até 780 px): o menu lateral vira uma gaveta aberta pelo botão ☰ do topo (antes ocupava a primeira tela inteira)
// e as tabelas viram cartões, com o nome de cada coluna em cima do valor (os estilos ficam em celular.css).
// O modo corretor tem a própria navegação com abas embaixo e não usa a gaveta.
(function () {
    "use strict";
    const telaPequena = () => !!(window.matchMedia && matchMedia("(max-width: 780px)").matches);

    // Celular em pé: a página é montada um pouco mais estreita (LARGURA_ALVO) e o navegador amplia tudo por igual
    // (letras, botões, ícones), sem a pessoa dar zoom. Deitado, no tablet e no computador fica no tamanho normal.
    const LARGURA_ALVO = 330, ESCALA_MAX = 1.3;
    const VIEWPORT_NORMAL = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    let escalaBase = 1;
    function viewportDesejado() {
        const curto = Math.min(screen.width || 0, screen.height || 0);
        const emPe = !window.matchMedia || matchMedia("(orientation: portrait)").matches;
        if (!curto || curto >= 500 || !emPe) return { conteudo: VIEWPORT_NORMAL, escala: 1 };
        const largura = Math.round(curto / Math.min(ESCALA_MAX, Math.max(1, curto / LARGURA_ALVO)));
        const e = Number((curto / largura).toFixed(3));
        if (e < 1.03) return { conteudo: VIEWPORT_NORMAL, escala: 1 };
        return { conteudo: `width=${largura}, initial-scale=${e}, minimum-scale=${e}, maximum-scale=${e}, user-scalable=no`, escala: e };
    }
    // forcar: volta ao tamanho base se a tela ficou ampliada (o navegador só refaz a escala quando o texto da meta muda)
    function aplicarViewport(forcar) {
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        const d = viewportDesejado();
        escalaBase = d.escala;
        if (forcar) {
            meta.setAttribute("content", d.conteudo.replace(/maximum-scale=([\d.]+)/, (m, v) => `maximum-scale=${v}0`));
            setTimeout(() => meta.setAttribute("content", d.conteudo), 60);
        } else if (meta.getAttribute("content") !== d.conteudo) meta.setAttribute("content", d.conteudo);
    }
    aplicarViewport(false);
    window.addEventListener("orientationchange", () => setTimeout(() => aplicarViewport(false), 200));
    if (window.matchMedia) matchMedia("(orientation: portrait)").addEventListener("change", () => aplicarViewport(false));
    const menuAberto = () => document.body.classList.contains("menu-aberto");
    function abrirMenu(abrir) { document.body.classList.toggle("menu-aberto", !!abrir); }

    function montarGaveta() {
        const topbar = document.querySelector(".topbar"), sidebar = document.querySelector(".sidebar");
        if (!topbar || !sidebar || document.getElementById("menuGavetaBotao")) return;
        const botao = document.createElement("button");
        botao.id = "menuGavetaBotao";
        botao.type = "button";
        botao.className = "menu-gaveta-botao";
        botao.setAttribute("aria-label", "Abrir o menu");
        botao.textContent = "☰";
        botao.addEventListener("click", () => abrirMenu(true));
        topbar.insertBefore(botao, topbar.firstChild);
        const fundo = document.createElement("div");
        fundo.className = "menu-gaveta-fundo";
        fundo.addEventListener("click", () => abrirMenu(false));
        document.body.appendChild(fundo);
        // escolheu uma tela no menu: fecha a gaveta
        sidebar.addEventListener("click", e => { if (e.target.closest("button, a")) setTimeout(() => abrirMenu(false), 60); });
    }

    // cada célula ganha o título da sua coluna (data-r), que aparece em cima do valor quando a linha vira cartão
    function rotularTabelas() {
        if (!telaPequena()) return;
        document.querySelectorAll("table").forEach(tabela => {
            if (tabela.classList.contains("fin-tabela")) return; // o Financeiro já tem os próprios cartões
            const titulos = [ ...tabela.querySelectorAll("thead th") ].map(th => th.textContent.trim());
            if (!titulos.length) return;
            tabela.classList.add("cartoes-celular");
            tabela.querySelectorAll("tbody tr").forEach(tr => {
                [ ...tr.children ].forEach((td, i) => {
                    if (td.tagName === "TD" && !td.hasAttribute("data-r") && !td.hasAttribute("colspan") && titulos[i]) td.setAttribute("data-r", titulos[i]);
                });
            });
        });
    }

    let espera = null;
    function iniciar() {
        montarGaveta();
        rotularTabelas();
        new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(rotularTabelas, 120); })
            .observe(document.body, { childList: true, subtree: true });
        if (window.matchMedia) matchMedia("(max-width: 780px)").addEventListener("change", () => { abrirMenu(false); rotularTabelas(); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

    window.SKLCelular = { menuAberto, fecharMenu: () => abrirMenu(false), escalaBase: () => escalaBase, reaplicarViewport: () => aplicarViewport(true) };
})();
