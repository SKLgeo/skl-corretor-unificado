(() => {
    "use strict";
    const $ = id => document.getElementById(id);

    const SUPABASE_URL = "https://xigwlofqkmiibzbongkn.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_mqppAm9n79xl6rYafzXyNQ_mGVoX3Vd";
    const APP_VERSION = "0.16.3-web";
    // Vendas (loteamento/prédio) desligado neste app por enquanto: só a Gestão imobiliária (aluguel + venda de imóveis).
    // Para religar, trocar para true (o código de Vendas continua no pacote).
    const VENDAS_LIGADO = true;
    document.querySelectorAll(".appVersionText").forEach(el => el.textContent = `v${APP_VERSION}`);

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: "sklu-auth", persistSession: true, autoRefreshToken: true }
    });

    // App único: a tela é escolhida pelo papel. Vendas tem duas telas — a da Central (www-vendas/)
    // e a do corretor (www-vendas-corretor/, mapa e pedidos de reserva); Aluguéis é uma só
    // (www-aluguel/ troca sozinha para a tela do corretor quando o papel é corretor).
    // Versão web: shell (esta página, na raiz), www-vendas/ e www-aluguel/ ficam lado a lado na
    // MESMA origem, então uma navegação comum (location.href) leva a sessão do Supabase junto via
    // localStorage. Endereços relativos — o site pode ficar em qualquer subpasta (GitHub Pages).
    const LINE_TARGETS = {
        vendas: "www-vendas/index.html",
        "vendas-corretor": "www-vendas-corretor/index.html",
        aluguel: "www-aluguel/index.html"
    };

    function showMessage(element, message, ok) {
        element.textContent = message;
        element.classList.toggle("ok", Boolean(ok));
        element.hidden = false;
    }

    // ===== Esqueci minha senha (mesmo fluxo da Acquaville) =====
    // O e-mail traz um link que abre o LINK WEB (no app instalado não dá para abrir a tela do APK por link).
    // Lá aparece "Defina sua nova senha"; depois a pessoa entra normalmente, no app ou no link.
    const LINK_RECUPERAR_SENHA = "https://sklgeo.github.io/skl-corretor-unificado/";
    let modoRecuperacao = /type=recovery/.test(location.hash);
    function mostrarFormulario(id) {
        ["loginForm", "recoverForm", "recoverNewPasswordForm"].forEach(f => { $(f).hidden = f !== id; });
        $("loginView").hidden = false;
        $("chooserView").hidden = true;
    }
    async function enviarRecuperacao(event) {
        event.preventDefault();
        $("recoverMessage").hidden = true;
        $("recoverSubmitButton").disabled = true;
        try {
            const { error } = await sb.auth.resetPasswordForEmail($("recoverEmailInput").value.trim(), { redirectTo: LINK_RECUPERAR_SENHA });
            if (error) throw error;
            showMessage($("recoverMessage"), "Se esse e-mail tiver uma conta, chega nele em alguns instantes um link para definir a senha nova. Confira também o spam.", true);
        } catch (error) {
            showMessage($("recoverMessage"), /rate limit|security purposes/i.test(error.message || "")
                ? "Aguarde um minuto antes de pedir outro link."
                : traduzErro(error.message));
        } finally {
            $("recoverSubmitButton").disabled = false;
        }
    }
    async function salvarNovaSenha(event) {
        event.preventDefault();
        const senha = $("recoverNewPasswordInput").value;
        if (senha !== $("recoverNewPasswordInput2").value) return showMessage($("recoverNewPasswordMessage"), "As duas senhas não são iguais.");
        $("recoverNewPasswordButton").disabled = true;
        try {
            const { error } = await sb.auth.updateUser({ password: senha });
            if (error) throw error;
            await sb.auth.signOut();
            modoRecuperacao = false;
            history.replaceState(null, "", location.pathname);
            $("recoverNewPasswordForm").reset();
            mostrarFormulario("loginForm");
            showMessage($("loginMessage"), "Senha alterada. Entre com a senha nova.", true);
        } catch (error) {
            showMessage($("recoverNewPasswordMessage"), /different from the old|should be different/i.test(error.message || "")
                ? "A senha nova precisa ser diferente da anterior."
                : traduzErro(error.message));
        } finally {
            $("recoverNewPasswordButton").disabled = false;
        }
    }
    sb.auth.onAuthStateChange(evento => {
        if (evento === "PASSWORD_RECOVERY") { modoRecuperacao = true; mostrarFormulario("recoverNewPasswordForm"); }
    });

    function traduzErro(message) {
        const mapa = { "Invalid login credentials": "E-mail ou senha incorretos." };
        return mapa[message] || message || "Não foi possível concluir a operação.";
    }

    async function login(event) {
        event.preventDefault();
        $("loginMessage").hidden = true;
        $("loginSubmitButton").disabled = true;
        try {
            const { error } = await sb.auth.signInWithPassword({
                email: $("loginEmailInput").value.trim(),
                password: $("loginPasswordInput").value
            });
            if (error) throw error;
            await detectarLinhasEEntrar();
        } catch (error) {
            if (!navigator.onLine) return showMessage($("loginMessage"), MSG_SEM_INTERNET);
            // senha certa mas o servidor não respondeu: não sai da conta, tenta de novo
            if (ehErroDeRede(error) && (await sb.auth.getSession()).data?.session) return restoreSession();
            await sb.auth.signOut();
            showMessage($("loginMessage"), traduzErro(error.message));
        } finally {
            $("loginSubmitButton").disabled = false;
        }
    }

    // Uso offline ("modo campo"): www-vendas/online.js grava este resumo depois de entrar com
    // internet (mesma origem → mesmo localStorage). Sem internet, o shell pula a verificação
    // de acessos (que depende do servidor) e abre direto o mapa de Vendas com os dados salvos.
    const OFFLINE_ACESSO_KEY = "sklu_offline_acesso";
    const MSG_SEM_INTERNET = "Sem internet. Para usar o aplicativo sem internet, é preciso abri-lo e entrar na sua conta pelo menos uma vez com internet — assim o mapa, os lotes e a última situação ficam salvos no aparelho.";
    function temAcessoOfflineSalvo() {
        try {
            const acesso = JSON.parse(localStorage.getItem(OFFLINE_ACESSO_KEY) || "null");
            return Boolean(acesso && acesso.id && (Date.now() - Date.parse(acesso.validado_em)) / 864e5 <= 30);
        } catch {
            return false;
        }
    }
    function ehErroDeRede(error) {
        if (!navigator.onLine) return true;
        return /Failed to fetch|NetworkError|Load failed|network|fetch failed|AuthRetryableFetchError|servidor está ocupado/i.test(String(error?.name || "") + " " + String(error?.message || error || ""));
    }

    async function restoreSession() {
        if (modoRecuperacao) return mostrarFormulario("recoverNewPasswordForm");
        let data = null, erroSessao = null;
        try {
            ({ data, error: erroSessao } = await sb.auth.getSession());
        } catch (error) {
            erroSessao = error;
        }
        if (!data?.session) {
            if (VENDAS_LIGADO && (erroSessao || !navigator.onLine) && temAcessoOfflineSalvo()) return abrirLinha("vendas-corretor");
            mostrarLogin();
            if (!navigator.onLine) showMessage($("loginMessage"), MSG_SEM_INTERNET);
            return;
        }
        try {
            await detectarLinhasEEntrar();
        } catch (error) {
            if (VENDAS_LIGADO && ehErroDeRede(error) && temAcessoOfflineSalvo()) return abrirLinha("vendas-corretor");
            mostrarLogin();
            if (ehErroDeRede(error)) {
                // continua conectado: tenta de novo sozinho, sem pedir senha
                showMessage($("loginMessage"), (navigator.onLine ? "Servidor ocupado ou conexão lenta." : "Sem internet.") + " Você continua conectado: tentando de novo em instantes…");
                clearTimeout(window.__sklRetry);
                window.__sklRetry = setTimeout(restoreSession, 8000);
                return;
            }
            showMessage($("loginMessage"), traduzErro(error.message));
        }
    }

    // Vendas: administrador/central_vendas abrem a tela da Central; corretor abre a do corretor.
    // Devolve "vendas", "vendas-corretor" ou null (sem acesso).
    async function temAcessoVendas() {
        const { data: userData } = await sb.auth.getUser();
        if (!userData?.user) return null;
        const { data, error } = await sb.from("empreendimento_usuarios")
            .select("papel, expira_em, empreendimentos(ativo, slug)")
            .eq("usuario_id", userData.user.id)
            .in("papel", ["administrador", "central_vendas", "corretor"]);
        if (error) throw new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.");
        const agora = Date.now();
        const validos = (data || []).filter(v => v.empreendimentos?.ativo && SLUGS_DEMONSTRACAO.includes(v.empreendimentos.slug) && (!v.expira_em || new Date(v.expira_em).getTime() >= agora));
        if (validos.some(v => v.papel !== "corretor")) return "vendas";
        return validos.length ? "vendas-corretor" : null;
    }

    // Mesmo filtro do Central Unificado: qualquer papel ativo — a própria
    // UI de Aluguéis já vira só-leitura pro papel corretor sozinha.
    const CARTEIRA_DEMONSTRACAO = "6f02a7db-d925-49b3-abc0-8a8785e09017"; // SKL Imobiliária - Demonstração
    const SLUGS_DEMONSTRACAO = [ "skl-base", "aurora-prime-demo" ]; // Vendas (loteamento e prédio) de demonstração
    async function temAcessoAluguel() {
        const { data: userData } = await sb.auth.getUser();
        if (!userData?.user) return false;
        const { data, error } = await sb.from("carteira_aluguel_usuarios")
            .select("ativo, expira_em, carteiras_aluguel(ativo)")
            .eq("usuario_id", userData.user.id)
            .eq("ativo", true)
            .eq("carteira_id", CARTEIRA_DEMONSTRACAO); // o Unificado nunca abre carteira de cliente
        if (error) throw new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.");
        const agora = Date.now();
        return (data || []).some(v => v.carteiras_aluguel?.ativo && (!v.expira_em || new Date(v.expira_em).getTime() >= agora));
    }

    let acesso = { vendas: false, aluguel: false };
    let alvoVendas = "vendas";

    async function detectarLinhasEEntrar() {
        if (modoRecuperacao) return mostrarFormulario("recoverNewPasswordForm");
        const limite = new Promise((_, rejeita) => setTimeout(() => rejeita(new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.")), 25000));
        const [vendas, aluguel] = await Promise.race([Promise.all([VENDAS_LIGADO ? temAcessoVendas() : null, temAcessoAluguel()]), limite]);
        acesso = { vendas: Boolean(vendas), aluguel };
        // usado por trocar-linha.js (Vendas/Aluguéis) para só mostrar o atalho a quem tem as duas linhas
        try { localStorage.setItem("sklu_linhas", [vendas && "vendas", aluguel && "aluguel"].filter(Boolean).join(",")); } catch {}
        alvoVendas = vendas || "vendas";
        if (!vendas && !aluguel) {
            throw new Error("Este usuário ainda não tem acesso à Gestão imobiliária.");
        }
        if (vendas && aluguel) {
            mostrarEscolha();
            return;
        }
        abrirLinha(vendas ? alvoVendas : "aluguel");
    }

    function mostrarLogin() {
        mostrarFormulario("loginForm");
        $("loginForm").reset();
        // lembra o último e-mail usado neste aparelho (a senha fica com o gerenciador de senhas do aparelho)
        try { const e = localStorage.getItem("skl_shell_ultimo_email"); if (e) $("loginEmailInput").value = e; } catch {}
    }

    function mostrarEscolha() {
        $("chooseVendasButton").hidden = !acesso.vendas;
        $("chooseAluguelButton").hidden = !acesso.aluguel;
        $("loginView").hidden = true;
        $("chooserView").hidden = false;
    }

    function abrirLinha(linha) {
        if (linha === "vendas") linha = alvoVendas;
        const alvo = LINE_TARGETS[linha];
        if (!alvo) return;
        location.href = alvo;
    }

    async function sair() {
        try { localStorage.removeItem(OFFLINE_ACESSO_KEY); } catch {}
        try { localStorage.removeItem("sklu_linhas"); } catch {}
        await sb.auth.signOut();
        mostrarLogin();
    }

    $("loginForm").addEventListener("submit", login);
    $("loginForm").addEventListener("submit", () => { try { localStorage.setItem("skl_shell_ultimo_email", $("loginEmailInput").value.trim()); } catch {} });
    $("showRecoverButton").addEventListener("click", () => {
        $("recoverEmailInput").value = $("loginEmailInput").value.trim();
        $("recoverMessage").hidden = true;
        mostrarFormulario("recoverForm");
    });
    $("backFromRecoverButton").addEventListener("click", () => mostrarFormulario("loginForm"));
    $("recoverForm").addEventListener("submit", enviarRecuperacao);
    $("recoverNewPasswordForm").addEventListener("submit", salvarNovaSenha);
    $("chooseVendasButton").addEventListener("click", () => abrirLinha("vendas"));
    $("chooseAluguelButton").addEventListener("click", () => abrirLinha("aluguel"));
    $("chooserLogoutButton").addEventListener("click", sair);


    // tela de "carregando" até saber se a pessoa já está conectada (evita o login piscar na abertura)
    (function () {
        const boot = document.getElementById("bootView");
        if (!boot) return;
        const telas = ["loginView","chooserView"].map(id => document.getElementById(id)).filter(Boolean);
        let limite = null;
        const obs = new MutationObserver(() => {
            if (telas.some(el => !el.hidden)) { boot.remove(); obs.disconnect(); clearTimeout(limite); }
        });
        telas.forEach(el => obs.observe(el, { attributes: true, attributeFilter: [ "hidden" ] }));
        limite = setTimeout(() => { if (boot.isConnected) { boot.remove(); obs.disconnect(); if (telas.every(el => el.hidden)) telas[0].hidden = false; } }, 15000);
    })();

    restoreSession();
})();

// Botão "Mostrar/Ocultar" na senha do login (ajuda a conferir o que foi digitado).
(function () {
    const input = document.getElementById("loginPasswordInput");
    if (!input || input.dataset.olho) return;
    input.dataset.olho = "1";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "pw-toggle";
    botao.textContent = "Mostrar";
    botao.setAttribute("aria-label", "Mostrar ou ocultar a senha");
    botao.addEventListener("click", () => {
        const oculta = input.type === "password";
        input.type = oculta ? "text" : "password";
        botao.textContent = oculta ? "Ocultar" : "Mostrar";
    });
    wrap.appendChild(botao);
})();
