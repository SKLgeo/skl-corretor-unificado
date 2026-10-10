// CRM da imobiliária: clientes, funis (venda/locação) em quadro, atendimentos com próxima ação e agenda,
// proprietário do imóvel. Módulo separado do app.js: o app.js chama SKLCRM.iniciar() ao entrar na carteira
// e entrega o que o CRM precisa (cliente Supabase, usuário, imóveis, equipe, funções de formatação).
// Regras de quem vê o quê ficam no banco (RLS + RPCs crm_*); aqui só a tela.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const ORIGENS = [ "Site", "Instagram", "Facebook", "WhatsApp", "Indicação", "Placa no imóvel", "Portal imobiliário",
        "Ligação", "Visita à imobiliária", "Interesse no app", "Outro" ];
    const TIPOS_CLIENTE = { comprador: "Comprador", inquilino: "Inquilino", vendedor: "Vendedor", proprietario: "Proprietário" };
    const TIPOS_ATENDIMENTO = [
        [ "ligacao", "📞", "Ligação" ], [ "whatsapp", "💬", "WhatsApp" ], [ "visita", "🏠", "Visita" ],
        [ "email", "✉️", "E-mail" ], [ "anotacao", "📝", "Anotação" ]
    ];
    const ICONE_ATIVIDADE = { ligacao: "📞", whatsapp: "💬", visita: "🏠", email: "✉️", anotacao: "📝", etapa: "➜", sistema: "•" };
    const DIA = 86400000;
    const PADROES = { economico: "Econômico", medio: "Médio padrão", alto: "Alto padrão" };
    const FAIXAS_PADRAO = { venda: { medio: 350000, alto: 900000 }, locacao: { medio: 2500, alto: 7000 } };

    let ctx = null;
    let funis = [], etapas = [], motivos = [];
    const clientes = new Map();
    const negs = new Map();
    let funilAtual = null;
    let canal = null, timer = null, recarga = null;
    let ligado = false;
    let negAberta = null;          // id da negociação no diálogo (null = nova)
    let cliAberto = null;          // id do cliente no diálogo (null = novo)
    let aoSalvarCliente = null;    // callback quando o cliente é criado a partir da negociação
    let movimentoPendente = null;  // { neg, para }
    let tipoAtendimento = "ligacao";
    let configEtapas = [];
    let configMotivos = [];
    let prop = { modo: null, imovel: null };
    let faixas = JSON.parse(JSON.stringify(FAIXAS_PADRAO));
    // Bloco 3: visitas, lembretes (pós-venda), roleta de leads
    const visitas = new Map();
    const lembretes = new Map();
    let roleta = null;
    let visitaAberta = null;
    let visSituacao = "realizada", visResultado = null;
    const SITUACOES_VISITA = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada", nao_compareceu: "Não compareceu" };
    const RESULTADOS_VISITA = { gostou: "Gostou", nao_gostou: "Não gostou", proposta: "Quer fazer proposta" };
    const TIPOS_LEMBRETE = { pos_venda: "Pós-venda", pos_locacao: "Pós-locação", renovacao: "Renovação", aniversario: "Aniversário da compra", manual: "Lembrete" };
    const DIAS_PARADO = 15;

    // ------------------------------------------------------------------ utilidades
    const h = v => ctx.h(v);
    const central = () => !!ctx && ctx.central();
    // gestão do CRM = Central, administrador e gestor (o financeiro só consulta)
    const gestao = () => !!ctx && (ctx.gestao ? ctx.gestao() : ctx.central());
    function erro(e) {
        const m = (e && e.message) || String(e || "");
        if (m.includes("VERSION_CONFLICT")) return "Esta negociação foi alterada por outra pessoa. Os dados foram recarregados.";
        return ctx.traduzErro(m);
    }
    function msg(el, texto, ok) {
        el.textContent = texto;
        el.style.background = ok ? "#dff4e8" : "#f7e8e6";
        el.style.color = ok ? "#247346" : "#9a3b34";
        el.hidden = false;
    }
    function digitos(t) {
        let d = String(t || "").replace(/\D/g, "");
        if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
        return d;
    }
    function formatarTelefone(t) {
        const d = digitos(t);
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        return t || "";
    }
    function dinheiro(v) {
        if (v == null || v === "") return "";
        return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: Number(v) % 1 ? 2 : 0 });
    }
    function dinheiroCurto(v) {
        const n = Number(v) || 0;
        if (n >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
        if (n >= 1e4) return "R$ " + Math.round(n / 1e3).toLocaleString("pt-BR") + " mil";
        return dinheiro(n);
    }
    function dataHora(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    function dataCurta(iso) {
        return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
    }
    function paraInputLocal(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        const p = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function deInputLocal(v) {
        return v ? new Date(v).toISOString() : null;
    }
    function normal(t) {
        return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }
    function etapa(id) { return etapas.find(e => e.id === id); }
    function funil(id) { return funis.find(f => f.id === id); }
    function etapasDoFunil(funilId) {
        return etapas.filter(e => e.funil_id === funilId && e.ativo).sort((a, b) => a.ordem - b.ordem);
    }
    function imovelNome(id) {
        const c = id && ctx.imoveis().find(i => i.id === id);
        return c ? (c.codigo ? c.codigo + " · " : "") + c.nome : "";
    }
    function linksContato(c) {
        if (!c) return "";
        const d = digitos(c.telefone);
        const partes = [];
        if (d.length >= 10) {
            partes.push(`<a class="crm-btn-contato whats" href="https://wa.me/55${d}" target="_blank" rel="noopener">WhatsApp</a>`);
            partes.push(`<a class="crm-btn-contato" href="tel:+55${d}">Ligar</a>`);
        }
        if (c.email) partes.push(`<a class="crm-btn-contato" href="mailto:${h(c.email)}">E-mail</a>`);
        return partes.join("");
    }
    // Situação da próxima ação: atrasada, hoje, futura ou sem data.
    function situacaoAcao(n) {
        if (!n.proxima_acao_em) return "sem";
        const t = new Date(n.proxima_acao_em);
        const agora = new Date();
        if (t < agora) return "atrasada";
        const fimHoje = new Date(); fimHoje.setHours(23, 59, 59, 999);
        return t <= fimHoje ? "hoje" : "futura";
    }
    // Padrão do cliente pela faixa de valor que ele procura (ou o valor da negociação), conforme as faixas da carteira.
    function padraoDe(n) {
        const f = funil(n.funil_id);
        if (!f || (f.finalidade !== "venda" && f.finalidade !== "locacao")) return null;
        const fx = faixas[f.finalidade];
        const p = n.perfil_busca || {};
        const v = Number(p.valor_max || n.valor || p.valor_min || 0);
        if (!v || !fx) return null;
        return v >= Number(fx.alto) ? "alto" : v >= Number(fx.medio) ? "medio" : "economico";
    }
    function seloPadrao(n) {
        const p = padraoDe(n);
        return p ? `<span class="crm-selo crm-selo-${p}">${PADROES[p]}</span>` : "";
    }
    function corretorDe(id) {
        return id ? ctx.nomeDoUsuario(id) : "Sem corretor";
    }

    // ------------------------------------------------------------------ ciclo de vida
    async function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { ligarEventos(); ligado = true; }
        document.querySelectorAll(".crm-col-central").forEach(el => { el.hidden = !central(); });
        try {
            const { error } = await ctx.sb.rpc("crm_iniciar", { p_carteira: ctx.carteiraId() });
            if (error) throw error;
        } catch (e) {
            console.warn("CRM indisponível:", e);
        }
        await carregar();
        conectar();
    }
    function sair() {
        if (canal) { ctx.sb.removeChannel(canal); canal = null; }
        if (timer) { clearInterval(timer); timer = null; }
        funis = []; etapas = []; motivos = [];
        clientes.clear(); negs.clear(); visitas.clear(); lembretes.clear(); roleta = null;
        funilAtual = null;
    }
    async function carregar() {
        if (!ctx || !ctx.carteiraId()) return;
        const cid = ctx.carteiraId();
        const sb = ctx.sb;
        const [ f, e, m, c, n, cfg, vis, lem, rol ] = await Promise.all([
            sb.from("crm_funis").select("*").eq("carteira_id", cid).eq("ativo", true).order("ordem"),
            sb.from("crm_etapas").select("*").eq("carteira_id", cid).order("ordem"),
            sb.from("crm_motivos_perda").select("*").eq("carteira_id", cid).order("ordem"),
            sb.from("crm_clientes").select("*").eq("carteira_id", cid).order("nome").limit(5000),
            sb.from("crm_negociacoes").select("*").eq("carteira_id", cid).order("updated_at", { ascending: false }).limit(5000),
            sb.from("carteiras_aluguel").select("faixas_padrao").eq("id", cid).maybeSingle(),
            sb.from("crm_visitas").select("*").eq("carteira_id", cid).order("agendada_para", { ascending: false }).limit(3000),
            sb.from("crm_lembretes").select("*").eq("carteira_id", cid).order("quando").limit(3000),
            gestao() ? sb.from("crm_roleta").select("*").eq("carteira_id", cid).maybeSingle() : Promise.resolve({ data: null })
        ]);
        const falha = [ f, e, m, c, n ].find(r => r.error);
        if (falha) { console.warn("CRM:", falha.error); return; }
        funis = f.data || [];
        etapas = e.data || [];
        motivos = m.data || [];
        clientes.clear(); (c.data || []).forEach(x => clientes.set(x.id, x));
        negs.clear(); (n.data || []).forEach(x => negs.set(x.id, x));
        visitas.clear(); ((vis && vis.data) || []).forEach(x => visitas.set(x.id, x));
        lembretes.clear(); ((lem && lem.data) || []).forEach(x => lembretes.set(x.id, x));
        roleta = (rol && rol.data) || null;
        if (cfg && cfg.data && cfg.data.faixas_padrao) faixas = cfg.data.faixas_padrao;
        if (!funilAtual || !funil(funilAtual)) funilAtual = funis[0] ? funis[0].id : null;
        if (window.SKLCRMPainel) window.SKLCRMPainel.invalidar();
        renderTudo();
    }
    function agendarRecarga() {
        clearTimeout(recarga);
        recarga = setTimeout(async () => {
            await carregar();
            if ($("crmNegDialog").open && negAberta) carregarHistoricoNeg(negAberta);
        }, 400);
    }
    function conectar() {
        if (canal) ctx.sb.removeChannel(canal);
        const cid = ctx.carteiraId();
        const filtro = `carteira_id=eq.${cid}`;
        canal = ctx.sb.channel(`crm-${cid}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "crm_negociacoes", filter: filtro }, agendarRecarga)
            .on("postgres_changes", { event: "*", schema: "public", table: "crm_clientes", filter: filtro }, agendarRecarga)
            .on("postgres_changes", { event: "*", schema: "public", table: "crm_visitas", filter: filtro }, agendarRecarga)
            .on("postgres_changes", { event: "*", schema: "public", table: "crm_lembretes", filter: filtro }, agendarRecarga)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_atividades", filter: filtro }, payload => {
                if ($("crmNegDialog").open && payload.new && payload.new.negociacao_id === negAberta) carregarHistoricoNeg(negAberta);
            })
            .subscribe();
        if (!timer) timer = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 60000);
    }
    function recarregar() {
        if (!ctx || !ctx.carteiraId()) return;
        carregar();
        conectar();
    }
    function aoMostrar(pagina) {
        if (pagina === "negociacoes") renderQuadro();
        if (pagina === "agenda") renderAgenda();
        if (pagina === "clientes") renderClientes();
        if (pagina === "settings" && central()) renderConfig();
        if (pagina === "settings" && gestao()) renderRoleta();
        if (pagina === "indicadores" && window.SKLCRMPainel) window.SKLCRMPainel.render();
    }
    function renderTudo() {
        renderFiltrosCorretor();
        renderTabs();
        renderQuadro();
        renderAgenda();
        renderClientes();
        if (central()) renderConfig();
        if (gestao()) renderRoleta();
        renderBotaoRoleta();
        const pg = document.getElementById("page-indicadores");
        if (pg && pg.classList.contains("active-page") && window.SKLCRMPainel) window.SKLCRMPainel.render();
        document.dispatchEvent(new Event("skl-crm-render"));
    }

    // ------------------------------------------------------------------ eventos
    function ligarEventos() {
        $("crmBuscaNeg").addEventListener("input", renderQuadro);
        $("crmCorretorFiltro").addEventListener("change", renderQuadro);
        $("crmNovaNegButton").addEventListener("click", () => abrirNegociacao(null));
        $("crmBuscaCli").addEventListener("input", renderClientes);
        $("crmTipoCliFiltro").addEventListener("change", renderClientes);
        $("crmCorretorCliFiltro").addEventListener("change", renderClientes);
        $("crmNovoCliButton").addEventListener("click", () => abrirCliente(null));
        $("crmCliSalvar").addEventListener("click", salvarCliente);
        $("crmCliExcluir").addEventListener("click", excluirCliente);
        $("crmCliAprovar").addEventListener("click", () => revisarCliente(true));
        $("crmCliRecusar").addEventListener("click", () => {
            $("crmRecusarCliMotivo").value = "";
            $("crmRecusarCliMsg").hidden = true;
            $("crmRecusarCliDialog").showModal();
        });
        $("crmRecusarCliConfirmar").addEventListener("click", () => revisarCliente(false));
        $("crmCliNovaNeg").addEventListener("click", () => {
            const id = cliAberto;
            $("crmClienteDialog").close();
            abrirNegociacao(null, { cliente_id: id });
        });
        document.querySelectorAll("[data-crm-tipo]").forEach(cb => cb.addEventListener("change", atualizarAvisoProprietario));
        $("crmNegSalvar").addEventListener("click", salvarNegociacao);
        $("crmNegExcluir").addEventListener("click", excluirNegociacao);
        $("crmNegNovoCli").addEventListener("click", () => {
            aoSalvarCliente = cli => {
                preencherSelectClientes(cli.id);
                const n = negAberta ? negs.get(negAberta) : null;
                if (!n) aplicarClienteNaNegociacao(cli.id);
            };
            abrirCliente(null);
        });
        $("crmNegCliente").addEventListener("change", () => { if (!negAberta) aplicarClienteNaNegociacao($("crmNegCliente").value); });
        $("crmNegImovel").addEventListener("change", () => {
            if (negAberta || $("crmNegValor").value.trim()) return;
            const c = ctx.imoveis().find(i => i.id === $("crmNegImovel").value);
            const f = funil($("crmNegFunil").value);
            if (c) $("crmNegValor").value = dinheiro(f && f.finalidade === "venda" ? c.valor_venda : c.valor_aluguel);
        });
        $("crmAtSalvar").addEventListener("click", registrarAtendimento);
        $("crmNovoCompromisso").addEventListener("click", abrirCompromisso);
        $("crmCompSalvar").addEventListener("click", salvarCompromisso);
        $("crmCompTipos").innerHTML = [ [ "ligacao", "📞 Ligar" ], [ "visita", "🏠 Visita" ], [ "whatsapp", "💬 WhatsApp" ], [ "email", "✉️ E-mail" ], [ "anotacao", "📝 Outro" ] ]
            .map(([ v, t ]) => `<button type="button" data-comp-tipo="${v}">${t}</button>`).join("");
        $("crmCompTipos").querySelectorAll("[data-comp-tipo]").forEach(b => b.addEventListener("click", () => {
            $("crmCompTipos").querySelectorAll("[data-comp-tipo]").forEach(x => x.classList.toggle("ativo", x === b));
        }));
        [ "crmPerfilBairros", "crmPerfilTipo", "crmPerfilMin", "crmPerfilMax", "crmPerfilQuartos", "crmPerfilVagas", "crmNegImovel", "crmNegCliente" ]
            .forEach(id => { $(id).addEventListener("input", renderCompativeis); $(id).addEventListener("change", renderCompativeis); });
        $("crmMotConfirmar").addEventListener("click", confirmarMovimento);
        $("crmAddEtapa").addEventListener("click", () => {
            const abertas = configEtapas.filter(e => e.tipo === "aberta");
            configEtapas.splice(abertas.length, 0, { id: null, nome: "", tipo: "aberta", cor: "#1e8fd6" });
            desenharConfigEtapas();
        });
        $("crmSalvarEtapas").addEventListener("click", salvarEtapas);
        $("crmConfigFunil").addEventListener("change", () => { carregarConfigEtapas(); desenharConfigEtapas(); });
        $("crmAddMotivo").addEventListener("click", () => { configMotivos.push({ id: null, nome: "", ativo: true }); desenharConfigMotivos(); });
        $("crmSalvarMotivos").addEventListener("click", salvarMotivos);
        $("crmSalvarFaixas").addEventListener("click", salvarFaixas);
        [ "crmFaixaVendaMedio", "crmFaixaVendaAlto", "crmFaixaLocacaoMedio", "crmFaixaLocacaoAlto" ].forEach(id => $(id).addEventListener("input", previaFaixas));
        $("exclusividadeInput").addEventListener("change", () => { $("exclusividadeAteLabel").hidden = !$("exclusividadeInput").checked; });
        $("proprietarioSelect").addEventListener("change", atualizarProprietarioSelect);
        $("crmAtTipos").innerHTML = TIPOS_ATENDIMENTO.map(([ v, i, t ]) => `<button type="button" data-at-tipo="${v}">${i} ${t}</button>`).join("");
        $("crmAtTipos").querySelectorAll("[data-at-tipo]").forEach(b => b.addEventListener("click", () => {
            tipoAtendimento = b.dataset.atTipo;
            marcarTipoAtendimento();
        }));
        $("crmSalvarRoleta").addEventListener("click", salvarRoleta);
        $("crmDistribuirRoleta").addEventListener("click", distribuirSemCorretor);
        $("crmCliOrigem").addEventListener("change", () => preencherIndicado(cliAberto ? clientes.get(cliAberto) : null, true));
        $("crmVisSalvar").addEventListener("click", salvarVisita);
        $("crmVisSituacao").innerHTML = [ [ "realizada", "✅ Aconteceu" ], [ "nao_compareceu", "🚫 Cliente não foi" ], [ "cancelada", "✖ Cancelada" ] ]
            .map(([ v, t ]) => `<button type="button" data-vis-sit="${v}">${t}</button>`).join("");
        $("crmVisResultado").innerHTML = [ [ "gostou", "👍 Gostou" ], [ "nao_gostou", "👎 Não gostou" ], [ "proposta", "📝 Quer fazer proposta" ] ]
            .map(([ v, t ]) => `<button type="button" data-vis-res="${v}">${t}</button>`).join("");
        $("crmVisSituacao").querySelectorAll("[data-vis-sit]").forEach(b => b.addEventListener("click", () => { visSituacao = b.dataset.visSit; marcarVisita(); }));
        $("crmVisResultado").querySelectorAll("[data-vis-res]").forEach(b => b.addEventListener("click", () => { visResultado = b.dataset.visRes; marcarVisita(); }));
        $("crmCliOrigem").innerHTML = `<option value="">—</option>` + ORIGENS.map(o => `<option>${o}</option>`).join("");
    }

    // ------------------------------------------------------------------ filtros e abas
    function renderFiltrosCorretor() {
        if (!central()) return;
        const equipe = ctx.equipe().filter(u => u.active !== false).sort((a, b) => normal(a.display_name).localeCompare(normal(b.display_name)));
        [ "crmCorretorFiltro", "crmCorretorCliFiltro" ].forEach(id => {
            const sel = $(id);
            const atual = sel.value;
            const fixos = id === "crmCorretorCliFiltro" ? `<option value="">Todos os corretores</option><option value="__sem">Sem corretor</option>` : `<option value="">Todos os corretores</option>`;
            sel.innerHTML = fixos + equipe.map(u => `<option value="${h(u.id)}">${h(u.display_name)}</option>`).join("");
            sel.value = [ ...sel.options ].some(o => o.value === atual) ? atual : "";
        });
    }
    function renderTabs() {
        $("crmFunilTabs").innerHTML = funis.map(f => `<button type="button" data-funil="${h(f.id)}" class="${f.id === funilAtual ? "ativo" : ""}">${h(f.nome)}</button>`).join("");
        $("crmFunilTabs").querySelectorAll("[data-funil]").forEach(b => b.addEventListener("click", () => {
            funilAtual = b.dataset.funil;
            renderTabs();
            renderQuadro();
        }));
    }
    function negociacaoPassaFiltro(n) {
        const corretor = central() ? $("crmCorretorFiltro").value : "";
        if (corretor && n.corretor_id !== corretor) return false;
        const termo = normal($("crmBuscaNeg").value.trim());
        if (!termo) return true;
        const c = clientes.get(n.cliente_id) || {};
        const alvo = normal([ c.nome, c.email, n.titulo, imovelNome(n.construcao_id) ].join(" "));
        const d = termo.replace(/\D/g, "");
        return alvo.includes(termo) || (d.length >= 3 && digitos(c.telefone).includes(d));
    }

    // ------------------------------------------------------------------ quadro (Kanban)
    function renderQuadro() {
        const quadro = $("crmQuadro");
        if (!quadro) return;
        if (!funilAtual) {
            quadro.innerHTML = `<div class="empty-state">O CRM ainda não está disponível nesta carteira.</div>`;
            $("crmResumoFunil").innerHTML = "";
            return;
        }
        const colunas = etapasDoFunil(funilAtual);
        const limite = Date.now() - 30 * DIA;
        const doFunil = [ ...negs.values() ].filter(n => n.funil_id === funilAtual && negociacaoPassaFiltro(n));
        renderResumo(doFunil);
        quadro.innerHTML = colunas.map(et => {
            let itens = doFunil.filter(n => n.etapa_id === et.id);
            if (et.tipo !== "aberta") itens = itens.filter(n => new Date(n.fechado_em || n.updated_at).getTime() >= limite);
            itens.sort((a, b) => {
                const sa = situacaoAcao(a), sb2 = situacaoAcao(b);
                const peso = { atrasada: 0, hoje: 1, futura: 2, sem: 3 };
                if (peso[sa] !== peso[sb2]) return peso[sa] - peso[sb2];
                return String(b.updated_at).localeCompare(String(a.updated_at));
            });
            const total = itens.reduce((s, n) => s + (Number(n.valor) || 0), 0);
            return `<section class="crm-coluna crm-coluna-${et.tipo}" data-etapa="${h(et.id)}" style="--cor:${h(et.cor || "#64748b")}">
              <header><strong>${h(et.nome)}</strong><span>${itens.length}${total ? " · " + dinheiroCurto(total) : ""}</span></header>
              <div class="crm-coluna-corpo">${itens.map(cartao).join("") || `<p class="crm-vazio">—</p>`}</div>
            </section>`;
        }).join("");
        quadro.querySelectorAll("[data-neg]").forEach(card => {
            card.addEventListener("click", () => abrirNegociacao(card.dataset.neg));
            card.addEventListener("dragstart", ev => {
                ev.dataTransfer.setData("text/plain", card.dataset.neg);
                ev.dataTransfer.effectAllowed = "move";
                card.classList.add("arrastando");
            });
            card.addEventListener("dragend", () => card.classList.remove("arrastando"));
        });
        quadro.querySelectorAll(".crm-coluna").forEach(col => {
            col.addEventListener("dragover", ev => { ev.preventDefault(); col.classList.add("alvo"); });
            col.addEventListener("dragleave", () => col.classList.remove("alvo"));
            col.addEventListener("drop", ev => {
                ev.preventDefault();
                col.classList.remove("alvo");
                const id = ev.dataTransfer.getData("text/plain");
                if (id) moverPara(id, col.dataset.etapa);
            });
        });
    }
    function cartao(n) {
        const c = clientes.get(n.cliente_id);
        const sit = situacaoAcao(n);
        const dias = Math.floor((Date.now() - new Date(n.etapa_desde || n.created_at).getTime()) / DIA);
        const et = etapa(n.etapa_id);
        const acao = n.situacao === "aberta" && sit !== "sem"
            ? `<div class="crm-card-acao ${sit}">◷ ${h(dataHora(n.proxima_acao_em))}${n.proxima_acao_texto ? " · " + h(n.proxima_acao_texto) : ""}</div>`
            : (n.situacao === "aberta" ? `<div class="crm-card-acao sem">Sem próxima ação</div>` : "");
        const perda = n.situacao === "perdida" ? `<div class="crm-card-perda">${h((motivos.find(m => m.id === n.motivo_perda_id) || {}).nome || "Perdida")}</div>` : "";
        const corretor = central() ? `<div class="crm-card-corretor">${ctx.fotoDoUsuario(n.corretor_id, 20)}<span>${h(corretorDe(n.corretor_id))}</span></div>` : "";
        return `<article class="crm-card" draggable="true" data-neg="${h(n.id)}">
          <strong>${h(c ? c.nome : "Cliente")}</strong>${seloPadrao(n)}
          ${n.titulo || n.construcao_id ? `<small>${h(n.titulo || imovelNome(n.construcao_id))}</small>` : ""}
          <div class="crm-card-linha"><span class="crm-valor">${h(dinheiro(n.valor))}</span><span class="crm-dias" title="Tempo nesta etapa">${et && et.tipo === "aberta" ? (dias ? dias + " d" : "hoje") : h(dataCurta(n.fechado_em))}</span></div>
          ${acao}${perda}${corretor}
        </article>`;
    }
    function renderResumo(doFunil) {
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const abertas = doFunil.filter(n => n.situacao === "aberta");
        const ganhas = doFunil.filter(n => n.situacao === "ganha" && new Date(n.fechado_em) >= inicioMes);
        const perdidas = doFunil.filter(n => n.situacao === "perdida" && new Date(n.fechado_em) >= inicioMes);
        const soma = l => l.reduce((s, n) => s + (Number(n.valor) || 0), 0);
        const conv = ganhas.length + perdidas.length ? Math.round(ganhas.length * 100 / (ganhas.length + perdidas.length)) : null;
        const atrasadas = abertas.filter(n => situacaoAcao(n) === "atrasada").length;
        $("crmResumoFunil").innerHTML = [
            [ "Em andamento", abertas.length, soma(abertas) ? dinheiroCurto(soma(abertas)) : "" ],
            [ "Fechadas no mês", ganhas.length, soma(ganhas) ? dinheiroCurto(soma(ganhas)) : "" ],
            [ "Perdidas no mês", perdidas.length, "" ],
            [ "Conversão no mês", conv == null ? "—" : conv + "%", "fechadas ÷ encerradas" ],
            [ "Ações atrasadas", atrasadas, atrasadas ? "veja a Agenda" : "" ]
        ].map(([ r, v, s ]) => `<div class="crm-resumo-item"><span>${h(r)}</span><strong>${h(v)}</strong>${s ? `<small>${h(s)}</small>` : ""}</div>`).join("");
    }

    // ------------------------------------------------------------------ mover etapa
    function moverPara(negId, etapaId) {
        const n = negs.get(negId);
        const de = n && etapa(n.etapa_id), para = etapa(etapaId);
        if (!n || !para || !de || de.id === para.id) return;
        const voltando = para.tipo === "aberta" && (de.tipo !== "aberta" || para.ordem < de.ordem);
        if (para.tipo === "perdido" || voltando) { abrirMotivo(n, para); return; }
        executarMovimento(n, para, null, null);
    }
    function abrirMotivo(n, para) {
        movimentoPendente = { neg: n, para };
        const perda = para.tipo === "perdido";
        const c = clientes.get(n.cliente_id);
        $("crmMotEyebrow").textContent = perda ? "NEGOCIAÇÃO PERDIDA" : "VOLTAR DE ETAPA";
        $("crmMotTitulo").textContent = `${c ? c.nome : "Negociação"} → ${para.nome}`;
        $("crmMotPerdaLabel").hidden = !perda;
        $("crmMotPerda").innerHTML = `<option value="">Escolha o motivo</option>` + motivos.filter(m => m.ativo).map(m => `<option value="${h(m.id)}">${h(m.nome)}</option>`).join("");
        $("crmMotTextoRotulo").textContent = perda ? "Detalhe (opcional)" : "Por que a negociação está voltando?";
        $("crmMotTexto").value = "";
        $("crmMotConfirmar").textContent = perda ? "Marcar como perdida" : "Voltar etapa";
        $("crmMotConfirmar").className = perda ? "danger-button" : "primary-button";
        $("crmMotMsg").hidden = true;
        $("crmMotivoDialog").showModal();
    }
    async function confirmarMovimento() {
        if (!movimentoPendente) return;
        const { neg, para } = movimentoPendente;
        const perda = para.tipo === "perdido";
        const motivoPerda = $("crmMotPerda").value || null;
        const texto = $("crmMotTexto").value.trim() || null;
        if (perda && !motivoPerda) { msg($("crmMotMsg"), "Escolha o motivo da perda."); return; }
        if (!perda && !texto) { msg($("crmMotMsg"), "Informe o motivo para voltar a etapa."); return; }
        $("crmMotConfirmar").disabled = true;
        const ok = await executarMovimento(neg, para, texto, motivoPerda, $("crmMotMsg"));
        $("crmMotConfirmar").disabled = false;
        if (ok) { $("crmMotivoDialog").close(); movimentoPendente = null; }
    }
    async function executarMovimento(n, para, motivo, motivoPerda, caixaErro) {
        const anterior = { ...n };
        negs.set(n.id, { ...n, etapa_id: para.id });
        renderQuadro();
        const { data, error } = await ctx.sb.rpc("crm_mover_negociacao", {
            p_id: n.id, p_etapa: para.id, p_expected_version: n.version, p_motivo: motivo, p_motivo_perda: motivoPerda
        });
        if (error) {
            negs.set(n.id, anterior);
            renderQuadro();
            if (caixaErro) msg(caixaErro, erro(error)); else ctx.toast(erro(error));
            if (String(error.message).includes("VERSION_CONFLICT")) carregar();
            return false;
        }
        negs.set(data.id, data);
        renderTudo();
        if (para.tipo === "ganho") ctx.toast("Negócio fechado! Lembre de atualizar a situação do imóvel.");
        else if (para.tipo === "perdido") ctx.toast("Negociação marcada como perdida.");
        else ctx.toast(`Movida para ${para.nome}.`);
        if ($("crmNegDialog").open && negAberta === data.id) { desenharStepper(data); carregarHistoricoNeg(data.id); desenharSituacao(data); }
        return true;
    }

    // ------------------------------------------------------------------ agenda
    function renderAgenda() {
        const lista = $("crmAgenda");
        if (!lista) return;
        const abertas = [ ...negs.values() ].filter(n => n.situacao === "aberta");
        const fimAmanha = new Date(); fimAmanha.setDate(fimAmanha.getDate() + 1); fimAmanha.setHours(23, 59, 59, 999);
        const fimSemana = new Date(); fimSemana.setDate(fimSemana.getDate() + 7); fimSemana.setHours(23, 59, 59, 999);
        const grupos = [
            [ "Atrasadas", "atrasada", abertas.filter(n => situacaoAcao(n) === "atrasada") ],
            [ "Hoje", "hoje", abertas.filter(n => situacaoAcao(n) === "hoje") ],
            [ "Amanhã", "futura", abertas.filter(n => situacaoAcao(n) === "futura" && new Date(n.proxima_acao_em) <= fimAmanha) ],
            [ "Próximos 7 dias", "futura", abertas.filter(n => situacaoAcao(n) === "futura" && new Date(n.proxima_acao_em) > fimAmanha && new Date(n.proxima_acao_em) <= fimSemana) ],
            [ "Sem próxima ação marcada", "sem", abertas.filter(n => situacaoAcao(n) === "sem") ]
        ];
        const extras = agendaExtras(abertas, grupos);
        const badge = grupos[0][2].length + grupos[1][2].length + extras.contagem;
        $("navAgendaBadge").hidden = !badge;
        $("navAgendaBadge").textContent = badge;
        const partes = grupos.map(([ titulo, classe, itens ]) => {
            if (!itens.length) return "";
            itens.sort((a, b) => String(a.proxima_acao_em || a.updated_at).localeCompare(String(b.proxima_acao_em || b.updated_at)));
            return `<section class="crm-agenda-grupo ${classe}"><h3>${h(titulo)} <span>${itens.length}</span></h3>${itens.map(n => {
                const c = clientes.get(n.cliente_id);
                const et = etapa(n.etapa_id);
                const f = funil(n.funil_id);
                return `<article class="crm-agenda-item" data-neg="${h(n.id)}">
                  <div class="crm-agenda-quando">${n.proxima_acao_em ? h(dataHora(n.proxima_acao_em)) : "—"}</div>
                  <div class="crm-agenda-info">
                    <strong>${h(c ? c.nome : "Cliente")}</strong>
                    <small>${h(n.proxima_acao_texto || "Defina o próximo passo")}</small>
                    <small class="crm-agenda-meta"><span class="crm-pill" style="--cor:${h(et && et.cor || "#64748b")}">${h(et ? et.nome : "")}</span> ${h(f ? f.nome : "")}${central() ? " · " + h(corretorDe(n.corretor_id)) : ""}</small>
                  </div>
                  <div class="crm-agenda-acoes">${linksContato(c)}<button type="button" class="secondary-button" data-abrir>Abrir</button></div>
                </article>`;
            }).join("")}</section>`;
        });
        partes.splice(1, 0, extras.visitas);
        partes.splice(3, 0, extras.lembretes);
        partes.push(extras.parados, extras.reativar);
        lista.innerHTML = partes.join("") || `<div class="empty-state">Nenhuma negociação em aberto. Crie uma em Negociações.</div>`;
        lista.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => abrirNegociacao(b.closest("[data-neg]").dataset.neg)));
        lista.querySelectorAll("[data-agenda-vis]").forEach(b => b.addEventListener("click", () => abrirVisita(b.dataset.agendaVis)));
        lista.querySelectorAll("[data-agenda-lemb]").forEach(b => b.addEventListener("click", () => concluirLembrete(b.dataset.agendaLemb)));
        lista.querySelectorAll("[data-agenda-cli]").forEach(b => b.addEventListener("click", () => abrirCliente(b.dataset.agendaCli)));
        lista.querySelectorAll("[data-reativar]").forEach(b => b.addEventListener("click", () => abrirNegociacao(null, { cliente_id: b.dataset.reativar, funil_id: b.dataset.funil })));
    }

    // ------------------------------------------------------------------ visitas (Bloco 3)
    function rotuloImovel(id) {
        const i = ctx.imoveis().find(x => x.id === id);
        return i ? (i.codigo ? i.codigo + " · " : "") + i.nome : "Imóvel";
    }
    function desenharVisitas(n) {
        const box = $("crmNegVisitas");
        const lista = [ ...visitas.values() ].filter(v => v.negociacao_id === n.id)
            .sort((a, b) => String(b.agendada_para).localeCompare(String(a.agendada_para)));
        const aberta = n.situacao === "aberta" && (!ctx.papel || ctx.papel() !== "financeiro");
        box.hidden = !lista.length && !aberta;
        const f = funil(n.funil_id);
        const opcoes = ctx.imoveis().filter(i => (i.aprovacao || "aprovado") === "aprovado" && (i.status === "disponivel" || i.id === n.construcao_id)
            && (!f || f.finalidade !== "venda" || i.para_venda) && (!f || f.finalidade !== "locacao" || i.para_aluguel !== false))
            .sort((a, b) => (a.id === n.construcao_id ? -1 : 0) - (b.id === n.construcao_id ? -1 : 0) || normal(a.nome).localeCompare(normal(b.nome)));
        const amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(10, 0, 0, 0);
        box.innerHTML = `<span class="eyebrow">VISITAS${lista.length ? ` <em>${lista.length}</em>` : ""}</span>`
            + lista.map(v => {
                const passou = new Date(v.agendada_para).getTime() < Date.now();
                const estado = v.situacao === "realizada" ? (RESULTADOS_VISITA[v.resultado] || "Realizada") : SITUACOES_VISITA[v.situacao];
                return `<div class="crm-visita crm-visita-${h(v.situacao)}${v.situacao === "agendada" && passou ? " sem-retorno" : ""}">
                  <span class="crm-visita-quando">${h(dataHora(v.agendada_para))}</span>
                  <span class="crm-visita-info"><strong>${h(rotuloImovel(v.construcao_id))}</strong><small>${h(estado)}${v.comentario ? " — " + h(v.comentario) : (v.observacao ? " — " + h(v.observacao) : "")}</small></span>
                  ${v.situacao === "agendada" && aberta ? `<button type="button" class="secondary-button" data-vis="${h(v.id)}">${passou ? "Registrar retorno" : "Retorno"}</button>` : ""}
                </div>`;
            }).join("")
            + (aberta ? `<div class="crm-visita-nova">
                <select id="crmVisImovel">${opcoes.map(i => `<option value="${h(i.id)}">${h(rotuloImovel(i.id))}</option>`).join("") || `<option value="">Nenhum imóvel disponível</option>`}</select>
                <input id="crmVisQuando" type="datetime-local" value="${paraInputLocal(amanha.toISOString())}" />
                <input id="crmVisObs" placeholder="Observação (ex.: pegar a chave na imobiliária)" autocomplete="off" />
                <button id="crmVisAgendar" type="button" class="primary-button">Agendar visita</button>
              </div>` : "");
        box.querySelectorAll("[data-vis]").forEach(b => b.addEventListener("click", () => abrirVisita(b.dataset.vis)));
        const ag = $("crmVisAgendar");
        if (ag) ag.addEventListener("click", () => agendarVisita(n.id));
    }
    async function agendarVisita(negId) {
        const imovel = $("crmVisImovel").value, quando = deInputLocal($("crmVisQuando").value);
        if (!imovel) { msg($("crmNegMsg"), "Escolha o imóvel da visita."); return; }
        if (!quando) { msg($("crmNegMsg"), "Escolha a data e a hora da visita."); return; }
        $("crmVisAgendar").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_agendar_visita", { p_negociacao: negId, p_construcao: imovel, p_quando: quando, p_observacao: $("crmVisObs").value.trim() });
        if (error) { $("crmVisAgendar").disabled = false; msg($("crmNegMsg"), erro(error)); return; }
        visitas.set(data.id, data);
        await carregar();
        if ($("crmNegDialog").open && negAberta === negId) abrirNegociacao(negId);
        ctx.toast("Visita agendada. Ela já virou a próxima ação da negociação.");
    }
    function marcarVisita() {
        $("crmVisSituacao").querySelectorAll("[data-vis-sit]").forEach(b => b.classList.toggle("ativo", b.dataset.visSit === visSituacao));
        $("crmVisResultado").querySelectorAll("[data-vis-res]").forEach(b => b.classList.toggle("ativo", b.dataset.visRes === visResultado));
        $("crmVisResultadoBox").hidden = visSituacao !== "realizada";
    }
    function abrirVisita(id) {
        const v = visitas.get(id);
        if (!v) return;
        visitaAberta = id;
        visSituacao = "realizada"; visResultado = null;
        const c = clientes.get(v.cliente_id);
        $("crmVisInfo").textContent = `${c ? c.nome : "Cliente"} · ${rotuloImovel(v.construcao_id)} · ${dataHora(v.agendada_para)}`;
        $("crmVisComentario").value = "";
        $("crmVisProxEm").value = "";
        $("crmVisProxTexto").value = "";
        $("crmVisMsg").hidden = true;
        marcarVisita();
        $("crmVisitaDialog").showModal();
    }
    async function salvarVisita() {
        if (!visitaAberta) return;
        if (visSituacao === "realizada" && !visResultado) { msg($("crmVisMsg"), "Diga como foi: gostou, não gostou ou quer fazer proposta."); return; }
        $("crmVisSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_registrar_visita", {
            p_visita: visitaAberta, p_situacao: visSituacao, p_resultado: visSituacao === "realizada" ? visResultado : null,
            p_comentario: $("crmVisComentario").value.trim(), p_proxima_em: deInputLocal($("crmVisProxEm").value),
            p_proxima_texto: $("crmVisProxTexto").value.trim()
        });
        $("crmVisSalvar").disabled = false;
        if (error) { msg($("crmVisMsg"), erro(error)); return; }
        visitas.set(data.id, data);
        $("crmVisitaDialog").close();
        await carregar();
        if ($("crmNegDialog").open && negAberta === data.negociacao_id) abrirNegociacao(data.negociacao_id);
        ctx.toast(visSituacao === "realizada" && visResultado === "proposta" ? "Visita registrada. Hora de montar a proposta!" : "Retorno da visita registrado.");
    }

    // Agenda: visitas sem retorno, lembretes, negócios parados e clientes para reativar
    function reativaveis() {
        const agora = Date.now();
        const comAberta = new Set([ ...negs.values() ].filter(n => n.situacao === "aberta").map(n => n.cliente_id));
        const porCliente = new Map();
        [ ...negs.values() ].filter(n => n.situacao === "perdida" && n.fechado_em).forEach(n => {
            const dias = (agora - new Date(n.fechado_em).getTime()) / DIA;
            if (dias < 60 || dias > 365 || comAberta.has(n.cliente_id)) return;
            const atual = porCliente.get(n.cliente_id);
            if (!atual || String(n.fechado_em) > String(atual.fechado_em)) porCliente.set(n.cliente_id, n);
        });
        return [ ...porCliente.values() ].sort((a, b) => String(a.fechado_em).localeCompare(String(b.fechado_em))).slice(0, 15);
    }
    function agendaExtras(abertas, grupos) {
        const agora = Date.now();
        const hojeFim = new Date(); hojeFim.setHours(23, 59, 59, 999);
        const limite = new Date(); limite.setDate(limite.getDate() + 7);
        const secao = (titulo, classe, itens) => itens.length ? `<section class="crm-agenda-grupo ${classe}"><h3>${h(titulo)} <span>${itens.length}</span></h3>${itens.join("")}</section>` : "";
        const semRetorno = [ ...visitas.values() ].filter(v => v.situacao === "agendada" && new Date(v.agendada_para).getTime() < agora)
            .sort((a, b) => String(a.agendada_para).localeCompare(String(b.agendada_para)));
        const lemb = [ ...lembretes.values() ].filter(l => !l.concluido_em && dataDoLembrete(l) <= limite).sort((a, b) => a.quando.localeCompare(b.quando));
        const lembVencidos = lemb.filter(l => dataDoLembrete(l) <= hojeFim).length;
        const ja = new Set(grupos.slice(0, 2).flatMap(g => g[2].map(n => n.id)));
        const parados = abertas.filter(n => !ja.has(n.id) && agora - new Date(n.updated_at).getTime() > DIAS_PARADO * DIA)
            .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
        const reat = reativaveis();
        const item = (quando, nome, texto, cli, botoes, atributos) => `<article class="crm-agenda-item" ${atributos || ""}>
            <div class="crm-agenda-quando">${h(quando)}</div>
            <div class="crm-agenda-info"><strong>${h(nome)}</strong><small>${h(texto)}</small></div>
            <div class="crm-agenda-acoes">${linksContato(cli)}${botoes}</div></article>`;
        return {
            contagem: semRetorno.length + lembVencidos,
            visitas: secao("Visitas aguardando o retorno", "atrasada", semRetorno.map(v => {
                const c = clientes.get(v.cliente_id);
                return item(dataHora(v.agendada_para), c ? c.nome : "Cliente", "Visita: " + rotuloImovel(v.construcao_id) + (central() ? " · " + corretorDe(v.corretor_id) : ""), c,
                    `<button type="button" class="primary-button" data-agenda-vis="${h(v.id)}">Como foi?</button>`);
            })),
            lembretes: secao("Pós-venda e lembretes", "hoje", lemb.map(l => {
                const c = clientes.get(l.cliente_id);
                const d = dataDoLembrete(l);
                const quando = d <= hojeFim ? (d.toDateString() === new Date().toDateString() ? "Hoje" : "Atrasado · " + dataCurta(d.toISOString())) : dataCurta(d.toISOString());
                return item(quando, c ? c.nome : "Cliente", (TIPOS_LEMBRETE[l.tipo] || "Lembrete") + ": " + l.texto, c,
                    `<button type="button" class="secondary-button" data-agenda-cli="${h(l.cliente_id)}">Cliente</button><button type="button" class="primary-button" data-agenda-lemb="${h(l.id)}">Feito</button>`);
            })),
            parados: secao(`Parados há ${DIAS_PARADO} dias ou mais`, "sem", parados.map(n => {
                const c = clientes.get(n.cliente_id);
                const dias = Math.floor((agora - new Date(n.updated_at).getTime()) / DIA);
                const et = etapa(n.etapa_id);
                return item(`${dias} dias`, c ? c.nome : "Cliente", `${et ? et.nome : ""} · sem movimento${central() ? " · " + corretorDe(n.corretor_id) : ""}`, c,
                    `<button type="button" class="secondary-button" data-abrir>Abrir</button>`, `data-neg="${h(n.id)}"`);
            })),
            reativar: secao("Clientes para reativar", "futura", reat.map(n => {
                const c = clientes.get(n.cliente_id);
                const m = motivos.find(x => x.id === n.motivo_perda_id);
                const f = funil(n.funil_id);
                return item("Perdido em " + dataCurta(n.fechado_em), c ? c.nome : "Cliente", `${f ? f.nome : ""}${m ? " · " + m.nome : ""} — vale um novo contato`, c,
                    `<button type="button" class="secondary-button" data-reativar="${h(n.cliente_id)}" data-funil="${h(n.funil_id)}">Nova negociação</button>`);
            }))
        };
    }

    // Novo compromisso direto pela Agenda: escolhe a negociação e grava como próxima ação dela.
    function abrirCompromisso() {
        const abertas = [ ...negs.values() ].filter(n => n.situacao === "aberta")
            .sort((a, b) => normal((clientes.get(a.cliente_id) || {}).nome).localeCompare(normal((clientes.get(b.cliente_id) || {}).nome)));
        $("crmCompNeg").innerHTML = abertas.map(n => { const c = clientes.get(n.cliente_id); const et = etapa(n.etapa_id); const f = funil(n.funil_id);
            return `<option value="${h(n.id)}">${h(c ? c.nome : "Cliente")} — ${h(f ? f.nome : "")}, ${h(et ? et.nome : "")}${n.titulo ? " · " + h(n.titulo) : ""}</option>`; }).join("");
        $("crmCompSemNeg").hidden = abertas.length > 0;
        $("crmCompNeg").closest("label").hidden = !abertas.length;
        $("crmCompSalvar").disabled = !abertas.length;
        const amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(9, 0, 0, 0);
        $("crmCompEm").value = paraInputLocal(amanha.toISOString());
        $("crmCompTexto").value = "";
        $("crmCompTipos").querySelectorAll("[data-comp-tipo]").forEach((x, i) => x.classList.toggle("ativo", i === 0));
        $("crmCompMsg").hidden = true;
        $("crmCompromissoDialog").showModal();
    }
    async function salvarCompromisso() {
        const negId = $("crmCompNeg").value;
        const em = deInputLocal($("crmCompEm").value);
        const texto = $("crmCompTexto").value.trim();
        const tipoBtn = $("crmCompTipos").querySelector(".ativo");
        const rotulo = tipoBtn ? tipoBtn.textContent.replace(/^\S+\s/, "") : "Compromisso";
        if (!negId) return;
        if (!em) { msg($("crmCompMsg"), "Escolha a data e a hora."); return; }
        if (!texto) { msg($("crmCompMsg"), "Descreva o compromisso."); return; }
        $("crmCompSalvar").disabled = true;
        const { error } = await ctx.sb.rpc("crm_registrar_atividade", {
            p_negociacao: negId, p_tipo: "anotacao", p_texto: `Compromisso agendado (${rotulo}) para ${dataHora(em)}: ${texto}`,
            p_proxima_acao_em: em, p_proxima_acao_texto: `${rotulo}: ${texto}`
        });
        $("crmCompSalvar").disabled = false;
        if (error) { msg($("crmCompMsg"), erro(error)); return; }
        $("crmCompromissoDialog").close();
        await carregar();
        ctx.toast("Compromisso agendado.");
    }

    // ------------------------------------------------------------------ clientes
    function clientePassaFiltro(c) {
        const tipo = $("crmTipoCliFiltro").value;
        if (tipo === "pendente" && c.aprovacao !== "pendente") return false;
        if (tipo && tipo !== "pendente" && !(c.tipos || []).includes(tipo)) return false;
        if (central()) {
            const cor = $("crmCorretorCliFiltro").value;
            if (cor === "__sem" && c.corretor_id) return false;
            if (cor && cor !== "__sem" && c.corretor_id !== cor) return false;
        }
        const termo = normal($("crmBuscaCli").value.trim());
        if (!termo) return true;
        const d = termo.replace(/\D/g, "");
        if (normal(c.nome).includes(termo) || normal(c.email).includes(termo)) return true;
        return d.length >= 3 && (digitos(c.telefone).includes(d) || String(c.cpf || "").replace(/\D/g, "").includes(d));
    }
    function renderClientes() {
        const corpo = $("crmClientesBody");
        if (!corpo) return;
        const todos = [ ...clientes.values() ];
        const lista = todos.filter(clientePassaFiltro).sort((a, b) => normal(a.nome).localeCompare(normal(b.nome)));
        const pendentes = todos.filter(c => c.aprovacao === "pendente").length;
        $("navClientesBadge").hidden = !(central() && pendentes);
        $("navClientesBadge").textContent = pendentes;
        $("crmCliContagem").textContent = lista.length === todos.length ? `${todos.length} cliente${todos.length === 1 ? "" : "s"}` : `${lista.length} de ${todos.length}`;
        $("crmClientesVazio").hidden = lista.length > 0;
        const abertasPorCliente = new Map();
        negs.forEach(n => { if (n.situacao === "aberta") abertasPorCliente.set(n.cliente_id, (abertasPorCliente.get(n.cliente_id) || 0) + 1); });
        const totalPorCliente = new Map();
        negs.forEach(n => totalPorCliente.set(n.cliente_id, (totalPorCliente.get(n.cliente_id) || 0) + 1));
        corpo.innerHTML = lista.map(c => {
            const tipos = (c.tipos || []).map(t => `<span class="crm-tipo crm-tipo-${h(t)}">${h(TIPOS_CLIENTE[t] || t)}</span>`).join("");
            const aprov = c.aprovacao === "pendente" ? ` <span class="status-pill aprov-pendente">Aguardando aprovação</span>`
                : c.aprovacao === "recusado" ? ` <span class="status-pill aprov-recusado">Recusado</span>` : "";
            const abertas = abertasPorCliente.get(c.id) || 0;
            const total = totalPorCliente.get(c.id) || 0;
            return `<tr data-cli="${h(c.id)}" class="crm-linha">
              <td><strong>${h(c.nome)}</strong>${aprov}${c.origem ? `<br><small class="muted-text">${h(c.origem)}</small>` : ""}</td>
              <td>${h(formatarTelefone(c.telefone)) || "—"}${c.email ? `<br><small class="muted-text">${h(c.email)}</small>` : ""}</td>
              <td>${tipos}</td>
              <td class="crm-col-central" ${central() ? "" : "hidden"}>${c.corretor_id ? `<span class="crm-card-corretor">${ctx.fotoDoUsuario(c.corretor_id, 20)}<span>${h(corretorDe(c.corretor_id))}</span></span>` : "—"}</td>
              <td>${total ? `${abertas} em aberto${total > abertas ? ` · ${total - abertas} encerrada${total - abertas === 1 ? "" : "s"}` : ""}` : "—"}</td>
              <td>${h(dataCurta(c.created_at))}</td>
            </tr>`;
        }).join("");
        corpo.querySelectorAll("[data-cli]").forEach(tr => tr.addEventListener("click", () => abrirCliente(tr.dataset.cli)));
    }
    function preencherSelectCorretor(sel, valor, permitirVazio) {
        const equipe = ctx.equipe().filter(u => u.active !== false || u.id === valor).sort((a, b) => normal(a.display_name).localeCompare(normal(b.display_name)));
        sel.innerHTML = (permitirVazio ? `<option value="">Sem corretor</option>` : "") + equipe.map(u => `<option value="${h(u.id)}">${h(u.display_name)}${u.papel && u.papel !== "corretor" ? " (Central)" : ""}</option>`).join("");
        sel.value = valor || "";
    }
    function atualizarAvisoProprietario() {
        const marcado = document.querySelector('[data-crm-tipo][value="proprietario"]').checked;
        $("crmCliAvisoProp").hidden = !(marcado && !central());
    }
    function abrirCliente(id) {
        cliAberto = id;
        const c = id ? clientes.get(id) : null;
        if (id && !c) { ctx.toast("Cliente não encontrado."); return; }
        $("crmCliMsg").hidden = true;
        $("crmCliEyebrow").textContent = c ? "CLIENTE" : "NOVO CLIENTE";
        $("crmCliTitulo").textContent = c ? c.nome : "Cadastrar cliente";
        $("crmCliNome").value = c ? c.nome : "";
        $("crmCliTelefone").value = c ? formatarTelefone(c.telefone) : "";
        $("crmCliEmail").value = c ? c.email || "" : "";
        $("crmCliCpf").value = c ? c.cpf || "" : "";
        $("crmCliOrigem").value = c && c.origem && ORIGENS.includes(c.origem) ? c.origem : (c && c.origem ? "Outro" : "");
        $("crmCliObs").value = c ? c.observacoes || "" : "";
        $("crmCliLgpd").checked = !!(c && c.consentimento_lgpd);
        const tipos = c ? c.tipos || [] : [ "comprador" ];
        document.querySelectorAll("[data-crm-tipo]").forEach(cb => {
            cb.checked = tipos.includes(cb.value);
            // corretor não troca a marcação de proprietário de um cadastro existente (regra do banco)
            cb.disabled = !central() && !!c && cb.value === "proprietario";
        });
        atualizarAvisoProprietario();
        $("crmCliCorretorLabel").hidden = !central();
        if (central()) preencherSelectCorretor($("crmCliCorretor"), c ? c.corretor_id : "", true);
        if (central() && gestao() && roleta && roleta.ativa && !(c && (c.tipos || []).includes("proprietario"))) {
            const prox = proximoDaRoleta();
            $("crmCliCorretor").insertAdjacentHTML("afterbegin", `<option value="__roleta">🎲 Roleta — próximo da fila${prox ? " (" + h(prox) + ")" : ""}</option>`);
            if (!c) $("crmCliCorretor").value = "__roleta";
        }
        preencherIndicado(c);
        $("crmCliContato").hidden = !c;
        $("crmCliContato").innerHTML = c ? linksContato(c) : "";
        const banner = $("crmCliAprovacao");
        if (c && c.aprovacao !== "aprovado") {
            banner.className = "aprovacao-banner " + c.aprovacao;
            banner.textContent = c.aprovacao === "pendente"
                ? "Proprietário cadastrado por corretor — aguardando aprovação da Central."
                : `Recusado pela Central: ${c.aprovacao_motivo || "sem motivo"}.`;
            banner.hidden = false;
        } else banner.hidden = true;
        const ehProprietario = c && (c.tipos || []).includes("proprietario");
        $("crmCliAprovar").hidden = !(central() && c && c.aprovacao === "pendente");
        $("crmCliRecusar").hidden = !(central() && c && c.aprovacao === "pendente");
        $("crmCliExcluir").hidden = !(c && (central() || (c.criado_por === ctx.usuario().id && c.aprovacao !== "aprovado")));
        $("crmCliNovaNeg").hidden = !c || (!central() && ehProprietario);
        $("crmCliSalvar").textContent = c ? "Salvar alterações" : "Cadastrar cliente";
        desenharSublistasCliente(c);
        $("crmClienteDialog").showModal();
    }
    function desenharSublistasCliente(c) {
        const box = $("crmCliNegociacoes");
        const imoveisBox = $("crmCliImoveis");
        const hist = $("crmCliHistorico");
        if (!c) { box.hidden = true; imoveisBox.hidden = true; hist.hidden = true; $("crmCliIndicou").hidden = true; $("crmCliLembretes").hidden = true; return; }
        const lista = [ ...negs.values() ].filter(n => n.cliente_id === c.id).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        box.hidden = !lista.length;
        box.innerHTML = `<span class="eyebrow">NEGOCIAÇÕES</span>` + lista.map(n => {
            const et = etapa(n.etapa_id), f = funil(n.funil_id);
            return `<button type="button" class="crm-sub-item" data-neg="${h(n.id)}"><span class="crm-pill" style="--cor:${h(et && et.cor || "#64748b")}">${h(et ? et.nome : "")}</span> <strong>${h(f ? f.nome : "")}</strong> ${h(n.titulo || imovelNome(n.construcao_id))} <em>${h(dinheiro(n.valor))}</em></button>`;
        }).join("");
        box.querySelectorAll("[data-neg]").forEach(b => b.addEventListener("click", () => { $("crmClienteDialog").close(); abrirNegociacao(b.dataset.neg); }));
        const imoveis = central() ? ctx.imoveis().filter(i => i.proprietario_cliente_id === c.id) : [];
        imoveisBox.hidden = !imoveis.length;
        imoveisBox.innerHTML = `<span class="eyebrow">IMÓVEIS DESTE PROPRIETÁRIO</span>` + imoveis.map(i => `<button type="button" class="crm-sub-item" data-imovel="${h(i.id)}"><strong>${h(i.codigo ? i.codigo + " · " : "")}${h(i.nome)}</strong>${i.exclusividade ? ` <span class="crm-pill" style="--cor:#7c3aed">Exclusividade${i.exclusividade_ate ? " até " + h(dataCurta(i.exclusividade_ate + "T12:00:00")) : ""}</span>` : ""}</button>`).join("");
        imoveisBox.querySelectorAll("[data-imovel]").forEach(b => b.addEventListener("click", () => { $("crmClienteDialog").close(); ctx.abrirImovel(b.dataset.imovel); }));
        desenharIndicacoes(c);
        desenharLembretesCliente(c);
        hist.hidden = false;
        hist.innerHTML = `<span class="eyebrow">HISTÓRICO</span><p class="muted-text">Carregando…</p>`;
        ctx.sb.from("crm_atividades").select("*").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(60)
            .then(({ data }) => { if (cliAberto === c.id) hist.innerHTML = `<span class="eyebrow">HISTÓRICO</span>` + linhaDoTempo(data || []); });
    }
    function coletarCliente() {
        const tipos = [ ...document.querySelectorAll("[data-crm-tipo]") ].filter(cb => cb.checked).map(cb => cb.value);
        const dados = {
            nome: $("crmCliNome").value.trim(),
            telefone: $("crmCliTelefone").value.trim(),
            email: $("crmCliEmail").value.trim(),
            cpf: $("crmCliCpf").value.trim(),
            origem: $("crmCliOrigem").value,
            observacoes: $("crmCliObs").value.trim(),
            tipos: tipos.length ? tipos : [ "comprador" ],
            consentimento_lgpd: $("crmCliLgpd").checked
        };
        if (central()) {
            const escolhido = $("crmCliCorretor").value;
            const atual = cliAberto ? clientes.get(cliAberto) : null;
            dados.corretor_id = escolhido === "__roleta" ? (atual ? atual.corretor_id : null) : (escolhido || null);
        }
        dados.indicado_por = dados.origem === "Indicação" ? ($("crmCliIndicado").value || null) : null;
        return dados;
    }
    async function salvarCliente(ignorarDuplicado) {
        const dados = coletarCliente();
        if (!dados.nome) { msg($("crmCliMsg"), "Informe o nome do cliente."); return; }
        if (!dados.telefone && !dados.email) { msg($("crmCliMsg"), "Informe o celular ou o e-mail."); return; }
        if (ignorarDuplicado === true) dados.ignorar_duplicado = true;
        $("crmCliSalvar").disabled = true;
        try {
            const { data, error } = await ctx.sb.rpc("crm_salvar_cliente", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: cliAberto });
            if (error) throw error;
            clientes.set(data.id, data);
            const callback = aoSalvarCliente;
            aoSalvarCliente = null;
            $("crmClienteDialog").close();
            renderTudo();
            if (data.aprovacao === "pendente") ctx.toast("Proprietário enviado para a aprovação da Central.");
            else ctx.toast(cliAberto ? "Cliente atualizado." : "Cliente cadastrado.");
            if (central() && $("crmCliCorretor").value === "__roleta" && !(data.tipos || []).includes("proprietario")) {
                const r = await ctx.sb.rpc("crm_distribuir_roleta", { p_cliente: data.id });
                if (r.error) ctx.toast(erro(r.error));
                else { clientes.set(r.data.id, r.data); agendarRecarga(); ctx.toast(`Cliente entregue para ${corretorDe(r.data.corretor_id)} pela roleta.`); }
            }
            if (callback) callback(data);
        } catch (e) {
            const texto = erro(e);
            if (central() && String(e.message).startsWith("DUPLICADO") && ignorarDuplicado !== true) {
                if (window.confirm(texto + "\n\nCadastrar mesmo assim?")) { $("crmCliSalvar").disabled = false; return salvarCliente(true); }
            }
            msg($("crmCliMsg"), texto);
        } finally {
            $("crmCliSalvar").disabled = false;
        }
    }
    async function revisarCliente(aprovar) {
        const motivo = aprovar ? null : $("crmRecusarCliMotivo").value.trim();
        if (!aprovar && !motivo) { msg($("crmRecusarCliMsg"), "Informe o motivo."); return; }
        const { data, error } = await ctx.sb.rpc("crm_revisar_cliente", { p_id: cliAberto, p_aprovar: aprovar, p_motivo: motivo });
        if (error) { msg(aprovar ? $("crmCliMsg") : $("crmRecusarCliMsg"), erro(error)); return; }
        clientes.set(data.id, data);
        if (!aprovar) $("crmRecusarCliDialog").close();
        $("crmClienteDialog").close();
        renderTudo();
        ctx.toast(aprovar ? "Cadastro aprovado." : "Cadastro recusado. O corretor vê o motivo.");
    }
    async function excluirCliente() {
        const c = clientes.get(cliAberto);
        if (!c) return;
        const qtd = [ ...negs.values() ].filter(n => n.cliente_id === c.id).length;
        if (!window.confirm(`Excluir o cliente "${c.nome}"${qtd ? ` e as ${qtd} negociação(ões) dele` : ""}? Isso não pode ser desfeito.`)) return;
        const { error } = await ctx.sb.rpc("crm_excluir_cliente", { p_id: c.id });
        if (error) { msg($("crmCliMsg"), erro(error)); return; }
        clientes.delete(c.id);
        [ ...negs.values() ].filter(n => n.cliente_id === c.id).forEach(n => negs.delete(n.id));
        $("crmClienteDialog").close();
        renderTudo();
        ctx.toast("Cliente excluído.");
    }

    // ------------------------------------------------------------------ indicação, lembretes e roleta (Bloco 3)
    function preencherIndicado(c, porMudanca) {
        const origem = $("crmCliOrigem").value;
        $("crmCliIndicadoLabel").hidden = origem !== "Indicação";
        if (porMudanca && !$("crmCliIndicado").options.length) porMudanca = false;
        if (porMudanca) return;
        const lista = [ ...clientes.values() ].filter(x => !c || x.id !== c.id)
            .sort((a, b) => normal(a.nome).localeCompare(normal(b.nome)));
        $("crmCliIndicado").innerHTML = `<option value="">Escolha quem indicou</option>` + lista.map(x => `<option value="${h(x.id)}">${h(x.nome)}</option>`).join("");
        $("crmCliIndicado").value = c && c.indicado_por ? c.indicado_por : "";
    }
    function desenharIndicacoes(c) {
        const box = $("crmCliIndicou");
        const indicou = [ ...clientes.values() ].filter(x => x.indicado_por === c.id);
        const quem = c.indicado_por ? clientes.get(c.indicado_por) : null;
        if (!indicou.length && !quem) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = `<span class="eyebrow">INDICAÇÕES</span>`
            + (quem ? `<button type="button" class="crm-sub-item" data-cli="${h(quem.id)}">Indicado por <strong>${h(quem.nome)}</strong></button>` : "")
            + indicou.map(x => {
                const fechou = [ ...negs.values() ].some(n => n.cliente_id === x.id && n.situacao === "ganha");
                return `<button type="button" class="crm-sub-item" data-cli="${h(x.id)}">Indicou <strong>${h(x.nome)}</strong>${fechou ? ` <em>fechou negócio</em>` : ""}</button>`;
            }).join("");
        box.querySelectorAll("[data-cli]").forEach(b => b.addEventListener("click", () => { $("crmClienteDialog").close(); abrirCliente(b.dataset.cli); }));
    }
    function dataDoLembrete(l) { return new Date(l.quando + "T12:00:00"); }
    function desenharLembretesCliente(c) {
        const box = $("crmCliLembretes");
        const lista = [ ...lembretes.values() ].filter(l => l.cliente_id === c.id)
            .sort((a, b) => (a.concluido_em ? 1 : 0) - (b.concluido_em ? 1 : 0) || a.quando.localeCompare(b.quando));
        const podeCriar = ctx.papel ? ctx.papel() !== "financeiro" : true;
        box.hidden = !lista.length && !podeCriar;
        const amanha = new Date(); amanha.setDate(amanha.getDate() + 30);
        const p = n => String(n).padStart(2, "0");
        const padrao = `${amanha.getFullYear()}-${p(amanha.getMonth() + 1)}-${p(amanha.getDate())}`;
        box.innerHTML = `<span class="eyebrow">LEMBRETES E PÓS-VENDA</span>`
            + lista.map(l => `<div class="crm-lembrete${l.concluido_em ? " feito" : ""}">
                <span class="crm-lembrete-data">${h(dataCurta(dataDoLembrete(l).toISOString()))}</span>
                <span class="crm-lembrete-texto"><small>${h(TIPOS_LEMBRETE[l.tipo] || "Lembrete")}</small>${h(l.texto)}${l.nota ? `<small>Feito: ${h(l.nota)}</small>` : ""}</span>
                ${l.concluido_em ? `<em>feito</em>` : `<button type="button" class="secondary-button" data-lembrete-feito="${h(l.id)}">Feito</button>`}
              </div>`).join("")
            + (podeCriar ? `<div class="crm-lembrete-novo"><input id="crmLembreteData" type="date" value="${padrao}" /><input id="crmLembreteTexto" placeholder="ex.: ligar para saber se gostou da casa nova" autocomplete="off" /><button id="crmLembreteAdd" type="button" class="secondary-button">+ Lembrete</button></div>` : "");
        box.querySelectorAll("[data-lembrete-feito]").forEach(b => b.addEventListener("click", () => concluirLembrete(b.dataset.lembreteFeito)));
        const add = $("crmLembreteAdd");
        if (add) add.addEventListener("click", () => criarLembrete(c.id));
    }
    async function criarLembrete(clienteId) {
        const quando = $("crmLembreteData").value, texto = $("crmLembreteTexto").value.trim();
        if (!quando || !texto) { msg($("crmCliMsg"), "Escolha a data e escreva o que lembrar."); return; }
        $("crmLembreteAdd").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_criar_lembrete", { p_cliente: clienteId, p_quando: quando, p_texto: texto });
        if (error) { $("crmLembreteAdd").disabled = false; msg($("crmCliMsg"), erro(error)); return; }
        lembretes.set(data.id, data);
        desenharLembretesCliente(clientes.get(clienteId));
        renderAgenda();
        ctx.toast("Lembrete criado. Ele aparece na Agenda na data marcada.");
    }
    async function concluirLembrete(id) {
        const l = lembretes.get(id);
        if (!l) return;
        const nota = window.prompt(`${l.texto}\n\nQuer anotar como foi? (opcional)`, "");
        if (nota === null) return;
        const { data, error } = await ctx.sb.rpc("crm_concluir_lembrete", { p_id: id, p_nota: nota });
        if (error) { ctx.toast(erro(error)); return; }
        lembretes.set(data.id, data);
        if ($("crmClienteDialog").open && cliAberto === data.cliente_id) {
            desenharLembretesCliente(clientes.get(data.cliente_id));
            desenharSublistasCliente(clientes.get(data.cliente_id));
        }
        renderAgenda();
        document.dispatchEvent(new Event("skl-crm-render"));
        ctx.toast("Lembrete concluído e registrado no histórico do cliente.");
    }
    function filaDaRoleta() {
        if (!roleta) return [];
        const ativos = new Set(ctx.equipe().filter(u => u.active !== false).map(u => u.id));
        return (roleta.participantes || []).filter(id => ativos.has(id));
    }
    function proximoDaRoleta() {
        const fila = filaDaRoleta();
        if (!roleta || !roleta.ativa || !fila.length) return "";
        return corretorDe(fila[(roleta.proximo || 0) % fila.length]);
    }
    function renderRoleta() {
        const painel = $("crmRoletaPanel");
        if (!painel || !gestao()) return;
        const participantes = new Set((roleta && roleta.participantes) || []);
        const equipe = ctx.equipe().filter(u => u.active !== false && u.papel === "corretor")
            .sort((a, b) => normal(a.display_name).localeCompare(normal(b.display_name)));
        $("crmRoletaAtiva").checked = !!(roleta && roleta.ativa);
        $("crmRoletaLista").innerHTML = equipe.length
            ? equipe.map(u => `<label class="check-inline crm-roleta-pessoa">${ctx.fotoDoUsuario(u.id, 24)}<input type="checkbox" value="${h(u.id)}" ${participantes.has(u.id) ? "checked" : ""} /> ${h(u.display_name)}</label>`).join("")
            : `<p class="muted-text">Nenhum corretor ativo na equipe.</p>`;
        const prox = proximoDaRoleta();
        $("crmRoletaProximo").textContent = roleta && roleta.ativa ? (prox ? `Próximo da fila: ${prox}.` : "Ninguém na fila.") : "A roleta está desligada.";
        renderBotaoRoleta();
    }
    async function salvarRoleta() {
        const escolhidos = [ ...$("crmRoletaLista").querySelectorAll("input:checked") ].map(i => i.value);
        $("crmSalvarRoleta").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_configurar_roleta", { p_carteira: ctx.carteiraId(), p_ativa: $("crmRoletaAtiva").checked, p_participantes: escolhidos });
        $("crmSalvarRoleta").disabled = false;
        if (error) { ctx.toast(erro(error)); return; }
        roleta = data;
        renderRoleta();
        ctx.toast(data.ativa ? `Roleta ligada com ${filaDaRoleta().length} corretor(es).` : "Roleta desligada.");
    }
    function semCorretorParaRoleta() {
        return [ ...clientes.values() ].filter(c => !c.corretor_id && !(c.tipos || []).includes("proprietario") && c.aprovacao === "aprovado");
    }
    function renderBotaoRoleta() {
        const b = $("crmDistribuirRoleta");
        if (!b) return;
        const n = gestao() && roleta && roleta.ativa ? semCorretorParaRoleta().length : 0;
        b.hidden = !n;
        b.textContent = `🎲 Distribuir ${n} sem corretor`;
    }
    async function distribuirSemCorretor() {
        const lista = semCorretorParaRoleta();
        if (!lista.length) return;
        if (!window.confirm(`Entregar ${lista.length} cliente(s) sem corretor para a fila da roleta, um para cada corretor, na ordem?`)) return;
        $("crmDistribuirRoleta").disabled = true;
        let ok = 0, falha = "";
        for (const c of lista) {
            const { data, error } = await ctx.sb.rpc("crm_distribuir_roleta", { p_cliente: c.id });
            if (error) { falha = erro(error); break; }
            clientes.set(data.id, data); ok++;
        }
        $("crmDistribuirRoleta").disabled = false;
        await carregar();
        ctx.toast(falha ? `${ok} distribuído(s). Parou: ${falha}` : `${ok} cliente(s) distribuído(s) pela roleta.`);
    }

    // ------------------------------------------------------------------ negociação
    function preencherSelectClientes(selecionado) {
        const lista = [ ...clientes.values() ]
            .filter(c => central() || !(c.tipos || []).includes("proprietario"))
            .sort((a, b) => normal(a.nome).localeCompare(normal(b.nome)));
        $("crmNegCliente").innerHTML = `<option value="">Escolha o cliente</option>` + lista.map(c => `<option value="${h(c.id)}">${h(c.nome)}${c.telefone ? " · " + h(formatarTelefone(c.telefone)) : ""}</option>`).join("");
        $("crmNegCliente").value = selecionado || "";
    }
    function preencherSelectImoveis(funilId, selecionado) {
        const f = funil(funilId);
        const lista = ctx.imoveis().filter(i => (i.aprovacao || "aprovado") === "aprovado"
            && (!f || f.finalidade !== "venda" || i.para_venda) && (!f || f.finalidade !== "locacao" || i.para_aluguel !== false))
            .sort((a, b) => normal(a.nome).localeCompare(normal(b.nome)));
        const atual = selecionado && !lista.some(i => i.id === selecionado) ? ctx.imoveis().find(i => i.id === selecionado) : null;
        $("crmNegImovel").innerHTML = `<option value="">Ainda sem imóvel definido</option>`
            + (atual ? `<option value="${h(atual.id)}">${h(imovelNome(atual.id))}</option>` : "")
            + lista.map(i => `<option value="${h(i.id)}">${h(imovelNome(i.id))}</option>`).join("");
        $("crmNegImovel").value = selecionado || "";
    }
    function aplicarClienteNaNegociacao(clienteId) {
        const c = clientes.get(clienteId);
        $("crmNegContato").hidden = !c;
        $("crmNegContato").innerHTML = c ? linksContato(c) : "";
        if (c && !negAberta) {
            const tipos = c.tipos || [];
            const alvo = tipos.includes("inquilino") && !tipos.includes("comprador") ? "locacao" : (tipos.includes("comprador") ? "venda" : null);
            const f = alvo && funis.find(x => x.finalidade === alvo);
            if (f) { $("crmNegFunil").value = f.id; preencherSelectImoveis(f.id, $("crmNegImovel").value); }
            if (central()) $("crmNegCorretor").value = c.corretor_id || "";
        }
    }
    function abrirNegociacao(id, padrao) {
        negAberta = id;
        const n = id ? negs.get(id) : null;
        if (id && !n) { ctx.toast("Negociação não encontrada."); return; }
        const base = n || { funil_id: funilAtual, ...(padrao || {}) };
        $("crmNegMsg").hidden = true;
        $("crmNegEyebrow").textContent = n ? (funil(n.funil_id) || {}).nome?.toUpperCase() || "NEGOCIAÇÃO" : "NOVA NEGOCIAÇÃO";
        const cli = clientes.get(base.cliente_id);
        $("crmNegTitulo").textContent = n ? (cli ? cli.nome : "Negociação") : "Nova negociação";
        $("crmNegFunil").innerHTML = funis.map(f => `<option value="${h(f.id)}">${h(f.nome)}</option>`).join("");
        $("crmNegFunil").value = base.funil_id || (funis[0] && funis[0].id) || "";
        $("crmNegFunil").disabled = !!n;
        $("crmNegFunil").onchange = () => { preencherSelectImoveis($("crmNegFunil").value, $("crmNegImovel").value); renderCompativeis(); mostrarPrazo(); };
        $("crmNegPrazo").value = n && n.contrato_meses ? n.contrato_meses : "";
        preencherSelectClientes(base.cliente_id);
        $("crmNegCliente").disabled = !!n;
        $("crmNegNovoCli").hidden = !!n;
        preencherSelectImoveis($("crmNegFunil").value, base.construcao_id);
        $("crmNegValor").value = n && n.valor != null ? dinheiro(n.valor) : "";
        $("crmNegTituloInput").value = n ? n.titulo || "" : "";
        $("crmNegCorretorLabel").hidden = !central();
        if (central()) preencherSelectCorretor($("crmNegCorretor"), n ? n.corretor_id : (cli ? cli.corretor_id : ""), true);
        const perfil = (n && n.perfil_busca) || {};
        $("crmPerfilBairros").value = (perfil.bairros || []).join(", ");
        $("crmPerfilTipo").innerHTML = `<option value="">Qualquer</option>` + ctx.tiposImovel().map(t => `<option>${h(t)}</option>`).join("");
        $("crmPerfilTipo").value = perfil.tipo || "";
        $("crmPerfilMin").value = perfil.valor_min != null ? dinheiro(perfil.valor_min) : "";
        $("crmPerfilMax").value = perfil.valor_max != null ? dinheiro(perfil.valor_max) : "";
        $("crmPerfilQuartos").value = perfil.quartos_min ?? "";
        $("crmPerfilVagas").value = perfil.vagas_min ?? "";
        document.querySelector("#crmNegDialog .crm-perfil").open = !!(perfil.bairros || perfil.tipo || perfil.valor_min || perfil.valor_max);
        $("crmNegAcaoEm").value = n ? paraInputLocal(n.proxima_acao_em) : "";
        $("crmNegAcaoTexto").value = n ? n.proxima_acao_texto || "" : "";
        $("crmNegExcluir").hidden = !(n && central());
        $("crmNegSalvar").textContent = n ? "Salvar alterações" : "Criar negociação";
        aplicarClienteNaNegociacao(base.cliente_id);
        $("crmNegEtapas").hidden = !n;
        $("crmNegAtendimento").hidden = !n;
        if (n) {
            desenharStepper(n);
            desenharSituacao(n);
            if (window.SKLComissoes) window.SKLComissoes.desenharNaNegociacao(n, $("crmNegComissoes"));
            tipoAtendimento = "ligacao";
            marcarTipoAtendimento();
            $("crmAtTexto").value = "";
            $("crmAtProxEm").value = "";
            $("crmAtProxTexto").value = "";
            $("crmAtConcluir").checked = false;
            $("crmAtConcluirLabel").hidden = !n.proxima_acao_em;
            carregarHistoricoNeg(n.id);
            desenharVisitas(n);
        } else {
            $("crmNegSituacao").hidden = true;
            $("crmNegComissoes").hidden = true;
            $("crmNegVisitas").hidden = true;
        }
        renderCompativeis();
        mostrarPrazo();
        if (!$("crmNegDialog").open) $("crmNegDialog").showModal();
    }
    // prazo do contrato: só na locação (base das parcelas mensais de comissão "enquanto durar o contrato")
    function mostrarPrazo() {
        const f = funil($("crmNegFunil").value);
        $("crmNegPrazoLabel").hidden = !(f && f.finalidade === "locacao");
    }
    function desenharSituacao(n) {
        const box = $("crmNegSituacao");
        if (n.situacao === "aberta") { box.hidden = true; return; }
        const m = motivos.find(x => x.id === n.motivo_perda_id);
        box.className = "aprovacao-banner " + (n.situacao === "ganha" ? "crm-ganha" : "recusado");
        box.textContent = n.situacao === "ganha"
            ? `Negócio fechado em ${dataCurta(n.fechado_em)}.`
            : `Perdida em ${dataCurta(n.fechado_em)} — ${m ? m.nome : "sem motivo"}${n.motivo_perda_texto ? ": " + n.motivo_perda_texto : ""}.`;
        box.hidden = false;
    }
    function desenharStepper(n) {
        const lista = etapasDoFunil(n.funil_id);
        const atual = etapa(n.etapa_id);
        $("crmNegEtapas").innerHTML = lista.map(e => {
            const classe = e.id === n.etapa_id ? "atual" : (e.tipo === "aberta" && atual && atual.tipo === "aberta" && e.ordem < atual.ordem ? "feita" : "");
            return `<button type="button" class="crm-step ${classe} crm-step-${e.tipo}" style="--cor:${h(e.cor || "#64748b")}" data-etapa="${h(e.id)}">${h(e.nome)}</button>`;
        }).join("");
        $("crmNegEtapas").querySelectorAll("[data-etapa]").forEach(b => b.addEventListener("click", () => moverPara(n.id, b.dataset.etapa)));
    }
    function marcarTipoAtendimento() {
        $("crmAtTipos").querySelectorAll("[data-at-tipo]").forEach(b => b.classList.toggle("ativo", b.dataset.atTipo === tipoAtendimento));
    }
    function linhaDoTempo(itens) {
        if (!itens.length) return `<p class="muted-text">Nenhum registro ainda.</p>`;
        return itens.map(a => `<div class="crm-evento crm-evento-${h(a.tipo)}">
            <span class="crm-evento-icone">${ICONE_ATIVIDADE[a.tipo] || "•"}</span>
            <div><p>${h(a.texto || "")}</p><small>${h(dataHora(a.created_at))}${a.autor_id ? " · " + h(ctx.nomeDoUsuario(a.autor_id)) : ""}</small></div>
          </div>`).join("");
    }
    async function carregarHistoricoNeg(id) {
        const box = $("crmNegHistorico");
        const { data, error } = await ctx.sb.from("crm_atividades").select("*").eq("negociacao_id", id).order("created_at", { ascending: false }).limit(100);
        if (negAberta !== id) return;
        box.innerHTML = `<span class="eyebrow">HISTÓRICO</span>` + (error ? `<p class="muted-text">${h(erro(error))}</p>` : linhaDoTempo(data || []));
    }
    function lerPerfilDoFormulario() {
        const bairros = $("crmPerfilBairros").value.split(",").map(b => b.trim()).filter(Boolean).slice(0, 10);
        const perfil = {};
        if (bairros.length) perfil.bairros = bairros;
        if ($("crmPerfilTipo").value) perfil.tipo = $("crmPerfilTipo").value;
        const min = ctx.parseValor($("crmPerfilMin").value), max = ctx.parseValor($("crmPerfilMax").value);
        if (min != null) perfil.valor_min = min;
        if (max != null) perfil.valor_max = max;
        if ($("crmPerfilQuartos").value !== "") perfil.quartos_min = Number($("crmPerfilQuartos").value);
        if ($("crmPerfilVagas").value !== "") perfil.vagas_min = Number($("crmPerfilVagas").value);
        return perfil;
    }

    // ------------------------------------------------------------------ imóveis compatíveis
    // Compara o que o cliente procura com um imóvel. Finalidade, aprovação e disponibilidade são obrigatórias;
    // os demais critérios (bairros, tipo, valor, quartos, vagas) contam só se foram preenchidos no perfil.
    function valorNaFinalidade(imovel, finalidade) {
        const v = finalidade === "venda" ? imovel.valor_venda : imovel.valor_aluguel;
        return v == null || v === "" ? null : Number(v);
    }
    function serveParaFinalidade(imovel, finalidade) {
        if ((imovel.aprovacao || "aprovado") !== "aprovado" || imovel.status !== "disponivel") return false;
        if (finalidade === "venda") return !!imovel.para_venda;
        if (finalidade === "locacao") return imovel.para_aluguel !== false;
        return true;
    }
    function compatibilidade(perfil, finalidade, imovel) {
        if (!serveParaFinalidade(imovel, finalidade)) return null;
        const criterios = [];
        const p = perfil || {};
        if (p.bairros && p.bairros.length) {
            const b = normal(imovel.bairro);
            const ok = !!b && p.bairros.some(x => { const n = normal(x); return n && (b.includes(n) || n.includes(b)); });
            criterios.push([ ok, ok ? "" : `fica em ${imovel.bairro || "bairro não informado"}` ]);
        }
        if (p.tipo) {
            const ok = normal(imovel.tipo_imovel) === normal(p.tipo);
            criterios.push([ ok, ok ? "" : `é ${imovel.tipo_imovel || "outro tipo"}` ]);
        }
        const valor = valorNaFinalidade(imovel, finalidade);
        if (p.valor_max != null || p.valor_min != null) {
            let ok = valor != null;
            let falta = valor == null ? "sem valor informado" : "";
            if (ok && p.valor_max != null && valor > p.valor_max) { ok = false; falta = `${dinheiro(valor - p.valor_max)} acima do máximo`; }
            if (ok && p.valor_min != null && valor < p.valor_min) { ok = false; falta = `abaixo do valor mínimo`; }
            criterios.push([ ok, falta ]);
        }
        if (p.quartos_min != null) {
            const ok = Number(imovel.quartos) >= p.quartos_min;
            criterios.push([ ok, ok ? "" : `${imovel.quartos ?? 0} quarto(s)` ]);
        }
        if (p.vagas_min != null) {
            const ok = Number(imovel.vagas) >= p.vagas_min;
            criterios.push([ ok, ok ? "" : `${imovel.vagas ?? 0} vaga(s)` ]);
        }
        if (!criterios.length) return null;
        const certos = criterios.filter(([ ok ]) => ok).length;
        return { pct: Math.round(certos * 100 / criterios.length), faltas: criterios.filter(([ ok ]) => !ok).map(([ , f ]) => f), valor };
    }
    function perfilVazio(perfil) {
        return !perfil || !Object.keys(perfil).length;
    }
    function resumoImovel(c) {
        const partes = [];
        if (Number(c.area_m2) > 0) partes.push(`${Number(c.area_m2).toLocaleString("pt-BR")} m²`);
        if (Number(c.quartos) > 0) partes.push(`${c.quartos} quarto${c.quartos == 1 ? "" : "s"}${Number(c.suites) > 0 ? ` (${c.suites} suíte${c.suites == 1 ? "" : "s"})` : ""}`);
        if (Number(c.salas) > 0) partes.push(`${c.salas} sala${c.salas == 1 ? "" : "s"}`);
        if (Number(c.banheiros) > 0) partes.push(`${c.banheiros} banheiro${c.banheiros == 1 ? "" : "s"}`);
        if (Number(c.vagas) > 0) partes.push(`${c.vagas} vaga${c.vagas == 1 ? "" : "s"}`);
        return partes.join(" · ");
    }
    // Texto pronto para o WhatsApp (sem link: as fotos são privadas até existir a página pública do imóvel)
    function textoWhatsApp(cliente, imovel, finalidade) {
        const primeiro = String(cliente && cliente.nome || "").split(" ")[0];
        const valor = valorNaFinalidade(imovel, finalidade);
        const custo = (tipo, v, rotulo) => tipo === "valor" && v != null ? `${rotulo}: ${dinheiro(v)}` : tipo === "incluso" ? `${rotulo}: incluso` : "";
        const linhas = [
            `Olá${primeiro ? ", " + primeiro : ""}! Separei este imóvel para você:`,
            "",
            `🏠 ${imovel.nome}${imovel.codigo ? ` (cód. ${imovel.codigo})` : ""}`,
            [ imovel.bairro, imovel.cidade ].filter(Boolean).length ? `📍 ${[ imovel.bairro, imovel.cidade ].filter(Boolean).join(", ")}` : "",
            valor != null ? `💰 ${finalidade === "venda" ? "Venda" : "Aluguel"}: ${dinheiro(valor)}${finalidade === "venda" ? "" : "/mês"}` : "",
            resumoImovel(imovel) ? `📐 ${resumoImovel(imovel)}` : "",
            [ custo(imovel.condominio_tipo, imovel.valor_condominio, "Condomínio"), custo(imovel.iptu_tipo, imovel.valor_iptu, "IPTU") ].filter(Boolean).join(" · "),
            imovel.descricao ? "\n" + String(imovel.descricao).slice(0, 280) + (String(imovel.descricao).length > 280 ? "…" : "") : "",
            "",
            "Quer agendar uma visita?"
        ];
        return linhas.filter((l, i) => l !== "" || i === 1 || i === linhas.length - 2).join("\n");
    }
    function renderCompativeis() {
        const box = $("crmCompat");
        if (!box || !ctx) return;
        const f = funil($("crmNegFunil").value);
        const perfil = lerPerfilDoFormulario();
        box.hidden = false;
        if (perfilVazio(perfil)) {
            box.innerHTML = `<span class="eyebrow">IMÓVEIS QUE COMBINAM</span><p class="muted-text">Preencha "O que o cliente procura" para ver os imóveis compatíveis.</p>`;
            return;
        }
        const lista = ctx.imoveis()
            .map(i => ({ i, r: compatibilidade(perfil, f ? f.finalidade : "", i) }))
            .filter(x => x.r && x.r.pct >= 50)
            .sort((a, b) => b.r.pct - a.r.pct || (a.r.valor ?? 0) - (b.r.valor ?? 0))
            .slice(0, 8);
        const atual = $("crmNegImovel").value;
        const cli = clientes.get($("crmNegCliente").value);
        const temFone = cli && digitos(cli.telefone).length >= 10;
        box.innerHTML = `<span class="eyebrow">IMÓVEIS QUE COMBINAM <em>${lista.length ? lista.length : "nenhum"}</em></span>`
            + (lista.length ? lista.map(({ i, r }) => `<div class="crm-compat-item${i.id === atual ? " escolhido" : ""}">
                <span class="crm-compat-pct ${r.pct === 100 ? "total" : ""}">${r.pct}%</span>
                <div class="crm-compat-info">
                  <strong>${h(i.codigo ? i.codigo + " · " : "")}${h(i.nome)}</strong>
                  <small>${h([ i.bairro, dinheiro(r.valor), resumoImovel(i) ].filter(Boolean).join(" · "))}</small>
                  ${r.faltas.length ? `<small class="crm-compat-falta">Não bate: ${h(r.faltas.join("; "))}</small>` : ""}
                </div>
                <div class="crm-compat-acoes">
                  <button type="button" class="secondary-button" data-ver="${h(i.id)}">Ver</button>
                  ${i.id === atual ? `<span class="crm-compat-marca">✓ desta negociação</span>` : `<button type="button" class="secondary-button" data-usar="${h(i.id)}">Usar este</button>`}
                  ${negAberta && (negs.get(negAberta) || {}).situacao === "aberta" && $("crmVisImovel") ? `<button type="button" class="secondary-button" data-visita="${h(i.id)}">Agendar visita</button>` : ""}
                  <button type="button" class="crm-btn-contato whats" data-whats="${h(i.id)}" ${temFone ? "" : "disabled title=\"Cliente sem celular\""}>WhatsApp</button>
                </div>
              </div>`).join("")
            : `<p class="muted-text">Nenhum imóvel disponível combina com esse perfil. Esse pedido entra na "demanda sem estoque" do painel.</p>`);
        box.querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => ctx.abrirImovel(b.dataset.ver)));
        box.querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", () => {
            const i = ctx.imoveis().find(x => x.id === b.dataset.usar);
            $("crmNegImovel").value = b.dataset.usar;
            const valor = i && valorNaFinalidade(i, f ? f.finalidade : "");
            if (valor != null) $("crmNegValor").value = dinheiro(valor);
            if (i && !$("crmNegTituloInput").value.trim()) $("crmNegTituloInput").value = i.nome;
            renderCompativeis();
            ctx.toast("Imóvel escolhido. Clique em Salvar para gravar.");
        }));
        box.querySelectorAll("[data-visita]").forEach(b => b.addEventListener("click", () => {
            const sel = $("crmVisImovel");
            if (!sel) return;
            if (![ ...sel.options ].some(o => o.value === b.dataset.visita)) sel.insertAdjacentHTML("afterbegin", `<option value="${h(b.dataset.visita)}">${h(rotuloImovel(b.dataset.visita))}</option>`);
            sel.value = b.dataset.visita;
            $("crmNegVisitas").scrollIntoView({ behavior: "smooth", block: "center" });
            $("crmVisQuando").focus();
        }));
        box.querySelectorAll("[data-whats]").forEach(b => b.addEventListener("click", () => enviarImovelWhatsApp(b.dataset.whats)));
    }
    async function enviarImovelWhatsApp(imovelId) {
        const cli = clientes.get($("crmNegCliente").value);
        const i = ctx.imoveis().find(x => x.id === imovelId);
        const f = funil($("crmNegFunil").value);
        if (!cli || !i) return;
        const d = digitos(cli.telefone);
        if (d.length < 10) { ctx.toast("Este cliente não tem celular cadastrado."); return; }
        window.open(`https://wa.me/55${d}?text=${encodeURIComponent(textoWhatsApp(cli, i, f ? f.finalidade : ""))}`, "_blank", "noopener");
        if (!negAberta) return;
        // registra no histórico da negociação que o imóvel foi enviado
        const { error } = await ctx.sb.rpc("crm_registrar_atividade", {
            p_negociacao: negAberta, p_tipo: "whatsapp", p_texto: `Imóvel enviado pelo WhatsApp: ${i.codigo ? i.codigo + " · " : ""}${i.nome}`
        });
        if (!error) carregarHistoricoNeg(negAberta);
    }
    // Na ficha do imóvel: negociações em aberto que procuram algo parecido (o corretor só vê as dele, pela RLS).
    function renderInteressados(imovel) {
        const box = $("crmInteressados");
        if (!box) return;
        if (!ctx || !imovel || (imovel.aprovacao || "aprovado") !== "aprovado") { box.hidden = true; return; }
        const itens = [];
        negs.forEach(n => {
            if (n.situacao !== "aberta") return;
            const f = funil(n.funil_id);
            if (n.construcao_id === imovel.id) { itens.push({ n, pct: null }); return; }
            if (perfilVazio(n.perfil_busca)) return;
            const r = compatibilidade(n.perfil_busca, f ? f.finalidade : "", imovel);
            if (r && r.pct >= 75) itens.push({ n, pct: r.pct });
        });
        const visImovel = [ ...visitas.values() ].filter(v => v.construcao_id === imovel.id);
        if (!itens.length && !visImovel.length) { box.hidden = true; return; }
        itens.sort((a, b) => (a.pct == null ? -1 : 0) - (b.pct == null ? -1 : 0) || (b.pct || 0) - (a.pct || 0));
        box.hidden = false;
        const feitas = visImovel.filter(v => v.situacao === "realizada");
        const resumoVisitas = visImovel.length ? `<p class="muted-text crm-visitas-resumo">Visitas: ${feitas.length} realizada(s)${feitas.length ? ` — ${feitas.filter(v => v.resultado === "gostou").length} gostaram, ${feitas.filter(v => v.resultado === "proposta").length} querem proposta` : ""}${visImovel.filter(v => v.situacao === "agendada").length ? `; ${visImovel.filter(v => v.situacao === "agendada").length} agendada(s)` : ""}.</p>` : "";
        box.innerHTML = `<span class="eyebrow">CLIENTES QUE PROCURAM ISTO <em>${itens.length}</em></span>` + resumoVisitas + itens.map(({ n, pct }) => {
            const c = clientes.get(n.cliente_id);
            const et = etapa(n.etapa_id), f = funil(n.funil_id);
            return `<button type="button" class="crm-sub-item" data-neg="${h(n.id)}">
              <span class="crm-pill" style="--cor:${h(et && et.cor || "#64748b")}">${h(et ? et.nome : "")}</span>
              <strong>${h(c ? c.nome : "Cliente")}</strong> ${h(f ? f.nome : "")}${central() ? " · " + h(corretorDe(n.corretor_id)) : ""}
              <em>${pct == null ? "já negociando este" : pct + "% compatível"}</em>
            </button>`;
        }).join("");
        box.querySelectorAll("[data-neg]").forEach(b => b.addEventListener("click", () => abrirNegociacao(b.dataset.neg)));
    }

    function coletarNegociacao() {
        const perfil = lerPerfilDoFormulario();
        const valor = ctx.parseValor($("crmNegValor").value);
        const dados = {
            cliente_id: $("crmNegCliente").value,
            funil_id: $("crmNegFunil").value,
            construcao_id: $("crmNegImovel").value || null,
            titulo: $("crmNegTituloInput").value.trim(),
            valor: valor == null ? "" : String(valor),
            perfil_busca: perfil,
            proxima_acao_em: deInputLocal($("crmNegAcaoEm").value) || "",
            proxima_acao_texto: $("crmNegAcaoTexto").value.trim(),
            contrato_meses: $("crmNegPrazoLabel").hidden ? "" : ($("crmNegPrazo").value || "")
        };
        if (central()) dados.corretor_id = $("crmNegCorretor").value || null;
        return dados;
    }
    async function salvarNegociacao() {
        const dados = coletarNegociacao();
        if (!dados.cliente_id) { msg($("crmNegMsg"), "Escolha o cliente (ou cadastre um novo no botão + Novo)."); return; }
        if ($("crmNegValor").value.trim() && dados.valor === "") { msg($("crmNegMsg"), "Valor inválido."); return; }
        const n = negAberta ? negs.get(negAberta) : null;
        $("crmNegSalvar").disabled = true;
        try {
            const { data, error } = await ctx.sb.rpc("crm_salvar_negociacao", {
                p_carteira: ctx.carteiraId(), p_dados: dados, p_id: negAberta, p_expected_version: n ? n.version : null
            });
            if (error) throw error;
            negs.set(data.id, data);
            renderTudo();
            if (n) {
                ctx.toast("Negociação atualizada.");
                $("crmNegDialog").close();
            } else {
                ctx.toast("Negociação criada. Registre o primeiro atendimento.");
                funilAtual = data.funil_id;
                renderTabs(); renderQuadro();
                abrirNegociacao(data.id);
            }
        } catch (e) {
            msg($("crmNegMsg"), erro(e));
            if (String(e.message).includes("VERSION_CONFLICT")) carregar();
        } finally {
            $("crmNegSalvar").disabled = false;
        }
    }
    async function registrarAtendimento() {
        const n = negs.get(negAberta);
        if (!n) return;
        const texto = $("crmAtTexto").value.trim();
        if (!texto) { msg($("crmNegMsg"), "Descreva o atendimento."); $("crmAtTexto").focus(); return; }
        $("crmAtSalvar").disabled = true;
        try {
            const { error } = await ctx.sb.rpc("crm_registrar_atividade", {
                p_negociacao: n.id, p_tipo: tipoAtendimento, p_texto: texto,
                p_proxima_acao_em: deInputLocal($("crmAtProxEm").value),
                p_proxima_acao_texto: $("crmAtProxTexto").value.trim() || null,
                p_concluir_proxima: $("crmAtConcluir").checked
            });
            if (error) throw error;
            $("crmAtTexto").value = "";
            $("crmAtProxEm").value = "";
            $("crmAtProxTexto").value = "";
            $("crmAtConcluir").checked = false;
            $("crmNegMsg").hidden = true;
            const { data } = await ctx.sb.from("crm_negociacoes").select("*").eq("id", n.id).maybeSingle();
            if (data) {
                negs.set(data.id, data);
                $("crmNegAcaoEm").value = paraInputLocal(data.proxima_acao_em);
                $("crmNegAcaoTexto").value = data.proxima_acao_texto || "";
                $("crmAtConcluirLabel").hidden = !data.proxima_acao_em;
            }
            renderTudo();
            carregarHistoricoNeg(n.id);
            ctx.toast("Atendimento registrado.");
        } catch (e) {
            msg($("crmNegMsg"), erro(e));
        } finally {
            $("crmAtSalvar").disabled = false;
        }
    }
    async function excluirNegociacao() {
        const n = negs.get(negAberta);
        if (!n) return;
        if (!window.confirm("Excluir esta negociação e o histórico dela? Para encerrar sem apagar, use a etapa Perdido.")) return;
        const { error } = await ctx.sb.rpc("crm_excluir_negociacao", { p_id: n.id });
        if (error) { msg($("crmNegMsg"), erro(error)); return; }
        negs.delete(n.id);
        $("crmNegDialog").close();
        renderTudo();
        ctx.toast("Negociação excluída.");
    }

    // ------------------------------------------------------------------ configurações (Central)
    function renderConfig() {
        const sel = $("crmConfigFunil");
        const atual = sel.value;
        sel.innerHTML = funis.map(f => `<option value="${h(f.id)}">Funil de ${h(f.nome)}</option>`).join("");
        sel.value = funis.some(f => f.id === atual) ? atual : (funis[0] ? funis[0].id : "");
        carregarConfigEtapas();
        desenharConfigEtapas();
        configMotivos = motivos.filter(m => m.ativo).map(m => ({ id: m.id, nome: m.nome, ativo: true }));
        desenharConfigMotivos();
        [ [ "venda", "Venda" ], [ "locacao", "Locacao" ] ].forEach(([ k, sufixo ]) => {
            $("crmFaixa" + sufixo + "Medio").value = dinheiro(faixas[k] && faixas[k].medio);
            $("crmFaixa" + sufixo + "Alto").value = dinheiro(faixas[k] && faixas[k].alto);
        });
        previaFaixas();
    }
    function lerFaixasDoFormulario() {
        const v = id => ctx.parseValor($(id).value);
        return { venda: { medio: v("crmFaixaVendaMedio"), alto: v("crmFaixaVendaAlto") }, locacao: { medio: v("crmFaixaLocacaoMedio"), alto: v("crmFaixaLocacaoAlto") } };
    }
    function previaFaixas() {
        const fx = lerFaixasDoFormulario();
        const linha = (rotulo, f, suf) => f.medio && f.alto ? `<li><strong>${rotulo}:</strong> econômico até ${dinheiro(f.medio)}${suf} · médio até ${dinheiro(f.alto)}${suf} · alto padrão acima disso</li>` : "";
        $("crmFaixasPrevia").innerHTML = `<ul>${linha("Venda", fx.venda, "")}${linha("Locação", fx.locacao, "/mês")}</ul>`;
    }
    async function salvarFaixas() {
        const fx = lerFaixasDoFormulario();
        $("crmSalvarFaixas").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_configurar_faixas", { p_carteira: ctx.carteiraId(), p_faixas: fx });
        $("crmSalvarFaixas").disabled = false;
        if (error) { ctx.toast(erro(error)); return; }
        faixas = data;
        renderTudo();
        ctx.toast("Faixas de padrão salvas.");
    }
    function carregarConfigEtapas() {
        configEtapas = etapasDoFunil($("crmConfigFunil").value).map(e => ({ id: e.id, nome: e.nome, tipo: e.tipo, cor: e.cor || "#64748b" }));
        const ordemTipo = { aberta: 0, ganho: 1, perdido: 2 };
        configEtapas.sort((a, b) => ordemTipo[a.tipo] - ordemTipo[b.tipo]);
    }
    function desenharConfigEtapas() {
        const box = $("crmConfigEtapas");
        const abertas = configEtapas.filter(e => e.tipo === "aberta").length;
        box.innerHTML = configEtapas.map((e, i) => {
            const fixa = e.tipo !== "aberta";
            return `<div class="crm-config-linha">
              <input type="color" value="${h(e.cor)}" data-i="${i}" data-campo="cor" aria-label="Cor" />
              <input value="${h(e.nome)}" data-i="${i}" data-campo="nome" placeholder="Nome da etapa" />
              ${fixa ? `<span class="crm-config-fixa">${e.tipo === "ganho" ? "fechado" : "perdido"}</span>` : `
              <button type="button" class="text-button" data-mover="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
              <button type="button" class="text-button" data-mover="${i}" data-dir="1" ${i >= abertas - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
              <button type="button" class="text-button crm-remover" data-remover="${i}" ${abertas <= 1 ? "disabled" : ""} aria-label="Remover">✕</button>`}
            </div>`;
        }).join("");
        box.querySelectorAll("[data-campo]").forEach(inp => inp.addEventListener("input", () => { configEtapas[+inp.dataset.i][inp.dataset.campo] = inp.value; }));
        box.querySelectorAll("[data-mover]").forEach(b => b.addEventListener("click", () => {
            const i = +b.dataset.mover, j = i + +b.dataset.dir;
            [ configEtapas[i], configEtapas[j] ] = [ configEtapas[j], configEtapas[i] ];
            desenharConfigEtapas();
        }));
        box.querySelectorAll("[data-remover]").forEach(b => b.addEventListener("click", () => { configEtapas.splice(+b.dataset.remover, 1); desenharConfigEtapas(); }));
    }
    async function salvarEtapas() {
        if (configEtapas.some(e => !e.nome.trim())) { ctx.toast("Toda etapa precisa de nome."); return; }
        $("crmSalvarEtapas").disabled = true;
        const { error } = await ctx.sb.rpc("crm_salvar_etapas", { p_funil: $("crmConfigFunil").value, p_etapas: configEtapas.map(e => ({ id: e.id, nome: e.nome.trim(), tipo: e.tipo, cor: e.cor })) });
        $("crmSalvarEtapas").disabled = false;
        if (error) { ctx.toast(erro(error)); return; }
        ctx.toast("Etapas salvas.");
        await carregar();
    }
    function desenharConfigMotivos() {
        const box = $("crmConfigMotivos");
        box.innerHTML = configMotivos.map((m, i) => `<div class="crm-config-linha">
            <input value="${h(m.nome)}" data-i="${i}" placeholder="Motivo" />
            <button type="button" class="text-button crm-remover" data-remover="${i}" aria-label="Remover">✕</button>
          </div>`).join("");
        box.querySelectorAll("input[data-i]").forEach(inp => inp.addEventListener("input", () => { configMotivos[+inp.dataset.i].nome = inp.value; }));
        box.querySelectorAll("[data-remover]").forEach(b => b.addEventListener("click", () => { configMotivos.splice(+b.dataset.remover, 1); desenharConfigMotivos(); }));
    }
    async function salvarMotivos() {
        $("crmSalvarMotivos").disabled = true;
        const { error } = await ctx.sb.rpc("crm_salvar_motivos", { p_carteira: ctx.carteiraId(), p_motivos: configMotivos.filter(m => m.nome.trim()).map(m => ({ id: m.id, nome: m.nome.trim(), ativo: true })) });
        $("crmSalvarMotivos").disabled = false;
        if (error) { ctx.toast(erro(error)); return; }
        ctx.toast("Motivos salvos.");
        await carregar();
    }

    // ------------------------------------------------------------------ proprietário no cadastro do imóvel
    // modo: "central" | "corretor" | "leitura" (mesmos modos do diálogo do imóvel no app.js)
    function proprietarioPreencher(imovel, modo) {
        renderInteressados(imovel);
        prop = { modo, imovel, clienteVisivel: null };
        const bloco = $("proprietarioBloco");
        bloco.hidden = modo === "leitura" || !ctx;
        if (bloco.hidden) return;
        const linkado = imovel && imovel.proprietario_cliente_id;
        const visivel = linkado ? clientes.get(imovel.proprietario_cliente_id) : null;
        prop.clienteVisivel = visivel || null;
        $("exclusividadeInput").checked = !!(imovel && imovel.exclusividade);
        $("exclusividadeAteInput").value = imovel && imovel.exclusividade_ate ? imovel.exclusividade_ate : "";
        $("exclusividadeAteLabel").hidden = !$("exclusividadeInput").checked;
        [ "propNomeInput", "propTelefoneInput", "propEmailInput", "propCpfInput" ].forEach(id => { $(id).value = ""; });
        if (modo === "central") {
            const proprietarios = [ ...clientes.values() ].filter(c => (c.tipos || []).includes("proprietario")).sort((a, b) => normal(a.nome).localeCompare(normal(b.nome)));
            $("proprietarioSelect").innerHTML = `<option value="">Sem proprietário informado</option><option value="__novo">+ Cadastrar novo proprietário</option>`
                + proprietarios.map(c => `<option value="${h(c.id)}">${h(c.nome)}${c.telefone ? " · " + h(formatarTelefone(c.telefone)) : ""}${c.aprovacao === "pendente" ? " (aguardando aprovação)" : ""}</option>`).join("");
            $("proprietarioSelect").value = linkado || "";
            $("proprietarioEscolherLabel").hidden = false;
            $("propAvisoCorretor").hidden = true;
            atualizarProprietarioSelect();
        } else {
            $("proprietarioEscolherLabel").hidden = true;
            $("propAvisoCorretor").hidden = false;
            if (linkado && !visivel) {
                // já foi para a Central: o corretor não vê mais os dados
                $("proprietarioNovo").hidden = true;
                $("proprietarioResumo").hidden = false;
                $("proprietarioResumo").innerHTML = `✓ Proprietário informado. Os dados estão com a Central.`;
            } else {
                $("proprietarioNovo").hidden = false;
                $("proprietarioResumo").hidden = true;
                if (visivel) {
                    $("propNomeInput").value = visivel.nome || "";
                    $("propTelefoneInput").value = formatarTelefone(visivel.telefone);
                    $("propEmailInput").value = visivel.email || "";
                    $("propCpfInput").value = visivel.cpf || "";
                }
            }
        }
    }
    function atualizarProprietarioSelect() {
        const v = $("proprietarioSelect").value;
        $("proprietarioNovo").hidden = v !== "__novo";
        const c = v && v !== "__novo" ? clientes.get(v) : null;
        $("proprietarioResumo").hidden = !c;
        $("proprietarioResumo").innerHTML = c ? `<strong>${h(c.nome)}</strong> ${c.cpf ? "· CPF " + h(c.cpf) : ""}<div class="crm-contato-rapido">${linksContato(c)}</div>` : "";
    }
    // Chamado pelo app.js logo depois de salvar o imóvel. Devolve o imóvel atualizado (ou null se nada mudou).
    async function proprietarioSalvar(imovel) {
        if (!prop.modo || prop.modo === "leitura" || !imovel) return null;
        let clienteId = imovel.proprietario_cliente_id || null;
        const novo = {
            nome: $("propNomeInput").value.trim(), telefone: $("propTelefoneInput").value.trim(),
            email: $("propEmailInput").value.trim(), cpf: $("propCpfInput").value.trim(), tipos: [ "proprietario" ],
            origem: "Captação de imóvel"
        };
        const preencheuNovo = !$("proprietarioNovo").hidden && (novo.nome || novo.telefone || novo.email);
        if (prop.modo === "central") {
            const v = $("proprietarioSelect").value;
            clienteId = v && v !== "__novo" ? v : null;
        }
        if (preencheuNovo) {
            if (!novo.nome) throw new Error("Informe o nome do proprietário.");
            if (!novo.telefone && !novo.email) throw new Error("Informe o celular ou o e-mail do proprietário.");
            const idExistente = prop.modo === "corretor" && prop.clienteVisivel ? prop.clienteVisivel.id : null;
            const { data, error } = await ctx.sb.rpc("crm_salvar_cliente", { p_carteira: ctx.carteiraId(), p_dados: novo, p_id: idExistente });
            if (error) throw error;
            clientes.set(data.id, data);
            clienteId = data.id;
        }
        const exclus = $("exclusividadeInput").checked;
        const ate = exclus ? ($("exclusividadeAteInput").value || null) : null;
        const mudou = clienteId !== (imovel.proprietario_cliente_id || null) || exclus !== !!imovel.exclusividade || ate !== (imovel.exclusividade_ate || null);
        if (!mudou) return null;
        const { data, error } = await ctx.sb.rpc("crm_vincular_proprietario", {
            p_construcao: imovel.id, p_cliente: clienteId, p_exclusividade: exclus, p_exclusividade_ate: ate
        });
        if (error) throw error;
        renderClientes();
        return data;
    }

    // Acesso de leitura para o painel de indicadores (crm-painel.js)
    const interno = {
        ctx: () => ctx, negs, clientes, funis: () => funis, etapas: () => etapas, motivos: () => motivos, faixas: () => faixas,
        etapa, funil, etapasDoFunil, compatibilidade, perfilVazio, padraoDe, PADROES, situacaoAcao, corretorDe, dinheiro, dinheiroCurto,
        normal, dataCurta, dataHora, linksContato, abrirNegociacao: id => abrirNegociacao(id),
        visitas, lembretes, abrirVisita: id => abrirVisita(id), concluirLembrete: id => concluirLembrete(id)
    };
    window.SKLCRM = { interno, iniciar, sair, recarregar, aoMostrar, proprietarioPreencher, proprietarioSalvar, abrirNegociacao, abrirCliente };
})();
