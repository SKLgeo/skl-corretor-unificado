// Painel de indicadores do CRM (substitui o Power BI): funil, resultados, origem, perdas, equipe, estoque,
// demanda sem estoque e padrão dos clientes. Lê os dados que o crm.js já carregou (SKLCRM.interno) e os
// atendimentos do período. Exporta em PDF (impressão) e CSV para Excel.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const DIA = 86400000;
    let ligado = false;
    let atividades = [];
    let atividadesDesde = null;
    let carregando = null;
    let ultimoCsv = [];

    const I = () => window.SKLCRM && window.SKLCRM.interno;
    const h = v => I().ctx().h(v);

    function inicioDoPeriodo(valor) {
        const agora = new Date();
        if (valor === "mes") return new Date(agora.getFullYear(), agora.getMonth(), 1);
        if (valor === "ano") return new Date(agora.getFullYear(), 0, 1);
        if (valor === "tudo") return new Date(2000, 0, 1);
        return new Date(Date.now() - Number(valor) * DIA);
    }
    function rotuloPeriodo(valor) {
        return { mes: "este mês", "30": "últimos 30 dias", "90": "últimos 90 dias", ano: "este ano", tudo: "todo o período" }[valor] || "";
    }
    function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
    function media(lista) { return lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : 0; }

    function ligar() {
        if (ligado) return;
        ligado = true;
        [ "painelPeriodo", "painelFunil", "painelCorretor", "painelPadrao" ].forEach(id => $(id).addEventListener("change", render));
        $("painelImprimir").addEventListener("click", imprimir);
        $("painelExportar").addEventListener("click", exportarCsv);
    }

    async function carregarAtividades(desde) {
        const x = I();
        if (atividadesDesde && atividadesDesde <= desde) return;
        if (carregando) return carregando;
        carregando = (async () => {
            const { data } = await x.ctx().sb.from("crm_atividades").select("tipo, autor_id, created_at, negociacao_id, dados")
                .eq("carteira_id", x.ctx().carteiraId()).gte("created_at", desde.toISOString()).order("created_at", { ascending: false }).limit(20000);
            atividades = data || [];
            atividadesDesde = desde;
        })();
        await carregando;
        carregando = null;
    }

    function preencherFiltros() {
        const x = I();
        const sel = $("painelCorretor");
        const central = x.ctx().central();
        sel.hidden = !central;
        if (central) {
            const atual = sel.value;
            const equipe = x.ctx().equipe().slice().sort((a, b) => x.normal(a.display_name).localeCompare(x.normal(b.display_name)));
            sel.innerHTML = `<option value="">Toda a equipe</option>` + equipe.map(u => `<option value="${h(u.id)}">${h(u.display_name)}</option>`).join("");
            sel.value = [ ...sel.options ].some(o => o.value === atual) ? atual : "";
        }
    }

    async function render() {
        const x = I();
        if (!x || !x.ctx() || !$("page-indicadores")) return;
        ligar();
        preencherFiltros();
        const periodo = $("painelPeriodo").value || "90";
        const desde = inicioDoPeriodo(periodo);
        await carregarAtividades(desde);
        const filtroFunil = $("painelFunil").value;
        const filtroCorretor = x.ctx().central() ? $("painelCorretor").value : "";
        const filtroPadrao = $("painelPadrao").value;
        const funis = x.funis().filter(f => !filtroFunil || f.finalidade === filtroFunil);
        const idsFunis = new Set(funis.map(f => f.id));
        const todas = [ ...x.negs.values() ].filter(n => idsFunis.has(n.funil_id)
            && (!filtroCorretor || n.corretor_id === filtroCorretor)
            && (!filtroPadrao || x.padraoDe(n) === filtroPadrao));
        const noPeriodo = d => d && new Date(d) >= desde;
        const novas = todas.filter(n => noPeriodo(n.created_at));
        const ganhas = todas.filter(n => n.situacao === "ganha" && noPeriodo(n.fechado_em));
        const perdidas = todas.filter(n => n.situacao === "perdida" && noPeriodo(n.fechado_em));
        const abertas = todas.filter(n => n.situacao === "aberta");
        const somaFin = (lista, fin) => lista.filter(n => (x.funil(n.funil_id) || {}).finalidade === fin).reduce((s, n) => s + (Number(n.valor) || 0), 0);
        const tempos = ganhas.map(n => (new Date(n.fechado_em) - new Date(n.created_at)) / DIA).filter(d => d >= 0);
        ultimoCsv = [];

        // ---------- números principais
        const kpis = [
            [ "Novos contatos", novas.length, rotuloPeriodo(periodo) ],
            [ "Em andamento", abertas.length, abertas.length ? x.dinheiroCurto(abertas.reduce((s, n) => s + (Number(n.valor) || 0), 0)) + " em negociação" : "" ],
            [ "Fechados", ganhas.length, [ somaFin(ganhas, "venda") ? x.dinheiroCurto(somaFin(ganhas, "venda")) + " em vendas" : "", somaFin(ganhas, "locacao") ? x.dinheiroCurto(somaFin(ganhas, "locacao")) + "/mês em aluguéis" : "" ].filter(Boolean).join(" · ") ],
            [ "Perdidos", perdidas.length, "" ],
            [ "Conversão", ganhas.length + perdidas.length ? pct(ganhas.length, ganhas.length + perdidas.length) + "%" : "—", "fechados ÷ encerrados" ],
            [ "Tempo até fechar", tempos.length ? Math.round(media(tempos)) + " dias" : "—", "média do 1º contato ao fechamento" ]
        ];
        $("painelKpis").innerHTML = kpis.map(([ r, v, s ]) => `<div class="crm-resumo-item"><span>${h(r)}</span><strong>${h(v)}</strong>${s ? `<small>${h(s)}</small>` : ""}</div>`).join("");
        ultimoCsv.push([ "Indicador", "Valor", "Detalhe" ], ...kpis.map(k => k.map(String)), []);

        // ---------- funil: quantas negociações criadas no período chegaram a cada etapa
        const alcancePorNeg = new Map();
        novas.forEach(n => {
            const et = x.etapa(n.etapa_id);
            let max = et && et.tipo === "aberta" ? et.ordem : (et && et.tipo === "ganho" ? 999 : 0);
            alcancePorNeg.set(n.id, max);
        });
        atividades.filter(a => a.tipo === "etapa" && alcancePorNeg.has(a.negociacao_id)).forEach(a => {
            [ a.dados && a.dados.de, a.dados && a.dados.para ].forEach(id => {
                const et = id && x.etapa(id);
                if (!et) return;
                const ordem = et.tipo === "aberta" ? et.ordem : (et.tipo === "ganho" ? 999 : 0);
                if (ordem > alcancePorNeg.get(a.negociacao_id)) alcancePorNeg.set(a.negociacao_id, ordem);
            });
        });
        $("painelFunis").innerHTML = funis.map(f => {
            const etapas = x.etapasDoFunil(f.id).filter(e => e.tipo !== "perdido");
            const doFunil = novas.filter(n => n.funil_id === f.id);
            const linhas = etapas.map(e => {
                const ordem = e.tipo === "ganho" ? 999 : e.ordem;
                const qtd = doFunil.filter(n => Math.max(alcancePorNeg.get(n.id) || 0, 1) >= ordem).length;
                return { e, qtd };
            });
            const base = linhas.length ? linhas[0].qtd : 0;
            ultimoCsv.push([ `Funil de ${f.nome}`, "Chegaram", "% do início" ], ...linhas.map(l => [ l.e.nome, String(l.qtd), pct(l.qtd, base) + "%" ]), []);
            return `<article class="panel painel-bloco"><h3>Funil de ${h(f.nome)}</h3><p class="muted-text">${doFunil.length} contato(s) novo(s) · ${h(rotuloPeriodo(periodo))}</p>
              <div class="painel-funil">${linhas.map((l, i) => {
                  const ant = i ? linhas[i - 1].qtd : null;
                  return `<div class="painel-funil-linha">
                    <span class="painel-funil-nome">${h(l.e.nome)}</span>
                    <span class="painel-barra"><i style="width:${base && l.qtd ? Math.max(4, pct(l.qtd, base)) : 0}%;background:${h(l.e.cor || "#64748b")}"></i></span>
                    <strong>${l.qtd}</strong>
                    <small>${i && ant ? pct(l.qtd, ant) + "% da etapa anterior" : ""}</small>
                  </div>`;
              }).join("")}</div></article>`;
        }).join("") || `<p class="muted-text">Sem funis.</p>`;

        // ---------- origem
        const origens = new Map();
        novas.forEach(n => { const o = n.origem || "Não informada"; const r = origens.get(o) || { novos: 0, ganhos: 0, valor: 0 }; r.novos++; origens.set(o, r); });
        ganhas.forEach(n => { const o = n.origem || "Não informada"; const r = origens.get(o) || { novos: 0, ganhos: 0, valor: 0 }; r.ganhos++; r.valor += Number(n.valor) || 0; origens.set(o, r); });
        const listaOrigem = [ ...origens.entries() ].sort((a, b) => b[1].novos - a[1].novos || b[1].ganhos - a[1].ganhos);
        $("painelOrigem").innerHTML = tabela([ "Origem", "Novos", "Fechados", "Conversão" ], listaOrigem.map(([ o, r ]) => [ o, r.novos, r.ganhos, r.novos ? pct(r.ganhos, r.novos) + "%" : "—" ]));
        ultimoCsv.push([ "Origem", "Novos", "Fechados", "Conversão" ], ...listaOrigem.map(([ o, r ]) => [ o, String(r.novos), String(r.ganhos), r.novos ? pct(r.ganhos, r.novos) + "%" : "" ]), []);

        // ---------- motivos de perda
        const perdasPorMotivo = new Map();
        perdidas.forEach(n => {
            const m = x.motivos().find(mm => mm.id === n.motivo_perda_id);
            const nome = m ? m.nome : "Sem motivo";
            const r = perdasPorMotivo.get(nome) || { qtd: 0, valor: 0 };
            r.qtd++; r.valor += Number(n.valor) || 0;
            perdasPorMotivo.set(nome, r);
        });
        const listaPerda = [ ...perdasPorMotivo.entries() ].sort((a, b) => b[1].qtd - a[1].qtd);
        const maxPerda = Math.max(1, ...listaPerda.map(([ , r ]) => r.qtd));
        $("painelPerdas").innerHTML = listaPerda.length ? listaPerda.map(([ nome, r ]) => `<div class="painel-funil-linha">
            <span class="painel-funil-nome">${h(nome)}</span><span class="painel-barra"><i style="width:${pct(r.qtd, maxPerda)}%;background:#bd5147"></i></span>
            <strong>${r.qtd}</strong><small>${r.valor ? h(x.dinheiroCurto(r.valor)) : ""}</small></div>`).join("") : `<p class="muted-text">Nenhuma perda no período.</p>`;
        ultimoCsv.push([ "Motivo de perda", "Quantidade", "Valor" ], ...listaPerda.map(([ n, r ]) => [ n, String(r.qtd), String(r.valor) ]), []);

        // ---------- equipe
        const ctx = x.ctx();
        const pessoas = new Map();
        const pessoa = id => { const k = id || "__sem"; if (!pessoas.has(k)) pessoas.set(k, { id, novos: 0, atend: 0, ganhos: 0, perdidos: 0, valor: 0, atrasadas: 0, visitas: 0 }); return pessoas.get(k); };
        novas.forEach(n => pessoa(n.corretor_id).novos++);
        ganhas.forEach(n => { const p = pessoa(n.corretor_id); p.ganhos++; p.valor += Number(n.valor) || 0; });
        perdidas.forEach(n => pessoa(n.corretor_id).perdidos++);
        abertas.filter(n => x.situacaoAcao(n) === "atrasada").forEach(n => pessoa(n.corretor_id).atrasadas++);
        atividades.filter(a => [ "ligacao", "whatsapp", "visita", "email", "anotacao" ].includes(a.tipo) && (!filtroCorretor || a.autor_id === filtroCorretor)).forEach(a => pessoa(a.autor_id).atend++);
        [ ...(x.visitas ? x.visitas.values() : []) ].filter(v => v.situacao === "realizada" && noPeriodo(v.registrado_em || v.agendada_para)
            && (!filtroCorretor || v.corretor_id === filtroCorretor)).forEach(v => pessoa(v.corretor_id).visitas++);
        const listaEquipe = [ ...pessoas.values() ].filter(p => p.novos || p.atend || p.ganhos || p.perdidos || p.atrasadas || p.visitas)
            .sort((a, b) => b.ganhos - a.ganhos || b.valor - a.valor || b.atend - a.atend);
        $("painelEquipe").innerHTML = tabela([ "Corretor", "Novos", "Atendimentos", "Visitas", "Fechados", "Conversão", "Valor fechado", "Ações atrasadas" ],
            listaEquipe.map(p => [ { html: `<span class="crm-card-corretor">${ctx.fotoDoUsuario(p.id, 22)}<span>${h(x.corretorDe(p.id))}</span></span>` }, p.novos, p.atend, p.visitas, p.ganhos,
                p.ganhos + p.perdidos ? pct(p.ganhos, p.ganhos + p.perdidos) + "%" : "—", p.valor ? x.dinheiro(p.valor) : "—",
                p.atrasadas ? { html: `<span class="painel-alerta">${p.atrasadas}</span>` } : 0 ]));
        ultimoCsv.push([ "Corretor", "Novos", "Atendimentos", "Visitas", "Fechados", "Conversão", "Valor fechado", "Ações atrasadas" ],
            ...listaEquipe.map(p => [ x.corretorDe(p.id), String(p.novos), String(p.atend), String(p.visitas), String(p.ganhos), p.ganhos + p.perdidos ? pct(p.ganhos, p.ganhos + p.perdidos) + "%" : "", String(p.valor), String(p.atrasadas) ]), []);

        // ---------- estoque
        const imoveis = ctx.imoveis().filter(i => (i.aprovacao || "aprovado") === "aprovado");
        const disponiveis = imoveis.filter(i => i.status === "disponivel");
        const emNegociacao = new Set([ ...x.negs.values() ].filter(n => n.situacao === "aberta" && n.construcao_id).map(n => n.construcao_id));
        const semNegociacao = disponiveis.filter(i => !emNegociacao.has(i.id));
        const diasMercado = disponiveis.map(i => (Date.now() - new Date(i.aprovado_em || i.cadastrado_em || i.created_at)) / DIA).filter(d => d >= 0);
        const captacoes = imoveis.filter(i => noPeriodo(i.aprovado_em));
        const em30 = Date.now() + 30 * DIA;
        const exclusVencendo = imoveis.filter(i => i.exclusividade && i.exclusividade_ate && new Date(i.exclusividade_ate + "T23:59:59") <= em30);
        const contar = (lista, chave) => { const m = new Map(); lista.forEach(i => { const k = chave(i) || "Não informado"; m.set(k, (m.get(k) || 0) + 1); }); return [ ...m.entries() ].sort((a, b) => b[1] - a[1]); };
        $("painelEstoqueNumeros").innerHTML = [
            [ "Disponíveis para venda", disponiveis.filter(i => i.para_venda).length ],
            [ "Disponíveis para aluguel", disponiveis.filter(i => i.para_aluguel !== false).length ],
            [ "Sem negociação aberta", semNegociacao.length ],
            [ "Tempo médio no mercado", diasMercado.length ? Math.round(media(diasMercado)) + " dias" : "—" ],
            [ "Captações no período", captacoes.length ],
            [ "Exclusividades vencendo (30 dias)", exclusVencendo.length ]
        ].map(([ r, v ]) => `<div class="crm-resumo-item"><span>${h(r)}</span><strong>${h(v)}</strong></div>`).join("");
        $("painelEstoqueTipo").innerHTML = barras(contar(disponiveis, i => i.tipo_imovel), "#29abe2");
        $("painelEstoqueBairro").innerHTML = barras(contar(disponiveis, i => i.bairro).slice(0, 8), "#0f766e");
        $("painelSemNegociacao").innerHTML = semNegociacao.length
            ? semNegociacao.slice(0, 8).map(i => `<li>${h(i.codigo ? i.codigo + " · " : "")}${h(i.nome)}</li>`).join("") + (semNegociacao.length > 8 ? `<li class="muted-text">e mais ${semNegociacao.length - 8}…</li>` : "")
            : `<li class="muted-text">Todos os imóveis disponíveis têm negociação aberta.</li>`;
        $("painelExclusividades").innerHTML = exclusVencendo.length
            ? exclusVencendo.map(i => `<li>${h(i.codigo ? i.codigo + " · " : "")}${h(i.nome)} — até ${h(x.dataCurta(i.exclusividade_ate + "T12:00:00"))}</li>`).join("")
            : `<li class="muted-text">Nenhuma exclusividade vence nos próximos 30 dias.</li>`;
        ultimoCsv.push([ "Estoque", "Quantidade" ], [ "Disponíveis para venda", String(disponiveis.filter(i => i.para_venda).length) ], [ "Disponíveis para aluguel", String(disponiveis.filter(i => i.para_aluguel !== false).length) ],
            [ "Sem negociação aberta", String(semNegociacao.length) ], [ "Captações no período", String(captacoes.length) ], []);

        // ---------- demanda sem estoque
        const semEstoque = abertas.filter(n => !x.perfilVazio(n.perfil_busca)).filter(n => {
            const f = x.funil(n.funil_id);
            return !imoveis.some(i => { const r = x.compatibilidade(n.perfil_busca, f ? f.finalidade : "", i); return r && r.pct >= 75; });
        });
        const pedidosBairro = new Map(), pedidosTipo = new Map();
        semEstoque.forEach(n => {
            (n.perfil_busca.bairros || []).forEach(b => pedidosBairro.set(b, (pedidosBairro.get(b) || 0) + 1));
            if (n.perfil_busca.tipo) pedidosTipo.set(n.perfil_busca.tipo, (pedidosTipo.get(n.perfil_busca.tipo) || 0) + 1);
        });
        $("painelDemanda").innerHTML = semEstoque.length
            ? `<p class="muted-text">${semEstoque.length} cliente(s) em negociação procuram algo que a carteira não tem (nenhum imóvel com 75% ou mais de compatibilidade).</p>
               <div class="painel-duas"><div><h4>Bairros mais pedidos</h4>${barras([ ...pedidosBairro.entries() ].sort((a, b) => b[1] - a[1]).slice(0, 6), "#7c3aed") || "<p class=\"muted-text\">—</p>"}</div>
               <div><h4>Tipos mais pedidos</h4>${barras([ ...pedidosTipo.entries() ].sort((a, b) => b[1] - a[1]).slice(0, 6), "#d59a22") || "<p class=\"muted-text\">—</p>"}</div></div>
               <ul class="painel-lista">${semEstoque.slice(0, 8).map(n => { const c = x.clientes.get(n.cliente_id); const p = n.perfil_busca; return `<li><a href="#" data-neg="${h(n.id)}">${h(c ? c.nome : "Cliente")}</a> — ${h([ p.tipo, (p.bairros || []).join("/"), p.valor_max ? "até " + x.dinheiro(p.valor_max) : "", p.quartos_min ? p.quartos_min + "+ quartos" : "" ].filter(Boolean).join(", "))}</li>`; }).join("")}</ul>`
            : `<p class="muted-text">Toda a procura dos clientes em negociação tem imóvel compatível na carteira.</p>`;
        $("painelDemanda").querySelectorAll("[data-neg]").forEach(a => a.addEventListener("click", ev => { ev.preventDefault(); x.abrirNegociacao(a.dataset.neg); }));

        // ---------- indicações
        const indicados = [ ...x.clientes.values() ].filter(c => c.indicado_por && noPeriodo(c.created_at));
        const porIndicador = new Map();
        indicados.forEach(c => {
            const r = porIndicador.get(c.indicado_por) || { qtd: 0, fechados: 0 };
            r.qtd++;
            if ([ ...x.negs.values() ].some(n => n.cliente_id === c.id && n.situacao === "ganha")) r.fechados++;
            porIndicador.set(c.indicado_por, r);
        });
        const listaInd = [ ...porIndicador.entries() ].sort((a, b) => b[1].qtd - a[1].qtd || b[1].fechados - a[1].fechados).slice(0, 10);
        const nomeCli = id => { const c = x.clientes.get(id); return c ? c.nome : "Cliente"; };
        if ($("painelIndicacoes")) $("painelIndicacoes").innerHTML = indicados.length
            ? `<p class="muted-text">${indicados.length} cliente(s) novo(s) chegaram por indicação (${h(rotuloPeriodo(periodo).toLowerCase())}).</p>`
              + tabela([ "Quem indicou", "Indicações", "Viraram negócio" ], listaInd.map(([ id, r ]) => [ nomeCli(id), r.qtd, r.fechados ]))
            : `<p class="muted-text">Nenhum cliente marcado como indicação no período. No cadastro do cliente, escolha a origem "Indicação" e quem indicou.</p>`;
        ultimoCsv.push([ "Quem indicou", "Indicações", "Viraram negócio" ], ...listaInd.map(([ id, r ]) => [ nomeCli(id), String(r.qtd), String(r.fechados) ]), []);

        // ---------- padrão dos clientes em negociação
        const porPadrao = { economico: [], medio: [], alto: [] };
        abertas.forEach(n => { const p = x.padraoDe(n); if (p) porPadrao[p].push(n); });
        const fx = x.faixas();
        $("painelPadraoBloco").innerHTML = Object.keys(porPadrao).map(p => `<div class="crm-resumo-item painel-padrao-${p}"><span>${h(x.PADROES[p])}</span><strong>${porPadrao[p].length}</strong><small>${porPadrao[p].length ? h(x.dinheiroCurto(porPadrao[p].reduce((s, n) => s + (Number(n.valor) || 0), 0))) + " em negociação" : ""}</small></div>`).join("")
            + `<p class="muted-text painel-nota">Faixas da carteira — venda: médio a partir de ${h(x.dinheiro(fx.venda && fx.venda.medio))}, alto a partir de ${h(x.dinheiro(fx.venda && fx.venda.alto))}; locação: médio a partir de ${h(x.dinheiro(fx.locacao && fx.locacao.medio))}, alto a partir de ${h(x.dinheiro(fx.locacao && fx.locacao.alto))}. ${ctx.central() ? "Altere em Configurações." : ""}</p>`;
        $("painelAtualizado").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${rotuloPeriodo(periodo)}${filtroCorretor ? " · " + x.corretorDe(filtroCorretor) : ""}`;
    }

    function tabela(cabecalho, linhas) {
        if (!linhas.length) return `<p class="muted-text">Sem dados no período.</p>`;
        const cel = v => v && typeof v === "object" && "html" in v ? v.html : h(v);
        return `<div class="painel-tabela"><table><thead><tr>${cabecalho.map(c => `<th>${h(c)}</th>`).join("")}</tr></thead>
          <tbody>${linhas.map(l => `<tr>${l.map(v => `<td>${cel(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    function barras(pares, cor) {
        if (!pares.length) return "";
        const max = Math.max(1, ...pares.map(([ , v ]) => v));
        return pares.map(([ nome, v ]) => `<div class="painel-funil-linha"><span class="painel-funil-nome">${h(nome)}</span>
            <span class="painel-barra"><i style="width:${pct(v, max)}%;background:${cor}"></i></span><strong>${v}</strong><small></small></div>`).join("");
    }

    function imprimir() {
        document.body.classList.add("imprimindo-painel");
        const fim = () => document.body.classList.remove("imprimindo-painel");
        if (window.NativeBridge && typeof window.NativeBridge.printPage === "function") {
            window.NativeBridge.printPage();
            setTimeout(fim, 4000);
        } else {
            window.addEventListener("afterprint", fim, { once: true });
            window.print();
            setTimeout(fim, 1500);
        }
    }
    function exportarCsv() {
        const esc = v => { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const texto = "﻿" + ultimoCsv.map(l => l.map(esc).join(";")).join("\r\n");
        const nome = `indicadores_${new Date().toISOString().slice(0, 10)}.csv`;
        if (window.NativeBridge && typeof window.NativeBridge.saveTextFile === "function") {
            window.NativeBridge.saveTextFile(btoa(unescape(encodeURIComponent(texto))), nome, "text/csv");
            return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([ texto ], { type: "text/csv;charset=utf-8" }));
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    window.SKLCRMPainel = { render, invalidar: () => { atividadesDesde = null; } };
})();
