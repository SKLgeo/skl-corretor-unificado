(() => {
    "use strict";
    const $ = id => document.getElementById(id);
    const SUPABASE_URL = "https://xigwlofqkmiibzbongkn.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_mqppAm9n79xl6rYafzXyNQ_mGVoX3Vd";
    const ORIGEM = "app_corretor";
    const SLUGS_OCULTOS_NA_BASE = [ "skl-demo" ];
    const APP_VERSION = "3.7.0-base";
    if ($("brokerAppVersion")) $("brokerAppVersion").textContent = APP_VERSION;
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storageKey: "sklu-auth",
            persistSession: true,
            autoRefreshToken: true
        }
    });
    window.SKLPush = {
        onToken: async token => {
            if (!token) return;
            try {
                const {data: userData} = await sb.auth.getUser();
                if (!userData?.user) return;
                await sb.from("push_tokens").upsert({
                    usuario_id: userData.user.id,
                    token: token,
                    plataforma: "android",
                    atualizado_em: (new Date).toISOString()
                }, {
                    onConflict: "token"
                });
            } catch (error) {
                console.error("Falha ao registrar token de notificação:", error);
            }
        }
    };
    const authView = $("authView");
    const loginForm = $("brokerLoginForm");
    const activationForm = $("brokerActivationForm");
    const accountDialog = $("commercialDialog");
    const requestDialog = $("requestDialog");
    const requestsDialog = $("myRequestsDialog");
    const empreendimentoPicker = $("empreendimentoPicker");
    const vtAccountDialog = $("vtAccountDialog");
    const unitDialog = $("unitDialog");
    const EMPREENDIMENTO_ESCOLHIDO_KEY = "sklu_empreendimento_escolhido";
    let empreendimentoId = null;
    let currentEmpreendimento = null;
    let requestContext = null;
    let lotesChannel = null;
    let solicitacoesChannel = null;
    let online = false;
    // ---- Uso offline ("modo campo") ----
    // Depois de entrar com internet, guarda um resumo do acesso (empreendimento + nome) para o
    // corretor conseguir abrir o mapa, os lotes e o GPS sem internet no empreendimento. Os
    // contornos dos lotes já vêm no app e a última situação fica salva por app.js. Sair da conta
    // apaga esse resumo. Validade: OFFLINE_VALIDADE_DIAS desde a última conferência com a Central.
    const OFFLINE_ACESSO_KEY = "sklu_offline_acesso";
    const OFFLINE_VALIDADE_DIAS = 30;
    const MSG_SEM_INTERNET_PRIMEIRO_ACESSO = "Sem internet. Para usar o aplicativo sem internet, é preciso abri-lo e entrar na sua conta pelo menos uma vez com internet — assim o mapa, os lotes e a última situação ficam salvos no aparelho.";
    let modoOffline = false;
    function salvarAcessoOffline(emp, nomeCorretor) {
        if (!emp || emp.tipo === "vertical") return;
        const anterior = lerAcessoOffline(true);
        try {
            localStorage.setItem(OFFLINE_ACESSO_KEY, JSON.stringify({
                id: emp.id,
                nome: emp.nome,
                slug: emp.slug,
                tipo: emp.tipo,
                corretor: nomeCorretor || anterior?.corretor || "Corretor",
                validado_em: (new Date).toISOString()
            }));
        } catch {}
        return !anterior || anterior.id !== emp.id;
    }
    function lerAcessoOffline(ignorarValidade = false) {
        try {
            const acesso = JSON.parse(localStorage.getItem(OFFLINE_ACESSO_KEY) || "null");
            if (!acesso || !acesso.id) return null;
            const idadeDias = (Date.now() - Date.parse(acesso.validado_em)) / 864e5;
            if (!ignorarValidade && !(idadeDias <= OFFLINE_VALIDADE_DIAS)) return null;
            return acesso;
        } catch {
            return null;
        }
    }
    function limparAcessoOffline() {
        try {
            localStorage.removeItem(OFFLINE_ACESSO_KEY);
        } catch {}
    }
    function ehErroDeRede(error) {
        if (!navigator.onLine) return true;
        const texto = String(error?.name || "") + " " + String(error?.message || error || "");
        return /Failed to fetch|NetworkError|Load failed|network|fetch failed|AuthRetryableFetchError|TEMPO_ESGOTADO/i.test(texto);
    }
    function comTempoLimite(promessa, ms) {
        return Promise.race([ promessa, new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("TEMPO_ESGOTADO")), ms)) ]);
    }
    function entrarOffline(acesso) {
        modoOffline = true;
        currentEmpreendimento = acesso;
        empreendimentoId = acesso.id;
        authView.hidden = true;
        empreendimentoPicker.hidden = true;
        document.getElementById("app").hidden = false;
        $("brokerAccountName").textContent = acesso.corretor || "Corretor";
        updateConnection(false, "Sem internet · usando dados salvos no aparelho");
        window.SKLApp?.showToast?.("Sem internet: mapa, lotes e GPS funcionam com os dados salvos. Reservas voltam quando a internet voltar.");
    }
    async function revalidarAposOffline() {
        try {
            const {data: data} = await comTempoLimite(sb.auth.getSession(), 15e3);
            if (!data?.session) {
                modoOffline = false;
                limparAcessoOffline();
                document.getElementById("app").hidden = true;
                return showLogin("A internet voltou. Entre novamente para atualizar os dados.");
            }
            const lista = await comTempoLimite(listarEmpreendimentosDoCorretor(), 15e3);
            const emp = lista.find(item => item.id === empreendimentoId) || lista[0];
            if (!emp) throw new Error("Este acesso não pertence a um corretor com empreendimento ativo.");
            modoOffline = false;
            entrarNoEmpreendimento(emp);
        } catch (error) {
            if (ehErroDeRede(error)) return;
            modoOffline = false;
            limparAcessoOffline();
            closeRealtime();
            document.getElementById("app").hidden = true;
            await sb.auth.signOut();
            showLogin(traduzErro(error.message));
        }
    }
    function mostrarAvisoProntoOffline() {
        const aviso = $("offlineReadyNotice");
        if (!aviso) return;
        aviso.hidden = false;
        $("offlineReadyClose")?.addEventListener("click", () => {
            aviso.hidden = true;
        }, {
            once: true
        });
    }
    function setMessage(element, message, isError = true) {
        element.textContent = message;
        element.classList.toggle("success", !isError);
        element.hidden = !message;
    }
    function showAuthForm(form) {
        [ loginForm, activationForm ].forEach(item => {
            item.hidden = item !== form;
        });
    }
    function showLogin(message = "") {
        window.SKLVertical?.leave();
        empreendimentoPicker.hidden = true;
        authView.hidden = false;
        showAuthForm(loginForm);
        if (message) setMessage($("brokerLoginMessage"), message);
    }
    function enterApp() {
        authView.hidden = true;
        empreendimentoPicker.hidden = true;
        document.getElementById("app").hidden = false;
        modoOffline = false;
        sb.auth.getUser().then(({data: data}) => {
            const nome = data?.user?.user_metadata?.nome_exibicao || "Corretor";
            $("brokerAccountName").textContent = nome;
            if (salvarAcessoOffline(currentEmpreendimento, nome)) mostrarAvisoProntoOffline();
        });
        updateConnection(true);
        sync(false);
        openRealtime();
        window.NativeBridge?.requestPushToken?.();
        sb.from("mapas_3d").select("id").eq("empreendimento_id", empreendimentoId).eq("ativo", true).maybeSingle().then(({data: mapa3d}) => {
            if (mapa3d) window.SKLApp.showMapa3DButton?.();
        });
        Promise.all([
            sb.from("planos_pagamento").select("id", { count: "exact", head: true }).eq("empreendimento_id", empreendimentoId).eq("ativo", true),
            sb.from("dados_bancarios_cobranca").select("id", { count: "exact", head: true }).eq("empreendimento_id", empreendimentoId).eq("ativo", true)
        ]).then(([planosRes, bancosRes]) => {
            if ((planosRes.count || 0) > 0 || (bancosRes.count || 0) > 0) window.SKLApp.showPaymentInfoButton?.();
        });
    }
    function enterVerticalApp() {
        authView.hidden = true;
        empreendimentoPicker.hidden = true;
        sb.auth.getUser().then(({data: data}) => {
            $("vtAccountName").textContent = data?.user?.user_metadata?.nome_exibicao || "Corretor";
        });
        $("vtAppVersion").textContent = APP_VERSION;
        $("vtConnectionText").textContent = "Conectado à Central";
        window.SKLVertical.enter(sb, currentEmpreendimento);
        window.NativeBridge?.requestPushToken?.();
    }
    function updateConnection(isOnline, text) {
        online = Boolean(isOnline);
        $("brokerConnectionText").textContent = text || (online ? "Conectado à Central" : "Sem conexão com a Central");
        $("connectionBadge").textContent = online ? "Central sincronizada · imagem de satélite" : "Sem conexão com a Central · dados em cache";
    }
    async function listarEmpreendimentosDoCorretor() {
        const {data: userData} = await sb.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) return [];
        const {data: data, error: error} = await sb.from("empreendimento_usuarios").select("papel, expira_em, empreendimentos(id, nome, slug, tipo, ativo, config)").eq("usuario_id", uid).eq("ativo", true);
        if (error) throw error;
        const agora = Date.now();
        return (data || []).filter(v => v.papel === "corretor" && v.empreendimentos?.ativo && (!v.expira_em || new Date(v.expira_em).getTime() >= agora)).filter(v => !SLUGS_OCULTOS_NA_BASE.includes(v.empreendimentos.slug)).map(v => ({
            id: v.empreendimentos.id,
            nome: v.empreendimentos.nome,
            slug: v.empreendimentos.slug,
            tipo: v.empreendimentos.tipo,
            config: v.empreendimentos.config || {}
        }));
    }
    function mostrarSeletorEmpreendimento(lista) {
        authView.hidden = true;
        window.SKLVertical?.leave();
        empreendimentoPicker.hidden = false;
        $("empreendimentoList").innerHTML = lista.map(emp => `\n      <button class="empreendimento-option" type="button" data-emp="${emp.id}">\n        <span>\n          <strong>${escapeHtml(emp.nome)}</strong>\n          <span class="empreendimento-tag">${emp.tipo === "vertical" ? "Empreendimento vertical" : "Loteamento"}</span>\n        </span>\n        <span class="arrow">›</span>\n      </button>`).join("");
        $("empreendimentoList").querySelectorAll("[data-emp]").forEach(button => {
            button.addEventListener("click", () => {
                const emp = lista.find(item => item.id === button.dataset.emp);
                if (emp) entrarNoEmpreendimento(emp);
            });
        });
    }
    function iniciarSimulador(empId) {
        const sim = window.SKLSimulador;
        if (!sim) return;
        const atualizarBotoes = () => {
            const visivel = sim.ativo() && sim.condicoes().length > 0;
            [ "simLotButton", "simUnitButton" ].forEach(id => { if ($(id)) $(id).hidden = !visivel; });
        };
        if (!iniciarSimulador.ligado) { iniciarSimulador.ligado = true; sim.onEstado(atualizarBotoes); }
        atualizarBotoes();
        sim.init({ sb, empreendimentoId: empId, papel: "corretor", toast: (m) => window.SKLApp?.showToast?.(m) }).then(atualizarBotoes).catch(() => {});
    }
    function alvoSimulacaoAtual() {
        return requestContext && requestContext.sim ? requestContext.sim : null;
    }
    function prepararBlocoSimulacao(sim) {
        if (!window.SKLSimulador || !$("requestSimBloco")) return;
        requestContext.sim = sim;
        window.SKLSimulador.montarBlocoReserva($("requestSimBloco"), alvoSimulacaoAtual);
    }
    function entrarNoEmpreendimento(emp) {
        window.SKLApp?.resetMapa3D?.();
        window.SKLApp?.resetFormasPagamento?.();
        currentEmpreendimento = emp;
        empreendimentoId = emp.id;
        try {
            localStorage.setItem(EMPREENDIMENTO_ESCOLHIDO_KEY, emp.id);
        } catch {}
        iniciarSimulador(emp.id);
        if (emp.tipo === "vertical") enterVerticalApp(); else enterApp();
    }
    async function resolverEmpreendimentoEEntrar() {
        const lista = await listarEmpreendimentosDoCorretor();
        if (!lista.length) throw new Error("Este acesso não pertence a um corretor com empreendimento ativo.");
        if (lista.length === 1) return entrarNoEmpreendimento(lista[0]);
        let lembrado = null;
        try {
            lembrado = localStorage.getItem(EMPREENDIMENTO_ESCOLHIDO_KEY);
        } catch {}
        const encontrado = lembrado && lista.find(emp => emp.id === lembrado);
        if (encontrado) return entrarNoEmpreendimento(encontrado);
        mostrarSeletorEmpreendimento(lista);
    }
    async function trocarEmpreendimento() {
        if (accountDialog.open) accountDialog.close();
        if (vtAccountDialog.open) vtAccountDialog.close();
        try {
            const lista = await listarEmpreendimentosDoCorretor();
            if (lista.length <= 1) {
                window.SKLApp?.showToast("Você só tem acesso a este empreendimento no momento.");
                return;
            }
            mostrarSeletorEmpreendimento(lista);
        } catch (error) {
            window.SKLApp?.showToast(traduzErro(error.message));
        }
    }
    async function restoreSession() {
        const acessoOffline = lerAcessoOffline();
        let data = null;
        let sessaoErro = null;
        try {
            ({data: data, error: sessaoErro} = await comTempoLimite(sb.auth.getSession(), 12e3));
        } catch (error) {
            sessaoErro = error;
        }
        if (!data?.session) {
            // Sem internet o token vencido não renova: entra com os dados salvos em vez de pedir login
            // (a tela de login também não funcionaria sem internet).
            if (acessoOffline && (sessaoErro || !navigator.onLine)) return entrarOffline(acessoOffline);
            if (!navigator.onLine) return showLogin(MSG_SEM_INTERNET_PRIMEIRO_ACESSO);
            return showLogin();
        }
        try {
            await comTempoLimite(resolverEmpreendimentoEEntrar(), 20e3);
        } catch (error) {
            if (ehErroDeRede(error)) {
                if (acessoOffline) return entrarOffline(acessoOffline);
                return showLogin(MSG_SEM_INTERNET_PRIMEIRO_ACESSO);
            }
            limparAcessoOffline();
            await sb.auth.signOut();
            showLogin(error.message || "Entre novamente.");
        }
    }
    async function sync(showFeedback = false) {
        if (!empreendimentoId) return;
        try {
            const {data: lotes, error: error} = await sb.from("lotes").select("chave, quadra, lote, status, valor, observacao, cliente, version, updated_at, updated_by").eq("empreendimento_id", empreendimentoId);
            if (error) throw error;
            const mapped = lotes.map(lote => ({
                ...lote,
                key: lote.chave
            }));
            const serverTime = (new Date).toISOString();
            const count = window.SKLApp.setRemoteLots(mapped, serverTime);
            $("brokerLastSync").textContent = new Date(serverTime).toLocaleString("pt-BR");
            updateConnection(true);
            if (showFeedback) window.SKLApp.showToast(`${count} lotes atualizados pela Central.`);
        } catch (error) {
            updateConnection(false, "Não foi possível alcançar a Central");
            if (showFeedback) window.SKLApp.showToast(error.message);
        }
    }
    function closeRealtime() {
        if (lotesChannel) sb.removeChannel(lotesChannel);
        if (solicitacoesChannel) sb.removeChannel(solicitacoesChannel);
        lotesChannel = null;
        solicitacoesChannel = null;
    }
    function openRealtime() {
        closeRealtime();
        if (!empreendimentoId) return;
        lotesChannel = sb.channel("corretor-lotes").on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "lotes",
            filter: `empreendimento_id=eq.${empreendimentoId}`
        }, payload => {
            const lote = payload.new;
            window.SKLApp.setRemoteLot({
                ...lote,
                key: lote.chave
            }, (new Date).toISOString());
            window.SKLApp.updateMapa3DStatus?.(lote.id, lote.status);
            $("brokerLastSync").textContent = (new Date).toLocaleString("pt-BR");
        }).subscribe(status => {
            if (status === "SUBSCRIBED") updateConnection(true); else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") updateConnection(false, "Reconectando à Central…");
        });
        solicitacoesChannel = sb.channel("corretor-solicitacoes").on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "solicitacoes",
            filter: `empreendimento_id=eq.${empreendimentoId}`
        }, () => {
            window.SKLApp.showToast("A Central atualizou uma solicitação sua.");
            if (requestsDialog.open) loadMyRequests();
        }).subscribe();
    }
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage($("brokerLoginMessage"), "");
        try {
            const {error: loginError} = await sb.auth.signInWithPassword({
                email: $("brokerEmailInput").value.trim(),
                password: $("brokerPasswordInput").value
            });
            if (loginError) throw loginError;
            $("brokerPasswordInput").value = "";
            await resolverEmpreendimentoEEntrar();
        } catch (error) {
            if (ehErroDeRede(error)) return setMessage($("brokerLoginMessage"), MSG_SEM_INTERNET_PRIMEIRO_ACESSO);
            await sb.auth.signOut();
            setMessage($("brokerLoginMessage"), traduzErro(error.message));
        }
    });
    $("showBrokerActivation").addEventListener("click", () => showAuthForm(activationForm));
    document.querySelectorAll(".back-auth").forEach(button => button.addEventListener("click", () => showAuthForm(loginForm)));
    activationForm.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage($("brokerActivationMessage"), "");
        const email = $("brokerNewEmail").value.trim();
        const password = $("brokerNewPassword").value;
        try {
            await invokeConvites({
                action: "ativar_convite",
                token: $("brokerInviteInput").value.trim(),
                email: email,
                password: password
            });
            const {error: loginError} = await sb.auth.signInWithPassword({
                email: email,
                password: password
            });
            if (loginError) throw loginError;
            await resolverEmpreendimentoEEntrar();
        } catch (error) {
            setMessage($("brokerActivationMessage"), traduzErro(error.message));
        }
    });
    async function popularFormasPagamento() {
        const select = $("requestPaymentPlanInput");
        if (!select) return;
        select.innerHTML = "";
        try {
            const {data: planos, error: planosError} = await sb.from("planos_pagamento").select("id, nome").eq("empreendimento_id", empreendimentoId).eq("ativo", true).order("criado_em");
            if (planosError) throw planosError;
            if (!planos || !planos.length) {
                select.innerHTML = "<option value=\"\">Nenhuma forma de pagamento cadastrada ainda</option>";
                select.disabled = true;
                return;
            }
            select.disabled = false;
            const opcaoVazia = document.createElement("option");
            opcaoVazia.value = "";
            opcaoVazia.textContent = "Selecione a forma de pagamento";
            select.appendChild(opcaoVazia);
            planos.forEach(plano => {
                const opcao = document.createElement("option");
                opcao.value = plano.id;
                opcao.textContent = plano.nome;
                select.appendChild(opcao);
            });
        } catch (error) {
            select.innerHTML = "<option value=\"\">Nenhuma forma de pagamento cadastrada ainda</option>";
            select.disabled = true;
        }
    }
    // ---- Reservas: trava de duplo envio, prazo do pedido, reserva com contagem e bloqueio ----
    let reservaEstados = [];
    let reservaOffsetMs = 0;
    let reservaTimer = null;
    let reservaEmCurso = false;
    let reservaDeNovo = false;
    let requestSubmitting = false;
    async function carregarEstadoReservas() {
        if (reservaEmCurso) { reservaDeNovo = true; return; }
        reservaEmCurso = true;
        try {
            const {data: data, error: error} = await sb.rpc("estado_reservas");
            if (error) throw error;
            reservaEstados = data || [];
            if (reservaEstados.length) reservaOffsetMs = Date.parse(reservaEstados[0].agora) - Date.now();
        } catch {} finally {
            reservaEmCurso = false;
        }
        aplicarEstadoReservas();
        if (reservaDeNovo) { reservaDeNovo = false; carregarEstadoReservas(); }
    }
    function estadoDoAlvo(tipoAlvo, id) {
        const linhas = reservaEstados.filter(l => tipoAlvo === "lote" ? l.lote_chave === id : l.unidade_id === id);
        return [ "reservado", "pendente", "bloqueado" ].map(e => linhas.find(l => l.estado === e)).find(Boolean) || null;
    }
    function reservaAgora() {
        return Date.now() + reservaOffsetMs;
    }
    function formatarContagem(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
        const dois = n => String(n).padStart(2, "0");
        return h > 0 ? h + ":" + dois(m) + ":" + dois(s) : dois(m) + ":" + dois(s);
    }
    function mensagemEstadoReserva(est) {
        const resto = est.ate ? Date.parse(est.ate) - reservaAgora() : null;
        if (est.estado === "reservado") return "Reservado para você — restam " + formatarContagem(resto) + " para juntar documentos e concluir.";
        if (est.estado === "pendente") return resto === null ? "Pedido enviado — aguardando a Central." : "Pedido enviado — aguardando a Central (libera em " + formatarContagem(resto) + " se não houver resposta).";
        return "Reserva bloqueada para você neste imóvel até " + new Date(est.ate).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }) + " (a Central pode liberar).";
    }
    function pintarBannerReserva(el, est) {
        if (!el) return;
        if (!est) {
            el.hidden = true;
            el.textContent = "";
            return;
        }
        el.hidden = false;
        el.className = "reserva-banner reserva-" + est.estado;
        el.textContent = mensagemEstadoReserva(est);
    }
    function aplicarEstadoReservas() {
        const lote = window.SKLApp?.getSelectedLot?.();
        const estLote = lote ? estadoDoAlvo("lote", lote.lot_key) : null;
        const btnLote = $("requestLotButton");
        if (btnLote) btnLote.hidden = !!(estLote && estLote.estado !== "bloqueado");
        pintarBannerReserva($("reservaBannerLote"), estLote);
        const unidade = window.SKLVertical?.getSelectedUnit?.();
        const dlg = $("unitDialog");
        if (unidade && dlg && dlg.open) {
            const est = estadoDoAlvo("unidade", unidade.id);
            const btnUn = $("unitRequestButton");
            if (btnUn) btnUn.hidden = unidade.status !== "disponivel" || !!est;
            pintarBannerReserva($("reservaBannerUnidade"), est);
        }
        const precisaTimer = reservaEstados.some(l => l.ate);
        if (precisaTimer && !reservaTimer) reservaTimer = setInterval(tickReservas, 1000);
        if (!precisaTimer && reservaTimer) {
            clearInterval(reservaTimer);
            reservaTimer = null;
        }
    }
    function tickReservas() {
        if (reservaEstados.some(l => l.ate && Date.parse(l.ate) <= reservaAgora())) {
            carregarEstadoReservas();
            return;
        }
        aplicarEstadoReservas();
    }
    function prepararTiposDoPedido(est) {
        const sel = $("requestTypeInput");
        const opt = sel && sel.querySelector('option[value="reserva"]');
        if (!opt) return;
        const bloqueado = !!(est && est.estado === "bloqueado");
        opt.disabled = bloqueado;
        sel.value = bloqueado ? "indicacao_venda" : "reserva";
    }
    window.SKLReserva = {
        atualizar: aplicarEstadoReservas,
        recarregar: carregarEstadoReservas
    };
    let reservaCanal = null;
    sb.auth.onAuthStateChange((evento, sessao) => {
        if (reservaCanal) {
            sb.removeChannel(reservaCanal);
            reservaCanal = null;
        }
        if (!sessao || !sessao.user) {
            reservaEstados = [];
            aplicarEstadoReservas();
            return;
        }
        const uid = sessao.user.id;
        reservaCanal = sb.channel("corretor-reservas").on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "solicitacoes",
            filter: "criado_por=eq." + uid
        }, () => carregarEstadoReservas()).on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "reserva_bloqueios",
            filter: "corretor_id=eq." + uid
        }, () => carregarEstadoReservas()).subscribe();
        setTimeout(carregarEstadoReservas, 0);
    });
    $("simLotButton").addEventListener("click", () => {
        const lot = window.SKLApp.getSelectedLot();
        if (!lot) return window.SKLApp.showToast("Selecione um lote primeiro.");
        window.SKLSimulador.abrir({ valor: lot.record.valor, rotulo: `Quadra ${lot.quadra} · Lote ${lot.lote}`, permiteUsar: false });
    });
    $("simUnitButton").addEventListener("click", () => {
        const unit = window.SKLVertical.getSelectedUnit();
        if (!unit) return;
        window.SKLSimulador.abrir({ valor: unit.valor, rotulo: `Apto ${unit.numero}`, permiteUsar: false });
    });
    $("requestLotButton").addEventListener("click", () => {
        const lot = window.SKLApp.getSelectedLot();
        if (!lot) return window.SKLApp.showToast("Selecione um lote primeiro.");
        if (!online) return window.SKLApp.showToast("É preciso estar conectado para enviar uma solicitação.");
        if ([ "vendido", "bloqueado" ].includes(lot.record.status)) return window.SKLApp.showToast("Este lote está indisponível.");
        const estLote = estadoDoAlvo("lote", lot.lot_key);
        if (estLote && estLote.estado !== "bloqueado") return window.SKLApp.showToast(mensagemEstadoReserva(estLote));
        requestContext = {
            kind: "lote",
            lotKey: lot.lot_key
        };
        $("requestLotTitle").textContent = `Quadra ${lot.quadra} · Lote ${lot.lote}`;
        prepararBlocoSimulacao({ valor: lot.record.valor, rotulo: `Quadra ${lot.quadra} · Lote ${lot.lote}`, alvo: { tipo: "lote", id: lot.lot_key } });
        prepararTiposDoPedido(estadoDoAlvo("lote", lot.lot_key));
        setMessage($("requestMessage"), "");
        popularFormasPagamento();
        requestDialog.showModal();
    });
    $("unitRequestButton").addEventListener("click", () => {
        const unit = window.SKLVertical.getSelectedUnit();
        if (!unit) return;
        const estUn = estadoDoAlvo("unidade", unit.id);
        if (estUn) return window.SKLApp.showToast(mensagemEstadoReserva(estUn));
        unitDialog.close();
        requestContext = {
            kind: "unidade",
            id: unit.id
        };
        $("requestLotTitle").textContent = `Apto ${unit.numero}`;
        prepararBlocoSimulacao({ valor: unit.valor, rotulo: `Apto ${unit.numero}`, alvo: { tipo: "unidade", id: unit.id } });
        prepararTiposDoPedido(estUn);
        setMessage($("requestMessage"), "");
        popularFormasPagamento();
        requestDialog.showModal();
    });
    $("submitRequestButton").addEventListener("click", async () => {
        if (!requestContext || requestSubmitting) return;
        const customer = $("requestCustomerInput").value.trim();
        if (customer.length < 3) return setMessage($("requestMessage"), "Informe o nome do cliente.");
        if (!$("requestConsentInput").checked) return setMessage($("requestMessage"), "Confirme o aviso de privacidade (LGPD) antes de enviar.");
        requestSubmitting = true;
        $("submitRequestButton").disabled = true;
        try {
            const paymentSelect = $("requestPaymentPlanInput");
            const formaPagamentoId = paymentSelect && paymentSelect.value ? paymentSelect.value : null;
            const formaPagamentoNome = formaPagamentoId ? paymentSelect.options[paymentSelect.selectedIndex].textContent : null;
            const dadosComuns = {
                p_tipo: $("requestTypeInput").value,
                p_cliente_nome: customer,
                p_cliente_telefone: $("requestPhoneInput").value,
                p_observacao: $("requestNoteInput").value,
                p_origem_offline: false,
                p_cliente_cpf: $("requestCpfInput").value,
                p_cliente_email: $("requestEmailInput").value,
                p_cliente_endereco: $("requestAddressInput").value,
                p_forma_pagamento_id: formaPagamentoId,
                p_forma_pagamento_nome: formaPagamentoNome,
                p_simulacao: (window.SKLSimulador && alvoSimulacaoAtual() && window.SKLSimulador.escolhida(alvoSimulacaoAtual().alvo)) || null,
                p_consentimento_lgpd: $("requestConsentInput").checked
            };
            if (requestContext.kind === "lote") {
                const {data: loteRow, error: loteError} = await sb.from("lotes").select("id").eq("empreendimento_id", empreendimentoId).eq("chave", requestContext.lotKey).single();
                if (loteError || !loteRow) throw new Error("Lote não encontrado.");
                const {error: error} = await sb.rpc("criar_solicitacao", {
                    p_lote_id: loteRow.id,
                    ...dadosComuns
                });
                if (error) throw error;
            } else {
                const {error: error} = await sb.rpc("criar_solicitacao_unidade", {
                    p_unidade_id: requestContext.id,
                    ...dadosComuns
                });
                if (error) throw error;
            }
            [ $("requestCustomerInput"), $("requestPhoneInput"), $("requestCpfInput"), $("requestEmailInput"), $("requestAddressInput"), $("requestNoteInput") ].forEach(input => {
                input.value = "";
            });
            $("requestConsentInput").checked = false;
            if (paymentSelect) paymentSelect.selectedIndex = 0;
            if (window.SKLSimulador && alvoSimulacaoAtual()) window.SKLSimulador.limparEscolhida(alvoSimulacaoAtual().alvo);
            requestDialog.close();
            window.SKLApp.showToast("Solicitação enviada à Central de Vendas.");
        } catch (error) {
            setMessage($("requestMessage"), traduzErro(error.message));
        } finally {
            requestSubmitting = false;
            $("submitRequestButton").disabled = false;
            carregarEstadoReservas();
        }
    });
    function requestStatusLabel(status) {
        return {
            pendente: "Pendente",
            aprovada: "Aprovada",
            rejeitada: "Rejeitada",
            expirada: "Expirada"
        }[status] || status;
    }
    function requestTypeLabel(type) {
        return type === "reserva" ? "Reserva" : "Indicação de venda";
    }
    async function loadMyRequests() {
        const list = $("myRequestsList");
        list.innerHTML = '<p class="empty-state">Carregando…</p>';
        try {
            const {data: requests, error: error} = await sb.from("solicitacoes").select("id, tipo, cliente_nome, status, created_at, lote_id, unidade_id, lotes(chave, quadra, lote), unidades(numero, andar)").eq("empreendimento_id", empreendimentoId).order("created_at", {
                ascending: false
            });
            if (error) throw error;
            list.replaceChildren();
            if (!requests.length) list.innerHTML = '<p class="empty-state">Você ainda não enviou solicitações.</p>';
            requests.forEach(item => {
                const card = document.createElement("article");
                card.className = `request-record request-${item.status}`;
                const alvo = item.lotes ? `Quadra ${escapeHtml(item.lotes.quadra)} · Lote ${escapeHtml(item.lotes.lote)}` : `Apto ${escapeHtml(item.unidades?.numero)} · ${escapeHtml(item.unidades?.andar)}º andar`;
                card.innerHTML = `<div><strong>${alvo}</strong><span>${escapeHtml(requestTypeLabel(item.tipo))}</span></div><strong>${escapeHtml(requestStatusLabel(item.status))}</strong><p>Cliente: ${escapeHtml(item.cliente_nome)}</p><small>Enviada em ${new Date(item.created_at).toLocaleString("pt-BR")}</small>`;
                list.append(card);
            });
        } catch (error) {
            list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        }
    }
    $("myRequestsButton").addEventListener("click", () => {
        accountDialog.close();
        requestsDialog.showModal();
        loadMyRequests();
    });
    $("vtMyRequestsButton").addEventListener("click", () => {
        vtAccountDialog.close();
        requestsDialog.showModal();
        loadMyRequests();
    });
    const COMMISSION_STATUS_LABEL = { pendente: "Pendente", aprovada: "Aprovada", paga: "Paga", cancelada: "Cancelada" };
    function commissionStatusPillClass(status) {
        if (status === "paga") return "disponivel";
        if (status === "cancelada") return "vendido";
        if (status === "aprovada") return "reservado";
        return "nao_informado";
    }
    function formatMoneyBR(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
    async function loadMyCommissions() {
        const list = $("myCommissionsList");
        list.innerHTML = '<p class="empty-state">Carregando…</p>';
        try {
            const {data: userData} = await sb.auth.getUser();
            const {data: rows, error: error} = await sb.from("comissoes").select("id, valor_venda, percentual, valor_comissao, status, criado_em, pago_em").eq("empreendimento_id", empreendimentoId).eq("corretor_id", userData.user.id).order("criado_em", { ascending: false });
            if (error) throw error;
            list.replaceChildren();
            if (!rows.length) list.innerHTML = '<p class="empty-state">Nenhuma venda registrada ainda.</p>';
            rows.forEach(item => {
                const card = document.createElement("article");
                card.className = "request-record";
                const dataInfo = item.status === "paga" && item.pago_em ? `Paga em ${new Date(item.pago_em).toLocaleDateString("pt-BR")}` : `Registrada em ${new Date(item.criado_em).toLocaleDateString("pt-BR")}`;
                card.innerHTML = `<div><strong>Venda: ${formatMoneyBR(item.valor_venda)}</strong><span class="status-badge status-${commissionStatusPillClass(item.status)}">${escapeHtml(COMMISSION_STATUS_LABEL[item.status] || item.status)}</span></div><p>Comissão: <strong>${formatMoneyBR(item.valor_comissao)}</strong>${item.percentual ? ` (${item.percentual}%)` : ""}</p><small>${dataInfo}</small>`;
                list.append(card);
            });
        } catch (error) {
            list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        }
    }
    $("myCommissionsButton").addEventListener("click", () => {
        accountDialog.close();
        $("myCommissionsDialog").showModal();
        loadMyCommissions();
    });
    $("vtMyCommissionsButton").addEventListener("click", () => {
        vtAccountDialog.close();
        $("myCommissionsDialog").showModal();
        loadMyCommissions();
    });
    $("vtSwitchButton").addEventListener("click", trocarEmpreendimento);
    $("vtSwitchAccountButton").addEventListener("click", trocarEmpreendimento);
    $("vtAccountButton").addEventListener("click", () => vtAccountDialog.showModal());
    $("brokerSwitchButton").addEventListener("click", trocarEmpreendimento);
    $("syncStatusButton").addEventListener("click", () => sync(true));
    $("brokerChangePasswordButton").addEventListener("click", async () => {
        try {
            const novaSenha = $("brokerChangedPassword").value;
            const {error: error} = await sb.auth.updateUser({
                password: novaSenha
            });
            if (error) throw error;
            $("brokerChangedPassword").value = "";
            window.SKLApp.showToast("Senha alterada com segurança.");
        } catch (error) {
            window.SKLApp.showToast(traduzErro(error.message));
        }
    });
    $("vtChangePasswordButton").addEventListener("click", async () => {
        try {
            const novaSenha = $("vtChangedPassword").value;
            const {error: error} = await sb.auth.updateUser({
                password: novaSenha
            });
            if (error) throw error;
            $("vtChangedPassword").value = "";
            window.SKLApp.showToast("Senha alterada com segurança.");
        } catch (error) {
            window.SKLApp.showToast(traduzErro(error.message));
        }
    });
    async function logout() {
        if (accountDialog.open) accountDialog.close();
        if (vtAccountDialog.open) vtAccountDialog.close();
        closeRealtime();
        window.SKLVertical?.leave();
        empreendimentoId = null;
        currentEmpreendimento = null;
        modoOffline = false;
        limparAcessoOffline();
        await sb.auth.signOut();
        showLogin("Você saiu deste aparelho.");
    }
    $("brokerLogoutButton").addEventListener("click", logout);
    $("vtLogoutButton").addEventListener("click", logout);
    async function openMemorial(quadra, lote, title) {
        if (!empreendimentoId) return window.SKLApp.showToast("Entre na sua conta para abrir o memorial.");
        try {
            const path = `${empreendimentoId}/${quadra}/${lote}.pdf`;
            const {data: blob, error: error} = await sb.storage.from("memoriais").download(path);
            if (error) throw error;
            if (window.NativeBridge?.openMemorialData) {
                const base64 = await blobToBase64(blob);
                window.NativeBridge.openMemorialData(base64, title);
                return;
            }
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener");
        } catch (error) {
            window.SKLApp.showToast("Memorial ainda não disponível para este lote.");
        }
    }
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader;
            reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    function traduzErro(message) {
        const codigo = /^(REQUEST_PENDING|RESERVA_BLOQUEADA|RESERVA_ATIVA|REQUEST_EXPIRED|CONSENT_REQUIRED):\s*(.*)$/s.exec(message || "");
        if (codigo) return codigo[2];
        const mapa = {
            "Invalid login credentials": "E-mail ou senha incorretos.",
            "Email not confirmed": "E-mail ainda não confirmado.",
            "A user with this email address has already been registered": "Já existe um usuário com esse e-mail — fale com a central.",
            "User already registered": "Já existe um usuário com esse e-mail — fale com a central."
        };
        return mapa[message] || message || "Não foi possível concluir a operação.";
    }
    async function invokeConvites(body) {
        const {data: data, error: error} = await sb.functions.invoke("convites", {
            body: body
        });
        if (error) {
            let message = error.message;
            if (error.context && typeof error.context.json === "function") {
                try {
                    const payload = await error.context.json();
                    message = payload.message || payload.error || message;
                } catch {}
            }
            throw new Error(message);
        }
        if (data?.error) throw new Error(data.message || data.error);
        return data;
    }
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[character]));
    }
    window.addEventListener("online", () => {
        if (modoOffline) {
            revalidarAposOffline();
            return;
        }
        if (empreendimentoId && currentEmpreendimento?.tipo !== "vertical") {
            sync(false);
            openRealtime();
        }
    });
    window.addEventListener("offline", () => {
        if (currentEmpreendimento?.tipo !== "vertical") {
            updateConnection(false, "Modo offline · dados em cache");
            closeRealtime();
        }
    });
    async function carregarMapa3D() {
        if (!empreendimentoId) return null;
        const {data: mapa, error: mapaError} = await sb.from("mapas_3d").select("imagem_url, largura_px, altura_px, pontos").eq("empreendimento_id", empreendimentoId).eq("ativo", true).maybeSingle();
        if (mapaError || !mapa) return null;
        const {data: lotesRows, error: lotesError} = await sb.from("lotes").select("id, quadra, lote, status").eq("empreendimento_id", empreendimentoId);
        if (lotesError) return null;
        const quadraLotePorId = new Map;
        const statusPorId = new Map;
        (lotesRows || []).forEach(l => {
            quadraLotePorId.set(l.id, {
                quadra: l.quadra,
                lote: l.lote
            });
            statusPorId.set(l.id, l.status);
        });
        return {
            ...mapa,
            quadraLotePorId: quadraLotePorId,
            statusPorId: statusPorId
        };
    }
    async function carregarFormasPagamento() {
        if (!empreendimentoId) return null;
        const {data: planos, error: planosError} = await sb.from("planos_pagamento").select("id, nome, descricao, planos_pagamento_series(id, tipo, quantidade_parcelas, indexador, portador_cobranca, valor_total, observacao, ordem)").eq("empreendimento_id", empreendimentoId).eq("ativo", true).order("criado_em");
        const {data: bancos, error: bancosError} = await sb.from("dados_bancarios_cobranca").select("id, tipo, banco_nome, agencia, conta, titular, documento_titular, chave_pix, instrucoes, ordem").eq("empreendimento_id", empreendimentoId).eq("ativo", true).order("ordem");
        if (planosError && bancosError) return null;
        const planosList = (planos || []).map(p => ({
            ...p,
            planos_pagamento_series: (p.planos_pagamento_series || []).slice().sort((a, b) => a.ordem - b.ordem)
        }));
        if (planosList.length === 0 && (!bancos || bancos.length === 0)) return null;
        return {
            planos: planosList,
            bancos: bancos || []
        };
    }
    window.SKLOnline = {
        sync: sync,
        openMemorial: openMemorial,
        carregarMapa3D: carregarMapa3D,
        carregarFormasPagamento: carregarFormasPagamento
    };
    restoreSession();
})();