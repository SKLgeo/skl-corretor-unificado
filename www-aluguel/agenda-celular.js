// Agenda → "📅 Agenda no celular": cada pessoa gera o próprio link de calendário (.ics) e assina no Google Agenda ou no iPhone.
// Os compromissos (próximas ações das negociações, visitas e lembretes) aparecem na agenda do celular e se atualizam sozinhos.
// O link é lido pela Edge Function agenda-ics; só o hash fica no banco, então ele só aparece inteiro na hora em que é gerado.
// Quem gere o CRM pode escolher "toda a equipe". Gerar de novo cancela o link anterior.
(function () {
    "use strict";
    const BASE = "https://xigwlofqkmiibzbongkn.supabase.co/functions/v1/agenda-ics";
    let ctx = null, situacao = null, linkNovo = "";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const quando = iso => iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

    function iniciar(contexto) {
        ctx = contexto;
        linkNovo = "";
        const barra = document.querySelector("#page-agenda .crm-toolbar");
        if (barra && !$("agendaCelularBtn")) {
            const b = document.createElement("button");
            b.type = "button"; b.id = "agendaCelularBtn"; b.className = "secondary-button";
            b.textContent = "📅 Agenda no celular";
            b.addEventListener("click", abrir);
            barra.insertBefore(b, $("crmNovoCompromisso"));
        }
        const agendaConta = document.querySelector('#page-conta .conta-menu [data-go="agenda"]');
        if (agendaConta && !$("contaAgendaCelular")) {
            agendaConta.insertAdjacentHTML("afterend", `<button type="button" id="contaAgendaCelular"><span>📅</span><em>Agenda no celular</em><i>›</i></button>`);
            $("contaAgendaCelular").addEventListener("click", abrir);
        }
    }

    function dialogo() {
        let d = $("agendaCelularDialog");
        if (d) return d;
        d = document.createElement("dialog");
        d.id = "agendaCelularDialog";
        d.className = "crm-dialog agcel-dialog";
        d.innerHTML = `<div class="dialog-card"><span class="eyebrow">AGENDA NO CELULAR</span><h2>Seus compromissos na agenda do celular</h2>
            <div id="agcelCorpo"></div>
            <div class="dialog-actions"><button type="button" class="secondary-button" id="agcelFechar">Fechar</button></div></div>`;
        document.body.appendChild(d);
        $("agcelFechar").addEventListener("click", () => d.close());
        return d;
    }

    async function abrir() {
        const d = dialogo();
        linkNovo = "";
        $("agcelCorpo").innerHTML = `<p class="muted-text">Carregando…</p>`;
        if (!d.open) d.showModal();
        const { data, error } = await ctx.sb.rpc("agenda_situacao", { p_carteira: ctx.carteiraId() });
        if (error) { $("agcelCorpo").innerHTML = `<p class="form-message">${h(erro(error))}</p>`; return; }
        situacao = data || {};
        desenhar();
    }

    function desenhar() {
        const s = situacao || {};
        const escopo = s.escopo || "meus";
        const opcoesEquipe = s.pode_equipe ? `<fieldset class="agcel-escopo"><legend>O que mostrar</legend>
            <label class="check-inline"><input type="radio" name="agcelEscopo" value="meus"${escopo !== "equipe" ? " checked" : ""} /> Só os meus compromissos</label>
            <label class="check-inline"><input type="radio" name="agcelEscopo" value="equipe"${escopo === "equipe" ? " checked" : ""} /> Os de toda a equipe (com o nome do corretor)</label></fieldset>` : "";
        let html = `<p>As próximas ações das suas negociações, as visitas agendadas e os lembretes (aniversário, pós-venda, renovação) aparecem
            na agenda do seu celular, com o nome e o telefone do cliente, e se atualizam sozinhos. Você não digita nada duas vezes.</p>`;
        if (linkNovo) {
            const webcal = linkNovo.replace(/^https:/, "webcal:");
            const google = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
            html += `<div class="agcel-link"><strong>Seu link está pronto. Escolha onde colocar:</strong>
                <div class="agcel-botoes">
                  <a class="primary-button" href="${h(google)}" target="_blank" rel="noopener">Google Agenda (Android)</a>
                  <a class="primary-button" href="${h(webcal)}">Agenda do iPhone</a>
                </div>
                <label class="ext-copia"><span>Ou copie o link e cole na sua agenda ("Adicionar calendário pelo URL")</span>
                  <span class="ext-copia-linha"><input readonly value="${h(linkNovo)}" /><button type="button" class="secondary-button" id="agcelCopiar">Copiar</button></span></label>
                <ul class="agcel-passos">
                  <li><b>Google Agenda:</b> o botão abre o Google Agenda; confirme em <b>Adicionar</b>. Em poucos minutos aparece no app do celular
                      (se não aparecer, no app: Configurações → toque na agenda nova → ative <b>Sincronizar</b>). O Google atualiza a cada algumas horas.</li>
                  <li><b>iPhone:</b> toque no botão e em <b>Assinar</b>. Para atualizar mais rápido: Ajustes → Calendário → Contas → Buscar dados.</li>
                </ul>
                <p class="agcel-aviso">🔒 Quem tiver este link vê os seus compromissos. Não compartilhe. Se ele vazar, gere outro: o atual para de funcionar.</p></div>`;
        } else if (s.ativo) {
            html += `<p class="agcel-situacao">✅ Você já tem um link ativo desde ${h(quando(s.criado_em))}${s.escopo === "equipe" ? " (toda a equipe)" : ""}.
                ${s.ultimo_acesso_em ? `A sua agenda buscou os compromissos pela última vez em ${h(quando(s.ultimo_acesso_em))}.` : "A agenda do celular ainda não buscou os compromissos."}</p>
                <p class="muted-text">Por segurança, o link só aparece inteiro na hora em que é gerado. Trocou de celular ou perdeu o link? Gere um novo.</p>`;
        }
        html += opcoesEquipe;
        html += `<div class="agcel-acoes">
            <button type="button" class="${s.ativo || linkNovo ? "secondary-button" : "primary-button"}" id="agcelGerar">${s.ativo || linkNovo ? "Gerar novo link" : "Gerar meu link"}</button>
            ${s.ativo || linkNovo ? `<button type="button" class="text-button" id="agcelCancelar">Cancelar o link (some da agenda do celular)</button>` : ""}</div>`;
        $("agcelCorpo").innerHTML = html;
        $("agcelGerar").addEventListener("click", gerar);
        if ($("agcelCancelar")) $("agcelCancelar").addEventListener("click", cancelar);
        if ($("agcelCopiar")) $("agcelCopiar").addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(linkNovo); ctx.toast("Link copiado."); }
            catch { window.prompt("Copie o link abaixo:", linkNovo); }
        });
    }

    function escopoEscolhido() {
        const r = document.querySelector('input[name="agcelEscopo"]:checked');
        return r ? r.value : "meus";
    }

    async function gerar() {
        if ((situacao && situacao.ativo || linkNovo) && !window.confirm("Gerar um link novo? O link atual para de funcionar e a agenda que usa ele fica vazia: coloque o link novo no lugar.")) return;
        const escopo = escopoEscolhido();
        const { data, error } = await ctx.sb.rpc("agenda_gerar_link", { p_carteira: ctx.carteiraId(), p_escopo: escopo });
        if (error) { ctx.toast(erro(error)); return; }
        linkNovo = `${BASE}?t=${data}`;
        situacao = { ...(situacao || {}), ativo: true, criado_em: new Date().toISOString(), escopo, ultimo_acesso_em: null };
        desenhar();
    }

    async function cancelar() {
        if (!window.confirm("Cancelar o link? Os compromissos somem da agenda do celular na próxima atualização.")) return;
        const { error } = await ctx.sb.rpc("agenda_cancelar_link", { p_carteira: ctx.carteiraId() });
        if (error) { ctx.toast(erro(error)); return; }
        linkNovo = "";
        situacao = { ...(situacao || {}), ativo: false };
        ctx.toast("Link da agenda cancelado.");
        desenhar();
    }

    window.SKLAgendaCelular = { iniciar, abrir };
})();
