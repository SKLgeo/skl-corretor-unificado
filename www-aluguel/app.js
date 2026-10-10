(() => {
    "use strict";
    const $ = id => document.getElementById(id);

    const STATUS = {
        disponivel: "Disponível",
        reservado: "Reservado",
        alugado: "Alugado",
        em_negociacao: "Em negociação",
        vendido: "Vendido",
        indisponivel: "Indisponível"
    };
    const STATUS_COLOR = {
        disponivel: "#2f8a56",
        alugado: "#bd5147",
        reservado: "#d59a22",
        em_negociacao: "#7d5bc4",
        vendido: "#56636b",
        indisponivel: "#477fa4"
    };
    // Situações por finalidade: "reservado"/"alugado" só existem no aluguel; "em_negociacao"/"vendido" só na venda.
    const STATUS_ALUGUEL = [ "disponivel", "reservado", "alugado", "indisponivel" ];
    const STATUS_VENDA = [ "disponivel", "em_negociacao", "vendido", "indisponivel" ];
    // O corretor não vê imóvel que já saiu do mercado (só a Central).
    const STATUS_OCULTOS_CORRETOR = [ "alugado", "vendido", "indisponivel" ];
    const APROVACAO = { rascunho: "Rascunho", pendente: "Aguardando aprovação", aprovado: "Aprovado", recusado: "Recusado" };
    // Características por tipo de imóvel: comercial não fala em quartos nem garagem; terreno só área.
    // A mesma classificação está no banco (categoria_imovel), que vale na nota de qualidade.
    const TIPOS_RESIDENCIAIS = [ "Casa", "Casa de condomínio", "Sobrado", "Apartamento", "Cobertura", "Kitnet/Studio", "Chácara/Sítio" ];
    const TIPOS_COMERCIAIS = [ "Sala comercial", "Ponto comercial", "Galpão" ];
    const CARACTERISTICAS_POR_CATEGORIA = {
        residencial: [ "area", "quartos", "suites", "banheiros", "vagas" ],
        comercial: [ "area", "salas", "banheiros" ],
        terreno: [ "area" ],
        outro: [ "area", "salas", "quartos", "banheiros", "vagas" ]
    };
    const ROLE = {
        corretor: "Corretor",
        central_vendas: "Controle de aluguéis",
        administrador: "Administrador"
    };

    const SUPABASE_URL = "https://xigwlofqkmiibzbongkn.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_mqppAm9n79xl6rYafzXyNQ_mGVoX3Vd";
    const APP_VERSION = "0.4.1";
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

    let finalidadeFiltro = "todos";
    let bairrosFiltro = [];
    let faixaValor = null;
    let notaMinimaCadastro = null;
    let modoDialogo = "leitura";

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
            definirFinalidadeFiltro("todos");
            $("construcaoStatusFilter").value = button.dataset.status;
            showPage("construcoes");
            renderConstrucoes();
        }));
        $("finalidadeFiltro").querySelectorAll("[data-finalidade]").forEach(button => {
            button.addEventListener("click", () => { definirFinalidadeFiltro(button.dataset.finalidade); renderConstrucoes(); });
        });
        $("construcaoSearchInput").addEventListener("input", renderConstrucoes);
        $("construcaoStatusFilter").addEventListener("change", renderConstrucoes);
        $("bairroFiltroInput").addEventListener("change", adicionarBairroFiltro);
        $("bairroFiltroInput").addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); adicionarBairroFiltro(); }
        });
        $("valorMinRange").addEventListener("input", () => aoMoverFaixa("min"));
        $("valorMaxRange").addEventListener("input", () => aoMoverFaixa("max"));
        $("limparFiltrosButton").addEventListener("click", limparFiltros);
        $("toggleConstrucaoViewButton").addEventListener("click", toggleConstrucaoView);
        $("newConstrucaoButton").addEventListener("click", () => openConstrucaoDialog(null));
        $("novoCadastroButton").addEventListener("click", () => openConstrucaoDialog(null));
        $("cadastrosFiltro").addEventListener("change", renderCadastros);
        $("saveConstrucaoButton").addEventListener("click", () => salvarImovel());
        $("enviarCadastroButton").addEventListener("click", () => salvarImovel({ enviar: true }));
        $("aprovarCadastroButton").addEventListener("click", () => salvarImovel({ aprovar: true }));
        $("recusarCadastroButton").addEventListener("click", abrirRecusarCadastro);
        $("confirmRecusarButton").addEventListener("click", confirmarRecusarCadastro);
        $("salvarNotaMinimaButton").addEventListener("click", salvarNotaMinima);
        $("finalidadeAluguelInput").addEventListener("change", atualizarCamposFinalidade);
        $("finalidadeVendaInput").addEventListener("change", atualizarCamposFinalidade);
        $("condominioTipoInput").addEventListener("change", atualizarCamposCusto);
        $("construcaoTipoInput").addEventListener("change", atualizarCamposCaracteristicas);
        $("iptuTipoInput").addEventListener("change", atualizarCamposCusto);
        $("ufInput").addEventListener("input", () => { $("ufInput").value = $("ufInput").value.toUpperCase(); });
        $("formEdicao").addEventListener("input", atualizarQualidade);
        $("formEdicao").addEventListener("change", atualizarQualidade);
        document.addEventListener("visibilitychange", aoVoltarParaOApp);
        window.addEventListener("online", aoVoltarParaOApp);
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
    function aprovacaoPill(aprovacao) {
        return `<span class="status-pill aprov-${h(aprovacao)}">${h(APROVACAO[aprovacao] || aprovacao)}</span>`;
    }
    function podeGerenciar() {
        return !!currentUser && [ "administrador", "central_vendas" ].includes(currentUser.papel);
    }
    function formatMoney(valor, casas = 2) {
        if (valor == null || valor === "") return "—";
        return "R$ " + Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    }
    function precoCurto(valor) {
        return formatMoney(valor, Number(valor) % 1 ? 2 : 0);
    }
    // Aceita "R$ 1.234,56", "1234,56", "1234.56" e "450.000" (milhar com ponto).
    function parseValor(texto) {
        let s = String(texto == null ? "" : texto).replace(/[^\d.,]/g, "");
        if (!s) return null;
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
    }
    function numeroOuNulo(valor) {
        if (valor === "" || valor == null) return null;
        const n = Number(valor);
        return Number.isFinite(n) ? n : null;
    }
    function normalizar(texto) {
        return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    }
    function estrelasTexto(estrelas) {
        return "★".repeat(estrelas) + "☆".repeat(5 - estrelas);
    }
    function finalidadeTexto(c) {
        if (c.para_venda && c.para_aluguel !== false) return "Venda e aluguel";
        return c.para_venda ? "Venda" : "Aluguel";
    }
    function categoriaImovel(tipo) {
        if (TIPOS_RESIDENCIAIS.includes(tipo)) return "residencial";
        if (TIPOS_COMERCIAIS.includes(tipo)) return "comercial";
        return tipo === "Terreno" ? "terreno" : "outro";
    }
    function caracteristicasCompletas(c) {
        const preenchido = v => v != null && v !== "";
        if (!(Number(c.area_m2) > 0)) return false;
        const categoria = categoriaImovel(c.tipo_imovel);
        if (categoria === "residencial") return preenchido(c.quartos) && preenchido(c.banheiros) && preenchido(c.vagas);
        if (categoria === "comercial") return preenchido(c.salas) && preenchido(c.banheiros);
        if (categoria === "terreno") return true;
        return preenchido(c.banheiros);
    }
    function rotuloCaracteristicas(tipo) {
        return {
            residencial: "características (área, quartos, banheiros e vagas)",
            comercial: "características (área, salas e banheiros)",
            terreno: "área do terreno",
            outro: "características (área e banheiros)"
        }[categoriaImovel(tipo)];
    }
    function enderecoTexto(c) {
        const cidadeUf = [ c.cidade, c.uf ].filter(Boolean).join("-");
        const partes = [ c.logradouro, c.numero, c.complemento, c.bairro, cidadeUf ].filter(Boolean);
        return partes.length ? partes.join(", ") : (c.endereco || "");
    }

    // Nota de qualidade do cadastro: 10 itens de 10%, 20% por estrela. A mesma regra está no banco
    // (função qualidade_imovel), que é quem vale na hora de enviar para aprovação.
    function qualidadeImovel(c, totalFotos) {
        const vazio = v => !String(v == null ? "" : v).trim();
        const fotos = totalFotos != null ? totalFotos : (c.fotos || []).length;
        const custoOk = (tipo, valor) => !!tipo && (tipo !== "valor" || valor != null);
        const itens = [
            [ !vazio(c.tipo_imovel), "tipo do imóvel" ],
            [ !vazio(c.bairro), "bairro" ],
            [ !vazio(c.logradouro) && !vazio(c.numero) && !vazio(c.cidade), "endereço completo (rua, número e cidade)" ],
            [ c.latitude != null && c.longitude != null, "localização no mapa" ],
            [ (c.para_aluguel === false || Number(c.valor_aluguel) > 0) && (!c.para_venda || Number(c.valor_venda) > 0), "valor" ],
            [ custoOk(c.condominio_tipo, c.valor_condominio) && custoOk(c.iptu_tipo, c.valor_iptu), "condomínio e IPTU" ],
            [ String(c.descricao || "").trim().length >= 150, "descrição com 150 caracteres ou mais" ],
            [ fotos >= 3, "pelo menos 3 fotos" ],
            [ fotos >= 8, "8 fotos ou mais" ],
            [ caracteristicasCompletas(c), rotuloCaracteristicas(c.tipo_imovel) ]
        ];
        const pct = itens.filter(([ ok ]) => ok).length * 10;
        return { pct, estrelas: Math.floor(pct / 20), faltando: itens.filter(([ ok ]) => !ok).map(([ , rotulo ]) => rotulo) };
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
        if (message && message.includes("construcoes_codigo_uk")) return "Já existe um imóvel com esse código nesta carteira.";
        // Erros das funções do banco vêm como "CODIGO: explicação em português".
        const comCodigo = message && message.match(/^[A-Z_]{4,}: (.+)$/);
        if (comCodigo) return comCodigo[1].charAt(0).toUpperCase() + comCodigo[1].slice(1);
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

    // O CRM (crm.js) recebe daqui o que precisa; ele mesmo cuida de clientes, negociações e agenda.
    function contextoCrm() {
        return {
            sb, h, toast, traduzErro, parseValor, nomeDoUsuario, fotoDoUsuario,
            carteiraId: () => carteiraId,
            usuario: () => currentUser,
            central: () => podeGerenciar(),
            imoveis: () => [ ...construcoes.values() ],
            equipe: () => corretores,
            tiposImovel: () => [ ...$("construcaoTipoInput").options ].map(o => o.value),
            abrirImovel: id => { const c = construcoes.get(id); if (c) openConstrucaoDialog(c); }
        };
    }

    async function enterApp() {
        $("loginView").hidden = true;
        $("appView").hidden = false;
        $("currentUserName").textContent = currentUser.display_name;
        iniciarFotoPerfil();
        $("currentUserRole").textContent = ROLE[currentUser.papel] || currentUser.papel;
        const gerencia = podeGerenciar();
        $("newConstrucaoButton").hidden = !gerencia;
        $("navInteresses").hidden = !gerencia;
        $("navCorretores").hidden = !gerencia;
        $("navComissoes").hidden = !gerencia;
        $("navCadastrosTexto").textContent = gerencia ? "Cadastros" : "Meus cadastros";
        $("cadastrosFiltro").hidden = !gerencia;
        $("novoCadastroButton").hidden = gerencia;
        $("cadastrosIntro").textContent = gerencia
            ? "Imóveis cadastrados pelos corretores. Revise, corrija o que precisar e aprove para o imóvel aparecer para toda a equipe."
            : "Cadastre imóveis para venda ou aluguel. A Central revisa e, depois de aprovado, o imóvel aparece para todos os corretores.";
        $("settingsCadastroPanel").hidden = !gerencia;
        document.querySelectorAll("[data-so-central]").forEach(el => { el.hidden = !gerencia; });
        $("dashboardCarteiraNome").textContent = carteiraNomeAtual;
        $("settingsCarteiraNome").textContent = carteiraNomeAtual;
        finalidadeFiltro = "todos";
        bairrosFiltro = [];
        faixaValor = null;
        await carregarConfigCarteira();
        if (gerencia) await loadCorretores();
        await loadConstrucoes();
        if (gerencia) {
            await loadInteresses();
            await loadComissoesAluguel();
        }
        connectRealtime();
        if (window.SKLCRM) await window.SKLCRM.iniciar(contextoCrm());
        showPage("dashboard");
    }

    function logout() {
        if (window.SKLCRM) window.SKLCRM.sair();
        sb.auth.signOut();
        carteiraId = null;
        currentUser = null;
        construcoes.clear();
        if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
        if (conferenciaTimer) { clearInterval(conferenciaTimer); conferenciaTimer = null; }
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
        const titles = {
            dashboard: "Visão geral", negociacoes: "Negociações", agenda: "Agenda", indicadores: "Indicadores", clientes: "Clientes", construcoes: "Imóveis", interesses: "Interesses", corretores: "Corretores", comissoes: "Comissões",
            settings: "Configurações", cadastros: podeGerenciar() ? "Cadastros dos corretores" : "Meus cadastros"
        };
        $("pageTitle").textContent = titles[page] || page;
        if (page === "construcoes" && mapaVisivel) setTimeout(() => { ensureMap(); map && map.invalidateSize(); }, 60);
        if (window.SKLCRM) window.SKLCRM.aoMostrar(page);
    }

    // ===== Dados =====

    async function carregarConfigCarteira() {
        notaMinimaCadastro = null;
        const { data } = await sb.from("carteiras_aluguel").select("nota_minima_cadastro").eq("id", carteiraId).maybeSingle();
        notaMinimaCadastro = data?.nota_minima_cadastro ?? null;
        $("notaMinimaSelect").value = notaMinimaCadastro == null ? "" : String(notaMinimaCadastro);
    }

    async function salvarNotaMinima() {
        const valor = $("notaMinimaSelect").value;
        $("salvarNotaMinimaButton").disabled = true;
        try {
            const { error } = await sb.rpc("configurar_cadastro_imoveis", { p_carteira_id: carteiraId, p_nota_minima: valor === "" ? null : Number(valor) });
            if (error) throw error;
            notaMinimaCadastro = valor === "" ? null : Number(valor);
            toast(notaMinimaCadastro ? `Agora o corretor precisa de ${notaMinimaCadastro} estrela(s) para enviar.` : "Nota mínima desativada.");
        } catch (error) {
            toast(traduzErro(error.message));
        } finally {
            $("salvarNotaMinimaButton").disabled = false;
        }
    }

    async function loadConstrucoes(silencioso = false) {
        const { data, error } = await sb.from("construcoes").select("*").eq("carteira_id", carteiraId).order("updated_at", { ascending: false });
        if (error) { if (!silencioso) toast(traduzErro(error.message)); return; }
        construcoes.clear();
        (data || []).forEach(c => construcoes.set(c.id, c));
        atualizarTudo();
        $("connectionBadge").textContent = "Conectado";
        $("connectionBadge").classList.remove("offline");
        $("connectionBadge").classList.add("online");
        $("syncTime").textContent = `Sincronizado às ${new Date().toLocaleTimeString("pt-BR")}`;
    }

    function atualizarTudo() {
        updateMetrics();
        atualizarListaBairros();
        renderConstrucoes();
        renderDashboardRecentes();
        renderCadastros();
    }

    // No Android, com o app em segundo plano o WebView "adormece" o Realtime e perde avisos (cadastro enviado,
    // aprovado, recusado — visto no tablet em 07/10/2026). Ao voltar para o app e a cada 60 s, recarrega os imóveis.
    let conferenciaTimer = null;
    async function sincronizarDeNovo() {
        if (!carteiraId || !currentUser || document.visibilityState !== "visible") return;
        const antes = new Map(construcoes);
        await loadConstrucoes(true);
        construcoes.forEach((c, id) => avisarMudancaDoMeuCadastro(antes.get(id), c));
    }
    function aoVoltarParaOApp() {
        if (!carteiraId || !currentUser || document.visibilityState !== "visible") return;
        sincronizarDeNovo();
        if (podeGerenciar()) loadInteresses();
        connectRealtime();
        if (window.SKLCRM) window.SKLCRM.recarregar();
    }

    function connectRealtime() {
        if (!conferenciaTimer) conferenciaTimer = setInterval(sincronizarDeNovo, 60000);
        if (realtimeChannel) sb.removeChannel(realtimeChannel);
        realtimeChannel = sb.channel(`construcoes-${carteiraId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "construcoes", filter: `carteira_id=eq.${carteiraId}` }, payload => {
                if (payload.eventType === "DELETE") {
                    construcoes.delete(payload.old.id);
                } else {
                    avisarMudancaDoMeuCadastro(construcoes.get(payload.new.id), payload.new);
                    construcoes.set(payload.new.id, payload.new);
                }
                atualizarTudo();
            })
            .subscribe();
    }

    function avisarMudancaDoMeuCadastro(antes, depois) {
        if (!antes || !currentUser || depois.cadastrado_por !== currentUser.id || antes.aprovacao === depois.aprovacao) return;
        if (depois.aprovacao === "aprovado") toast(`Seu cadastro "${depois.nome}" foi aprovado e já aparece para todos.`);
        if (depois.aprovacao === "recusado") toast(`Seu cadastro "${depois.nome}" foi recusado. Veja o motivo em Meus cadastros.`);
    }

    // Imóveis que entram na busca: só os aprovados; para o corretor, sem os que já saíram do mercado.
    function imovelVisivelNaBusca(c) {
        if ((c.aprovacao || "aprovado") !== "aprovado") return false;
        return podeGerenciar() || !STATUS_OCULTOS_CORRETOR.includes(c.status);
    }
    function baseBusca() {
        return [ ...construcoes.values() ].filter(imovelVisivelNaBusca);
    }
    function passaFinalidade(c) {
        if (finalidadeFiltro === "aluguel") return c.para_aluguel !== false;
        if (finalidadeFiltro === "venda") return !!c.para_venda;
        return true;
    }
    function valorNaFinalidade(c) {
        const v = finalidadeFiltro === "venda" ? c.valor_venda : c.valor_aluguel;
        return v == null || v === "" ? null : Number(v);
    }

    function updateMetrics() {
        const contagem = { disponivel: 0, reservado: 0, alugado: 0, em_negociacao: 0, vendido: 0, indisponivel: 0 };
        baseBusca().forEach(c => { if (contagem[c.status] != null) contagem[c.status]++; });
        $("metricDisponivel").textContent = contagem.disponivel;
        $("metricReservado").textContent = contagem.reservado;
        $("metricEmNegociacao").textContent = contagem.em_negociacao;
        $("metricAlugado").textContent = contagem.alugado;
        $("metricVendido").textContent = contagem.vendido;
        $("metricIndisponivel").textContent = contagem.indisponivel;
    }

    function renderDashboardRecentes() {
        const recentes = baseBusca().slice(0, 5);
        $("dashboardRecentes").innerHTML = recentes.length ? recentes.map(c => `
      <div class="compact-item"><div><strong>${h(c.nome)}</strong><br><small>${h([ c.codigo && "Cód. " + c.codigo, finalidadeTexto(c), c.bairro ].filter(Boolean).join(" · "))}</small></div>${statusPill(c.status)}</div>
    `).join("") : `<p class="muted-text">Nenhum imóvel cadastrado ainda.</p>`;
    }

    // ===== Busca: finalidade, bairros (até 3), faixa de valor, situação =====

    function definirFinalidadeFiltro(finalidade) {
        finalidadeFiltro = finalidade;
        $("finalidadeFiltro").querySelectorAll("[data-finalidade]").forEach(b => b.classList.toggle("ativo", b.dataset.finalidade === finalidade));
        faixaValor = null;
        montarOpcoesStatusFiltro();
    }

    function statusDaFinalidade(finalidade) {
        if (finalidade === "aluguel") return STATUS_ALUGUEL;
        if (finalidade === "venda") return STATUS_VENDA;
        return Object.keys(STATUS);
    }

    function montarOpcoesStatusFiltro() {
        const select = $("construcaoStatusFilter");
        const atual = select.value;
        const lista = statusDaFinalidade(finalidadeFiltro).filter(s => podeGerenciar() || !STATUS_OCULTOS_CORRETOR.includes(s));
        select.innerHTML = `<option value="">Todas as situações</option>` + lista.map(s => `<option value="${s}">${h(STATUS[s])}</option>`).join("");
        select.value = lista.includes(atual) ? atual : "";
        $("mapLegend").innerHTML = lista.map(s => `<span class="dot ${s}"></span>${h(STATUS[s])}`).join(" ");
    }

    function atualizarListaBairros() {
        const vistos = new Map();
        [ ...construcoes.values() ].forEach(c => {
            const b = String(c.bairro || "").trim();
            if (b && !vistos.has(normalizar(b))) vistos.set(normalizar(b), b);
        });
        const nomes = [ ...vistos.values() ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        $("bairrosLista").innerHTML = nomes.map(n => `<option value="${h(n)}"></option>`).join("");
        return nomes;
    }

    function adicionarBairroFiltro() {
        const input = $("bairroFiltroInput");
        const texto = input.value.trim();
        if (!texto) return;
        const encontrado = atualizarListaBairros().find(n => normalizar(n) === normalizar(texto));
        if (!encontrado) { toast("Bairro não encontrado entre os imóveis cadastrados."); return; }
        if (bairrosFiltro.some(b => normalizar(b) === normalizar(encontrado))) { input.value = ""; return; }
        if (bairrosFiltro.length >= 3) { toast("Escolha no máximo 3 bairros."); return; }
        bairrosFiltro.push(encontrado);
        input.value = "";
        renderConstrucoes();
    }

    function renderChipsBairro() {
        $("bairroChips").innerHTML = bairrosFiltro.map((b, i) => `<span class="bairro-chip">${h(b)}<button type="button" data-remover-bairro="${i}" aria-label="Remover ${h(b)}">×</button></span>`).join("");
        $("bairroChips").querySelectorAll("[data-remover-bairro]").forEach(button => button.addEventListener("click", () => {
            bairrosFiltro.splice(Number(button.dataset.removerBairro), 1);
            renderConstrucoes();
        }));
        const cheio = bairrosFiltro.length >= 3;
        $("bairroFiltroInput").disabled = cheio;
        $("bairroFiltroInput").placeholder = cheio ? "Máximo de 3 bairros" : (bairrosFiltro.length ? "Mais um bairro" : "Bairro (até 3)");
    }

    // Faixa de valor: a escala sai do menor e do maior valor cadastrado na finalidade escolhida
    // (aluguel e venda têm escalas muito diferentes, por isso não existe faixa no modo "Todos").
    function atualizarFaixaValor(candidatos) {
        const box = $("faixaValorBox");
        $("faixaValorDica").hidden = finalidadeFiltro !== "todos";
        if (finalidadeFiltro === "todos") { box.hidden = true; faixaValor = null; return; }
        const valores = candidatos.map(valorNaFinalidade).filter(v => v != null && v > 0);
        if (valores.length < 2 || Math.min(...valores) === Math.max(...valores)) { box.hidden = true; faixaValor = null; return; }
        const passo = finalidadeFiltro === "venda" ? 5000 : 50;
        const limMin = Math.floor(Math.min(...valores) / passo) * passo;
        const limMax = Math.ceil(Math.max(...valores) / passo) * passo;
        if (!faixaValor || faixaValor.limMin !== limMin || faixaValor.limMax !== limMax) {
            const antigo = faixaValor;
            faixaValor = { limMin, limMax, min: limMin, max: limMax };
            if (antigo) {
                faixaValor.min = Math.min(Math.max(antigo.min, limMin), limMax);
                faixaValor.max = Math.max(Math.min(antigo.max, limMax), faixaValor.min);
            }
        }
        [ $("valorMinRange"), $("valorMaxRange") ].forEach(r => { r.min = limMin; r.max = limMax; r.step = passo; });
        $("valorMinRange").value = faixaValor.min;
        $("valorMaxRange").value = faixaValor.max;
        box.hidden = false;
        desenharFaixa();
    }

    function desenharFaixa() {
        if (!faixaValor) return;
        const total = faixaValor.limMax - faixaValor.limMin || 1;
        const ini = (faixaValor.min - faixaValor.limMin) / total * 100;
        const fim = (faixaValor.max - faixaValor.limMin) / total * 100;
        // a bolinha (22px) percorre a largura menos o próprio tamanho
        $("faixaValorPreenchido").style.left = `calc(11px + (100% - 22px) * ${ini / 100})`;
        $("faixaValorPreenchido").style.width = `calc((100% - 22px) * ${(fim - ini) / 100})`;
        $("faixaValorRotulo").textContent = finalidadeFiltro === "venda" ? "Valor de venda" : "Valor do aluguel";
        $("faixaValorTexto").textContent = `${precoCurto(faixaValor.min)} até ${precoCurto(faixaValor.max)}`;
    }

    function aoMoverFaixa(qual) {
        if (!faixaValor) return;
        let min = Number($("valorMinRange").value);
        let max = Number($("valorMaxRange").value);
        if (min > max) { if (qual === "min") min = max; else max = min; }
        $("valorMinRange").value = min;
        $("valorMaxRange").value = max;
        faixaValor.min = min;
        faixaValor.max = max;
        desenharFaixa();
        renderConstrucoes();
    }

    function faixaAtiva() {
        return !!faixaValor && (faixaValor.min > faixaValor.limMin || faixaValor.max < faixaValor.limMax);
    }

    function limparFiltros() {
        bairrosFiltro = [];
        faixaValor = null;
        $("construcaoSearchInput").value = "";
        $("bairroFiltroInput").value = "";
        definirFinalidadeFiltro("todos");
        renderConstrucoes();
    }

    function filteredConstrucoes() {
        const termo = normalizar($("construcaoSearchInput").value);
        const status = $("construcaoStatusFilter").value;
        const bairros = bairrosFiltro.map(normalizar);
        const porFinalidade = baseBusca().filter(passaFinalidade);
        atualizarFaixaValor(porFinalidade);
        const usarFaixa = faixaAtiva();
        return porFinalidade.filter(c => {
            if (status && c.status !== status) return false;
            if (bairros.length && !bairros.includes(normalizar(c.bairro))) return false;
            if (usarFaixa) {
                const v = valorNaFinalidade(c);
                if (v == null || v < faixaValor.min || v > faixaValor.max) return false;
            }
            if (termo) {
                const texto = normalizar([ c.nome, c.codigo, c.edificio, c.bairro, enderecoTexto(c), c.tipo_imovel ].join(" "));
                if (!texto.includes(termo)) return false;
            }
            return true;
        });
    }

    function precoCard(c) {
        const aluguel = c.para_aluguel !== false && c.valor_aluguel ? `${precoCurto(c.valor_aluguel)}<small>aluguel/mês</small>` : "";
        const venda = c.para_venda && c.valor_venda ? `${precoCurto(c.valor_venda)}<small>venda</small>` : "";
        if (finalidadeFiltro === "aluguel") return aluguel || "—";
        if (finalidadeFiltro === "venda") return venda || "—";
        return [ venda, aluguel ].filter(Boolean).map(p => `<span>${p}</span>`).join("") || "—";
    }

    function specsResumo(c) {
        const campos = CARACTERISTICAS_POR_CATEGORIA[categoriaImovel(c.tipo_imovel)];
        const partes = [];
        if (Number(c.area_m2) > 0) partes.push(`📐 ${Number(c.area_m2).toLocaleString("pt-BR")} m²`);
        if (campos.includes("salas") && Number(c.salas) > 0) partes.push(`🚪 ${c.salas} ${c.salas == 1 ? "sala" : "salas"}`);
        if (campos.includes("quartos") && Number(c.quartos) > 0) partes.push(`🛏 ${c.quartos}`);
        if (campos.includes("banheiros") && Number(c.banheiros) > 0) partes.push(`🚿 ${c.banheiros}`);
        if (campos.includes("vagas") && Number(c.vagas) > 0) partes.push(`🚗 ${c.vagas}`);
        return partes.join(" · ");
    }

    function preencherFotoCapa(c, seletor) {
        const foto = (c.fotos || [])[0];
        if (!foto) return;
        resolveFotoUrl(foto.path).then(url => {
            const holder = document.querySelector(seletor);
            if (!holder || !url) return;
            holder.style.backgroundImage = `url("${url}")`;
            holder.querySelector(".sem-foto")?.remove();
        });
    }

    function renderConstrucoes() {
        if (!$("construcaoStatusFilter").options.length) montarOpcoesStatusFiltro();
        renderChipsBairro();
        const rows = filteredConstrucoes();
        const gerencia = podeGerenciar();
        $("buscaResultado").textContent = rows.length === 1 ? "1 imóvel encontrado" : `${rows.length} imóveis encontrados`;
        $("construcaoGridEmpty").hidden = rows.length > 0;
        $("construcaoGrid").innerHTML = rows.map(c => {
            const q = gerencia ? qualidadeImovel(c) : null;
            const specs = specsResumo(c);
            return `<article class="construcao-card" data-id="${h(c.id)}">
        <div class="construcao-card-photo" data-foto-holder="${h(c.id)}">${(c.fotos || []).length ? "" : `<span class="sem-foto">Sem foto</span>`}
          ${c.destaque ? `<span class="card-destaque">★ Destaque</span>` : ""}<span class="card-finalidade">${h(finalidadeTexto(c))}</span></div>
        <div class="construcao-card-body">
          <div class="card-topo"><small class="card-codigo">${c.codigo ? "Cód. " + h(c.codigo) : ""}</small>${q ? `<span class="card-estrelas" title="Qualidade do cadastro: ${q.pct}%">${estrelasTexto(q.estrelas)}</span>` : ""}</div>
          <h3>${h(c.nome)}</h3>
          <p>${h([ c.bairro, c.cidade ].filter(Boolean).join(" · ") || enderecoTexto(c) || "Endereço não informado")}</p>
          ${specs ? `<div class="card-specs">${specs}</div>` : ""}
          <div class="construcao-card-footer">${statusPill(c.status)}<span class="construcao-card-valor">${precoCard(c)}</span></div>
        </div>
      </article>`;
        }).join("");
        $("construcaoGrid").querySelectorAll("[data-id]").forEach(card => card.addEventListener("click", () => openConstrucaoDialog(construcoes.get(card.dataset.id))));
        rows.forEach(c => preencherFotoCapa(c, `[data-foto-holder="${CSS.escape(c.id)}"]`));
        if (mapaVisivel) { ensureMap(); renderMapMarkers(rows); }
    }

    // ===== Cadastros feitos pelos corretores (aprovação da Central) =====

    function nomeDoUsuario(id) {
        if (!id) return "—";
        if (currentUser && id === currentUser.id) return currentUser.display_name;
        return corretores.find(u => u.id === id)?.display_name || "usuário da equipe";
    }

    function renderCadastros() {
        if (!currentUser) return;
        const gerencia = podeGerenciar();
        let lista;
        if (gerencia) {
            const filtro = $("cadastrosFiltro").value || "pendente";
            const idsCorretores = new Set(corretores.filter(u => u.papel === "corretor").map(u => u.id));
            lista = [ ...construcoes.values() ].filter(c => filtro === "aprovado"
                ? c.aprovacao === "aprovado" && idsCorretores.has(c.cadastrado_por)
                : c.aprovacao === filtro);
            lista.sort((a, b) => String(b.enviado_em || b.updated_at).localeCompare(String(a.enviado_em || a.updated_at)));
        } else {
            lista = [ ...construcoes.values() ].filter(c => c.cadastrado_por && c.cadastrado_por === currentUser.id);
            lista.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        }
        const pendentes = [ ...construcoes.values() ].filter(c => c.aprovacao === "pendente").length;
        const recusadosMeus = [ ...construcoes.values() ].filter(c => c.aprovacao === "recusado" && c.cadastrado_por === currentUser.id).length;
        const badge = gerencia ? pendentes : recusadosMeus;
        $("navCadastrosBadge").hidden = !badge;
        $("navCadastrosBadge").textContent = badge;

        $("cadastrosVazio").hidden = lista.length > 0;
        $("cadastrosVazio").textContent = gerencia ? "Nenhum cadastro nesta situação." : "Você ainda não cadastrou nenhum imóvel. Toque em \"Cadastrar imóvel\" para começar.";
        $("cadastrosLista").innerHTML = lista.map(c => {
            const q = qualidadeImovel(c);
            const mostrarNota = gerencia || c.aprovacao !== "aprovado";
            const preco = [ c.para_venda && c.valor_venda ? "Venda " + precoCurto(c.valor_venda) : "", c.para_aluguel !== false && c.valor_aluguel ? "Aluguel " + precoCurto(c.valor_aluguel) : "" ].filter(Boolean).join(" · ");
            const linha2 = gerencia
                ? `${fotoDoUsuario(c.cadastrado_por, 24)} Corretor: ${h(nomeDoUsuario(c.cadastrado_por))}${c.enviado_em ? " · enviado em " + h(formatDate(c.enviado_em)) : ""}`
                : `Atualizado em ${h(formatDate(c.updated_at))}`;
            const acao = gerencia ? (c.aprovacao === "pendente" ? "Revisar" : "Abrir") : (c.aprovacao === "aprovado" ? "Ver" : "Editar");
            return `<article class="cadastro-item" data-abrir-cadastro="${h(c.id)}">
        <div class="cadastro-foto" data-cadastro-foto="${h(c.id)}"></div>
        <div class="cadastro-info">
          <strong>${h(c.nome)}</strong>
          <small>${h([ finalidadeTexto(c), c.bairro, preco ].filter(Boolean).join(" · "))}</small>
          <small>${linha2}</small>
          ${c.aprovacao === "recusado" && c.aprovacao_motivo ? `<p class="cadastro-motivo">Motivo da recusa: ${h(c.aprovacao_motivo)}</p>` : ""}
        </div>
        <div class="cadastro-lado">
          ${aprovacaoPill(c.aprovacao)}
          ${mostrarNota ? `<span class="card-estrelas" title="Qualidade do cadastro: ${q.pct}%">${estrelasTexto(q.estrelas)}</span>` : ""}
          <button type="button" class="secondary-button">${acao}</button>
        </div>
      </article>`;
        }).join("");
        $("cadastrosLista").querySelectorAll("[data-abrir-cadastro]").forEach(item => item.addEventListener("click", () => openConstrucaoDialog(construcoes.get(item.dataset.abrirCadastro))));
        lista.forEach(c => preencherFotoCapa(c, `[data-cadastro-foto="${CSS.escape(c.id)}"]`));
    }

    function abrirRecusarCadastro() {
        $("recusarMotivoInput").value = "";
        $("recusarMessage").hidden = true;
        $("recusarCadastroDialog").showModal();
    }

    async function confirmarRecusarCadastro() {
        const motivo = $("recusarMotivoInput").value.trim();
        if (!motivo) { showMessage($("recusarMessage"), "Informe o motivo para o corretor saber o que corrigir."); return; }
        $("confirmRecusarButton").disabled = true;
        try {
            const { data, error } = await sb.rpc("revisar_cadastro_imovel", { p_id: editandoId, p_aprovar: false, p_motivo: motivo });
            if (error) throw error;
            construcoes.set(data.id, data);
            atualizarTudo();
            $("recusarCadastroDialog").close();
            $("construcaoDialog").close();
            toast("Cadastro recusado. O corretor já pode ver o motivo.");
        } catch (error) {
            showMessage($("recusarMessage"), traduzErro(error.message));
        } finally {
            $("confirmRecusarButton").disabled = false;
        }
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

    // ===== Diálogo do imóvel =====
    // Três modos: "central" (central/admin edita qualquer imóvel), "corretor" (corretor cria ou edita o próprio
    // cadastro enquanto não foi aprovado) e "leitura" (corretor vendo um imóvel aprovado: ficha + interesse).

    function openConstrucaoDialog(construcao) {
        editandoId = construcao ? construcao.id : null;
        fotosExistentes = construcao ? [ ...(construcao.fotos || []) ] : [];
        fotosNovas = [];
        fotosRemovidas = [];
        heroIndex = 0;
        const gerencia = podeGerenciar();
        const meuEditavel = !!construcao && construcao.cadastrado_por === currentUser.id
            && [ "rascunho", "pendente", "recusado" ].includes(construcao.aprovacao);
        modoDialogo = gerencia ? "central" : (!construcao || meuEditavel ? "corretor" : "leitura");
        const leitura = modoDialogo === "leitura";

        $("construcaoDialogMessage").hidden = true;
        $("construcaoDialogEyebrow").textContent = construcao
            ? [ construcao.codigo ? "CÓD. " + construcao.codigo : "IMÓVEL", finalidadeTexto(construcao).toUpperCase() ].join(" · ")
            : (gerencia ? "NOVO IMÓVEL" : "NOVO CADASTRO");
        $("construcaoDialogTitle").textContent = leitura ? construcao.nome : (construcao ? (gerencia ? "Editar imóvel" : "Meu cadastro") : (gerencia ? "Novo imóvel" : "Cadastrar imóvel"));

        $("construcaoNomeInput").value = construcao?.nome || "";
        $("finalidadeAluguelInput").checked = construcao ? construcao.para_aluguel !== false : true;
        $("finalidadeVendaInput").checked = !!construcao?.para_venda;
        $("construcaoTipoInput").value = construcao?.tipo_imovel || "Casa";
        $("construcaoValorInput").value = construcao?.valor_aluguel != null ? formatMoney(construcao.valor_aluguel) : "";
        $("construcaoValorVendaInput").value = construcao?.valor_venda != null ? formatMoney(construcao.valor_venda) : "";
        $("construcaoCodigoInput").value = construcao?.codigo || "";
        $("construcaoEdificioInput").value = construcao?.edificio || "";
        $("condominioTipoInput").value = construcao?.condominio_tipo || "";
        $("condominioValorInput").value = construcao?.valor_condominio != null ? formatMoney(construcao.valor_condominio) : "";
        $("iptuTipoInput").value = construcao?.iptu_tipo || "";
        $("iptuValorInput").value = construcao?.valor_iptu != null ? formatMoney(construcao.valor_iptu) : "";
        $("areaInput").value = construcao?.area_m2 ?? "";
        $("salasInput").value = construcao?.salas ?? "";
        $("quartosInput").value = construcao?.quartos ?? "";
        $("suitesInput").value = construcao?.suites ?? "";
        $("banheirosInput").value = construcao?.banheiros ?? "";
        $("vagasInput").value = construcao?.vagas ?? "";
        $("cepInput").value = construcao?.cep || "";
        $("logradouroInput").value = construcao?.logradouro || "";
        $("numeroInput").value = construcao?.numero || "";
        $("complementoInput").value = construcao?.complemento || "";
        $("bairroInput").value = construcao?.bairro || "";
        $("cidadeInput").value = construcao?.cidade || "";
        $("ufInput").value = construcao?.uf || "";
        $("construcaoDescricaoInput").value = construcao?.descricao || "";
        $("destaqueInput").checked = !!construcao?.destaque;
        $("publicarSiteInput").checked = !!construcao?.publicar_site;
        $("construcaoLatInput").value = construcao?.latitude ?? "";
        $("construcaoLngInput").value = construcao?.longitude ?? "";
        $("construcaoLinkMapaInput").value = "";
        $("construcaoLinkMapaMensagem").hidden = true;
        atualizarListaBairros();
        atualizarCamposCaracteristicas();
        atualizarCamposFinalidade();
        $("construcaoStatusInput").value = construcao?.status || "disponivel";
        atualizarStatusHero();
        atualizarCamposCusto();
        atualizarBotoesMapa();

        // O que aparece em cada modo
        $("formEdicao").hidden = leitura;
        $("fichaLeitura").hidden = !leitura;
        if (leitura) renderFichaLeitura(construcao);
        $("construcaoStatusInput").disabled = modoDialogo !== "central";
        $("codigoLabel").hidden = modoDialogo !== "central";
        $("opcoesCentralRow").hidden = modoDialogo !== "central";
        $("construcaoLinkMapaInput").closest("label").hidden = leitura;
        document.querySelector(".foto-add-button").hidden = leitura;
        $("construcaoFotosInput").disabled = leitura;
        renderAprovacaoBanner(construcao);
        renderAutoria(construcao);

        const pendente = construcao?.aprovacao === "pendente";
        $("deleteConstrucaoButton").hidden = !construcao || leitura;
        $("deleteConstrucaoButton").textContent = gerencia ? "Excluir" : "Excluir cadastro";
        $("recusarCadastroButton").hidden = !(gerencia && pendente);
        $("aprovarCadastroButton").hidden = !(gerencia && pendente);
        $("saveConstrucaoButton").hidden = leitura;
        $("saveConstrucaoButton").textContent = gerencia ? (pendente ? "Salvar correções" : "Salvar imóvel") : "Salvar rascunho";
        $("saveConstrucaoButton").className = gerencia && !pendente ? "primary-button" : "secondary-button";
        $("enviarCadastroButton").hidden = modoDialogo !== "corretor";
        $("enviarCadastroButton").textContent = construcao?.aprovacao === "pendente" ? "Salvar e manter na fila" : "Enviar para aprovação";
        $("registrarInteresseButton").hidden = !leitura;

        if (window.SKLCRM) window.SKLCRM.proprietarioPreencher(construcao, modoDialogo);
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
            if (pickerMarker) pickerMarker.dragging[leitura ? "disable" : "enable"]();
        }, 60);
    }

    function atualizarCamposFinalidade() {
        let aluguel = $("finalidadeAluguelInput").checked;
        const venda = $("finalidadeVendaInput").checked;
        if (!aluguel && !venda) { $("finalidadeAluguelInput").checked = true; aluguel = true; }
        $("valorAluguelLabel").hidden = !aluguel;
        $("valorVendaLabel").hidden = !venda;
        const select = $("construcaoStatusInput");
        const atual = select.value;
        const lista = Object.keys(STATUS).filter(s => (aluguel && STATUS_ALUGUEL.includes(s)) || (venda && STATUS_VENDA.includes(s)));
        select.innerHTML = lista.map(s => `<option value="${s}">${h(STATUS[s])}</option>`).join("");
        select.value = lista.includes(atual) ? atual : "disponivel";
        atualizarStatusHero();
    }

    function atualizarCamposCaracteristicas() {
        const campos = CARACTERISTICAS_POR_CATEGORIA[categoriaImovel($("construcaoTipoInput").value)];
        document.querySelectorAll("[data-car]").forEach(label => { label.hidden = !campos.includes(label.dataset.car); });
        $("areaRotulo").textContent = $("construcaoTipoInput").value === "Terreno" ? "Área do terreno (m²)" : "Área (m²)";
    }

    function atualizarCamposCusto() {
        $("condominioValorInput").hidden = $("condominioTipoInput").value !== "valor";
        $("iptuValorInput").hidden = $("iptuTipoInput").value !== "valor";
    }

    function renderAprovacaoBanner(c) {
        const banner = $("aprovacaoBanner");
        if (!c || (c.aprovacao || "aprovado") === "aprovado") { banner.hidden = true; return; }
        const textos = {
            rascunho: "Rascunho: ainda não foi enviado para a Central.",
            pendente: `Aguardando aprovação da Central${c.enviado_em ? " (enviado em " + formatDate(c.enviado_em) + ")" : ""}.`,
            recusado: `Recusado pela Central: ${String(c.aprovacao_motivo || "sem motivo informado").replace(/[.\s]+$/, "")}. Corrija e envie de novo.`
        };
        banner.className = `aprovacao-banner ${c.aprovacao}`;
        banner.textContent = textos[c.aprovacao] || "";
        banner.hidden = false;
    }

    function renderAutoria(c) {
        const box = $("autoriaInfo");
        if (!podeGerenciar() || !c || !c.cadastrado_por) { box.hidden = true; return; }
        let texto = `Cadastrado por ${nomeDoUsuario(c.cadastrado_por)}${c.cadastrado_em ? " em " + formatDate(c.cadastrado_em) : ""}`;
        if (c.aprovado_por && c.aprovado_por !== c.cadastrado_por) texto += ` · aprovado por ${nomeDoUsuario(c.aprovado_por)}${c.aprovado_em ? " em " + formatDate(c.aprovado_em) : ""}`;
        box.textContent = texto;
        box.hidden = false;
    }

    // Ficha só-leitura (corretor vendo imóvel aprovado), com as características em blocos como no app de prédios.
    function renderFichaLeitura(c) {
        const precos = [];
        if (c.para_venda) precos.push(`<div class="preco-bloco"><span>Venda</span><strong>${h(formatMoney(c.valor_venda))}</strong></div>`);
        if (c.para_aluguel !== false) precos.push(`<div class="preco-bloco"><span>Aluguel</span><strong>${h(formatMoney(c.valor_aluguel))}</strong><small>por mês</small></div>`);
        $("fichaPrecos").innerHTML = precos.join("");
        const custo = (tipo, valor, periodo) => tipo === "valor" ? `${precoCurto(valor)}${periodo}` : tipo === "incluso" ? "Incluso no valor" : tipo === "nao_tem" ? "Não tem" : "Não informado";
        const plural = (n, um, varios) => `${n ?? "—"} ${n === 1 ? um : varios}`;
        // blocos conforme o tipo: comercial mostra salas (sem quartos/garagem); terreno só a área
        const categoria = categoriaImovel(c.tipo_imovel);
        const campos = CARACTERISTICAS_POR_CATEGORIA[categoria];
        const mostrar = campo => campos.includes(campo) && (categoria !== "outro" || c[campo] != null);
        const specs = [
            [ "📐", Number(c.area_m2) > 0 ? `${Number(c.area_m2).toLocaleString("pt-BR")} m²` : "— m²", categoria === "terreno" ? "Área do terreno" : "Área" ],
            mostrar("salas") && [ "🚪", plural(c.salas, "sala", "salas"), c.tipo_imovel || null ],
            mostrar("quartos") && [ "🛏️", plural(c.quartos, "quarto", "quartos") + (Number(c.suites) > 0 ? ` (${plural(c.suites, "suíte", "suítes")})` : ""), c.tipo_imovel || null ],
            mostrar("banheiros") && [ "🚿", plural(c.banheiros, "banheiro", "banheiros"), null ],
            mostrar("vagas") && [ "🚗", plural(c.vagas, "vaga", "vagas"), "de garagem" ],
            [ "🏢", custo(c.condominio_tipo, c.valor_condominio, "/mês"), "Condomínio" ],
            [ "🧾", custo(c.iptu_tipo, c.valor_iptu, "/ano"), "IPTU" ]
        ].filter(Boolean);
        $("fichaSpecs").innerHTML = specs.map(([ icone, titulo, sub ]) => `<div class="unit-spec-item"><span class="unit-spec-icon">${icone}</span><div><strong>${h(titulo)}</strong>${sub ? `<small>${h(sub)}</small>` : ""}</div></div>`).join("");
        const endereco = enderecoTexto(c);
        $("fichaEndereco").textContent = [ c.edificio, endereco ].filter(Boolean).join(" · ") || "Endereço não informado";
        $("fichaDescricao").textContent = c.descricao || "";
        $("fichaDescricao").hidden = !c.descricao;
    }

    function coletarDadosFormulario() {
        const aluguel = $("finalidadeAluguelInput").checked;
        const venda = $("finalidadeVendaInput").checked;
        const condominioTipo = $("condominioTipoInput").value;
        const iptuTipo = $("iptuTipoInput").value;
        const campos = CARACTERISTICAS_POR_CATEGORIA[categoriaImovel($("construcaoTipoInput").value)];
        return {
            nome: $("construcaoNomeInput").value.trim(),
            tipo_imovel: $("construcaoTipoInput").value,
            status: $("construcaoStatusInput").value || "disponivel",
            para_aluguel: aluguel,
            para_venda: venda,
            valor_aluguel: aluguel ? parseValor($("construcaoValorInput").value) : null,
            valor_venda: venda ? parseValor($("construcaoValorVendaInput").value) : null,
            codigo: $("construcaoCodigoInput").value.trim() || null,
            edificio: $("construcaoEdificioInput").value.trim() || null,
            condominio_tipo: condominioTipo || null,
            valor_condominio: condominioTipo === "valor" ? parseValor($("condominioValorInput").value) : null,
            iptu_tipo: iptuTipo || null,
            valor_iptu: iptuTipo === "valor" ? parseValor($("iptuValorInput").value) : null,
            // característica que não se aplica ao tipo (ex.: quartos em sala comercial) vai vazia
            area_m2: campos.includes("area") ? numeroOuNulo($("areaInput").value) : null,
            salas: campos.includes("salas") ? numeroOuNulo($("salasInput").value) : null,
            quartos: campos.includes("quartos") ? numeroOuNulo($("quartosInput").value) : null,
            suites: campos.includes("suites") ? numeroOuNulo($("suitesInput").value) : null,
            banheiros: campos.includes("banheiros") ? numeroOuNulo($("banheirosInput").value) : null,
            vagas: campos.includes("vagas") ? numeroOuNulo($("vagasInput").value) : null,
            cep: $("cepInput").value.trim() || null,
            logradouro: $("logradouroInput").value.trim() || null,
            numero: $("numeroInput").value.trim() || null,
            complemento: $("complementoInput").value.trim() || null,
            bairro: $("bairroInput").value.trim() || null,
            cidade: $("cidadeInput").value.trim() || null,
            uf: $("ufInput").value.trim().toUpperCase() || null,
            descricao: $("construcaoDescricaoInput").value.trim() || null,
            latitude: $("construcaoLatInput").value === "" ? null : parseFloat($("construcaoLatInput").value),
            longitude: $("construcaoLngInput").value === "" ? null : parseFloat($("construcaoLngInput").value),
            destaque: $("destaqueInput").checked,
            publicar_site: $("publicarSiteInput").checked
        };
    }

    // Medidor de estrelas: Central sempre; corretor só enquanto edita o próprio cadastro.
    function atualizarQualidade() {
        const box = $("qualidadeBox");
        const mostrar = modoDialogo === "central" || modoDialogo === "corretor";
        box.hidden = !mostrar;
        if (!mostrar) return;
        const q = qualidadeImovel(coletarDadosFormulario(), obterItensFotos().length);
        $("qualidadeEstrelas").textContent = estrelasTexto(q.estrelas);
        $("qualidadePct").textContent = `${q.pct}%`;
        $("qualidadeBarra").style.width = `${q.pct}%`;
        let falta = q.faltando.length ? "Para completar: " + q.faltando.join(", ") + "." : "Cadastro completo.";
        if (modoDialogo === "corretor" && notaMinimaCadastro) {
            const ok = q.estrelas >= notaMinimaCadastro;
            falta += ` A imobiliária exige no mínimo ${notaMinimaCadastro} estrela(s) para enviar${ok ? " (atingido)." : "."}`;
        }
        $("qualidadeFalta").textContent = falta;
    }

    function ensurePickerMap() {
        if (pickerMap) return;
        pickerMap = L.map("construcaoPickerMap", { zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 20, attribution: "© OpenStreetMap"
        }).addTo(pickerMap);
        pickerMap.setView(CENTRO_PADRAO, 4);
        pickerMap.on("click", event => {
            if (modoDialogo === "leitura") return;
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
        atualizarQualidade();
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
        const podeEditar = modoDialogo !== "leitura";
        const grid = $("construcaoFotosGrid");
        grid.innerHTML = itens.map((item, i) => `<div class="foto-thumb" data-foto-index="${i}">${podeEditar ? `<button class="foto-remove-button" type="button" data-remove-foto="${i}">×</button>` : ""}</div>`).join("");
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
                    // remove só esta posição (a mesma foto pode aparecer repetida na galeria)
                    fotosRemovidas.push(item.path);
                    fotosExistentes.splice(idx, 1);
                } else {
                    fotosNovas.splice(item.index, 1);
                }
                if (heroIndex >= idx && heroIndex > 0) heroIndex--;
                renderGaleria();
            });
        });
        mostrarHero(heroIndex);
        atualizarQualidade();
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

    // Só apaga o arquivo quando nenhuma foto que fica (deste ou de outro imóvel) usa o mesmo arquivo.
    async function removerFotosMarcadas() {
        if (!fotosRemovidas.length) return;
        const emUso = new Set(fotosExistentes.map(f => f.path));
        construcoes.forEach(c => { if (c.id !== editandoId) (c.fotos || []).forEach(f => emUso.add(f.path)); });
        const apagar = [ ...new Set(fotosRemovidas) ].filter(p => !emUso.has(p));
        if (apagar.length) await sb.storage.from(FOTOS_BUCKET).remove(apagar);
    }

    // Salva pelo RPC salvar_imovel (o banco decide o que cada papel pode gravar). Depois, se pedido,
    // envia para aprovação (corretor) ou aprova e publica (Central).
    async function salvarImovel({ enviar = false, aprovar = false } = {}) {
        const dados = coletarDadosFormulario();
        const mensagem = $("construcaoDialogMessage");
        if (!dados.nome) { showMessage(mensagem, "Informe o nome do anúncio."); return; }
        if (dados.para_aluguel && $("construcaoValorInput").value.trim() && dados.valor_aluguel == null) { showMessage(mensagem, "Valor do aluguel inválido."); return; }
        if (dados.para_venda && $("construcaoValorVendaInput").value.trim() && dados.valor_venda == null) { showMessage(mensagem, "Valor de venda inválido."); return; }
        const botoes = [ "saveConstrucaoButton", "enviarCadastroButton", "aprovarCadastroButton" ].map($);
        botoes.forEach(b => { b.disabled = true; });
        let salvo = false;
        try {
            let imovel;
            if (editandoId) {
                const atual = construcoes.get(editandoId);
                await removerFotosMarcadas();
                const novasEnviadas = await uploadFotosNovas(editandoId);
                dados.fotos = [ ...fotosExistentes, ...novasEnviadas ];
                const { data, error } = await sb.rpc("salvar_imovel", {
                    p_carteira_id: carteiraId, p_dados: dados, p_id: editandoId, p_expected_version: atual?.version ?? null
                });
                if (error) throw error;
                imovel = data;
            } else {
                const { data: criado, error: erroCriar } = await sb.rpc("salvar_imovel", { p_carteira_id: carteiraId, p_dados: dados });
                if (erroCriar) throw erroCriar;
                imovel = criado;
                editandoId = criado.id;
                construcoes.set(criado.id, criado);
                const novasEnviadas = await uploadFotosNovas(criado.id);
                if (novasEnviadas.length) {
                    dados.fotos = novasEnviadas;
                    const { data: comFotos, error: erroFotos } = await sb.rpc("salvar_imovel", {
                        p_carteira_id: carteiraId, p_dados: dados, p_id: criado.id, p_expected_version: criado.version
                    });
                    if (erroFotos) throw erroFotos;
                    imovel = comFotos;
                }
            }
            construcoes.set(imovel.id, imovel);
            fotosExistentes = [ ...(imovel.fotos || []) ];
            fotosNovas = [];
            fotosRemovidas = [];
            salvo = true;
            // proprietário e exclusividade (dados que só a Central vê) — antes de enviar/aprovar,
            // para o proprietário ser aprovado junto com o imóvel
            if (window.SKLCRM) {
                const comProprietario = await window.SKLCRM.proprietarioSalvar(imovel);
                if (comProprietario) { imovel = comProprietario; construcoes.set(imovel.id, imovel); }
            }
            if (enviar && imovel.aprovacao !== "pendente") {
                const { data, error } = await sb.rpc("enviar_cadastro_imovel", { p_id: imovel.id });
                if (error) throw error;
                imovel = data;
                construcoes.set(imovel.id, imovel);
            }
            if (aprovar) {
                const { data, error } = await sb.rpc("revisar_cadastro_imovel", { p_id: imovel.id, p_aprovar: true });
                if (error) throw error;
                imovel = data;
                construcoes.set(imovel.id, imovel);
            }
            atualizarTudo();
            $("construcaoDialog").close();
            if (aprovar) toast("Cadastro aprovado. O imóvel já aparece para todos.");
            else if (enviar) toast("Cadastro enviado. A Central vai revisar.");
            else toast(podeGerenciar() ? "Imóvel salvo com sucesso." : "Rascunho salvo. Envie para aprovação quando estiver pronto.");
        } catch (error) {
            if (salvo) atualizarTudo();
            const texto = traduzErro(error.message);
            showMessage(mensagem, salvo && enviar ? `O cadastro foi salvo, mas não pôde ser enviado: ${texto}` : texto);
        } finally {
            botoes.forEach(b => { b.disabled = false; });
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
            // Fotos antes do cadastro: a permissão de apagar foto do corretor depende do cadastro ainda existir.
            // Arquivos usados por outro imóvel ficam (a mesma foto pode estar em mais de um anúncio).
            const emUso = new Set();
            construcoes.forEach(c => { if (c.id !== editandoId) (c.fotos || []).forEach(f => emUso.add(f.path)); });
            const paths = [ ...new Set((construcao?.fotos || []).map(f => f.path)) ].filter(p => !emUso.has(p));
            if (paths.length) await sb.storage.from(FOTOS_BUCKET).remove(paths);
            const { error } = await sb.rpc("excluir_construcao", { p_id: editandoId });
            if (error) throw error;
            construcoes.delete(editandoId);
            atualizarTudo();
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
        const tipo = $("interesseTipoInput");
        tipo.querySelector('[value="aluguel"]').disabled = construcao.para_aluguel === false;
        tipo.querySelector('[value="compra"]').disabled = !construcao.para_venda;
        tipo.value = construcao.para_aluguel === false ? "compra" : "aluguel";
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
                p_consentimento_lgpd: $("interesseConsentInput").checked,
                p_tipo: $("interesseTipoInput").value
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
        <td>${i.tipo === "compra" ? "Comprar" : "Alugar"}</td>
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
            .select("usuario_id, papel, ativo, expira_em, email, percentual_comissao, perfis(nome_exibicao, foto_path)")
            .eq("carteira_id", carteiraId);
        if (error) { toast(traduzErro(error.message)); return; }
        corretores = (vinculos || []).map(v => ({
            id: v.usuario_id,
            display_name: v.perfis?.nome_exibicao || "—",
            foto_path: v.perfis?.foto_path || null,
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

    // Foto de perfil (avatar.js): menu lateral, Configurações > Minha foto, lista de corretores e cadastros.
    let fotoPerfilIniciada = false;
    async function iniciarFotoPerfil() {
        if (!window.SKLAvatar) return;
        if (!fotoPerfilIniciada) { window.SKLAvatar.init(sb); fotoPerfilIniciada = true; }
        currentUser.foto_path = await window.SKLAvatar.fotoDe(currentUser.id);
        desenharMinhaFoto();
    }
    function desenharMinhaFoto() {
        if (!window.SKLAvatar || !currentUser) return;
        $("currentUserAvatar").innerHTML = window.SKLAvatar.html(currentUser.display_name, currentUser.foto_path, 44);
        window.SKLAvatar.painel($("minhaFotoPainel"), {
            usuarioId: currentUser.id, nome: currentUser.display_name, path: currentUser.foto_path,
            aoMudar: novo => {
                currentUser.foto_path = novo;
                $("currentUserAvatar").innerHTML = window.SKLAvatar.html(currentUser.display_name, novo, 44);
                const eu = corretores.find(u => u.id === currentUser.id);
                if (eu) { eu.foto_path = novo; renderCorretores(); }
            }
        });
    }
    function nomeComFoto(user) {
        if (!window.SKLAvatar) return `<strong>${h(user.display_name)}</strong>`;
        return `<span class="skl-avatar-nome">${window.SKLAvatar.html(user.display_name, user.foto_path, 32)}<strong>${h(user.display_name)}</strong></span>`;
    }
    function fotoDoUsuario(id, tamanho) {
        if (!window.SKLAvatar || !id) return "";
        const user = corretores.find(u => u.id === id) || (currentUser && currentUser.id === id ? currentUser : null);
        return user ? window.SKLAvatar.html(user.display_name, user.foto_path, tamanho) : "";
    }
    async function trocarFotoUsuario(id) {
        const user = corretores.find(u => u.id === id);
        if (!user || !window.SKLAvatar) return;
        try {
            const novo = await window.SKLAvatar.trocar(id, user.foto_path);
            if (!novo) return;
            user.foto_path = novo;
            if (id === currentUser.id) { currentUser.foto_path = novo; desenharMinhaFoto(); }
            renderCorretores();
            renderCadastros();
            toast("Foto atualizada.");
        } catch (error) {
            toast(error.message);
        }
    }
    function renderCorretores() {
        $("corretorTableBody").innerHTML = corretores.map(user => {
            const percentualTexto = user.percentual_comissao != null ? `${user.percentual_comissao}%` : "—";
            if (!canManageCorretor(user)) {
                return `<tr><td>${nomeComFoto(user)}</td><td>${h(user.email || "—")}</td><td>${h(ROLE[user.papel])}</td><td>${percentualTexto}</td><td>${corretorStatusPill(user)}</td><td>${user.id === currentUser.id ? `Conta atual <button class="row-button" data-user-foto="${h(user.id)}">Foto</button>` : "—"}</td></tr>`;
            }
            const toggleLabel = user.active ? "Desativar" : "Reativar";
            return `<tr><td>${nomeComFoto(user)}</td><td>${h(user.email || "—")}</td><td>${h(ROLE[user.papel])}</td><td>${percentualTexto}</td><td>${corretorStatusPill(user)}</td><td style="display:flex;gap:6px;flex-wrap:wrap"><button class="row-button" data-user-foto="${h(user.id)}">Foto</button><button class="row-button" data-corretor-percentual="${h(user.id)}">Editar %</button><button class="row-button" data-corretor-reset="${h(user.id)}">Redefinir senha</button><button class="row-button" data-corretor-toggle="${h(user.id)}" data-next-active="${user.active ? "0" : "1"}">${toggleLabel}</button><button class="row-button danger-button" data-corretor-remove="${h(user.id)}" data-corretor-name="${h(user.display_name)}">Remover acesso</button></td></tr>`;
        }).join("");
        $("corretorTableBody").querySelectorAll("[data-user-foto]").forEach(button => button.addEventListener("click", () => trocarFotoUsuario(button.dataset.userFoto)));
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
