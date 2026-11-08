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
            if (tabela.closest(".ind-doc")) return;               // relatório de impressão dos Indicadores: tabela normal
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

    // Menu no celular (Configurações → Minha conta → Aparência no celular): "gaveta" (☰, padrão) ou "topo"
    // (logo, telas em botões que deslizam para o lado e o nome da pessoa logo abaixo). Vale só neste aparelho.
    const CHAVE_MENU = "sklu_alug_menu_celular";
    let menuModo = "gaveta";
    try { menuModo = localStorage.getItem(CHAVE_MENU) === "topo" ? "topo" : "gaveta"; } catch {}
    function aplicarMenu(modo, guardar) {
        menuModo = modo === "topo" ? "topo" : "gaveta";
        if (guardar) { try { localStorage.setItem(CHAVE_MENU, menuModo); } catch {} }
        document.body.classList.toggle("menu-topo", menuModo === "topo");
        if (menuModo === "topo") abrirMenu(false);
        document.querySelectorAll('input[name="menuCelular"]').forEach(r => { r.checked = r.value === menuModo; });
        centralizarAtivo();
    }
    // no menu do topo, o botão da tela aberta fica à vista (a faixa rola sozinha até ele)
    function centralizarAtivo() {
        if (menuModo !== "topo" || !telaPequena()) return;
        const nav = document.getElementById("mainNav"), ativo = nav && nav.querySelector(".nav-button.active");
        if (ativo) nav.scrollTo({ left: Math.max(0, ativo.offsetLeft - (nav.clientWidth - ativo.offsetWidth) / 2), behavior: "smooth" });
    }
    function ligarAparencia() {
        document.querySelectorAll('input[name="menuCelular"]').forEach(r => r.addEventListener("change", () => {
            if (r.checked) aplicarMenu(r.value, true);
        }));
        const nav = document.getElementById("mainNav");
        if (nav) new MutationObserver(() => setTimeout(centralizarAtivo, 50)).observe(nav, { subtree: true, attributes: true, attributeFilter: [ "class" ] });
        aplicarMenu(menuModo, false);
    }

    let espera = null;
    function iniciar() {
        montarGaveta();
        ligarAparencia();
        rotularTabelas();
        new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(rotularTabelas, 120); })
            .observe(document.body, { childList: true, subtree: true });
        if (window.matchMedia) matchMedia("(max-width: 780px)").addEventListener("change", () => { abrirMenu(false); rotularTabelas(); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

    // "Travar a tela em pé" ou "deitada" (Configurações → Funções da imobiliária): no celular e no tablet, na posição errada
    // aparece um aviso para virar. O navegador só trava de verdade no app instalado (screen.orientation.lock); no resto, o aviso cobre a tela.
    // A escolha ("retrato", "paisagem" ou nada) fica guardada no aparelho para valer já na tela de entrada.
    const CHAVE_TRAVA = "sklu_alug_travar_tela";
    let travada = null;
    try { const v = localStorage.getItem(CHAVE_TRAVA); travada = v === "1" || v === "retrato" ? "retrato" : v === "paisagem" ? "paisagem" : null; } catch {}
    const aparelhoDeToque = () => !!(window.matchMedia && matchMedia("(pointer: coarse)").matches) && Math.min(screen.width || 0, screen.height || 0) < 1100;
    const deitado = () => !!(window.matchMedia && matchMedia("(orientation: landscape)").matches);
    function conferirGiro() {
        let aviso = document.getElementById("gireAviso");
        const mostrar = !!travada && aparelhoDeToque() && (travada === "retrato" ? deitado() : !deitado());
        if (mostrar && !aviso && document.body) {
            aviso = document.createElement("div");
            aviso.id = "gireAviso"; aviso.className = "gire-aviso"; aviso.setAttribute("role", "alert");
            document.body.appendChild(aviso);
        }
        if (mostrar) aviso.innerHTML = travada === "retrato"
            ? "<b>📱</b><strong>Vire o aparelho para a posição em pé</strong><small>O sistema foi ajustado para ser usado na vertical. A imobiliária pode mudar isso em Configurações → Funções da imobiliária.</small>"
            : "<b>📱</b><strong>Vire o aparelho para a posição deitada</strong><small>O sistema foi ajustado para ser usado na horizontal. A imobiliária pode mudar isso em Configurações → Funções da imobiliária.</small>";
        if (aviso) aviso.hidden = !mostrar;
    }
    // modo: "retrato" (em pé), "paisagem" (deitada) ou nada (livre); true vale como "retrato"
    function travarTela(modo) {
        travada = modo === true || modo === "retrato" ? "retrato" : modo === "paisagem" ? "paisagem" : null;
        try { travada ? localStorage.setItem(CHAVE_TRAVA, travada) : localStorage.removeItem(CHAVE_TRAVA); } catch {}
        if (travada && aparelhoDeToque() && screen.orientation && screen.orientation.lock) screen.orientation.lock(travada === "retrato" ? "portrait" : "landscape").catch(() => {});
        if (!travada && screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch {} }
        conferirGiro();
    }
    if (window.matchMedia) matchMedia("(orientation: landscape)").addEventListener("change", conferirGiro);
    window.addEventListener("orientationchange", () => setTimeout(conferirGiro, 150));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => travarTela(travada)); else travarTela(travada);

    window.SKLCelular = { menuAberto, fecharMenu: () => abrirMenu(false), menuModo: () => menuModo, aplicarMenu, escalaBase: () => escalaBase, reaplicarViewport: () => aplicarViewport(true), travarTela };
})();
