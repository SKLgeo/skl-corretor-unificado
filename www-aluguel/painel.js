// Painel visual da imobiliária (botão "📊 Painel" no topo, só Central/admin/gestor/financeiro). Abre por cima do app,
// em tela cheia, e mostra os números do período em cartões: VGV, negócios, comissões por mês, calendário de vencimentos,
// margem, metas da equipe, venda × locação, VGC por corretor, próximos recebimentos e despesas por plano de contas.
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
                    <option value="mes">Este mês</option><option value="trimestre">Este trimestre</option>
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
        $("pgPeriodo").addEventListener("change", () => { periodo = $("pgPeriodo").value; carregar(); });
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
    function intervalo() {
        const hoje = hojeIso(), [ a, m ] = hoje.split("-").map(Number);
        const fimMes = (ano, mes) => `${ano}-${String(mes).padStart(2, "0")}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;
        if (periodo === "mes") return [ `${a}-${String(m).padStart(2, "0")}-01`, fimMes(a, m) ];
        if (periodo === "trimestre") { const t = Math.floor((m - 1) / 3); return [ `${a}-${String(t * 3 + 1).padStart(2, "0")}-01`, fimMes(a, t * 3 + 3) ]; }
        if (periodo === "ano") return [ `${a}-01-01`, `${a}-12-31` ];
        if (periodo === "12m") { const d = new Date(a, m - 12, 1); return [ `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, fimMes(a, m) ]; }
        return [ "2000-01-01", "2100-12-31" ];
    }
    async function carregar() {
        const grade = $("pgGrade");
        grade.innerHTML = `<p class="pg-carregando">Carregando…</p>`;
        const [ ini, fim ] = intervalo();
        const hoje = new Date();
        const tri = Math.floor(hoje.getMonth() / 3) + 1;
        const [ ind, met ] = await Promise.all([
            ctx.sb.rpc("fin_indicadores_imobiliaria", { p_carteira: ctx.carteiraId(), p_ini: ini, p_fim: fim }),
            ctx.sb.rpc("metas_painel", { p_carteira: ctx.carteiraId(), p_ano: hoje.getFullYear(), p_trimestre: tri })
        ]);
        if (ind.error) { grade.innerHTML = `<p class="pg-carregando">${h(ctx.traduzErro(ind.error.message))}</p>`; return; }
        if (window.SKLFinGestao && window.SKLFinGestao.carregar) await window.SKLFinGestao.carregar();
        ultimo = { ini, fim, ind: ind.data || {}, metas: met.data || null, tri };
        desenhar(ultimo);
    }
    // negócios ganhos (do CRM) com finalidade e comissão total (a da divisão ou a estimada, igual ao banco)
    function negocios() {
        const I = window.SKLCRM && window.SKLCRM.interno;
        if (!I) return [];
        const regra = window.SKLComissoes && (window.SKLComissoes.regras() || []).find(r => r.padrao);
        const hon = regra && regra.honorarios_venda_pct != null ? Number(regra.honorarios_venda_pct) : 6;
        return [ ...I.negs.values() ].filter(n => n.situacao === "ganha" && n.fechado_em).map(n => {
            const f = I.funil(n.funil_id), fin = f && f.finalidade;
            const vgc = n.comissao_total != null ? Number(n.comissao_total) : fin === "venda" ? Number(n.valor || 0) * hon / 100 : Number(n.valor || 0);
            return { id: n.id, fin, dia: isoLocal(n.fechado_em), valor: Number(n.valor || 0), vgc };
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
        while ((a < af || (a === af && m <= mf)) && out.length < 60) { out.push(`${a}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; a++; } }
        return out.length ? out : [ hojeIso().slice(0, 7) ];
    }

    // ------------------------------------------------------------------ desenho
    function cartao(id, classe, titulo, extra) {
        return `<section class="pg-cartao ${classe || ""}" id="${id}"><header><h2>${h(titulo)}</h2>${extra || ""}</header><div class="pg-corpo"></div></section>`;
    }
    function botaoTabela(id) { return `<button type="button" class="pg-tab" data-tabela="${id}" aria-pressed="false">≡ tabela</button>`; }
    function desenhar(d) {
        const r = d.ind;
        const todos = negocios().filter(n => n.dia >= d.ini && n.dia <= d.fim);
        const lista = filtro === "todos" ? todos : todos.filter(n => n.fin === filtro);
        const meses = mesesDoPeriodo(d.ini, d.fim, todos);
        const rotuloMes = mm => { const [ a, m ] = mm.split("-").map(Number); return MESES[m - 1] + (meses.length > 12 || a !== new Date().getFullYear() ? "/" + String(a).slice(2) : ""); };
        const porMes = (arr, f) => meses.map(mm => arr.filter(n => n.dia.startsWith(mm)).reduce((s, n) => s + f(n), 0));
        const vgv = lista.reduce((s, n) => s + n.valor, 0), vgc = lista.reduce((s, n) => s + n.vgc, 0);
        const dadosFin = window.SKLFinGestao && window.SKLFinGestao.dados ? window.SKLFinGestao.dados() : { recebiveis: [], lancamentos: [], plano: [] };
        const grade = $("pgGrade");
        grade.innerHTML = [
            cartao("pgVgv", "pg-c-kpi", filtro === "todos" ? "VGV no período" : filtro === "venda" ? "VGV de vendas" : "VGV de locações"),
            cartao("pgQtd", "pg-c-kpi", "Negócios fechados"),
            cartao("pgVgcMes", "pg-c-largo", "Comissões (VGC) por mês", botaoTabela("pgVgcMes")),
            cartao("pgCal", "pg-c-cal", "Vencimentos do mês"),
            cartao("pgAneis", "pg-c-aneis", "Indicadores"),
            cartao("pgMeta", "pg-c-meta", `Metas — ${d.tri}º trimestre`),
            cartao("pgProx", "pg-c-largo", "Próximos recebimentos"),
            cartao("pgVxl", "pg-c-largo", "Negócios por mês: venda × locação", botaoTabela("pgVxl")),
            cartao("pgCorr", "pg-c-largo", `VGC por corretor — ${d.tri}º trimestre`, botaoTabela("pgCorr")),
            cartao("pgDesp", "pg-c-largo", "Despesas pagas por plano de contas")
        ].join("");
        const corpo = id => $(id).querySelector(".pg-corpo");

        // 1. VGV com linha de tendência mensal
        const serieVgv = porMes(lista, n => n.valor);
        corpo("pgVgv").innerHTML = `<strong class="pg-heroi">${h(curto(vgv))}</strong><small>${h(dinheiro(vgv))}</small><div class="pg-faisca"></div>`;
        faisca(corpo("pgVgv").querySelector(".pg-faisca"), meses.map(rotuloMes), serieVgv, COR.s3);
        // 2. contagem venda | locação
        const nv = todos.filter(n => n.fin === "venda").length, nl = todos.filter(n => n.fin === "locacao").length;
        corpo("pgQtd").innerHTML = `<div class="pg-duplo"><div><strong>${nv}</strong><span>vendas</span><i style="background:${COR.s1}"></i></div>
            <div><strong>${nl}</strong><span>locações</span><i style="background:${COR.s2}"></i></div></div>
            <p class="pg-nota">${h(r.com_parceiros || 0)} com parceiro de fora · VGC ${h(curto(vgc))}</p>`;
        // 3. VGC por mês
        const serieVgc = porMes(lista, n => n.vgc);
        const desenhaVgc = () => linhas(corpo("pgVgcMes"), meses.map(rotuloMes), [ { nome: "VGC", cor: COR.s1, valores: serieVgc } ], curto);
        // 4. calendário
        calendario(corpo("pgCal"), dadosFin);
        // 5. anéis
        const margem = Number(r.vgc) > 0 ? Number(r.vlc) / Number(r.vgc) * 100 : 0;
        const totRec = Number(r.receber_aberto || 0) + Number(r.recebido_sem_data || 0) + Number(r.recebido_periodo || 0);
        const pRec = totRec > 0 ? (Number(r.recebido_sem_data || 0) + Number(r.recebido_periodo || 0)) / totRec * 100 : 0;
        corpo("pgAneis").innerHTML = `<div class="pg-aneis">
            ${anel(margem, COR.s2, curto(r.vlc), "Fica para a imobiliária", `${pct(margem)} do VGC (VLC)`)}
            ${anel(pRec, COR.s3, curto(Number(r.receber_aberto || 0)), "Comissões a receber", `${pct(pRec)} já recebido`)}
          </div>`;
        // 6. metas
        const ps = (d.metas && d.metas.pessoas) || [];
        const comMeta = ps.filter(p => p.meta_prop != null);
        const bateram = comMeta.filter(p => Number(p.vgc) > Number(p.meta_prop)).length;
        const pMeta = comMeta.length ? bateram / comMeta.length * 100 : 0;
        corpo("pgMeta").innerHTML = comMeta.length ? `<div class="pg-meta">${anelGrande(pMeta, COR.s1)}
              <p><strong>${bateram} de ${comMeta.length}</strong> corretores já bateram a meta${d.metas.meta != null ? ` de ${h(curto(d.metas.meta))}` : ""}.</p>
              <button type="button" class="pg-botao" data-pg-ir="comissoes">Ver metas</button></div>`
            : `<p class="pg-vazio">Sem meta definida para este trimestre.</p><button type="button" class="pg-botao" data-pg-ir="comissoes">Definir metas</button>`;
        // 7. venda × locação (contagem por mês, mesma escala)
        const desenhaVxl = () => linhas(corpo("pgVxl"), meses.map(rotuloMes), [
            { nome: "Vendas", cor: COR.s1, valores: porMes(todos.filter(n => n.fin === "venda"), () => 1) },
            { nome: "Locações", cor: COR.s2, valores: porMes(todos.filter(n => n.fin === "locacao"), () => 1) }
        ], v => String(Math.round(v)), true);
        // 8. VGC por corretor (trimestre atual) com a meta como referência
        const top = ps.filter(p => Number(p.vgc) > 0).sort((a, b) => Number(b.vgc) - Number(a.vgc)).slice(0, 10);
        const desenhaCorr = () => barras(corpo("pgCorr"), top.map(p => p.nome.split(" ").slice(0, 2).join(" ")), top.map(p => Number(p.vgc)), COR.s3, d.metas && d.metas.meta != null ? Number(d.metas.meta) : null, curto, top.map(p => p.nome));
        // 9. próximos recebimentos
        proximos(corpo("pgProx"), dadosFin.recebiveis);
        // 10. despesas por plano de contas (parte do todo)
        despesas(corpo("pgDesp"), (r.por_plano || []).filter(p => p.natureza === "despesa"));

        redesenhar = () => { desenhaVgc(); desenhaVxl(); desenhaCorr(); faisca(corpo("pgVgv").querySelector(".pg-faisca"), meses.map(rotuloMes), serieVgv, COR.s3); };
        redesenhar();
        // tabelas (alternativa acessível aos gráficos)
        const tabelas = {
            pgVgcMes: [ [ "Mês", "VGC" ], ...meses.map((mm, i) => [ rotuloMes(mm), dinheiro(serieVgc[i]) ]) ],
            pgVxl: [ [ "Mês", "Vendas", "Locações" ], ...meses.map(mm => [ rotuloMes(mm), todos.filter(n => n.fin === "venda" && n.dia.startsWith(mm)).length, todos.filter(n => n.fin === "locacao" && n.dia.startsWith(mm)).length ]) ],
            pgCorr: [ [ "Corretor", "VGC no trimestre", "Meta" ], ...top.map(p => [ p.nome, dinheiro(p.vgc), p.meta_prop != null ? dinheiro(p.meta_prop) : "—" ]) ]
        };
        grade.querySelectorAll("[data-tabela]").forEach(b => b.addEventListener("click", () => {
            const id = b.dataset.tabela, c = corpo(id), on = b.getAttribute("aria-pressed") !== "true";
            b.setAttribute("aria-pressed", on ? "true" : "false");
            b.textContent = on ? "◔ gráfico" : "≡ tabela";
            if (on) c.innerHTML = `<div class="pg-tabela"><table><thead><tr>${tabelas[id][0].map(x => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${tabelas[id].slice(1).map(l => `<tr>${l.map(x => `<td>${h(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
            else ({ pgVgcMes: desenhaVgc, pgVxl: desenhaVxl, pgCorr: desenhaCorr })[id]();
        }));
        grade.querySelectorAll("[data-pg-ir]").forEach(b => b.addEventListener("click", () => { fechar(); if (ctx.showPage) ctx.showPage(b.dataset.pgIr); }));
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
    function proximos(box, recebiveis) {
        const hoje = hojeIso();
        const lista = (recebiveis || []).filter(r => !r.recebido_em && !r.recebido_sem_data && r.vencimento >= hoje).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 5);
        const vencidas = (recebiveis || []).filter(r => !r.recebido_em && !r.recebido_sem_data && r.vencimento < hoje);
        const I = window.SKLCRM && window.SKLCRM.interno;
        const nome = id => { const n = I && I.negs.get(id); return n ? (n.titulo || "Negócio").trim() : "Negócio"; };
        box.innerHTML = (vencidas.length ? `<p class="pg-alerta">⚠ ${vencidas.length} parcela(s) vencida(s) sem baixa: ${h(dinheiro(vencidas.reduce((s, r) => s + Number(r.valor || 0), 0)))}</p>` : "")
            + (lista.length ? `<ol class="pg-linha-tempo">${lista.map(r => `<li><span class="pg-lt-data">${h(dataBr(r.vencimento))}</span><i></i>
                <span class="pg-lt-txt"><b>${h(r.valor == null ? "sem valor" : dinheiro(r.valor))}</b><small>${h(nome(r.negociacao_id))} · ${r.parcela}ª parcela</small></span></li>`).join("")}</ol>`
              : `<p class="pg-vazio">Nenhuma parcela a vencer.</p>`);
    }
    function despesas(box, planos) {
        if (!planos.length) { box.innerHTML = `<p class="pg-vazio">Nenhuma despesa paga no período.</p>`; return; }
        const total = planos.reduce((s, p) => s + Number(p.total), 0);
        const top = planos.slice(0, 4), resto = planos.slice(4).reduce((s, p) => s + Number(p.total), 0);
        const partes = [ ...top.map((p, i) => ({ nome: p.nome, v: Number(p.total), cor: [ COR.s1, COR.s2, COR.s3, clarear(COR.s2, 0.45) ][i] })), ...(resto > 0 ? [ { nome: "Outros", v: resto, cor: "#9aa6ab" } ] : []) ];
        box.innerHTML = `<div class="pg-pilha">${partes.map(p => `<span style="width:${(p.v / total * 100).toFixed(2)}%;background:${p.cor}" data-parte="${h(p.nome)}"></span>`).join("")}</div>
          <ul class="pg-partes">${partes.map(p => `<li><i style="background:${p.cor}"></i><span>${h(p.nome)}</span><b>${h(dinheiro(p.v))}</b><small>${h(pct(p.v / total * 100))}</small></li>`).join("")}</ul>
          <p class="pg-nota">Total pago no período: <b>${h(dinheiro(total))}</b></p>`;
        box.querySelectorAll("[data-parte]").forEach(sp => { const p = partes.find(x => x.nome === sp.dataset.parte); ligarDica(sp, () => `<b>${h(p.nome)}</b><br>${h(dinheiro(p.v))} · ${h(pct(p.v / total * 100))}`); });
    }

    function sair() { fechar(); ultimo = null; const b = $("painelAbrir"); if (b) b.hidden = true; }

    window.SKLPainel = { iniciar, abrir, fechar, sair };
})();
