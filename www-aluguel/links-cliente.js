// Links que avisam (17/11/2026) — ideia da DWV/ImobiBrasil, sem custo. Banco: migration links_rastreados_selecao_campanhas.
//  * Seleção para o cliente: vários imóveis num link só (até 30). A página pública mostra a lista, a ficha de cada um e
//    o botão "❤ Gostei". O corretor recebe aviso no sino quando o cliente abre (e quando volta depois de 12 h) e quando gosta.
//    O "Enviar ao cliente" de um imóvel também gera um link desses (crm-extras.js).
//  * Links enviados: lista com aberto / não aberto / gostei e, para quem vê a equipe toda, o ranking por corretor.
//  * Campanhas para a equipe: a Central/gestor publica; aparece no topo do Hoje e da Visão geral e manda aviso.
//    Liga/desliga em Configurações → Funções da imobiliária ("campanhas").
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinheiro = v => v == null || v === "" ? "" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const digitos = v => String(v || "").replace(/\D/g, "");
    const DISPONIVEIS = [ "disponivel", "reservado", "em_negociacao" ];
    const MAX = 30, MAX_CAMP = 20;
    let ctx = null, sel = [], selOp = {}, linkAtual = null, nomesEquipe = new Map(), campanhas = [], camp = null, campImoveis = [], canal = null;

    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const toast = t => ctx.toast(t);
    const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const dataBr = iso => iso ? new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "";
    const quando = iso => {
        if (!iso) return "";
        const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
        if (min < 2) return "agora há pouco";
        if (min < 60) return `há ${min} min`;
        if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
        return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    };
    const imovelPorId = id => ctx.imoveis().find(i => i.id === id);
    const rotulo = i => i ? `${i.codigo ? i.codigo + " · " : ""}${i.nome}` : "imóvel que saiu da lista";
    const podeEntrar = i => i && i.codigo && (i.aprovacao || "aprovado") === "aprovado" && DISPONIVEIS.includes(i.status);
    const campanhasLigadas = () => !window.SKLFuncoes || window.SKLFuncoes.ativa("campanhas");
    const publicaCampanha = () => !!(ctx.veTudo && ctx.veTudo()) && ctx.papel() !== "financeiro";
    function precoCurto(i) {
        const ap = i.valor_a_partir ? "a partir de " : "";
        const p = [];
        if (i.para_aluguel && i.valor_aluguel) p.push(`Aluguel ${ap}${dinheiro(i.valor_aluguel)}`);
        if (i.para_venda && i.valor_venda) p.push(`Venda ${ap}${dinheiro(i.valor_venda)}`);
        return p.join(" | ");
    }

    // ------------------------------------------------------------------ montagem
    function montar() {
        if ($("lnkSelDialog")) return;
        const caixa = document.createElement("div");
        caixa.innerHTML = `
<dialog id="lnkSelDialog" class="crm-dialog lnk-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">SELEÇÃO PARA O CLIENTE</span><h2>Vários imóveis num link só</h2>
  <p class="muted-text">O cliente recebe um link com a lista: abre a ficha de cada imóvel e toca em ❤ nos que gostar. Você recebe aviso quando ele abre e quando gosta.</p>
  <label><span>Adicionar imóvel</span><input id="lnkSelBusca" type="search" placeholder="Código, nome, bairro ou edifício" autocomplete="off" /></label>
  <div id="lnkSelResultados" class="lnk-resultados"></div>
  <div class="lnk-sel-topo"><strong id="lnkSelQtd">Nenhum imóvel escolhido</strong></div>
  <div id="lnkSelLista" class="lnk-lista"></div>
  <div class="lnk-campos">
    <label><span>Título da seleção</span><input id="lnkSelTitulo" maxlength="120" placeholder="Imóveis selecionados para você" /></label>
    <label><span>Nome do cliente (aparece só para você)</span><input id="lnkSelCliente" list="lnkSelClientes" maxlength="120" autocomplete="off" placeholder="🔎 Nome ou cliente cadastrado" /></label>
    <datalist id="lnkSelClientes"></datalist>
    <label><span>Telefone do cliente (WhatsApp)</span><input id="lnkSelTel" inputmode="tel" placeholder="(66) 99999-0000" autocomplete="off" /></label>
  </div>
  <label class="check-inline"><input id="lnkSelLocal" type="checkbox" /> Incluir endereço e mapa dos imóveis</label>
  <p id="lnkSelMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="lnkSelGerar" type="button" class="primary-button">Gerar link e mensagem</button></div>
  <div id="lnkSelPronto" hidden>
    <label><span>Mensagem</span><textarea id="lnkSelTexto" rows="9"></textarea></label>
    <div class="dialog-actions"><button id="lnkSelCopiar" type="button" class="secondary-button">Copiar texto</button><button id="lnkSelWhats" type="button" class="primary-button">Abrir WhatsApp</button></div>
  </div>
</form></dialog>
<dialog id="lnkEnvDialog" class="crm-dialog lnk-dialog lnk-dialog-largo"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">LINKS ENVIADOS AOS CLIENTES</span><h2>Quem abriu e do que gostou</h2>
  <div class="lnk-filtros">
    <select id="lnkEnvPeriodo" aria-label="Período"><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Último ano</option><option value="">Tudo</option></select>
    <select id="lnkEnvQuem" aria-label="De quem"><option value="meus">Só os meus</option><option value="todos">Toda a equipe</option></select>
    <button id="lnkEnvNova" type="button" class="secondary-button">🧺 Nova seleção</button>
  </div>
  <div id="lnkRanking"></div>
  <div id="lnkEnvLista" class="lnk-env-lista"></div>
</form></dialog>
<dialog id="lnkCampDialog" class="crm-dialog lnk-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">CAMPANHA PARA A EQUIPE</span><h2 id="lnkCampTitulo">Nova campanha</h2>
  <label><span>Título</span><input id="lnkCampNome" maxlength="120" placeholder="Ex.: Captação de casas no Village" /></label>
  <label><span>Texto</span><textarea id="lnkCampTexto" rows="4" maxlength="2000" placeholder="O que a equipe precisa saber: meta, bônus, prazo, imóveis em destaque…"></textarea></label>
  <div class="lnk-campos"><label><span>Começa em</span><input id="lnkCampInicio" type="date" /></label><label><span>Termina em (opcional)</span><input id="lnkCampFim" type="date" /></label></div>
  <label><span>Imóveis em destaque (opcional, até ${MAX_CAMP})</span><input id="lnkCampBusca" type="search" placeholder="Código, nome ou bairro" autocomplete="off" /></label>
  <div id="lnkCampResultados" class="lnk-resultados"></div>
  <div id="lnkCampChips" class="lnk-chips"></div>
  <label class="check-inline" id="lnkCampAvisarLinha" hidden><input id="lnkCampAvisar" type="checkbox" /> Avisar a equipe de novo</label>
  <p id="lnkCampMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="lnkCampExcluir" type="button" class="danger-button" hidden>Excluir</button><button id="lnkCampSalvar" type="button" class="primary-button">Publicar</button></div>
</form></dialog>`;
        while (caixa.firstElementChild) document.body.appendChild(caixa.firstElementChild);
        document.querySelectorAll(".lnk-dialog [data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
        $("lnkSelBusca").addEventListener("input", () => resultados("lnkSelBusca", "lnkSelResultados", sel.map(i => i.id), adicionar));
        $("lnkSelGerar").addEventListener("click", gerar);
        $("lnkSelCopiar").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("lnkSelTexto").value); toast("Texto copiado."); } catch { toast("Selecione o texto e copie."); } marcarEnviado(); });
        $("lnkSelWhats").addEventListener("click", abrirWhats);
        $("lnkSelCliente").addEventListener("change", usarClienteCadastrado);
        [ "lnkSelTitulo", "lnkSelCliente", "lnkSelLocal" ].forEach(id => $(id).addEventListener("input", desfazerPronto));
        $("lnkSelLocal").addEventListener("change", desfazerPronto);
        $("lnkEnvPeriodo").addEventListener("change", () => carregarEnviados());
        $("lnkEnvQuem").addEventListener("change", () => carregarEnviados());
        $("lnkEnvNova").addEventListener("click", () => { $("lnkEnvDialog").close(); abrirSelecao([]); });
        $("lnkCampBusca").addEventListener("input", () => resultados("lnkCampBusca", "lnkCampResultados", campImoveis, id => { if (campImoveis.length >= MAX_CAMP) { toast(`No máximo ${MAX_CAMP} imóveis por campanha.`); return; } campImoveis.push(id); $("lnkCampBusca").value = ""; $("lnkCampResultados").innerHTML = ""; chipsCampanha(); }, true));
        $("lnkCampSalvar").addEventListener("click", salvarCampanha);
        $("lnkCampExcluir").addEventListener("click", excluirCampanha);
    }
    // botões nas telas: Imóveis (barra de ações), Conta do corretor; quadros de campanha no Hoje e na Visão geral
    function botoes() {
        const novo = $("newConstrucaoButton");
        if (novo && !$("lnkBtnSelecao")) {
            const b1 = document.createElement("button");
            b1.id = "lnkBtnSelecao"; b1.type = "button"; b1.className = "secondary-button"; b1.textContent = "🧺 Seleção para cliente";
            b1.title = "Mande vários imóveis num link só e saiba quando o cliente abre";
            b1.addEventListener("click", () => abrirSelecao([]));
            const b2 = document.createElement("button");
            b2.id = "lnkBtnEnviados"; b2.type = "button"; b2.className = "text-button"; b2.textContent = "📨 Links enviados";
            b2.addEventListener("click", () => abrirEnviados());
            novo.parentNode.insertBefore(b1, novo);
            novo.parentNode.insertBefore(b2, b1);
        }
        const ancora = $("contaIrPropostas");
        if (ancora && !$("contaLinks")) {
            const b = document.createElement("button");
            b.type = "button"; b.id = "contaLinks";
            b.innerHTML = `<span>📨</span><em>Links enviados aos clientes</em><i>›</i>`;
            b.addEventListener("click", () => abrirEnviados());
            ancora.parentNode.insertBefore(b, ancora);
        }
        const atalhos = document.querySelector("#page-hoje .hoje-atalhos");
        if (atalhos && !$("lnkCampHoje")) { const s = document.createElement("section"); s.id = "lnkCampHoje"; s.className = "lnk-camp-quadro"; s.hidden = true; atalhos.after(s); }
        const metricas = document.querySelector("#page-dashboard .metric-grid");
        if (metricas && !$("lnkCampDash")) { const s = document.createElement("section"); s.id = "lnkCampDash"; s.className = "lnk-camp-quadro"; s.hidden = true; metricas.before(s); }
    }

    async function iniciar(contexto) {
        ctx = contexto;
        sel = []; linkAtual = null; campanhas = [];
        montar();
        botoes();
        $("lnkEnvQuem").closest("select").hidden = !(ctx.veTudo && ctx.veTudo());
        try {
            const { data } = await ctx.sb.rpc("equipe_da_carteira", { p_carteira: ctx.carteiraId() });
            nomesEquipe = new Map((data || []).map(p => [ p.id, p.apelido || p.nome ]));
        } catch { nomesEquipe = new Map(); }
        carregarCampanhas();
        ligarTempoReal();
    }
    function sair() {
        if (canal && ctx) ctx.sb.removeChannel(canal);
        canal = null; ctx = null; sel = []; campanhas = [];
        [ "lnkCampHoje", "lnkCampDash" ].forEach(id => { const e = $(id); if (e) { e.hidden = true; e.innerHTML = ""; } });
    }
    function ligarTempoReal() {
        if (canal) ctx.sb.removeChannel(canal);
        canal = ctx.sb.channel(`campanhas-${ctx.carteiraId()}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "equipe_campanhas", filter: `carteira_id=eq.${ctx.carteiraId()}` }, () => carregarCampanhas())
            .subscribe();
    }

    // ------------------------------------------------------------------ busca de imóveis (seleção e campanha)
    function resultados(inputId, boxId, jaEscolhidos, aoEscolher, todosStatus) {
        const termo = $(inputId).value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
        const box = $(boxId);
        if (termo.length < 2) { box.innerHTML = ""; return; }
        const achados = ctx.imoveis()
            .filter(i => (todosStatus ? i.codigo : podeEntrar(i)) && !jaEscolhidos.includes(i.id))
            .filter(i => [ i.codigo, i.nome, i.bairro, i.edificio, i.cidade, i.tipo_imovel ].filter(Boolean).join(" ")
                .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(termo))
            .slice(0, 8);
        box.innerHTML = achados.length ? achados.map(i => `<button type="button" class="lnk-res" data-id="${h(i.id)}">
              <span class="lnk-foto" data-foto-id="${h(i.id)}"></span><span><strong>${h(rotulo(i))}</strong><small>${h([ i.bairro, precoCurto(i) ].filter(Boolean).join(" · "))}</small></span><b>+ Adicionar</b></button>`).join("")
            : `<p class="muted-text">Nenhum imóvel disponível com esse nome ou código.</p>`;
        box.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => aoEscolher(b.dataset.id)));
        fotos(box, achados);
    }
    function fotos(box, imoveis) {
        if (!ctx.fotosCapa || !imoveis.length) return;
        ctx.fotosCapa(imoveis).then(mapa => box.querySelectorAll("[data-foto-id]").forEach(el => {
            const u = mapa.get(el.dataset.fotoId);
            if (u) el.style.backgroundImage = `url("${u}")`;
        })).catch(() => {});
    }

    // ------------------------------------------------------------------ seleção para o cliente
    // op: { clienteId, clienteNome, telefone, negociacaoId }
    function abrirSelecao(ids, op) {
        if (!ctx) return;
        selOp = op || {};
        sel = [];
        (ids || []).forEach(id => { const i = imovelPorId(id); if (podeEntrar(i) && sel.length < MAX && !sel.some(x => x.id === id)) sel.push(i); });
        const fora = (ids || []).length - sel.length;
        $("lnkSelBusca").value = "";
        $("lnkSelResultados").innerHTML = "";
        $("lnkSelTitulo").value = "";
        $("lnkSelCliente").value = selOp.clienteNome || "";
        $("lnkSelTel").value = selOp.telefone || "";
        $("lnkSelLocal").checked = false;
        prepararClientes();
        desfazerPronto();
        desenharSelecao();
        msg(fora > 0 ? `${fora} imóvel(is) ficaram de fora: precisam estar aprovados, com código e disponíveis.` : "");
        $("lnkSelDialog").showModal();
    }
    function msg(t) { $("lnkSelMsg").textContent = t; $("lnkSelMsg").hidden = !t; }
    function adicionar(id) {
        if (sel.length >= MAX) { toast(`No máximo ${MAX} imóveis por link.`); return; }
        const i = imovelPorId(id);
        if (!podeEntrar(i)) return;
        sel.push(i);
        $("lnkSelBusca").value = "";
        $("lnkSelResultados").innerHTML = "";
        desfazerPronto();
        desenharSelecao();
        $("lnkSelBusca").focus();
    }
    function desenharSelecao() {
        $("lnkSelQtd").textContent = sel.length ? `${sel.length} imóve${sel.length === 1 ? "l" : "is"} na seleção` : "Nenhum imóvel escolhido";
        $("lnkSelLista").innerHTML = sel.map((i, k) => `<div class="lnk-item">
            <span class="lnk-foto" data-foto-id="${h(i.id)}"></span>
            <span class="lnk-item-info"><strong>${h(rotulo(i))}</strong><small>${h([ i.bairro, precoCurto(i) ].filter(Boolean).join(" · "))}</small></span>
            <span class="lnk-item-acoes">
              <button type="button" class="text-button" data-sobe="${k}" ${k ? "" : "disabled"} aria-label="Subir">↑</button>
              <button type="button" class="text-button" data-desce="${k}" ${k < sel.length - 1 ? "" : "disabled"} aria-label="Descer">↓</button>
              <button type="button" class="text-button lnk-tirar" data-tira="${k}" aria-label="Tirar">×</button>
            </span></div>`).join("");
        $("lnkSelLista").querySelectorAll("[data-sobe]").forEach(b => b.addEventListener("click", () => { const k = +b.dataset.sobe; [ sel[k - 1], sel[k] ] = [ sel[k], sel[k - 1] ]; desfazerPronto(); desenharSelecao(); }));
        $("lnkSelLista").querySelectorAll("[data-desce]").forEach(b => b.addEventListener("click", () => { const k = +b.dataset.desce; [ sel[k + 1], sel[k] ] = [ sel[k], sel[k + 1] ]; desfazerPronto(); desenharSelecao(); }));
        $("lnkSelLista").querySelectorAll("[data-tira]").forEach(b => b.addEventListener("click", () => { sel.splice(+b.dataset.tira, 1); desfazerPronto(); desenharSelecao(); }));
        fotos($("lnkSelLista"), sel);
        $("lnkSelGerar").disabled = !sel.length;
    }
    // qualquer mudança depois de gerar pede um link novo (o link guarda os imóveis escolhidos)
    function desfazerPronto() {
        if (linkAtual) { linkAtual = null; }
        $("lnkSelPronto").hidden = true;
        $("lnkSelGerar").hidden = false;
    }
    let clientesSel = [];
    const rotCli = c => `${c.nome}${c.telefone ? " — " + c.telefone : ""}`;
    function prepararClientes() {
        const I = window.SKLCRM && window.SKLCRM.interno;
        clientesSel = I && I.clientes ? [ ...I.clientes.values() ].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")) : [];
        $("lnkSelClientes").innerHTML = clientesSel.slice(0, 500).map(c => `<option value="${h(rotCli(c))}"></option>`).join("");
    }
    function usarClienteCadastrado() {
        const c = clientesSel.find(x => rotCli(x) === $("lnkSelCliente").value);
        if (!c) { selOp.clienteId = null; return; }
        selOp.clienteId = c.id;
        $("lnkSelCliente").value = c.nome;
        if (c.telefone && !digitos($("lnkSelTel").value)) $("lnkSelTel").value = c.telefone;
    }
    async function telefoneDoCorretor() {
        try {
            const { data } = await ctx.sb.from("perfis").select("telefone").eq("id", (ctx.usuario() || {}).id).maybeSingle();
            const t = digitos(data && data.telefone);
            return t.length >= 10 ? t : "";
        } catch { return ""; }
    }
    async function urlDoLink(itens, chave) {
        if (!window.SKLIntegracoes) return null;
        let url;
        if (itens.length === 1) {
            const i = itens[0];
            url = await window.SKLIntegracoes.linkPublico(i.codigo, { semPrevia: !i.publicar_site });
            if (url) url += "&e=" + encodeURIComponent(chave);
        } else url = await window.SKLIntegracoes.linkSelecao(chave);
        if (!url) return null;
        const tel = await telefoneDoCorretor();
        return tel ? url + "&w=" + tel : url;
    }
    function textoSelecao(url) {
        const nome = $("lnkSelCliente").value.trim().split(/\s+/)[0];
        const linhas = [ `Olá${nome ? ", " + nome : ""}! Separei ${sel.length === 1 ? "este imóvel" : sel.length + " imóveis"} para você:`, "" ];
        // o link vem logo no começo: o WhatsApp mostra a prévia do primeiro link da mensagem
        linhas.push(`📸 Fotos e detalhes: ${url}`, "");
        sel.forEach(i => linhas.push(`🏠 ${rotulo(i)}${i.bairro ? " — " + i.bairro : ""}${precoCurto(i) ? " · " + precoCurto(i) : ""}`));
        linhas.push("", sel.length > 1 ? "Toque em ❤ nos que você gostar que eu já organizo as visitas." : "Toque em ❤ se gostar que eu já organizo a visita.");
        const eu = ctx.usuario() || {};
        linhas.push(`— ${eu.apelido || eu.display_name || ""}, ${ctx.carteiraNome()}`);
        return linhas.join("\n");
    }
    async function gerar() {
        if (!sel.length) { msg("Escolha pelo menos um imóvel."); return; }
        msg("");
        const b = $("lnkSelGerar");
        b.disabled = true; b.textContent = "Gerando…";
        try {
            const dados = { titulo: $("lnkSelTitulo").value.trim() || null, cliente_nome: $("lnkSelCliente").value.trim() || null,
                cliente_id: selOp.clienteId || null, negociacao_id: selOp.negociacaoId || null, com_localizacao: $("lnkSelLocal").checked };
            const { data, error } = await ctx.sb.rpc("imovel_link_criar", { p_carteira: ctx.carteiraId(), p_itens: sel.map(i => i.id), p_dados: dados });
            if (error) { msg(erro(error)); return; }
            const url = await urlDoLink(sel, data.chave);
            if (!url) { msg("Sem link: a vitrine de imóveis está desligada (Configurações → Site e portais). Peça para a Central ligar."); return; }
            linkAtual = { id: data.id, chave: data.chave, url };
            $("lnkSelTexto").value = textoSelecao(url);
            $("lnkSelPronto").hidden = false;
            b.hidden = true;
            rotuloWhats();
        } finally { b.disabled = !sel.length; b.textContent = "Gerar link e mensagem"; }
    }
    function rotuloWhats() { $("lnkSelWhats").textContent = digitos($("lnkSelTel").value).length >= 10 ? "Abrir WhatsApp" : "Escolher o contato no WhatsApp"; }
    function marcarEnviado() {
        if (linkAtual) ctx.sb.rpc("imovel_link_atualizar", { p_link: linkAtual.id, p_dados: { enviado: true } }).then(() => {}, () => {});
    }
    function abrirWhats() {
        const texto = $("lnkSelTexto").value.trim();
        if (!texto) return;
        const d = digitos($("lnkSelTel").value);
        const t = encodeURIComponent(texto);
        window.open(d.length >= 10 ? `https://wa.me/55${d}?text=${t}` : `https://wa.me/?text=${t}`, "_blank", "noopener");
        marcarEnviado();
    }

    // ------------------------------------------------------------------ links enviados + ranking
    let destacar = null, enviados = [];
    async function abrirEnviados(linkId) {
        if (!ctx) return;
        destacar = linkId || null;
        if (destacar) { $("lnkEnvPeriodo").value = ""; }
        $("lnkEnvQuem").hidden = !(ctx.veTudo && ctx.veTudo());
        if (!ctx.veTudo || !ctx.veTudo()) $("lnkEnvQuem").value = "meus";
        $("lnkEnvLista").innerHTML = `<p class="muted-text">Carregando…</p>`;
        $("lnkRanking").innerHTML = "";
        if (!$("lnkEnvDialog").open) $("lnkEnvDialog").showModal();
        await carregarEnviados();
    }
    async function carregarEnviados() {
        const dias = $("lnkEnvPeriodo").value;
        const meus = $("lnkEnvQuem").value === "meus";
        let q = ctx.sb.from("imovel_links").select("id,chave,itens,titulo,cliente_nome,criado_por,enviado_em,aberturas,primeira_abertura,ultima_abertura,vistos,gostei,expira_em")
            .eq("carteira_id", ctx.carteiraId()).not("enviado_em", "is", null).order("enviado_em", { ascending: false }).limit(500);
        if (dias) q = q.gte("enviado_em", new Date(Date.now() - dias * 86400000).toISOString());
        if (meus) q = q.eq("criado_por", (ctx.usuario() || {}).id);
        const { data, error } = await q;
        if (error) { $("lnkEnvLista").innerHTML = `<p class="form-message">${h(erro(error))}</p>`; return; }
        enviados = data || [];
        desenharRanking(meus);
        desenharEnviados();
    }
    function desenharRanking(meus) {
        const box = $("lnkRanking");
        const n = enviados.length, abertos = enviados.filter(l => l.aberturas > 0).length, gostei = enviados.reduce((s, l) => s + (l.gostei || []).length, 0);
        const resumo = `<div class="lnk-resumo"><div><strong>${n}</strong><span>enviados</span></div><div><strong>${abertos}</strong><span>abertos</span></div>
            <div><strong>${n ? Math.round(abertos / n * 100) : 0}%</strong><span>abriram</span></div><div><strong>${gostei}</strong><span>❤ gostei</span></div></div>`;
        if (meus || !(ctx.veTudo && ctx.veTudo())) { box.innerHTML = resumo; return; }
        const por = new Map();
        enviados.forEach(l => {
            const k = l.criado_por || "—";
            const r = por.get(k) || { envios: 0, abertos: 0, gostei: 0 };
            r.envios++; if (l.aberturas > 0) r.abertos++; r.gostei += (l.gostei || []).length;
            por.set(k, r);
        });
        const linhas = [ ...por.entries() ].sort((a, b) => b[1].abertos - a[1].abertos || b[1].envios - a[1].envios);
        box.innerHTML = resumo + (linhas.length ? `<table class="lnk-ranking"><thead><tr><th>Corretor</th><th>Enviados</th><th>Abertos</th><th>% aberto</th><th>❤ Gostei</th></tr></thead><tbody>
            ${linhas.map(([ k, r ]) => `<tr><td>${h(nomesEquipe.get(k) || "Quem saiu da equipe")}</td><td>${r.envios}</td><td>${r.abertos}</td><td>${Math.round(r.abertos / r.envios * 100)}%</td><td>${r.gostei}</td></tr>`).join("")}</tbody></table>` : "");
    }
    function desenharEnviados() {
        const box = $("lnkEnvLista");
        const meus = $("lnkEnvQuem").value === "meus";
        if (!enviados.length) { box.innerHTML = `<p class="muted-text">Nenhum link enviado neste período. Use "Enviar ao cliente" num imóvel ou "🧺 Nova seleção".</p>`; return; }
        box.innerHTML = enviados.map(l => {
            const itens = (l.itens || []).map(imovelPorId);
            const titulo = l.titulo || (itens.length === 1 ? rotulo(itens[0]) : `${itens.length} imóveis`);
            const gostou = (l.gostei || []).map(id => rotulo(imovelPorId(id)));
            const status = l.aberturas > 0
                ? `<span class="lnk-st aberto">👀 Aberto ${l.aberturas}x · último ${h(quando(l.ultima_abertura))}</span>`
                : `<span class="lnk-st">Ainda não abriu</span>`;
            const vencido = new Date(l.expira_em) < new Date();
            return `<article class="lnk-env${l.id === destacar ? " destaque" : ""}" data-link="${h(l.id)}">
              <header><strong>${h(l.cliente_nome || "Cliente sem nome")}</strong><small>${h(dataBr(l.enviado_em))}${!meus ? " · " + h(nomesEquipe.get(l.criado_por) || "—") : ""}</small></header>
              <p>${h(titulo)}${itens.length > 1 && l.titulo ? ` <small>(${itens.length} imóveis)</small>` : ""}</p>
              <div class="lnk-env-st">${status}${gostou.length ? `<span class="lnk-st gostei">❤ ${h(gostou.join(", "))}</span>` : ""}${vencido ? `<span class="lnk-st">link vencido</span>` : ""}</div>
              <div class="lnk-env-acoes">${!vencido ? `<button type="button" class="secondary-button fin-mini" data-copiar="${h(l.id)}">Copiar link</button>` : ""}
                ${l.criado_por === (ctx.usuario() || {}).id || (ctx.veTudo && ctx.veTudo()) ? `<button type="button" class="text-button" data-apagar="${h(l.id)}">Apagar</button>` : ""}</div>
            </article>`;
        }).join("");
        box.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", () => copiarDeNovo(b.dataset.copiar)));
        box.querySelectorAll("[data-apagar]").forEach(b => b.addEventListener("click", () => apagar(b.dataset.apagar)));
        const d = destacar && box.querySelector(".lnk-env.destaque");
        if (d) d.scrollIntoView({ block: "center" });
    }
    async function copiarDeNovo(id) {
        const l = enviados.find(x => x.id === id);
        if (!l) return;
        const itens = (l.itens || []).map(imovelPorId).filter(Boolean);
        if (!itens.length) { toast("Os imóveis deste link não estão mais disponíveis."); return; }
        const url = await urlDoLink(l.itens.length === 1 ? itens : [ {}, {} ], l.chave);
        if (!url) { toast("A vitrine de imóveis está desligada."); return; }
        try { await navigator.clipboard.writeText(url); toast("Link copiado. É o mesmo link: as aberturas continuam contando."); }
        catch { window.prompt("Copie o link:", url); }
    }
    async function apagar(id) {
        if (!window.confirm("Apagar este link? O cliente não consegue mais abrir.")) return;
        const { error } = await ctx.sb.rpc("imovel_link_excluir", { p_link: id });
        if (error) { toast(erro(error)); return; }
        enviados = enviados.filter(l => l.id !== id);
        desenharRanking($("lnkEnvQuem").value === "meus");
        desenharEnviados();
    }

    // ------------------------------------------------------------------ campanhas para a equipe
    async function carregarCampanhas() {
        if (!ctx) return;
        if (!campanhasLigadas()) { campanhas = []; desenharCampanhas(); return; }
        const { data, error } = await ctx.sb.from("equipe_campanhas").select("*").eq("carteira_id", ctx.carteiraId())
            .order("inicio", { ascending: false }).limit(60);
        campanhas = error ? [] : (data || []);
        desenharCampanhas();
    }
    function desenharCampanhas() {
        const hoje = hojeIso(), gestor = publicaCampanha();
        const ativas = campanhas.filter(c => c.inicio <= hoje && (!c.fim || c.fim >= hoje));
        const futuras = gestor ? campanhas.filter(c => c.inicio > hoje) : [];
        const lista = [ ...ativas, ...futuras ];
        const html = !campanhasLigadas() ? "" : (lista.length || gestor) ? `<header><span class="eyebrow">📣 CAMPANHAS DA EQUIPE</span>${gestor ? `<button type="button" class="text-button" data-camp-nova>+ Nova campanha</button>` : ""}</header>
            ${lista.length ? lista.map(c => `<article class="lnk-camp${c.inicio > hoje ? " futura" : ""}">
              <div class="lnk-camp-topo"><strong>${h(c.titulo)}</strong><small>${c.inicio > hoje ? "começa em " + h(dataBr(c.inicio)) : c.fim ? "até " + h(dataBr(c.fim)) : "sem data para acabar"}</small>
                ${gestor ? `<button type="button" class="text-button" data-camp-editar="${h(c.id)}">✎ Editar</button>` : ""}</div>
              ${c.texto ? `<p>${h(c.texto)}</p>` : ""}
              ${(c.imoveis || []).length ? `<div class="lnk-chips">${c.imoveis.map(id => { const i = imovelPorId(id); return i ? `<button type="button" class="lnk-chip" data-camp-imovel="${h(id)}">${h(rotulo(i))}</button>` : ""; }).join("")}</div>` : ""}
            </article>`).join("") : `<p class="muted-text">Nenhuma campanha ativa. Publique metas, bônus ou imóveis em destaque: a equipe vê aqui e recebe aviso.</p>`}` : "";
        [ "lnkCampHoje", "lnkCampDash" ].forEach(id => {
            const box = $(id);
            if (!box) return;
            box.innerHTML = html;
            box.hidden = !html || (!lista.length && id === "lnkCampHoje" && !gestor);
            box.querySelectorAll("[data-camp-nova]").forEach(b => b.addEventListener("click", () => abrirCampanha(null)));
            box.querySelectorAll("[data-camp-editar]").forEach(b => b.addEventListener("click", () => abrirCampanha(campanhas.find(c => c.id === b.dataset.campEditar))));
            box.querySelectorAll("[data-camp-imovel]").forEach(b => b.addEventListener("click", () => ctx.abrirImovel && ctx.abrirImovel(b.dataset.campImovel)));
        });
    }
    function abrirCampanha(c) {
        camp = c || null;
        campImoveis = c ? [ ...(c.imoveis || []) ] : [];
        $("lnkCampTitulo").textContent = c ? "Editar campanha" : "Nova campanha";
        $("lnkCampNome").value = c ? c.titulo : "";
        $("lnkCampTexto").value = c ? (c.texto || "") : "";
        $("lnkCampInicio").value = c ? c.inicio : hojeIso();
        $("lnkCampFim").value = c && c.fim ? c.fim : "";
        $("lnkCampBusca").value = "";
        $("lnkCampResultados").innerHTML = "";
        $("lnkCampAvisarLinha").hidden = !c;
        $("lnkCampAvisar").checked = false;
        $("lnkCampExcluir").hidden = !c;
        $("lnkCampSalvar").textContent = c ? "Salvar" : "Publicar e avisar a equipe";
        $("lnkCampMsg").hidden = true;
        chipsCampanha();
        $("lnkCampDialog").showModal();
    }
    function chipsCampanha() {
        $("lnkCampChips").innerHTML = campImoveis.map((id, k) => `<span class="lnk-chip">${h(rotulo(imovelPorId(id)))}<button type="button" data-tira="${k}" aria-label="Tirar">×</button></span>`).join("");
        $("lnkCampChips").querySelectorAll("[data-tira]").forEach(b => b.addEventListener("click", () => { campImoveis.splice(+b.dataset.tira, 1); chipsCampanha(); }));
    }
    async function salvarCampanha() {
        const m = $("lnkCampMsg");
        const dados = { titulo: $("lnkCampNome").value.trim(), texto: $("lnkCampTexto").value.trim(), inicio: $("lnkCampInicio").value,
            fim: $("lnkCampFim").value, imoveis: campImoveis, avisar: $("lnkCampAvisar").checked };
        if (!dados.titulo) { m.textContent = "Escreva o título da campanha."; m.hidden = false; return; }
        const b = $("lnkCampSalvar");
        b.disabled = true;
        const { error } = await ctx.sb.rpc("campanha_salvar", { p_carteira: ctx.carteiraId(), p_id: camp ? camp.id : null, p_dados: dados });
        b.disabled = false;
        if (error) { m.textContent = erro(error); m.hidden = false; return; }
        $("lnkCampDialog").close();
        toast(camp ? "Campanha salva." : "Campanha publicada. A equipe recebe o aviso.");
        carregarCampanhas();
    }
    async function excluirCampanha() {
        if (!camp || !window.confirm("Excluir esta campanha? Ela some para toda a equipe.")) return;
        const { error } = await ctx.sb.rpc("campanha_excluir", { p_id: camp.id });
        if (error) { toast(erro(error)); return; }
        $("lnkCampDialog").close();
        carregarCampanhas();
    }
    function irCampanhas() {
        if (!ctx) return;
        if (ctx.irPara) ctx.irPara("dashboard");
        setTimeout(() => { const q = [ $("lnkCampHoje"), $("lnkCampDash") ].find(e => e && !e.hidden && e.offsetParent); if (q) q.scrollIntoView({ block: "start", behavior: "smooth" }); }, 200);
    }

    window.SKLLinks = { iniciar, sair, abrirSelecao, abrirEnviados, irCampanhas, recarregarCampanhas: () => ctx && carregarCampanhas() };
})();
