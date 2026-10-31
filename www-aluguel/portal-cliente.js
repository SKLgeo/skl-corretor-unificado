// Portal do cliente (lado da Central): quadro "Portal do cliente" na ficha do cliente (gerar e enviar o link pelo WhatsApp,
// copiar, ver como o cliente vê, cancelar) e painel "PIX para receber" em Configurações.
// Só Central, administrador e financeiro (o banco confere de novo em cada RPC). O cliente abre portal.html#t=<token>.
(function () {
    "use strict";
    let ctx = null;
    const $ = id => document.getElementById(id);
    const h = s => ctx.h(s);
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const PAGINA = () => (window.SKL_MARCA && window.SKL_MARCA.pagina_portal) || "https://sklgeo.github.io/skl-corretor-unificado/portal.html";
    const quando = d => d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

    function iniciar(contexto) {
        ctx = contexto;
        painelPix();
    }

    // ------------------------------------------------------------------ ficha do cliente
    async function aoAbrirCliente(c) {
        if (!ctx) return;
        let box = $("portalCliBox");
        if (!box) {
            // logo abaixo do nome e dos botões WhatsApp/Ligar: é o primeiro lugar que a Central olha na ficha
            const ancora = $("crmCliContato");
            if (!ancora) return;
            box = document.createElement("section");
            box.id = "portalCliBox";
            box.className = "crm-sublista portal-cli-box";
            ancora.after(box);
        }
        box.hidden = true;
        if (!c || !ctx.podeGerir()) return;
        const { data: s } = await ctx.sb.rpc("portal_situacao", { p_cliente: c.id });
        if (!s || !s.vinculo) return;
        box.hidden = false;
        box.innerHTML = `<span class="eyebrow">🌐 PORTAL DO CLIENTE</span>
          <p class="muted-text portal-cli-estado">${s.ativo
            ? `Link ativo desde ${h(quando(s.criado_em))}${s.expira_em ? ` · vale até ${h(new Date(s.expira_em).toLocaleDateString("pt-BR"))}` : ""} ·
               ${s.ultimo_acesso_em ? `último acesso ${h(quando(s.ultimo_acesso_em))} (${s.acessos}×)` : "ainda não abriu"}`
            : "O cliente ainda não tem link. Ele vê cobranças com PIX, recibos, repasses, informe de rendimentos e abre chamados, sem precisar de senha."}</p>
          ${s.ativo && s.pin_modo && s.pin_modo !== "nao" ? `<p class="muted-text portal-cli-pin">${s.tem_pin
            ? `🔒 O cliente criou um PIN${s.pin_bloqueado_ate ? ` · <b>bloqueado</b> até ${h(quando(s.pin_bloqueado_ate))} por tentativas erradas` : ""}`
            : (s.pin_modo === "obrigatorio" ? "🔒 O cliente vai criar o PIN no primeiro acesso" : "🔓 O cliente ainda não criou PIN (é opcional)")}</p>` : ""}
          <div class="portal-cli-acoes">
            <button type="button" class="primary-button" data-portal="whats">${s.ativo ? "Enviar novo link pelo WhatsApp" : "Enviar link pelo WhatsApp"}</button>
            <button type="button" class="secondary-button" data-portal="copiar">Gerar e copiar link</button>
            <button type="button" class="secondary-button" data-portal="ver">👁 Ver como o cliente vê</button>
            ${s.ativo ? `<button type="button" class="text-button" data-portal="cancelar">Cancelar link</button>` : ""}
            ${s.tem_pin ? `<button type="button" class="text-button" data-portal="apagarpin">Apagar PIN</button>` : ""}
          </div>
          <label class="portal-cli-validade"><span>Validade do link</span><select data-portal-dias>
            <option value="">Sem prazo (recomendado)</option><option value="365">1 ano</option><option value="180">6 meses</option><option value="30">30 dias</option>
          </select></label>`;
        box.querySelectorAll("[data-portal]").forEach(b => b.addEventListener("click", () => acao(b.dataset.portal, c, s, box)));
    }

    async function gerar(c, s, box) {
        if (s.ativo && !window.confirm("Gerar um link novo? O link enviado antes deixa de funcionar.")) return null;
        const dias = box.querySelector("[data-portal-dias]").value;
        const { data, error } = await ctx.sb.rpc("portal_gerar_link", { p_cliente: c.id, p_dias: dias ? Number(dias) : null });
        if (error) { ctx.toast(erro(error)); return null; }
        return `${PAGINA()}#t=${data.token}`;
    }

    async function acao(qual, c, s, box) {
        if (qual === "ver") {
            const janela = window.open("", "_blank");
            const { data, error } = await ctx.sb.rpc("portal_previa", { p_cliente: c.id });
            if (error) { if (janela) janela.close(); ctx.toast(erro(error)); return; }
            const url = `${PAGINA()}#t=${data}`;
            if (janela) janela.location = url; else window.open(url, "_blank");
            return;
        }
        // PIN do portal: cliente esqueceu ou bloqueou → apaga; no próximo acesso ele cria outro
        if (qual === "apagarpin") {
            if (!window.confirm("Apagar o PIN do cliente? No próximo acesso ele cria um PIN novo.")) return;
            const { error } = await ctx.sb.rpc("portal_pin_apagar", { p_cliente: c.id });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast("PIN apagado.");
            aoAbrirCliente(c);
            return;
        }
        if (qual === "cancelar") {
            if (!window.confirm("Cancelar o link? O cliente não consegue mais abrir o portal até receber um novo.")) return;
            const { error } = await ctx.sb.rpc("portal_cancelar_link", { p_cliente: c.id });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast("Link cancelado.");
            aoAbrirCliente(c);
            return;
        }
        const link = await gerar(c, s, box);
        if (!link) return;
        if (qual === "copiar") {
            try { await navigator.clipboard.writeText(link); ctx.toast("Link copiado. Envie ao cliente."); }
            catch { window.prompt("Copie o link do portal:", link); }
        } else {
            const nome = (c.apelido || c.nome || "").split(" ")[0];
            const texto = `Olá${nome ? ", " + nome : ""}! Este é o seu portal na ${ctx.carteiraNome()}: cobranças com PIX, recibos, repasses e chamados de manutenção, tudo num lugar só. O link é pessoal, não compartilhe:\n${link}\n\nDica: ao abrir, toque em "Instalar o app" para ter o ícone Meu Portal na tela do celular.`;
            const fone = String(c.telefone_digitos || c.telefone || "").replace(/\D/g, "");
            const numero = fone ? (fone.length <= 11 ? "55" + fone : fone) : "";
            window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
            if (!fone) ctx.toast("O cliente está sem celular: escolha o contato no WhatsApp.");
        }
        aoAbrirCliente(c);
    }

    // ------------------------------------------------------------------ Configurações → PIX para receber
    async function painelPix() {
        const grade = document.querySelector("#page-settings .settings-grid");
        if (!grade) return;
        let p = $("portalPixPanel");
        if (!p) {
            p = document.createElement("form");
            p.id = "portalPixPanel";
            p.className = "panel form-panel";
            grade.appendChild(p);
        }
        p.hidden = !ctx.podeGerir();
        if (p.hidden) return;
        const { data } = await ctx.sb.from("carteiras_aluguel").select("*").eq("id", ctx.carteiraId()).maybeSingle();
        painelPin(grade, data);
        const pix = (data && data.pix) || {};
        p.innerHTML = `<span class="eyebrow">PORTAL DO CLIENTE</span><h2>PIX para receber os aluguéis</h2>
          <p>O inquilino paga pelo portal com QR Code ou "copia e cola", direto na conta da imobiliária, sem tarifa. A baixa continua sendo feita no Financeiro.</p>
          <label><span>Chave PIX</span><input id="pixChave" maxlength="77" placeholder="CNPJ, e-mail, celular (+55...) ou chave aleatória" value="${h(pix.chave || "")}" /></label>
          <label><span>Nome do recebedor (como aparece no banco)</span><input id="pixNome" maxlength="25" value="${h(pix.nome || "")}" /></label>
          <label><span>Cidade</span><input id="pixCidade" maxlength="15" value="${h(pix.cidade || "")}" /></label>
          <label class="check-inline"><input id="pixAtivo" type="checkbox" ${pix.ativo === false ? "" : "checked"} /> Mostrar "Pagar com PIX" no portal</label>
          <button class="primary-button" type="submit">Salvar PIX</button>
          <p class="muted-text">${pix.alterado_em ? "Alterado em " + h(quando(pix.alterado_em)) : "Ainda não configurado."}</p>`;
        p.onsubmit = async ev => {
            ev.preventDefault();
            const { error } = await ctx.sb.rpc("configurar_pix_carteira", { p_carteira: ctx.carteiraId(), p_dados: {
                chave: $("pixChave").value, nome: $("pixNome").value, cidade: $("pixCidade").value, ativo: $("pixAtivo").checked } });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast("PIX salvo.");
            painelPix();
        };
    }

    // ------------------------------------------------------------------ Configurações → PIN do portal (só aparece com o banco novo)
    function painelPin(grade, carteira) {
        let p = $("portalPinPanel");
        if (!p) {
            p = document.createElement("form");
            p.id = "portalPinPanel";
            p.className = "panel form-panel";
            grade.appendChild(p);
        }
        p.hidden = !carteira || !("portal_pin_modo" in carteira);
        if (p.hidden) return;
        p.innerHTML = `<span class="eyebrow">PORTAL DO CLIENTE</span><h2>Segurança do portal</h2>
          <p>Escolha se o cliente entra só com o link ou se também precisa de um PIN de 4 a 6 números. Com o PIN, quem pegar o link não entra.
            O PIN é pedido uma vez em cada aparelho. Esqueceu: apague o PIN na ficha do cliente.</p>
          <label><span>PIN do cliente</span><select id="portalPinModo">
            <option value="nao">Só o link (sem PIN)</option>
            <option value="opcional">O cliente pode criar um PIN</option>
            <option value="obrigatorio">PIN obrigatório no primeiro acesso</option>
          </select></label>
          <button class="primary-button" type="submit">Salvar segurança</button>`;
        $("portalPinModo").value = carteira.portal_pin_modo || "nao";
        p.onsubmit = async ev => {
            ev.preventDefault();
            const { error } = await ctx.sb.rpc("configurar_portal_pin", { p_carteira: ctx.carteiraId(), p_modo: $("portalPinModo").value });
            if (error) { ctx.toast(erro(error)); return; }
            ctx.toast("Segurança do portal salva.");
        };
    }

    window.SKLPortalCliente = { iniciar, aoAbrirCliente };
})();
