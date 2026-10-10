// Tela do corretor (um app só, a interface muda pelo papel de quem entra).
// Corretor: sempre esta tela — abas Hoje, Imóveis, Clientes, Negócios e Conta, pensada para o celular.
// Central/administrador: tela da Central; o botão "Modo corretor" troca para esta (escolha guardada no aparelho).
// Só muda a apresentação: o que cada um pode ver e fazer continua decidido pelo banco (RLS + RPCs).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const CHAVE = "sklu_alug_modo_corretor";
    // aba destacada para cada página
    const ABA = {
        hoje: "hoje", dashboard: "hoje", agenda: "hoje",
        construcoes: "construcoes", clientes: "clientes", negociacoes: "negociacoes",
        conta: "conta", cadastros: "conta", settings: "conta", indicadores: "conta"
    };
    const OCULTOS_CORRETOR = [ "alugado", "vendido", "indisponivel" ];
    let ctx = null;
    let ativo = false;
    let ligado = false;

    const h = v => ctx.h(v);
    const crm = () => window.SKLCRM && window.SKLCRM.interno;
    function lerEscolha() { try { return localStorage.getItem(CHAVE) === "1"; } catch { return false; } }
    function gravarEscolha(v) { try { v ? localStorage.setItem(CHAVE, "1") : localStorage.removeItem(CHAVE); } catch {} }

    // Chamado ao entrar na carteira. Devolve a página inicial.
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { ligarEventos(); ligado = true; }
        ativo = !ctx.central() || lerEscolha();
        aplicar();
        return ativo ? "hoje" : "dashboard";
    }
    function sair() {
        ativo = false;
        aplicar();
    }
    function aplicar() {
        document.body.classList.toggle("modo-corretor", ativo);
        $("corretorTabs").hidden = !ativo;
        const central = !!ctx && ctx.central();
        const botao = $("modoCorretorButton");
        botao.hidden = !ctx || !ctx.usuario() || !central;
        botao.textContent = ativo ? "↩ Tela da Central" : "📱 Modo corretor";
        $("contaVoltarCentral").hidden = !central;
        $("hojeAvisoCentral").hidden = !central;
    }
    function alternar() {
        if (!ctx || !ctx.central()) return;
        ativo = !ativo;
        gravarEscolha(ativo);
        aplicar();
        ctx.showPage(ativo ? "hoje" : "dashboard");
        ctx.toast(ativo ? "Modo corretor ligado neste aparelho. Você continua vendo tudo da Central." : "Voltou para a tela da Central.");
    }

    function ligarEventos() {
        $("corretorTabs").querySelectorAll("[data-ct-page]").forEach(b => b.addEventListener("click", () => {
            ctx.showPage(b.dataset.ctPage);
            window.scrollTo(0, 0);
        }));
        $("modoCorretorButton").addEventListener("click", alternar);
        $("contaVoltarCentral").addEventListener("click", alternar);
        $("contaSair").addEventListener("click", () => ctx.logout());
        $("contaTrocarCarteira").addEventListener("click", () => ctx.trocarCarteira());
        document.querySelectorAll("[data-hoje-acao]").forEach(b => b.addEventListener("click", () => acaoRapida(b.dataset.hojeAcao)));
        // o CRM avisa quando recarrega (Realtime, a cada 60 s, depois de salvar)
        document.addEventListener("skl-crm-render", () => { if (ativo) render(); });
    }
    function acaoRapida(qual) {
        const clicar = id => { const el = $(id); if (el) el.click(); };
        if (qual === "cliente") clicar("crmNovoCliButton");
        else if (qual === "negocio") clicar("crmNovaNegButton");
        else if (qual === "compromisso") clicar("crmNovoCompromisso");
        else if (qual === "imovel") ctx.novoCadastro();
        else if (qual === "buscar") { ctx.showPage("construcoes"); window.scrollTo(0, 0); const b = $("construcaoSearchInput"); if (b) b.focus(); }
    }

    function aoMostrar(pagina) {
        if (!ativo) return;
        const aba = ABA[pagina] || "";
        $("corretorTabs").querySelectorAll("[data-ct-page]").forEach(b => b.classList.toggle("ativo", b.dataset.ctPage === aba));
        if (pagina === "hoje" || pagina === "conta") render();
    }

    // ------------------------------------------------------------------ desenho
    function render() {
        if (!ctx || !ctx.usuario()) return;
        renderBadges();
        if ($("page-hoje").classList.contains("active-page")) renderHoje();
        if ($("page-conta").classList.contains("active-page")) renderConta();
    }
    function renderBadges() {
        const agenda = $("navAgendaBadge"), cad = $("navCadastrosBadge");
        const nA = agenda && !agenda.hidden ? Number(agenda.textContent) || 0 : 0;
        const nC = cad && !cad.hidden ? Number(cad.textContent) || 0 : 0;
        $("ctBadgeHoje").hidden = !nA; $("ctBadgeHoje").textContent = nA;
        $("ctBadgeConta").hidden = !nC; $("ctBadgeConta").textContent = nC;
    }
    function saudacao() {
        const hora = new Date().getHours();
        return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
    }
    function primeiroNome(nome) { return String(nome || "").trim().split(/\s+/)[0] || ""; }

    function renderHoje() {
        const eu = ctx.usuario();
        const central = ctx.central();
        $("hojeAvatar").innerHTML = ctx.fotoHtml(eu.id, 56);
        $("hojeSaudacao").textContent = `${saudacao()}, ${primeiroNome(eu.display_name)}`;
        const data = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
        $("hojeData").textContent = `${data.charAt(0).toUpperCase()}${data.slice(1)} · ${ctx.carteiraNome()}`;
        renderAgendaHoje(central);
        renderNumeros(central);
        renderCadastrosResumo(central);
        renderNovidades(central);
    }

    function renderAgendaHoje(central) {
        const I = crm();
        const lista = $("hojeAgenda");
        if (!I) { lista.innerHTML = `<div class="hoje-vazio">Agenda indisponível no momento.</div>`; return; }
        const abertas = [ ...I.negs.values() ].filter(n => n.situacao === "aberta");
        const fazer = abertas.filter(n => [ "atrasada", "hoje" ].includes(I.situacaoAcao(n)))
            .sort((a, b) => String(a.proxima_acao_em).localeCompare(String(b.proxima_acao_em)));
        const atrasadas = fazer.filter(n => I.situacaoAcao(n) === "atrasada").length;
        $("hojeAgendaContagem").textContent = fazer.length
            ? `${fazer.length} para hoje${atrasadas ? ` · ${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}` : ""}`
            : "";
        const mostrar = fazer.slice(0, 6);
        if (!mostrar.length) {
            const proxima = abertas.filter(n => I.situacaoAcao(n) === "futura")
                .sort((a, b) => String(a.proxima_acao_em).localeCompare(String(b.proxima_acao_em)))[0];
            const c = proxima && I.clientes.get(proxima.cliente_id);
            lista.innerHTML = `<div class="hoje-vazio"><strong>Nada pendente para hoje.</strong>${proxima
                ? `<span>Próximo: ${h(I.dataHora(proxima.proxima_acao_em))} · ${h(c ? c.nome : "Cliente")}${proxima.proxima_acao_texto ? " — " + h(proxima.proxima_acao_texto) : ""}</span>`
                : `<span>Toque em "+ Compromisso" para agendar um retorno.</span>`}</div>`;
            return;
        }
        lista.innerHTML = mostrar.map(n => {
            const c = I.clientes.get(n.cliente_id);
            const sit = I.situacaoAcao(n);
            const quando = sit === "atrasada" ? `Atrasada · ${I.dataHora(n.proxima_acao_em)}`
                : new Date(n.proxima_acao_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            return `<article class="hoje-item ${sit}" data-neg="${h(n.id)}">
              <div class="hoje-item-quando">${h(quando)}</div>
              <div class="hoje-item-info"><strong>${h(c ? c.nome : "Cliente")}</strong><small>${h(n.proxima_acao_texto || "Definir o próximo passo")}${central ? " · " + h(I.corretorDe(n.corretor_id)) : ""}</small></div>
              <div class="hoje-item-contato">${I.linksContato(c)}</div>
            </article>`;
        }).join("") + (fazer.length > mostrar.length ? `<button type="button" class="text-button hoje-mais" data-ir="agenda">Ver mais ${fazer.length - mostrar.length}</button>` : "");
        lista.querySelectorAll("[data-neg]").forEach(el => el.addEventListener("click", ev => {
            if (ev.target.closest("a")) return;
            I.abrirNegociacao(el.dataset.neg);
        }));
        lista.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => ctx.showPage(b.dataset.ir)));
    }

    function renderNumeros(central) {
        const I = crm();
        const caixa = $("hojeNumeros");
        if (!I) { caixa.innerHTML = ""; return; }
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const todas = [ ...I.negs.values() ];
        const abertas = todas.filter(n => n.situacao === "aberta");
        const ganhas = todas.filter(n => n.situacao === "ganha" && new Date(n.fechado_em) >= inicioMes);
        const semAcao = abertas.filter(n => I.situacaoAcao(n) === "sem").length;
        const soma = l => l.reduce((s, n) => s + (Number(n.valor) || 0), 0);
        const itens = [
            [ "Negócios em andamento", abertas.length, soma(abertas) ? I.dinheiroCurto(soma(abertas)) : "", "negociacoes" ],
            [ "Fechados no mês", ganhas.length, soma(ganhas) ? I.dinheiroCurto(soma(ganhas)) : "", "negociacoes" ],
            [ central ? "Clientes (equipe)" : "Meus clientes", I.clientes.size, "", "clientes" ],
            [ "Sem próximo passo", semAcao, semAcao ? "agende um retorno" : "", "agenda" ]
        ];
        caixa.innerHTML = itens.map(([ rotulo, valor, sub, pagina ]) =>
            `<button type="button" class="hoje-numero${rotulo === "Sem próximo passo" && valor ? " alerta" : ""}" data-ir="${pagina}"><span>${h(rotulo)}</span><strong>${h(valor)}</strong>${sub ? `<small>${h(sub)}</small>` : ""}</button>`).join("");
        caixa.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => { ctx.showPage(b.dataset.ir); window.scrollTo(0, 0); }));
    }

    function renderCadastrosResumo(central) {
        const eu = ctx.usuario();
        const caixa = $("hojeCadastros");
        const imoveis = ctx.imoveis();
        let html = "";
        if (central) {
            const pend = imoveis.filter(c => c.aprovacao === "pendente").length;
            if (pend) html = `<button type="button" class="hoje-aviso" data-ir="cadastros"><strong>${pend} cadastro${pend === 1 ? "" : "s"} aguardando aprovação</strong><span>Revisar agora ›</span></button>`;
        } else {
            const meus = imoveis.filter(c => c.cadastrado_por === eu.id);
            const recusados = meus.filter(c => c.aprovacao === "recusado").length;
            const pend = meus.filter(c => c.aprovacao === "pendente").length;
            const rasc = meus.filter(c => c.aprovacao === "rascunho").length;
            if (recusados) html += `<button type="button" class="hoje-aviso erro" data-ir="cadastros"><strong>${recusados} cadastro${recusados === 1 ? "" : "s"} recusado${recusados === 1 ? "" : "s"} pela Central</strong><span>Ver o motivo e corrigir ›</span></button>`;
            if (rasc) html += `<button type="button" class="hoje-aviso" data-ir="cadastros"><strong>${rasc} rascunho${rasc === 1 ? "" : "s"} ainda não enviado${rasc === 1 ? "" : "s"}</strong><span>Completar e enviar ›</span></button>`;
            if (pend) html += `<button type="button" class="hoje-aviso neutro" data-ir="cadastros"><strong>${pend} cadastro${pend === 1 ? "" : "s"} em análise na Central</strong><span>Acompanhar ›</span></button>`;
        }
        caixa.innerHTML = html;
        caixa.hidden = !html;
        caixa.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => { ctx.showPage(b.dataset.ir); window.scrollTo(0, 0); }));
    }

    function precoTexto(c) {
        const partes = [];
        if (c.para_venda && c.valor_venda) partes.push(ctx.precoCurto(c.valor_venda));
        if (c.para_aluguel !== false && c.valor_aluguel) partes.push(ctx.precoCurto(c.valor_aluguel) + "/mês");
        return partes.join(" · ") || "Valor a consultar";
    }
    function renderNovidades(central) {
        const lista = ctx.imoveis()
            .filter(c => c.aprovacao === "aprovado" && (central ? c.status === "disponivel" : !OCULTOS_CORRETOR.includes(c.status)))
            .sort((a, b) => String(b.aprovado_em || b.created_at || "").localeCompare(String(a.aprovado_em || a.created_at || "")))
            .slice(0, 10);
        $("hojeNovidadesBloco").hidden = !lista.length;
        $("hojeNovidades").innerHTML = lista.map(c => `<button type="button" class="hoje-imovel" data-imovel="${h(c.id)}">
            <span class="hoje-imovel-foto" data-hoje-foto="${h(c.id)}">${(c.fotos || []).length ? "" : `<span class="sem-foto">Sem foto</span>`}</span>
            <strong>${h(c.nome)}</strong>
            <small>${h([ c.tipo_imovel, c.bairro ].filter(Boolean).join(" · "))}</small>
            <em>${h(precoTexto(c))}</em>
          </button>`).join("");
        $("hojeNovidades").querySelectorAll("[data-imovel]").forEach(b => b.addEventListener("click", () => ctx.abrirImovel(b.dataset.imovel)));
        lista.forEach(c => ctx.preencherFotoCapa(c, `[data-hoje-foto="${CSS.escape(c.id)}"]`));
    }

    function renderConta() {
        const eu = ctx.usuario();
        $("contaAvatar").innerHTML = ctx.fotoHtml(eu.id, 72);
        $("contaNome").textContent = eu.display_name;
        $("contaPapel").textContent = `${ctx.papelTexto()} · ${ctx.carteiraNome()}`;
        $("contaCadastrosTexto").textContent = ctx.central() ? "Cadastros dos corretores" : "Meus cadastros de imóveis";
        const cad = $("navCadastrosBadge");
        const n = cad && !cad.hidden ? Number(cad.textContent) || 0 : 0;
        $("contaCadastrosBadge").hidden = !n;
        $("contaCadastrosBadge").textContent = n;
        $("contaVersao").textContent = ctx.versao();
    }

    window.SKLModoCorretor = { iniciar, sair, aoMostrar, render, ativo: () => ativo };
})();
