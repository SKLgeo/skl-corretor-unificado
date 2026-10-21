// Financeiro da imobiliária (abas novas no Financeiro), o que a Cerrado fazia no Power BI:
//   "A receber"  — a comissão que a imobiliária recebe de cada negócio, em parcelas, com baixa e conta bancária;
//   "Despesas"   — despesas e receitas do escritório com plano de contas, conta bancária, vencimento e baixa;
//   "Resultado"  — VGV, VGC e VLC do período, a receber, despesas, saldo por conta e despesas por plano de contas.
// Também desenha o bloco "A receber da comissão" no negócio ganho. Cálculos no banco (fin_indicadores_imobiliaria).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ABAS = [ "receber", "despesas", "resultado" ];
    let ctx = null, ligado = false;
    let contas = [], plano = [], lancamentos = [], recebiveis = [];
    let filtroRec = "aberto", filtroDesp = { mes: "", situacao: "", natureza: "despesa" }, periodo = "mes";
    let baixaAlvo = null, lancEditando = null, negParcelas = null, boxParcelas = null;

    const podeGerir = () => !!ctx && ctx.podeGerir();
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => v == null || v === "" ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const valorBR = v => v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numero = v => { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null ? null : n; };
    const dataBr = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
    function hojeIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function somaMeses(iso, n) {
        const [ a, m, d ] = iso.split("-").map(Number);
        const alvo = new Date(a, m - 1 + n, 1);
        const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
        return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
    }
    function falha(id, e) { const el = $(id); el.textContent = typeof e === "string" ? e : erro(e); el.style.background = "#f7e8e6"; el.style.color = "#9a3b34"; el.hidden = false; }
    function card(rotulo, valor, sub, alerta) {
        return `<div class="crm-resumo-item${alerta ? " fin-alerta" : ""}"><span>${h(rotulo)}</span><strong>${h(dinheiro(valor || 0))}</strong>${sub ? `<small>${h(sub)}</small>` : ""}</div>`;
    }
    function nomeNegocio(id) {
        const I = window.SKLCRM && window.SKLCRM.interno;
        const n = I && I.negs.get(id);
        if (!n) return "Negócio";
        const cli = I.clientes.get(n.cliente_id);
        return [ n.titulo, cli && cli.nome ].filter(Boolean).join(" — ") || "Negócio";
    }
    const recebido = r => !!(r.recebido_em || r.recebido_sem_data);
    const liquidado = l => !!(l.pago_em || l.pago_sem_data);
    const nomeConta = id => (contas.find(c => c.id === id) || {}).nome || "";
    const nomePlano = id => (plano.find(p => p.id === id) || {}).nome || "";

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { montar(); ligado = true; }
        document.querySelectorAll("[data-fin-aba]").forEach(b => { if (ABAS.includes(b.dataset.finAba)) b.hidden = !ctx.veTudo(); });
        if (!ctx.veTudo()) return Promise.resolve();
        return carregar();
    }
    async function carregar() {
        if (!ctx || !ctx.carteiraId()) return;
        const cid = ctx.carteiraId();
        const [ a, b, c, d ] = await Promise.all([
            ctx.sb.from("fin_contas_bancarias").select("*").eq("carteira_id", cid).order("nome"),
            ctx.sb.from("fin_plano_contas").select("*").eq("carteira_id", cid).order("nome"),
            ctx.sb.from("fin_lancamentos").select("*").eq("carteira_id", cid).order("vencimento", { ascending: false }).limit(5000),
            ctx.sb.from("crm_comissao_recebiveis").select("*").eq("carteira_id", cid).order("vencimento").limit(5000)
        ]);
        [ a, b, c, d ].forEach(r => { if (r.error) console.warn("Financeiro da imobiliária:", r.error); });
        contas = a.data || []; plano = b.data || []; lancamentos = c.data || []; recebiveis = d.data || [];
        atualizarSelo();
    }
    function atualizarSelo() {
        const venc = recebiveis.filter(r => !recebido(r) && r.vencimento < hojeIso()).length
            + lancamentos.filter(l => !liquidado(l) && l.natureza === "despesa" && l.vencimento < hojeIso()).length;
        const b = $("finGestaoBadge");
        if (b) { b.textContent = venc; b.hidden = !venc; }
    }
    function temAba(a) { return ABAS.includes(a); }

    function montar() {
        const pagina = $("page-financeiro");
        if (!pagina) return;
        const box = document.createElement("div");
        box.id = "finGestao";
        box.hidden = true;
        pagina.appendChild(box);
        document.body.insertAdjacentHTML("beforeend", `
          <dialog id="fgBaixaDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow" id="fgBaixaEyebrow">BAIXA</span><h2 id="fgBaixaTitulo">Dar baixa</h2>
            <p id="fgBaixaInfo" class="muted-text"></p>
            <div class="form-row">
              <label><span id="fgBaixaRotulo">Data</span><input id="fgBaixaData" type="date" /></label>
              <label><span>Conta bancária</span><select id="fgBaixaConta"></select></label>
            </div>
            <button id="fgBaixaSalvar" type="button" class="primary-button">Confirmar</button>
            <div id="fgBaixaMsg" class="form-message" hidden></div>
          </form></dialog>
          <dialog id="fgProgDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">PROGRAMAR</span><h2 id="fgProgTitulo">Programar data</h2>
            <p id="fgProgInfo" class="muted-text"></p>
            <label><span id="fgProgRotulo">Programado para</span><input id="fgProgData" type="date" /></label>
            <p class="muted-text">O vencimento original continua o mesmo; a data programada aparece no painel e nas listas.</p>
            <div class="div-acoes">
              <button id="fgProgLimpar" type="button" class="text-button">Tirar a data programada</button>
              <button id="fgProgSalvar" type="button" class="primary-button">Salvar</button>
            </div>
            <div id="fgProgMsg" class="form-message" hidden></div>
          </form></dialog>
          <dialog id="fgLancDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">FINANCEIRO DA IMOBILIÁRIA</span><h2 id="fgLancTitulo">Novo lançamento</h2>
            <div class="fg-natureza" role="radiogroup">
              <label><input type="radio" name="fgNat" value="despesa" checked /> Despesa</label>
              <label><input type="radio" name="fgNat" value="receita" /> Receita</label>
            </div>
            <label><span>Descrição</span><input id="fgLancDesc" maxlength="200" autocomplete="off" placeholder="ex.: Energisa, salário da recepção" /></label>
            <div class="form-row">
              <label><span>Valor</span><input id="fgLancValor" inputmode="decimal" autocomplete="off" /></label>
              <label><span>Vencimento</span><input id="fgLancVenc" type="date" /></label>
            </div>
            <div class="form-row">
              <label><span>Plano de contas</span><select id="fgLancPlano"></select></label>
              <label><span>Conta bancária</span><select id="fgLancConta"></select></label>
            </div>
            <div class="form-row">
              <label><span>Pago em (deixe vazio se ainda não pagou)</span><input id="fgLancPago" type="date" /></label>
              <label id="fgLancRepetirLbl"><span>Repetir todo mês (vezes)</span><input id="fgLancRepetir" type="number" min="1" max="36" value="1" /></label>
            </div>
            <label><span>Observação</span><input id="fgLancObs" autocomplete="off" /></label>
            <div class="div-acoes">
              <button id="fgLancExcluir" type="button" class="danger-button" hidden>Excluir</button>
              <button id="fgLancSalvar" type="button" class="primary-button">Salvar</button>
            </div>
            <div id="fgLancMsg" class="form-message" hidden></div>
          </form></dialog>
          <dialog id="fgCadDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">CADASTROS DO FINANCEIRO</span><h2 id="fgCadTitulo"></h2>
            <div id="fgCadLista"></div>
            <div id="fgCadMsg" class="form-message" hidden></div>
          </form></dialog>
          <dialog id="fgParcDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">COMISSÃO A RECEBER</span><h2 id="fgParcTitulo">Parcelas a receber</h2>
            <p class="muted-text">O que a imobiliária recebe deste negócio (do cliente ou da construtora). Parcelas já recebidas não mudam.</p>
            <div class="form-row fg-parc-gerar">
              <label><span>Total a receber</span><input id="fgParcTotal" inputmode="decimal" autocomplete="off" /></label>
              <label><span>Parcelas</span><input id="fgParcQtd" type="number" min="1" max="120" value="1" /></label>
              <label><span>1º vencimento</span><input id="fgParcVenc" type="date" /></label>
              <button id="fgParcGerar" type="button" class="secondary-button">Dividir</button>
            </div>
            <div id="fgParcLista"></div>
            <p id="fgParcSoma" class="muted-text"></p>
            <button id="fgParcSalvar" type="button" class="primary-button">Salvar parcelas</button>
            <div id="fgParcMsg" class="form-message" hidden></div>
          </form></dialog>`);
        document.querySelectorAll("#fgBaixaDialog,#fgProgDialog,#fgLancDialog,#fgCadDialog,#fgParcDialog").forEach(d => d.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => d.close())));
        $("fgBaixaSalvar").addEventListener("click", confirmarBaixa);
        $("fgProgSalvar").addEventListener("click", () => salvarProgramado($("fgProgData").value || null));
        $("fgProgLimpar").addEventListener("click", () => salvarProgramado(null));
        $("fgLancSalvar").addEventListener("click", salvarLancamento);
        $("fgLancExcluir").addEventListener("click", excluirLancamento);
        $("fgParcGerar").addEventListener("click", gerarParcelas);
        $("fgParcSalvar").addEventListener("click", salvarParcelas);
    }

    async function render(aba) {
        const box = $("finGestao");
        if (!box) return;
        box.hidden = !temAba(aba);
        if (!temAba(aba) || !ctx) return;
        await carregar();
        if (aba === "receber") renderReceber(box);
        else if (aba === "despesas") renderDespesas(box);
        else renderResultado(box);
    }

    // ------------------------------------------------------------------ a receber
    function situacaoRec(r) {
        if (r.recebido_em) return `<span class="status-pill disponivel">Recebido ${h(dataBr(r.recebido_em))}</span>`;
        if (r.recebido_sem_data) return `<span class="status-pill disponivel">Recebido</span><small class="fin-sub">data não informada</small>`;
        return r.vencimento < hojeIso() ? `<span class="status-pill alugado">Vencido</span>` : `<span class="status-pill reservado">A vencer</span>`;
    }
    function renderReceber(box) {
        const hoje = hojeIso(), mes = hoje.slice(0, 7);
        const lista = recebiveis.filter(r => filtroRec === "todos" || (filtroRec === "aberto" && !recebido(r)) || (filtroRec === "vencido" && !recebido(r) && r.vencimento < hoje) || (filtroRec === "recebido" && recebido(r)));
        const soma = arr => arr.reduce((s, r) => s + Number(r.valor || 0), 0);
        box.innerHTML = `<div class="crm-resumo fin-cards fg-cards">
              ${card("Em aberto", soma(recebiveis.filter(r => !recebido(r))), recebiveis.filter(r => !recebido(r)).length + " parcela(s)")}
              ${card("Vencido", soma(recebiveis.filter(r => !recebido(r) && r.vencimento < hoje)), "sem baixa", recebiveis.some(r => !recebido(r) && r.vencimento < hoje))}
              ${card("Vence este mês", soma(recebiveis.filter(r => !recebido(r) && r.vencimento.startsWith(mes))), "")}
              ${card("Recebido este mês", soma(recebiveis.filter(r => r.recebido_em && r.recebido_em.startsWith(mes))), "")}
            </div>
            <div class="crm-toolbar">
              <select id="fgRecFiltro"><option value="aberto">Em aberto</option><option value="vencido">Vencidas</option><option value="recebido">Recebidas</option><option value="todos">Todas</option></select>
              <span class="crm-contagem">${lista.length} parcela(s) · ${h(dinheiro(soma(lista)))}</span>
            </div>
            <p class="muted-text crm-dica">As parcelas são criadas no negócio ganho (Negociações → abrir o negócio → "Parcelas a receber").</p>
            <div class="panel table-panel">${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Vencimento</th><th>Negócio</th><th>Parcela</th><th>Valor</th><th>Situação</th><th>Conta</th><th></th></tr></thead><tbody>
              ${lista.map(r => `<tr>
                <td data-r="Vencimento">${h(dataBr(r.vencimento))}</td>
                <td data-r="Negócio"><button type="button" class="text-button" data-abrir-neg="${h(r.negociacao_id)}">${h(nomeNegocio(r.negociacao_id))}</button></td>
                <td data-r="Parcela">${h(r.parcela)}ª${r.observacao ? `<small class="fin-sub">${h(r.observacao)}</small>` : ""}</td>
                <td data-r="Valor"><strong>${h(dinheiro(r.valor))}</strong></td>
                <td data-r="Situação">${situacaoRec(r)}${programado(r)}</td>
                <td data-r="Conta">${h(nomeConta(r.conta_id) || "—")}</td>
                <td class="fin-acoes">${podeGerir() ? (recebido(r) ? `<button type="button" class="text-button" data-rec-estornar="${h(r.id)}">Estornar</button>`
                    : `<button type="button" class="primary-button fin-mini" data-rec-baixa="${h(r.id)}">Recebido</button><button type="button" class="text-button" data-rec-prog="${h(r.id)}">Programar</button>`) : ""}</td>
              </tr>`).join("")}</tbody></table>` : `<div class="empty-state">Nenhuma parcela nesta seleção.</div>`}</div>`;
        $("fgRecFiltro").value = filtroRec;
        $("fgRecFiltro").addEventListener("change", () => { filtroRec = $("fgRecFiltro").value; renderReceber(box); });
        box.querySelectorAll("[data-abrir-neg]").forEach(b => b.addEventListener("click", () => window.SKLCRM && window.SKLCRM.abrirNegociacao(b.dataset.abrirNeg)));
        box.querySelectorAll("[data-rec-baixa]").forEach(b => b.addEventListener("click", () => abrirBaixa("recebivel", recebiveis.find(r => r.id === b.dataset.recBaixa))));
        box.querySelectorAll("[data-rec-prog]").forEach(b => b.addEventListener("click", () => abrirProgramar("recebivel", recebiveis.find(r => r.id === b.dataset.recProg))));
        box.querySelectorAll("[data-rec-estornar]").forEach(b => b.addEventListener("click", async () => {
            if (!window.confirm("Desfazer o recebimento desta parcela?")) return;
            const { error } = await ctx.sb.rpc("crm_baixar_recebivel", { p_id: b.dataset.recEstornar, p_recebido_em: null, p_conta: null });
            if (error) { ctx.toast(erro(error)); return; }
            await render("receber");
        }));
    }

    // ------------------------------------------------------------------ baixa (parcela a receber ou lançamento)
    function opcoesContas(atual, vazio) {
        return `<option value="">${h(vazio || "Sem conta")}</option>` + contas.filter(c => c.ativa || c.id === atual).map(c => `<option value="${h(c.id)}"${c.id === atual ? " selected" : ""}>${h(c.nome)}</option>`).join("");
    }
    function abrirBaixa(tipo, item, aoConcluir) {
        if (!item) return;
        baixaAlvo = { tipo, item, aoConcluir };
        const rec = tipo === "recebivel";
        $("fgBaixaEyebrow").textContent = rec ? "COMISSÃO A RECEBER" : (item.natureza === "receita" ? "RECEITA" : "DESPESA");
        $("fgBaixaTitulo").textContent = rec ? "Registrar recebimento" : (item.natureza === "receita" ? "Registrar recebimento" : "Registrar pagamento");
        $("fgBaixaInfo").textContent = rec ? `${nomeNegocio(item.negociacao_id)} · ${item.parcela}ª parcela · ${dinheiro(item.valor)}` : `${item.descricao} · ${dinheiro(item.valor)} · vence ${dataBr(item.vencimento)}`;
        $("fgBaixaRotulo").textContent = rec || item.natureza === "receita" ? "Recebido em" : "Pago em";
        $("fgBaixaData").value = hojeIso();
        $("fgBaixaConta").innerHTML = opcoesContas(item.conta_id || (contas.length === 1 ? contas[0].id : ""));
        $("fgBaixaMsg").hidden = true;
        $("fgBaixaDialog").showModal();
    }
    async function confirmarBaixa() {
        const data = $("fgBaixaData").value;
        if (!data) { falha("fgBaixaMsg", "Informe a data."); return; }
        const conta = $("fgBaixaConta").value || null;
        const { error } = baixaAlvo.tipo === "recebivel"
            ? await ctx.sb.rpc("crm_baixar_recebivel", { p_id: baixaAlvo.item.id, p_recebido_em: data, p_conta: conta })
            : await ctx.sb.rpc("fin_baixar_lancamento", { p_id: baixaAlvo.item.id, p_pago_em: data, p_conta: conta });
        if (error) { falha("fgBaixaMsg", error); return; }
        $("fgBaixaDialog").close();
        ctx.toast("Baixa registrada.");
        const aba = baixaAlvo.tipo === "recebivel" ? "receber" : "despesas";
        if (!$("finGestao").hidden) await render(aba); else await carregar();
        if (boxParcelas && negParcelas) desenharNaNegociacao(negParcelas, boxParcelas);
        if (baixaAlvo.aoConcluir) baixaAlvo.aoConcluir();
    }

    // ------------------------------------------------------------------ data programada (painel e listas)
    let progAlvo = null;
    function abrirProgramar(tipo, item, aoConcluir) {
        if (!item) return;
        progAlvo = { tipo, item, aoConcluir };
        const rec = tipo === "recebivel";
        $("fgProgTitulo").textContent = rec || item.natureza === "receita" ? "Programar recebimento" : "Programar pagamento";
        $("fgProgInfo").textContent = rec ? `${nomeNegocio(item.negociacao_id)} · ${item.parcela}ª parcela · ${dinheiro(item.valor)} · vence ${dataBr(item.vencimento)}`
            : `${item.descricao} · ${dinheiro(item.valor)} · vence ${dataBr(item.vencimento)}`;
        $("fgProgRotulo").textContent = rec || item.natureza === "receita" ? "Receber em" : "Pagar em";
        $("fgProgData").value = item.programado_para || item.vencimento || hojeIso();
        $("fgProgLimpar").hidden = !item.programado_para;
        $("fgProgMsg").hidden = true;
        $("fgProgDialog").showModal();
    }
    async function salvarProgramado(data) {
        if (!progAlvo) return;
        const { error } = await ctx.sb.rpc("fin_programar", { p_tipo: progAlvo.tipo, p_id: progAlvo.item.id, p_data: data });
        if (error) { falha("fgProgMsg", error); return; }
        $("fgProgDialog").close();
        ctx.toast(data ? "Data programada: " + dataBr(data) + "." : "Data programada retirada.");
        await carregar();
        if (!$("finGestao").hidden) await render(progAlvo.tipo === "recebivel" ? "receber" : "despesas");
        if (progAlvo.aoConcluir) progAlvo.aoConcluir();
    }
    const programado = x => x.programado_para && !(x.recebido_em || x.recebido_sem_data || x.pago_em || x.pago_sem_data)
        ? `<small class="fin-sub fg-programado">📅 programado ${h(dataBr(x.programado_para))}</small>` : "";

    // ------------------------------------------------------------------ despesas e receitas
    function situacaoLanc(l) {
        if (liquidado(l)) return `<span class="status-pill disponivel">Liquidado</span>`;
        return l.vencimento < hojeIso() ? `<span class="status-pill alugado">Vencido</span>` : `<span class="status-pill reservado">A vencer</span>`;
    }
    function renderDespesas(box) {
        const hoje = hojeIso(), mes = hoje.slice(0, 7);
        const f = filtroDesp;
        const lista = lancamentos.filter(l => (!f.natureza || l.natureza === f.natureza)
            && (!f.mes || l.vencimento.startsWith(f.mes) || (l.pago_em && l.pago_em.startsWith(f.mes)))
            && (!f.situacao || (f.situacao === "liquidado" ? liquidado(l) : f.situacao === "vencido" ? !liquidado(l) && l.vencimento < hoje : !liquidado(l) && l.vencimento >= hoje)))
            .sort((a, b) => (liquidado(a) ? 1 : 0) - (liquidado(b) ? 1 : 0) || a.vencimento.localeCompare(b.vencimento));
        const soma = arr => arr.reduce((s, l) => s + Number(l.valor || 0), 0);
        const desp = lancamentos.filter(l => l.natureza === "despesa");
        box.innerHTML = `<div class="crm-resumo fin-cards fg-cards">
              ${card("A pagar este mês", soma(desp.filter(l => !liquidado(l) && l.vencimento.startsWith(mes))), "")}
              ${card("Vencido", soma(desp.filter(l => !liquidado(l) && l.vencimento < hoje)), desp.filter(l => !liquidado(l) && l.vencimento < hoje).length + " despesa(s)", desp.some(l => !liquidado(l) && l.vencimento < hoje))}
              ${card("Pago este mês", soma(desp.filter(l => l.pago_em && l.pago_em.startsWith(mes))), "despesas")}
              ${card("Receitas do mês", soma(lancamentos.filter(l => l.natureza === "receita" && l.pago_em && l.pago_em.startsWith(mes))), "recebidas")}
            </div>
            <div class="crm-toolbar">
              <select id="fgDespNat"><option value="despesa">Despesas</option><option value="receita">Receitas</option><option value="">Despesas e receitas</option></select>
              <select id="fgDespSit"><option value="">Todas as situações</option><option value="aberto">A vencer</option><option value="vencido">Vencidas</option><option value="liquidado">Liquidadas</option></select>
              <input id="fgDespMes" type="month" title="Mês (vencimento ou pagamento)" />
              <span class="crm-contagem">${lista.length} lançamento(s) · ${h(dinheiro(soma(lista)))}</span>
              ${podeGerir() ? `<button id="fgNovoLanc" type="button" class="primary-button">+ Lançamento</button>
                <button id="fgPlanoBtn" type="button" class="secondary-button">Plano de contas</button>
                <button id="fgContasBtn" type="button" class="secondary-button">Contas bancárias</button>` : ""}
            </div>
            <div class="panel table-panel">${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Plano de contas</th><th>Valor</th><th>Situação</th><th>Conta</th><th></th></tr></thead><tbody>
              ${lista.map(l => `<tr>
                <td data-r="Vencimento">${h(dataBr(l.vencimento))}</td>
                <td data-r="Descrição"><strong>${h(l.descricao)}</strong>${l.natureza === "receita" ? `<small class="fin-sub">receita</small>` : ""}${l.observacao ? `<small class="fin-sub">${h(l.observacao)}</small>` : ""}</td>
                <td data-r="Plano de contas">${h(nomePlano(l.plano_conta_id) || l.plano_origem || "—")}</td>
                <td data-r="Valor"><strong>${h(dinheiro(l.valor))}</strong></td>
                <td data-r="Situação">${situacaoLanc(l)}${programado(l)}${l.pago_em ? `<small class="fin-sub">em ${h(dataBr(l.pago_em))}</small>` : l.pago_sem_data ? `<small class="fin-sub">data não informada</small>` : ""}</td>
                <td data-r="Conta">${h(nomeConta(l.conta_id) || "—")}</td>
                <td class="fin-acoes">${podeGerir() ? (liquidado(l) ? `<button type="button" class="text-button" data-lanc-estornar="${h(l.id)}">Estornar</button>`
                    : `<button type="button" class="primary-button fin-mini" data-lanc-baixa="${h(l.id)}">${l.natureza === "receita" ? "Recebido" : "Pago"}</button><button type="button" class="text-button" data-lanc-prog="${h(l.id)}">Programar</button>`)
                    + `<button type="button" class="text-button" data-lanc-editar="${h(l.id)}">Editar</button>` : ""}</td>
              </tr>`).join("")}</tbody></table>` : `<div class="empty-state">Nenhum lançamento nesta seleção.</div>`}</div>`;
        $("fgDespNat").value = f.natureza; $("fgDespSit").value = f.situacao; $("fgDespMes").value = f.mes;
        $("fgDespNat").addEventListener("change", () => { f.natureza = $("fgDespNat").value; renderDespesas(box); });
        $("fgDespSit").addEventListener("change", () => { f.situacao = $("fgDespSit").value; renderDespesas(box); });
        $("fgDespMes").addEventListener("change", () => { f.mes = $("fgDespMes").value; renderDespesas(box); });
        if ($("fgNovoLanc")) {
            $("fgNovoLanc").addEventListener("click", () => abrirLancamento(null));
            $("fgPlanoBtn").addEventListener("click", () => abrirCadastro("plano"));
            $("fgContasBtn").addEventListener("click", () => abrirCadastro("contas"));
        }
        box.querySelectorAll("[data-lanc-baixa]").forEach(b => b.addEventListener("click", () => abrirBaixa("lancamento", lancamentos.find(l => l.id === b.dataset.lancBaixa))));
        box.querySelectorAll("[data-lanc-prog]").forEach(b => b.addEventListener("click", () => abrirProgramar("lancamento", lancamentos.find(l => l.id === b.dataset.lancProg))));
        box.querySelectorAll("[data-lanc-editar]").forEach(b => b.addEventListener("click", () => abrirLancamento(lancamentos.find(l => l.id === b.dataset.lancEditar))));
        box.querySelectorAll("[data-lanc-estornar]").forEach(b => b.addEventListener("click", async () => {
            if (!window.confirm("Desfazer a baixa deste lançamento?")) return;
            const { error } = await ctx.sb.rpc("fin_baixar_lancamento", { p_id: b.dataset.lancEstornar, p_pago_em: null, p_conta: null });
            if (error) { ctx.toast(erro(error)); return; }
            await render("despesas");
        }));
    }
    function opcoesPlano(atual, natureza) {
        const lista = plano.filter(p => (p.ativo || p.id === atual) && (!natureza || p.natureza === natureza));
        const grupos = [ ...new Set(lista.map(p => p.grupo || "")) ].sort();
        return `<option value="">Sem plano de contas</option>` + grupos.map(g => {
            const ops = lista.filter(p => (p.grupo || "") === g).map(p => `<option value="${h(p.id)}"${p.id === atual ? " selected" : ""}>${h(p.nome)}</option>`).join("");
            return g ? `<optgroup label="${h(g)}">${ops}</optgroup>` : ops;
        }).join("");
    }
    function naturezaForm() { const r = document.querySelector('input[name="fgNat"]:checked'); return r ? r.value : "despesa"; }
    function abrirLancamento(l) {
        lancEditando = l;
        $("fgLancTitulo").textContent = l ? "Editar lançamento" : "Novo lançamento";
        document.querySelectorAll('input[name="fgNat"]').forEach(r => { r.checked = r.value === (l ? l.natureza : (filtroDesp.natureza || "despesa")); r.onchange = () => { $("fgLancPlano").innerHTML = opcoesPlano($("fgLancPlano").value, naturezaForm()); }; });
        $("fgLancDesc").value = l ? l.descricao : "";
        $("fgLancValor").value = l ? valorBR(l.valor) : "";
        $("fgLancVenc").value = l ? l.vencimento : hojeIso();
        $("fgLancPlano").innerHTML = opcoesPlano(l ? l.plano_conta_id : "", naturezaForm());
        $("fgLancConta").innerHTML = opcoesContas(l ? l.conta_id : (contas.length === 1 ? contas[0].id : ""));
        $("fgLancPago").value = l && l.pago_em ? l.pago_em : "";
        $("fgLancRepetir").value = 1;
        $("fgLancRepetirLbl").hidden = !!l;
        $("fgLancObs").value = l ? l.observacao || "" : "";
        $("fgLancExcluir").hidden = !l;
        $("fgLancMsg").hidden = true;
        $("fgLancDialog").showModal();
        $("fgLancDesc").focus();
    }
    async function salvarLancamento() {
        const base = {
            descricao: $("fgLancDesc").value, natureza: naturezaForm(), valor: numero($("fgLancValor").value), vencimento: $("fgLancVenc").value,
            plano_conta_id: $("fgLancPlano").value || null, conta_id: $("fgLancConta").value || null, pago_em: $("fgLancPago").value || null, observacao: $("fgLancObs").value
        };
        const vezes = lancEditando ? 1 : Math.min(Math.max(Number($("fgLancRepetir").value) || 1, 1), 36);
        $("fgLancSalvar").disabled = true;
        for (let i = 0; i < vezes; i++) {
            const dados = i === 0 ? base : { ...base, vencimento: somaMeses(base.vencimento, i), pago_em: null };
            const { error } = await ctx.sb.rpc("fin_salvar_lancamento", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: lancEditando ? lancEditando.id : null });
            if (error) { $("fgLancSalvar").disabled = false; falha("fgLancMsg", i ? `${erro(error)} (${i} de ${vezes} já salvos)` : error); await carregar(); return; }
        }
        $("fgLancSalvar").disabled = false;
        $("fgLancDialog").close();
        ctx.toast(vezes > 1 ? `${vezes} lançamentos criados.` : "Lançamento salvo.");
        await render("despesas");
    }
    async function excluirLancamento() {
        if (!lancEditando || !window.confirm("Excluir este lançamento?")) return;
        const { error } = await ctx.sb.rpc("fin_excluir_lancamento", { p_id: lancEditando.id });
        if (error) { falha("fgLancMsg", error); return; }
        $("fgLancDialog").close();
        await render("despesas");
    }

    // ------------------------------------------------------------------ plano de contas e contas bancárias
    function abrirCadastro(tipo) {
        $("fgCadTitulo").textContent = tipo === "plano" ? "Plano de contas" : "Contas bancárias";
        $("fgCadMsg").hidden = true;
        desenharCadastro(tipo);
        $("fgCadDialog").showModal();
    }
    function desenharCadastro(tipo) {
        const box = $("fgCadLista");
        if (tipo === "plano") {
            const linhas = [ ...plano, { id: "", nome: "", grupo: "", natureza: "despesa", ativo: true } ];
            box.innerHTML = `<p class="muted-text">Cada despesa ou receita pode ficar numa conta do plano (ex.: Energia, Salários, Marketing). O grupo junta as contas no relatório.</p>
              <div class="fg-cad">${linhas.map(p => `<div class="fg-cad-linha" data-id="${h(p.id)}">
                <input data-c="nome" placeholder="${p.id ? "" : "Nova conta (ex.: Conta de energia)"}" value="${h(p.nome)}" />
                <input data-c="grupo" placeholder="Grupo (ex.: Energia)" value="${h(p.grupo || "")}" />
                <select data-c="natureza"><option value="despesa"${p.natureza === "despesa" ? " selected" : ""}>Despesa</option><option value="receita"${p.natureza === "receita" ? " selected" : ""}>Receita</option></select>
                <label class="div-check"><input type="checkbox" data-c="ativo"${p.ativo ? " checked" : ""} /> Ativa</label>
                <button type="button" class="secondary-button fin-mini" data-salvar>${p.id ? "Salvar" : "Adicionar"}</button>
              </div>`).join("")}</div>`;
        } else {
            const linhas = [ ...contas, { id: "", nome: "", banco: "", agencia: "", conta: "", saldo_inicial: 0, aberta_em: "", ativa: true } ];
            box.innerHTML = `<p class="muted-text">Contas onde o dinheiro entra e sai. O saldo aparece em Resultado (saldo inicial + recebimentos − pagamentos com baixa nesta conta).</p>
              <div class="fg-cad">${linhas.map(c => `<div class="fg-cad-linha fg-cad-conta" data-id="${h(c.id)}">
                <input data-c="nome" placeholder="${c.id ? "" : "Nova conta (ex.: Itaú)"}" value="${h(c.nome)}" />
                <input data-c="agencia" placeholder="Agência" value="${h(c.agencia || "")}" />
                <input data-c="conta" placeholder="Conta" value="${h(c.conta || "")}" />
                <input data-c="saldo_inicial" inputmode="decimal" placeholder="Saldo inicial" value="${h(valorBR(c.saldo_inicial))}" />
                <input data-c="aberta_em" type="date" title="Data do saldo inicial" value="${h(c.aberta_em || "")}" />
                <label class="div-check"><input type="checkbox" data-c="ativa"${c.ativa ? " checked" : ""} /> Ativa</label>
                <button type="button" class="secondary-button fin-mini" data-salvar>${c.id ? "Salvar" : "Adicionar"}</button>
              </div>`).join("")}</div>`;
        }
        box.querySelectorAll(".fg-cad-linha").forEach(el => el.querySelector("[data-salvar]").addEventListener("click", async () => {
            const v = c => el.querySelector(`[data-c="${c}"]`);
            const dados = tipo === "plano"
                ? { nome: v("nome").value, grupo: v("grupo").value, natureza: v("natureza").value, ativo: v("ativo").checked }
                : { nome: v("nome").value, agencia: v("agencia").value, conta: v("conta").value, saldo_inicial: numero(v("saldo_inicial").value), aberta_em: v("aberta_em").value || null, ativa: v("ativa").checked };
            const { error } = await ctx.sb.rpc(tipo === "plano" ? "fin_salvar_plano_conta" : "fin_salvar_conta_bancaria", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: el.dataset.id || null });
            if (error) { falha("fgCadMsg", error); return; }
            $("fgCadMsg").hidden = true;
            await carregar();
            desenharCadastro(tipo);
            ctx.toast("Salvo.");
            const aba = document.querySelector("[data-fin-aba].ativa");
            if (aba && temAba(aba.dataset.finAba)) render(aba.dataset.finAba);
        }));
    }

    // ------------------------------------------------------------------ resultado (VGV, VGC, VLC)
    function intervalo() {
        const hoje = hojeIso(), [ a, m ] = hoje.split("-").map(Number);
        const ultimo = (ano, mes) => `${ano}-${String(mes).padStart(2, "0")}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;
        if (periodo === "mes") return [ `${a}-${String(m).padStart(2, "0")}-01`, ultimo(a, m), "este mês" ];
        if (periodo === "mes_passado") { const d = new Date(a, m - 2, 1); return [ `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, ultimo(d.getFullYear(), d.getMonth() + 1), "mês passado" ]; }
        if (periodo === "trimestre") { const t = Math.floor((m - 1) / 3); return [ `${a}-${String(t * 3 + 1).padStart(2, "0")}-01`, ultimo(a, t * 3 + 3), `${t + 1}º trimestre` ]; }
        if (periodo === "ano") return [ `${a}-01-01`, `${a}-12-31`, String(a) ];
        return [ "2000-01-01", "2100-12-31", "todo o período" ];
    }
    async function renderResultado(box) {
        const [ ini, fim, rot ] = intervalo();
        box.innerHTML = `<div class="crm-toolbar"><select id="fgPeriodo">
              <option value="mes">Este mês</option><option value="mes_passado">Mês passado</option><option value="trimestre">Este trimestre</option><option value="ano">Este ano</option><option value="tudo">Todo o período</option>
            </select><span class="crm-contagem">Negócios ganhos e baixas no período: ${h(rot)}</span></div><div id="fgResultado"><p class="muted-text">Calculando…</p></div>`;
        $("fgPeriodo").value = periodo;
        $("fgPeriodo").addEventListener("change", () => { periodo = $("fgPeriodo").value; renderResultado(box); });
        const { data: r, error } = await ctx.sb.rpc("fin_indicadores_imobiliaria", { p_carteira: ctx.carteiraId(), p_ini: ini, p_fim: fim });
        if (error) { $("fgResultado").innerHTML = `<p class="div-erro">${h(erro(error))}</p>`; return; }
        const caixa = Number(r.recebido_periodo) + Number(r.receitas_pagas) - Number(r.despesas_pagas);
        const maxPlano = Math.max(1, ...(r.por_plano || []).filter(p => p.natureza === "despesa").map(p => Number(p.total)));
        $("fgResultado").innerHTML = `
          <div class="crm-resumo fin-cards fg-cards">
            ${card("VGV", r.vgv, `${r.negocios} negócio(s) · venda ${dinheiro(r.vgv_venda)} · locação ${dinheiro(r.vgv_locacao)}`)}
            ${card("VGC", r.vgc, "comissão total dos negócios")}
            ${card("VLC", r.vlc, "fica para a imobiliária")}
            ${card("Comissões recebidas", r.recebido_periodo, "parcelas com baixa no período")}
            ${card("Despesas pagas", r.despesas_pagas, "no período")}
            ${card("Resultado de caixa", caixa, "recebido + receitas − despesas", caixa < 0)}
          </div>
          <div class="fg-resultado-grade">
            <article class="panel"><h3>A receber e a pagar</h3><ul class="fg-lista">
              <li><span>Comissões a receber (em aberto)</span><strong>${h(dinheiro(r.receber_aberto))}</strong></li>
              <li class="${Number(r.receber_vencido) > 0 ? "fg-alerta" : ""}"><span>…das quais vencidas</span><strong>${h(dinheiro(r.receber_vencido))}</strong></li>
              ${Number(r.recebido_sem_data) > 0 ? `<li><span>Comissões recebidas sem data informada (histórico)</span><strong>${h(dinheiro(r.recebido_sem_data))}</strong></li>` : ""}
              <li><span>Despesas em aberto até o fim do período</span><strong>${h(dinheiro(r.despesas_abertas))}</strong></li>
              <li class="${Number(r.despesas_vencidas) > 0 ? "fg-alerta" : ""}"><span>Despesas vencidas</span><strong>${h(dinheiro(r.despesas_vencidas))}</strong></li>
              <li><span>Negócios com parceiro</span><strong>${h(r.com_parceiros)} de ${h(r.negocios)}</strong></li>
            </ul></article>
            <article class="panel"><h3>Saldo por conta</h3>${(r.contas || []).length ? `<ul class="fg-lista">${r.contas.map(c => `<li><span>${h(c.nome)}</span><strong>${h(dinheiro(c.saldo))}</strong></li>`).join("")}</ul>`
              : `<p class="muted-text">Cadastre as contas bancárias em Despesas → Contas bancárias.</p>`}</article>
            <article class="panel fg-largo"><h3>Despesas por plano de contas</h3>${(r.por_plano || []).filter(p => p.natureza === "despesa").length
              ? `<ul class="fg-barras">${r.por_plano.filter(p => p.natureza === "despesa").map(p => `<li><span>${h(p.nome)}${p.grupo ? ` <small>${h(p.grupo)}</small>` : ""}</span>
                  <i><b style="width:${(Number(p.total) / maxPlano * 100).toFixed(1)}%"></b></i><strong>${h(dinheiro(p.total))}</strong></li>`).join("")}</ul>`
              : `<p class="muted-text">Nenhuma despesa paga no período.</p>`}</article>
          </div>
          <p class="muted-text crm-dica">VGV = valor dos negócios ganhos. VGC = comissão total (a da divisão do negócio ou, sem divisão, 1º aluguel / valor × honorários). VLC = o que fica para a imobiliária depois de corretores e parceiros.</p>`;
    }

    // ------------------------------------------------------------------ no negócio ganho: parcelas a receber
    function desenharNaNegociacao(n, box) {
        if (!box || !ctx) return;
        box.querySelectorAll(".fg-negocio").forEach(el => el.remove());
        if (!n || n.situacao !== "ganha" || !ctx.veTudo()) return;
        negParcelas = n; boxParcelas = box;
        const minhas = recebiveis.filter(r => r.negociacao_id === n.id).sort((a, b) => a.parcela - b.parcela);
        const sec = document.createElement("div");
        sec.className = "fg-negocio";
        const total = minhas.reduce((s, r) => s + Number(r.valor || 0), 0), jaRecebido = minhas.filter(recebido).reduce((s, r) => s + Number(r.valor || 0), 0);
        sec.innerHTML = `<span class="eyebrow">A RECEBER DA COMISSÃO</span>`
            + (minhas.length ? `<ul class="fg-lista">${minhas.map(r => `<li><span>${r.parcela}ª · vence ${h(dataBr(r.vencimento))}</span><strong>${h(dinheiro(r.valor))}</strong>${situacaoRec(r)}</li>`).join("")}</ul>
                <p class="muted-text">Total ${h(dinheiro(total))} · recebido ${h(dinheiro(jaRecebido))}</p>`
              : `<p class="muted-text">Nenhuma parcela a receber cadastrada.</p>`)
            + (podeGerir() ? `<button type="button" class="secondary-button" data-fg-parcelas>${minhas.length ? "Editar parcelas" : "Parcelas a receber"}</button>` : "");
        box.appendChild(sec);
        const b = sec.querySelector("[data-fg-parcelas]");
        if (b) b.addEventListener("click", () => abrirParcelas(n));
    }
    let parcelasEdit = [];
    function abrirParcelas(n) {
        negParcelas = n;
        const abertas = recebiveis.filter(r => r.negociacao_id === n.id && !recebido(r)).sort((a, b) => a.parcela - b.parcela);
        const jaRecebido = recebiveis.filter(r => r.negociacao_id === n.id && recebido(r)).reduce((s, r) => s + Number(r.valor || 0), 0);
        parcelasEdit = abertas.map(r => ({ vencimento: r.vencimento, valor: r.valor == null ? null : Number(r.valor), observacao: r.observacao || "" }));
        $("fgParcTitulo").textContent = "Parcelas a receber" + (n.titulo ? " — " + n.titulo : "");
        const sugerido = n.comissao_total != null ? Number(n.comissao_total) - jaRecebido : null;
        $("fgParcTotal").value = parcelasEdit.length ? valorBR(parcelasEdit.reduce((s, p) => s + (p.valor || 0), 0)) : (sugerido > 0 ? valorBR(sugerido) : "");
        $("fgParcQtd").value = parcelasEdit.length || 1;
        $("fgParcVenc").value = parcelasEdit.length ? parcelasEdit[0].vencimento : hojeIso();
        $("fgParcMsg").hidden = true;
        desenharParcelas();
        $("fgParcDialog").showModal();
    }
    function gerarParcelas() {
        const total = numero($("fgParcTotal").value), qtd = Math.min(Math.max(Number($("fgParcQtd").value) || 1, 1), 120), venc = $("fgParcVenc").value;
        if (!(total > 0) || !venc) { falha("fgParcMsg", "Informe o total e o 1º vencimento."); return; }
        const base = Math.floor(total / qtd * 100) / 100;
        parcelasEdit = Array.from({ length: qtd }, (_, i) => ({ vencimento: somaMeses(venc, i), valor: i === qtd - 1 ? Math.round((total - base * (qtd - 1)) * 100) / 100 : base, observacao: "" }));
        $("fgParcMsg").hidden = true;
        desenharParcelas();
    }
    function desenharParcelas() {
        const box = $("fgParcLista");
        box.innerHTML = parcelasEdit.length ? `<div class="fg-parc">${parcelasEdit.map((p, i) => `<div class="fg-parc-linha" data-i="${i}">
              <span>${i + 1}ª</span>
              <input type="date" data-c="vencimento" value="${h(p.vencimento)}" />
              <input inputmode="decimal" data-c="valor" value="${h(valorBR(p.valor))}" />
              <input data-c="observacao" placeholder="Observação (ex.: paga pela construtora)" value="${h(p.observacao)}" />
              <button type="button" class="div-tirar" data-tirar aria-label="Tirar">×</button></div>`).join("")}</div>
            <button type="button" class="text-button" data-add-parc>+ parcela</button>` : `<p class="muted-text">Informe o total, quantas parcelas e o 1º vencimento e clique em Dividir.</p>`;
        box.querySelectorAll(".fg-parc-linha").forEach(el => {
            const p = parcelasEdit[Number(el.dataset.i)];
            el.querySelector('[data-c="vencimento"]').addEventListener("change", e => { p.vencimento = e.target.value; });
            el.querySelector('[data-c="valor"]').addEventListener("input", e => { p.valor = numero(e.target.value); somaParcelas(); });
            el.querySelector('[data-c="observacao"]').addEventListener("input", e => { p.observacao = e.target.value; });
            el.querySelector("[data-tirar]").addEventListener("click", () => { parcelasEdit.splice(Number(el.dataset.i), 1); desenharParcelas(); });
        });
        const add = box.querySelector("[data-add-parc]");
        if (add) add.addEventListener("click", () => {
            const ult = parcelasEdit[parcelasEdit.length - 1];
            parcelasEdit.push({ vencimento: ult ? somaMeses(ult.vencimento, 1) : hojeIso(), valor: null, observacao: "" });
            desenharParcelas();
        });
        somaParcelas();
    }
    function somaParcelas() {
        const s = parcelasEdit.reduce((t, p) => t + (Number(p.valor) || 0), 0);
        const ct = negParcelas && negParcelas.comissao_total != null ? Number(negParcelas.comissao_total) : null;
        $("fgParcSoma").textContent = parcelasEdit.length ? `Soma das parcelas em aberto: ${dinheiro(s)}${ct != null ? ` · comissão total do negócio: ${dinheiro(ct)}` : ""}` : "";
    }
    async function salvarParcelas() {
        $("fgParcSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_salvar_recebiveis", { p_negociacao: negParcelas.id, p_parcelas: parcelasEdit });
        $("fgParcSalvar").disabled = false;
        if (error) { falha("fgParcMsg", error); return; }
        $("fgParcDialog").close();
        await carregar();
        if (boxParcelas) desenharNaNegociacao(negParcelas, boxParcelas);
        ctx.toast(`${data} parcela(s) a receber salva(s).`);
    }

    function sair() { contas = []; plano = []; lancamentos = []; recebiveis = []; const b = $("finGestao"); if (b) b.innerHTML = ""; }

    window.SKLFinGestao = { iniciar, sair, carregar, temAba, render, desenharNaNegociacao, abrirBaixa, abrirProgramar, nomeNegocio, dados: () => ({ contas, plano, lancamentos, recebiveis }) };
})();
