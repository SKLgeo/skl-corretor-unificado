// Financeiro da administração de aluguéis (Bloco 4): contratos de locação, cobranças mensais com multa e juros,
// repasse ao proprietário (com taxa de administração e intermediação do 1º aluguel), reajuste, encerramento,
// recibo do inquilino e demonstrativo do proprietário. Toda escrita passa pelas RPCs fin_* do banco; o cálculo do
// repasse e da multa é feito lá (aqui só aparece uma prévia com a mesma conta).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const INDICES = { IPCA: "IPCA", IGPM: "IGP-M", INPC: "INPC", IVAR: "IVAR", nenhum: "Sem reajuste" };
    const GARANTIAS = { nenhuma: "Sem garantia", caucao: "Caução", fiador: "Fiador", seguro_fianca: "Seguro-fiança", titulo_capitalizacao: "Título de capitalização" };
    const FORMAS = [ "PIX", "Boleto", "Transferência", "Dinheiro", "Cartão", "Depósito" ];
    const FILTROS = {
        cobrancas: { abertas: "Em aberto (todas)", atrasadas: "Em atraso", mes: "Vencem no mês", pagas: "Pagas no mês", canceladas: "Canceladas", todas: "Todas do mês" },
        contratos: { ativos: "Ativos", reajuste: "Reajuste em até 30 dias", vencendo: "Terminando em até 60 dias", encerrados: "Encerrados", todos: "Todos" },
        repasses: { pendentes: "A repassar", pagos: "Repassados no mês", todos: "Todos do mês" }
    };

    let ctx = null, ligado = false, aba = "resumo";
    let contratos = [], cobrancas = [], repasses = [], clientes = new Map(), eventos = [];
    let resumo = null, carregando = null, canal = null, recarregarTimer = null;
    let contratoAberto = null, itens = [], cobrancaAberta = null;

    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const podeGerir = () => !!ctx && ctx.podeGerir();
    function dinheiro(v) {
        if (v == null || v === "") return "—";
        return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function num(v) { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null || Number.isNaN(n) ? null : n; }
    function pct(v) { return String(v ?? "").replace(".", ","); }
    function dataBr(iso) { return iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—"; }
    function mesAno(iso) {
        if (!iso) return "—";
        return new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "").replace(" de ", "/");
    }
    function hojeIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function diasEntre(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }
    function somaDias(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    function mesSel() { return $("finMes").value || hojeIso().slice(0, 7); }
    function noMes(iso, ym) { return !!iso && String(iso).slice(0, 7) === ym; }
    function normal(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function erro(e) { return ctx.traduzErro((e && e.message) || String(e || "")); }
    function msg(el, texto) { el.textContent = texto; el.hidden = !texto; }
    function itensTotal(lista) { return (lista || []).reduce((s, i) => s + (Number(i.valor) || 0), 0); }
    function digitos(t) { return String(t || "").replace(/\D/g, ""); }

    const cliente = id => clientes.get(id) || null;
    const nomeCli = id => (cliente(id) || {}).nome || "—";
    const imovel = id => ctx.imoveis().find(c => c.id === id) || null;
    const nomeImovel = id => { const c = imovel(id); return c ? ((c.codigo ? c.codigo + " · " : "") + c.nome) : "—"; };
    const contrato = id => contratos.find(c => c.id === id) || null;

    // ------------------------------------------------------------------ início e dados
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { ligarEventos(); ligado = true; }
        const ve = ctx.veTudo();
        $("navFinanceiro").hidden = !ve;
        document.querySelectorAll("[data-fin-gerir]").forEach(el => { el.hidden = !podeGerir(); });
        contratos = []; cobrancas = []; repasses = []; clientes = new Map(); resumo = null;
        if (!$("finMes").value) $("finMes").value = hojeIso().slice(0, 7);
        if (window.SKLFinExtra) window.SKLFinExtra.iniciar(ctx);
        if (window.SKLFinGestao) window.SKLFinGestao.iniciar(ctx);
        if (!ve) return Promise.resolve();
        ligarTempoReal();
        return carregar();
    }
    function sair() {
        if (canal && ctx) { ctx.sb.removeChannel(canal); }
        canal = null; contratos = []; cobrancas = []; repasses = []; clientes = new Map();
        if (window.SKLFinExtra) window.SKLFinExtra.sair();
        if (window.SKLFinGestao) window.SKLFinGestao.sair();
    }
    function ligarTempoReal() {
        if (canal) ctx.sb.removeChannel(canal);
        const cart = ctx.carteiraId();
        canal = ctx.sb.channel(`financeiro-${cart}`);
        [ "aluguel_contratos", "aluguel_cobrancas", "aluguel_repasses" ].forEach(t =>
            canal.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `carteira_id=eq.${cart}` }, () => agendarRecarga()));
        canal.subscribe();
    }
    function agendarRecarga() {
        clearTimeout(recarregarTimer);
        recarregarTimer = setTimeout(() => carregar(true), 700);
    }
    async function carregar(silencioso) {
        if (!ctx || !ctx.veTudo()) return;
        if (carregando) return carregando;
        carregando = (async () => {
            const cart = ctx.carteiraId();
            const desde = somaDias(hojeIso(), -400);
            if (!silencioso) await ctx.sb.rpc("fin_atualizar", { p_carteira: cart });
            const [ c1, c2, c3, c4, c5 ] = await Promise.all([
                ctx.sb.from("aluguel_contratos").select("*").eq("carteira_id", cart).order("numero", { ascending: false }),
                ctx.sb.from("aluguel_cobrancas").select("*").eq("carteira_id", cart).or(`status.eq.aberta,vencimento.gte.${desde}`).order("vencimento"),
                ctx.sb.from("aluguel_repasses").select("*").eq("carteira_id", cart).or(`status.eq.pendente,competencia.gte.${desde}`).order("competencia", { ascending: false }),
                ctx.sb.from("crm_clientes").select("id,nome,telefone,email,cpf").eq("carteira_id", cart),
                ctx.sb.rpc("fin_resumo", { p_carteira: cart, p_mes: mesSel() + "-01" })
            ]);
            const falha = [ c1, c2, c3, c4 ].find(r => r.error);
            if (falha) { if (!silencioso) ctx.toast(erro(falha.error)); return; }
            contratos = c1.data || []; cobrancas = c2.data || []; repasses = c3.data || [];
            clientes = new Map((c4.data || []).map(c => [ c.id, c ]));
            resumo = c5.error ? null : c5.data;
            atualizarSelo();
            if ($("page-financeiro").classList.contains("active-page")) render();
            if (contratoAberto && $("finContratoDialog").open) desenharHistorico(contratoAberto);
        })();
        try { await carregando; } finally { carregando = null; }
    }
    function atrasadas() { const hoje = hojeIso(); return cobrancas.filter(b => b.status === "aberta" && b.vencimento < hoje); }
    function atualizarSelo() {
        const n = atrasadas().length;
        [ "navFinanceiroBadge", "finAtrasoBadge" ].forEach(id => { const b = $(id); if (b) { b.textContent = n; b.hidden = !n; } });
    }

    function ligarEventos() {
        document.querySelectorAll("[data-fin-aba]").forEach(b => b.addEventListener("click", () => mostrarAba(b.dataset.finAba)));
        $("finMes").addEventListener("change", async () => {
            const { data } = await ctx.sb.rpc("fin_resumo", { p_carteira: ctx.carteiraId(), p_mes: mesSel() + "-01" });
            resumo = data || resumo; render();
        });
        $("finFiltro").addEventListener("change", render);
        $("finBusca").addEventListener("input", render);
        $("finNovoContrato").addEventListener("click", () => abrirContrato(null));
        $("finAtualizar").addEventListener("click", () => carregar());
        // contrato
        $("finCtImovel").addEventListener("change", () => {
            const c = imovel($("finCtImovel").value);
            if (!c) return;
            if (c.proprietario_cliente_id && !$("finCtProprietario").value) $("finCtProprietario").value = c.proprietario_cliente_id;
            if (c.valor_aluguel && !$("finCtValor").value) $("finCtValor").value = pct(c.valor_aluguel);
        });
        $("finCtGarantia").addEventListener("change", mostrarGarantia);
        $("finCtAddItem").addEventListener("click", () => { itens.push({ descricao: "", valor: "", repassar: false }); desenharItens(); });
        $("finCtSalvar").addEventListener("click", salvarContrato);
        $("finReajPct").addEventListener("input", () => {
            const c = contrato(contratoAberto); const p = num($("finReajPct").value);
            if (c && p != null) $("finReajValor").value = pct((Math.round(Number(c.valor_aluguel) * (1 + p / 100) * 100) / 100).toFixed(2));
        });
        $("finReajAplicar").addEventListener("click", reajustar);
        $("finEncAplicar").addEventListener("click", encerrar);
        // pagamento
        [ "finPgData", "finPgMulta", "finPgJuros", "finPgDesconto" ].forEach(id => $(id).addEventListener("input", () => previaPagamento(id === "finPgData")));
        $("finPgSalvar").addEventListener("click", registrarPagamento);
        // impressão
        $("finImpFechar").addEventListener("click", () => {
            $("finImpressao").hidden = true;
            document.body.classList.remove("fin-imprimindo");
            // reabre os diálogos que estavam abertos (contrato, vistoria, proposta...)
            dialogosAbertos.forEach(d => { try { if (!d.open) d.showModal(); } catch { /* já aberto */ } });
            dialogosAbertos = [];
        });
        $("finImpImprimir").addEventListener("click", imprimir);
        document.addEventListener("skl-crm-render", () => { if (ctx && $("page-financeiro").classList.contains("active-page") && aba === "resumo") render(); });
    }

    // ------------------------------------------------------------------ abas
    function aoMostrar() {
        if (!ctx || !ctx.veTudo()) return;
        render();
        carregar(true);
    }
    function mostrarAba(nova) {
        aba = nova;
        document.querySelectorAll("[data-fin-aba]").forEach(b => b.classList.toggle("ativa", b.dataset.finAba === aba));
        const f = FILTROS[aba] || (window.SKLFinExtra && window.SKLFinExtra.filtros[aba]);
        $("finFiltro").hidden = !f;
        if (f) $("finFiltro").innerHTML = Object.entries(f).map(([ v, t ]) => `<option value="${v}">${h(t)}</option>`).join("");
        $("finBusca").hidden = aba === "resumo" || !!(window.SKLFinGestao && window.SKLFinGestao.temAba(aba));
        $("finBusca").value = "";
        render();
    }
    function render() {
        if (!ctx) return;
        // Régua, Encargos e Chamados ficam em financeiro-extra.js
        // Comissões a receber, Despesas e Resultado ficam em fin-gestao.js
        const gestao = !!(window.SKLFinGestao && window.SKLFinGestao.temAba(aba));
        const extra = !!(window.SKLFinExtra && window.SKLFinExtra.temAba(aba)) || gestao;
        $("finResumo").hidden = aba !== "resumo";
        $("finLista").hidden = aba === "resumo" || extra;
        $("finMes").hidden = aba === "contratos" || extra;
        $("finNovoContrato").hidden = !podeGerir() || extra;
        if (window.SKLFinExtra) window.SKLFinExtra.render(aba);
        if (window.SKLFinGestao) window.SKLFinGestao.render(aba);
        if (gestao) $("finContagem").textContent = "";
        if (extra) return;
        if (aba === "resumo") return renderResumo();
        if (aba === "cobrancas") return renderCobrancas();
        if (aba === "contratos") return renderContratos();
        if (aba === "repasses") return renderRepasses();
    }
    function bate(texto) { const q = normal($("finBusca").value.trim()); return !q || normal(texto).includes(q); }

    // ------------------------------------------------------------------ resumo
    function renderResumo() {
        const r = resumo || {};
        const hoje = hojeIso();
        const atr = atrasadas().sort((a, b) => a.vencimento.localeCompare(b.vencimento));
        const reaj = contratos.filter(c => c.status === "ativo" && c.proximo_reajuste && c.proximo_reajuste <= somaDias(hoje, 30));
        const venc = contratos.filter(c => c.status === "ativo" && c.fim <= somaDias(hoje, 60));
        const semContrato = negociosSemContrato();
        $("finContagem").textContent = "";
        $("finResumo").innerHTML = `
          <div class="crm-resumo fin-cards">
            ${card("A receber no mês", r.a_receber_mes, "vencimentos do mês")}
            ${card("Recebido no mês", r.recebido_mes, "pagamentos registrados")}
            ${card("Em atraso", r.em_atraso_valor, `${r.em_atraso_qtd || 0} cobrança(s)`, (r.em_atraso_qtd || 0) > 0)}
            ${card("A repassar", r.a_repassar, "aos proprietários")}
            ${card("Receita da imobiliária", r.receita_mes, "taxa de adm. + intermediação no mês")}
            ${card("Contratos ativos", null, `${dinheiro(r.carteira_mensal || 0)} por mês`, false, r.contratos_ativos || 0)}
          </div>
          <div class="fin-avisos">
            ${aviso("Em atraso", atr.length, atr.slice(0, 8).map(b => linhaAtraso(b)).join(""), "Nenhum aluguel em atraso.", "cobrancas:atrasadas")}
            ${aviso("Reajustes nos próximos 30 dias", reaj.length, reaj.map(c => `<li><button type="button" class="text-button" data-fin-ct="${h(c.id)}">Nº ${h(c.numero)} · ${h(nomeCli(c.inquilino_id))}</button><small>${h(INDICES[c.indice_reajuste])} · ${h(dataBr(c.proximo_reajuste))}</small></li>`).join(""), "Nenhum reajuste chegando.", "contratos:reajuste")}
            ${aviso("Contratos terminando em 60 dias", venc.length, venc.map(c => `<li><button type="button" class="text-button" data-fin-ct="${h(c.id)}">Nº ${h(c.numero)} · ${h(nomeCli(c.inquilino_id))}</button><small>termina em ${h(dataBr(c.fim))}</small></li>`).join(""), "Nenhum contrato terminando.", "contratos:vencendo")}
            ${semContrato.length && podeGerir() ? aviso("Locações fechadas sem contrato", semContrato.length, semContrato.slice(0, 8).map(n => `<li><button type="button" class="text-button" data-fin-neg="${h(n.id)}">${h(n.titulo || nomeCli(n.cliente_id))}</button><small>${h(dinheiro(n.valor))} · criar contrato</small></li>`).join(""), "") : ""}
            ${window.SKLFinExtra ? window.SKLFinExtra.avisosResumo(aviso) : ""}
          </div>
          ${contratos.length ? "" : `<div class="empty-state">Nenhum contrato ainda. ${podeGerir() ? `Toque em "+ Novo contrato" ou, numa negociação de locação fechada, em "Criar contrato".` : ""}</div>`}`;
        ligarLinks($("finResumo"));
        if (window.SKLFinExtra) window.SKLFinExtra.ligar($("finResumo"));
    }
    function card(rotulo, valor, sub, alerta, numero) {
        return `<div class="crm-resumo-item${alerta ? " fin-alerta" : ""}"><span>${h(rotulo)}</span><strong>${numero != null ? h(numero) : h(dinheiro(valor || 0))}</strong>${sub ? `<small>${h(sub)}</small>` : ""}</div>`;
    }
    function aviso(titulo, qtd, itensHtml, vazio, ir) {
        return `<article class="panel fin-aviso"><header><h3>${h(titulo)}</h3>${qtd ? `<b class="nav-badge">${qtd}</b>` : ""}${ir && qtd ? `<button type="button" class="text-button" data-fin-ir="${h(ir)}">ver todos</button>` : ""}</header>
          ${qtd ? `<ul>${itensHtml}</ul>` : `<p class="muted-text">${h(vazio)}</p>`}</article>`;
    }
    function linhaAtraso(b) {
        const c = contrato(b.contrato_id) || {};
        return `<li><button type="button" class="text-button" data-fin-pagar="${h(b.id)}">${h(nomeCli(c.inquilino_id))}</button>
          <small>${h(dinheiro(b.valor_total))} · venceu ${h(dataBr(b.vencimento))} · ${diasEntre(b.vencimento, hojeIso())} dia(s)</small>${botaoWhats(b)}</li>`;
    }
    function negociosSemContrato() {
        const crm = window.SKLCRM && window.SKLCRM.interno;
        if (!crm) return [];
        const negs = crm.negs instanceof Map ? [ ...crm.negs.values() ] : [];
        const comContrato = new Set(contratos.map(c => c.negociacao_id).filter(Boolean));
        return negs.filter(n => n.situacao === "ganha" && !comContrato.has(n.id) && (crm.funil(n.funil_id) || {}).finalidade === "locacao");
    }
    function ligarLinks(box) {
        box.querySelectorAll("[data-fin-ct]").forEach(b => b.addEventListener("click", () => abrirContrato(contrato(b.dataset.finCt))));
        box.querySelectorAll("[data-fin-neg]").forEach(b => b.addEventListener("click", () => criarDaNegociacao(b.dataset.finNeg)));
        box.querySelectorAll("[data-fin-pagar]").forEach(b => b.addEventListener("click", () => abrirPagamento(cobrancas.find(x => x.id === b.dataset.finPagar))));
        box.querySelectorAll("[data-fin-ir]").forEach(b => b.addEventListener("click", () => {
            const [ a, f ] = b.dataset.finIr.split(":");
            mostrarAba(a); $("finFiltro").value = f; render();
        }));
    }

    // ------------------------------------------------------------------ cobranças
    function situacaoCobranca(b) {
        const hoje = hojeIso();
        if (b.status === "paga") return `<span class="status-pill fin-paga">Paga em ${h(dataBr(b.pago_em))}</span>`;
        if (b.status === "cancelada") return `<span class="status-pill fin-cancelada">Cancelada</span>`;
        if (b.vencimento < hoje) return `<span class="status-pill fin-atrasada">${diasEntre(b.vencimento, hoje)} dia(s) em atraso</span>`;
        if (b.vencimento === hoje) return `<span class="status-pill fin-hoje">Vence hoje</span>`;
        return `<span class="status-pill fin-aberta">Em aberto</span>`;
    }
    function botaoWhats(b) {
        const c = contrato(b.contrato_id) || {};
        const cli = cliente(c.inquilino_id);
        const d = digitos(cli && cli.telefone);
        if (d.length < 10) return "";
        const atraso = b.vencimento < hojeIso();
        const texto = `Olá, ${((cli.nome || "").split(" ")[0]) || "tudo bem"}! ${atraso ? "Consta em aberto" : "Lembrete:"} o aluguel de ${mesAno(b.competencia)} (${nomeImovel(c.construcao_id)}), `
            + `${atraso ? "vencido em" : "com vencimento em"} ${dataBr(b.vencimento)}, no valor de ${dinheiro(b.valor_total)}. Qualquer dúvida, estamos à disposição. ${ctx.carteiraNome()}`;
        return `<a class="crm-btn-contato whats" href="https://wa.me/55${d}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">WhatsApp</a>`;
    }
    function renderCobrancas() {
        const f = $("finFiltro").value || "abertas", ym = mesSel(), hoje = hojeIso();
        const lista = cobrancas.filter(b => {
            if (f === "abertas" && b.status !== "aberta") return false;
            if (f === "atrasadas" && !(b.status === "aberta" && b.vencimento < hoje)) return false;
            if (f === "mes" && !(b.status !== "cancelada" && noMes(b.vencimento, ym))) return false;
            if (f === "pagas" && !(b.status === "paga" && noMes(b.pago_em, ym))) return false;
            if (f === "canceladas" && b.status !== "cancelada") return false;
            if (f === "todas" && !noMes(b.vencimento, ym)) return false;
            const c = contrato(b.contrato_id) || {};
            return bate(`${c.numero} ${nomeCli(c.inquilino_id)} ${nomeCli(c.proprietario_id)} ${nomeImovel(c.construcao_id)}`);
        }).sort((a, b) => f === "pagas" ? String(b.pago_em).localeCompare(String(a.pago_em)) : a.vencimento.localeCompare(b.vencimento));
        const total = lista.reduce((s, b) => s + Number(b.status === "paga" ? b.valor_pago : b.valor_total || 0), 0);
        $("finContagem").textContent = `${lista.length} cobrança(s) · ${dinheiro(total)}`;
        $("finLista").innerHTML = lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Vencimento</th><th>Inquilino</th><th>Imóvel</th><th>Parcela</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>
          ${lista.map(b => { const c = contrato(b.contrato_id) || {}; return `<tr>
            <td data-r="Vencimento">${h(dataBr(b.vencimento))}</td>
            <td data-r="Inquilino"><strong>${h(nomeCli(c.inquilino_id))}</strong><small class="fin-sub">Contrato nº ${h(c.numero || "—")}</small></td>
            <td data-r="Imóvel">${h(nomeImovel(c.construcao_id))}</td>
            <td data-r="Parcela">${b.tipo === "rescisao" ? "Rescisão" : h(b.parcela) + "ª"} · ${h(mesAno(b.competencia))}</td>
            <td data-r="Valor">${h(dinheiro(b.status === "paga" ? b.valor_pago : b.valor_total))}${(b.itens || []).length ? `<small class="fin-sub">aluguel ${h(dinheiro(b.valor_aluguel))} + ${h(b.itens.map(i => i.descricao).join(", "))}</small>` : ""}${Number(b.multa) + Number(b.juros) > 0 ? `<small class="fin-sub">multa+juros ${h(dinheiro(Number(b.multa) + Number(b.juros)))}</small>` : ""}</td>
            <td data-r="Situação">${situacaoCobranca(b)}</td>
            <td class="fin-acoes">${acoesCobranca(b)}</td></tr>`; }).join("")}
          </tbody></table>` : `<div class="empty-state">Nenhuma cobrança nesta seleção.</div>`;
        ligarAcoesCobranca($("finLista"));
    }
    function acoesCobranca(b) {
        const out = [];
        if (b.status === "aberta" && podeGerir()) out.push(`<button type="button" class="primary-button fin-mini" data-pg="${h(b.id)}">Receber</button>`);
        if (b.status === "aberta") out.push(botaoWhats(b));
        if (b.status === "paga") out.push(`<button type="button" class="secondary-button fin-mini" data-recibo="${h(b.id)}">Recibo</button>`);
        if (b.status === "paga" && podeGerir()) out.push(`<button type="button" class="text-button" data-estornar="${h(b.id)}">Estornar</button>`);
        if (b.status === "aberta" && podeGerir()) out.push(`<button type="button" class="text-button" data-cancelar="${h(b.id)}">Cancelar</button>`);
        if (b.status === "cancelada" && podeGerir()) out.push(`<button type="button" class="text-button" data-reabrir="${h(b.id)}">Reabrir</button>`);
        return out.join("");
    }
    function ligarAcoesCobranca(box) {
        const achar = id => cobrancas.find(x => x.id === id);
        box.querySelectorAll("[data-pg]").forEach(b => b.addEventListener("click", () => abrirPagamento(achar(b.dataset.pg))));
        box.querySelectorAll("[data-recibo]").forEach(b => b.addEventListener("click", () => recibo(achar(b.dataset.recibo))));
        box.querySelectorAll("[data-estornar]").forEach(b => b.addEventListener("click", async () => {
            if (!window.confirm("Estornar este pagamento? A cobrança volta a ficar em aberto e o repasse pendente é apagado.")) return;
            await rpc("fin_estornar_pagamento", { p_cobranca: b.dataset.estornar }, "Pagamento estornado.");
            ctx.recarregarComissoes();
        }));
        box.querySelectorAll("[data-cancelar]").forEach(b => b.addEventListener("click", async () => {
            const motivo = window.prompt("Motivo do cancelamento desta cobrança (ex.: isenção combinada, acordo):", "");
            if (motivo === null) return;
            await rpc("fin_cancelar_cobranca", { p_cobranca: b.dataset.cancelar, p_motivo: motivo, p_reabrir: false }, "Cobrança cancelada.");
        }));
        box.querySelectorAll("[data-reabrir]").forEach(b => b.addEventListener("click", () =>
            rpc("fin_cancelar_cobranca", { p_cobranca: b.dataset.reabrir, p_motivo: null, p_reabrir: true }, "Cobrança reaberta.")));
    }
    async function rpc(nome, args, ok) {
        const { data, error } = await ctx.sb.rpc(nome, args);
        if (error) { ctx.toast(erro(error)); return null; }
        if (ok) ctx.toast(ok);
        await carregar(true);
        return data;
    }

    // ------------------------------------------------------------------ pagamento
    function abrirPagamento(b) {
        if (!b || !podeGerir()) return;
        const c = contrato(b.contrato_id) || {};
        cobrancaAberta = b;
        $("finPgTitulo").textContent = `Receber ${b.parcela}ª parcela · ${mesAno(b.competencia)}`;
        $("finPgInfo").innerHTML = `<strong>${h(nomeCli(c.inquilino_id))}</strong> · ${h(nomeImovel(c.construcao_id))}<br>
          Vencimento ${h(dataBr(b.vencimento))} · aluguel ${h(dinheiro(b.valor_aluguel))}${(b.itens || []).map(i => ` + ${h(i.descricao)} ${h(dinheiro(i.valor))}`).join("")}`;
        $("finPgData").value = hojeIso();
        $("finPgDesconto").value = "";
        $("finPgForma").innerHTML = FORMAS.map(f => `<option>${f}</option>`).join("");
        $("finPgObs").value = "";
        msg($("finPgMsg"), "");
        previaPagamento(true);
        $("finPagamentoDialog").showModal();
    }
    function previaPagamento(recalcular) {
        const b = cobrancaAberta; if (!b) return;
        const c = contrato(b.contrato_id) || {};
        const pago = $("finPgData").value || hojeIso();
        const dias = Math.max(diasEntre(b.vencimento, pago), 0);
        if (recalcular) {
            $("finPgMulta").value = dias > 0 ? pct((Math.round(b.valor_aluguel * c.multa_atraso_pct) / 100).toFixed(2)) : "0";
            $("finPgJuros").value = dias > 0 ? pct((Math.round(b.valor_aluguel * c.juros_mes_pct / 100 * dias / 30 * 100) / 100).toFixed(2)) : "0";
        }
        const multa = num($("finPgMulta").value) || 0, juros = num($("finPgJuros").value) || 0, desc = num($("finPgDesconto").value) || 0;
        const itensT = itensTotal(b.itens), itensRep = (b.itens || []).filter(i => i.repassar).reduce((s, i) => s + Number(i.valor), 0);
        const total = Number(b.valor_aluguel) + itensT + multa + juros - desc;
        const base = Math.max(Number(b.valor_aluguel) + multa + juros - desc, 0);
        const inter = b.parcela === 1 ? Math.min(Number(b.valor_aluguel) * Number(c.taxa_intermediacao_pct) / 100, base) : 0;
        const taxa = Math.round((base - inter) * Number(c.taxa_adm_pct)) / 100;
        $("finPgPrevia").innerHTML = `<div><span>${dias ? `${dias} dia(s) de atraso` : "Em dia"}</span><strong>Total a receber: ${h(dinheiro(total))}</strong></div>
          <div class="fin-previa-repasse"><span>Repasse ao proprietário</span>
            <small>${h(dinheiro(base))}${inter ? ` − intermediação ${h(dinheiro(inter))}` : ""} − taxa de adm. ${h(pct(c.taxa_adm_pct))}% ${h(dinheiro(taxa))}${itensRep ? ` + itens ${h(dinheiro(itensRep))}` : ""}</small>
            <strong>${h(dinheiro(base - inter - taxa + itensRep))}</strong></div>`;
        $("finPgValor").placeholder = dinheiro(total);
    }
    async function registrarPagamento() {
        const b = cobrancaAberta; if (!b) return;
        const dados = {
            pago_em: $("finPgData").value, multa: num($("finPgMulta").value) ?? 0, juros: num($("finPgJuros").value) ?? 0,
            desconto: num($("finPgDesconto").value) ?? 0, valor_pago: num($("finPgValor").value), forma_pagamento: $("finPgForma").value,
            observacao: $("finPgObs").value.trim()
        };
        if (!dados.pago_em) { msg($("finPgMsg"), "Informe a data do pagamento."); return; }
        $("finPgSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("fin_registrar_pagamento", { p_cobranca: b.id, p_dados: dados });
        $("finPgSalvar").disabled = false;
        if (error) { msg($("finPgMsg"), erro(error)); return; }
        $("finPagamentoDialog").close();
        ctx.toast(`Pagamento registrado. Repasse de ${dinheiro(data.repasse.valor_liquido)} ao proprietário${data.comissoes ? ` e ${data.comissoes} comissão(ões) lançada(s)` : ""}.`);
        $("finPgValor").value = "";
        await carregar(true);
        ctx.recarregarComissoes();
    }

    // ------------------------------------------------------------------ contratos
    function situacaoContrato(c) {
        const hoje = hojeIso();
        if (c.status === "encerrado") return `<span class="status-pill fin-cancelada">Encerrado ${h(dataBr(c.encerrado_em))}</span>`;
        if (c.fim < hoje) return `<span class="status-pill fin-hoje">Prazo vencido (segue por tempo indeterminado)</span>`;
        if (c.proximo_reajuste && c.proximo_reajuste <= somaDias(hoje, 30)) return `<span class="status-pill fin-hoje">Reajuste ${h(dataBr(c.proximo_reajuste))}</span>`;
        return `<span class="status-pill fin-paga">Ativo</span>`;
    }
    function renderContratos() {
        const f = $("finFiltro").value || "ativos", hoje = hojeIso();
        const lista = contratos.filter(c => {
            if (f === "ativos" && c.status !== "ativo") return false;
            if (f === "encerrados" && c.status !== "encerrado") return false;
            if (f === "reajuste" && !(c.status === "ativo" && c.proximo_reajuste && c.proximo_reajuste <= somaDias(hoje, 30))) return false;
            if (f === "vencendo" && !(c.status === "ativo" && c.fim <= somaDias(hoje, 60))) return false;
            return bate(`${c.numero} ${nomeCli(c.inquilino_id)} ${nomeCli(c.proprietario_id)} ${nomeImovel(c.construcao_id)}`);
        });
        $("finContagem").textContent = `${lista.length} contrato(s) · ${dinheiro(lista.filter(c => c.status === "ativo").reduce((s, c) => s + Number(c.valor_aluguel), 0))}/mês`;
        $("finLista").innerHTML = lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Nº</th><th>Imóvel</th><th>Inquilino</th><th>Proprietário</th><th>Aluguel</th><th>Vigência</th><th>Reajuste</th><th>Situação</th></tr></thead><tbody>
          ${lista.map(c => `<tr class="crm-linha" data-fin-ct="${h(c.id)}">
            <td data-r="Nº"><strong>${h(c.numero)}</strong></td>
            <td data-r="Imóvel">${h(nomeImovel(c.construcao_id))}</td>
            <td data-r="Inquilino">${h(nomeCli(c.inquilino_id))}</td>
            <td data-r="Proprietário">${h(nomeCli(c.proprietario_id))}</td>
            <td data-r="Aluguel">${h(dinheiro(c.valor_aluguel))}<small class="fin-sub">vence dia ${h(c.dia_vencimento)} · adm ${h(pct(c.taxa_adm_pct))}%</small></td>
            <td data-r="Vigência">${h(dataBr(c.inicio))} a ${h(dataBr(c.fim))}</td>
            <td data-r="Reajuste">${h(INDICES[c.indice_reajuste])}${c.proximo_reajuste ? `<small class="fin-sub">${h(dataBr(c.proximo_reajuste))}</small>` : ""}</td>
            <td data-r="Situação">${situacaoContrato(c)}</td></tr>`).join("")}
          </tbody></table>` : `<div class="empty-state">Nenhum contrato nesta seleção.</div>`;
        $("finLista").querySelectorAll("[data-fin-ct]").forEach(tr => tr.addEventListener("click", () => abrirContrato(contrato(tr.dataset.finCt))));
    }
    function opcoesClientes(sel) {
        const lista = [ ...clientes.values() ].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
        return `<option value="">Escolha…</option>` + lista.map(c => `<option value="${h(c.id)}"${c.id === sel ? " selected" : ""}>${h(c.nome)}${c.cpf ? ` · ${h(c.cpf)}` : ""}</option>`).join("");
    }
    function abrirContrato(c, padrao) {
        const base = c || padrao || {};
        contratoAberto = c ? c.id : null;
        const pode = podeGerir() && (!c || c.status === "ativo");
        $("finContratoTitulo").textContent = c ? `Contrato nº ${c.numero}` : "Novo contrato de locação";
        const imoveis = ctx.imoveis().filter(i => i.para_aluguel !== false || i.id === base.construcao_id)
            .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
        $("finCtImovel").innerHTML = `<option value="">Escolha o imóvel…</option>` + imoveis.map(i => `<option value="${h(i.id)}"${i.id === base.construcao_id ? " selected" : ""}>${h((i.codigo ? i.codigo + " · " : "") + i.nome)}</option>`).join("");
        $("finCtInquilino").innerHTML = opcoesClientes(base.inquilino_id);
        $("finCtProprietario").innerHTML = opcoesClientes(base.proprietario_id);
        const equipe = ctx.equipe().filter(u => u.active !== false);
        $("finCtCorretor").innerHTML = `<option value="">Sem corretor</option>` + equipe.map(u => `<option value="${h(u.id)}"${u.id === base.corretor_id ? " selected" : ""}>${h(u.display_name)}</option>`).join("");
        $("finCtValor").value = base.valor_aluguel != null ? pct(base.valor_aluguel) : "";
        $("finCtDia").value = base.dia_vencimento || 10;
        $("finCtInicio").value = base.inicio || hojeIso();
        $("finCtPrazo").value = base.prazo_meses || 30;
        $("finCtIndice").innerHTML = Object.entries(INDICES).map(([ v, t ]) => `<option value="${v}"${v === (base.indice_reajuste || "IPCA") ? " selected" : ""}>${t}</option>`).join("");
        $("finCtTaxa").value = pct(base.taxa_adm_pct ?? 10);
        $("finCtInter").value = pct(base.taxa_intermediacao_pct ?? 100);
        $("finCtMulta").value = pct(base.multa_atraso_pct ?? 2);
        $("finCtJuros").value = pct(base.juros_mes_pct ?? 1);
        $("finCtGarantia").innerHTML = Object.entries(GARANTIAS).map(([ v, t ]) => `<option value="${v}"${v === (base.garantia || "nenhuma") ? " selected" : ""}>${t}</option>`).join("");
        $("finCtGarantiaDet").value = base.garantia_detalhe || "";
        $("finCtCaucao").value = base.caucao_valor != null ? pct(base.caucao_valor) : "";
        $("finCtRepPrazo").value = base.repasse_prazo_dias ?? 5;
        $("finCtRepDados").value = base.repasse_dados || "";
        $("finCtObs").value = base.observacoes || "";
        itens = JSON.parse(JSON.stringify(base.itens_mensais || []));
        mostrarGarantia();
        desenharItens();
        $("finContratoForm").querySelectorAll("input,select,textarea").forEach(el => { el.disabled = !pode; });
        $("finCtAddItem").hidden = !pode;
        $("finCtSalvar").hidden = !pode;
        $("finCtSalvar").textContent = c ? "Salvar alterações" : "Criar contrato";
        $("finCtNegociacao").value = base.negociacao_id || "";
        const ativo = c && c.status === "ativo" && podeGerir();
        $("finCtAcoes").hidden = !ativo;
        if (ativo) {
            $("finReajPct").value = ""; $("finReajValor").value = "";
            $("finReajDesde").value = (c.proximo_reajuste || hojeIso()).slice(0, 7);
            $("finReajIndice").textContent = INDICES[c.indice_reajuste];
            $("finEncData").value = hojeIso(); $("finEncMotivo").value = ""; $("finEncLiberar").checked = true;
            [ "finReajPct", "finReajValor", "finReajDesde", "finEncData", "finEncMotivo", "finEncLiberar" ].forEach(id => { $(id).disabled = false; });
        }
        $("finCtCobrancas").innerHTML = c ? resumoCobrancasContrato(c) : "";
        $("finCtHistorico").innerHTML = "";
        $("finCtHistoricoBox").hidden = !c;
        msg($("finCtMsg"), "");
        if (c) desenharHistorico(c.id);
        if (window.SKLDocumentos) window.SKLDocumentos.aoAbrirContrato(c);
        if (window.SKLFinExtra) window.SKLFinExtra.aoAbrirContrato(c);
        $("finContratoDialog").showModal();
    }
    function resumoCobrancasContrato(c) {
        const minhas = cobrancas.filter(b => b.contrato_id === c.id);
        if (!minhas.length) return "";
        const ab = minhas.filter(b => b.status === "aberta"), pg = minhas.filter(b => b.status === "paga");
        const atr = ab.filter(b => b.vencimento < hojeIso());
        return `<div class="fin-ct-resumo"><span><strong>${pg.length}</strong> paga(s)</span><span><strong>${ab.length}</strong> em aberto</span>${atr.length ? `<span class="fin-txt-alerta"><strong>${atr.length}</strong> em atraso</span>` : ""}
          ${ab.length && podeGerir() ? `<button type="button" class="secondary-button fin-mini" data-fin-pagar="${h(ab[0].id)}">Receber ${h(ab[0].parcela)}ª parcela</button>` : ""}</div>`;
    }
    async function desenharHistorico(id) {
        const { data } = await ctx.sb.from("aluguel_contrato_eventos").select("*").eq("contrato_id", id).order("created_at", { ascending: false }).limit(30);
        eventos = data || [];
        $("finCtHistorico").innerHTML = eventos.length ? eventos.map(e => `<li><small>${h(new Date(e.created_at).toLocaleString("pt-BR"))}</small> ${h(e.descricao)}</li>`).join("") : `<li class="muted-text">Sem registros.</li>`;
        const c = contrato(id);
        if (c) { $("finCtCobrancas").innerHTML = resumoCobrancasContrato(c); ligarLinks($("finCtCobrancas")); }
    }
    function mostrarGarantia() {
        const g = $("finCtGarantia").value;
        $("finCtGarantiaDetLabel").hidden = g === "nenhuma";
        $("finCtCaucaoLabel").hidden = g !== "caucao";
    }
    function desenharItens() {
        $("finCtItens").innerHTML = itens.map((it, i) => `<div class="fin-item" data-i="${i}">
            <input data-k="descricao" value="${h(it.descricao || "")}" placeholder="ex.: Condomínio, IPTU" autocomplete="off" />
            <input data-k="valor" inputmode="decimal" value="${h(it.valor === "" || it.valor == null ? "" : pct(it.valor))}" placeholder="R$" />
            <label class="check-inline"><input type="checkbox" data-k="repassar"${it.repassar ? " checked" : ""} /> vai para o proprietário</label>
            <button type="button" class="text-button crm-remover" data-remover title="Tirar">✕</button></div>`).join("")
            || `<p class="muted-text">Nada além do aluguel. Use para condomínio, IPTU, seguro… cobrados junto.</p>`;
        $("finCtItens").querySelectorAll(".fin-item").forEach(row => {
            const i = Number(row.dataset.i);
            row.querySelectorAll("[data-k]").forEach(el => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
                itens[i][el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
            }));
            row.querySelector("[data-remover]").addEventListener("click", () => { itens.splice(i, 1); desenharItens(); });
        });
    }
    function coletarContrato() {
        return {
            construcao_id: $("finCtImovel").value || null, inquilino_id: $("finCtInquilino").value || null,
            proprietario_id: $("finCtProprietario").value || null, corretor_id: $("finCtCorretor").value || null,
            negociacao_id: $("finCtNegociacao").value || null,
            valor_aluguel: num($("finCtValor").value), dia_vencimento: Number($("finCtDia").value) || 10,
            inicio: $("finCtInicio").value, prazo_meses: Number($("finCtPrazo").value) || 30, indice_reajuste: $("finCtIndice").value,
            taxa_adm_pct: num($("finCtTaxa").value), taxa_intermediacao_pct: num($("finCtInter").value),
            multa_atraso_pct: num($("finCtMulta").value), juros_mes_pct: num($("finCtJuros").value),
            garantia: $("finCtGarantia").value, garantia_detalhe: $("finCtGarantiaDet").value.trim(), caucao_valor: num($("finCtCaucao").value),
            itens_mensais: itens.map(i => ({ descricao: (i.descricao || "").trim(), valor: num(i.valor), repassar: !!i.repassar })).filter(i => i.descricao && i.valor),
            repasse_prazo_dias: Number($("finCtRepPrazo").value) || 0, repasse_dados: $("finCtRepDados").value.trim(), observacoes: $("finCtObs").value.trim()
        };
    }
    async function salvarContrato() {
        const d = coletarContrato();
        if (!d.inquilino_id) { msg($("finCtMsg"), "Escolha o inquilino (cadastre em Clientes, se ainda não existir)."); return; }
        if (!d.valor_aluguel) { msg($("finCtMsg"), "Informe o valor do aluguel."); return; }
        if (!d.inicio) { msg($("finCtMsg"), "Informe o início do contrato."); return; }
        $("finCtSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("fin_salvar_contrato", { p_carteira: ctx.carteiraId(), p_dados: d, p_id: contratoAberto });
        $("finCtSalvar").disabled = false;
        if (error) { msg($("finCtMsg"), erro(error)); return; }
        $("finContratoDialog").close();
        ctx.toast(contratoAberto ? "Contrato atualizado. As cobranças em aberto acompanham as mudanças." : `Contrato nº ${data.numero} criado. As cobranças já estão em Financeiro → Cobranças.`);
        await carregar(true);
        if (!contratoAberto && d.construcao_id) ctx.recarregarImoveis();
        renderNegocioAberto();
    }
    async function reajustar() {
        const c = contrato(contratoAberto); if (!c) return;
        const p = num($("finReajPct").value), v = num($("finReajValor").value);
        if (p == null && v == null) { msg($("finCtMsg"), "Informe o percentual do índice ou o novo valor."); return; }
        const desde = $("finReajDesde").value ? $("finReajDesde").value + "-01" : null;
        if (!window.confirm(`Reajustar o aluguel de ${dinheiro(c.valor_aluguel)} para ${dinheiro(v ?? c.valor_aluguel * (1 + p / 100))} a partir de ${desde ? mesAno(desde) : "agora"}?`)) return;
        const { error } = await ctx.sb.rpc("fin_reajustar_contrato", { p_contrato: c.id, p_percentual: p, p_novo_valor: v, p_a_partir: desde });
        if (error) { msg($("finCtMsg"), erro(error)); return; }
        ctx.toast("Reajuste aplicado. As cobranças em aberto a partir desse mês já estão com o novo valor.");
        await carregar(true);
        abrirContrato(contrato(c.id));
    }
    async function encerrar() {
        const c = contrato(contratoAberto); if (!c) return;
        const data = $("finEncData").value;
        if (!data) { msg($("finCtMsg"), "Informe a data de encerramento."); return; }
        if (!window.confirm(`Encerrar o contrato nº ${c.numero} em ${dataBr(data)}? Cobranças de meses depois dessa data serão canceladas.`)) return;
        const { error } = await ctx.sb.rpc("fin_encerrar_contrato", { p_contrato: c.id, p_data: data, p_motivo: $("finEncMotivo").value.trim(), p_liberar_imovel: $("finEncLiberar").checked });
        if (error) { msg($("finCtMsg"), erro(error)); return; }
        $("finContratoDialog").close();
        ctx.toast("Contrato encerrado.");
        await carregar(true);
        ctx.recarregarImoveis();
    }

    // ------------------------------------------------------------------ negociação fechada → contrato
    let negAberta = null, negBox = null;
    function desenharNaNegociacao(n, box) {
        negAberta = n; negBox = box;
        if (!box) return;
        const crm = window.SKLCRM && window.SKLCRM.interno;
        const loc = n && crm && (crm.funil(n.funil_id) || {}).finalidade === "locacao";
        if (!ctx || !ctx.veTudo() || !n || n.situacao !== "ganha" || !loc) { box.hidden = true; return; }
        const c = contratos.find(x => x.negociacao_id === n.id && x.status === "ativo") || contratos.find(x => x.negociacao_id === n.id);
        box.hidden = false;
        box.innerHTML = `<span class="eyebrow">CONTRATO DE LOCAÇÃO</span>` + (c
            ? `<div class="crm-visita crm-visita-realizada"><span class="crm-visita-quando">Nº ${h(c.numero)}</span><span class="crm-visita-info"><strong>${h(dinheiro(c.valor_aluguel))}/mês · ${c.status === "ativo" ? "ativo" : "encerrado"}</strong><small>${h(dataBr(c.inicio))} a ${h(dataBr(c.fim))} · vence dia ${h(c.dia_vencimento)}</small></span></div>
               <button type="button" class="secondary-button" data-fin-abrir>Abrir no Financeiro</button>`
            : podeGerir() ? `<p class="muted-text">Locação fechada. Crie o contrato para gerar as cobranças mensais e os repasses ao proprietário.</p>
               <button type="button" class="primary-button" data-fin-criar>Criar contrato de locação</button>`
              : `<p class="muted-text">Ainda sem contrato no Financeiro.</p>`);
        const a = box.querySelector("[data-fin-abrir]"); if (a) a.addEventListener("click", () => abrirContrato(c));
        const b = box.querySelector("[data-fin-criar]"); if (b) b.addEventListener("click", () => criarDaNegociacao(n.id));
    }
    function renderNegocioAberto() { if (negAberta && negBox && !negBox.hidden) desenharNaNegociacao(negAberta, negBox); }
    function criarDaNegociacao(id) {
        const crm = window.SKLCRM && window.SKLCRM.interno;
        const n = crm && crm.negs instanceof Map ? crm.negs.get(id) : null;
        if (!n) return;
        const im = n.construcao_id ? imovel(n.construcao_id) : null;
        abrirContrato(null, {
            negociacao_id: n.id, construcao_id: n.construcao_id, inquilino_id: n.cliente_id, corretor_id: n.corretor_id,
            proprietario_id: im && im.proprietario_cliente_id, valor_aluguel: n.valor ?? (im && im.valor_aluguel), prazo_meses: n.contrato_meses || 30,
            inicio: n.fechado_em ? String(n.fechado_em).slice(0, 10) : hojeIso()
        });
    }

    // ------------------------------------------------------------------ repasses
    function renderRepasses() {
        const f = $("finFiltro").value || "pendentes", ym = mesSel();
        const lista = repasses.filter(r => {
            if (f === "pendentes" && r.status !== "pendente") return false;
            if (f === "pagos" && !(r.status === "pago" && noMes(r.pago_em, ym))) return false;
            if (f === "todos" && !noMes(r.competencia, ym)) return false;
            const c = contrato(r.contrato_id) || {};
            return bate(`${c.numero} ${nomeCli(r.proprietario_id)} ${nomeCli(c.inquilino_id)} ${nomeImovel(c.construcao_id)}`);
        }).sort((a, b) => String(a.previsto_para).localeCompare(String(b.previsto_para)));
        $("finContagem").textContent = `${lista.length} repasse(s) · ${dinheiro(lista.reduce((s, r) => s + Number(r.valor_liquido), 0))}`;
        const hoje = hojeIso();
        $("finLista").innerHTML = lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Proprietário</th><th>Imóvel</th><th>Mês</th><th>Recebido</th><th>Descontos</th><th>A repassar</th><th>Data</th><th></th></tr></thead><tbody>
          ${lista.map(r => { const c = contrato(r.contrato_id) || {}; return `<tr>
            <td data-r="Proprietário"><strong>${h(nomeCli(r.proprietario_id))}</strong>${c.repasse_dados ? `<small class="fin-sub">${h(c.repasse_dados)}</small>` : ""}</td>
            <td data-r="Imóvel">${h(nomeImovel(c.construcao_id))}<small class="fin-sub">Contrato nº ${h(c.numero || "—")}</small></td>
            <td data-r="Mês">${h(mesAno(r.competencia))}</td>
            <td data-r="Recebido">${h(dinheiro(r.valor_recebido))}</td>
            <td data-r="Descontos">${Number(r.intermediacao) ? `intermediação ${h(dinheiro(r.intermediacao))}<br>` : ""}adm ${h(dinheiro(r.taxa_adm))}${Number(r.itens_retidos) ? `<br>itens pagos pela imobiliária ${h(dinheiro(r.itens_retidos))}` : ""}</td>
            <td data-r="A repassar"><strong>${h(dinheiro(r.valor_liquido))}</strong></td>
            <td data-r="Data">${r.status === "pago" ? `<span class="status-pill fin-paga">Pago ${h(dataBr(r.pago_em))}</span>` : `<span class="status-pill ${r.previsto_para < hoje ? "fin-atrasada" : "fin-aberta"}">Até ${h(dataBr(r.previsto_para))}</span>`}</td>
            <td class="fin-acoes">${podeGerir() ? (r.status === "pendente" ? `<button type="button" class="primary-button fin-mini" data-rep-pagar="${h(r.id)}">Marcar repassado</button>` : `<button type="button" class="text-button" data-rep-desfazer="${h(r.id)}">Desfazer</button>`) : ""}
              <button type="button" class="secondary-button fin-mini" data-rep-demo="${h(r.id)}">Demonstrativo</button></td></tr>`; }).join("")}
          </tbody></table>` : `<div class="empty-state">Nenhum repasse nesta seleção.</div>`;
        const box = $("finLista");
        box.querySelectorAll("[data-rep-pagar]").forEach(b => b.addEventListener("click", () => {
            const obs = window.prompt("Repasse feito em hoje. Observação (ex.: PIX, comprovante nº) — opcional:", "");
            if (obs === null) return;
            rpc("fin_marcar_repasse", { p_repasse: b.dataset.repPagar, p_pago: true, p_pago_em: hojeIso(), p_observacao: obs }, "Repasse marcado como feito.");
        }));
        box.querySelectorAll("[data-rep-desfazer]").forEach(b => b.addEventListener("click", () =>
            rpc("fin_marcar_repasse", { p_repasse: b.dataset.repDesfazer, p_pago: false, p_pago_em: null, p_observacao: null }, "Repasse voltou para pendente.")));
        box.querySelectorAll("[data-rep-demo]").forEach(b => b.addEventListener("click", () => demonstrativo(repasses.find(r => r.id === b.dataset.repDemo))));
    }

    // ------------------------------------------------------------------ recibo e demonstrativo (impressão)
    function documento(titulo, corpo) {
        return `<div class="fin-doc"><header><div><strong>${h(ctx.carteiraNome())}</strong><span>${h(titulo)}</span></div><small>Emitido em ${h(new Date().toLocaleDateString("pt-BR"))}</small></header>${corpo}
          <footer><div class="fin-assinatura">${h(ctx.carteiraNome())}</div></footer></div>`;
    }
    function linhas(pares) { return `<table class="fin-doc-tabela">${pares.map(([ a, b, forte ]) => `<tr${forte ? ` class="forte"` : ""}><td>${h(a)}</td><td>${h(b)}</td></tr>`).join("")}</table>`; }
    function recibo(b) {
        if (!b) return;
        const c = contrato(b.contrato_id) || {};
        const inq = cliente(c.inquilino_id) || {};
        const pares = [ [ "Aluguel", dinheiro(b.valor_aluguel) ] ];
        (b.itens || []).forEach(i => pares.push([ i.descricao, dinheiro(i.valor) ]));
        if (Number(b.multa)) pares.push([ "Multa por atraso", dinheiro(b.multa) ]);
        if (Number(b.juros)) pares.push([ "Juros", dinheiro(b.juros) ]);
        if (Number(b.desconto)) pares.push([ "Desconto", "− " + dinheiro(b.desconto) ]);
        pares.push([ "Total pago", dinheiro(b.valor_pago), true ]);
        abrirImpressao(documento("Recibo de aluguel", `
          <p>Recebemos de <strong>${h(inq.nome || "—")}</strong>${inq.cpf ? `, CPF ${h(inq.cpf)}` : ""}, a importância de <strong>${h(dinheiro(b.valor_pago))}</strong>,
          referente ao aluguel de <strong>${h(mesAno(b.competencia))}</strong> (${h(b.parcela)}ª parcela, contrato nº ${h(c.numero)}) do imóvel
          <strong>${h(nomeImovel(c.construcao_id))}</strong>${imovel(c.construcao_id) && imovel(c.construcao_id).endereco ? `, ${h(imovel(c.construcao_id).endereco)}` : ""}.</p>
          ${linhas(pares)}
          <p class="fin-doc-rodape">Vencimento ${h(dataBr(b.vencimento))} · pago em ${h(dataBr(b.pago_em))}${b.forma_pagamento ? ` · ${h(b.forma_pagamento)}` : ""}</p>`));
    }
    function demonstrativo(r) {
        if (!r) return;
        const c = contrato(r.contrato_id) || {};
        const prop = cliente(r.proprietario_id) || {};
        const b = cobrancas.find(x => x.id === r.cobranca_id) || {};
        const pares = [ [ "Aluguel recebido do inquilino", dinheiro(b.valor_aluguel) ] ];
        if (Number(b.multa) + Number(b.juros)) pares.push([ "Multa e juros", dinheiro(Number(b.multa) + Number(b.juros)) ]);
        if (Number(b.desconto)) pares.push([ "Desconto concedido", "− " + dinheiro(b.desconto) ]);
        if (Number(r.intermediacao)) pares.push([ `Taxa de intermediação (1º aluguel, ${pct(c.taxa_intermediacao_pct)}%)`, "− " + dinheiro(r.intermediacao) ]);
        pares.push([ `Taxa de administração (${pct(c.taxa_adm_pct)}%)`, "− " + dinheiro(r.taxa_adm) ]);
        (b.itens || []).filter(i => i.repassar).forEach(i => pares.push([ i.descricao + " (repassado)", dinheiro(i.valor) ]));
        pares.push([ "Valor líquido do repasse", dinheiro(r.valor_liquido), true ]);
        abrirImpressao(documento("Demonstrativo de repasse ao proprietário", `
          <p>Proprietário: <strong>${h(prop.nome || "—")}</strong>${prop.cpf ? ` · CPF ${h(prop.cpf)}` : ""}<br>
          Imóvel: <strong>${h(nomeImovel(c.construcao_id))}</strong> · contrato nº ${h(c.numero)} · inquilino ${h(nomeCli(c.inquilino_id))}<br>
          Referência: <strong>${h(mesAno(r.competencia))}</strong> · aluguel pago em ${h(dataBr(b.pago_em))}</p>
          ${linhas(pares)}
          <p class="fin-doc-rodape">${r.status === "pago" ? `Repasse feito em ${h(dataBr(r.pago_em))}` : `Repasse previsto até ${h(dataBr(r.previsto_para))}`}${c.repasse_dados ? ` · ${h(c.repasse_dados)}` : ""}${r.observacao ? ` · ${h(r.observacao)}` : ""}</p>`));
    }
    // um <dialog> aberto fica na camada de cima e esconderia a impressão: fecha durante a impressão e reabre depois
    let dialogosAbertos = [];
    function abrirImpressao(html) {
        dialogosAbertos = [ ...document.querySelectorAll("dialog[open]") ];
        dialogosAbertos.forEach(d => d.close());
        $("finImpConteudo").innerHTML = html;
        $("finImpressao").hidden = false;
        document.body.classList.add("fin-imprimindo");
    }
    function imprimir() {
        if (window.NativeBridge && typeof window.NativeBridge.printPage === "function") window.NativeBridge.printPage();
        else window.print();
    }

    window.SKLFinanceiro = { iniciar, sair, carregar, aoMostrar, desenharNaNegociacao, atrasadas: () => atrasadas().length,
        imprimir: html => abrirImpressao(html), contratos: () => contratos, cobrancas: () => cobrancas, repasses: () => repasses, cliente, contratoAberto: () => contrato(contratoAberto),
        clientes: () => [ ...clientes.values() ], mostrarAba, renderizar: () => render(), recarregar: () => carregar(true),
        abrirContratoId: id => abrirContrato(contrato(id)), abrirPagamentoId: id => abrirPagamento(cobrancas.find(x => x.id === id)) };
})();
