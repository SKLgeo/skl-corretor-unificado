// Administração de aluguéis — complementos do Financeiro (Bloco 8):
//  • Régua de cobrança: quem avisar hoje (vence em N dias, vence hoje, em atraso), mensagem pronta e registro de cada aviso;
//  • Encargos: IPTU, condomínio, seguro, contas — quem paga, vencimento, situação e alertas;
//  • Manutenção: chamados com prioridade, responsável, prazo, fotos e histórico;
//  • Rescisão calculada dentro do contrato (multa proporcional, aluguel proporcional, caução) e termo para imprimir.
// Escrita só pelas RPCs fin_salvar_regua, fin_registrar_contato, enc_*, chamado_*, fin_simular_rescisao, fin_rescindir_contrato.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const F = () => window.SKLFinanceiro;
    const ABAS = [ "regua", "encargos", "chamados" ];
    const TIPOS_ENC = { iptu: "IPTU", condominio: "Condomínio", seguro_incendio: "Seguro incêndio", agua: "Água", luz: "Energia", gas: "Gás", taxa_lixo: "Taxa de lixo", outro: "Outro" };
    const RESP = { inquilino: "Inquilino", proprietario: "Proprietário", imobiliaria: "Imobiliária" };
    const CATS = { hidraulica: "Hidráulica", eletrica: "Elétrica", estrutura: "Estrutura / infiltração", pintura: "Pintura", telhado: "Telhado", equipamento: "Equipamento", chaveiro: "Chaveiro / fechadura", limpeza: "Limpeza", outro: "Outro" };
    const PRIOR = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };
    const SOLIC = { inquilino: "Inquilino", proprietario: "Proprietário", vistoria: "Vistoria", imobiliaria: "Imobiliária" };
    const STATUS_CH = { aberto: "Aberto", em_andamento: "Em andamento", aguardando: "Aguardando", concluido: "Concluído", cancelado: "Cancelado" };
    const PAGA = { a_definir: "A definir", inquilino: "Inquilino", proprietario: "Proprietário", imobiliaria: "Imobiliária" };
    const ETAPAS = { lembrete: "Vence em breve", vencimento: "Vence hoje", atraso: "Em atraso" };
    const MSG_PADRAO = {
        lembrete: "Olá, {nome}! Passando para lembrar que o aluguel de {mes} ({imovel}) vence em {vencimento}, no valor de {valor}. {pagamento} Qualquer dúvida, estamos à disposição. {imobiliaria}",
        vencimento: "Olá, {nome}! O aluguel de {mes} ({imovel}) vence hoje, {vencimento}, no valor de {valor}. {pagamento} Se já pagou, pode desconsiderar. {imobiliaria}",
        atraso: "Olá, {nome}. Não identificamos o pagamento do aluguel de {mes} ({imovel}), vencido em {vencimento} ({dias} dia(s)). Valor atualizado com multa e juros: {valor}. {pagamento} Se já pagou, por favor nos envie o comprovante. {imobiliaria}"
    };
    const filtros = {
        regua: { avisar: "Quem avisar agora", todas: "Toda a régua" },
        encargos: { pendentes: "Pendentes", vencidos: "Vencidos", proximos: "Vencem em até 30 dias", pagos: "Pagos", todos: "Todos" },
        chamados: { abertos: "Em aberto", urgentes: "Urgentes e altos", atrasados: "Prazo vencido", concluidos: "Concluídos", todos: "Todos" }
    };

    let ctx = null, ligado = false, canal = null, timer = null;
    let encargos = [], chamados = [], contatos = [], regua = {};
    let encAberto = null, chAberto = null, resCalc = null;

    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const podeGerir = () => !!ctx && ctx.podeGerir();
    const veTudo = () => !!ctx && ctx.veTudo();
    function dinheiro(v) { return v == null || v === "" ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function num(v) { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null || Number.isNaN(n) ? null : n; }
    function pct(v) { return String(v ?? "").replace(".", ","); }
    function dataBr(iso) { return iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—"; }
    function mesAno(iso) { return iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(" de ", "/") : "—"; }
    function hojeIso() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    function somaDias(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    function diasEntre(a, b) { return Math.round((new Date(String(b).slice(0, 10) + "T12:00:00") - new Date(String(a).slice(0, 10) + "T12:00:00")) / 86400000); }
    function normal(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function erro(e) { return ctx.traduzErro((e && e.message) || String(e || "")); }
    function msg(el, texto) { if (el) { el.textContent = texto; el.hidden = !texto; } }
    function digitos(t) { return String(t || "").replace(/\D/g, ""); }
    function bate(texto) { const q = normal(($("finBusca") || {}).value || ""); return !q.trim() || normal(texto).includes(q.trim()); }

    const contrato = id => (F().contratos() || []).find(c => c.id === id) || null;
    const cliente = id => (id && F().cliente(id)) || null;
    const nomeCli = id => (cliente(id) || {}).nome || "—";
    const imovel = id => ctx.imoveis().find(c => c.id === id) || null;
    // contrato com imóvel não cadastrado guarda a descrição no próprio contrato (imovel_avulso)
    const imovelCt = c => (c && c.construcao_id ? imovel(c.construcao_id) : null)
        || (c && c.imovel_avulso ? { nome: c.imovel_avulso.descricao, endereco: [ c.imovel_avulso.endereco, c.imovel_avulso.cidade ].filter(Boolean).join(", ") } : null);
    const nomeImovel = id => { const c = imovel(id); return c ? ((c.codigo ? c.codigo + " · " : "") + c.nome) : "—"; };
    const nomeImovelCt = c => { const i = imovelCt(c); return i ? ((i.codigo ? i.codigo + " · " : "") + (i.nome || "")) : "—"; };
    const nomeUsuario = id => ((ctx.equipe() || []).find(u => u.id === id) || {}).display_name || "—";

    // ------------------------------------------------------------------ início, dados e tempo real
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { criarDialogs(); ligado = true; }
        encargos = []; chamados = []; contatos = []; regua = {};
        if (!veTudo()) return;
        ligarTempoReal();
        carregar();
    }
    function sair() {
        if (canal && ctx) ctx.sb.removeChannel(canal);
        canal = null; encargos = []; chamados = []; contatos = [];
    }
    function ligarTempoReal() {
        if (canal) ctx.sb.removeChannel(canal);
        const cart = ctx.carteiraId();
        canal = ctx.sb.channel(`financeiro-extra-${cart}`);
        [ "aluguel_encargos", "aluguel_chamados", "aluguel_cobranca_contatos" ].forEach(t =>
            canal.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `carteira_id=eq.${cart}` }, () => {
                clearTimeout(timer); timer = setTimeout(carregar, 700);
            }));
        canal.subscribe();
    }
    async function carregar() {
        if (!veTudo()) return;
        const cart = ctx.carteiraId();
        const [ e, c, k, r ] = await Promise.all([
            ctx.sb.from("aluguel_encargos").select("*").eq("carteira_id", cart).or(`status.eq.pendente,vencimento.gte.${somaDias(hojeIso(), -400)}`).order("vencimento"),
            ctx.sb.from("aluguel_chamados").select("*").eq("carteira_id", cart).order("numero", { ascending: false }),
            ctx.sb.from("aluguel_cobranca_contatos").select("*").eq("carteira_id", cart).gte("created_at", somaDias(hojeIso(), -90) + "T00:00:00").order("created_at"),
            ctx.sb.from("carteiras_aluguel").select("regua_cobranca").eq("id", cart).maybeSingle()
        ]);
        if (!e.error) encargos = e.data || [];
        if (!c.error) chamados = c.data || [];
        if (!k.error) contatos = k.data || [];
        if (!r.error) regua = (r.data && r.data.regua_cobranca) || {};
        atualizarSelos();
        const pagina = $("page-financeiro");
        if (pagina && pagina.classList.contains("active-page") && F()) F().renderizar();
    }
    function atualizarSelos() {
        const sel = (id, n) => { const b = $(id); if (b) { b.textContent = n; b.hidden = !n; } };
        sel("finReguaBadge", linhasRegua().filter(l => l.avisar).length);
        sel("finEncBadge", encargos.filter(e => e.status === "pendente" && e.vencimento <= somaDias(hojeIso(), 7)).length);
        sel("finChBadge", chamados.filter(c => [ "aberto", "em_andamento", "aguardando" ].includes(c.status)).length);
    }

    // ------------------------------------------------------------------ abas (chamadas pelo financeiro.js)
    function temAba(a) { return ABAS.includes(a); }
    function render(aba) {
        const box = $("finExtra");
        if (!box) return;
        if (ctx && veTudo()) atualizarSelos();
        box.hidden = !temAba(aba);
        if (!temAba(aba) || !ctx) return;
        if (aba === "regua") renderRegua(box);
        else if (aba === "encargos") renderEncargos(box);
        else renderChamados(box);
    }

    // ------------------------------------------------------------------ 1. régua de cobrança
    function diasAntes() { return regua.dias_antes == null ? 3 : Number(regua.dias_antes); }
    function valorAtualizado(b, c) {
        const dias = Math.max(diasEntre(b.vencimento, hojeIso()), 0);
        if (!dias || !c) return { total: Number(b.valor_total), dias: 0 };
        const multa = Math.round(b.valor_aluguel * c.multa_atraso_pct) / 100;
        const juros = Math.round(b.valor_aluguel * c.juros_mes_pct / 100 * dias / 30 * 100) / 100;
        return { total: Number(b.valor_total) + multa + juros, dias };
    }
    function linhasRegua() {
        if (!F()) return [];
        const hoje = hojeIso(), limite = somaDias(hoje, diasAntes());
        return (F().cobrancas() || []).filter(b => b.status === "aberta" && b.vencimento <= limite).map(b => {
            const c = contrato(b.contrato_id) || {};
            const etapa = b.vencimento > hoje ? "lembrete" : b.vencimento === hoje ? "vencimento" : "atraso";
            const meus = contatos.filter(k => k.cobranca_id === b.id);
            const ultimo = meus[meus.length - 1] || null;
            const avisar = etapa === "atraso"
                ? !meus.some(k => k.etapa === "atraso" && diasEntre(k.created_at, hoje) < 3)
                : !meus.some(k => k.etapa === etapa);
            return { b, c, etapa, ultimo, avisar, valor: valorAtualizado(b, c) };
        }).sort((x, y) => x.b.vencimento.localeCompare(y.b.vencimento));
    }
    function mensagem(l) {
        const inq = cliente(l.c.inquilino_id) || {};
        const modelo = regua["msg_" + l.etapa] || MSG_PADRAO[l.etapa];
        const troca = {
            nome: (inq.nome || "").split(" ")[0] || "tudo bem", valor: dinheiro(l.valor.total), vencimento: dataBr(l.b.vencimento),
            mes: mesAno(l.b.competencia), imovel: nomeImovelCt(l.c), dias: l.valor.dias,
            pagamento: regua.pagamento ? regua.pagamento.trim().replace(/([^.!?])$/, "$1.") : "", imobiliaria: ctx.carteiraNome()
        };
        return modelo.replace(/\{(\w+)\}/g, (m, k) => (k in troca ? String(troca[k]) : m)).replace(/\s{2,}/g, " ").trim();
    }
    function renderRegua(box) {
        const f = $("finFiltro").value || "avisar";
        const todas = linhasRegua();
        const lista = todas.filter(l => (f === "todas" || l.avisar) && bate(`${l.c.numero} ${nomeCli(l.c.inquilino_id)} ${nomeImovelCt(l.c)}`));
        $("finContagem").textContent = `${lista.length} aviso(s) · ${dinheiro(lista.reduce((s, l) => s + l.valor.total, 0))}`;
        const grupo = etapa => {
            const itens = lista.filter(l => l.etapa === etapa);
            if (!itens.length) return "";
            return `<section class="fx-grupo fx-${etapa}"><h3>${h(ETAPAS[etapa])} <b class="nav-badge">${itens.length}</b></h3>
              <div class="fx-cartoes">${itens.map(l => cartaoRegua(l)).join("")}</div></section>`;
        };
        box.innerHTML = `<div class="panel fx-painel">
            <div class="fx-topo"><p class="muted-text">Aluguéis que vencem nos próximos ${diasAntes()} dia(s), que vencem hoje e os atrasados. Toque em WhatsApp ou E-mail: a mensagem já vai pronta e o aviso fica registrado. Atrasados voltam para a lista a cada 3 dias sem aviso.</p>
              ${podeGerir() ? `<button type="button" class="secondary-button" id="fxReguaConfig">Mensagens e configuração</button>` : ""}</div>
            ${lista.length ? grupo("atraso") + grupo("vencimento") + grupo("lembrete")
                : `<div class="empty-state">${f === "avisar" && todas.length ? "Todo mundo já foi avisado. 👍" : "Nenhum aluguel para avisar agora."}</div>`}
          </div>`;
        const cfg = $("fxReguaConfig"); if (cfg) cfg.addEventListener("click", abrirConfigRegua);
        ligarRegua(box, todas);
    }
    function cartaoRegua(l) {
        const inq = cliente(l.c.inquilino_id) || {};
        const tel = digitos(inq.telefone), texto = mensagem(l);
        const ult = l.ultimo ? `Avisado por ${l.ultimo.canal === "email" ? "e-mail" : l.ultimo.canal === "telefone" ? "telefone" : "WhatsApp"} em ${new Date(l.ultimo.created_at).toLocaleDateString("pt-BR")}` : "Ainda não avisado";
        return `<article class="fx-cartao${l.avisar ? " fx-pendente" : ""}">
            <header><strong>${h(inq.nome || "—")}</strong><span class="status-pill ${l.etapa === "atraso" ? "fin-atrasada" : l.etapa === "vencimento" ? "fin-hoje" : "fin-aberta"}">${l.etapa === "atraso" ? `${l.valor.dias} dia(s) em atraso` : l.etapa === "vencimento" ? "Vence hoje" : `Vence ${dataBr(l.b.vencimento)}`}</span></header>
            <small>${h(nomeImovelCt(l.c))} · ${l.b.tipo === "rescisao" ? "rescisão" : h(l.b.parcela) + "ª parcela"} (${h(mesAno(l.b.competencia))})</small>
            <div class="fx-valor">${h(dinheiro(l.valor.total))}${l.valor.dias ? `<small>com multa e juros</small>` : ""}</div>
            <small class="fx-ultimo">${h(ult)}</small>
            <div class="fin-acoes">
              ${tel.length >= 10 ? `<a class="crm-btn-contato whats" data-fx-whats="${h(l.b.id)}" data-etapa="${l.etapa}" href="https://wa.me/55${tel}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
              ${inq.email ? `<a class="secondary-button fin-mini" data-fx-email="${h(l.b.id)}" data-etapa="${l.etapa}" href="mailto:${h(inq.email)}?subject=${encodeURIComponent("Aluguel de " + mesAno(l.b.competencia) + " — " + ctx.carteiraNome())}&body=${encodeURIComponent(texto)}">E-mail</a>` : ""}
              <button type="button" class="text-button" data-fx-avisei="${h(l.b.id)}" data-etapa="${l.etapa}">Já avisei</button>
              ${podeGerir() ? `<button type="button" class="primary-button fin-mini" data-fx-receber="${h(l.b.id)}">Receber</button>` : ""}
            </div>
            ${!tel && !inq.email ? `<small class="fin-txt-alerta">Inquilino sem celular e sem e-mail no cadastro.</small>` : ""}
          </article>`;
    }
    function ligarRegua(box) {
        const registrar = async (id, etapa, canal) => {
            const { error } = await ctx.sb.rpc("fin_registrar_contato", { p_cobranca: id, p_etapa: etapa, p_canal: canal, p_observacao: null });
            if (error) ctx.toast(erro(error)); else carregar();
        };
        box.querySelectorAll("[data-fx-whats]").forEach(a => a.addEventListener("click", () => registrar(a.dataset.fxWhats, a.dataset.etapa, "whatsapp")));
        box.querySelectorAll("[data-fx-email]").forEach(a => a.addEventListener("click", () => registrar(a.dataset.fxEmail, a.dataset.etapa, "email")));
        box.querySelectorAll("[data-fx-avisei]").forEach(b => b.addEventListener("click", () => {
            if (window.confirm("Marcar como avisado (por telefone ou pessoalmente)?")) registrar(b.dataset.fxAvisei, b.dataset.etapa, "telefone");
        }));
        box.querySelectorAll("[data-fx-receber]").forEach(b => b.addEventListener("click", () => F().abrirPagamentoId(b.dataset.fxReceber)));
    }
    function abrirConfigRegua() {
        $("fxRgDias").value = diasAntes();
        $("fxRgPagamento").value = regua.pagamento || "";
        [ "lembrete", "vencimento", "atraso" ].forEach(k => { $("fxRgMsg_" + k).value = regua["msg_" + k] || MSG_PADRAO[k]; });
        msg($("fxRgMsg"), "");
        $("fxReguaDialog").showModal();
    }
    async function salvarConfigRegua() {
        const cfg = { dias_antes: Number($("fxRgDias").value), pagamento: $("fxRgPagamento").value.trim() };
        [ "lembrete", "vencimento", "atraso" ].forEach(k => { const v = $("fxRgMsg_" + k).value.trim(); cfg["msg_" + k] = v === MSG_PADRAO[k] ? "" : v; });
        const { data, error } = await ctx.sb.rpc("fin_salvar_regua", { p_carteira: ctx.carteiraId(), p_config: cfg });
        if (error) { msg($("fxRgMsg"), erro(error)); return; }
        regua = data || cfg;
        $("fxReguaDialog").close();
        ctx.toast("Régua de cobrança salva.");
        atualizarSelos(); F().renderizar();
    }

    // ------------------------------------------------------------------ 2. encargos
    function situacaoEnc(e) {
        const hoje = hojeIso();
        if (e.status === "pago") return `<span class="status-pill fin-paga">Pago${e.pago_em ? " " + h(dataBr(e.pago_em)) : ""}</span>`;
        if (e.status === "cancelado") return `<span class="status-pill fin-cancelada">Cancelado</span>`;
        if (e.vencimento < hoje) return `<span class="status-pill fin-atrasada">Vencido há ${diasEntre(e.vencimento, hoje)} dia(s)</span>`;
        if (e.vencimento <= somaDias(hoje, 7)) return `<span class="status-pill fin-hoje">Vence ${e.vencimento === hoje ? "hoje" : h(dataBr(e.vencimento))}</span>`;
        return `<span class="status-pill fin-aberta">Pendente</span>`;
    }
    function nomeEnc(e) { return (TIPOS_ENC[e.tipo] || "Encargo") + (e.descricao ? " · " + e.descricao : "") + (e.parcelas ? ` (${e.parcela}/${e.parcelas})` : ""); }
    function onde(e) {
        const c = e.contrato_id ? contrato(e.contrato_id) : null;
        return `${h(nomeImovel(e.construcao_id))}${c ? `<small class="fin-sub">Contrato nº ${h(c.numero)} · ${h(nomeCli(c.inquilino_id))}</small>` : ""}`;
    }
    function renderEncargos(box) {
        const f = $("finFiltro").value || "pendentes", hoje = hojeIso();
        const lista = encargos.filter(e => {
            if (f === "pendentes" && e.status !== "pendente") return false;
            if (f === "vencidos" && !(e.status === "pendente" && e.vencimento < hoje)) return false;
            if (f === "proximos" && !(e.status === "pendente" && e.vencimento >= hoje && e.vencimento <= somaDias(hoje, 30))) return false;
            if (f === "pagos" && e.status !== "pago") return false;
            const c = e.contrato_id ? contrato(e.contrato_id) : null;
            return bate(`${nomeEnc(e)} ${nomeImovel(e.construcao_id)} ${c ? c.numero + " " + nomeCli(c.inquilino_id) + " " + nomeCli(c.proprietario_id) : ""}`);
        }).sort((a, b) => f === "pagos" ? String(b.pago_em || "").localeCompare(String(a.pago_em || "")) : a.vencimento.localeCompare(b.vencimento));
        $("finContagem").textContent = `${lista.length} encargo(s) · ${dinheiro(lista.reduce((s, e) => s + Number(e.valor || 0), 0))}`;
        box.innerHTML = `<div class="panel fx-painel">
            <div class="fx-topo"><p class="muted-text">IPTU, condomínio, seguro incêndio e contas de cada imóvel: quem paga, quando vence e se já foi pago. Quando é o inquilino ou o proprietário que paga, marque "pago" ao receber o comprovante.</p>
              ${podeGerir() ? `<button type="button" class="primary-button" data-fx-novo-enc>+ Encargo</button>` : ""}</div>
            ${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Vencimento</th><th>Encargo</th><th>Imóvel</th><th>Quem paga</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>
              ${lista.map(e => `<tr>
                <td data-r="Vencimento">${h(dataBr(e.vencimento))}</td>
                <td data-r="Encargo"><strong>${h(nomeEnc(e))}</strong>${e.observacao ? `<small class="fin-sub">${h(e.observacao)}</small>` : ""}</td>
                <td data-r="Imóvel">${onde(e)}</td>
                <td data-r="Quem paga">${h(RESP[e.responsavel])}</td>
                <td data-r="Valor">${h(dinheiro(e.valor))}</td>
                <td data-r="Situação">${situacaoEnc(e)}</td>
                <td class="fin-acoes">${podeGerir() ? (e.status === "pendente"
                    ? `<button type="button" class="primary-button fin-mini" data-fx-enc-pago="${h(e.id)}">Marcar pago</button>`
                    : `<button type="button" class="text-button" data-fx-enc-reabrir="${h(e.id)}">Voltar a pendente</button>`)
                  + `<button type="button" class="secondary-button fin-mini" data-fx-enc="${h(e.id)}">Editar</button>` : ""}</td></tr>`).join("")}
              </tbody></table>` : `<div class="empty-state">Nenhum encargo nesta seleção.${podeGerir() ? " Toque em \"+ Encargo\" para lançar IPTU, condomínio etc." : ""}</div>`}
          </div>`;
        ligarEncargos(box);
    }
    function ligarEncargos(box) {
        box.querySelectorAll("[data-fx-novo-enc]").forEach(b => b.addEventListener("click", () => abrirEncargo(null)));
        box.querySelectorAll("[data-fx-enc]").forEach(b => b.addEventListener("click", () => abrirEncargo(encargos.find(e => e.id === b.dataset.fxEnc))));
        box.querySelectorAll("[data-fx-enc-pago]").forEach(b => b.addEventListener("click", async () => {
            const { error } = await ctx.sb.rpc("enc_marcar", { p_id: b.dataset.fxEncPago, p_status: "pago", p_pago_em: hojeIso() });
            if (error) ctx.toast(erro(error)); else { ctx.toast("Encargo marcado como pago."); carregar(); }
        }));
        box.querySelectorAll("[data-fx-enc-reabrir]").forEach(b => b.addEventListener("click", async () => {
            const { error } = await ctx.sb.rpc("enc_marcar", { p_id: b.dataset.fxEncReabrir, p_status: "pendente", p_pago_em: null });
            if (error) ctx.toast(erro(error)); else carregar();
        }));
    }
    function opcoesContratos(sel, soAtivos) {
        const lista = (F().contratos() || []).filter(c => !soAtivos || c.status === "ativo" || c.id === sel);
        return `<option value="">Sem contrato (só o imóvel)</option>` + lista.map(c => `<option value="${h(c.id)}"${c.id === sel ? " selected" : ""}>Nº ${h(c.numero)} · ${h(nomeCli(c.inquilino_id))} · ${h(nomeImovelCt(c))}</option>`).join("");
    }
    function opcoesImoveis(sel) {
        const lista = ctx.imoveis().slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
        return `<option value="">Escolha o imóvel…</option>` + lista.map(i => `<option value="${h(i.id)}"${i.id === sel ? " selected" : ""}>${h((i.codigo ? i.codigo + " · " : "") + i.nome)}</option>`).join("");
    }
    const opcoes = (mapa, sel) => Object.entries(mapa).map(([ v, t ]) => `<option value="${v}"${v === sel ? " selected" : ""}>${h(t)}</option>`).join("");
    function abrirEncargo(e, padrao) {
        if (!podeGerir()) return;
        const base = e || padrao || {};
        encAberto = e ? e.id : null;
        $("fxEncTitulo").textContent = e ? "Editar encargo" : "Novo encargo";
        $("fxEncContrato").innerHTML = opcoesContratos(base.contrato_id, true);
        $("fxEncImovel").innerHTML = opcoesImoveis(base.construcao_id);
        $("fxEncTipo").innerHTML = opcoes(TIPOS_ENC, base.tipo || "iptu");
        $("fxEncResp").innerHTML = opcoes(RESP, base.responsavel || "inquilino");
        $("fxEncDesc").value = base.descricao || "";
        $("fxEncVenc").value = base.vencimento || hojeIso();
        $("fxEncValor").value = base.valor != null ? pct(base.valor) : "";
        $("fxEncObs").value = base.observacao || "";
        $("fxEncRepetir").value = "1"; $("fxEncIntervalo").value = "mensal";
        $("fxEncRepetirBox").hidden = !!e;
        $("fxEncExcluir").hidden = !e;
        $("fxEncExcluirSerie").hidden = !(e && e.serie);
        msg($("fxEncMsg"), "");
        $("fxEncargoDialog").showModal();
    }
    async function salvarEncargo() {
        const d = {
            contrato_id: $("fxEncContrato").value || null, construcao_id: $("fxEncImovel").value || null, tipo: $("fxEncTipo").value,
            responsavel: $("fxEncResp").value, descricao: $("fxEncDesc").value.trim(), vencimento: $("fxEncVenc").value,
            valor: num($("fxEncValor").value), observacao: $("fxEncObs").value.trim(),
            repetir: Number($("fxEncRepetir").value) || 1, intervalo: $("fxEncIntervalo").value
        };
        if (!d.contrato_id && !d.construcao_id) { msg($("fxEncMsg"), "Escolha o contrato ou o imóvel."); return; }
        if (!d.vencimento) { msg($("fxEncMsg"), "Informe o vencimento."); return; }
        $("fxEncSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("enc_salvar", { p_carteira: ctx.carteiraId(), p_dados: d, p_id: encAberto });
        $("fxEncSalvar").disabled = false;
        if (error) { msg($("fxEncMsg"), erro(error)); return; }
        $("fxEncargoDialog").close();
        ctx.toast(encAberto ? "Encargo atualizado." : data && data.qtd > 1 ? `${data.qtd} parcelas lançadas.` : "Encargo lançado.");
        await carregar();
        reabrirContratoSeAberto();
    }
    async function excluirEncargo(serie) {
        if (!encAberto) return;
        if (!window.confirm(serie ? "Excluir esta parcela e as próximas pendentes da mesma série?" : "Excluir este encargo?")) return;
        const { error } = await ctx.sb.rpc("enc_excluir", { p_id: encAberto, p_serie_pendentes: !!serie });
        if (error) { msg($("fxEncMsg"), erro(error)); return; }
        $("fxEncargoDialog").close();
        ctx.toast("Encargo excluído.");
        await carregar();
        reabrirContratoSeAberto();
    }

    // ------------------------------------------------------------------ 3. chamados de manutenção
    function situacaoCh(c) {
        const cls = { aberto: "fin-aberta", em_andamento: "fin-hoje", aguardando: "fin-hoje", concluido: "fin-paga", cancelado: "fin-cancelada" }[c.status];
        return `<span class="status-pill ${cls}">${h(STATUS_CH[c.status])}</span>`;
    }
    function prioridade(c) { return `<span class="fx-prior fx-prior-${c.prioridade}">${h(PRIOR[c.prioridade])}</span>`; }
    const emAberto = c => [ "aberto", "em_andamento", "aguardando" ].includes(c.status);
    function renderChamados(box) {
        const f = $("finFiltro").value || "abertos", hoje = hojeIso();
        const lista = chamados.filter(c => {
            if (f === "abertos" && !emAberto(c)) return false;
            if (f === "urgentes" && !(emAberto(c) && [ "alta", "urgente" ].includes(c.prioridade))) return false;
            if (f === "atrasados" && !(emAberto(c) && c.prazo && c.prazo < hoje)) return false;
            if (f === "concluidos" && c.status !== "concluido") return false;
            const ct = c.contrato_id ? contrato(c.contrato_id) : null;
            return bate(`${c.numero} ${c.titulo} ${c.fornecedor || ""} ${nomeImovel(c.construcao_id)} ${ct ? nomeCli(ct.inquilino_id) : ""}`);
        });
        const ordem = { urgente: 0, alta: 1, media: 2, baixa: 3 };
        if (f !== "concluidos" && f !== "todos") lista.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade] || String(a.prazo || "9").localeCompare(String(b.prazo || "9")));
        $("finContagem").textContent = `${lista.length} chamado(s)`;
        box.innerHTML = `<div class="panel fx-painel">
            <div class="fx-topo"><p class="muted-text">Pedidos de manutenção dos imóveis alugados: vazamento, elétrica, fechadura… Registre quem vai resolver, o prazo, as fotos e cada atualização.</p>
              <button type="button" class="primary-button" data-fx-novo-ch>+ Chamado</button></div>
            ${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Nº</th><th>Problema</th><th>Imóvel</th><th>Prioridade</th><th>Responsável</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>
              ${lista.map(c => { const ct = c.contrato_id ? contrato(c.contrato_id) : null; return `<tr class="crm-linha" data-fx-ch="${h(c.id)}">
                <td data-r="Nº"><strong>${h(c.numero)}</strong></td>
                <td data-r="Problema"><strong>${h(c.titulo)}</strong><small class="fin-sub">${h(CATS[c.categoria])} · aberto em ${h(dataBr(c.created_at))} · pedido por ${h(SOLIC[c.solicitante].toLowerCase())}</small></td>
                <td data-r="Imóvel">${h(nomeImovel(c.construcao_id))}${ct ? `<small class="fin-sub">Inquilino ${h(nomeCli(ct.inquilino_id))}</small>` : ""}</td>
                <td data-r="Prioridade">${prioridade(c)}</td>
                <td data-r="Responsável">${c.responsavel_id ? h(nomeUsuario(c.responsavel_id)) : "—"}${c.fornecedor ? `<small class="fin-sub">${h(c.fornecedor)}</small>` : ""}</td>
                <td data-r="Prazo">${c.prazo ? `<span class="${emAberto(c) && c.prazo < hoje ? "fin-txt-alerta" : ""}">${h(dataBr(c.prazo))}</span>` : "—"}</td>
                <td data-r="Situação">${situacaoCh(c)}</td></tr>`; }).join("")}
              </tbody></table>` : `<div class="empty-state">Nenhum chamado nesta seleção.</div>`}
          </div>`;
        box.querySelectorAll("[data-fx-novo-ch]").forEach(b => b.addEventListener("click", () => abrirChamado(null)));
        box.querySelectorAll("[data-fx-ch]").forEach(tr => tr.addEventListener("click", () => abrirChamado(chamados.find(c => c.id === tr.dataset.fxCh))));
    }
    function abrirChamado(c, padrao) {
        const base = c || padrao || {};
        chAberto = c ? c.id : null;
        $("fxChTitulo").textContent = c ? `Chamado nº ${c.numero}` : "Novo chamado de manutenção";
        $("fxChContrato").innerHTML = opcoesContratos(base.contrato_id, true);
        $("fxChImovel").innerHTML = opcoesImoveis(base.construcao_id);
        $("fxChProblema").value = base.titulo || "";
        $("fxChDesc").value = base.descricao || "";
        $("fxChCategoria").innerHTML = opcoes(CATS, base.categoria || "outro");
        $("fxChPrioridade").innerHTML = opcoes(PRIOR, base.prioridade || "media");
        $("fxChSolicitante").innerHTML = opcoes(SOLIC, base.solicitante || "inquilino");
        $("fxChStatus").innerHTML = opcoes(STATUS_CH, base.status || "aberto");
        const equipe = (ctx.equipe() || []).filter(u => u.active !== false);
        $("fxChResp").innerHTML = `<option value="">Ninguém ainda</option>` + equipe.map(u => `<option value="${h(u.id)}"${u.id === base.responsavel_id ? " selected" : ""}>${h(u.display_name)}</option>`).join("");
        $("fxChFornecedor").value = base.fornecedor || "";
        $("fxChPrazo").value = base.prazo || "";
        $("fxChCusto").value = base.custo != null ? pct(base.custo) : "";
        $("fxChPaga").innerHTML = opcoes(PAGA, base.quem_paga || "a_definir");
        $("fxChExcluir").hidden = !(c && podeGerir());
        $("fxChAcomp").hidden = !c;
        $("fxChWhats").hidden = !c;
        msg($("fxChMsg"), "");
        $("fxChNota").value = "";
        $("fxChHistorico").innerHTML = "";
        if (c) {
            historicoChamado(c.id);
            if (window.SKLDocumentos) window.SKLDocumentos.anexos($("fxChFotos"), "chamado", c.id,
                { podeEnviar: true, categorias: [ "Foto do problema", "Orçamento", "Nota / recibo", "Foto do serviço pronto", "Outro" ] });
        }
        $("fxChamadoDialog").showModal();
    }
    async function historicoChamado(id) {
        const { data } = await ctx.sb.from("aluguel_chamado_eventos").select("*").eq("chamado_id", id).order("created_at", { ascending: false });
        $("fxChHistorico").innerHTML = (data || []).map(e => `<li class="fx-ev-${e.tipo}"><small>${h(new Date(e.created_at).toLocaleString("pt-BR"))} · ${h(nomeUsuario(e.criado_por))}</small> ${h(e.texto)}</li>`).join("") || `<li class="muted-text">Sem registros.</li>`;
    }
    function coletarChamado() {
        return {
            contrato_id: $("fxChContrato").value || null, construcao_id: $("fxChImovel").value || null, titulo: $("fxChProblema").value.trim(),
            descricao: $("fxChDesc").value.trim(), categoria: $("fxChCategoria").value, prioridade: $("fxChPrioridade").value,
            solicitante: $("fxChSolicitante").value, status: $("fxChStatus").value, responsavel_id: $("fxChResp").value || null,
            fornecedor: $("fxChFornecedor").value.trim(), prazo: $("fxChPrazo").value || null, custo: num($("fxChCusto").value), quem_paga: $("fxChPaga").value
        };
    }
    async function salvarChamado() {
        const d = coletarChamado();
        if (!d.titulo) { msg($("fxChMsg"), "Descreva o problema em poucas palavras."); return; }
        if (!d.contrato_id && !d.construcao_id) { msg($("fxChMsg"), "Escolha o contrato ou o imóvel."); return; }
        $("fxChSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("chamado_salvar", { p_carteira: ctx.carteiraId(), p_dados: d, p_id: chAberto });
        $("fxChSalvar").disabled = false;
        if (error) { msg($("fxChMsg"), erro(error)); return; }
        const novo = !chAberto;
        ctx.toast(novo ? `Chamado nº ${data.numero} aberto. Anexe as fotos aqui embaixo.` : "Chamado atualizado.");
        await carregar();
        abrirChamado(chamados.find(c => c.id === data.id) || data);
        reabrirContratoSeAberto(true);
    }
    async function comentarChamado() {
        const texto = $("fxChNota").value.trim();
        if (!chAberto || !texto) { msg($("fxChMsg"), "Escreva a atualização."); return; }
        const { error } = await ctx.sb.rpc("chamado_comentar", { p_id: chAberto, p_texto: texto, p_status: null });
        if (error) { msg($("fxChMsg"), erro(error)); return; }
        $("fxChNota").value = "";
        historicoChamado(chAberto);
        carregar();
    }
    function whatsChamado() {
        const c = chamados.find(x => x.id === chAberto); if (!c) return;
        const ct = c.contrato_id ? contrato(c.contrato_id) : null;
        const inq = ct ? cliente(ct.inquilino_id) : null;
        const tel = digitos(inq && inq.telefone);
        if (tel.length < 10) { ctx.toast("Inquilino sem celular no cadastro."); return; }
        const texto = `Olá, ${((inq.nome || "").split(" ")[0]) || "tudo bem"}! Atualização do chamado nº ${c.numero} (${c.titulo}): ${STATUS_CH[c.status].toLowerCase()}`
            + `${c.prazo && emAberto(c) ? `, previsão até ${dataBr(c.prazo)}` : ""}${c.fornecedor && emAberto(c) ? `. Quem vai atender: ${c.fornecedor}` : ""}. ${ctx.carteiraNome()}`;
        window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    }
    async function excluirChamado() {
        if (!chAberto || !window.confirm("Excluir este chamado e os anexos dele?")) return;
        const docs = await ctx.sb.from("crm_documentos").select("path").eq("entidade", "chamado").eq("entidade_id", chAberto);
        const caminhos = (docs.data || []).map(d => d.path);
        const { error } = await ctx.sb.rpc("chamado_excluir", { p_id: chAberto });
        if (error) { msg($("fxChMsg"), erro(error)); return; }
        if (caminhos.length) await ctx.sb.storage.from("documentos-aluguel").remove(caminhos);
        $("fxChamadoDialog").close();
        ctx.toast("Chamado excluído.");
        await carregar();
        reabrirContratoSeAberto(true);
    }

    // ------------------------------------------------------------------ avisos no Resumo do Financeiro
    function avisosResumo(aviso) {
        if (!ctx || !veTudo()) return "";
        const hoje = hojeIso();
        const enc = encargos.filter(e => e.status === "pendente" && e.vencimento <= somaDias(hoje, 7)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
        const ch = chamados.filter(c => emAberto(c) && ([ "alta", "urgente" ].includes(c.prioridade) || (c.prazo && c.prazo < hoje)));
        const avisar = linhasRegua().filter(l => l.avisar);
        return aviso("Régua de cobrança: avisar hoje", avisar.length, avisar.slice(0, 6).map(l => `<li><button type="button" class="text-button" data-fin-ir="regua:avisar">${h(nomeCli(l.c.inquilino_id))}</button><small>${h(ETAPAS[l.etapa])} · ${h(dinheiro(l.valor.total))} · vence ${h(dataBr(l.b.vencimento))}</small></li>`).join(""), "Ninguém para avisar hoje.", "regua:avisar")
            + aviso("Encargos vencendo (7 dias) ou vencidos", enc.length, enc.slice(0, 8).map(e => `<li><button type="button" class="text-button" data-fx-abrir-enc="${h(e.id)}">${h(nomeEnc(e))}</button><small>${h(nomeImovel(e.construcao_id))} · ${h(RESP[e.responsavel])} paga · ${e.vencimento < hoje ? "venceu" : "vence"} ${h(dataBr(e.vencimento))}${e.valor ? " · " + h(dinheiro(e.valor)) : ""}</small></li>`).join(""), "Nenhum encargo vencendo.", "encargos:pendentes")
            + aviso("Manutenção urgente ou com prazo vencido", ch.length, ch.slice(0, 8).map(c => `<li><button type="button" class="text-button" data-fx-abrir-ch="${h(c.id)}">Nº ${h(c.numero)} · ${h(c.titulo)}</button><small>${h(PRIOR[c.prioridade])} · ${h(nomeImovel(c.construcao_id))}${c.prazo ? " · prazo " + h(dataBr(c.prazo)) : ""}</small></li>`).join(""), "Nenhum chamado urgente.", "chamados:abertos");
    }
    function ligar(box) {
        if (!box) return;
        box.querySelectorAll("[data-fx-abrir-enc]").forEach(b => b.addEventListener("click", () => {
            const e = encargos.find(x => x.id === b.dataset.fxAbrirEnc);
            if (podeGerir()) abrirEncargo(e); else { F().mostrarAba("encargos"); }
        }));
        box.querySelectorAll("[data-fx-abrir-ch]").forEach(b => b.addEventListener("click", () => abrirChamado(chamados.find(x => x.id === b.dataset.fxAbrirCh))));
    }

    // ------------------------------------------------------------------ dentro do contrato: encargos, chamados e rescisão
    let ctAberto = null;
    function reabrirContratoSeAberto(soLista) {
        if (!ctAberto || !$("finContratoDialog").open) return;
        desenharNoContrato(contrato(ctAberto.id) || ctAberto, soLista);
    }
    function aoAbrirContrato(c) {
        ctAberto = c;
        let box = $("fxContratoBox");
        if (!box) {
            box = document.createElement("div");
            box.id = "fxContratoBox";
            box.className = "ext-contrato-box";
            const ancora = $("finCtHistoricoBox");
            if (!ancora) return;
            ancora.parentNode.insertBefore(box, ancora);
        }
        box.hidden = !c;
        if (!c) { box.innerHTML = ""; return; }
        desenharNoContrato(c);
        prepararRescisao(c);
    }
    function desenharNoContrato(c) {
        const box = $("fxContratoBox"); if (!box) return;
        const encs = encargos.filter(e => e.contrato_id === c.id && e.status !== "cancelado")
            .sort((a, b) => (a.status === "pendente" ? 0 : 1) - (b.status === "pendente" ? 0 : 1) || a.vencimento.localeCompare(b.vencimento)).slice(0, 8);
        const chs = chamados.filter(x => x.contrato_id === c.id).slice(0, 8);
        const res = c.rescisao;
        box.innerHTML = `
          ${res ? `<div class="ext-sub fx-res-feita"><span class="crm-rotulo">Rescisão</span>
              <p>Saída em <strong>${h(dataBr(res.data_saida))}</strong> · saldo ${Number(res.saldo) >= 0 ? `a receber do inquilino <strong>${h(dinheiro(res.saldo))}</strong>` : `a devolver ao inquilino <strong>${h(dinheiro(-res.saldo))}</strong>`}</p>
              <button type="button" class="secondary-button fin-mini" data-fx-termo>Termo de rescisão (PDF)</button></div>` : ""}
          <div class="ext-sub"><span class="crm-rotulo">Encargos (IPTU, condomínio, seguro…)</span>
            <div class="ext-lista">${encs.length ? encs.map(e => `<div class="ext-item"><span><strong>${h(nomeEnc(e))}</strong><small>${h(RESP[e.responsavel])} paga · vence ${h(dataBr(e.vencimento))}${e.valor ? " · " + h(dinheiro(e.valor)) : ""}</small></span>
                <span class="ext-item-acoes">${situacaoEnc(e)}${podeGerir() ? `<button type="button" class="text-button" data-fx-ct-enc="${h(e.id)}">Editar</button>` : ""}</span></div>`).join("")
              : `<p class="muted-text">Nenhum encargo lançado.</p>`}</div>
            ${podeGerir() && c.status === "ativo" ? `<button type="button" class="secondary-button fin-mini" data-fx-ct-novo-enc>+ Encargo</button>` : ""}</div>
          <div class="ext-sub"><span class="crm-rotulo">Manutenção</span>
            <div class="ext-lista">${chs.length ? chs.map(x => `<div class="ext-item"><span><strong>Nº ${h(x.numero)} · ${h(x.titulo)}</strong><small>${h(PRIOR[x.prioridade])} · aberto em ${h(dataBr(x.created_at))}</small></span>
                <span class="ext-item-acoes">${situacaoCh(x)}<button type="button" class="text-button" data-fx-ct-ch="${h(x.id)}">Abrir</button></span></div>`).join("")
              : `<p class="muted-text">Nenhum chamado.</p>`}</div>
            <button type="button" class="secondary-button fin-mini" data-fx-ct-novo-ch>+ Chamado</button></div>`;
        const t = box.querySelector("[data-fx-termo]"); if (t) t.addEventListener("click", () => termoRescisao(c, c.rescisao));
        box.querySelectorAll("[data-fx-ct-enc]").forEach(b => b.addEventListener("click", () => abrirEncargo(encargos.find(e => e.id === b.dataset.fxCtEnc))));
        box.querySelectorAll("[data-fx-ct-novo-enc]").forEach(b => b.addEventListener("click", () => abrirEncargo(null, { contrato_id: c.id, construcao_id: c.construcao_id })));
        box.querySelectorAll("[data-fx-ct-ch]").forEach(b => b.addEventListener("click", () => abrirChamado(chamados.find(x => x.id === b.dataset.fxCtCh))));
        box.querySelectorAll("[data-fx-ct-novo-ch]").forEach(b => b.addEventListener("click", () => abrirChamado(null, { contrato_id: c.id, construcao_id: c.construcao_id })));
    }

    // rescisão: um <details> a mais junto de "Reajustar" e "Encerrar" (só aparece em contrato ativo, para quem gerencia)
    function prepararRescisao(c) {
        const acoes = $("finCtAcoes"); if (!acoes) return;
        let det = $("fxResDetails");
        if (!det) {
            det = document.createElement("details");
            det.id = "fxResDetails";
            det.innerHTML = `<summary>Rescisão calculada (com termo)</summary>
              <p class="muted-text">Calcula a multa proporcional ao tempo que falta (Lei 8.245, art. 4º), o aluguel dos dias usados no mês de saída, as parcelas em aberto e a caução. Ao aplicar, o sistema cancela as cobranças futuras, lança uma cobrança de rescisão com o saldo e encerra o contrato.</p>
              <div class="fin-grade">
                <label><span>Data de saída (entrega das chaves)</span><input id="fxResData" type="date" /></label>
                <label><span>Multa (em aluguéis)</span><input id="fxResMeses" inputmode="decimal" value="3" /></label>
                <label><span>Vencimento da cobrança</span><input id="fxResVenc" type="date" /></label>
                <label><span>Motivo</span><input id="fxResMotivo" placeholder="ex.: pedido do inquilino" autocomplete="off" /></label>
              </div>
              <label class="check-inline"><input id="fxResIsentar" type="checkbox" /> Sem multa (fim do prazo, acordo ou transferência de emprego)</label>
              <label class="check-inline" id="fxResCaucaoLabel"><input id="fxResCaucao" type="checkbox" checked /> Abater a caução</label>
              <label class="check-inline"><input id="fxResLiberar" type="checkbox" checked /> Imóvel volta a ficar disponível</label>
              <div class="fx-res-listas">
                <div><span class="crm-rotulo">Outros débitos (reparos, contas em aberto…)</span><div id="fxResDebitos"></div><button type="button" class="text-button" data-fx-add="deb">+ débito</button></div>
                <div><span class="crm-rotulo">Outros créditos (acordos, valores a devolver…)</span><div id="fxResCreditos"></div><button type="button" class="text-button" data-fx-add="cre">+ crédito</button></div>
              </div>
              <div class="dialog-actions"><button type="button" class="secondary-button" id="fxResCalcular">Calcular</button></div>
              <div id="fxResResultado"></div>`;
            const enc = acoes.querySelector("details:last-of-type");
            acoes.insertBefore(det, enc || null);
            det.querySelectorAll("[data-fx-add]").forEach(b => b.addEventListener("click", () => linhaRes(b.dataset.fxAdd === "deb" ? $("fxResDebitos") : $("fxResCreditos"))));
            $("fxResCalcular").addEventListener("click", calcularRescisao);
        }
        det.open = false;
        $("fxResData").value = hojeIso();
        $("fxResVenc").value = somaDias(hojeIso(), 5);
        $("fxResMeses").value = "3"; $("fxResMotivo").value = "";
        $("fxResIsentar").checked = false; $("fxResLiberar").checked = true; $("fxResCaucao").checked = true;
        $("fxResCaucaoLabel").hidden = !(c && c.garantia === "caucao" && Number(c.caucao_valor) > 0);
        $("fxResDebitos").innerHTML = ""; $("fxResCreditos").innerHTML = ""; $("fxResResultado").innerHTML = "";
        resCalc = null;
    }
    function linhaRes(box) {
        const div = document.createElement("div");
        div.className = "fx-res-linha";
        div.innerHTML = `<input data-d placeholder="Descrição" autocomplete="off" /><input data-v inputmode="decimal" placeholder="R$" /><button type="button" class="text-button crm-remover" title="Tirar">✕</button>`;
        div.querySelector("button").addEventListener("click", () => div.remove());
        box.appendChild(div);
    }
    const lerLinhas = box => [ ...box.querySelectorAll(".fx-res-linha") ].map(l => ({ descricao: l.querySelector("[data-d]").value.trim(), valor: num(l.querySelector("[data-v]").value) })).filter(x => x.descricao && x.valor > 0);
    function dadosRescisao() {
        return {
            meses_multa: num($("fxResMeses").value) ?? 3, isentar_multa: $("fxResIsentar").checked, abater_caucao: $("fxResCaucao").checked,
            outros_debitos: lerLinhas($("fxResDebitos")), outros_creditos: lerLinhas($("fxResCreditos")),
            vencimento: $("fxResVenc").value || null, motivo: $("fxResMotivo").value.trim(), liberar_imovel: $("fxResLiberar").checked
        };
    }
    async function calcularRescisao() {
        const c = F().contratoAberto(); if (!c) return;
        const data = $("fxResData").value;
        if (!data) { ctx.toast("Informe a data de saída."); return; }
        const { data: r, error } = await ctx.sb.rpc("fin_simular_rescisao", { p_contrato: c.id, p_data: data, p_dados: dadosRescisao() });
        if (error) { ctx.toast(erro(error)); return; }
        resCalc = r;
        $("fxResResultado").innerHTML = `<div class="fx-res-quadro">${tabelaRescisao(r)}</div>
          <div class="dialog-actions"><button type="button" class="secondary-button" id="fxResPrevia">Ver termo</button>
          <button type="button" class="danger-button" id="fxResAplicar">Aplicar rescisão e encerrar</button></div>`;
        $("fxResPrevia").addEventListener("click", () => termoRescisao(c, r, true));
        $("fxResAplicar").addEventListener("click", aplicarRescisao);
    }
    function tabelaRescisao(r) {
        const pares = [];
        (r.pendentes || []).forEach(p => pares.push([ `Parcela de ${mesAno(p.competencia)} em aberto${p.dias_atraso ? ` (${p.dias_atraso} dia(s), com multa e juros)` : ""}`, dinheiro(p.total) ]));
        if (Number(r.proporcional)) pares.push([ `Aluguel proporcional: ${r.dias_usados} de ${r.dias_mes} dia(s) de ${mesAno(r.data_saida)}`, dinheiro(r.proporcional) ]);
        if (Number(r.multa)) pares.push([ `Multa rescisória: ${pct(r.meses_multa)} aluguel(is) × ${r.dias_restantes} de ${r.dias_contrato} dia(s) restantes`, dinheiro(r.multa) ]);
        else pares.push([ "Multa rescisória", r.isentar_multa ? "isenta" : "não se aplica (prazo cumprido)" ]);
        (r.outros_debitos || []).forEach(d => pares.push([ d.descricao, dinheiro(d.valor) ]));
        if (Number(r.caucao)) pares.push([ "Caução abatida", "− " + dinheiro(r.caucao) ]);
        (r.outros_creditos || []).forEach(d => pares.push([ d.descricao + " (crédito)", "− " + dinheiro(d.valor) ]));
        const saldo = Number(r.saldo);
        pares.push([ saldo >= 0 ? "Saldo a pagar pelo inquilino" : "Saldo a devolver ao inquilino", dinheiro(Math.abs(saldo)), true ]);
        const enc = (r.encargos_pendentes || []);
        return `<table class="fin-doc-tabela">${pares.map(([ a, b, forte ]) => `<tr${forte ? ` class="forte"` : ""}><td>${h(a)}</td><td>${h(b)}</td></tr>`).join("")}</table>
          ${(r.pendentes || []).length ? `<p class="fin-doc-rodape">As parcelas em aberto continuam cobradas como estão (aparecem em Cobranças).</p>` : ""}
          ${enc.length ? `<p class="fin-doc-rodape">Conferir a quitação dos encargos do inquilino: ${enc.map(e => h((TIPOS_ENC[e.tipo] || "Encargo") + " " + dataBr(e.vencimento) + (e.valor ? " " + dinheiro(e.valor) : ""))).join("; ")}.</p>` : ""}`;
    }
    async function aplicarRescisao() {
        const c = F().contratoAberto(); if (!c || !resCalc) return;
        const saldo = Number(resCalc.saldo);
        if (!window.confirm(`Aplicar a rescisão do contrato nº ${c.numero} com saída em ${dataBr($("fxResData").value)}?\n\nSaldo: ${saldo >= 0 ? "a pagar pelo inquilino" : "a devolver"} ${dinheiro(Math.abs(saldo))}.\nAs cobranças a partir do mês de saída serão canceladas e o contrato será encerrado.`)) return;
        $("fxResAplicar").disabled = true;
        const { data, error } = await ctx.sb.rpc("fin_rescindir_contrato", { p_contrato: c.id, p_data: $("fxResData").value, p_dados: dadosRescisao() });
        if (error) { $("fxResAplicar").disabled = false; ctx.toast(erro(error)); return; }
        ctx.toast(data.cobranca_id ? `Rescisão aplicada. Cobrança de ${dinheiro(data.valor_cobranca)} lançada em Cobranças.` : "Rescisão aplicada. Contrato encerrado.");
        await F().recarregar();
        ctx.recarregarImoveis();
        const atual = contrato(c.id) || Object.assign({}, c, { rescisao: data, status: "encerrado" });
        if ($("finContratoDialog").open) $("finContratoDialog").close();
        F().abrirContratoId(c.id);
        termoRescisao(atual, data);
    }
    function termoRescisao(c, r, previa) {
        if (!r) return;
        const inq = cliente(c.inquilino_id) || {}, prop = cliente(c.proprietario_id) || {};
        const im = imovelCt(c) || {};
        const nome = ctx.carteiraNome();
        const html = `<div class="fin-doc"><header><div><strong>${h(nome)}</strong><span>Termo de rescisão de contrato de locação${previa ? " (prévia)" : ""}</span></div><small>Emitido em ${h(new Date().toLocaleDateString("pt-BR"))}</small></header>
          <p>Pelo presente termo, <strong>${h(prop.nome || "o LOCADOR")}</strong>${prop.cpf ? `, CPF/CNPJ ${h(prop.cpf)}` : ""} (locador), representado por ${h(nome)}, e
          <strong>${h(inq.nome || "o LOCATÁRIO")}</strong>${inq.cpf ? `, CPF/CNPJ ${h(inq.cpf)}` : ""} (locatário), rescindem o contrato de locação nº ${h(c.numero)}
          do imóvel <strong>${h(nomeImovelCt(c))}</strong>${im.endereco ? `, ${h(im.endereco)}` : ""}, iniciado em ${h(dataBr(r.inicio))} com término previsto em ${h(dataBr(r.fim))},
          com entrega das chaves em <strong>${h(dataBr(r.data_saida))}</strong>${r.motivo ? ` (motivo: ${h(r.motivo)})` : ""}.</p>
          <p>Aluguel vigente: ${h(dinheiro(r.valor_aluguel))} por mês. Apuração dos valores:</p>
          ${tabelaRescisao(r)}
          ${r.cobranca_id ? `<p class="fin-doc-rodape">O saldo foi lançado para pagamento até ${h(dataBr(r.vencimento_cobranca))}.</p>` : ""}
          ${Number(r.credito_a_devolver) > 0 ? `<p class="fin-doc-rodape">Valor a devolver ao locatário: ${h(dinheiro(r.credito_a_devolver))}.</p>` : ""}
          <p>O imóvel será (ou foi) vistoriado na saída; eventuais danos apurados na vistoria serão cobrados à parte, conforme o contrato. Com o pagamento do saldo acima,
          as partes dão plena quitação das obrigações do contrato, exceto as que vierem a ser apuradas na vistoria de saída e contas de consumo ainda não faturadas.</p>
          <footer class="fx-assinaturas"><div class="fin-assinatura">${h(prop.nome || "Locador")}</div><div class="fin-assinatura">${h(inq.nome || "Locatário")}</div><div class="fin-assinatura">${h(nome)}</div></footer></div>`;
        F().imprimir(html);
    }

    // ------------------------------------------------------------------ janelas (criadas uma vez)
    function criarDialogs() {
        if ($("fxEncargoDialog")) return;
        document.body.insertAdjacentHTML("beforeend", `
<dialog id="fxEncargoDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fx-fechar>×</button>
  <span class="eyebrow">ENCARGOS</span><h2 id="fxEncTitulo">Novo encargo</h2>
  <div class="fin-grade">
    <label><span>Contrato</span><select id="fxEncContrato"></select></label>
    <label><span>Imóvel</span><select id="fxEncImovel"></select></label>
    <label><span>Tipo</span><select id="fxEncTipo"></select></label>
    <label><span>Descrição (opcional)</span><input id="fxEncDesc" placeholder="ex.: IPTU 2027, cota única" autocomplete="off" /></label>
    <label><span>Quem paga</span><select id="fxEncResp"></select></label>
    <label><span>Vencimento</span><input id="fxEncVenc" type="date" /></label>
    <label><span>Valor (R$)</span><input id="fxEncValor" inputmode="decimal" autocomplete="off" /></label>
  </div>
  <div id="fxEncRepetirBox" class="fin-grade">
    <label><span>Repetir (quantas parcelas)</span><input id="fxEncRepetir" type="number" min="1" max="24" value="1" /></label>
    <label><span>A cada</span><select id="fxEncIntervalo"><option value="mensal">mês</option><option value="anual">ano</option></select></label>
  </div>
  <label><span>Observação</span><input id="fxEncObs" placeholder="ex.: boleto chega pelo condomínio" autocomplete="off" /></label>
  <p id="fxEncMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="fxEncExcluirSerie" type="button" class="text-button" hidden>Excluir esta e as próximas</button><button id="fxEncExcluir" type="button" class="danger-button" hidden>Excluir</button><button id="fxEncSalvar" type="button" class="primary-button">Salvar</button></div>
</form></dialog>
<dialog id="fxChamadoDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fx-fechar>×</button>
  <span class="eyebrow">MANUTENÇÃO</span><h2 id="fxChTitulo">Chamado</h2>
  <div class="fin-grade">
    <label><span>Contrato</span><select id="fxChContrato"></select></label>
    <label><span>Imóvel</span><select id="fxChImovel"></select></label>
  </div>
  <label><span>Problema</span><input id="fxChProblema" placeholder="ex.: vazamento embaixo da pia da cozinha" autocomplete="off" /></label>
  <label><span>Detalhes</span><textarea id="fxChDesc" rows="3"></textarea></label>
  <div class="fin-grade">
    <label><span>Tipo</span><select id="fxChCategoria"></select></label>
    <label><span>Prioridade</span><select id="fxChPrioridade"></select></label>
    <label><span>Pedido por</span><select id="fxChSolicitante"></select></label>
    <label><span>Situação</span><select id="fxChStatus"></select></label>
    <label><span>Responsável na equipe</span><select id="fxChResp"></select></label>
    <label><span>Prestador / fornecedor</span><input id="fxChFornecedor" placeholder="ex.: João Encanador (66) 9…" autocomplete="off" /></label>
    <label><span>Prazo</span><input id="fxChPrazo" type="date" /></label>
    <label><span>Custo (R$)</span><input id="fxChCusto" inputmode="decimal" autocomplete="off" /></label>
    <label><span>Quem paga</span><select id="fxChPaga"></select></label>
  </div>
  <p id="fxChMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="fxChExcluir" type="button" class="danger-button" hidden>Excluir</button><button id="fxChWhats" type="button" class="secondary-button" hidden>Avisar inquilino (WhatsApp)</button><button id="fxChSalvar" type="button" class="primary-button">Salvar</button></div>
  <div id="fxChAcomp" hidden>
    <div class="ext-sub"><span class="crm-rotulo">Fotos e documentos</span><div id="fxChFotos"></div></div>
    <div class="ext-sub"><span class="crm-rotulo">Atualizações</span>
      <div class="fx-ch-nota"><input id="fxChNota" placeholder="ex.: encanador vem amanhã às 9h" autocomplete="off" /><button id="fxChComentar" type="button" class="secondary-button fin-mini">Registrar</button></div>
      <ul id="fxChHistorico" class="fx-historico"></ul></div>
  </div>
</form></dialog>
<dialog id="fxReguaDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fx-fechar>×</button>
  <span class="eyebrow">RÉGUA DE COBRANÇA</span><h2>Mensagens e configuração</h2>
  <div class="fin-grade">
    <label><span>Avisar quantos dias antes do vencimento</span><input id="fxRgDias" type="number" min="0" max="15" /></label>
  </div>
  <label><span>Como pagar (vai no lugar de {pagamento})</span><input id="fxRgPagamento" placeholder="ex.: PIX CNPJ 00.000.000/0001-00 (Imobiliária X) ou boleto enviado por e-mail" autocomplete="off" /></label>
  <label><span>Lembrete (antes do vencimento)</span><textarea id="fxRgMsg_lembrete" rows="3"></textarea></label>
  <label><span>No dia do vencimento</span><textarea id="fxRgMsg_vencimento" rows="3"></textarea></label>
  <label><span>Em atraso</span><textarea id="fxRgMsg_atraso" rows="3"></textarea></label>
  <p class="muted-text">Marcadores: {nome} {valor} {vencimento} {mes} {imovel} {dias} {pagamento} {imobiliaria}</p>
  <p id="fxRgMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="fxRgSalvar" type="button" class="primary-button">Salvar</button></div>
</form></dialog>`);
        document.querySelectorAll("[data-fx-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
        $("fxEncSalvar").addEventListener("click", salvarEncargo);
        $("fxEncExcluir").addEventListener("click", () => excluirEncargo(false));
        $("fxEncExcluirSerie").addEventListener("click", () => excluirEncargo(true));
        $("fxEncContrato").addEventListener("change", () => { const c = contrato($("fxEncContrato").value); if (c && c.construcao_id) $("fxEncImovel").value = c.construcao_id; });
        $("fxChContrato").addEventListener("change", () => { const c = contrato($("fxChContrato").value); if (c && c.construcao_id) $("fxChImovel").value = c.construcao_id; });
        $("fxChSalvar").addEventListener("click", salvarChamado);
        $("fxChComentar").addEventListener("click", comentarChamado);
        $("fxChWhats").addEventListener("click", whatsChamado);
        $("fxChExcluir").addEventListener("click", excluirChamado);
        $("fxRgSalvar").addEventListener("click", salvarConfigRegua);
    }

    window.SKLFinExtra = { iniciar, sair, carregar, temAba, render, filtros, avisosResumo, ligar, aoAbrirContrato,
        chamadosDoImovel: id => chamados.filter(c => c.construcao_id === id) };
})();
