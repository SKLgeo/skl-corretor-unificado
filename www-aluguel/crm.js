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

    // ------------------------------------------------------------------ utilidades
    const h = v => ctx.h(v);
    const central = () => !!ctx && ctx.central();
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
        clientes.clear(); negs.clear();
        funilAtual = null;
    }
    async function carregar() {
        if (!ctx || !ctx.carteiraId()) return;
        const cid = ctx.carteiraId();
        const sb = ctx.sb;
        const [ f, e, m, c, n ] = await Promise.all([
            sb.from("crm_funis").select("*").eq("carteira_id", cid).eq("ativo", true).order("ordem"),
            sb.from("crm_etapas").select("*").eq("carteira_id", cid).order("ordem"),
            sb.from("crm_motivos_perda").select("*").eq("carteira_id", cid).order("ordem"),
            sb.from("crm_clientes").select("*").eq("carteira_id", cid).order("nome").limit(5000),
            sb.from("crm_negociacoes").select("*").eq("carteira_id", cid).order("updated_at", { ascending: false }).limit(5000)
        ]);
        const falha = [ f, e, m, c, n ].find(r => r.error);
        if (falha) { console.warn("CRM:", falha.error); return; }
        funis = f.data || [];
        etapas = e.data || [];
        motivos = m.data || [];
        clientes.clear(); (c.data || []).forEach(x => clientes.set(x.id, x));
        negs.clear(); (n.data || []).forEach(x => negs.set(x.id, x));
        if (!funilAtual || !funil(funilAtual)) funilAtual = funis[0] ? funis[0].id : null;
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
    }
    function renderTudo() {
        renderFiltrosCorretor();
        renderTabs();
        renderQuadro();
        renderAgenda();
        renderClientes();
        if (central()) renderConfig();
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
        $("exclusividadeInput").addEventListener("change", () => { $("exclusividadeAteLabel").hidden = !$("exclusividadeInput").checked; });
        $("proprietarioSelect").addEventListener("change", atualizarProprietarioSelect);
        $("crmAtTipos").innerHTML = TIPOS_ATENDIMENTO.map(([ v, i, t ]) => `<button type="button" data-at-tipo="${v}">${i} ${t}</button>`).join("");
        $("crmAtTipos").querySelectorAll("[data-at-tipo]").forEach(b => b.addEventListener("click", () => {
            tipoAtendimento = b.dataset.atTipo;
            marcarTipoAtendimento();
        }));
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
          <strong>${h(c ? c.nome : "Cliente")}</strong>
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
        const badge = grupos[0][2].length + grupos[1][2].length;
        $("navAgendaBadge").hidden = !badge;
        $("navAgendaBadge").textContent = badge;
        lista.innerHTML = grupos.map(([ titulo, classe, itens ]) => {
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
        }).join("") || `<div class="empty-state">Nenhuma negociação em aberto. Crie uma em Negociações.</div>`;
        lista.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => abrirNegociacao(b.closest("[data-neg]").dataset.neg)));
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
        if (!c) { box.hidden = true; imoveisBox.hidden = true; hist.hidden = true; return; }
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
        if (central()) dados.corretor_id = $("crmCliCorretor").value || null;
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
        $("crmNegFunil").onchange = () => preencherSelectImoveis($("crmNegFunil").value, $("crmNegImovel").value);
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
            tipoAtendimento = "ligacao";
            marcarTipoAtendimento();
            $("crmAtTexto").value = "";
            $("crmAtProxEm").value = "";
            $("crmAtProxTexto").value = "";
            $("crmAtConcluir").checked = false;
            $("crmAtConcluirLabel").hidden = !n.proxima_acao_em;
            carregarHistoricoNeg(n.id);
        } else {
            $("crmNegSituacao").hidden = true;
        }
        if (!$("crmNegDialog").open) $("crmNegDialog").showModal();
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
    function coletarNegociacao() {
        const bairros = $("crmPerfilBairros").value.split(",").map(b => b.trim()).filter(Boolean).slice(0, 10);
        const perfil = {};
        if (bairros.length) perfil.bairros = bairros;
        if ($("crmPerfilTipo").value) perfil.tipo = $("crmPerfilTipo").value;
        const min = ctx.parseValor($("crmPerfilMin").value), max = ctx.parseValor($("crmPerfilMax").value);
        if (min != null) perfil.valor_min = min;
        if (max != null) perfil.valor_max = max;
        if ($("crmPerfilQuartos").value !== "") perfil.quartos_min = Number($("crmPerfilQuartos").value);
        if ($("crmPerfilVagas").value !== "") perfil.vagas_min = Number($("crmPerfilVagas").value);
        const valor = ctx.parseValor($("crmNegValor").value);
        const dados = {
            cliente_id: $("crmNegCliente").value,
            funil_id: $("crmNegFunil").value,
            construcao_id: $("crmNegImovel").value || null,
            titulo: $("crmNegTituloInput").value.trim(),
            valor: valor == null ? "" : String(valor),
            perfil_busca: perfil,
            proxima_acao_em: deInputLocal($("crmNegAcaoEm").value) || "",
            proxima_acao_texto: $("crmNegAcaoTexto").value.trim()
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

    window.SKLCRM = { iniciar, sair, recarregar, aoMostrar, proprietarioPreencher, proprietarioSalvar, abrirNegociacao, abrirCliente };
})();
