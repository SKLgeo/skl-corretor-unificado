// Indicadores → "📍 Mercado": o que mais FECHA e o que os clientes mais PROCURAM, por faixa de valor, bairro (urbano),
// cidade (rural) e tipo de imóvel. Serve para orientar a captação ("busquem aluguel até R$ 2.500 no bairro X").
// Fechados = negócios ganhos no período + contratos lançados sem negócio (locação e compra e venda).
// Procurados = negócios criados no período (inclui os contatos do site e dos portais): o que o cliente procura (bairros, tipo,
// valor) ou o imóvel em que ele se interessou. Usa o período e o corretor escolhidos no topo dos Indicadores.
// Os negócios do histórico (Power BI) têm valor mas não têm imóvel: entram nas faixas de valor, não nos bairros.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const I = () => window.SKLCRM && window.SKLCRM.interno;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const TIPOS_RURAIS = [ "fazenda", "sitio", "chacara rural", "haras", "rancho", "area rural", "terreno rural" ];
    // faixas do gráfico (os chips de cima filtram por qualquer valor digitado)
    const FAIXAS = {
        locacao: [ [ 0, 1000 ], [ 1000, 1500 ], [ 1500, 2000 ], [ 2000, 2500 ], [ 2500, 3500 ], [ 3500, 5000 ], [ 5000, 6000 ], [ 6000, Infinity ] ],
        venda: [ [ 0, 200000 ], [ 200000, 400000 ], [ 400000, 600000 ], [ 600000, 1000000 ], [ 1000000, 1500000 ], [ 1500000, 2500000 ], [ 2500000, Infinity ] ]
    };
    const ATALHOS = {
        locacao: [ [ "Até R$ 1.500", null, 1500 ], [ "Até R$ 2.500", null, 2500 ], [ "R$ 2.500 a 6.000", 2500, 6000 ], [ "Acima de R$ 6.000", 6000, null ] ],
        venda: [ [ "Até R$ 300 mil", null, 300000 ], [ "R$ 300 a 600 mil", 300000, 600000 ], [ "R$ 600 mil a 1 mi", 600000, 1000000 ], [ "Acima de R$ 1 mi", 1000000, null ] ]
    };
    let aberto = false, fonte = "fechados", fin = null, vMin = null, vMax = null, ligado = false, ultimo = [];

    function dinheiro(v) {
        if (v == null || !isFinite(v)) return "—";
        if (v >= 1000000) return "R$ " + (v / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
        if (v >= 100000) return "R$ " + Math.round(v / 1000).toLocaleString("pt-BR") + " mil";
        return "R$ " + Math.round(v).toLocaleString("pt-BR");
    }
    const rotuloFaixa = ([ a, b ]) => b === Infinity ? "Acima de " + dinheiro(a) : a === 0 ? "Até " + dinheiro(b) : dinheiro(a) + " a " + dinheiro(b);
    const ehRural = (tipo, rural) => !!rural || TIPOS_RURAIS.includes(norm(tipo));

    function ligar() {
        if (ligado) return;
        ligado = true;
        const b = $("painelMercadoBotao");
        if (b) b.addEventListener("click", () => {
            aberto = !aberto;
            b.classList.toggle("ativo", aberto);
            render();
            if (aberto) $("painelMercado").scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    // ------------------------------------------------------------------ dados
    function registros(x, estado) {
        const ctx = x.ctx();
        const imoveis = new Map((ctx.imoveis ? ctx.imoveis() : []).map(i => [ i.id, i ]));
        const dentro = d => { if (!d) return false; const t = new Date(String(d).length === 10 ? d + "T12:00:00" : d); return t >= estado.desde && t <= estado.ate; };
        const doCorretor = id => !estado.corretor || id === estado.corretor;
        const finDe = n => (x.funil(n.funil_id) || {}).finalidade;
        const valorImovel = (im, f) => im ? Number(f === "venda" ? im.valor_venda : im.valor_aluguel) || null : null;
        const lista = [];
        const doImovel = im => im ? { bairro: im.rural ? "" : (im.bairro || ""), cidade: im.cidade || "", tipo: im.tipo_imovel || "", rural: ehRural(im.tipo_imovel, im.rural) } : null;
        if (fonte === "fechados") {
            [ ...x.negs.values() ].forEach(n => {
                if (n.situacao !== "ganha" || !dentro(n.fechado_em) || !doCorretor(n.corretor_id)) return;
                const f = finDe(n);
                if (f !== "venda" && f !== "locacao") return;
                const im = imoveis.get(n.construcao_id);
                lista.push({ fin: f, valor: Number(n.valor) || valorImovel(im, f), local: doImovel(im), historico: !!n.importacao });
            });
            // contratos lançados direto no Financeiro (sem negócio no CRM)
            const F = window.SKLFinanceiro;
            if (F && F.contratos && (!ctx.pode || ctx.pode("ver_financeiro"))) {
                const avulso = a => a ? { bairro: ehRural(a.tipo) ? "" : (a.bairro || ""), cidade: a.cidade || "", tipo: a.tipo || "", rural: ehRural(a.tipo) } : null;
                (F.contratos() || []).forEach(c => {
                    if (c.negociacao_id || c.status === "cancelado" || !dentro(c.inicio) || !doCorretor(c.corretor_id)) return;
                    const im = imoveis.get(c.construcao_id);
                    lista.push({ fin: "locacao", valor: Number(c.valor_aluguel) || null, local: im ? doImovel(im) : avulso(c.imovel_avulso), contrato: true });
                });
                (F.vendas ? F.vendas() : []).forEach(c => {
                    if (c.negociacao_id || c.status === "cancelado" || !dentro(c.data_contrato) || !doCorretor(c.corretor_id)) return;
                    const im = imoveis.get(c.construcao_id);
                    lista.push({ fin: "venda", valor: Number(c.valor_venda) || null, local: im ? doImovel(im) : avulso(c.imovel_avulso), contrato: true });
                });
            }
        } else {
            [ ...x.negs.values() ].forEach(n => {
                if (n.importacao || !dentro(n.created_at) || !doCorretor(n.corretor_id)) return;
                const f = finDe(n);
                if (f !== "venda" && f !== "locacao") return;
                const im = imoveis.get(n.construcao_id);
                const p = n.perfil_busca || {};
                const proc = n.imovel_procurado || null;
                const valor = Number(p.valor_max) || Number(n.valor) || Number(p.valor_min) || valorImovel(im, f)
                    || (proc && x.ctx().parseValor ? x.ctx().parseValor(String(proc.valor || "")) : null) || null;
                const tipo = (im && im.tipo_imovel) || p.tipo || (proc && proc.tipo) || "";
                const rural = ehRural(tipo, im && im.rural);
                // onde: o imóvel em que se interessou; senão os bairros que pediu; senão a região escrita na procura
                let locais = [];
                if (im) locais = [ doImovel(im) ];
                else if ((p.bairros || []).length) locais = p.bairros.map(b => ({ bairro: rural ? "" : b, cidade: rural ? b : "", tipo, rural }));
                else if (proc && proc.regiao) locais = [ { bairro: rural ? "" : proc.regiao, cidade: rural ? proc.regiao : "", tipo, rural } ];
                lista.push({ fin: f, valor, locais: locais.length ? locais : null, local: locais[0] || (tipo ? { bairro: "", cidade: "", tipo, rural } : null) });
            });
        }
        return lista;
    }

    // ------------------------------------------------------------------ tela
    function render() {
        ligar();
        const box = $("painelMercado");
        const x = I();
        if (!box || !x || !x.ctx()) return;
        box.hidden = !aberto;
        if (!aberto) { ultimo = []; return; }
        const P = window.SKLCRMPainel, estado = P && P.estado ? P.estado() : null;
        if (!estado) return;
        if (!fin) fin = estado.funil === "venda" ? "venda" : "locacao";
        const todos = registros(x, estado).filter(r => r.fin === fin);
        const noFiltro = r => r.valor != null && (vMin == null || r.valor >= vMin) && (vMax == null || r.valor <= vMax);
        const filtrados = (vMin != null || vMax != null) ? todos.filter(noFiltro) : todos;
        const comValor = filtrados.filter(r => r.valor != null);
        const valores = comValor.map(r => r.valor).sort((a, b) => a - b);
        const media = valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
        const mediana = valores.length ? (valores.length % 2 ? valores[(valores.length - 1) / 2] : (valores[valores.length / 2 - 1] + valores[valores.length / 2]) / 2) : null;
        const sufixo = fin === "locacao" ? "/mês" : "";
        const nomeFonte = fonte === "fechados" ? "fechados" : "procurados";

        // faixas (sempre de todos, destacando as que estão dentro do filtro)
        const faixas = FAIXAS[fin].map(fx => ({ fx, qtd: todos.filter(r => r.valor != null && r.valor >= fx[0] && r.valor < fx[1]).length }));
        const maxF = Math.max(1, ...faixas.map(f => f.qtd));
        const dentroFiltro = fx => (vMin == null || fx[1] > vMin) && (vMax == null || fx[0] < vMax);
        const temFiltro = vMin != null || vMax != null;

        // rankings (bairro urbano, cidade rural, tipo) dentro do filtro
        const conta = (pegar) => {
            const m = new Map();
            filtrados.forEach(r => (r.locais || (r.local ? [ r.local ] : [])).forEach(l => {
                const nome = pegar(l);
                if (!nome) return;
                const k = norm(nome), it = m.get(k) || { nome, qtd: 0, soma: 0, nv: 0 };
                it.qtd++;
                if (r.valor != null) { it.soma += r.valor; it.nv++; }
                m.set(k, it);
            }));
            return [ ...m.values() ].sort((a, b) => b.qtd - a.qtd || b.soma - a.soma);
        };
        const bairros = conta(l => !l.rural && l.bairro);
        const cidades = conta(l => l.rural && (l.cidade || l.bairro));
        const tipos = conta(l => l.tipo);
        const semLocal = filtrados.filter(r => !(r.locais || (r.local && (r.local.bairro || r.local.cidade)))).length;
        const historico = filtrados.filter(r => r.historico).length;

        const ranking = (titulo, itens, vazio) => `<div class="mk-rank"><h4>${h(titulo)}</h4>${itens.length ? (() => {
            const max = Math.max(1, ...itens.map(i => i.qtd));
            return itens.slice(0, 10).map((i, k) => `<div class="painel-funil-linha"><span class="painel-funil-nome">${k === 0 ? "🏆 " : ""}${h(i.nome)}</span>
                <span class="painel-barra"><i style="width:${Math.max(4, i.qtd / max * 100)}%"></i></span><strong>${i.qtd}</strong>
                <small>${i.nv ? "média " + h(dinheiro(i.soma / i.nv)) + sufixo : ""}</small></div>`).join("");
        })() : `<p class="muted-text">${h(vazio)}</p>`}</div>`;

        box.innerHTML = `
          <div class="mk-topo">
            <div><h3>📍 Mercado: o que ${fonte === "fechados" ? "mais fecha" : "os clientes mais procuram"}</h3>
              <p class="muted-text">${h(estado.rotulo)}${estado.corretorNome ? " · " + h(estado.corretorNome) : ""}. Use para orientar a captação: faixa de valor, bairros e tipos com mais saída.</p></div>
            <div class="mk-chaves">
              <div class="segmentado" role="group" aria-label="Fechados ou procurados">
                <button type="button" data-mk-fonte="fechados" class="${fonte === "fechados" ? "ativo" : ""}">✅ Fechados</button>
                <button type="button" data-mk-fonte="procurados" class="${fonte === "procurados" ? "ativo" : ""}">🔎 Procurados</button></div>
              <div class="segmentado" role="group" aria-label="Locação ou venda">
                <button type="button" data-mk-fin="locacao" class="${fin === "locacao" ? "ativo" : ""}">Locação</button>
                <button type="button" data-mk-fin="venda" class="${fin === "venda" ? "ativo" : ""}">Venda</button></div>
            </div>
          </div>
          <div class="mk-filtro">
            <span class="crm-rotulo">Faixa de valor${fin === "locacao" ? " (aluguel por mês)" : ""}</span>
            <div class="mk-atalhos">${ATALHOS[fin].map(([ r, a, b ]) => `<button type="button" class="mk-chip${vMin === a && vMax === b ? " ativo" : ""}" data-mk-a="${a ?? ""}" data-mk-b="${b ?? ""}">${h(r)}</button>`).join("")}
              <button type="button" class="mk-chip${!temFiltro ? " ativo" : ""}" data-mk-a="" data-mk-b="">Todas</button></div>
            <div class="mk-de-ate"><label><span>De R$</span><input id="mkMin" inputmode="decimal" autocomplete="off" value="${vMin != null ? h(vMin.toLocaleString("pt-BR")) : ""}" placeholder="sem mínimo" /></label>
              <label><span>até R$</span><input id="mkMax" inputmode="decimal" autocomplete="off" value="${vMax != null ? h(vMax.toLocaleString("pt-BR")) : ""}" placeholder="sem máximo" /></label>
              <button id="mkAplicar" type="button" class="secondary-button fin-mini">Filtrar</button></div>
          </div>
          <div class="crm-resumo painel-kpis mk-kpis">
            <div class="crm-resumo-item"><span>${fonte === "fechados" ? "Negócios fechados" : "Clientes procurando"}</span><strong>${filtrados.length}</strong><small>${temFiltro ? "de " + todos.length + " no período" : "no período"}</small></div>
            <div class="crm-resumo-item"><span>Valor médio</span><strong>${h(dinheiro(media))}</strong><small>${sufixo ? "por mês" : ""}</small></div>
            <div class="crm-resumo-item"><span>Valor do meio (mediana)</span><strong>${h(dinheiro(mediana))}</strong><small>metade abaixo, metade acima</small></div>
            <div class="crm-resumo-item"><span>Fatia do período</span><strong>${todos.length ? Math.round(filtrados.length * 100 / todos.length) : 0}%</strong><small>${temFiltro ? "nesta faixa" : "todas as faixas"}</small></div>
          </div>
          <h4 class="mk-h">Por faixa de valor <small>(toque numa barra para filtrar)</small></h4>
          <div class="mk-faixas">${faixas.map(({ fx, qtd }) => `<button type="button" class="mk-faixa${temFiltro && dentroFiltro(fx) ? " ativo" : ""}" data-mk-a="${fx[0] || ""}" data-mk-b="${fx[1] === Infinity ? "" : fx[1]}" title="${h(rotuloFaixa(fx))}: ${qtd}">
              <span class="mk-faixa-barra"><i style="height:${qtd ? Math.max(6, qtd / maxF * 100) : 0}%"></i></span><b>${qtd}</b><small>${h(rotuloFaixa(fx))}</small></button>`).join("")}</div>
          <div class="mk-grade">
            ${ranking("Bairros (imóveis urbanos)", bairros, "Nenhum bairro informado nesta seleção.")}
            ${ranking("Cidades (imóveis rurais)", cidades, "Nenhum imóvel rural nesta seleção.")}
            ${ranking("Tipo de imóvel", tipos, "Sem tipo informado nesta seleção.")}
          </div>
          <p class="muted-text mk-nota">${[
            fonte === "fechados" ? "Fechados = negócios ganhos no período + contratos lançados no Financeiro sem negócio." : "Procurados = negócios abertos no período (inclui contatos do site e dos portais): o que o cliente procura ou o imóvel em que se interessou. Cada bairro pedido conta uma vez.",
            semLocal ? `${semLocal} sem bairro ou cidade (entram nas faixas de valor${historico ? `; ${historico} são do histórico do Power BI, que não traz o imóvel` : ""}).` : "",
            fonte === "procurados" ? "Para a procura ficar completa, preencha \"O que o cliente procura\" nas negociações." : "Os bairros aparecem nos negócios com imóvel ligado e nos contratos com bairro preenchido."
          ].filter(Boolean).map(h).join(" ")}</p>`;
        ultimo = [ [ `Mercado (${nomeFonte}, ${fin === "venda" ? "venda" : "locação"})`, estado.rotulo, temFiltro ? `faixa ${vMin != null ? dinheiro(vMin) : "—"} a ${vMax != null ? dinheiro(vMax) : "—"}` : "todas as faixas" ],
            [ "Faixa de valor", "Quantidade", "" ], ...faixas.map(f => [ rotuloFaixa(f.fx), String(f.qtd), "" ]),
            [ "Bairro", "Quantidade", "Valor médio" ], ...bairros.map(b => [ b.nome, String(b.qtd), b.nv ? dinheiro(b.soma / b.nv) : "" ]),
            [ "Cidade (rural)", "Quantidade", "Valor médio" ], ...cidades.map(b => [ b.nome, String(b.qtd), b.nv ? dinheiro(b.soma / b.nv) : "" ]),
            [ "Tipo", "Quantidade", "Valor médio" ], ...tipos.map(b => [ b.nome, String(b.qtd), b.nv ? dinheiro(b.soma / b.nv) : "" ]), [] ];

        const ctx = x.ctx(), num = v => { const n = ctx.parseValor ? ctx.parseValor(String(v || "")) : Number(v); return n == null || isNaN(n) ? null : n; };
        box.querySelectorAll("[data-mk-fonte]").forEach(b => b.addEventListener("click", () => { fonte = b.dataset.mkFonte; render(); }));
        box.querySelectorAll("[data-mk-fin]").forEach(b => b.addEventListener("click", () => { if (fin !== b.dataset.mkFin) { fin = b.dataset.mkFin; vMin = vMax = null; } render(); }));
        box.querySelectorAll("[data-mk-a]").forEach(b => b.addEventListener("click", () => {
            vMin = b.dataset.mkA === "" ? null : Number(b.dataset.mkA); vMax = b.dataset.mkB === "" ? null : Number(b.dataset.mkB);
            if (vMin === 0) vMin = null;
            render();
        }));
        const aplicar = () => { vMin = num($("mkMin").value); vMax = num($("mkMax").value); if (vMin != null && vMax != null && vMin > vMax) [ vMin, vMax ] = [ vMax, vMin ]; render(); };
        $("mkAplicar").addEventListener("click", aplicar);
        [ "mkMin", "mkMax" ].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); aplicar(); } }));
    }

    window.SKLMercado = { render, csv: () => ultimo, aberto: () => aberto };
})();
