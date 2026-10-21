// Configurações → "Site e portais": a ponte entre a Central e o site/portais da imobiliária.
//  - Feed de imóveis (JSON para o site, XML VRSync para ZAP/VivaReal/OLX), lido pela Edge Function imobiliaria-feed.
//  - Entrada de contatos (formulário do site, portais, RD Station...) pela Edge Function imobiliaria-leads, com chave secreta.
//  - Lista dos últimos contatos recebidos.
// Nada aqui depende de dados do cliente: ligar = copiar os endereços/chave para quem cuida do site e dos portais.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const BASE_FUNCOES = "https://xigwlofqkmiibzbongkn.supabase.co/functions/v1/";
    // página pública do imóvel: a do link do cliente (com prévia de foto no WhatsApp); sem marca, a do SKL Unificado
    const PAGINA_IMOVEL = (window.SKL_MARCA && window.SKL_MARCA.pagina_imovel) || "https://sklgeo.github.io/skl-corretor-unificado/imovel.html";
    let ctx = null, info = null;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));

    function iniciar(contexto) {
        ctx = contexto;
        info = null;
        let painel = $("integracoesPanel");
        if (!painel) {
            painel = document.createElement("div");
            painel.id = "integracoesPanel";
            painel.className = "panel form-panel ext-painel-largo";
            const ancora = $("crmRoletaPanel");
            if (ancora) ancora.parentNode.insertBefore(painel, ancora); else return;
        }
        painel.hidden = !ctx.gestao();
        if (!ctx.gestao()) return;
        painel.innerHTML = `<span class="eyebrow">INTEGRAÇÕES</span><h2>Site e portais</h2><p class="muted-text">Carregando…</p>`;
        carregar();
    }
    async function carregar() {
        const { data, error } = await ctx.sb.rpc("integracao_obter", { p_carteira: ctx.carteiraId() });
        if (error) { $("integracoesPanel").innerHTML = `<span class="eyebrow">INTEGRAÇÕES</span><h2>Site e portais</h2><p class="form-message">${h(erro(error))}</p>`; return; }
        info = data;
        const { data: leads } = await ctx.sb.from("leads_recebidos").select("recebido_em,origem,nome,contato,codigo_imovel,resultado,erro")
            .eq("carteira_id", ctx.carteiraId()).order("recebido_em", { ascending: false }).limit(15);
        desenhar(leads || []);
    }
    function urlFeed(formato) { return `${BASE_FUNCOES}imobiliaria-feed?t=${info.feed_token}${formato ? `&formato=${formato}` : ""}`; }
    function desenhar(leads) {
        const pode = info.pode_editar;
        const dis = pode ? "" : " disabled";
        const ultimo = info.ultimo_lead ? new Date(info.ultimo_lead).toLocaleString("pt-BR") : "nenhum ainda";
        $("integracoesPanel").innerHTML = `<span class="eyebrow">INTEGRAÇÕES</span><h2>Site e portais</h2>
          <p>Ponte pronta para ligar o site da imobiliária e os portais: o site e os portais leem os imóveis marcados "Publicar no site",
             e os contatos que chegam por lá caem direto no CRM (cliente + negociação + roleta). Basta passar os endereços abaixo para quem cuida do site/portais.</p>
          <div class="ext-int-grade">
            <section class="ext-int-bloco">
              <header><strong>1. Vitrine de imóveis (feed)</strong><label class="check-inline"><input id="intFeedAtivo" type="checkbox"${info.feed_ativo ? " checked" : ""}${dis} /> ligado</label></header>
              <p class="muted-text">${h(info.publicados)} imóvel(is) publicados agora (marque "Publicar no site" no cadastro do imóvel).</p>
              ${campoCopia("Para o site (JSON)", urlFeed(""))}
              ${campoCopia("Para ZAP / VivaReal / OLX (XML VRSync)", urlFeed("vrsync"))}
              <div class="ext-int-acoes">
                <a class="secondary-button" href="${h(urlFeed(""))}" target="_blank" rel="noopener">Abrir o feed</a>
                ${pode ? `<button type="button" class="text-button" id="intNovoToken">Trocar endereço (invalida o atual)</button>` : ""}
              </div>
            </section>
            <section class="ext-int-bloco">
              <header><strong>2. Contatos do site e dos portais</strong><label class="check-inline"><input id="intLeadsAtivo" type="checkbox"${info.leads_ativo ? " checked" : ""}${dis} /> ligado</label></header>
              <p class="muted-text">${h(info.leads_30d)} contato(s) nos últimos 30 dias · último: ${h(ultimo)}</p>
              ${campoCopia("Endereço para enviar (POST)", BASE_FUNCOES + "imobiliaria-leads")}
              <p class="muted-text">Chave: ${info.tem_chave ? `<code>${h(info.leads_chave_prefixo)}…</code> (a chave inteira só aparece quando é gerada)` : "ainda não gerada"}</p>
              <div id="intChaveNova" hidden></div>
              <label><span>Contatos sem finalidade informada entram no funil</span>
                <select id="intFunil"${dis}><option value="locacao"${info.leads_funil_padrao === "locacao" ? " selected" : ""}>Locação</option><option value="venda"${info.leads_funil_padrao === "venda" ? " selected" : ""}>Venda</option></select></label>
              <label><span>Site da imobiliária (aparece no feed)</span><input id="intSite" value="${h(info.site_url || "")}" placeholder="https://www.suaimobiliaria.com.br"${dis} /></label>
              <div class="ext-int-acoes">
                ${pode ? `<button type="button" class="secondary-button" id="intNovaChave">${info.tem_chave ? "Gerar nova chave" : "Gerar chave"}</button><button type="button" class="primary-button" id="intSalvar">Salvar</button>` : ""}
                <button type="button" class="text-button" id="intComoLigar">Como ligar o formulário do site</button>
              </div>
              <pre id="intExemplo" class="ext-codigo" hidden></pre>
            </section>
          </div>
          <details class="ext-int-ultimos"${leads.length ? "" : " hidden"}><summary>Últimos contatos recebidos (${leads.length})</summary>
            <table class="crm-tabela ext-tabela"><thead><tr><th>Quando</th><th>Origem</th><th>Nome</th><th>Contato</th><th>Imóvel</th><th>Resultado</th></tr></thead><tbody>
            ${leads.map(l => `<tr><td>${h(new Date(l.recebido_em).toLocaleString("pt-BR"))}</td><td>${h(l.origem || "")}</td><td>${h(l.nome || "—")}</td><td>${h(l.contato || "—")}</td><td>${h(l.codigo_imovel || "")}</td>
              <td>${l.resultado === "erro" ? `<span class="status-pill fin-atrasada">${h(l.erro || "erro")}</span>` : `<span class="status-pill fin-paga">${l.resultado === "novo" ? "cliente novo" : "cliente já existia"}</span>`}</td></tr>`).join("")}
            </tbody></table></details>`;
        const painel = $("integracoesPanel");
        painel.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", () => copiar(b.dataset.copiar)));
        if (!pode) { ligarExemplo(); return; }
        $("intSalvar").addEventListener("click", salvar);
        $("intNovaChave").addEventListener("click", novaChave);
        $("intNovoToken").addEventListener("click", novoToken);
        ligarExemplo();
    }
    function campoCopia(rotulo, valor) {
        return `<label class="ext-copia"><span>${h(rotulo)}</span><span class="ext-copia-linha"><input readonly value="${h(valor)}" /><button type="button" class="secondary-button" data-copiar="${h(valor)}">Copiar</button></span></label>`;
    }
    async function copiar(texto) {
        try { await navigator.clipboard.writeText(texto); ctx.toast("Copiado."); }
        catch { window.prompt("Copie o texto abaixo:", texto); }
    }
    function ligarExemplo() {
        $("intComoLigar").addEventListener("click", () => {
            const pre = $("intExemplo");
            pre.hidden = !pre.hidden;
            pre.textContent = `<!-- Formulário simples no site (HTML). Troque SUA_CHAVE pela chave gerada aqui. -->
<form method="post" action="${BASE_FUNCOES}imobiliaria-leads">
  <input type="hidden" name="chave" value="SUA_CHAVE">
  <input type="hidden" name="origem" value="Site">
  <input type="hidden" name="codigo" value="CÓDIGO DO IMÓVEL (ex.: 00012)">
  <input type="hidden" name="_redirect" value="https://seusite.com.br/obrigado">
  <input name="nome" placeholder="Seu nome" required>
  <input name="telefone" placeholder="WhatsApp com DDD" required>
  <input name="email" placeholder="E-mail">
  <textarea name="mensagem" placeholder="Mensagem"></textarea>
  <label><input type="checkbox" name="consentimento" value="true" required> Autorizo o contato</label>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off"><!-- armadilha anti-robô -->
  <button>Quero saber mais</button>
</form>

// Ou por código (WordPress/JetEngine, RD Station, Zapier, portais):
fetch("${BASE_FUNCOES}imobiliaria-leads", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer SUA_CHAVE" },
  body: JSON.stringify({ nome: "Maria", telefone: "66999990000", email: "maria@email.com",
                         mensagem: "Quero visitar", codigo: "00012", origem: "Site" })
});`;
        });
    }
    async function salvar() {
        const dados = { feed_ativo: $("intFeedAtivo").checked, leads_ativo: $("intLeadsAtivo").checked, leads_funil_padrao: $("intFunil").value, site_url: $("intSite").value.trim() };
        if (dados.leads_ativo && !info.tem_chave) { ctx.toast("Gere a chave antes de ligar o recebimento de contatos."); return; }
        const { error } = await ctx.sb.rpc("integracao_configurar", { p_carteira: ctx.carteiraId(), p_dados: dados });
        if (error) { ctx.toast(erro(error)); return; }
        ctx.toast("Integrações salvas.");
        carregar();
    }
    async function novaChave() {
        if (info.tem_chave && !window.confirm("Gerar uma chave nova? A chave atual para de funcionar na hora: o site e os portais precisam receber a nova.")) return;
        const { data, error } = await ctx.sb.rpc("integracao_nova_chave_leads", { p_carteira: ctx.carteiraId() });
        if (error) { ctx.toast(erro(error)); return; }
        await carregar();
        const box = $("intChaveNova");
        box.hidden = false;
        box.innerHTML = `<div class="ext-chave-nova"><strong>Chave nova — copie agora, ela não aparece de novo:</strong>${campoCopia("Chave", data)}</div>`;
        box.querySelector("[data-copiar]").addEventListener("click", () => copiar(data));
    }
    async function novoToken() {
        if (!window.confirm("Trocar o endereço do feed? O endereço atual para de funcionar: o site e os portais precisam do novo.")) return;
        const { error } = await ctx.sb.rpc("integracao_novo_token_feed", { p_carteira: ctx.carteiraId() });
        if (error) { ctx.toast(erro(error)); return; }
        ctx.toast("Endereço do feed trocado.");
        carregar();
    }
    // usado pelo "Enviar ao cliente" do imóvel
    async function linkPublico(codigo) {
        if (!codigo) return null;
        const { data: token } = await ctx.sb.rpc("integracao_link_publico", { p_carteira: ctx.carteiraId() });
        if (!token) return null;
        return `${PAGINA_IMOVEL}?f=${encodeURIComponent(token)}&c=${encodeURIComponent(codigo)}`;
    }

    window.SKLIntegracoes = { iniciar, linkPublico };
})();
