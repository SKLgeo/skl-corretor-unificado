// Portais imobiliários (OS 12/11/2026): menu lateral → Portais (página própria desde 13/11/2026) + bloco "Portais" na ficha do imóvel.
// Banco: integracao_portais / imovel_portais / imovel_portais_eventos (RPCs portais_*). Arquivos: Edge Function portais-feed.
// Regras de mapeamento e validação: portais-conectores.js (o mesmo arquivo que monta os XML no servidor).
// Princípio: a tela NUNCA diz "publicado" sem retorno do portal; esses estados são registrados à mão pela Central.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const BASE = "https://xigwlofqkmiibzbongkn.supabase.co/functions/v1/";
    const K = () => window.SKLPortaisConectores;
    let ctx = null, info = null, carregando = null;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const erro = e => (ctx && ctx.traduzErro ? ctx.traduzErro((e && e.message) || String(e || "")) : String(e && e.message || e));
    const quando = d => d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

    const ESTADO = {
        nao_selecionado: [ "Não anunciado", "neutro" ],
        selecionado: [ "Escolhido — entra no próximo arquivo", "neutro" ],
        feed_atualizado: [ "Arquivo atualizado — aguardando leitura do portal", "info" ],
        lido_pelo_portal: [ "Lido pelo robô do portal — aguardando processamento", "info" ],
        processado: [ "Processado pelo portal", "ok" ],
        rejeitado: [ "Rejeitado pelo portal", "erro" ],
        publicado_confirmado: [ "Publicado (confirmado)", "ok" ],
        remocao_solicitada: [ "Retirada solicitada — saiu do arquivo", "alerta" ],
        retirado_confirmado: [ "Retirado (confirmado)", "neutro" ],
        homologacao_pendente: [ "Integração pendente no portal", "alerta" ],
        preparado_manual: [ "Ficha pronta — publicação manual", "info" ]
    };
    const SITUACAO = {
        nao_contratado: "Não contratado", aguardando_contratacao: "Aguardando contratação pela imobiliária",
        aguardando_ativacao: "Contratado — aguardando ativação da integração", homologacao_pendente: "Homologação pendente",
        ativo_confirmado: "Ativo (confirmado pelo portal)", suspenso: "Suspenso", sem_integracao_oficial: "Sem integração oficial (cadastro manual)"
    };
    const CANAIS_FICHA = [
        { id: "grupo_olx", nome: "OLX · ZAP Imóveis · Viva Real", nota: "um arquivo só para o Grupo OLX; em quais sites aparece depende do plano da imobiliária no Canal Pro" },
        { id: "chavesnamao", nome: "Chaves na Mão", nota: "arquivo no layout próprio do portal" },
        { id: "imovelweb", nome: "Imovelweb", nota: "aguardando especificação oficial do portal — nada é enviado por enquanto" },
        { id: "mfrural", nome: "MF Rural", nota: "SEM API OFICIAL CONFIRMADA / PUBLICAÇÃO MANUAL — o sistema prepara a ficha para copiar" }
    ];
    const selo = est => { const e = ESTADO[est] || [ est, "neutro" ]; return `<span class="ptl-selo ptl-${e[1]}">${h(e[0])}</span>`; };
    const urlFeed = (canal, previa) => info && info.token ? `${BASE}portais-feed?t=${info.token}&canal=${canal}${previa ? "&previa=1" : ""}` : "";

    async function obter() {
        if (!ctx || !ctx.gestao()) return null;
        if (carregando) return carregando;
        carregando = ctx.sb.rpc("portais_obter", { p_carteira: ctx.carteiraId() }).then(({ data, error }) => {
            carregando = null;
            if (error) throw error;
            info = data;
            return data;
        }, e => { carregando = null; throw e; });
        return carregando;
    }

    // ================================================================ menu lateral → Portais (página própria, 13/11/2026)
    function iniciar(contexto) {
        ctx = contexto; info = null;
        let painel = $("portaisPanel");
        if (!painel) {
            painel = document.createElement("div");
            painel.id = "portaisPanel";
            painel.className = "panel form-panel ptl-painel";
            const pagina = $("portaisPagina");
            if (!pagina) return;
            pagina.appendChild(painel);
        }
        painel.hidden = !ctx.gestao();
        if (!ctx.gestao()) return;
        painel.innerHTML = `<span class="eyebrow">INTEGRAÇÕES · PORTAIS</span><h2>Portais imobiliários</h2><p class="muted-text">Carregando…</p>`;
        desenharPainel();
    }
    // ao abrir a página pelo menu: dados atualizados (estado dos imóveis, última leitura)
    function aoMostrar() {
        if (!ctx || !ctx.gestao() || !$("portaisPanel")) return;
        info = null;
        desenharPainel();
    }
    async function desenharPainel() {
        const painel = $("portaisPanel");
        try { await obter(); } catch (e) { painel.innerHTML = `<span class="eyebrow">INTEGRAÇÕES · PORTAIS</span><h2>Portais imobiliários</h2><p class="form-message">${h(erro(e))}</p>`; return; }
        const pode = !!info.pode_editar, dis = pode ? "" : " disabled";
        const cfg = info.config || {}, contato = cfg.contato || {}, pol = cfg.politica || {}, canais = cfg.canais || {};
        const port = Object.fromEntries((info.portais || []).map(p => [ p.portal, p ]));
        painel.innerHTML = `<span class="eyebrow">INTEGRAÇÕES · PORTAIS</span><h2>Portais imobiliários</h2>
          <p>O sistema prepara os dados dos imóveis que você escolher. <b>Cada portal decide</b> o plano, a cota, a moderação e quando o anúncio aparece:
             a assinatura do sistema não inclui anúncio nos portais. Nenhum imóvel vai para portal sem ser escolhido na ficha dele, com a autorização do proprietário marcada.</p>
          <div class="ptl-grade">
            <section class="ext-int-bloco"><header><strong>Contato que aparece nos anúncios</strong></header>
              <p class="muted-text">Obrigatório no Grupo OLX (nome e e-mail). Use o contato comercial da imobiliária.</p>
              <label><span>Nome da imobiliária</span><input id="ptlNome" value="${h(contato.nome || "")}" maxlength="120"${dis}></label>
              <label><span>E-mail</span><input id="ptlEmail" type="email" value="${h(contato.email || "")}" maxlength="160"${dis}></label>
              <label><span>Telefone</span><input id="ptlTel" value="${h(contato.telefone || "")}" maxlength="30"${dis}></label>
            </section>
            <section class="ext-int-bloco"><header><strong>O que fazer com imóvel…</strong></header>
              <p class="muted-text">Vendido, alugado, indisponível, desaprovado ou desmarcado <b>sempre sai</b> do arquivo (a saída é o pedido de retirada; o portal retira no processamento dele).</p>
              <label><span>Reservado</span><select id="ptlPolRes"${dis}><option value="retirar"${pol.reservado !== "manter" ? " selected" : ""}>Tirar dos portais enquanto estiver reservado</option><option value="manter"${pol.reservado === "manter" ? " selected" : ""}>Manter anunciado</option></select></label>
              <label><span>Em negociação</span><select id="ptlPolNeg"${dis}><option value="manter"${pol.em_negociacao !== "retirar" ? " selected" : ""}>Manter anunciado</option><option value="retirar"${pol.em_negociacao === "retirar" ? " selected" : ""}>Tirar dos portais</option></select></label>
              <p class="muted-text">Reserva não é venda: o imóvel reservado continua no estoque e volta ao arquivo quando a reserva cair.</p>
            </section>
          </div>
          ${pode ? `<div class="ext-int-acoes"><button type="button" class="primary-button" id="ptlSalvar">Salvar contato e regras</button></div>` : ""}
          <div class="ptl-canais">
            ${cartaoGrupoOlx(port, canais, pode)}
            ${cartaoCnm(port, canais, pode)}
            ${cartaoImovelweb(port, pode)}
            ${cartaoMfRural(port, pode)}
          </div>
          <section class="ext-int-bloco ptl-diag"><header><strong>Diagnóstico dos imóveis escolhidos</strong>
              <button type="button" class="secondary-button" id="ptlDiagBtn">Verificar agora</button></header>
            <p class="muted-text">Mostra, para cada imóvel escolhido, o estado em cada portal e o que falta para ele entrar no arquivo (o mesmo validador usado na geração).</p>
            <div id="ptlDiag"></div></section>`;
        painel.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", () => copiar(b.dataset.copiar)));
        painel.querySelectorAll("[data-baixar]").forEach(b => b.addEventListener("click", () => baixar(b.dataset.baixar)));
        $("ptlDiagBtn").addEventListener("click", diagnostico);
        if (!pode) return;
        $("ptlSalvar").addEventListener("click", salvarGeral);
        painel.querySelectorAll("[data-canal-ativo]").forEach(c => c.addEventListener("change", salvarCanais));
        painel.querySelectorAll("[data-salvar-portal]").forEach(b => b.addEventListener("click", () => salvarPortal(b.dataset.salvarPortal)));
        const nt = $("ptlNovoToken"); if (nt) nt.addEventListener("click", novoToken);
    }
    function campoCopia(rotulo, valor) {
        return `<label class="ext-copia"><span>${h(rotulo)}</span><span class="ext-copia-linha"><input readonly value="${h(valor)}"><button type="button" class="secondary-button" data-copiar="${h(valor)}">Copiar</button></span></label>`;
    }
    function leitura(canal) {
        const l = (info.leituras || {})[canal] || {};
        const est = (info.estados || {})[canal] || {};
        const cont = Object.entries(est).filter(([ k ]) => k !== "nao_selecionado").map(([ k, n ]) => `${n} ${h((ESTADO[k] || [ k ])[0].toLowerCase())}`).join(" · ");
        return `<ul class="ptl-fatos">
            <li>Último arquivo gerado: <b>${quando(l.ultima_geracao_em)}</b>${l.ultima_geracao_itens != null ? ` (${l.ultima_geracao_itens} imóvel(is), ${Math.round((l.ultima_geracao_bytes || 0) / 1024)} KB, ${l.ultima_geracao_ms || 0} ms)` : ""}</li>
            ${canal === "grupo_olx" ? `<li>Última leitura do robô do Grupo OLX (User-Agent e IP oficiais): <b>${quando(l.ultima_leitura_portal_em)}</b></li>` : ""}
            <li>Última leitura de fora da Central: <b>${quando(l.ultima_leitura_externa_em)}</b>${l.ultima_leitura_agente ? ` <small>(${h(l.ultima_leitura_agente.slice(0, 60))})</small>` : ""}</li>
            <li>Imóveis: ${cont || "nenhum escolhido ainda"}</li></ul>`;
    }
    function linhaPortal(p, pode) {
        if (!p) return "";
        const plano = p.plano || {}, dis = pode ? "" : " disabled";
        const nome = { olx: "OLX", zap: "ZAP Imóveis", vivareal: "Viva Real", chavesnamao: "Chaves na Mão", imovelweb: "Imovelweb", mfrural: "MF Rural" }[p.portal];
        return `<details class="ptl-portal"><summary><b>${h(nome)}</b> <span class="ptl-selo ptl-${p.situacao === "ativo_confirmado" ? "ok" : p.situacao === "suspenso" ? "erro" : "alerta"}">${h(SITUACAO[p.situacao] || p.situacao)}</span>
            ${p.ultimo_processamento_em ? `<small>último processamento confirmado ${quando(p.ultimo_processamento_em)}</small>` : ""}</summary>
          <div class="ptl-portal-campos" data-portal="${p.portal}">
            <label><span>Situação</span><select data-c="situacao"${dis}>${Object.entries(SITUACAO).map(([ k, v ]) => `<option value="${k}"${p.situacao === k ? " selected" : ""}>${h(v)}</option>`).join("")}</select></label>
            <label><span>Plano / produto informado pela imobiliária</span><input data-c="produto" value="${h(plano.produto || "")}" maxlength="120"${dis}></label>
            <label><span>Cota de anúncios</span><input data-c="cota" value="${h(plano.cota || "")}" maxlength="60"${dis}></label>
            <label><span>Conta / ID no portal</span><input data-c="conta" value="${h(plano.conta || "")}" maxlength="80"${dis}></label>
            <label><span>Contato no portal</span><input data-c="contato" value="${h(plano.contato || "")}" maxlength="160"${dis}></label>
            <label><span>Último processamento confirmado pelo portal</span><input type="datetime-local" data-c="ultimo_processamento_em" value="${p.ultimo_processamento_em ? new Date(new Date(p.ultimo_processamento_em).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}"${dis}></label>
            <label><span>O que o portal informou (relatório, e-mail, chamado)</span><input data-c="ultimo_processamento_obs" value="${h(p.ultimo_processamento_obs || "")}" maxlength="500"${dis}></label>
            <label><span>Integração validada em</span><input type="date" data-c="validado_em" value="${h(p.validado_em || "")}"${dis}></label>
            <label class="ptl-larga"><span>Observação</span><input data-c="observacao" value="${h(plano.observacao || "")}" maxlength="500"${dis}></label>
            ${pode ? `<div class="ext-int-acoes"><button type="button" class="secondary-button" data-salvar-portal="${p.portal}">Salvar ${h(nome)}</button></div>` : ""}
          </div></details>`;
    }
    function cartaoGrupoOlx(port, canais, pode) {
        const ativo = !!(canais.grupo_olx && canais.grupo_olx.ativo);
        return `<section class="ext-int-bloco ptl-canal"><header><strong>Grupo OLX — OLX, ZAP Imóveis e Viva Real</strong>
            <label class="check-inline"><input type="checkbox" data-canal-ativo="grupo_olx"${ativo ? " checked" : ""}${pode ? "" : " disabled"}> gerar arquivo</label></header>
          <p class="muted-text">Formato VRSync. O Grupo OLX lê o arquivo a cada 12 horas (o horário varia) e publica conforme o <b>plano contratado no Canal Pro</b>: estar no arquivo não significa aparecer nos três sites.</p>
          ${ativo && info.token ? campoCopia("Endereço do arquivo (informar no Canal Pro)", urlFeed("grupo_olx")) : `<p class="muted-text">${ativo ? "Só a Central e o administrador veem o endereço." : "Ligue \"gerar arquivo\" para ver o endereço."}</p>`}
          ${ativo && info.token ? `<div class="ext-int-acoes"><a class="secondary-button" href="${h(urlFeed("grupo_olx", true))}" target="_blank" rel="noopener">Abrir prévia</a>
              <button type="button" class="secondary-button" data-baixar="grupo_olx">Baixar para o validador oficial</button>
              <a class="text-button" href="https://developers.grupozap.com/feeds/xml_validator/" target="_blank" rel="noopener">Validador do Grupo OLX ↗</a>
              ${pode ? `<button type="button" class="text-button" id="ptlNovoToken">Trocar endereço</button>` : ""}</div>` : ""}
          ${leitura("grupo_olx")}
          <details class="ptl-como"><summary>Como ativar</summary><ol>
            <li>A imobiliária precisa ter conta e plano no <b>Canal Pro</b> (Grupo OLX), com cota para os anúncios.</li>
            <li>Preencha o contato acima, ligue "gerar arquivo" e escolha os imóveis na ficha de cada um (com a autorização do proprietário).</li>
            <li>Baixe o arquivo e confira no validador oficial do Grupo OLX. Corrija o que o diagnóstico apontar.</li>
            <li>Peça ao Canal Pro (suporte/gerente da conta) a carga por XML com o endereço acima. Anúncios criados à mão no Canal Pro com os mesmos dados dão erro de duplicidade: a imobiliária precisa excluí-los.</li>
            <li>Acompanhe o relatório de importação (e-mail/Canal Pro) e registre aqui, em cada portal, o processamento confirmado; na ficha do imóvel, registre publicado/rejeitado.</li>
            <li><b>Contatos (leads):</b> o envio automático para o CRM depende da homologação do SKL no Grupo OLX (pendente). Até lá, os contatos chegam por e-mail no Canal Pro.</li></ol></details>
          ${[ "olx", "zap", "vivareal" ].map(k => linhaPortal(port[k], pode)).join("")}
        </section>`;
    }
    function cartaoCnm(port, canais, pode) {
        const ativo = !!(canais.chavesnamao && canais.chavesnamao.ativo);
        return `<section class="ext-int-bloco ptl-canal"><header><strong>Chaves na Mão</strong>
            <label class="check-inline"><input type="checkbox" data-canal-ativo="chavesnamao"${ativo ? " checked" : ""}${pode ? "" : " disabled"}> gerar arquivo</label></header>
          <p class="muted-text">Layout XML próprio do Chaves na Mão. Processado em duas janelas por dia (06h–13h e 16h–22h), sem garantia de publicação imediata.</p>
          ${ativo && info.token ? campoCopia("Endereço do arquivo (enviar ao Chaves na Mão)", urlFeed("chavesnamao")) : `<p class="muted-text">${ativo ? "Só a Central e o administrador veem o endereço." : "Ligue \"gerar arquivo\" para ver o endereço."}</p>`}
          ${ativo && info.token ? `<div class="ext-int-acoes"><a class="secondary-button" href="${h(urlFeed("chavesnamao", true))}" target="_blank" rel="noopener">Abrir prévia</a>
              <button type="button" class="secondary-button" data-baixar="chavesnamao">Baixar arquivo</button></div>` : ""}
          ${leitura("chavesnamao")}
          <details class="ptl-como"><summary>Como ativar</summary><ol>
            <li>A imobiliária contrata um plano de anúncios no Chaves na Mão. Depois do contrato, o portal manda um e-mail com as orientações de integração.</li>
            <li>Ligue "gerar arquivo", escolha os imóveis e envie o endereço acima ao atendimento do portal (atendimento@chavesnamao.com.br · WhatsApp (41) 99266-8447, seg. a sex., 8h30–17h30).</li>
            <li>Peça ao portal a confirmação do processamento e como funciona a retirada de imóveis que saem do arquivo; registre aqui.</li>
            <li>Contatos (leads): o portal não publica um método de envio ao CRM — pergunte no atendimento.</li></ol></details>
          ${linhaPortal(port.chavesnamao, pode)}
        </section>`;
    }
    function cartaoImovelweb(port, pode) {
        const msg = "Olá, equipe Imovelweb. Somos a imobiliária [NOME], cliente/interessada em plano profissional, e usamos o sistema SKL Geo Soluções (contato@sklgeosolucoes.com.br). "
            + "Gostaríamos de saber: 1) qual o método oficial para integrar anúncios a partir de um sistema (XML, API ou parceria); 2) a especificação técnica e o processo para cadastrar a SKL como integradora; "
            + "3) se há ambiente de testes; 4) como funcionam publicação, retirada e envio de contatos (leads) ao sistema; 5) se há custo de integração. Conta Imovelweb: [CÓDIGO DA CONTA]. Obrigado.";
        return `<section class="ext-int-bloco ptl-canal"><header><strong>Imovelweb</strong><span class="ptl-selo ptl-alerta">aguardando especificação oficial</span></header>
          <p class="muted-text">Não há especificação técnica pública nem autorização para a SKL integrar com o Imovelweb. O sistema <b>não gera arquivo</b> para este portal até o portal enviar o manual oficial.
             Na ficha do imóvel dá para marcar a intenção de anunciar; isso não envia nada.</p>
          <details class="ptl-como"><summary>Mensagem pronta para pedir a integração ao Imovelweb</summary>
            <textarea readonly rows="5" class="ptl-msg">${h(msg)}</textarea><div class="ext-int-acoes"><button type="button" class="secondary-button" data-copiar="${h(msg)}">Copiar mensagem</button>
            <a class="text-button" href="https://help.imovelweb.com.br/" target="_blank" rel="noopener">Central de ajuda do Imovelweb ↗</a></div></details>
          ${linhaPortal(port.imovelweb, pode)}
        </section>`;
    }
    function cartaoMfRural(port, pode) {
        return `<section class="ext-int-bloco ptl-canal"><header><strong>MF Rural</strong><span class="ptl-selo ptl-alerta">SEM API OFICIAL CONFIRMADA / PUBLICAÇÃO MANUAL</span></header>
          <p class="muted-text">O MF Rural não oferece integração automática documentada. Para imóveis rurais, a ficha do imóvel prepara o texto (título, área em hectares, valor, benfeitorias, localização e descrição)
             para a imobiliária <b>copiar e cadastrar à mão</b> no site do portal. Nunca vão matrícula, CAR, CCIR, ITR, perímetro ou dados do proprietário.</p>
          <p class="muted-text">Tabela pública consultada em 12/11/2026: "Fazendas / Imóveis Rurais" R$ 399,00 (vitalício, com atualização periódica do anúncio) e "Arrendamentos" R$ 199,00 (anual).
             Imobiliária com vários imóveis deve pedir o plano "Loja oficial" — valor sob consulta. <a href="https://www.mfrural.com.br/politica" target="_blank" rel="noopener">Fonte ↗</a></p>
          ${linhaPortal(port.mfrural, pode)}
        </section>`;
    }
    async function salvarGeral() {
        const dados = { contato: { nome: $("ptlNome").value.trim(), email: $("ptlEmail").value.trim(), telefone: $("ptlTel").value.trim() },
            politica: { reservado: $("ptlPolRes").value, em_negociacao: $("ptlPolNeg").value } };
        if (dados.contato.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.contato.email)) { ctx.toast("E-mail de contato inválido."); return; }
        const { data, error } = await ctx.sb.rpc("portais_configurar", { p_carteira: ctx.carteiraId(), p_dados: dados });
        if (error) { ctx.toast(erro(error)); return; }
        info = data; ctx.toast("Contato e regras dos portais salvos."); desenharPainel();
    }
    async function salvarCanais() {
        const dados = { canais: { grupo_olx: { ativo: !!document.querySelector('[data-canal-ativo="grupo_olx"]').checked }, chavesnamao: { ativo: !!document.querySelector('[data-canal-ativo="chavesnamao"]').checked } } };
        const { data, error } = await ctx.sb.rpc("portais_configurar", { p_carteira: ctx.carteiraId(), p_dados: dados });
        if (error) { ctx.toast(erro(error)); desenharPainel(); return; }
        info = data; ctx.toast("Canais atualizados."); desenharPainel();
    }
    async function salvarPortal(portal) {
        const box = document.querySelector(`.ptl-portal-campos[data-portal="${portal}"]`);
        const v = c => box.querySelector(`[data-c="${c}"]`).value.trim();
        const dt = v("ultimo_processamento_em");
        const dados = { situacao: v("situacao"), plano: { produto: v("produto"), cota: v("cota"), conta: v("conta"), contato: v("contato"), observacao: v("observacao") },
            ultimo_processamento_em: dt ? new Date(dt).toISOString() : "", ultimo_processamento_obs: v("ultimo_processamento_obs"), validado_em: v("validado_em") };
        const { data, error } = await ctx.sb.rpc("portais_definir_portal", { p_carteira: ctx.carteiraId(), p_portal: portal, p_dados: dados });
        if (error) { ctx.toast(erro(error)); return; }
        info = data; ctx.toast("Portal atualizado."); desenharPainel();
    }
    async function novoToken() {
        if (!window.confirm("Trocar o endereço dos arquivos dos portais? O endereço atual para de funcionar e os portais precisam receber o novo.")) return;
        const { error } = await ctx.sb.rpc("portais_novo_token", { p_carteira: ctx.carteiraId() });
        if (error) { ctx.toast(erro(error)); return; }
        info = null; ctx.toast("Endereço trocado. Envie o novo aos portais."); desenharPainel();
    }
    async function copiar(t) {
        try { await navigator.clipboard.writeText(t); ctx.toast("Copiado."); } catch { window.prompt("Copie o texto abaixo:", t); }
    }
    async function baixar(canal) {
        try {
            const r = await fetch(urlFeed(canal, true), { cache: "no-store" });
            if (!r.ok) throw new Error(await r.text());
            const blob = new Blob([ await r.text() ], { type: "application/xml" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${canal === "grupo_olx" ? "vrsync" : "chavesnamao"}_${new Date().toISOString().slice(0, 10)}.xml`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            ctx.toast(`Arquivo baixado (${r.headers.get("x-skl-itens") || "?"} imóvel(is); ${r.headers.get("x-skl-fora-por-erro") || 0} fora por erro).`);
        } catch (e) { ctx.toast("Não foi possível baixar: " + erro(e)); }
    }
    async function diagnostico() {
        const box = $("ptlDiag");
        box.innerHTML = `<p class="muted-text">Verificando…</p>`;
        const { data, error } = await ctx.sb.from("imovel_portais").select("construcao_id,canal,listing_id,estado,selecionado,autorizado,link_anuncio,ultimo_erro,feed_atualizado_em")
            .eq("carteira_id", ctx.carteiraId()).eq("selecionado", true);
        if (error) { box.innerHTML = `<p class="form-message">${h(erro(error))}</p>`; return; }
        const imoveis = new Map(ctx.imoveis().map(i => [ i.id, i ]));
        const contato = Object.assign({}, (info.config || {}).contato || {});
        const pol = (info.config || {}).politica || {};
        const linhas = (data || []).map(r => {
            const i = imoveis.get(r.construcao_id);
            if (!i) return { r, i: null, v: { erros: [ "imóvel fora da lista desta tela (pode ter sido alugado, vendido ou não estar aprovado)" ], avisos: [] } };
            const v = K().validarCanal(r.canal, Object.assign({}, i, { listing_id: r.listing_id }), { contato });
            const fora = i.status !== "disponivel" && !(i.status === "reservado" && pol.reservado === "manter") && !(i.status === "em_negociacao" && pol.em_negociacao !== "retirar");
            if (fora && (r.canal === "grupo_olx" || r.canal === "chavesnamao")) v.avisos = [ `situação "${i.status}" — fica fora do arquivo pela regra da imobiliária` ].concat(v.avisos);
            return { r, i, v };
        }).sort((a, b) => (b.v.erros.length - a.v.erros.length) || String(a.i && a.i.codigo).localeCompare(String(b.i && b.i.codigo)));
        if (!linhas.length) { box.innerHTML = `<p class="muted-text">Nenhum imóvel escolhido para portais ainda. Abra a ficha de um imóvel e marque os portais no bloco "Portais".</p>`; return; }
        const nomeCanal = c => (CANAIS_FICHA.find(x => x.id === c) || { nome: c }).nome;
        const nErros = linhas.filter(l => l.v.erros.length).length;
        box.innerHTML = `<p><b>${linhas.length}</b> escolha(s) · <b>${nErros}</b> com erro (fica fora do arquivo) · ${linhas.length - nErros} pronta(s).</p>
          <div class="ptl-tabela-rolagem"><table class="crm-tabela ext-tabela"><thead><tr><th>Imóvel</th><th>Portal</th><th>Estado</th><th>O que falta / avisos</th></tr></thead><tbody>
          ${linhas.map(({ r, i, v }) => `<tr><td>${i ? `<button type="button" class="text-button" data-abrir="${h(i.id)}">${h(i.codigo || "")} · ${h((i.nome || "").slice(0, 40))}</button>` : "—"}<br><small>${h(r.listing_id)}</small></td>
            <td>${h(nomeCanal(r.canal))}</td><td>${selo(r.estado)}${r.ultimo_erro ? `<br><small>${h(r.ultimo_erro)}</small>` : ""}</td>
            <td>${v.erros.map(e => `<div class="ptl-erro">✖ ${h(e)}</div>`).join("")}${v.avisos.map(a => `<div class="ptl-aviso">• ${h(a)}</div>`).join("") || (v.erros.length ? "" : `<span class="ptl-ok">✔ pronto</span>`)}</td></tr>`).join("")}
          </tbody></table></div>`;
        box.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => { if (ctx.abrirImovel) ctx.abrirImovel(b.dataset.abrir); }));
    }

    // ================================================================ ficha do imóvel
    async function fichaImovel(box, construcao) {
        if (!box) return;
        box.innerHTML = ""; box.hidden = true;
        box.dataset.imovel = (construcao && construcao.id) || "";
        if (!ctx || !ctx.gestao() || document.body.classList.contains("sem-portais")) return;
        box.hidden = false;
        if (!construcao || !construcao.id) { box.innerHTML = `<span class="campo-rotulo">Portais imobiliários</span><p class="muted-text">Salve o imóvel para escolher em quais portais anunciar.</p>`; return; }
        box.innerHTML = `<span class="campo-rotulo">Portais imobiliários</span><p class="muted-text">Carregando…</p>`;
        let dados;
        try {
            const [ r ] = await Promise.all([ ctx.sb.rpc("portais_imovel_obter", { p_construcao: construcao.id }), obter().catch(() => null) ]);
            if (r.error) throw r.error;
            dados = r.data;
        } catch (e) { box.innerHTML = `<span class="campo-rotulo">Portais imobiliários</span><p class="form-message">${h(erro(e))}</p>`; return; }
        if (box.dataset.imovel !== construcao.id) return; // a ficha já foi trocada por outro imóvel
        desenharFicha(box, construcao, dados);
    }
    function desenharFicha(box, c, dados) {
        box.dataset.imovel = c.id;
        const pode = !!dados.pode_editar;
        const por = Object.fromEntries((dados.canais || []).map(x => [ x.canal, x ]));
        const autorizado = (dados.canais || []).some(x => x.autorizado && x.selecionado);
        const contato = Object.assign({}, ((info && info.config) || {}).contato || {});
        const canaisAtivos = ((info && info.config) || {}).canais || {};
        const aprovado = (c.aprovacao || "aprovado") === "aprovado";
        box.innerHTML = `<span class="campo-rotulo">Portais imobiliários</span>
          ${!aprovado ? `<p class="muted-text">Aprove o cadastro antes de enviá-lo aos portais.</p>` : ""}
          <label class="check-inline ptl-autoriza"><input type="checkbox" id="ptlAutoriza"${autorizado ? " checked" : ""}${pode && aprovado ? "" : " disabled"}>
            O proprietário autorizou divulgar este imóvel nos portais marcados (fotos, textos e valores conferidos)</label>
          <div class="ptl-ficha">${CANAIS_FICHA.map(k => {
              const r = por[k.id];
              const v = K().validarCanal(k.id, Object.assign({}, c, { listing_id: r && r.listing_id }), { contato });
              const sel = !!(r && r.selecionado);
              const semArquivo = (k.id === "grupo_olx" || k.id === "chavesnamao") && !(canaisAtivos[k.id] && canaisAtivos[k.id].ativo);
              return `<div class="ptl-ficha-linha" data-canal="${k.id}">
                <div class="ptl-ficha-topo"><label class="check-inline"><input type="checkbox" data-sel="${k.id}"${sel ? " checked" : ""}${pode && aprovado ? "" : " disabled"}> <b>${h(k.nome)}</b></label>
                  ${r ? selo(r.estado) : ""}${r && r.listing_id ? `<small class="ptl-id">ID ${h(r.listing_id)}</small>` : ""}</div>
                <small class="muted-text">${h(k.nota)}</small>
                ${semArquivo && sel ? `<div class="ptl-aviso">• a geração do arquivo deste portal está desligada no menu Portais</div>` : ""}
                ${(sel || !r) ? v.erros.map(e => `<div class="ptl-erro">✖ ${h(e)}</div>`).join("") + v.avisos.map(a => `<div class="ptl-aviso">• ${h(a)}</div>`).join("") : ""}
                ${r && r.ultimo_erro ? `<div class="ptl-erro">Portal informou: ${h(r.ultimo_erro)}</div>` : ""}
                ${r && r.link_anuncio ? `<div class="ext-int-acoes"><a class="secondary-button" href="${h(r.link_anuncio)}" target="_blank" rel="noopener">Ver anúncio no portal</a><button type="button" class="text-button" data-copiar-link="${h(r.link_anuncio)}">Copiar link</button></div>` : ""}
                ${k.id === "mfrural" && sel ? `<div class="ext-int-acoes"><button type="button" class="secondary-button" data-ficha-mf>Copiar ficha para o MF Rural</button><a class="text-button" href="https://www.mfrural.com.br/" target="_blank" rel="noopener">Abrir MF Rural ↗</a></div>` : ""}
                ${r && pode && (k.id === "grupo_olx" || k.id === "chavesnamao") ? `<details class="ptl-retorno"><summary>Registrar retorno do portal</summary>
                    <label><span>O portal informou</span><select data-ret-estado><option value="publicado_confirmado">Publicado</option><option value="processado">Processado (sem link ainda)</option><option value="rejeitado">Rejeitado</option><option value="retirado_confirmado">Retirado</option></select></label>
                    <label><span>Link do anúncio (https://…)</span><input data-ret-link placeholder="https://"></label>
                    <label><span>Observação / motivo (obrigatório se rejeitado)</span><input data-ret-obs maxlength="500"></label>
                    <button type="button" class="secondary-button" data-ret-salvar>Salvar retorno</button></details>` : ""}
              </div>`;
          }).join("")}</div>
          ${(dados.eventos || []).length ? `<details class="ptl-historico"><summary>Histórico nos portais (${dados.eventos.length})</summary><ul>${dados.eventos.map(e =>
              `<li><b>${quando(e.criado_em)}</b> · ${h((CANAIS_FICHA.find(x => x.id === e.canal) || { nome: e.canal }).nome)} · ${h(evTexto(e))}${e.usuario ? ` · ${h(e.usuario)}` : ""}</li>`).join("")}</ul></details>` : ""}`;
        box.querySelectorAll("[data-copiar-link]").forEach(b => b.addEventListener("click", () => copiar(b.dataset.copiarLink)));
        const mf = box.querySelector("[data-ficha-mf]");
        if (mf) mf.addEventListener("click", () => copiar(K().fichaMfRural(c)));
        if (!pode) return;
        box.querySelectorAll("[data-sel]").forEach(inp => inp.addEventListener("change", () => selecionar(box, c, inp.dataset.sel, inp.checked)));
        const aut = $("ptlAutoriza");
        aut.addEventListener("change", () => {
            if (!aut.checked && [ ...box.querySelectorAll("[data-sel]") ].some(x => x.checked))
                ctx.toast("Sem autorização, desmarque os portais para tirar o imóvel dos arquivos.");
        });
        box.querySelectorAll(".ptl-retorno").forEach(d => {
            const canal = d.closest("[data-canal]").dataset.canal;
            d.querySelector("[data-ret-salvar]").addEventListener("click", async () => {
                const { data, error } = await ctx.sb.rpc("portais_imovel_confirmar", { p_construcao: c.id, p_canal: canal,
                    p_estado: d.querySelector("[data-ret-estado]").value, p_link: d.querySelector("[data-ret-link]").value.trim() || null, p_obs: d.querySelector("[data-ret-obs]").value.trim() || null });
                if (error) { ctx.toast(erro(error)); return; }
                ctx.toast("Retorno do portal registrado."); desenharFicha(box, c, data);
            });
        });
    }
    function evTexto(e) {
        const est = k => (ESTADO[k] || [ k ])[0];
        switch (e.evento) {
            case "selecionado": return "escolhido para anunciar" + (e.para ? ` (${est(e.para)})` : "");
            case "desmarcado": return "desmarcado" + (e.para === "remocao_solicitada" ? " — retirada solicitada" : "");
            case "entrou_no_feed": return "entrou no arquivo";
            case "feed_alterado": return "dados atualizados no arquivo (preço, texto, fotos…)";
            case "lido_pelo_portal": return "arquivo lido pelo robô do portal";
            case "saiu_do_feed": return "saiu do arquivo" + (e.detalhe && e.detalhe.situacao ? ` (situação: ${e.detalhe.situacao})` : "") + " — retirada solicitada";
            case "retorno_do_portal": return "retorno do portal: " + est(e.para) + (e.detalhe && e.detalhe.obs ? ` — ${e.detalhe.obs}` : "");
            case "correcao_teste": return "correção de estado de teste";
            default: return e.evento;
        }
    }
    async function selecionar(box, c, canal, marcar) {
        const aut = $("ptlAutoriza");
        if (marcar && !aut.checked) {
            ctx.toast("Marque antes que o proprietário autorizou a divulgação nos portais.");
            box.querySelector(`[data-sel="${canal}"]`).checked = false;
            return;
        }
        if (marcar && canal === "mfrural" && K().classe(c) !== "rural") {
            ctx.toast("O MF Rural é só para imóveis rurais.");
            box.querySelector(`[data-sel="${canal}"]`).checked = false;
            return;
        }
        if (!marcar && !window.confirm("Tirar este imóvel deste portal? Ele sai do próximo arquivo; o portal retira no processamento dele.")) {
            box.querySelector(`[data-sel="${canal}"]`).checked = true; return;
        }
        const { data, error } = await ctx.sb.rpc("portais_imovel_selecionar", { p_construcao: c.id, p_canal: canal, p_selecionado: marcar, p_autorizado: aut.checked });
        if (error) { ctx.toast(erro(error)); box.querySelector(`[data-sel="${canal}"]`).checked = !marcar; return; }
        const anterior = info;
        info = null;
        try { await obter(); } catch { info = anterior; }
        desenharFicha(box, c, data);
    }

    window.SKLPortais = { iniciar, aoMostrar, fichaImovel };
})();
