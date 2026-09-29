(() => {
    "use strict";
    const $ = id => document.getElementById(id);

    const STATUS = {
        disponivel: "Disponível",
        alugado: "Alugado",
        reservado: "Reservado",
        indisponivel: "Indisponível"
    };
    const STATUS_COLOR = {
        disponivel: "#2f8a56",
        alugado: "#bd5147",
        reservado: "#d59a22",
        indisponivel: "#477fa4"
    };
    const ROLE = {
        corretor: "Corretor",
        central_vendas: "Controle de aluguéis",
        administrador: "Administrador"
    };

    const SUPABASE_URL = "https://xigwlofqkmiibzbongkn.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_mqppAm9n79xl6rYafzXyNQ_mGVoX3Vd";
    const APP_VERSION = "0.1.7";
    const FOTOS_BUCKET = "fotos-construcoes";
    const CARTEIRA_ESCOLHIDA_KEY = "sklu_alugueis_carteira_escolhida";
    const CENTRO_PADRAO = [ -15.793889, -47.882778 ];

    if ($("appVersionText")) $("appVersionText").textContent = `v${APP_VERSION}`;

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: "sklu-auth", persistSession: true, autoRefreshToken: true }
    });

    let carteiraId = null;
    let carteiraNomeAtual = "";
    let pendingUser = null;
    let currentUser = null;
    let construcoes = new Map();
    let realtimeChannel = null;
    let toastTimer = null;
    let mapaVisivel = false;

    let map = null;
    let markersById = new Map();

    let pickerMap = null;
    let pickerMarker = null;

    let editandoId = null;
    let fotosExistentes = [];
    let fotosNovas = [];
    let fotosRemovidas = [];
    let heroIndex = 0;
    const signedUrlCache = new Map();

    let interesses = new Map();
    let interesseConstrucaoId = null;

    let corretores = [];
    let invitesAluguel = [];
    let comissoesAluguel = [];
    let pendingResetUserAluguelId = null;
    let pendingRemoveUserAluguel = null;
    let pendingEditPercentual = null;

    // Handoff de sessão vindo do app-casca "Central Unificada" (projeto de
    // integração Vendas+Aluguéis, Etapa 4) — só age quando este app está
    // carregado dentro do iframe da casca. Rodando sozinho, como hoje,
    // window.self === window.top e a função resolve na hora, sem nenhuma
    // mudança de comportamento nem atraso perceptível.
    function skl_aguardarSessaoDoShell(timeoutMs) {
        return new Promise(resolve => {
            if (window.self === window.top) return resolve(null);
            let done = false;
            function onMsg(ev) {
                if (ev.data && ev.data.type === "SKL_SESSION_HANDOFF") {
                    done = true;
                    window.removeEventListener("message", onMsg);
                    resolve(ev.data);
                }
            }
            window.addEventListener("message", onMsg);
            try { window.parent.postMessage({ type: "SKL_SESSION_REQUEST" }, "*"); } catch {}
            setTimeout(() => {
                if (!done) { window.removeEventListener("message", onMsg); resolve(null); }
            }, timeoutMs);
        });
    }

    bindEvents();
    skl_aguardarSessaoDoShell(1500).then(async sessao => {
        if (sessao) {
            try { await sb.auth.setSession({ access_token: sessao.access_token, refresh_token: sessao.refresh_token }); } catch {}
        }
        restoreSession();
    });

    function bindEvents() {
        $("loginForm").addEventListener("submit", login);
        $("logoutButton").addEventListener("click", logout);
        document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
        document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.go)));
        document.querySelectorAll(".metric-card").forEach(button => button.addEventListener("click", () => {
            $("construcaoStatusFilter").value = button.dataset.status;
            showPage("construcoes");
            renderConstrucoes();
        }));
        $("construcaoSearchInput").addEventListener("input", renderConstrucoes);
        $("construcaoStatusFilter").addEventListener("change", renderConstrucoes);
        $("toggleConstrucaoViewButton").addEventListener("click", toggleConstrucaoView);
        $("newConstrucaoButton").addEventListener("click", () => openConstrucaoDialog(null));
        $("saveConstrucaoButton").addEventListener("click", saveConstrucao);
        $("deleteConstrucaoButton").addEventListener("click", openDeleteDialog);
        $("confirmDeleteConstrucaoButton").addEventListener("click", confirmDeleteConstrucao);
        $("registrarInteresseButton").addEventListener("click", () => abrirInteresseDialog(construcoes.get(editandoId)));
        $("submitInteresseButton").addEventListener("click", enviarInteresse);
        $("construcaoFotosInput").addEventListener("change", onFotosInputChange);
        $("construcaoLatInput").addEventListener("change", syncPickerFromInputs);
        $("construcaoLngInput").addEventListener("change", syncPickerFromInputs);
        $("construcaoLinkMapaInput").addEventListener("change", aplicarLinkMapa);
        $("construcaoLinkMapaInput").addEventListener("paste", () => setTimeout(aplicarLinkMapa, 0));
        $("construcaoStatusInput").addEventListener("change", atualizarStatusHero);
        $("passwordForm").addEventListener("submit", changePassword);
        $("switchCarteiraButton").addEventListener("click", trocarCarteira);
        $("topbarSwitchCarteiraButton").addEventListener("click", trocarCarteira);
        $("heroPrevButton").addEventListener("click", heroAnterior);
        $("heroNextButton").addEventListener("click", heroProxima);
        $("imovelHeroImg").addEventListener("click", () => abrirLightbox(heroIndex));
        $("fotoLightboxClose").addEventListener("click", fecharLightbox);
        $("fotoLightboxPrev").addEventListener("click", lightboxAnterior);
        $("fotoLightboxNext").addEventListener("click", lightboxProxima);
        $("fotoLightbox").addEventListener("click", event => { if (event.target === $("fotoLightbox")) fecharLightbox(); });
        document.addEventListener("keydown", event => {
            if (!$("fotoLightbox").open) return;
            if (event.key === "ArrowLeft") lightboxAnterior();
            if (event.key === "ArrowRight") lightboxProxima();
        });
        configurarDeslizeToque($("imovelHero"), heroAnterior, heroProxima);
        configurarDeslizeToque($("fotoLightbox"), lightboxAnterior, lightboxProxima);
        document.querySelectorAll(".dialog-close").forEach(button => {
            button.addEventListener("click", () => button.closest("dialog")?.close());
        });
        $("newInviteAluguelButton").addEventListener("click", () => {
            $("inviteAluguelNameInput").value = "";
            $("inviteAluguelPercentualInput").value = "";
            restrictRoleOptionsForCaller($("inviteAluguelRoleInput"));
            $("inviteAluguelResult").hidden = true;
            $("inviteAluguelDialog").showModal();
        });
        $("createInviteAluguelButton").addEventListener("click", createInviteAluguel);
        $("newDirectUserAluguelButton").addEventListener("click", () => {
            $("directAluguelNameInput").value = "";
            $("directAluguelEmailInput").value = "";
            $("directAluguelPasswordInput").value = "";
            $("directAluguelPercentualInput").value = "";
            $("directAluguelExpiryInput").value = "";
            restrictRoleOptionsForCaller($("directAluguelRoleInput"));
            $("directUserAluguelMessage").hidden = true;
            $("directUserAluguelDialog").showModal();
        });
        $("createDirectUserAluguelButton").addEventListener("click", createDirectUserAluguel);
        $("confirmResetPasswordAluguelButton").addEventListener("click", confirmResetPasswordAluguel);
        $("confirmRemoveUserAluguelButton").addEventListener("click", confirmRemoveUserAluguel);
        $("confirmEditPercentualButton").addEventListener("click", confirmEditPercentual);
        $("newComissaoAluguelButton").addEventListener("click", openComissaoAluguelDialog);
        $("saveComissaoAluguelButton").addEventListener("click", saveComissaoAluguel);
        $("comissaoAluguelCorretorInput").addEventListener("change", () => {
            const selecionado = $("comissaoAluguelCorretorInput").selectedOptions[0];
            const percentual = selecionado?.dataset.percentual;
            if (percentual) $("comissaoAluguelPercentualInput").value = percentual;
        });
    }

    function configurarDeslizeToque(elemento, aoDeslizarDireita, aoDeslizarEsquerda) {
        let inicioX = null;
        elemento.addEventListener("touchstart", event => { inicioX = event.touches[0].clientX; }, { passive: true });
        elemento.addEventListener("touchend", event => {
            if (inicioX == null) return;
            const delta = event.changedTouches[0].clientX - inicioX;
            inicioX = null;
            if (Math.abs(delta) < 40) return;
            if (delta > 0) aoDeslizarDireita(); else aoDeslizarEsquerda();
        });
    }

    function h(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[char]));
    }
    function formatDate(value) {
        if (!value) return "—";
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
    }
    function statusPill(status) {
        return `<span class="status-pill ${h(status)}">${h(STATUS[status] || status)}</span>`;
    }
    function showMessage(element, message, success = false) {
        element.textContent = message;
        element.style.background = success ? "#dff4e8" : "#f7e8e6";
        element.style.color = success ? "#247346" : "#9a3b34";
        element.hidden = false;
    }
    function toast(message) {
        clearTimeout(toastTimer);
        $("toast").textContent = message;
        $("toast").hidden = false;
        toastTimer = setTimeout(() => $("toast").hidden = true, 3600);
    }
    function traduzErro(message) {
        const mapa = {
            "Invalid login credentials": "E-mail ou senha incorretos.",
            "VERSION_CONFLICT": "Este imóvel foi alterado por outro usuário nesse meio-tempo. Feche e abra de novo.",
            "CONSENT_REQUIRED": "Confirme o aviso de privacidade (LGPD) antes de enviar."
        };
        for (const chave of Object.keys(mapa)) {
            if (message && message.includes(chave)) return mapa[chave];
        }
        return message || "Não foi possível concluir a operação.";
    }

    async function invokeConvitesAluguel(body) {
        const { data, error } = await sb.functions.invoke("convites-aluguel", { body });
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

    // ===== Sessão / carteira =====

    async function login(event) {
        event.preventDefault();
        try {
            const { error } = await sb.auth.signInWithPassword({
                email: $("emailInput").value.trim(),
                password: $("passwordInput").value
            });
            if (error) throw error;
            await resolverCarteiraEEntrar();
        } catch (error) {
            await sb.auth.signOut();
            showMessage($("loginMessage"), traduzErro(error.message));
        }
    }

    async function restoreSession() {
        try {
            const { data } = await sb.auth.getSession();
            if (!data?.session) return logout();
            await resolverCarteiraEEntrar();
        } catch {
            logout();
        }
    }

    async function listarCarteirasDoUsuario() {
        const { data: userData, error: userError } = await sb.auth.getUser();
        if (userError || !userData?.user) throw new Error("Sessão inválida.");
        const uid = userData.user.id;
        pendingUser = {
            id: uid,
            email: userData.user.email,
            display_name: userData.user.user_metadata?.nome_exibicao || userData.user.email
        };
        const { data, error } = await sb.from("carteira_aluguel_usuarios")
            .select("papel, expira_em, carteiras_aluguel(id, nome, slug, ativo)")
            .eq("usuario_id", uid).eq("ativo", true);
        if (error) throw error;
        const agora = Date.now();
        return (data || [])
            .filter(v => v.carteiras_aluguel?.ativo && (!v.expira_em || new Date(v.expira_em).getTime() >= agora))
            .map(v => ({ id: v.carteiras_aluguel.id, nome: v.carteiras_aluguel.nome, slug: v.carteiras_aluguel.slug, papel: v.papel }));
    }

    async function resolverCarteiraEEntrar() {
        const lista = await listarCarteirasDoUsuario();
        if (!lista.length) throw new Error("Este usuário ainda não tem acesso a nenhuma carteira de aluguéis.");
        if (lista.length === 1) return entrarNaCarteira(lista[0]);
        let lembrado = null;
        try { lembrado = localStorage.getItem(CARTEIRA_ESCOLHIDA_KEY); } catch {}
        const encontrado = lembrado && lista.find(c => c.id === lembrado);
        if (encontrado) return entrarNaCarteira(encontrado);
        mostrarSeletorCarteira(lista);
    }

    function mostrarSeletorCarteira(lista) {
        $("loginView").hidden = true;
        $("appView").hidden = true;
        $("carteiraPicker").hidden = false;
        $("carteiraPickerList").innerHTML = lista.map(c => `
      <button class="empreendimento-option" type="button" data-carteira="${h(c.id)}">
        <span><strong>${h(c.nome)}</strong></span>
        <span class="arrow">›</span>
      </button>`).join("");
        $("carteiraPickerList").querySelectorAll("[data-carteira]").forEach(button => {
            button.addEventListener("click", () => {
                const c = lista.find(item => item.id === button.dataset.carteira);
                if (c) entrarNaCarteira(c);
            });
        });
    }

    async function trocarCarteira() {
        try {
            const lista = await listarCarteirasDoUsuario();
            if (lista.length <= 1) return toast("Você só tem acesso a esta carteira no momento.");
            mostrarSeletorCarteira(lista);
        } catch (error) {
            toast(traduzErro(error.message));
        }
    }

    async function entrarNaCarteira(carteira) {
        carteiraId = carteira.id;
        carteiraNomeAtual = carteira.nome;
        currentUser = { ...pendingUser, papel: carteira.papel };
        try { localStorage.setItem(CARTEIRA_ESCOLHIDA_KEY, carteira.id); } catch {}
        $("carteiraPicker").hidden = true;
        await enterApp();
    }

    async function enterApp() {
        $("loginView").hidden = true;
        $("appView").hidden = false;
        $("currentUserName").textContent = currentUser.display_name;
        $("currentUserRole").textContent = ROLE[currentUser.papel] || currentUser.papel;
        const podeGerenciar = [ "administrador", "central_vendas" ].includes(currentUser.papel);
        $("newConstrucaoButton").hidden = !podeGerenciar;
        $("navInteresses").hidden = !podeGerenciar;
        $("navCorretores").hidden = !podeGerenciar;
        $("navComissoes").hidden = !podeGerenciar;
        $("dashboardCarteiraNome").textContent = carteiraNomeAtual;
        $("settingsCarteiraNome").textContent = carteiraNomeAtual;
        await loadConstrucoes();
        if (podeGerenciar) {
            await loadInteresses();
            await loadCorretores();
            await loadComissoesAluguel();
        }
        connectRealtime();
        showPage("dashboard");
    }

    function logout() {
        sb.auth.signOut();
        carteiraId = null;
        currentUser = null;
        construcoes.clear();
        if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
        $("appView").hidden = true;
        $("carteiraPicker").hidden = true;
        $("loginView").hidden = false;
        $("loginForm").reset();
    }

    async function changePassword(event) {
        event.preventDefault();
        try {
            const { error } = await sb.auth.updateUser({ password: $("changedPasswordInput").value });
            if (error) throw error;
            $("changedPasswordInput").value = "";
            toast("Senha alterada com sucesso.");
        } catch (error) {
            toast(traduzErro(error.message));
        }
    }

    function showPage(page) {
        document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
        document.querySelectorAll(".page").forEach(section => section.classList.remove("active-page"));
        $(`page-${page}`).classList.add("active-page");
        const titles = { dashboard: "Visão geral", construcoes: "Imóveis", interesses: "Interesses", corretores: "Corretores", comissoes: "Comissões", settings: "Configurações" };
        $("pageTitle").textContent = titles[page] || page;
        if (page === "construcoes" && mapaVisivel) setTimeout(() => { ensureMap(); map && map.invalidateSize(); }, 60);
    }

    // ===== Dados =====

    async function loadConstrucoes() {
        const { data, error } = await sb.from("construcoes").select("*").eq("carteira_id", carteiraId).order("updated_at", { ascending: false });
        if (error) { toast(traduzErro(error.message)); return; }
        construcoes.clear();
        (data || []).forEach(c => construcoes.set(c.id, c));
        updateMetrics();
        renderConstrucoes();
        renderDashboardRecentes();
        $("connectionBadge").textContent = "Conectado";
        $("connectionBadge").classList.remove("offline");
        $("connectionBadge").classList.add("online");
        $("syncTime").textContent = `Sincronizado às ${new Date().toLocaleTimeString("pt-BR")}`;
    }

    function connectRealtime() {
        if (realtimeChannel) sb.removeChannel(realtimeChannel);
        realtimeChannel = sb.channel(`construcoes-${carteiraId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "construcoes", filter: `carteira_id=eq.${carteiraId}` }, payload => {
                if (payload.eventType === "DELETE") {
                    construcoes.delete(payload.old.id);
                } else {
                    construcoes.set(payload.new.id, payload.new);
                }
                updateMetrics();
                renderConstrucoes();
                renderDashboardRecentes();
            })
            .subscribe();
    }

    function updateMetrics() {
        const contagem = { disponivel: 0, alugado: 0, reservado: 0, indisponivel: 0 };
        construcoes.forEach(c => { if (contagem[c.status] != null) contagem[c.status]++; });
        $("metricDisponivel").textContent = contagem.disponivel;
        $("metricAlugado").textContent = contagem.alugado;
        $("metricReservado").textContent = contagem.reservado;
        $("metricIndisponivel").textContent = contagem.indisponivel;
    }

    function renderDashboardRecentes() {
        const recentes = [ ...construcoes.values() ].slice(0, 5);
        $("dashboardRecentes").innerHTML = recentes.length ? recentes.map(c => `
      <div class="compact-item"><div><strong>${h(c.nome)}</strong><br><small>${h(c.endereco || "Sem endereço")}</small></div>${statusPill(c.status)}</div>
    `).join("") : `<p class="muted-text">Nenhum imóvel cadastrado ainda.</p>`;
    }

    function filteredConstrucoes() {
        const termo = $("construcaoSearchInput").value.trim().toLowerCase();
        const status = $("construcaoStatusFilter").value;
        return [ ...construcoes.values() ].filter(c => {
            if (status && c.status !== status) return false;
            if (termo && !(`${c.nome} ${c.endereco || ""}`.toLowerCase().includes(termo))) return false;
            return true;
        });
    }

    function renderConstrucoes() {
        const rows = filteredConstrucoes();
        $("construcaoGridEmpty").hidden = rows.length > 0;
        $("construcaoGrid").innerHTML = rows.map(c => {
            const foto = (c.fotos || [])[0];
            return `<article class="construcao-card" data-id="${h(c.id)}">
        <div class="construcao-card-photo" data-foto-holder="${h(c.id)}">${foto ? "" : "Sem foto"}</div>
        <div class="construcao-card-body">
          <h3>${h(c.nome)}</h3>
          <p>${h(c.endereco || "Endereço não informado")}</p>
          <div class="construcao-card-footer">${statusPill(c.status)}<span class="construcao-card-valor">${c.valor_aluguel ? "R$ " + Number(c.valor_aluguel).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—"}</span></div>
        </div>
      </article>`;
        }).join("");
        $("construcaoGrid").querySelectorAll("[data-id]").forEach(card => card.addEventListener("click", () => openConstrucaoDialog(construcoes.get(card.dataset.id))));
        rows.forEach(c => {
            const foto = (c.fotos || [])[0];
            if (!foto) return;
            resolveFotoUrl(foto.path).then(url => {
                const holder = document.querySelector(`[data-foto-holder="${CSS.escape(c.id)}"]`);
                if (holder && url) { holder.style.backgroundImage = `url("${url}")`; holder.textContent = ""; }
            });
        });
        if (mapaVisivel) { ensureMap(); renderMapMarkers(rows); }
    }

    async function resolveFotoUrl(path) {
        const cached = signedUrlCache.get(path);
        if (cached && cached.expiresAt > Date.now()) return cached.url;
        const { data, error } = await sb.storage.from(FOTOS_BUCKET).createSignedUrl(path, 3600);
        if (error || !data) return null;
        signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
        return data.signedUrl;
    }

    // ===== Mapa (lista) =====

    function toggleConstrucaoView() {
        mapaVisivel = !mapaVisivel;
        $("construcaoMapPanel").hidden = !mapaVisivel;
        if (mapaVisivel) {
            setTimeout(() => { ensureMap(); map && map.invalidateSize(); renderMapMarkers(filteredConstrucoes()); }, 60);
        }
    }

    function ensureMap() {
        if (map) return;
        map = L.map("construcaoMap", { zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 20, attribution: "© OpenStreetMap"
        }).addTo(map);
        map.setView(CENTRO_PADRAO, 4);
    }

    function statusDivIcon(status) {
        return L.divIcon({
            className: "",
            html: `<div style="width:18px;height:18px;border-radius:50%;background:${STATUS_COLOR[status] || "#708189"};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
            iconSize: [ 18, 18 ],
            iconAnchor: [ 9, 9 ]
        });
    }

    function renderMapMarkers(rows) {
        if (!map) return;
        markersById.forEach(marker => map.removeLayer(marker));
        markersById.clear();
        const pontos = [];
        rows.forEach(c => {
            if (c.latitude == null || c.longitude == null) return;
            const marker = L.marker([ c.latitude, c.longitude ], { icon: statusDivIcon(c.status) }).addTo(map);
            marker.bindTooltip(c.nome);
            marker.on("click", () => openConstrucaoDialog(c));
            markersById.set(c.id, marker);
            pontos.push([ c.latitude, c.longitude ]);
        });
        if (pontos.length) map.fitBounds(pontos, { padding: [ 30, 30 ], maxZoom: 15 });
    }

    // ===== Diálogo de construção =====

    function openConstrucaoDialog(construcao) {
        editandoId = construcao ? construcao.id : null;
        fotosExistentes = construcao ? [ ...(construcao.fotos || []) ] : [];
        fotosNovas = [];
        fotosRemovidas = [];
        heroIndex = 0;
        $("construcaoDialogMessage").hidden = true;
        $("construcaoDialogTitle").textContent = construcao ? "Editar imóvel" : "Novo imóvel";
        $("construcaoNomeInput").value = construcao?.nome || "";
        $("construcaoTipoInput").value = construcao?.tipo_imovel || "Casa";
        $("construcaoStatusInput").value = construcao?.status || "disponivel";
        atualizarStatusHero();
        $("construcaoEnderecoInput").value = construcao?.endereco || "";
        $("construcaoValorInput").value = construcao?.valor_aluguel ?? "";
        $("construcaoDescricaoInput").value = construcao?.descricao || "";
        $("construcaoLatInput").value = construcao?.latitude ?? "";
        $("construcaoLngInput").value = construcao?.longitude ?? "";
        $("construcaoLinkMapaInput").value = "";
        $("construcaoLinkMapaMensagem").hidden = true;
        atualizarBotoesMapa();
        const podeGerenciar = [ "administrador", "central_vendas" ].includes(currentUser.papel);
        $("deleteConstrucaoButton").hidden = !construcao || !podeGerenciar;
        $("saveConstrucaoButton").hidden = !podeGerenciar;
        $("registrarInteresseButton").hidden = podeGerenciar || !construcao;
        document.querySelector(".foto-add-button").hidden = !podeGerenciar;
        $("construcaoDialog").querySelectorAll("input, select, textarea").forEach(field => field.disabled = !podeGerenciar);
        renderGaleria();
        $("construcaoDialog").showModal();
        setTimeout(() => {
            ensurePickerMap();
            pickerMap.invalidateSize();
            const lat = construcao?.latitude, lng = construcao?.longitude;
            if (lat != null && lng != null) {
                posicionarPickerMarker(lat, lng);
                pickerMap.setView([ lat, lng ], 15);
            } else {
                if (pickerMarker) { pickerMap.removeLayer(pickerMarker); pickerMarker = null; }
                pickerMap.setView(CENTRO_PADRAO, 4);
            }
        }, 60);
    }

    function ensurePickerMap() {
        if (pickerMap) return;
        pickerMap = L.map("construcaoPickerMap", { zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 20, attribution: "© OpenStreetMap"
        }).addTo(pickerMap);
        pickerMap.setView(CENTRO_PADRAO, 4);
        pickerMap.on("click", event => {
            posicionarPickerMarker(event.latlng.lat, event.latlng.lng);
            $("construcaoLatInput").value = event.latlng.lat.toFixed(6);
            $("construcaoLngInput").value = event.latlng.lng.toFixed(6);
            atualizarBotoesMapa();
        });
    }

    function posicionarPickerMarker(lat, lng) {
        if (pickerMarker) { pickerMarker.setLatLng([ lat, lng ]); return; }
        pickerMarker = L.marker([ lat, lng ], { draggable: true }).addTo(pickerMap);
        pickerMarker.on("dragend", () => {
            const pos = pickerMarker.getLatLng();
            $("construcaoLatInput").value = pos.lat.toFixed(6);
            $("construcaoLngInput").value = pos.lng.toFixed(6);
            atualizarBotoesMapa();
        });
    }

    function syncPickerFromInputs() {
        const lat = parseFloat($("construcaoLatInput").value);
        const lng = parseFloat($("construcaoLngInput").value);
        atualizarBotoesMapa();
        if (Number.isNaN(lat) || Number.isNaN(lng) || !pickerMap) return;
        posicionarPickerMarker(lat, lng);
        pickerMap.setView([ lat, lng ], Math.max(pickerMap.getZoom(), 13));
    }

    function atualizarBotoesMapa() {
        const lat = parseFloat($("construcaoLatInput").value);
        const lng = parseFloat($("construcaoLngInput").value);
        const google = $("googleMapsButton");
        const apple = $("appleMapsButton");
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            google.hidden = true;
            apple.hidden = true;
            return;
        }
        google.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
        google.hidden = false;
        apple.href = `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent($("construcaoNomeInput").value || "Imóvel")}`;
        apple.hidden = false;
    }

    // Reconhece coordenadas coladas de um link do Google Maps. Cobre os
    // formatos mais comuns (link completo com "@lat,lng", e "q=lat,lng" ou
    // "ll=lat,lng" de links de compartilhar/pesquisa). Links curtos
    // (maps.app.goo.gl/...) não têm a coordenada no próprio texto — o
    // Google só revela isso depois de seguir o redirecionamento, que exigiria
    // uma chamada de rede; por ora pedimos pro usuário colar o link completo
    // (o menu "Compartilhar > Copiar link" do app já costuma dar o link
    // completo com @lat,lng).
    function extrairCoordenadasDeLink(texto) {
        if (!texto) return null;
        const padroes = [
            /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
            /[?&]q=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
            /[?&]ll=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
            /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/
        ];
        for (const padrao of padroes) {
            const encontrado = texto.match(padrao);
            if (encontrado) return { lat: parseFloat(encontrado[1]), lng: parseFloat(encontrado[2]) };
        }
        return null;
    }

    function aplicarLinkMapa() {
        const texto = $("construcaoLinkMapaInput").value.trim();
        const msg = $("construcaoLinkMapaMensagem");
        if (!texto) { msg.hidden = true; return; }
        const coordenadas = extrairCoordenadasDeLink(texto);
        if (!coordenadas) {
            showMessage(msg, "Não reconheci coordenadas nesse link — tente colar o link completo (com \"@lat,lng\") ou clique direto no mapa.");
            return;
        }
        msg.hidden = true;
        $("construcaoLatInput").value = coordenadas.lat.toFixed(6);
        $("construcaoLngInput").value = coordenadas.lng.toFixed(6);
        posicionarPickerMarker(coordenadas.lat, coordenadas.lng);
        pickerMap.setView([ coordenadas.lat, coordenadas.lng ], 16);
        atualizarBotoesMapa();
    }

    function obterItensFotos() {
        return [
            ...fotosExistentes.map(f => ({ tipo: "existente", path: f.path })),
            ...fotosNovas.map((f, index) => ({ tipo: "nova", index, previewUrl: f.previewUrl }))
        ];
    }

    function resolveUrlItem(item) {
        return item.tipo === "nova" ? Promise.resolve(item.previewUrl) : resolveFotoUrl(item.path);
    }

    function renderGaleria() {
        const itens = obterItensFotos();
        const podeGerenciar = [ "administrador", "central_vendas" ].includes(currentUser.papel);
        const grid = $("construcaoFotosGrid");
        grid.innerHTML = itens.map((item, i) => `<div class="foto-thumb" data-foto-index="${i}">${podeGerenciar ? `<button class="foto-remove-button" type="button" data-remove-foto="${i}">×</button>` : ""}</div>`).join("");
        itens.forEach((item, i) => {
            const el = grid.children[i];
            if (!el) return;
            resolveUrlItem(item).then(url => { if (url) el.style.backgroundImage = `url("${url}")`; });
            el.addEventListener("click", () => mostrarHero(i));
        });
        grid.querySelectorAll("[data-remove-foto]").forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();
                const idx = Number(button.dataset.removeFoto);
                const item = itens[idx];
                if (item.tipo === "existente") {
                    fotosRemovidas.push(item.path);
                    fotosExistentes = fotosExistentes.filter(f => f.path !== item.path);
                } else {
                    fotosNovas.splice(item.index, 1);
                }
                if (heroIndex >= idx && heroIndex > 0) heroIndex--;
                renderGaleria();
            });
        });
        mostrarHero(heroIndex);
    }

    async function mostrarHero(index) {
        const itens = obterItensFotos();
        heroIndex = itens.length ? Math.max(0, Math.min(index, itens.length - 1)) : 0;
        const img = $("imovelHeroImg");
        const empty = $("imovelHeroEmpty");
        const contador = $("imovelHeroContador");
        const multiplas = itens.length > 1;
        $("heroPrevButton").hidden = !multiplas;
        $("heroNextButton").hidden = !multiplas;
        contador.hidden = !multiplas;
        if (!itens.length) {
            img.hidden = true;
            empty.hidden = false;
            return;
        }
        const url = await resolveUrlItem(itens[heroIndex]);
        img.src = url || "";
        img.hidden = !url;
        empty.hidden = !!url;
        contador.textContent = `${heroIndex + 1}/${itens.length}`;
        $("construcaoFotosGrid").querySelectorAll(".foto-thumb").forEach((el, i) => el.classList.toggle("selecionada", i === heroIndex));
    }

    function heroAnterior() {
        const itens = obterItensFotos();
        if (itens.length) mostrarHero((heroIndex - 1 + itens.length) % itens.length);
    }
    function heroProxima() {
        const itens = obterItensFotos();
        if (itens.length) mostrarHero((heroIndex + 1) % itens.length);
    }

    function atualizarStatusHero() {
        const status = $("construcaoStatusInput").value || "disponivel";
        const pill = $("imovelHeroStatus");
        pill.className = `status-pill imovel-hero-status ${status}`;
        pill.textContent = STATUS[status] || status;
    }

    function onFotosInputChange(event) {
        const files = [ ...event.target.files ];
        files.forEach(file => fotosNovas.push({ file, previewUrl: URL.createObjectURL(file) }));
        event.target.value = "";
        renderGaleria();
    }

    // ===== Lightbox (foto em tela cheia, com navegação) =====

    let lightboxItens = [];
    let lightboxIndex = 0;

    function abrirLightbox(index) {
        lightboxItens = obterItensFotos();
        if (!lightboxItens.length) return;
        lightboxIndex = index;
        mostrarFotoLightbox();
        $("fotoLightbox").showModal();
    }

    async function mostrarFotoLightbox() {
        if (!lightboxItens.length) return;
        lightboxIndex = (lightboxIndex + lightboxItens.length) % lightboxItens.length;
        const url = await resolveUrlItem(lightboxItens[lightboxIndex]);
        $("fotoLightboxImg").src = url || "";
        const multiplas = lightboxItens.length > 1;
        $("fotoLightboxPrev").hidden = !multiplas;
        $("fotoLightboxNext").hidden = !multiplas;
        $("fotoLightboxContador").hidden = !multiplas;
        $("fotoLightboxContador").textContent = `${lightboxIndex + 1}/${lightboxItens.length}`;
    }

    function lightboxAnterior() { lightboxIndex--; mostrarFotoLightbox(); }
    function lightboxProxima() { lightboxIndex++; mostrarFotoLightbox(); }

    function fecharLightbox() {
        $("fotoLightbox").close();
        $("fotoLightboxImg").src = "";
    }

    function sanitizarNomeArquivo(nome) {
        return nome.replace(/[^a-zA-Z0-9._-]/g, "_");
    }

    async function uploadFotosNovas(construcaoIdAlvo) {
        const enviados = [];
        for (const item of fotosNovas) {
            const path = `${carteiraId}/${construcaoIdAlvo}/${Date.now()}_${sanitizarNomeArquivo(item.file.name)}`;
            const { error } = await sb.storage.from(FOTOS_BUCKET).upload(path, item.file, { upsert: false });
            if (error) throw error;
            enviados.push({ path });
        }
        return enviados;
    }

    async function removerFotosMarcadas() {
        if (!fotosRemovidas.length) return;
        await sb.storage.from(FOTOS_BUCKET).remove(fotosRemovidas);
    }

    async function saveConstrucao() {
        const nome = $("construcaoNomeInput").value.trim();
        if (!nome) { showMessage($("construcaoDialogMessage"), "Informe o nome do imóvel."); return; }
        const payload = {
            p_nome: nome,
            p_tipo_imovel: $("construcaoTipoInput").value,
            p_descricao: $("construcaoDescricaoInput").value.trim() || null,
            p_endereco: $("construcaoEnderecoInput").value.trim() || null,
            p_latitude: $("construcaoLatInput").value === "" ? null : parseFloat($("construcaoLatInput").value),
            p_longitude: $("construcaoLngInput").value === "" ? null : parseFloat($("construcaoLngInput").value),
            p_valor_aluguel: $("construcaoValorInput").value === "" ? null : parseFloat($("construcaoValorInput").value.replace(/[^\d.,]/g, "").replace(",", ".")),
            p_status: $("construcaoStatusInput").value
        };
        $("saveConstrucaoButton").disabled = true;
        try {
            let construcao;
            if (editandoId) {
                const atual = construcoes.get(editandoId);
                await removerFotosMarcadas();
                const novasEnviadas = await uploadFotosNovas(editandoId);
                const fotosFinal = [ ...fotosExistentes, ...novasEnviadas ];
                const { data, error } = await sb.rpc("atualizar_construcao", {
                    p_id: editandoId, p_expected_version: atual.version, ...payload, p_fotos: fotosFinal
                });
                if (error) throw error;
                construcao = data;
            } else {
                const { data: criada, error: erroCriar } = await sb.rpc("criar_construcao", { p_carteira_id: carteiraId, ...payload });
                if (erroCriar) throw erroCriar;
                const novasEnviadas = await uploadFotosNovas(criada.id);
                if (novasEnviadas.length) {
                    const { data: atualizada, error: erroFotos } = await sb.rpc("atualizar_construcao", {
                        p_id: criada.id, p_expected_version: criada.version, p_fotos: novasEnviadas
                    });
                    if (erroFotos) throw erroFotos;
                    construcao = atualizada;
                } else {
                    construcao = criada;
                }
            }
            construcoes.set(construcao.id, construcao);
            updateMetrics();
            renderConstrucoes();
            renderDashboardRecentes();
            $("construcaoDialog").close();
            toast("Imóvel salvo com sucesso.");
        } catch (error) {
            showMessage($("construcaoDialogMessage"), traduzErro(error.message));
        } finally {
            $("saveConstrucaoButton").disabled = false;
        }
    }

    function openDeleteDialog() {
        if (!editandoId) return;
        const construcao = construcoes.get(editandoId);
        $("deleteConstrucaoName").textContent = construcao?.nome || "";
        $("deleteConstrucaoDialog").showModal();
    }

    async function confirmDeleteConstrucao() {
        try {
            const construcao = construcoes.get(editandoId);
            const paths = (construcao?.fotos || []).map(f => f.path);
            const { error } = await sb.rpc("excluir_construcao", { p_id: editandoId });
            if (error) throw error;
            if (paths.length) await sb.storage.from(FOTOS_BUCKET).remove(paths);
            construcoes.delete(editandoId);
            updateMetrics();
            renderConstrucoes();
            renderDashboardRecentes();
            $("deleteConstrucaoDialog").close();
            $("construcaoDialog").close();
            toast("Imóvel excluído.");
        } catch (error) {
            toast(traduzErro(error.message));
        }
    }

    // ===== Interesse de aluguel (corretor registra, central acompanha) =====

    function abrirInteresseDialog(construcao) {
        if (!construcao) return;
        interesseConstrucaoId = construcao.id;
        $("interesseImovelNome").textContent = construcao.nome;
        $("interesseDialogMessage").hidden = true;
        $("interesseNomeInput").value = "";
        $("interesseTelefoneInput").value = "";
        $("interesseCpfInput").value = "";
        $("interesseEmailInput").value = "";
        $("interesseEnderecoInput").value = "";
        $("interesseObservacaoInput").value = "";
        $("interesseConsentInput").checked = false;
        $("interesseDialog").showModal();
    }

    async function enviarInteresse() {
        const nome = $("interesseNomeInput").value.trim();
        if (!nome) { showMessage($("interesseDialogMessage"), "Informe o nome do cliente."); return; }
        if (!$("interesseConsentInput").checked) { showMessage($("interesseDialogMessage"), "Confirme o aviso de privacidade (LGPD) antes de enviar."); return; }
        $("submitInteresseButton").disabled = true;
        try {
            const { error } = await sb.rpc("criar_interesse_aluguel", {
                p_construcao_id: interesseConstrucaoId,
                p_cliente_nome: nome,
                p_cliente_telefone: $("interesseTelefoneInput").value.trim() || null,
                p_cliente_cpf: $("interesseCpfInput").value.trim() || null,
                p_cliente_email: $("interesseEmailInput").value.trim() || null,
                p_cliente_endereco: $("interesseEnderecoInput").value.trim() || null,
                p_observacao: $("interesseObservacaoInput").value.trim() || null,
                p_consentimento_lgpd: $("interesseConsentInput").checked
            });
            if (error) throw error;
            $("interesseDialog").close();
            $("construcaoDialog").close();
            toast("Interesse registrado — a central vai entrar em contato.");
        } catch (error) {
            showMessage($("interesseDialogMessage"), traduzErro(error.message));
        } finally {
            $("submitInteresseButton").disabled = false;
        }
    }

    async function loadInteresses() {
        const { data, error } = await sb.from("interesses_aluguel").select("*").eq("carteira_id", carteiraId).order("created_at", { ascending: false });
        if (error) { toast(traduzErro(error.message)); return; }
        interesses.clear();
        (data || []).forEach(i => interesses.set(i.id, i));
        renderInteresses();
    }

    const INTERESSE_STATUS = { pendente: "Pendente", em_contato: "Em contato", concluido: "Concluído", descartado: "Descartado" };

    function renderInteresses() {
        const rows = [ ...interesses.values() ];
        $("interessesTableEmpty").hidden = rows.length > 0;
        const podeAnonimizar = currentUser.papel === "administrador";
        const statusEncerrados = [ "concluido", "descartado" ];
        $("interessesTableBody").innerHTML = rows.map(i => {
            const construcao = construcoes.get(i.construcao_id);
            const opcoes = Object.entries(INTERESSE_STATUS).map(([valor, rotulo]) => `<option value="${valor}" ${i.status === valor ? "selected" : ""}>${rotulo}</option>`).join("");
            return `<tr>
        <td>${h(construcao?.nome || "—")}</td>
        <td>${h(i.cliente_nome)}</td>
        <td>${h(i.cliente_telefone || "—")}</td>
        <td>${h(i.cliente_cpf || "—")}</td>
        <td>${h(i.cliente_email || "—")}</td>
        <td>${h(i.observacao || "—")}</td>
        <td><small>${h(formatDate(i.created_at))}</small></td>
        <td><select data-interesse-status="${h(i.id)}">${opcoes}</select></td>
        <td>${podeAnonimizar && statusEncerrados.includes(i.status) && i.cliente_cpf !== null ? `<button class="row-button" data-anonimizar-interesse="${h(i.id)}">Anonimizar dados</button>` : ""}</td>
      </tr>`;
        }).join("");
        $("interessesTableBody").querySelectorAll("[data-interesse-status]").forEach(select => {
            select.addEventListener("change", () => atualizarStatusInteresse(select.dataset.interesseStatus, select.value));
        });
        $("interessesTableBody").querySelectorAll("[data-anonimizar-interesse]").forEach(button => {
            button.addEventListener("click", () => anonimizarClienteInteresse(button.dataset.anonimizarInteresse));
        });
    }
    async function anonimizarClienteInteresse(interesseId) {
        if (!confirm("Remover permanentemente nome, telefone, CPF, e-mail e endereço do cliente deste interesse? O restante do registro é preservado. Não é possível desfazer.")) return;
        try {
            const { error } = await sb.rpc("anonimizar_cliente_interesse_aluguel", { p_interesse_id: interesseId });
            if (error) throw error;
            const alvo = interesses.get(interesseId);
            if (alvo) {
                alvo.cliente_nome = "[dados removidos a pedido do titular]";
                alvo.cliente_telefone = null;
                alvo.cliente_cpf = null;
                alvo.cliente_email = null;
                alvo.cliente_endereco = null;
            }
            renderInteresses();
            toast("Dados do cliente anonimizados.");
        } catch (error) {
            toast(traduzErro(error.message));
        }
    }

    async function atualizarStatusInteresse(id, status) {
        try {
            const { data, error } = await sb.rpc("atualizar_status_interesse_aluguel", { p_id: id, p_status: status });
            if (error) throw error;
            interesses.set(id, data);
            toast("Situação do interesse atualizada.");
        } catch (error) {
            toast(traduzErro(error.message));
            renderInteresses();
        }
    }

    // ===== Corretores (convites, acesso direto, comissão de cadastro) =====

    function restrictRoleOptionsForCaller(selectEl) {
        const onlyCorretor = currentUser.papel === "central_vendas";
        [ ...selectEl.options ].forEach(option => { option.hidden = onlyCorretor && option.value !== "corretor"; });
        if (onlyCorretor) selectEl.value = "corretor";
    }

    async function loadCorretores() {
        const { data: vinculos, error } = await sb.from("carteira_aluguel_usuarios")
            .select("usuario_id, papel, ativo, expira_em, email, percentual_comissao, perfis(nome_exibicao)")
            .eq("carteira_id", carteiraId);
        if (error) { toast(traduzErro(error.message)); return; }
        corretores = (vinculos || []).map(v => ({
            id: v.usuario_id,
            display_name: v.perfis?.nome_exibicao || "—",
            email: v.email,
            papel: v.papel,
            active: v.ativo,
            expires_at: v.expira_em,
            percentual_comissao: v.percentual_comissao
        }));
        const { data: conviteRows } = await sb.from("convites_aluguel")
            .select("id, email, papel, percentual_comissao, token, expira_em")
            .eq("carteira_id", carteiraId).is("usado_em", null).gt("expira_em", (new Date).toISOString());
        invitesAluguel = conviteRows || [];
        renderCorretores();
    }

    function corretorStatusPill(user) {
        if (!user.active) return '<span class="status-pill alugado">Bloqueado</span>';
        if (user.expires_at) {
            const expired = new Date(user.expires_at).getTime() < Date.now();
            return expired ? '<span class="status-pill alugado">Expirado</span>' : `<span class="status-pill reservado">Até ${h(formatDate(user.expires_at))}</span>`;
        }
        return '<span class="status-pill disponivel">Ativo</span>';
    }

    function canManageCorretor(user) {
        if (user.id === currentUser.id) return false;
        if (currentUser.papel === "central_vendas") return user.papel === "corretor";
        return true;
    }

    function renderCorretores() {
        $("corretorTableBody").innerHTML = corretores.map(user => {
            const percentualTexto = user.percentual_comissao != null ? `${user.percentual_comissao}%` : "—";
            if (!canManageCorretor(user)) {
                return `<tr><td><strong>${h(user.display_name)}</strong></td><td>${h(user.email || "—")}</td><td>${h(ROLE[user.papel])}</td><td>${percentualTexto}</td><td>${corretorStatusPill(user)}</td><td>${user.id === currentUser.id ? "Conta atual" : "—"}</td></tr>`;
            }
            const toggleLabel = user.active ? "Desativar" : "Reativar";
            return `<tr><td><strong>${h(user.display_name)}</strong></td><td>${h(user.email || "—")}</td><td>${h(ROLE[user.papel])}</td><td>${percentualTexto}</td><td>${corretorStatusPill(user)}</td><td style="display:flex;gap:6px;flex-wrap:wrap"><button class="row-button" data-corretor-percentual="${h(user.id)}">Editar %</button><button class="row-button" data-corretor-reset="${h(user.id)}">Redefinir senha</button><button class="row-button" data-corretor-toggle="${h(user.id)}" data-next-active="${user.active ? "0" : "1"}">${toggleLabel}</button><button class="row-button danger-button" data-corretor-remove="${h(user.id)}" data-corretor-name="${h(user.display_name)}">Remover acesso</button></td></tr>`;
        }).join("");
        $("corretorTableBody").querySelectorAll("[data-corretor-percentual]").forEach(button => button.addEventListener("click", () => openEditPercentual(button.dataset.corretorPercentual)));
        $("corretorTableBody").querySelectorAll("[data-corretor-reset]").forEach(button => button.addEventListener("click", () => openResetPasswordAluguel(button.dataset.corretorReset)));
        $("corretorTableBody").querySelectorAll("[data-corretor-toggle]").forEach(button => button.addEventListener("click", () => toggleCorretorStatus(button.dataset.corretorToggle, button.dataset.nextActive === "1")));
        $("corretorTableBody").querySelectorAll("[data-corretor-remove]").forEach(button => button.addEventListener("click", () => openRemoveUserAluguel(button.dataset.corretorRemove, button.dataset.corretorName)));
        $("inviteAluguelList").innerHTML = invitesAluguel.length ? invitesAluguel.map(invite => `<div class="invite-row"><span><strong>${h(invite.email)}</strong><br><small>${h(ROLE[invite.papel])}${invite.percentual_comissao != null ? " · " + h(invite.percentual_comissao) + "% comissão" : ""} · expira ${h(formatDate(invite.expira_em))}</small></span><code class="invite-code">${h(invite.token || "")}</code></div>`).join("") : '<div class="empty-state">Nenhum convite pendente.</div>';
    }

    async function createInviteAluguel() {
        try {
            const data = await invokeConvitesAluguel({
                action: "criar_convite",
                carteira_id: carteiraId,
                display_name: $("inviteAluguelNameInput").value,
                cpf: $("inviteAluguelCpfInput").value.trim() || null,
                papel: $("inviteAluguelRoleInput").value,
                percentual_comissao: $("inviteAluguelPercentualInput").value || null
            });
            await loadCorretores();
            $("inviteAluguelResult").innerHTML = `Código: <strong>${h(data.convite.token)}</strong><br><small>Envie este código somente à pessoa autorizada.</small>`;
            $("inviteAluguelResult").hidden = false;
        } catch (error) {
            showMessage($("inviteAluguelResult"), traduzErro(error.message));
        }
    }

    async function createDirectUserAluguel() {
        const validadeRaw = $("directAluguelExpiryInput").value;
        try {
            const data = await invokeConvitesAluguel({
                action: "criar_usuario_direto",
                carteira_id: carteiraId,
                display_name: $("directAluguelNameInput").value,
                cpf: $("directAluguelCpfInput").value.trim() || null,
                email: $("directAluguelEmailInput").value,
                password: $("directAluguelPasswordInput").value,
                papel: $("directAluguelRoleInput").value,
                percentual_comissao: $("directAluguelPercentualInput").value || null,
                validade_horas: validadeRaw ? Number(validadeRaw) : null
            });
            await loadCorretores();
            const aviso = data.reused_existing_account ? " Esse e-mail já tinha conta em outra base SKL — vinculamos o acesso a esta carteira usando a senha que a pessoa já usa." : "";
            showMessage($("directUserAluguelMessage"), (data.expira_em ? `Acesso criado — expira em ${formatDate(data.expira_em)}.` : "Acesso criado sem prazo de validade.") + aviso, true);
            $("directAluguelNameInput").value = "";
            $("directAluguelCpfInput").value = "";
            $("directAluguelEmailInput").value = "";
            $("directAluguelPasswordInput").value = "";
        } catch (error) {
            showMessage($("directUserAluguelMessage"), traduzErro(error.message));
        }
    }

    async function toggleCorretorStatus(userId, nextActive) {
        const acao = nextActive ? "reativar" : "desativar";
        if (!confirm(`Confirma ${acao} o acesso deste usuário?`)) return;
        try {
            await invokeConvitesAluguel({ action: "alternar_status_usuario", carteira_id: carteiraId, usuario_id: userId, ativo: nextActive });
            await loadCorretores();
            toast(nextActive ? "Acesso reativado." : "Acesso desativado.");
        } catch (error) {
            toast(traduzErro(error.message));
        }
    }

    function openResetPasswordAluguel(userId) {
        pendingResetUserAluguelId = userId;
        $("resetPasswordAluguelInput").value = "";
        $("resetPasswordAluguelMessage").hidden = true;
        $("resetPasswordAluguelDialog").showModal();
    }

    async function confirmResetPasswordAluguel() {
        const novaSenha = $("resetPasswordAluguelInput").value;
        if (!novaSenha || novaSenha.length < 6) return showMessage($("resetPasswordAluguelMessage"), "A senha deve ter pelo menos 6 caracteres.");
        try {
            await invokeConvitesAluguel({ action: "redefinir_senha_admin", carteira_id: carteiraId, usuario_id: pendingResetUserAluguelId, nova_senha: novaSenha });
            $("resetPasswordAluguelDialog").close();
            toast("Senha redefinida com sucesso.");
        } catch (error) {
            showMessage($("resetPasswordAluguelMessage"), traduzErro(error.message));
        }
    }

    function openRemoveUserAluguel(userId, displayName) {
        pendingRemoveUserAluguel = { id: userId, name: displayName };
        $("removeUserAluguelName").textContent = displayName;
        $("removeUserAluguelMessage").hidden = true;
        $("removeUserAluguelDialog").showModal();
    }

    async function confirmRemoveUserAluguel() {
        if (!pendingRemoveUserAluguel) return;
        try {
            await invokeConvitesAluguel({ action: "remover_acesso_usuario", carteira_id: carteiraId, usuario_id: pendingRemoveUserAluguel.id });
            await loadCorretores();
            $("removeUserAluguelDialog").close();
            toast("Acesso removido desta carteira.");
        } catch (error) {
            showMessage($("removeUserAluguelMessage"), traduzErro(error.message));
        }
    }

    function openEditPercentual(userId) {
        const user = corretores.find(u => u.id === userId);
        if (!user) return;
        pendingEditPercentual = userId;
        $("editPercentualInput").value = user.percentual_comissao ?? "";
        $("editPercentualMessage").hidden = true;
        $("editPercentualDialog").showModal();
    }

    async function confirmEditPercentual() {
        try {
            const valor = $("editPercentualInput").value === "" ? null : Number($("editPercentualInput").value);
            const { error } = await sb.rpc("atualizar_percentual_comissao_corretor", {
                p_carteira_id: carteiraId, p_usuario_id: pendingEditPercentual, p_percentual: valor
            });
            if (error) throw error;
            await loadCorretores();
            $("editPercentualDialog").close();
            toast("Percentual de comissão atualizado.");
        } catch (error) {
            showMessage($("editPercentualMessage"), traduzErro(error.message));
        }
    }

    // ===== Comissões de aluguel =====

    const COMISSAO_STATUS_LABEL = { pendente: "Pendente", aprovada: "Aprovada", paga: "Paga", cancelada: "Cancelada" };

    function comissaoStatusClass(status) {
        if (status === "paga") return "disponivel";
        if (status === "cancelada") return "alugado";
        if (status === "aprovada") return "reservado";
        return "indisponivel";
    }

    async function loadComissoesAluguel() {
        const { data, error } = await sb.from("comissoes_aluguel").select("*").eq("carteira_id", carteiraId).order("criado_em", { ascending: false });
        if (error) { toast(traduzErro(error.message)); return; }
        comissoesAluguel = data || [];
        renderComissoesAluguel();
    }

    function renderComissoesAluguel() {
        $("comissaoAluguelTableEmpty").hidden = comissoesAluguel.length > 0;
        $("comissaoAluguelTableBody").innerHTML = comissoesAluguel.map(c => `<tr>
        <td><strong>${h(c.corretor_nome || "—")}</strong></td>
        <td>${c.valor_aluguel != null ? "R$ " + Number(c.valor_aluguel).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—"}</td>
        <td>${c.percentual != null ? h(c.percentual) + "%" : "—"}</td>
        <td>${c.valor_comissao != null ? "R$ " + Number(c.valor_comissao).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—"}</td>
        <td><span class="status-pill ${comissaoStatusClass(c.status)}">${h(COMISSAO_STATUS_LABEL[c.status] || c.status)}</span></td>
        <td style="display:flex;gap:6px">${c.status === "pendente" ? `<button class="row-button" data-comissao-approve="${h(c.id)}">Aprovar</button>` : ""}${c.status !== "paga" && c.status !== "cancelada" ? `<button class="row-button" data-comissao-pay="${h(c.id)}">Marcar paga</button>` : ""}</td>
      </tr>`).join("");
        $("comissaoAluguelTableBody").querySelectorAll("[data-comissao-approve]").forEach(button => button.addEventListener("click", () => updateComissaoAluguelStatus(button.dataset.comissaoApprove, "aprovada")));
        $("comissaoAluguelTableBody").querySelectorAll("[data-comissao-pay]").forEach(button => button.addEventListener("click", () => updateComissaoAluguelStatus(button.dataset.comissaoPay, "paga")));
    }

    async function updateComissaoAluguelStatus(id, status) {
        const payload = { status };
        if (status === "paga") payload.pago_em = new Date().toISOString();
        const { error } = await sb.from("comissoes_aluguel").update(payload).eq("id", id);
        if (error) { toast(traduzErro(error.message)); return; }
        await loadComissoesAluguel();
        toast("Comissão atualizada.");
    }

    function openComissaoAluguelDialog() {
        const elegiveis = corretores.filter(u => u.papel === "corretor");
        $("comissaoAluguelCorretorInput").innerHTML = elegiveis.map(u => `<option value="${h(u.id)}" data-percentual="${u.percentual_comissao ?? ""}">${h(u.display_name)}</option>`).join("") || '<option value="">Nenhum corretor cadastrado</option>';
        $("comissaoAluguelValorInput").value = "";
        $("comissaoAluguelPercentualInput").value = elegiveis[0]?.percentual_comissao ?? "";
        $("comissaoAluguelValorComissaoInput").value = "";
        $("comissaoAluguelObservacaoInput").value = "";
        $("comissaoAluguelMessage").hidden = true;
        $("comissaoAluguelDialog").showModal();
    }

    async function saveComissaoAluguel() {
        const corretorId = $("comissaoAluguelCorretorInput").value;
        const corretor = corretores.find(u => u.id === corretorId);
        if (!corretorId) return showMessage($("comissaoAluguelMessage"), "Selecione um corretor.");
        const valorAluguel = $("comissaoAluguelValorInput").value ? Number($("comissaoAluguelValorInput").value.replace(/[^\d.,]/g, "").replace(",", ".")) : null;
        const percentual = $("comissaoAluguelPercentualInput").value ? Number($("comissaoAluguelPercentualInput").value) : null;
        let valorComissao = $("comissaoAluguelValorComissaoInput").value ? Number($("comissaoAluguelValorComissaoInput").value) : null;
        if (valorComissao == null && valorAluguel != null && percentual != null) valorComissao = Math.round(valorAluguel * percentual) / 100;
        try {
            const { error } = await sb.from("comissoes_aluguel").insert({
                carteira_id: carteiraId,
                corretor_id: corretorId,
                corretor_nome: corretor?.display_name || null,
                valor_aluguel: valorAluguel,
                percentual: percentual,
                valor_comissao: valorComissao,
                observacao: $("comissaoAluguelObservacaoInput").value.trim() || null
            });
            if (error) throw error;
            await loadComissoesAluguel();
            $("comissaoAluguelDialog").close();
            toast("Comissão registrada.");
        } catch (error) {
            showMessage($("comissaoAluguelMessage"), traduzErro(error.message));
        }
    }
})();
