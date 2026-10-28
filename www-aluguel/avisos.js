// Avisos do app: compromissos da agenda (30 min antes), lembretes (8h do dia), imóveis novos na carteira e pedidos de
// "procura-se imóvel" da equipe. O banco cria os avisos (tabela notificacoes) e a Edge Function notificar-push manda
// para o celular/navegador inscrito (Web Push, funciona com o app fechado). Com o app aberto, chega também pelo Realtime.
// No programa do Windows e no iPhone sem o app instalado não há push: o aviso aparece enquanto o app estiver aberto.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const CHAVE_PEDIDO = "sklu_alug_avisos_pedido";
    let ctx = null, ligado = false, canal = null, timer = null;
    let lista = [], procurados = [], pushAtivo = false, inscricao = null;
    const vistos = new Set();

    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const temNotificacao = () => "Notification" in window;
    const temPush = () => "serviceWorker" in navigator && "PushManager" in window && temNotificacao();
    const ehIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const instalado = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    function lerLocal(k) { try { return localStorage.getItem(k); } catch { return null; } }
    function gravarLocal(k, v) { try { localStorage.setItem(k, v); } catch { /* aparelho sem armazenamento */ } }
    function quando(iso) {
        const d = new Date(iso), agora = Date.now(), min = Math.round((agora - d.getTime()) / 60000);
        if (min < 1) return "agora";
        if (min < 60) return `há ${min} min`;
        if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
        return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    function chaveParaBytes(b64) {
        const s = b64.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(s + "===".slice((s.length + 3) % 4));
        return Uint8Array.from(bin, c => c.charCodeAt(0));
    }
    function registroSw() {
        if (!("serviceWorker" in navigator)) return Promise.resolve(null);
        return Promise.race([ navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000)) ]).catch(() => null);
    }

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { ligarEventos(); ligado = true; }
        $("avisosBotao").hidden = false;
        lista = []; vistos.clear();
        carregar(true);
        carregarProcurados();
        ligarTempoReal();
        conferirInscricao();
        clearInterval(timer);
        timer = setInterval(() => carregar(), 60000);
    }
    function sair() {
        clearInterval(timer); timer = null;
        if (canal && ctx) ctx.sb.removeChannel(canal);
        canal = null;
        // o aparelho deixa de receber avisos desta pessoa ao sair da conta
        if (inscricao && ctx) ctx.sb.rpc("push_cancelar", { p_endpoint: inscricao.endpoint }).then(() => {}, () => {});
        inscricao = null; pushAtivo = false; lista = []; procurados = [];
        if ($("avisosBotao")) $("avisosBotao").hidden = true;
        document.querySelectorAll(".avisos-procura, .avisos-pedido").forEach(el => el.remove());
    }
    function ligarEventos() {
        $("avisosBotao").addEventListener("click", abrirPainel);
        $("avisosLerTodas").addEventListener("click", async () => {
            await ctx.sb.rpc("notificacoes_marcar_lidas", { p_ids: null });
            lista.forEach(n => { n.lida_em = n.lida_em || new Date().toISOString(); });
            desenhar();
        });
        $("avisosAtivar").addEventListener("click", ativar);
        $("avisosAntecedencia").addEventListener("change", trocarAntecedencia);
        $("avisosDesativar").addEventListener("click", desativar);
        document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx) { carregar(); carregarProcurados(); } });
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.tipo === "aviso-aberto") abrirItem(e.data.aviso); });
        }
        // aberto pelo toque no aviso (o service worker abre o app com ?aviso=<id>)
        const q = new URLSearchParams(location.search).get("aviso");
        if (q) setTimeout(() => { const n = lista.find(x => x.id === q); if (n) abrirItem(n); }, 2500);
    }
    function ligarTempoReal() {
        if (canal) ctx.sb.removeChannel(canal);
        const uid = (ctx.usuario() || {}).id;
        if (!uid) return;
        canal = ctx.sb.channel(`avisos-${uid}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "notificacoes", filter: `usuario_id=eq.${uid}` }, ev => {
                const n = ev.new;
                if (n && n.push_em && new Date(n.enviar_em).getTime() <= Date.now() + 5000) chegou(n);
                carregar();
            })
            .subscribe();
    }
    async function carregar(primeira) {
        if (!ctx) return;
        let data = null, error = null;
        try {
            ({ data, error } = await ctx.sb.from("notificacoes").select("*")
                .lte("enviar_em", new Date().toISOString()).order("enviar_em", { ascending: false }).limit(40));
        } catch (e) { error = e; }
        if (error) return;
        lista = data || [];
        if (primeira) lista.forEach(n => vistos.add(n.id + n.enviar_em));
        else lista.filter(n => !n.lida_em && !vistos.has(n.id + n.enviar_em)).forEach(chegou);
        desenhar();
    }
    // aviso novo com o app aberto: aparece na tela; sem push neste aparelho, também como notificação do sistema
    function chegou(n) {
        const k = n.id + n.enviar_em;
        if (vistos.has(k)) return;
        vistos.add(k);
        ctx.toast(`${n.titulo}${n.corpo ? " — " + n.corpo : ""}`);
        if (!pushAtivo && temNotificacao() && Notification.permission === "granted") {
            const opcoes = { body: n.corpo || "", tag: n.id, icon: "assets/icons/icon-192.png", data: { aviso: n } };
            registroSw().then(reg => {
                if (reg && reg.showNotification) return reg.showNotification(n.titulo, opcoes);
                const not = new Notification(n.titulo, opcoes);
                not.onclick = () => { window.focus(); abrirItem(n); not.close(); };
            }).catch(() => {});
        }
    }

    // ------------------------------------------------------------------ painel (sino)
    function desenhar() {
        const naoLidas = lista.filter(n => !n.lida_em).length;
        $("avisosBadge").textContent = naoLidas > 9 ? "9+" : naoLidas;
        $("avisosBadge").hidden = !naoLidas;
        if (!$("avisosDialog").open) return;
        $("avisosLista").innerHTML = lista.length ? lista.map(n => `<button type="button" class="avisos-item${n.lida_em ? "" : " nao-lida"}" data-aviso="${h(n.id)}">
              <strong>${h(n.titulo)}</strong>${n.corpo ? `<span>${h(n.corpo)}</span>` : ""}<small>${h(quando(n.enviar_em))}</small></button>`).join("")
            : `<p class="muted-text">Nenhum aviso ainda. Aqui aparecem os compromissos da agenda, os lembretes, os imóveis novos e os pedidos de ajuda na busca.</p>`;
        $("avisosLista").querySelectorAll("[data-aviso]").forEach(b => b.addEventListener("click", () => abrirItem(lista.find(n => n.id === b.dataset.aviso))));
        desenharEstado();
    }
    function desenharEstado() {
        const st = $("avisosEstado");
        $("avisosAtivar").hidden = true; $("avisosDesativar").hidden = true;
        if (!temNotificacao()) { st.textContent = "Este navegador não mostra avisos. Os avisos continuam aparecendo aqui no sino."; return; }
        if (ehIos() && !instalado() && !temPush()) {
            st.innerHTML = "No iPhone/iPad, os avisos com o app fechado só funcionam com o app <strong>instalado na tela de início</strong>: no Safari, toque em Compartilhar → <em>Adicionar à Tela de Início</em>, abra pelo ícone e ative os avisos.";
            return;
        }
        const perm = Notification.permission;
        if (perm === "denied") { st.textContent = "Os avisos estão bloqueados neste navegador. Libere em Configurações do site → Notificações e recarregue."; return; }
        if (perm === "granted" && (pushAtivo || !temPush())) {
            st.textContent = pushAtivo ? "✅ Avisos ativados neste aparelho, mesmo com o app fechado." : "✅ Avisos ativados enquanto o app estiver aberto.";
            $("avisosDesativar").hidden = !pushAtivo;
            return;
        }
        st.textContent = "Ative para receber no celular ou no computador os compromissos, lembretes e imóveis novos.";
        $("avisosAtivar").hidden = false;
    }
    // cada pessoa escolhe quando é avisada dos compromissos; os já marcados passam a seguir a escolha nova
    async function trocarAntecedencia() {
        const sel = $("avisosAntecedencia"), eu = ctx.usuario() || {};
        const antes = eu.aviso_antecedencia_min ?? 30, novo = Number(sel.value);
        const { error } = await ctx.sb.rpc("definir_aviso_antecedencia", { p_carteira: ctx.carteiraId(), p_minutos: novo });
        if (error) { sel.value = String(antes); ctx.toast(ctx.traduzErro(error.message)); return; }
        eu.aviso_antecedencia_min = novo;
        ctx.toast(`Pronto: você será avisado ${sel.selectedOptions[0].textContent.toLowerCase()}, em todos os seus aparelhos.`);
    }
    async function abrirPainel() {
        const valor = String((ctx.usuario() || {}).aviso_antecedencia_min ?? 30);
        $("avisosAntecedencia").value = [ ...$("avisosAntecedencia").options ].some(o => o.value === valor) ? valor : "30";
        $("avisosDialog").showModal();
        desenhar();
        await carregar();
        const ids = lista.filter(n => !n.lida_em).map(n => n.id);
        if (ids.length) {
            await ctx.sb.rpc("notificacoes_marcar_lidas", { p_ids: ids });
            setTimeout(() => { lista.forEach(n => { if (ids.includes(n.id)) n.lida_em = new Date().toISOString(); }); desenharBadge(); }, 1500);
        }
    }
    function desenharBadge() {
        const naoLidas = lista.filter(n => !n.lida_em).length;
        $("avisosBadge").textContent = naoLidas > 9 ? "9+" : naoLidas;
        $("avisosBadge").hidden = !naoLidas;
    }
    function abrirItem(n) {
        if (!n || !ctx) return;
        if ($("avisosDialog").open) $("avisosDialog").close();
        const d = n.dados || {};
        if (d.construcao_id && ctx.abrirImovel) return ctx.abrirImovel(d.construcao_id);
        if (n.tipo === "procura") return mostrarProcurados();
        if (d.negociacao_id && window.SKLCRM) return window.SKLCRM.abrirNegociacao(d.negociacao_id);
        if (d.cliente_id && window.SKLCRM) return window.SKLCRM.abrirCliente(d.cliente_id);
    }

    // ------------------------------------------------------------------ ativar neste aparelho
    async function ativar() {
        if (!temNotificacao()) return;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { ctx.toast("Sem permissão, os avisos não aparecem. Dá para liberar depois nas configurações do navegador."); desenharEstado(); fecharPedido(); return; }
        if (temPush()) {
            const ok = await inscrever();
            if (!ok) ctx.toast("Não deu para ligar os avisos com o app fechado neste aparelho. Eles aparecem com o app aberto.");
        }
        fecharPedido();
        ctx.toast(pushAtivo ? "Avisos ativados neste aparelho." : "Avisos ativados enquanto o app estiver aberto.");
        desenharEstado();
    }
    async function inscrever() {
        try {
            const reg = await registroSw();
            if (!reg || !reg.pushManager) return false;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                const { data: chave } = await ctx.sb.rpc("push_chave_publica");
                if (!chave) return false;
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) });
            }
            const j = sub.toJSON();
            const { error } = await ctx.sb.rpc("push_inscrever", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
                p_aparelho: navigator.userAgent.slice(0, 200) });
            if (error) return false;
            inscricao = { endpoint: j.endpoint };
            pushAtivo = true;
            return true;
        } catch (e) {
            console.warn("Avisos: inscrição falhou", e);
            return false;
        }
    }
    async function desativar() {
        try {
            const reg = await registroSw();
            const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
            if (sub) { await ctx.sb.rpc("push_cancelar", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
        } catch { /* segue */ }
        inscricao = null; pushAtivo = false;
        ctx.toast("Avisos com o app fechado desligados neste aparelho.");
        desenharEstado();
    }
    // já deu permissão antes: reinscreve em silêncio (o aparelho pode ter trocado de pessoa) e oferece ativar se ainda não pediu
    async function conferirInscricao() {
        pushAtivo = false;
        if (temNotificacao() && Notification.permission === "granted" && temPush()) await inscrever();
        oferecerAtivar();
    }
    function oferecerAtivar() {
        document.querySelectorAll(".avisos-pedido").forEach(el => el.remove());
        if (!temNotificacao() || Notification.permission !== "default" || lerLocal(CHAVE_PEDIDO) === "nao") return;
        const iosSemApp = ehIos() && !instalado() && !temPush();
        [ "page-hoje", "page-dashboard" ].forEach(pg => {
            const pagina = $(pg);
            if (!pagina) return;
            const box = document.createElement("div");
            box.className = "avisos-pedido";
            box.innerHTML = iosSemApp
                ? `<span>🔔 Para receber os avisos dos compromissos no iPhone, instale o app: no Safari, Compartilhar → <strong>Adicionar à Tela de Início</strong>.</span>
                   <button type="button" class="text-button" data-av-nao>Agora não</button>`
                : `<span>🔔 Quer ser avisado dos seus compromissos, lembretes e imóveis novos, mesmo com o app fechado?</span>
                   <span class="avisos-pedido-botoes"><button type="button" class="primary-button" data-av-sim>Ativar avisos</button><button type="button" class="text-button" data-av-nao>Agora não</button></span>`;
            pagina.insertBefore(box, pagina.firstChild);
            const sim = box.querySelector("[data-av-sim]");
            if (sim) sim.addEventListener("click", ativar);
            box.querySelector("[data-av-nao]").addEventListener("click", () => { gravarLocal(CHAVE_PEDIDO, "nao"); fecharPedido(); });
        });
    }
    function fecharPedido() { document.querySelectorAll(".avisos-pedido").forEach(el => el.remove()); }

    // ------------------------------------------------------------------ imóveis procurados (ajuda na busca)
    async function carregarProcurados() {
        if (!ctx) return;
        const { data, error } = await ctx.sb.rpc("crm_imoveis_procurados", { p_carteira: ctx.carteiraId() });
        procurados = error ? [] : (data || []);
        desenharProcurados();
    }
    function desenharProcurados() {
        [ [ "page-hoje", "avisosProcuraHoje" ], [ "page-dashboard", "avisosProcuraVisao" ] ].forEach(([ pg, id ]) => {
            const pagina = $(pg);
            if (!pagina) return;
            let box = $(id);
            if (!procurados.length) { if (box) box.remove(); return; }
            if (!box) {
                box = document.createElement("details");
                box.id = id; box.className = "avisos-procura"; box.open = true;
                const ancora = pagina.querySelector(".hoje-atalhos, .metric-grid");
                pagina.insertBefore(box, ancora ? ancora.nextSibling : pagina.firstChild);
            }
            const eu = (ctx.usuario() || {}).id;
            box.innerHTML = `<summary>🔎 Imóveis procurados pela equipe <b class="nav-badge">${procurados.length}</b><small>Conhece um imóvel assim? Avise quem está procurando.</small></summary>
              <div class="avisos-procura-lista">${procurados.map(p => {
                const q = p.procura || {};
                const tel = String(p.corretor_telefone || "").replace(/\D/g, "");
                const texto = encodeURIComponent(`Olá! Vi no app que você procura: ${q.descricao}${q.regiao ? " (" + q.regiao + ")" : ""}. Tenho uma indicação.`);
                const meu = p.corretor_id === eu;
                return `<div class="avisos-procura-item">
                  <strong>${h(q.descricao)}</strong>
                  <span>${[ p.finalidade === "locacao" ? "Para alugar" : p.finalidade === "venda" ? "Para comprar" : "", q.tipo, q.regiao, q.valor ].filter(Boolean).map(h).join(" · ")}</span>
                  ${q.observacao ? `<em>${h(q.observacao)}</em>` : ""}
                  <small>${meu ? "Sua busca" : "Quem procura: " + h(p.corretor_nome || "—")}</small>
                  <span class="avisos-procura-acoes">${meu ? `<button type="button" class="secondary-button fin-mini" data-proc-neg="${h(p.negociacao_id)}">Abrir negócio</button>`
                    : (tel.length >= 10 ? `<a class="crm-btn-contato whats" href="https://wa.me/55${tel}?text=${texto}" target="_blank" rel="noopener">Avisar pelo WhatsApp</a>` : "")}</span>
                </div>`; }).join("")}</div>`;
            box.querySelectorAll("[data-proc-neg]").forEach(b => b.addEventListener("click", () => window.SKLCRM && window.SKLCRM.abrirNegociacao(b.dataset.procNeg)));
        });
    }
    function mostrarProcurados() {
        carregarProcurados().then(() => {
            const pg = document.querySelector(".page.active-page");
            const box = pg && pg.querySelector(".avisos-procura");
            if (box) { box.open = true; box.scrollIntoView({ behavior: "smooth", block: "start" }); }
            else if (ctx.irPara) ctx.irPara(document.body.classList.contains("modo-corretor") ? "hoje" : "dashboard");
        });
    }

    window.SKLAvisos = { iniciar, sair, recarregar: () => { carregar(); carregarProcurados(); } };
})();
