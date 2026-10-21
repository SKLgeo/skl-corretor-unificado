// Painel visual da imobiliária (botão "📊 Painel" no topo, só Central/admin/gestor/financeiro). Abre por cima do app,
// em tela cheia, e mostra os números do período em cartões: VGV, negócios, comissões por mês, calendário de vencimentos,
// margem, metas da equipe, venda × locação, VGC por corretor, pendências (com baixa e data programada ali mesmo),
// despesas por plano de contas (barras ou pizza), funil de conversão com meta e segmento que mais fecha.
// Cada quadro tem os próprios botões de período (semana, mês, trimestre, ano...); o seletor do topo muda todos.
// Os números vêm das mesmas funções do Financeiro e das Metas (fin_indicadores_imobiliaria, metas_painel) e dos
// negócios carregados pelo CRM. Gráficos em SVG desenhados aqui (sem biblioteca), com dica ao passar o mouse e tabela.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // cores da marca do cliente (as mesmas do app: --navy = principal, --gold = destaque); s3 = a principal mais clara
    const COR = { s1: "#003E67", s2: "#FF7433", s3: "#4F86B0" };
    function hex(c) { const m = String(c || "").trim().match(/^#([0-9a-f]{6})$/i); return m ? "#" + m[1] : null; }
    function clarear(c, t) { const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, f = x => Math.round(x + (255 - x) * t).toString(16).padStart(2, "0"); return "#" + f(r) + f(g) + f(b); }
    function coresDaMarca() {
        const css = getComputedStyle(document.documentElement);
        const p = hex(css.getPropertyValue("--navy")) || COR.s1, d = hex(css.getPropertyValue("--gold")) || COR.s2;
        COR.s1 = p; COR.s2 = d; COR.s3 = clarear(p, 0.38);
        const raiz = $("painelGestao");
        raiz.style.setProperty("--pg-s1", COR.s1); raiz.style.setProperty("--pg-s2", COR.s2); raiz.style.setProperty("--pg-s3", COR.s3);
    }
    const MESES = [ "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez" ];
    let ctx = null, montado = false, periodo = "ano", filtro = "todos", ultimo = null, redesenhar = null;
    let per = {};                  // período escolhido em cada quadro (sem escolha = o do topo)
    let indCache = new Map();      // fin_indicadores_imobiliaria por período
    let modoTabela = {}, modoDesp = "barras", abaPend = "receber", mesSeg = "";
    const PERIODOS = [ [ "semana", "Semana" ], [ "mes", "Mês" ], [ "trimestre", "Trim." ], [ "ano", "Ano" ], [ "12m", "12 m" ], [ "tudo", "Tudo" ] ];
    const PERIODOS_SEG = [ [ "12m", "12 meses" ], [ "24m", "24 meses" ], [ "tudo", "Tudo" ], [ "mesames", "Mês a mês" ] ];

    const pode = () => !!ctx && ctx.veTudo();
    const dinheiro = v => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function curto(v) {
        const n = Number(v || 0), a = Math.abs(n);
        if (a >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
        if (a >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
        return "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    }
    const pct = v => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "%";
    function hojeIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    const dataBr = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
    const isoLocal = t => { const d = new Date(t); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        if (!montado) { montar(); montado = true; }
        const b = $("painelAbrir");
        if (b) b.hidden = !pode();
        const w = $("instaladorWindows");
        if (w) w.hidden = !(pode() && podeBaixarWindows());
        if (!pode()) fechar();
    }
    // botão "Baixar programa para Windows": só para a Central, no navegador de um computador Windows
    // (não dentro do próprio programa) e só se o cliente tiver programa (marca.instalador_windows, do json do cliente)
    function podeBaixarWindows() {
        const url = window.SKL_MARCA && window.SKL_MARCA.instalador_windows;
        const ua = navigator.userAgent || "";
        return !!url && /Windows NT/i.test(ua) && !/Electron/i.test(ua);
    }
    function montar() {
        const area = document.querySelector(".connection-area");
        if (area && window.SKL_MARCA && window.SKL_MARCA.instalador_windows) {
            const a = document.createElement("a");
            a.id = "instaladorWindows"; a.className = "secondary-button"; a.hidden = true;
            a.href = window.SKL_MARCA.instalador_windows; a.rel = "noopener";
            a.textContent = "💻 Baixar programa para Windows";
            a.title = "Instala o sistema no computador (abre direto, sem navegador, e se atualiza sozinho)";
            area.insertBefore(a, area.firstChild);
        }
        if (area) {
            const b = document.createElement("button");
            b.id = "painelAbrir"; b.type = "button"; b.className = "secondary-button"; b.textContent = "📊 Painel"; b.hidden = true;
            b.title = "Abrir o painel com os números da imobiliária";
            b.addEventListener("click", abrir);
            area.insertBefore(b, area.firstChild);
        }
        const p = document.createElement("div");
        p.id = "painelGestao"; p.className = "pg-raiz"; p.hidden = true;
        p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Painel da imobiliária");
        p.innerHTML = `<div class="pg-moldura">
            <nav class="pg-lateral" aria-label="Filtro do painel">
              <span class="pg-marca"><img src="logo-symbol.png" alt="" /></span>
              <button type="button" class="pg-ico ativo" data-pg-filtro="todos" title="Tudo">⌂<span>Tudo</span></button>
              <button type="button" class="pg-ico" data-pg-filtro="venda" title="Só vendas">🏷️<span>Vendas</span></button>
              <button type="button" class="pg-ico" data-pg-filtro="locacao" title="Só locações">🔑<span>Locação</span></button>
              <span class="pg-espaco"></span>
              <button type="button" class="pg-ico" data-pg-fechar title="Fechar o painel">⟵<span>Fechar</span></button>
            </nav>
            <div class="pg-conteudo">
              <header class="pg-topo">
                <div class="pg-titulo"><img id="pgLogo" class="pg-logo" alt="" hidden /><div><span class="pg-sobre">PAINEL DA IMOBILIÁRIA</span><h1 id="pgTitulo">Visão geral</h1></div></div>
                <div class="pg-topo-acoes">
                  <select id="pgPeriodo" aria-label="Período">
                    <option value="semana">Esta semana</option><option value="mes">Este mês</option><option value="trimestre">Este trimestre</option>
                    <option value="ano" selected>Este ano</option><option value="12m">Últimos 12 meses</option><option value="tudo">Todo o período</option>
                  </select>
                  <button type="button" class="pg-fechar" data-pg-fechar aria-label="Fechar">×</button>
                </div>
              </header>
              <div id="pgGrade" class="pg-grade"><p class="pg-carregando">Carregando…</p></div>
            </div>
          </div>
          <div id="pgDica" class="pg-dica" hidden></div>`;
        document.body.appendChild(p);
        p.querySelectorAll("[data-pg-fechar]").forEach(b => b.addEventListener("click", fechar));
        p.querySelectorAll("[data-pg-filtro]").forEach(b => b.addEventListener("click", () => {
            filtro = b.dataset.pgFiltro;
            p.querySelectorAll("[data-pg-filtro]").forEach(x => x.classList.toggle("ativo", x === b));
            if (ultimo) desenhar(ultimo);
        }));
        $("pgPeriodo").addEventListener("change", () => { periodo = $("pgPeriodo").value; per = {}; carregar(); });
        document.addEventListener("keydown", e => { if (e.key === "Escape" && !p.hidden) fechar(); });
        let t = null;
        window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (!p.hidden && redesenhar) redesenhar(); }, 150); });
    }
    function abrir() {
        if (!pode()) return;
        $("painelGestao").hidden = false;
        document.documentElement.classList.add("pg-aberto");
        coresDaMarca();
        const nome = (window.SKL_MARCA && window.SKL_MARCA.nome) || (ctx.carteiraNome && ctx.carteiraNome()) || "";
        $("pgTitulo").textContent = nome || "Visão geral";
        // logo do cliente no topo (a versão para fundo claro, quando o cliente tem)
        const logo = $("pgLogo");
        logo.onload = () => { logo.hidden = false; };
        logo.onerror = () => { logo.hidden = true; };
        if (!logo.getAttribute("src")) logo.src = "logo-fundo-claro.png";
        carregar();
    }
    function fechar() {
        const p = $("painelGestao");
        if (p) p.hidden = true;
        document.documentElement.classList.remove("pg-aberto");
        dica(null);
    }

    // ------------------------------------------------------------------ dados
    const pad = n => String(n).padStart(2, "0");
    const fimMes = (ano, mes) => `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}`;
    function intervaloDe(p) {
        const hoje = hojeIso(), [ a, m ] = hoje.split("-").map(Number);
        if (p === "semana") { // segunda a domingo
            const d = new Date(hoje + "T12:00:00"), dow = (d.getDay() + 6) % 7;
            const seg = new Date(d.getTime() - dow * 86400000), dom = new Date(seg.getTime() + 6 * 86400000);
            return [ isoLocal(seg), isoLocal(dom) ];
        }
        if (p === "mes") return [ `${a}-${pad(m)}-01`, fimMes(a, m) ];
        if (p === "trimestre") { const t = Math.floor((m - 1) / 3); return [ `${a}-${pad(t * 3 + 1)}-01`, fimMes(a, t * 3 + 3) ]; }
        if (p === "ano") return [ `${a}-01-01`, `${a}-12-31` ];
        if (p === "12m" || p === "24m") { const n = p === "12m" ? 12 : 24, d = new Date(a, m - n, 1); return [ `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, fimMes(a, m) ]; }
        if (/^\d{4}-\d{2}$/.test(p)) { const [ aa, mm ] = p.split("-").map(Number); return [ `${p}-01`, fimMes(aa, mm) ]; }
        return [ "2000-01-01", "2100-12-31" ];
    }
    const perDe = id => per[id] || periodo;
    const rotuloPer = p => ({ semana: "esta semana", mes: "este mês", trimestre: "este trimestre", ano: "este ano", "12m": "últimos 12 meses", "24m": "últimos 24 meses", tudo: "todo o período" })[p]
        || (/^\d{4}-\d{2}$/.test(p) ? new Date(p + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "");
    async function indicadores(p) {
        const [ ini, fim ] = intervaloDe(p), k = ini + "|" + fim;
        if (!indCache.has(k)) {
            indCache.set(k, ctx.sb.rpc("fin_indicadores_imobiliaria", { p_carteira: ctx.carteiraId(), p_ini: ini, p_fim: fim })
                .then(r => { if (r.error) { indCache.delete(k); throw r.error; } return r.data || {}; }));
        }
        return indCache.get(k);
    }
    async function carregar() {
        const grade = $("pgGrade");
        grade.innerHTML = `<p class="pg-carregando">Carregando…</p>`;
        indCache = new Map();
        const hoje = new Date();
        const tri = Math.floor(hoje.getMonth() / 3) + 1;
        let ind;
        try { ind = await indicadores(periodo); } catch (e) { grade.innerHTML = `<p class="pg-carregando">${h(ctx.traduzErro(e.message))}</p>`; return; }
        const met = await ctx.sb.rpc("metas_painel", { p_carteira: ctx.carteiraId(), p_ano: hoje.getFullYear(), p_trimestre: tri });
        if (window.SKLFinGestao && window.SKLFinGestao.carregar) await window.SKLFinGestao.carregar();
        ultimo = { ind, metas: met.data || null, tri };
        desenhar(ultimo);
    }
    // negócios ganhos (do CRM) com finalidade, comissão total (a da divisão ou a estimada, igual ao banco) e imóvel
    function negocios() {
        const I = window.SKLCRM && window.SKLCRM.interno;
        if (!I) return [];
        const regra = window.SKLComissoes && (window.SKLComissoes.regras() || []).find(r => r.padrao);
        const hon = regra && regra.honorarios_venda_pct != null ? Number(regra.honorarios_venda_pct) : 6;
        return [ ...I.negs.values() ].filter(n => n.situacao === "ganha" && n.fechado_em).map(n => {
            const f = I.funil(n.funil_id), fin = f && f.finalidade;
            const vgc = n.comissao_total != null ? Number(n.comissao_total) : fin === "venda" ? Number(n.valor || 0) * hon / 100 : Number(n.valor || 0);
            return { id: n.id, fin, dia: isoLocal(n.fechado_em), valor: Number(n.valor || 0), vgc, neg: n };
        }).filter(n => n.fin === "venda" || n.fin === "locacao");
    }
    function mesesDoPeriodo(ini, fim, lista) {
        let [ a, m ] = ini.split("-").map(Number);
        if (ini === "2000-01-01") { // todo o período: do primeiro negócio até hoje
            const prim = lista.map(n => n.dia).sort()[0] || hojeIso();
            [ a, m ] = prim.split("-").map(Number);
        }
        const [ af, mf ] = (fim > hojeIso() ? hojeIso() : fim).split("-").map(Number);
        const out = [];
        while ((a < af || (a === af && m <= mf)) && out.length < 60) { out.push(`${a}-${pad(m)}`); m++; if (m > 12) { m = 1; a++; } }
        return out.length ? out : [ hojeIso().slice(0, 7) ];
    }
    // eixo do tempo: dias na semana e no mês, meses nos períodos maiores
    function eixo(p, ini, fim, lista) {
        if (p === "semana" || p === "mes" || /^\d{4}-\d{2}$/.test(p)) {
            const dias = [];
            for (let t = new Date(ini + "T12:00:00"); isoLocal(t) <= fim && dias.length < 31; t = new Date(t.getTime() + 86400000)) dias.push(isoLocal(t));
            const sem = [ "dom", "seg", "ter", "qua", "qui", "sex", "sáb" ];
            return { chaves: dias, rotulo: k => p === "semana" ? sem[new Date(k + "T12:00:00").getDay()] : String(Number(k.slice(8))), de: dia => dia };
        }
        const meses = mesesDoPeriodo(ini, fim, lista);
        return { chaves: meses, rotulo: mm => { const [ a, m ] = mm.split("-").map(Number); return MESES[m - 1] + (meses.length > 12 || a !== new Date().getFullYear() ? "/" + String(a).slice(2) : ""); }, de: dia => dia.slice(0, 7) };
    }

    // ------------------------------------------------------------------ desenho
    function chips(id, opcoes, atual) {
        return `<div class="pg-per" role="group" aria-label="Período deste quadro">${opcoes.map(([ v, r ]) =>
            `<button type="button" data-per-card="${id}" data-per="${v}" aria-pressed="${v === atual}">${h(r)}</button>`).join("")}</div>`;
    }
    function cartao(id, classe, titulo, extra, comPeriodo) {
        return `<section class="pg-cartao ${classe || ""}" id="${id}"><header><h2>${h(titulo)}</h2>${extra || ""}</header>${comPeriodo ? chips(id, PERIODOS, perDe(id)) : ""}<div class="pg-corpo"></div></section>`;
    }
    function botaoTabela(id) { return `<button type="button" class="pg-tab" data-tabela="${id}" aria-pressed="${modoTabela[id] ? "true" : "false"}">${modoTabela[id] ? "◔ gráfico" : "≡ tabela"}</button>`; }
    const corpo = id => $(id) && $(id).querySelector(".pg-corpo");
    let desenhos = {}, tabelas = {};
    function mostrarTabela(id) {
        const c = corpo(id), t = tabelas[id];
        if (!c || !t) return;
        c.innerHTML = `<div class="pg-tabela"><table><thead><tr>${t[0].map(x => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${t.slice(1).map(l => `<tr>${l.map(x => `<td>${h(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    function desenharCartao(id) {
        if (!desenhos[id]) return;
        desenhos[id]();
        if (modoTabela[id]) mostrarTabela(id);
    }
    function desenhar(d) {
        const grade = $("pgGrade");
        const segP = per.pgSeg || "12m";
        grade.innerHTML = [
            cartao("pgVgv", "pg-c-kpi", filtro === "todos" ? "VGV" : filtro === "venda" ? "VGV de vendas" : "VGV de locações", "", true),
            cartao("pgQtd", "pg-c-kpi", "Negócios fechados", "", true),
            cartao("pgVgcMes", "pg-c-largo", "Comissões (VGC) no tempo", botaoTabela("pgVgcMes"), true),
            cartao("pgCal", "pg-c-cal", "Vencimentos do mês"),
            cartao("pgAneis", "pg-c-aneis", "Indicadores", "", true),
            cartao("pgPend", "pg-c-largo", "Pendências e recebimentos", `<div class="pg-abas" role="tablist">
                <button type="button" data-pend="receber" aria-pressed="${abaPend === "receber"}">A receber</button>
                <button type="button" data-pend="pagar" aria-pressed="${abaPend === "pagar"}">A pagar</button></div>`),
            cartao("pgMeta", "pg-c-meta", `Metas — ${d.tri}º trimestre`),
            cartao("pgCorr", "pg-c-largo", `VGC por corretor — ${d.tri}º trimestre`, botaoTabela("pgCorr")),
            cartao("pgVxl", "pg-c-largo", "Negócios no tempo: venda × locação", botaoTabela("pgVxl"), true),
            cartao("pgFunil", "pg-c-largo", "Funil de conversão", `<button type="button" class="pg-tab" data-pg-ir="settings" title="Metas de conversão por etapa">⚙ metas</button>`, true),
            cartao("pgDesp", "pg-c-largo", "Despesas pagas por plano de contas", `<div class="pg-abas" role="group">
                <button type="button" data-desp="barras" aria-pressed="${modoDesp === "barras"}">▬ barras</button>
                <button type="button" data-desp="pizza" aria-pressed="${modoDesp === "pizza"}">◔ pizza</button></div>`, true),
            `<section class="pg-cartao pg-c-seg" id="pgSeg"><header><h2>Segmento que mais fecha</h2><small class="pg-sub">tipo de imóvel e faixa de preço</small></header>
              ${chips("pgSeg", PERIODOS_SEG, segP === "mesames" || /^\d{4}-\d{2}$/.test(segP) ? "mesames" : segP)}
              <input id="pgSegMes" type="month" class="pg-mes" ${segP === "mesames" || /^\d{4}-\d{2}$/.test(segP) ? "" : "hidden"} value="${h(mesSeg || hojeIso().slice(0, 7))}" aria-label="Mês" />
              <div class="pg-corpo"></div></section>`
        ].join("");
        const fazer = {
            pgVgv: () => kpiVgv(), pgQtd: () => kpiQtd(), pgVgcMes: () => vgcTempo(), pgCal: () => calendario(corpo("pgCal"), dadosFin()),
            pgAneis: () => aneis(), pgMeta: () => metas(d), pgPend: () => pendencias(corpo("pgPend")), pgVxl: () => vxl(),
            pgCorr: () => corretores(d), pgFunil: () => funilConversao(), pgDesp: () => despesasCartao(), pgSeg: () => segmento()
        };
        desenhos = fazer; tabelas = {};
        Object.keys(fazer).forEach(desenharCartao);
        redesenhar = () => [ "pgVgv", "pgVgcMes", "pgVxl", "pgCorr" ].forEach(desenharCartao);

        grade.querySelectorAll("[data-per-card]").forEach(b => b.addEventListener("click", () => {
            const id = b.dataset.perCard, v = b.dataset.per;
            if (id === "pgSeg" && v === "mesames") { mesSeg = mesSeg || hojeIso().slice(0, 7); per.pgSeg = mesSeg; $("pgSegMes").hidden = false; }
            else { per[id] = v; if (id === "pgSeg") $("pgSegMes").hidden = true; }
            $(id).querySelectorAll("[data-per-card]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
            desenharCartao(id);
        }));
        $("pgSegMes").addEventListener("change", () => { mesSeg = $("pgSegMes").value; if (mesSeg) { per.pgSeg = mesSeg; desenharCartao("pgSeg"); } });
        grade.querySelectorAll("[data-tabela]").forEach(b => b.addEventListener("click", () => {
            const id = b.dataset.tabela;
            modoTabela[id] = !modoTabela[id];
            b.setAttribute("aria-pressed", modoTabela[id] ? "true" : "false");
            b.textContent = modoTabela[id] ? "◔ gráfico" : "≡ tabela";
            desenharCartao(id);
        }));
        grade.querySelectorAll("[data-pend]").forEach(b => b.addEventListener("click", () => {
            abaPend = b.dataset.pend;
            grade.querySelectorAll("[data-pend]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
            desenharCartao("pgPend");
        }));
        grade.querySelectorAll("[data-desp]").forEach(b => b.addEventListener("click", () => {
            modoDesp = b.dataset.desp;
            grade.querySelectorAll("[data-desp]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
            desenharCartao("pgDesp");
        }));
        grade.querySelectorAll("[data-pg-ir]").forEach(b => b.addEventListener("click", () => { fechar(); if (ctx.showPage) ctx.showPage(b.dataset.pgIr); }));
    }
    const dadosFin = () => window.SKLFinGestao && window.SKLFinGestao.dados ? window.SKLFinGestao.dados() : { recebiveis: [], lancamentos: [], plano: [] };
    function doCartao(id) {
        const p = perDe(id), [ ini, fim ] = intervaloDe(p);
        const todos = negocios().filter(n => n.dia >= ini && n.dia <= fim);
        return { p, ini, fim, todos, lista: filtro === "todos" ? todos : todos.filter(n => n.fin === filtro) };
    }
    function porTempo(ex, arr, f) { return ex.chaves.map(k => arr.filter(n => ex.de(n.dia) === k).reduce((s, n) => s + f(n), 0)); }

    // 1. VGV com linha de tendência
    function kpiVgv() {
        const { p, ini, fim, todos, lista } = doCartao("pgVgv");
        const ex = eixo(p, ini, fim, todos), serie = porTempo(ex, lista, n => n.valor), vgv = lista.reduce((s, n) => s + n.valor, 0);
        corpo("pgVgv").innerHTML = `<strong class="pg-heroi">${h(curto(vgv))}</strong><small>${h(dinheiro(vgv))} · ${h(rotuloPer(p))}</small><div class="pg-faisca"></div>`;
        faisca(corpo("pgVgv").querySelector(".pg-faisca"), ex.chaves.map(ex.rotulo), serie, COR.s3);
    }
    // 2. contagem venda | locação
    async function kpiQtd() {
        const { p, todos, lista } = doCartao("pgQtd");
        const nv = todos.filter(n => n.fin === "venda").length, nl = todos.filter(n => n.fin === "locacao").length;
        const vgc = lista.reduce((s, n) => s + n.vgc, 0);
        corpo("pgQtd").innerHTML = `<div class="pg-duplo"><div><strong>${nv}</strong><span>vendas</span><i style="background:${COR.s1}"></i></div>
            <div><strong>${nl}</strong><span>locações</span><i style="background:${COR.s2}"></i></div></div>
            <p class="pg-nota">VGC ${h(curto(vgc))} · ${h(rotuloPer(p))}<span class="pg-parc"></span></p>`;
        try { const r = await indicadores(p); const sp = corpo("pgQtd").querySelector(".pg-parc"); if (sp) sp.textContent = ` · ${r.com_parceiros || 0} com parceiro de fora`; } catch (e) { /* só o detalhe */ }
    }
    // 3. VGC no tempo
    function vgcTempo() {
        const { p, ini, fim, todos, lista } = doCartao("pgVgcMes");
        const ex = eixo(p, ini, fim, todos), serie = porTempo(ex, lista, n => n.vgc);
        tabelas.pgVgcMes = [ [ ex.chaves[0] && ex.chaves[0].length > 7 ? "Dia" : "Mês", "VGC" ], ...ex.chaves.map((k, i) => [ ex.rotulo(k), dinheiro(serie[i]) ]) ];
        linhas(corpo("pgVgcMes"), ex.chaves.map(ex.rotulo), [ { nome: "VGC", cor: COR.s1, valores: serie } ], curto);
    }
    // 5. anéis (margem e a receber) — do banco, no período do quadro
    async function aneis() {
        const p = perDe("pgAneis"), c = corpo("pgAneis");
        c.innerHTML = `<p class="pg-carregando">Carregando…</p>`;
        let r;
        try { r = await indicadores(p); } catch (e) { c.innerHTML = `<p class="pg-vazio">${h(ctx.traduzErro(e.message))}</p>`; return; }
        if (perDe("pgAneis") !== p) return;
        const margem = Number(r.vgc) > 0 ? Number(r.vlc) / Number(r.vgc) * 100 : 0;
        const totRec = Number(r.receber_aberto || 0) + Number(r.recebido_sem_data || 0) + Number(r.recebido_periodo || 0);
        const pRec = totRec > 0 ? (Number(r.recebido_sem_data || 0) + Number(r.recebido_periodo || 0)) / totRec * 100 : 0;
        c.innerHTML = `<div class="pg-aneis">
            ${anel(margem, COR.s2, curto(r.vlc), "Fica para a imobiliária", `${pct(margem)} do VGC (VLC)`)}
            ${anel(pRec, COR.s3, curto(Number(r.receber_aberto || 0)), "Comissões a receber", `${pct(pRec)} já recebido`)}
          </div><p class="pg-nota">${h(rotuloPer(p))}</p>`;
    }
    // 6. metas do trimestre
    function metas(d) {
        const ps = (d.metas && d.metas.pessoas) || [];
        const comMeta = ps.filter(p => p.meta_prop != null);
        const bateram = comMeta.filter(p => Number(p.vgc) > Number(p.meta_prop)).length;
        const pMeta = comMeta.length ? bateram / comMeta.length * 100 : 0;
        corpo("pgMeta").innerHTML = comMeta.length ? `<div class="pg-meta">${anelGrande(pMeta, COR.s1)}
              <p><strong>${bateram} de ${comMeta.length}</strong> corretores já bateram a meta${d.metas.meta != null ? ` de ${h(curto(d.metas.meta))}` : ""}.</p>
              <button type="button" class="pg-botao" data-pg-ir="comissoes">Ver metas</button></div>`
            : `<p class="pg-vazio">Sem meta definida para este trimestre.</p><button type="button" class="pg-botao" data-pg-ir="comissoes">Definir metas</button>`;
        corpo("pgMeta").querySelectorAll("[data-pg-ir]").forEach(b => b.addEventListener("click", () => { fechar(); if (ctx.showPage) ctx.showPage(b.dataset.pgIr); }));
    }
    // 7. venda × locação (contagem, mesma escala)
    function vxl() {
        const { p, ini, fim, todos } = doCartao("pgVxl");
        const ex = eixo(p, ini, fim, todos);
        const v = porTempo(ex, todos.filter(n => n.fin === "venda"), () => 1), l = porTempo(ex, todos.filter(n => n.fin === "locacao"), () => 1);
        tabelas.pgVxl = [ [ "Período", "Vendas", "Locações" ], ...ex.chaves.map((k, i) => [ ex.rotulo(k), v[i], l[i] ]) ];
        linhas(corpo("pgVxl"), ex.chaves.map(ex.rotulo), [ { nome: "Vendas", cor: COR.s1, valores: v }, { nome: "Locações", cor: COR.s2, valores: l } ], x => String(Math.round(x)), true);
    }
    // 8. VGC por corretor (trimestre atual) com a meta como referência
    function corretores(d) {
        const ps = (d.metas && d.metas.pessoas) || [];
        const top = ps.filter(p => Number(p.vgc) > 0).sort((a, b) => Number(b.vgc) - Number(a.vgc)).slice(0, 10);
        tabelas.pgCorr = [ [ "Corretor", "VGC no trimestre", "Meta" ], ...top.map(p => [ p.nome, dinheiro(p.vgc), p.meta_prop != null ? dinheiro(p.meta_prop) : "—" ]) ];
        barras(corpo("pgCorr"), top.map(p => p.nome.split(" ").slice(0, 2).join(" ")), top.map(p => Number(p.vgc)), COR.s3, d.metas && d.metas.meta != null ? Number(d.metas.meta) : null, curto, top.map(p => p.nome));
    }
    // 9. pendências: vencidas e próximos 30 dias, com baixa e data programada ali mesmo
    function pendencias(box) {
        const f = dadosFin(), hoje = hojeIso(), ate = isoLocal(Date.now() + 30 * 86400000);
        const gere = ctx.podeGerir && ctx.podeGerir();
        const FG = window.SKLFinGestao;
        const quando = x => x.programado_para || x.vencimento;
        const rec = abaPend === "receber";
        const itens = rec
            ? (f.recebiveis || []).filter(r => !r.recebido_em && !r.recebido_sem_data && r.vencimento && quando(r) <= ate)
            : (f.lancamentos || []).filter(l => l.natureza === "despesa" && !l.pago_em && !l.pago_sem_data && l.vencimento && quando(l) <= ate);
        itens.sort((a, b) => quando(a).localeCompare(quando(b)));
        const vencidas = itens.filter(x => quando(x) < hoje);
        const nome = x => rec ? (FG && FG.nomeNegocio ? FG.nomeNegocio(x.negociacao_id) : "Negócio") + ` · ${x.parcela}ª parcela` : x.descricao;
        const total = arr => arr.reduce((s, x) => s + Number(x.valor || 0), 0);
        box.innerHTML = (vencidas.length ? `<p class="pg-alerta">⚠ ${vencidas.length} ${rec ? "parcela(s) vencida(s) sem baixa" : "conta(s) vencida(s) sem pagamento"}: ${h(dinheiro(total(vencidas)))}</p>` : "")
            + (itens.length ? `<ul class="pg-pend">${itens.slice(0, 12).map(x => `<li class="${quando(x) < hoje ? "vencida" : ""}">
                <span class="pg-lt-data">${h(dataBr(quando(x)))}</span>
                <span class="pg-lt-txt"><b>${h(x.valor == null ? "sem valor" : dinheiro(x.valor))}</b><small>${h(nome(x))}${x.programado_para ? ` · programado (vence ${h(dataBr(x.vencimento))})` : ""}</small></span>
                ${gere ? `<span class="pg-pend-acoes"><button type="button" class="pg-mini ok" data-baixa="${h(x.id)}" title="${rec ? "Recebido" : "Pago"}">✓ ${rec ? "Recebido" : "Pago"}</button>
                  <button type="button" class="pg-mini" data-prog="${h(x.id)}" title="Programar data">📅</button></span>` : ""}
              </li>`).join("")}</ul>${itens.length > 12 ? `<p class="pg-nota">+ ${itens.length - 12} no Financeiro.</p>` : ""}`
              : `<p class="pg-vazio">Nada ${rec ? "a receber" : "a pagar"} nos próximos 30 dias.</p>`);
        const tipo = rec ? "recebivel" : "lancamento";
        const achar = id => itens.find(x => x.id === id);
        const depois = async () => { indCache = new Map(); if (FG && FG.carregar) await FG.carregar(); [ "pgPend", "pgCal", "pgAneis" ].forEach(desenharCartao); };
        box.querySelectorAll("[data-baixa]").forEach(b => b.addEventListener("click", () => FG.abrirBaixa(tipo, achar(b.dataset.baixa), depois)));
        box.querySelectorAll("[data-prog]").forEach(b => b.addEventListener("click", () => FG.abrirProgramar(tipo, achar(b.dataset.prog), depois)));
    }
    // 10. funil de conversão (meta de cada etapa editável em Configurações)
    async function funilConversao() {
        const p = perDe("pgFunil"), [ ini, fim ] = intervaloDe(p), box = corpo("pgFunil");
        box.innerHTML = `<p class="pg-carregando">Carregando…</p>`;
        const { data, error } = await ctx.sb.rpc("crm_funil_conversao", { p_carteira: ctx.carteiraId(), p_de: ini === "2000-01-01" ? null : ini, p_ate: fim });
        if (perDe("pgFunil") !== p) return;
        if (error) { box.innerHTML = `<p class="pg-vazio">${h(ctx.traduzErro(error.message))}</p>`; return; }
        const funis = (data || []).filter(f => filtro === "todos" || f.finalidade === filtro);
        const comDados = funis.filter(f => f.etapas.length && f.etapas[0].chegaram);
        if (!comDados.length) { box.innerHTML = `<p class="pg-vazio">Nenhum contato novo no CRM ${h(rotuloPer(p))}. O histórico importado não entra no funil (não tem as etapas).</p>`; return; }
        box.innerHTML = comDados.map(f => {
            const base = f.etapas[0].chegaram;
            return `<div class="pg-funil"><h3><i style="background:${h(f.cor || "#fff")}"></i>${h(f.funil)} <small>${base} contato(s) · ${h(rotuloPer(p))}</small></h3>
              ${f.etapas.map((e, i) => {
                  const ant = i ? f.etapas[i - 1].chegaram : null;
                  const real = i && ant ? Math.round(e.chegaram * 1000 / ant) / 10 : null;
                  const meta = i && e.meta != null ? Number(e.meta) : null;
                  const cls = meta == null || real == null ? "" : real >= meta ? "ok" : "abaixo";
                  return `<div class="pg-funil-linha"><span class="pg-funil-nome">${h(e.nome)}</span>
                    <span class="pg-funil-barra"><i style="width:${base ? Math.max(3, e.chegaram / base * 100) : 0}%"></i></span>
                    <b>${e.chegaram}</b>
                    <small class="${cls}">${real != null ? real.toLocaleString("pt-BR") + "%" : ""}${meta != null ? ` <span>meta ${meta.toLocaleString("pt-BR")}%</span>` : ""}</small></div>`;
              }).join("")}</div>`;
        }).join("");
    }
    // 11. despesas por plano de contas: barras (parte do todo) ou pizza
    async function despesasCartao() {
        const p = perDe("pgDesp"), box = corpo("pgDesp");
        let r;
        try { r = await indicadores(p); } catch (e) { box.innerHTML = `<p class="pg-vazio">${h(ctx.traduzErro(e.message))}</p>`; return; }
        if (perDe("pgDesp") !== p) return;
        despesas(box, (r.por_plano || []).filter(x => x.natureza === "despesa"), rotuloPer(p));
    }
    // 12. segmento: tipo de imóvel e faixa de preço que mais fecham
    function segmento() {
        const p = per.pgSeg || "12m", [ ini, fim ] = intervaloDe(p === "mesames" ? (mesSeg || hojeIso().slice(0, 7)) : p);
        const I = window.SKLCRM && window.SKLCRM.interno;
        const imoveis = I && I.ctx() && I.ctx().imoveis ? I.ctx().imoveis() : [];
        const porId = new Map(imoveis.map(i => [ i.id, i ]));
        const lista = negocios().filter(n => n.dia >= ini && n.dia <= fim && (filtro === "todos" || n.fin === filtro));
        const box = corpo("pgSeg");
        if (!lista.length) { box.innerHTML = `<p class="pg-vazio">Nenhum negócio fechado ${h(rotuloPer(p === "mesames" ? mesSeg : p))}.</p>`; return; }
        const grupo = chave => {
            const m = new Map();
            lista.forEach(n => { const k = chave(n); const r = m.get(k) || { qtd: 0, vgv: 0 }; r.qtd++; r.vgv += n.valor; m.set(k, r); });
            return [ ...m.entries() ].sort((a, b) => b[1].qtd - a[1].qtd || b[1].vgv - a[1].vgv);
        };
        const tipo = n => { const im = porId.get(n.neg.construcao_id); return im ? (im.tipo_imovel || "Tipo não informado") + (im.rural ? " (rural)" : "") : "Sem imóvel ligado"; };
        const faixa = n => {
            const pd = I && I.padraoDe ? I.padraoDe(n.neg) : null;
            const nomes = { economico: "Econômico", medio: "Médio padrão", alto: "Alto padrão" };
            return (n.fin === "venda" ? "Venda · " : "Locação · ") + (pd ? nomes[pd] : "sem valor");
        };
        const bloco = (titulo, linhasG) => {
            const max = Math.max(1, ...linhasG.map(([ , r ]) => r.qtd));
            return `<div class="pg-seg-bloco"><h3>${h(titulo)}</h3>${linhasG.slice(0, 8).map(([ k, r ], i) => `<div class="pg-funil-linha">
                <span class="pg-funil-nome">${i === 0 ? "🏆 " : ""}${h(k)}</span><span class="pg-funil-barra"><i style="width:${Math.max(3, r.qtd / max * 100)}%"></i></span>
                <b>${r.qtd}</b><small>${h(curto(r.vgv))}</small></div>`).join("")}</div>`;
        };
        const tipos = grupo(tipo), faixas = grupo(faixa);
        const semImovel = lista.filter(n => !porId.has(n.neg.construcao_id)).length;
        box.innerHTML = `<div class="pg-seg">${bloco("Tipo de imóvel", tipos)}${bloco("Faixa de preço", faixas)}</div>
          <p class="pg-nota">${lista.length} negócio(s) · ${h(rotuloPer(p === "mesames" ? mesSeg : p))}. Faixas de preço: Configurações → Faixas de padrão.${semImovel ? ` ${semImovel} negócio(s) sem imóvel ligado (o histórico do Power BI não traz o tipo do imóvel).` : ""}</p>`;
    }

    // ------------------------------------------------------------------ dica (tooltip)
    function dica(html, x, y) {
        const el = $("pgDica");
        if (!el) return;
        if (!html) { el.hidden = true; return; }
        el.innerHTML = html; el.hidden = false;
        const w = el.offsetWidth, hh = el.offsetHeight;
        el.style.left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8) + "px";
        el.style.top = Math.min(Math.max(8, y - hh - 12), window.innerHeight - hh - 8) + "px";
    }
    function ligarDica(el, conteudo) {
        el.addEventListener("mousemove", e => dica(conteudo(), e.clientX, e.clientY));
        el.addEventListener("mouseleave", () => dica(null));
        el.addEventListener("click", e => { const r = el.getBoundingClientRect(); dica(conteudo(), r.left + r.width / 2, r.top); e.stopPropagation(); });
    }

    // ------------------------------------------------------------------ gráficos (SVG)
    const NS = "http://www.w3.org/2000/svg";
    function svg(w, hgt) { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", `0 0 ${w} ${hgt}`); s.setAttribute("width", w); s.setAttribute("height", hgt); return s; }
    function el(nome, attrs, pai) { const e = document.createElementNS(NS, nome); Object.entries(attrs).forEach(([ k, v ]) => e.setAttribute(k, v)); if (pai) pai.appendChild(e); return e; }
    function escala(max) { // topo "redondo" para a grade
        if (!(max > 0)) return 1;
        const p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    }
    function faisca(box, rotulos, valores, cor) {
        if (!box) return;
        box.innerHTML = "";
        const w = Math.max(box.clientWidth, 160), hgt = 56, max = Math.max(...valores, 1), n = valores.length;
        const s = svg(w, hgt);
        const px = i => n === 1 ? w / 2 : 6 + i * (w - 12) / (n - 1), py = v => hgt - 8 - v / max * (hgt - 16);
        el("path", { d: valores.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(""), fill: "none", stroke: cor, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, s);
        const i = valores.length - 1;
        el("circle", { cx: px(i), cy: py(valores[i]), r: 4, fill: cor, stroke: "#fff", "stroke-width": 2 }, s);
        box.appendChild(s);
        const alvo = el("rect", { x: 0, y: 0, width: w, height: hgt, fill: "transparent" }, s);
        alvo.addEventListener("mousemove", e => {
            const r = s.getBoundingClientRect(); const k = Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - 6) / ((w - 12) / Math.max(n - 1, 1)))));
            dica(`<b>${h(rotulos[k])}</b><br>${h(dinheiro(valores[k]))}`, e.clientX, e.clientY);
        });
        alvo.addEventListener("mouseleave", () => dica(null));
    }
    // linhas com eixo único, grade discreta, legenda (2+ séries), mira vertical e dica com todas as séries do mês
    function linhas(box, rotulos, series, fmt, area) {
        box.innerHTML = "";
        if (series.length > 1) box.insertAdjacentHTML("beforeend", `<div class="pg-legenda">${series.map(s => `<span><i style="background:${s.cor}"></i>${h(s.nome)}</span>`).join("")}</div>`);
        const w = Math.max(box.clientWidth, 260), hgt = 210, esq = 56, dir = 14, topo = 12, base = 26;
        const bruto = Math.max(1, ...series.flatMap(s => s.valores));
        // contagens pequenas: grade em números inteiros (sem 1, 2, 2, 2 repetidos)
        const inteiro = series.every(s => s.valores.every(v => Number.isInteger(v)));
        const max = inteiro && bruto <= 4 ? bruto : escala(bruto);
        const nTicks = inteiro && bruto <= 4 ? bruto : 4;
        const n = rotulos.length, larg = w - esq - dir, alt = hgt - topo - base;
        const px = i => esq + (n === 1 ? larg / 2 : i * larg / (n - 1)), py = v => topo + alt - v / max * alt;
        const s = svg(w, hgt);
        for (let k = 0; k <= nTicks; k++) {
            const v = max * k / nTicks, y = py(v);
            el("line", { x1: esq, x2: w - dir, y1: y, y2: y, stroke: "#e3eef0", "stroke-width": 1 }, s);
            el("text", { x: esq - 8, y: y + 4, "text-anchor": "end", class: "pg-eixo" }, s).textContent = fmt(v);
        }
        const passo = Math.ceil(n / Math.max(1, Math.floor(larg / 46)));
        rotulos.forEach((r, i) => { if (i % passo === 0 || i === n - 1) el("text", { x: px(i), y: hgt - 8, "text-anchor": "middle", class: "pg-eixo" }, s).textContent = r; });
        series.forEach(se => {
            const d = se.valores.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join("");
            if (area) el("path", { d: `${d}L${px(n - 1).toFixed(1)},${py(0)}L${px(0).toFixed(1)},${py(0)}Z`, fill: se.cor, opacity: 0.1 }, s);
            el("path", { d, fill: "none", stroke: se.cor, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, s);
            // marca no maior valor (rótulo seletivo, não em todo ponto)
            const iMax = se.valores.indexOf(Math.max(...se.valores));
            if (se.valores[iMax] > 0) {
                el("circle", { cx: px(iMax), cy: py(se.valores[iMax]), r: 4.5, fill: se.cor, stroke: "#fff", "stroke-width": 2 }, s);
                el("text", { x: px(iMax), y: py(se.valores[iMax]) - 9, "text-anchor": "middle", class: "pg-rotulo" }, s).textContent = fmt(se.valores[iMax]);
            }
        });
        const mira = el("line", { x1: 0, x2: 0, y1: topo, y2: topo + alt, stroke: "#9fb6bd", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" }, s);
        const pontos = series.map(se => el("circle", { r: 4.5, fill: se.cor, stroke: "#fff", "stroke-width": 2, visibility: "hidden" }, s));
        const alvo = el("rect", { x: esq, y: topo, width: larg, height: alt, fill: "transparent" }, s);
        const mover = (cx, cy) => {
            const r = s.getBoundingClientRect(), x = (cx - r.left) * (w / r.width);
            const i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : (x - esq) / (larg / (n - 1)))));
            mira.setAttribute("x1", px(i)); mira.setAttribute("x2", px(i)); mira.setAttribute("visibility", "visible");
            pontos.forEach((p, k) => { p.setAttribute("cx", px(i)); p.setAttribute("cy", py(series[k].valores[i])); p.setAttribute("visibility", "visible"); });
            dica(`<b>${h(rotulos[i])}</b>${series.map(se => `<br><i class="pg-dot" style="background:${se.cor}"></i>${h(se.nome)}: <b>${h(fmt(se.valores[i]))}</b>`).join("")}`, cx, cy);
        };
        alvo.addEventListener("mousemove", e => mover(e.clientX, e.clientY));
        alvo.addEventListener("touchstart", e => { const t = e.touches[0]; mover(t.clientX, t.clientY); }, { passive: true });
        alvo.addEventListener("mouseleave", () => { mira.setAttribute("visibility", "hidden"); pontos.forEach(p => p.setAttribute("visibility", "hidden")); dica(null); });
        box.appendChild(s);
    }
    // barras de uma série (cantos arredondados no topo, 2px de folga), com a meta como linha de referência
    function barras(box, rotulos, valores, cor, ref, fmt, nomes) {
        box.innerHTML = "";
        if (!valores.length) { box.innerHTML = `<p class="pg-vazio">Nenhum negócio de corretor neste trimestre.</p>`; return; }
        const w = Math.max(box.clientWidth, 260), hgt = 220, esq = 56, dir = 10, topo = 16, base = 40;
        const max = escala(Math.max(...valores, ref || 0, 1)), n = valores.length, larg = w - esq - dir, alt = hgt - topo - base;
        const banda = larg / n, bw = Math.min(42, banda - 6), py = v => topo + alt - v / max * alt;
        const s = svg(w, hgt);
        for (let k = 0; k <= 4; k++) {
            const v = max * k / 4, y = py(v);
            el("line", { x1: esq, x2: w - dir, y1: y, y2: y, stroke: "#e3eef0", "stroke-width": 1 }, s);
            el("text", { x: esq - 8, y: y + 4, "text-anchor": "end", class: "pg-eixo" }, s).textContent = fmt(v);
        }
        valores.forEach((v, i) => {
            const x = esq + i * banda + (banda - bw) / 2, y = py(v), hb = Math.max(py(0) - y, 1), r = Math.min(4, bw / 2, hb);
            el("path", { d: `M${x},${py(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${py(0)}Z`, fill: cor }, s);
            const t = el("text", { x: x + bw / 2, y: hgt - base + 14, "text-anchor": "middle", class: "pg-eixo" }, s);
            t.textContent = rotulos[i].length > 11 ? rotulos[i].slice(0, 10) + "…" : rotulos[i];
            const alvo = el("rect", { x: esq + i * banda, y: topo, width: banda, height: alt + 20, fill: "transparent" }, s);
            ligarDica(alvo, () => `<b>${h(nomes[i])}</b><br>VGC: <b>${h(dinheiro(v))}</b>${ref != null ? `<br>${v > ref ? "bateu a meta" : "abaixo da meta"} (${h(curto(ref))})` : ""}`);
        });
        el("text", { x: esq + banda * 0 + (banda - bw) / 2 + bw / 2, y: py(valores[0]) - 6, "text-anchor": "middle", class: "pg-rotulo" }, s).textContent = fmt(valores[0]);
        if (ref != null) {
            const y = py(ref);
            el("line", { x1: esq, x2: w - dir, y1: y, y2: y, stroke: "#52514e", "stroke-width": 1.5, "stroke-dasharray": "5 4" }, s);
            el("text", { x: w - dir, y: y - 5, "text-anchor": "end", class: "pg-rotulo" }, s).textContent = "meta " + fmt(ref);
        }
        box.appendChild(s);
    }
    function anel(p, cor, valor, titulo, sub) {
        const r = 36, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p));
        return `<div class="pg-anel"><svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
            <circle cx="48" cy="48" r="${r}" fill="none" stroke="#e6eef2" stroke-width="9"/>
            ${v > 0 ? `<circle cx="48" cy="48" r="${r}" fill="none" stroke="${cor}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 48 48)"/>` : ""}
          </svg><strong>${h(valor)}</strong><span>${h(titulo)}</span><small>${h(sub)}</small></div>`;
    }
    function anelGrande(p, cor) {
        const r = 62, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p));
        return `<div class="pg-anel-g"><svg viewBox="0 0 150 150" width="150" height="150" aria-hidden="true">
            <circle cx="75" cy="75" r="${r}" fill="none" stroke="#e6eef2" stroke-width="12"/>
            ${v > 0 ? `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 75 75)"/>` : ""}
          </svg><b>${h(pct(v))}</b></div>`;
    }
    function calendario(box, f) {
        const hoje = new Date(), a = hoje.getFullYear(), m = hoje.getMonth();
        const mm = `${a}-${String(m + 1).padStart(2, "0")}`;
        const rec = (f.recebiveis || []).filter(r => !r.recebido_em && !r.recebido_sem_data && String(r.vencimento).startsWith(mm));
        const des = (f.lancamentos || []).filter(l => !l.pago_em && !l.pago_sem_data && String(l.vencimento).startsWith(mm));
        const dias = new Date(a, m + 1, 0).getDate(), ini = new Date(a, m, 1).getDay();
        const nomeMes = hoje.toLocaleDateString("pt-BR", { month: "long" });
        let html = `<div class="pg-cal-mes">${h(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + " de " + a)}</div>
          <div class="pg-legenda"><span><i style="background:${COR.s1}"></i>a receber</span><span><i style="background:${COR.s2}"></i>a pagar</span></div>
          <div class="pg-cal">${[ "D", "S", "T", "Q", "Q", "S", "S" ].map(x => `<b>${x}</b>`).join("")}${"<span></span>".repeat(ini)}`;
        for (let d = 1; d <= dias; d++) {
            const iso = `${mm}-${String(d).padStart(2, "0")}`;
            const r = rec.filter(x => x.vencimento === iso), p = des.filter(x => x.vencimento === iso);
            const cls = [ d === hoje.getDate() ? "hoje" : "", r.length ? "rec" : "", p.length ? "pag" : "" ].filter(Boolean).join(" ");
            html += `<span class="${cls}" data-dia="${iso}">${d}</span>`;
        }
        box.innerHTML = html + `</div>`;
        box.querySelectorAll("[data-dia]").forEach(sp => {
            const iso = sp.dataset.dia, r = rec.filter(x => x.vencimento === iso), p = des.filter(x => x.vencimento === iso);
            if (!r.length && !p.length) return;
            ligarDica(sp, () => `<b>${h(dataBr(iso))}</b>${r.length ? `<br><i class="pg-dot" style="background:${COR.s1}"></i>A receber: <b>${h(dinheiro(r.reduce((s, x) => s + Number(x.valor || 0), 0)))}</b> (${r.length})` : ""}${p.length ? `<br><i class="pg-dot" style="background:${COR.s2}"></i>A pagar: <b>${h(dinheiro(p.reduce((s, x) => s + Number(x.valor || 0), 0)))}</b> (${p.length})` : ""}`);
        });
    }
    function despesas(box, planos, rotulo) {
        if (!planos.length) { box.innerHTML = `<p class="pg-vazio">Nenhuma despesa paga ${h(rotulo || "no período")}.</p>`; return; }
        const total = planos.reduce((s, p) => s + Number(p.total), 0);
        const cores = [ COR.s1, COR.s2, COR.s3, clarear(COR.s2, 0.45), clarear(COR.s1, 0.62), "#7c9a5c", "#b07aa1" ];
        const nTop = modoDesp === "pizza" ? 6 : 4;
        const top = planos.slice(0, nTop), resto = planos.slice(nTop).reduce((s, p) => s + Number(p.total), 0);
        const partes = [ ...top.map((p, i) => ({ nome: p.nome, v: Number(p.total), cor: cores[i] })), ...(resto > 0 ? [ { nome: "Outros", v: resto, cor: "#9aa6ab" } ] : []) ];
        const legenda = `<ul class="pg-partes">${partes.map(p => `<li><i style="background:${p.cor}"></i><span>${h(p.nome)}</span><b>${h(dinheiro(p.v))}</b><small>${h(pct(p.v / total * 100))}</small></li>`).join("")}</ul>`;
        const rodape = `<p class="pg-nota">Total pago (${h(rotulo || "período")}): <b>${h(dinheiro(total))}</b></p>`;
        if (modoDesp === "pizza") {
            const R = 70, cx = 80, cy = 80;
            let ang = -Math.PI / 2;
            const fatias = partes.map(p => {
                const a0 = ang, a1 = ang + p.v / total * 2 * Math.PI; ang = a1;
                if (partes.length === 1) return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${p.cor}" data-parte="${h(p.nome)}"/>`;
                const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
                return `<path d="M${cx},${cy}L${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}Z" fill="${p.cor}" stroke="#fff" stroke-width="2" data-parte="${h(p.nome)}"/>`;
            }).join("");
            box.innerHTML = `<div class="pg-pizza"><svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Despesas por plano de contas">${fatias}</svg>${legenda}</div>${rodape}`;
        } else {
            box.innerHTML = `<div class="pg-pilha">${partes.map(p => `<span style="width:${(p.v / total * 100).toFixed(2)}%;background:${p.cor}" data-parte="${h(p.nome)}"></span>`).join("")}</div>${legenda}${rodape}`;
        }
        box.querySelectorAll("[data-parte]").forEach(sp => { const p = partes.find(x => x.nome === sp.dataset.parte); ligarDica(sp, () => `<b>${h(p.nome)}</b><br>${h(dinheiro(p.v))} · ${h(pct(p.v / total * 100))}`); });
    }

    function sair() { fechar(); ultimo = null; const b = $("painelAbrir"); if (b) b.hidden = true; }

    window.SKLPainel = { iniciar, abrir, fechar, sair };
})();
