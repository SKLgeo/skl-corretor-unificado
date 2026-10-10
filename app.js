(() => {
    "use strict";
    const $ = id => document.getElementById(id);

    const SUPABASE_URL = "https://xigwlofqkmiibzbongkn.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_mqppAm9n79xl6rYafzXyNQ_mGVoX3Vd";
    const APP_VERSION = "0.6.0-web";
    document.querySelectorAll(".appVersionText").forEach(el => el.textContent = `v${APP_VERSION}`);

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: "sklu-auth", persistSession: true, autoRefreshToken: true }
    });

    // Versão web: shell (esta página, na raiz), www-vendas/ e www-aluguel/ ficam lado a lado na
    // MESMA origem, então uma navegação comum (location.href) leva a sessão do Supabase junto via
    // localStorage. Endereços relativos — o site pode ficar em qualquer subpasta (GitHub Pages).
    const LINE_TARGETS = {
        vendas: "www-vendas/index.html",
        aluguel: "www-aluguel/index.html"
    };

    function showMessage(element, message) {
        element.textContent = message;
        element.hidden = false;
    }

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
        let data = null, erroSessao = null;
        try {
            ({ data, error: erroSessao } = await sb.auth.getSession());
        } catch (error) {
            erroSessao = error;
        }
        if (!data?.session) {
            if ((erroSessao || !navigator.onLine) && temAcessoOfflineSalvo()) return abrirLinha("vendas");
            mostrarLogin();
            if (!navigator.onLine) showMessage($("loginMessage"), MSG_SEM_INTERNET);
            return;
        }
        try {
            await detectarLinhasEEntrar();
        } catch (error) {
            if (ehErroDeRede(error) && temAcessoOfflineSalvo()) return abrirLinha("vendas");
            mostrarLogin();
            showMessage($("loginMessage"), navigator.onLine ? traduzErro(error.message) : MSG_SEM_INTERNET);
        }
    }

    // Mesmo filtro que online.js usa hoje: só papel "corretor" enxerga
    // Vendas por aqui (administrador/central_vendas usam o Central Unificado).
    async function temAcessoVendas() {
        const { data: userData } = await sb.auth.getUser();
        if (!userData?.user) return false;
        const { data, error } = await sb.from("empreendimento_usuarios")
            .select("papel, expira_em, empreendimentos(ativo)")
            .eq("usuario_id", userData.user.id)
            .eq("papel", "corretor");
        if (error) throw new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.");
        const agora = Date.now();
        return (data || []).some(v => v.empreendimentos?.ativo && (!v.expira_em || new Date(v.expira_em).getTime() >= agora));
    }

    // Mesmo filtro do Central Unificado: qualquer papel ativo — a própria
    // UI de Aluguéis já vira só-leitura pro papel corretor sozinha.
    async function temAcessoAluguel() {
        const { data: userData } = await sb.auth.getUser();
        if (!userData?.user) return false;
        const { data, error } = await sb.from("carteira_aluguel_usuarios")
            .select("ativo, expira_em, carteiras_aluguel(ativo)")
            .eq("usuario_id", userData.user.id)
            .eq("ativo", true);
        if (error) throw new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.");
        const agora = Date.now();
        return (data || []).some(v => v.carteiras_aluguel?.ativo && (!v.expira_em || new Date(v.expira_em).getTime() >= agora));
    }

    let acesso = { vendas: false, aluguel: false };

    async function detectarLinhasEEntrar() {
        const limite = new Promise((_, rejeita) => setTimeout(() => rejeita(new Error("Não foi possível verificar seus acessos agora (o servidor está ocupado). Aguarde um instante e tente entrar de novo.")), 25000));
        const [vendas, aluguel] = await Promise.race([Promise.all([temAcessoVendas(), temAcessoAluguel()]), limite]);
        acesso = { vendas, aluguel };
        // usado por trocar-linha.js (Vendas/Aluguéis) para só mostrar o atalho a quem tem as duas linhas
        try { localStorage.setItem("sklu_linhas", [vendas && "vendas", aluguel && "aluguel"].filter(Boolean).join(",")); } catch {}
        if (!vendas && !aluguel) {
            throw new Error("Este usuário ainda não tem acesso de corretor a nenhuma linha de negócio (Vendas ou Aluguéis).");
        }
        if (vendas && aluguel) {
            mostrarEscolha();
            return;
        }
        abrirLinha(vendas ? "vendas" : "aluguel");
    }

    function mostrarLogin() {
        $("loginView").hidden = false;
        $("chooserView").hidden = true;
        $("loginForm").reset();
    }

    function mostrarEscolha() {
        $("chooseVendasButton").hidden = !acesso.vendas;
        $("chooseAluguelButton").hidden = !acesso.aluguel;
        $("loginView").hidden = true;
        $("chooserView").hidden = false;
    }

    function abrirLinha(linha) {
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
    $("chooseVendasButton").addEventListener("click", () => abrirLinha("vendas"));
    $("chooseAluguelButton").addEventListener("click", () => abrirLinha("aluguel"));
    $("chooserLogoutButton").addEventListener("click", sair);

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
