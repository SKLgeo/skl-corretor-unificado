// Complementos do CRM da imobiliária:
//  - Propostas na negociação (valor, condições, validade; aceita/recusada/contraproposta; aceita atualiza o valor do negócio).
//  - Controle de chaves no imóvel (quem retirou, quando, previsão de devolução). Passar a chave para outra pessoa ou devolver à
//    imobiliária só vale depois que quem recebe aceita no app (tabela imovel_chave_entregas).
//  - "Enviar ao cliente": texto pronto para WhatsApp com link da página pública do imóvel (quando o feed está ligado) e ficha em PDF.
//  - Anexos no cliente, na negociação e no imóvel (componente do documentos.js).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const SITUACAO = { enviada: "Aguardando resposta", aceita: "Aceita", recusada: "Recusada", contraproposta: "Contraproposta", cancelada: "Cancelada" };
    let ctx = null, negAberta = null, imovelAberto = null;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => v == null || v === "" ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dataBr = iso => iso ? new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "—";
    const dataHora = iso => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
    const papel = () => (ctx && ctx.papel()) || "";
    const nomeEquipe = id => { const u = ctx.equipe().find(x => x.id === id); return u ? u.display_name : (id === (ctx.usuario() || {}).id ? "Você" : "alguém da equipe"); };

    function iniciar(contexto) { ctx = contexto; criarDialogs(); avisadas = new Set(); ligarChaves(); }
    function garantirBox(id, antesDeId, classe) {
        let el = $(id);
        if (!el) {
            const ancora = $(antesDeId);
            if (!ancora) return null;
            el = document.createElement("section");
            el.id = id;
            el.className = classe || "crm-visitas";
            ancora.parentNode.insertBefore(el, ancora);
        }
        return el;
    }
    function criarDialogs() {
        if ($("extPropostaDialog")) return;
        document.body.insertAdjacentHTML("beforeend", `
<dialog id="extPropostaDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">PROPOSTA</span><h2>Nova proposta</h2>
  <div class="form-row"><label><span>Valor proposto (R$)</span><input id="extPropValor" inputmode="decimal" autocomplete="off" /></label>
    <label><span>Válida até</span><input id="extPropValidade" type="date" /></label></div>
  <label><span>Condições</span><textarea id="extPropCond" rows="3" placeholder="ex.: entrada de 20%, financiamento bancário; ou 3 aluguéis de caução"></textarea></label>
  <p id="extPropMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="extPropSalvar" type="button" class="primary-button">Registrar proposta</button></div>
</form></dialog>
<dialog id="extEnviarDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">ENVIAR AO CLIENTE</span><h2 id="extEnvTitulo">Imóvel</h2>
  <label><span>Telefone do cliente (WhatsApp)</span><input id="extEnvTel" inputmode="tel" placeholder="(66) 99999-0000" autocomplete="off" /></label>
  <label><span>Mensagem</span><textarea id="extEnvTexto" rows="9"></textarea></label>
  <p id="extEnvAviso" class="muted-text"></p>
  <div class="dialog-actions"><button id="extEnvFicha" type="button" class="secondary-button">Ficha em PDF</button><button id="extEnvCopiar" type="button" class="secondary-button">Copiar texto</button><button id="extEnvWhats" type="button" class="primary-button">Abrir WhatsApp</button></div>
</form></dialog>
<dialog id="extChaveDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">CHAVES</span><h2 id="extChaveTitulo">Retirar chave</h2>
  <label id="extChaveQuemLabel"><span>Com quem fica</span><select id="extChaveQuem"></select></label>
  <label id="extChaveNomeLabel" hidden><span>Nome (pessoa de fora: proprietário, prestador…)</span><input id="extChaveNome" autocomplete="off" /></label>
  <div class="form-row"><label><span>Motivo</span><input id="extChaveMotivo" placeholder="ex.: visita com cliente" autocomplete="off" /></label>
    <label><span>Devolver até</span><input id="extChavePrev" type="datetime-local" /></label></div>
  <p id="extChaveAviso" class="muted-text" hidden>A pessoa recebe o aviso no app e precisa aceitar. Até lá, a chave continua no seu nome.</p>
  <p id="extChaveMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="extChaveSalvar" type="button" class="primary-button">Registrar</button></div>
</form></dialog>`);
        document.querySelectorAll("#extPropostaDialog [data-fechar], #extEnviarDialog [data-fechar], #extChaveDialog [data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
        $("extPropSalvar").addEventListener("click", salvarProposta);
        $("extEnvWhats").addEventListener("click", abrirWhats);
        $("extEnvCopiar").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("extEnvTexto").value); ctx.toast("Texto copiado."); } catch { ctx.toast("Selecione o texto e copie."); } });
        $("extEnvFicha").addEventListener("click", () => fichaPdf(imovelAberto));
        $("extChaveQuem").addEventListener("change", () => { $("extChaveNomeLabel").hidden = $("extChaveQuem").value !== "__fora"; });
        $("extChaveSalvar").addEventListener("click", salvarChave);
    }
    function msg(el, t) { el.textContent = t; el.hidden = !t; }

    // ------------------------------------------------------------------ negociação: propostas + anexos
    function aoAbrirNegociacao(n) {
        negAberta = n;
        const prop = garantirBox("extNegPropostas", "crmNegVisitas");
        const anx = garantirBox("extNegAnexos", "crmNegVisitas");
        if (!prop || !anx) return;
        prop.hidden = anx.hidden = !n;
        if (!n) return;
        desenharPropostas(n);
        anx.innerHTML = `<span class="eyebrow">DOCUMENTOS DO NEGÓCIO</span><div id="extNegAnexosLista"></div>`;
        if (window.SKLDocumentos) window.SKLDocumentos.anexos($("extNegAnexosLista"), "negociacao", n.id,
            { podeEnviar: papel() !== "financeiro", categorias: [ "Proposta assinada", "Ficha cadastral", "Documento pessoal", "Comprovante de renda", "Outro" ] });
    }
    async function desenharPropostas(n) {
        const box = $("extNegPropostas");
        const { data } = await ctx.sb.from("crm_propostas").select("*").eq("negociacao_id", n.id).order("created_at", { ascending: false });
        const lista = data || [];
        const pode = papel() !== "financeiro" && n.situacao === "aberta";
        box.innerHTML = `<span class="eyebrow">PROPOSTAS</span>
          ${lista.length ? lista.map(p => `<div class="crm-visita ext-proposta ext-prop-${h(p.situacao)}"><span class="crm-visita-quando">${h(dinheiro(p.valor))}</span>
            <span class="crm-visita-info"><strong>${h(SITUACAO[p.situacao])}</strong><small>${h(dataHora(p.created_at))}${p.validade ? " · válida até " + h(dataBr(p.validade)) : ""}${p.condicoes ? " · " + h(p.condicoes) : ""}${p.resposta ? " · resposta: " + h(p.resposta) : ""}</small></span>
            <span class="ext-item-acoes">${p.situacao === "enviada" && pode ? `<button type="button" class="secondary-button fin-mini" data-resp="aceita" data-p="${h(p.id)}">Aceita</button>
              <button type="button" class="secondary-button fin-mini" data-resp="contraproposta" data-p="${h(p.id)}">Contraproposta</button>
              <button type="button" class="text-button" data-resp="recusada" data-p="${h(p.id)}">Recusada</button>` : ""}
              <button type="button" class="text-button" data-imp="${h(p.id)}">Imprimir</button></span></div>`).join("")
            : `<p class="muted-text">Nenhuma proposta registrada.</p>`}
          ${pode ? `<button type="button" class="secondary-button" id="extNovaProposta">+ Registrar proposta</button>` : ""}`;
        const nb = $("extNovaProposta");
        if (nb) nb.addEventListener("click", () => {
            $("extPropValor").value = n.valor != null ? String(n.valor).replace(".", ",") : "";
            $("extPropValidade").value = ""; $("extPropCond").value = "";
            msg($("extPropMsg"), "");
            $("extPropostaDialog").showModal();
        });
        box.querySelectorAll("[data-resp]").forEach(b => b.addEventListener("click", async () => {
            const sit = b.dataset.resp;
            const resposta = window.prompt(sit === "aceita" ? "Observação (opcional):" : sit === "contraproposta" ? "Qual a contraproposta do proprietário?" : "Motivo da recusa (opcional):", "");
            if (resposta === null) return;
            const { error } = await ctx.sb.rpc("crm_responder_proposta", { p_id: b.dataset.p, p_situacao: sit, p_resposta: resposta });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast(sit === "aceita" ? "Proposta aceita: o valor do negócio foi atualizado." : "Resposta registrada.");
            if (window.SKLCRM) window.SKLCRM.recarregar();
            desenharPropostas(n);
        }));
        box.querySelectorAll("[data-imp]").forEach(b => b.addEventListener("click", () => imprimirProposta(n, lista.find(p => p.id === b.dataset.imp))));
    }
    async function salvarProposta() {
        const n = negAberta; if (!n) return;
        const valor = ctx.parseValor($("extPropValor").value);
        if (!valor) { msg($("extPropMsg"), "Informe o valor."); return; }
        const { error } = await ctx.sb.rpc("crm_salvar_proposta", { p_negociacao: n.id, p_dados: { valor, validade: $("extPropValidade").value || null, condicoes: $("extPropCond").value.trim() } });
        if (error) { msg($("extPropMsg"), erro(error)); return; }
        $("extPropostaDialog").close();
        ctx.toast("Proposta registrada.");
        desenharPropostas(n);
    }
    function imprimirProposta(n, p) {
        if (!p || !window.SKLFinanceiro) return;
        const crm = window.SKLCRM && window.SKLCRM.interno;
        const cli = crm && crm.clientes instanceof Map ? crm.clientes.get(n.cliente_id) : null;
        const im = ctx.imoveis().find(i => i.id === (p.construcao_id || n.construcao_id)) || {};
        const venda = crm && (crm.funil(n.funil_id) || {}).finalidade === "venda";
        window.SKLFinanceiro.imprimir(`<div class="fin-doc"><header><div><strong>${h(ctx.carteiraNome())}</strong><span>Proposta de ${venda ? "compra" : "locação"}</span></div><small>${h(dataBr(p.created_at))}</small></header>
          <p>Proponente: <strong>${h((cli || {}).nome || "—")}</strong>${(cli || {}).cpf ? `, CPF ${h(cli.cpf)}` : ""}${(cli || {}).telefone ? ` · ${h(cli.telefone)}` : ""}</p>
          <p>Imóvel: <strong>${h(im.nome || n.titulo || "—")}</strong>${im.codigo ? ` (cód. ${h(im.codigo)})` : ""}${im.endereco ? ` — ${h(im.endereco)}` : ""}</p>
          <table class="fin-doc-tabela"><tr class="forte"><td>Valor proposto${venda ? "" : " (aluguel mensal)"}</td><td>${h(dinheiro(p.valor))}</td></tr>
          ${p.validade ? `<tr><td>Validade da proposta</td><td>${h(dataBr(p.validade))}</td></tr>` : ""}</table>
          ${p.condicoes ? `<p><strong>Condições:</strong> ${h(p.condicoes)}</p>` : ""}
          <p>Esta proposta não obriga as partes até a assinatura do contrato definitivo.</p>
          <div class="ext-assinaturas"><div class="fin-assinatura">Proponente</div><div class="fin-assinatura">Corretor / ${h(ctx.carteiraNome())}</div></div></div>`);
    }

    // ------------------------------------------------------------------ cliente: anexos
    function aoAbrirCliente(c) {
        const box = garantirBox("extCliAnexos", "crmCliHistorico", "crm-sublista");
        if (!box) return;
        box.hidden = !c;
        if (!c) return;
        box.innerHTML = `<span class="crm-rotulo">Documentos do cliente</span><div id="extCliAnexosLista"></div>`;
        if (window.SKLDocumentos) window.SKLDocumentos.anexos($("extCliAnexosLista"), "cliente", c.id, { podeEnviar: papel() !== "financeiro" });
    }

    // ------------------------------------------------------------------ imóvel: chaves, enviar ao cliente, anexos (Central)
    function aoAbrirImovel(c) {
        imovelAberto = c;
        const box = garantirBox("extImovelBox", "crmInteressados", "crm-sublista ext-imovel-box");
        if (!box) return;
        const aprovado = c && (c.aprovacao || "aprovado") === "aprovado";
        box.hidden = !aprovado;
        if (!aprovado) return;
        box.innerHTML = `<div class="ext-int-acoes"><button type="button" class="primary-button" id="extEnviarCliente">📤 Enviar ao cliente</button></div>
          <div id="extChaveEstado" class="ext-chave"></div>`;
        $("extEnviarCliente").addEventListener("click", () => abrirEnviar(c));
        desenharChave(c);
        // documentos do imóvel (matrícula, CAR...): ficam no próprio cadastro do imóvel (app.js, renderDocsImovel)
    }
    // ------------------------------------------------------------------ chaves (com aceite de quem recebe)
    // Retirar para si: direto. Entregar a outra pessoa da equipe ou devolver à imobiliária: fica pendente até quem recebe aceitar
    // (na devolução, a Central confirma). Até o aceite, a chave continua com quem está entregando.
    let equipeNomes = [], entregasPendentes = [], canalChaves = null, timerChaves = null, avisadas = new Set();
    const eu = () => (ctx.usuario() || {}).id;
    const nomePessoa = id => {
        if (!id) return "a imobiliária";
        if (id === eu()) return "você";
        const p = equipeNomes.find(x => x.id === id);
        return p ? p.nome : nomeEquipe(id);
    };
    const nomeImovel = id => { const c = ctx.imoveis().find(x => x.id === id); return c ? `${c.codigo ? c.codigo + " · " : ""}${c.nome}` : "imóvel"; };
    function souRecebedor(e) { return e.para_usuario ? e.para_usuario === eu() : ctx.gestao(); }

    async function carregarEquipeNomes() {
        const { data } = await ctx.sb.rpc("equipe_da_carteira", { p_carteira: ctx.carteiraId() });
        equipeNomes = data || [];
    }
    async function carregarEntregas() {
        if (!ctx) return;
        const { data } = await ctx.sb.from("imovel_chave_entregas").select("*").eq("carteira_id", ctx.carteiraId()).eq("situacao", "pendente").order("criado_em");
        entregasPendentes = data || [];
        desenharAvisosChaves();
        if (imovelAberto) desenharChave(imovelAberto);
        // aviso na hora para quem precisa aceitar
        entregasPendentes.filter(e => souRecebedor(e) && !avisadas.has(e.id)).forEach(e => {
            avisadas.add(e.id);
            ctx.toast(`🔑 ${e.para_usuario ? "Chave para você" : "Devolução de chave"}: ${nomeImovel(e.construcao_id)} — confirme o recebimento.`);
        });
    }
    function ligarChaves() {
        carregarEquipeNomes().then(carregarEntregas);
        if (canalChaves) ctx.sb.removeChannel(canalChaves);
        canalChaves = ctx.sb.channel("chaves-" + ctx.carteiraId())
            .on("postgres_changes", { event: "*", schema: "public", table: "imovel_chave_entregas", filter: `carteira_id=eq.${ctx.carteiraId()}` }, () => carregarEntregas())
            .subscribe();
        clearInterval(timerChaves);
        timerChaves = setInterval(carregarEntregas, 60000);
    }
    // Quadro "Chaves aguardando você" no topo do Hoje (corretor) e da Visão geral (Central)
    function desenharAvisosChaves() {
        const meus = entregasPendentes.filter(e => souRecebedor(e) || e.criado_por === eu() || e.de_usuario === eu());
        [ [ "extChavesHoje", "page-hoje" ], [ "extChavesVisao", "page-dashboard" ] ].forEach(([ id, pagina ]) => {
            const pg = $(pagina);
            if (!pg) return;
            let box = $(id);
            if (!box) { box = document.createElement("section"); box.id = id; box.className = "ext-chaves-avisos"; pg.insertBefore(box, pg.firstChild); }
            box.hidden = !meus.length;
            box.innerHTML = meus.length ? `<span class="eyebrow">🔑 CHAVES AGUARDANDO CONFIRMAÇÃO</span>` + meus.map(itemEntrega).join("") : "";
            ligarBotoesEntrega(box);
        });
    }
    function itemEntrega(e) {
        const receber = souRecebedor(e);
        const texto = e.para_usuario
            ? (receber ? `<strong>${h(nomePessoa(e.de_usuario))}</strong> quer te entregar a chave de <strong>${h(nomeImovel(e.construcao_id))}</strong>`
                       : `Aguardando <strong>${h(nomePessoa(e.para_usuario))}</strong> aceitar a chave de <strong>${h(nomeImovel(e.construcao_id))}</strong>`)
            : (receber ? `<strong>${h(nomePessoa(e.de_usuario))}</strong> devolveu a chave de <strong>${h(nomeImovel(e.construcao_id))}</strong> — confirme que recebeu`
                       : `Devolução da chave de <strong>${h(nomeImovel(e.construcao_id))}</strong> aguardando a Central confirmar`);
        const podeCancelar = e.criado_por === eu() || ctx.gestao();
        return `<div class="ext-entrega${receber ? " receber" : ""}"><span>${texto}<small>${h(dataHora(e.criado_em))}${e.motivo ? " · " + h(e.motivo) : ""}${e.observacao ? " · " + h(e.observacao) : ""}</small></span>
          <span class="ext-item-acoes">${receber ? `<button type="button" class="primary-button fin-mini" data-aceitar="${h(e.id)}">${e.para_usuario ? "Aceitar a chave" : "Confirmar recebimento"}</button>
            <button type="button" class="secondary-button fin-mini" data-recusar="${h(e.id)}">Recusar</button>` : ""}
            ${!receber && podeCancelar ? `<button type="button" class="text-button" data-cancelar="${h(e.id)}">Cancelar</button>` : ""}</span></div>`;
    }
    function ligarBotoesEntrega(box) {
        box.querySelectorAll("[data-aceitar]").forEach(b => b.addEventListener("click", () => responderEntrega(b.dataset.aceitar, true)));
        box.querySelectorAll("[data-recusar]").forEach(b => b.addEventListener("click", () => {
            if (window.confirm("Recusar? A chave continua com quem está entregando.")) responderEntrega(b.dataset.recusar, false);
        }));
        box.querySelectorAll("[data-cancelar]").forEach(b => b.addEventListener("click", async () => {
            const { error } = await ctx.sb.rpc("chave_cancelar_entrega", { p_entrega: b.dataset.cancelar });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast("Entrega cancelada.");
            carregarEntregas();
        }));
    }
    async function responderEntrega(id, aceitar) {
        const { error } = await ctx.sb.rpc("chave_responder_entrega", { p_entrega: id, p_aceitar: aceitar, p_obs: null });
        if (error) { ctx.toast(erro(error)); return; }
        ctx.toast(aceitar ? "Pronto: a chave agora está registrada com quem recebeu." : "Entrega recusada.");
        carregarEntregas();
    }

    async function desenharChave(c) {
        const box = $("extChaveEstado");
        if (!box || !c) return;
        const { data } = await ctx.sb.from("imovel_chaves").select("*").eq("construcao_id", c.id).order("retirada_em", { ascending: false }).limit(5);
        if (!imovelAberto || imovelAberto.id !== c.id) return;
        const lista = data || [];
        const fora = lista.find(k => !k.devolvida_em);
        const pendente = entregasPendentes.find(e => e.construcao_id === c.id);
        const gestao = ctx.gestao();
        const atrasada = fora && fora.previsao_devolucao && new Date(fora.previsao_devolucao) < new Date();
        const comigo = fora && fora.com_usuario === eu();
        let acoes = "";
        if (pendente) acoes = itemEntrega(pendente);
        else if (fora) {
            acoes = (comigo || gestao ? `<button type="button" class="secondary-button fin-mini" id="extEntregar">Entregar para…</button>` : "")
                + (comigo && !gestao ? `<button type="button" class="secondary-button fin-mini" id="extDevolver">Devolver à imobiliária</button>` : "")
                + (gestao ? `<button type="button" class="secondary-button fin-mini" id="extDevolver">Registrar devolução</button>` : "");
        } else {
            acoes = `<button type="button" class="secondary-button fin-mini" id="extRetirar">${gestao ? "Retirar / entregar chave" : "Retirar chave"}</button>`;
        }
        box.innerHTML = `<span class="crm-rotulo">🔑 Chaves</span>
          ${fora ? `<p class="${atrasada ? "fin-txt-alerta" : ""}"><strong>Com ${h(fora.com_nome || (comigo ? "você" : nomePessoa(fora.com_usuario)))}</strong> desde ${h(dataHora(fora.retirada_em))}${fora.motivo ? " · " + h(fora.motivo) : ""}${fora.previsao_devolucao ? " · devolver até " + h(dataHora(fora.previsao_devolucao)) : ""}${atrasada ? " (atrasada)" : ""}</p>`
              : `<p class="muted-text">Na imobiliária.</p>`}
          <div class="ext-chave-acoes">${acoes}</div>
          ${lista.filter(k => k.devolvida_em).length ? `<details><summary class="muted-text">Últimas movimentações</summary><ul class="ext-hist">${lista.filter(k => k.devolvida_em).map(k => `<li>${h(k.com_nome || nomePessoa(k.com_usuario))} · ${h(dataHora(k.retirada_em))} → ${h(dataHora(k.devolvida_em))}${k.observacao ? " · " + h(k.observacao) : ""}</li>`).join("")}</ul></details>` : ""}`;
        ligarBotoesEntrega(box);
        const ret = $("extRetirar");
        if (ret) ret.addEventListener("click", () => abrirChave(c, "retirar", null));
        const ent = $("extEntregar");
        if (ent) ent.addEventListener("click", () => abrirChave(c, "entregar", fora));
        const dev = $("extDevolver");
        if (dev) dev.addEventListener("click", async () => {
            if (!gestao && !window.confirm("Avisar a Central que você devolveu a chave? Ela fica no seu nome até a Central confirmar.")) return;
            const { error } = await ctx.sb.rpc("chave_devolver", { p_id: fora.id, p_observacao: null });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast(gestao ? "Devolução registrada." : "Devolução enviada — a Central precisa confirmar.");
            carregarEntregas();
        });
    }
    let modoChave = "retirar", chaveAtual = null;
    function abrirChave(c, modo, registro) {
        modoChave = modo; chaveAtual = registro;
        const gestao = ctx.gestao();
        $("extChaveTitulo").textContent = `${modo === "entregar" ? "Entregar chave" : "Retirar chave"} — ${c.codigo ? c.codigo + " · " : ""}${c.nome}`;
        const pessoas = equipeNomes.filter(u => u.id !== eu() && (!registro || u.id !== registro.com_usuario));
        if (modo === "entregar") {
            $("extChaveQuemLabel").hidden = false;
            $("extChaveQuemLabel").querySelector("span").textContent = "Entregar para";
            $("extChaveQuem").innerHTML = pessoas.map(u => `<option value="${h(u.id)}">${h(u.nome)}</option>`).join("");
        } else {
            $("extChaveQuemLabel").hidden = !gestao;
            $("extChaveQuemLabel").querySelector("span").textContent = "Com quem fica";
            $("extChaveQuem").innerHTML = `<option value="">Eu mesmo</option>` + pessoas.map(u => `<option value="${h(u.id)}">${h(u.nome)} (precisa aceitar)</option>`).join("") + `<option value="__fora">Pessoa de fora…</option>`;
        }
        $("extChaveNomeLabel").hidden = true;
        $("extChaveNome").value = ""; $("extChaveMotivo").value = registro && registro.motivo ? registro.motivo : "";
        const prev = registro && registro.previsao_devolucao ? new Date(registro.previsao_devolucao) : new Date(Date.now() + 4 * 3600e3);
        $("extChavePrev").value = new Date(prev.getTime() - prev.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        $("extChaveSalvar").textContent = modo === "entregar" ? "Enviar para aceite" : "Registrar";
        $("extChaveAviso").hidden = modo !== "entregar";
        msg($("extChaveMsg"), "");
        $("extChaveDialog").showModal();
    }
    async function salvarChave() {
        const c = imovelAberto; if (!c) return;
        const quem = $("extChaveQuem").value;
        const dados = { motivo: $("extChaveMotivo").value.trim(), previsao_devolucao: $("extChavePrev").value ? new Date($("extChavePrev").value).toISOString() : null };
        let resultado;
        if (modoChave === "entregar" || (quem && quem !== "__fora")) {
            if (!quem) { msg($("extChaveMsg"), "Escolha para quem vai a chave."); return; }
            resultado = await ctx.sb.rpc("chave_entregar", { p_construcao: c.id, p_para: quem, p_dados: dados });
        } else {
            if (quem === "__fora") { dados.com_nome = $("extChaveNome").value.trim(); if (!dados.com_nome) { msg($("extChaveMsg"), "Informe o nome de quem fica com a chave."); return; } }
            resultado = await ctx.sb.rpc("chave_retirar", { p_construcao: c.id, p_dados: dados });
        }
        if (resultado.error) { msg($("extChaveMsg"), erro(resultado.error)); return; }
        $("extChaveDialog").close();
        ctx.toast(resultado.data && resultado.data.situacao === "pendente" ? `Enviado: ${nomePessoa(quem)} precisa aceitar no app.` : "Retirada registrada.");
        carregarEntregas();
    }

    // ------------------------------------------------------------------ enviar ao cliente
    function textoImovel(c, link) {
        const linhas = [ `🏠 *${c.nome}*${c.codigo ? ` (cód. ${c.codigo})` : ""}` ];
        const local = [ c.bairro, c.cidade ].filter(Boolean).join(" · ");
        if (local) linhas.push(`📍 ${local}`);
        const precos = [];
        if (c.para_aluguel && c.valor_aluguel) precos.push(`Aluguel ${dinheiro(c.valor_aluguel)}`);
        if (c.para_venda && c.valor_venda) precos.push(`Venda ${dinheiro(c.valor_venda)}`);
        if (precos.length) linhas.push(`💰 ${precos.join(" | ")}`);
        const extras = [];
        if (c.valor_condominio) extras.push(`condomínio ${dinheiro(c.valor_condominio)}`);
        if (c.valor_iptu) extras.push(`IPTU ${dinheiro(c.valor_iptu)}/ano`);
        if (extras.length) linhas.push(`+ ${extras.join(" · ")}`);
        const carac = [];
        if (c.area_m2) carac.push(window.SKLRural ? window.SKLRural.areaTexto(c) : `${Number(c.area_m2).toLocaleString("pt-BR")} m²`);
        if (c.quartos) carac.push(`${c.quartos} quarto(s)`);
        if (c.suites) carac.push(`${c.suites} suíte(s)`);
        if (c.banheiros) carac.push(`${c.banheiros} banheiro(s)`);
        if (c.vagas) carac.push(`${c.vagas} vaga(s)`);
        if (carac.length) linhas.push(`📐 ${carac.join(" · ")}`);
        if (c.rural && (c.benfeitorias || []).length) linhas.push(`🏗️ ${c.benfeitorias.map(b => b.nome + (b.detalhe ? " (" + b.detalhe + ")" : "")).join(", ")}`);
        if (link) linhas.push(``, `Veja fotos e detalhes: ${link}`);
        linhas.push(``, `Posso agendar uma visita? — ${(ctx.usuario() || {}).display_name || ""}, ${ctx.carteiraNome()}`);
        return linhas.join("\n");
    }
    async function abrirEnviar(c) {
        $("extEnvTitulo").textContent = `${c.codigo ? c.codigo + " · " : ""}${c.nome}`;
        $("extEnvTel").value = "";
        $("extEnvTexto").value = "Montando…";
        $("extEnviarDialog").showModal();
        let link = null;
        try { link = window.SKLIntegracoes ? await window.SKLIntegracoes.linkPublico(c.publicar_site ? c.codigo : null) : null; } catch { link = null; }
        if (link) {
            // o botão "Falar no WhatsApp" da página pública chama quem enviou o link
            const { data: eu } = await ctx.sb.from("perfis").select("telefone").eq("id", (ctx.usuario() || {}).id).maybeSingle();
            const tel = String((eu && eu.telefone) || "").replace(/\D/g, "");
            if (tel.length >= 10) link += "&w=" + tel;
        }
        $("extEnvTexto").value = textoImovel(c, link);
        $("extEnvAviso").textContent = link ? "O link abre uma página com as fotos e a descrição, sem dados do proprietário."
            : (c.publicar_site ? "Sem link: a vitrine de imóveis está desligada (Configurações → Site e portais). Use a ficha em PDF." : "Sem link: este imóvel não está marcado \"Publicar no site\". Use a ficha em PDF.");
    }
    function abrirWhats() {
        const d = $("extEnvTel").value.replace(/\D/g, "");
        const texto = encodeURIComponent($("extEnvTexto").value);
        const url = d.length >= 10 ? `https://wa.me/55${d}?text=${texto}` : `https://wa.me/?text=${texto}`;
        window.open(url, "_blank", "noopener");
    }
    async function fichaPdf(c) {
        if (!c || !window.SKLFinanceiro) return;
        const fotos = (c.fotos || []).map(f => f.path).filter(Boolean).slice(0, 6);
        let urls = [];
        if (fotos.length) {
            const { data } = await ctx.sb.storage.from("fotos-construcoes").createSignedUrls(fotos, 3600);
            urls = (data || []).map(u => u.signedUrl).filter(Boolean);
        }
        const carac = [ [ "Área", c.area_m2 ? (window.SKLRural ? window.SKLRural.areaTexto(c) : `${c.area_m2} m²`) : "" ], [ "Quartos", c.quartos ], [ "Suítes", c.suites ], [ "Banheiros", c.banheiros ], [ "Vagas", c.vagas ], [ "Salas", c.salas ] ].filter(x => x[1]);
        window.SKLFinanceiro.imprimir(`<div class="fin-doc ext-ficha"><header><div><strong>${h(ctx.carteiraNome())}</strong><span>Ficha do imóvel${c.codigo ? " · cód. " + h(c.codigo) : ""}</span></div><small>${h(new Date().toLocaleDateString("pt-BR"))}</small></header>
          <h3>${h(c.nome)}</h3>
          <p>${h([ c.edificio, c.bairro, c.cidade && c.uf ? c.cidade + "/" + c.uf : c.cidade ].filter(Boolean).join(" · "))}</p>
          ${urls.length ? `<div class="ext-ficha-fotos">${urls.map((u, i) => `<img src="${h(u)}" alt=""${i === 0 ? ` class="ext-ficha-capa"` : ""} />`).join("")}</div>` : ""}
          <table class="fin-doc-tabela">
            ${c.para_aluguel && c.valor_aluguel ? `<tr class="forte"><td>Aluguel</td><td>${h(dinheiro(c.valor_aluguel))}</td></tr>` : ""}
            ${c.para_venda && c.valor_venda ? `<tr class="forte"><td>Venda</td><td>${h(dinheiro(c.valor_venda))}</td></tr>` : ""}
            ${c.valor_condominio ? `<tr><td>Condomínio</td><td>${h(dinheiro(c.valor_condominio))}</td></tr>` : ""}
            ${c.valor_iptu ? `<tr><td>IPTU (ano)</td><td>${h(dinheiro(c.valor_iptu))}</td></tr>` : ""}
            ${carac.map(([ k, v ]) => `<tr><td>${h(k)}</td><td>${h(v)}</td></tr>`).join("")}</table>
          ${c.descricao ? `<p>${h(c.descricao)}</p>` : ""}
          <p class="fin-doc-rodape">Corretor: ${h((ctx.usuario() || {}).display_name || "")} · ${h(ctx.carteiraNome())}. Valores sujeitos a alteração.</p></div>`);
    }

    // recarregarChaves: o app chama ao voltar do segundo plano (o Realtime dorme no celular)
    window.SKLExtras = { iniciar, aoAbrirNegociacao, aoAbrirCliente, aoAbrirImovel, recarregarChaves: () => ctx && carregarEntregas() };
})();
