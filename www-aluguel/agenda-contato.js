// 20/11/2026 (Cerrado: "todo lugar onde pedir número de telefone ter opção de buscar da agenda do telefone").
// Coloca o botão 📇 (ou 📋 Colar, no iPhone) ao lado de TODO campo de telefone do sistema (input com inputmode="tel" ou type="tel", inclusive os que
// aparecem depois na tela) e preenche o número com o contato escolhido na agenda do celular. Onde o formulário tem nome e
// e-mail (VINCULOS), eles vêm junto, mas só se ainda estiverem vazios.
// Usa a API de contatos do navegador: existe no Chrome do Android (link e app instalado pelo Chrome). O iPhone e o computador
// não deixam site nenhum ler a agenda: lá o botão não aparece e nada muda.
// window.SKLAgenda.pedirTelefone({ titulo, valor }) → janela com um campo (com 📇) no lugar do prompt() do navegador.
(function () {
    "use strict";
    const temAgenda = () => !!(navigator.contacts && navigator.contacts.select);
    // 20/11/2026: iPhone (e qualquer tela de toque sem a agenda): botão "📋 Colar" — a pessoa copia o número no app Contatos
    // (toca e segura → Copiar) e o sistema cola já arrumado. No Safari, quem ligar o recurso experimental "Contact Picker API"
    // passa a ter o 📇 Agenda (temAgenda fica verdadeiro sozinho).
    const temColar = () => !!(navigator.clipboard && navigator.clipboard.readText)
        && ((navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && matchMedia("(pointer: coarse)").matches));
    const modo = () => temAgenda() ? "agenda" : (temColar() ? "colar" : null);
    // campo de telefone → campos do mesmo formulário que o contato também preenche
    const VINCULOS = {
        crmCliTelefone: { nome: "crmCliNome", email: "crmCliEmail" },
        propTelefoneInput: { nome: "propNomeInput", email: "propEmailInput" },
        interesseTelefoneInput: { nome: "interesseNomeInput", email: "interesseEmailInput" },
        inviteAluguelTelInput: { nome: "inviteAluguelNameInput" },
        directAluguelTelInput: { nome: "directAluguelNameInput", email: "directAluguelEmailInput" },
        divParcTel: { nome: "divParcNome" }
    };
    // campos que já têm o próprio botão da agenda
    const PULAR = new Set([ "extEnvTel" ]);

    // número da agenda para o formato daqui: tira +55, o 0 + operadora (0xx) e o 0 do DDD
    function digitos(t) {
        let d = String(t || "").replace(/\D/g, "");
        if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
        if (d.length === 14 && d.startsWith("0")) d = d.slice(3);
        if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
        return d;
    }
    function formatar(d) {
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        return d;
    }
    function avisar(texto) {
        let el = document.getElementById("agendaAviso");
        if (!el) { el = document.createElement("div"); el.id = "agendaAviso"; el.className = "agenda-aviso"; el.setAttribute("role", "status"); document.body.appendChild(el); }
        el.textContent = texto;
        el.classList.add("visivel");
        clearTimeout(avisar.t);
        avisar.t = setTimeout(() => el.classList.remove("visivel"), 3200);
    }
    function preencher(el, valor) {
        if (!el || el.disabled || el.readOnly) return;
        el.value = valor;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    async function escolher(input) {
        let lista;
        try {
            const pode = navigator.contacts.getProperties ? await navigator.contacts.getProperties().catch(() => [ "name", "tel" ]) : [ "name", "tel" ];
            lista = await navigator.contacts.select([ "name", "tel", "email" ].filter(p => pode.includes(p)), { multiple: false });
        } catch (e) {
            if (!(e && e.name === "AbortError")) avisar("Não foi possível abrir a agenda do celular.");
            return;
        }
        const c = lista && lista[0];
        if (!c) return;
        const nome = String((c.name || [])[0] || "").trim();
        const tels = (c.tel || []).map(digitos).filter(d => d.length >= 10);
        const tel = tels.find(d => d.length === 11) || tels[0] || "";   // prefere o celular
        const email = String((c.email || [])[0] || "").trim();
        if (!tel) { avisar(nome ? `${nome} não tem telefone na agenda: digite o número.` : "Esse contato não tem telefone."); return; }
        preencher(input, formatar(tel));
        const v = VINCULOS[input.id] || {};
        const campoNome = v.nome && document.getElementById(v.nome);
        if (nome && campoNome && !campoNome.value.trim()) preencher(campoNome, nome);
        const campoEmail = v.email && document.getElementById(v.email);
        if (email && campoEmail && !campoEmail.value.trim()) preencher(campoEmail, email);
        avisar(nome ? `Contato de ${nome} preenchido.` : "Número preenchido.");
    }

    // texto copiado → contato: cartão de contato (vCard) ou qualquer texto com um número de telefone
    function lerTexto(txt) {
        const s = String(txt || "");
        if (/BEGIN:VCARD/i.test(s)) {
            const campo = re => ((s.match(re) || [])[1] || "").trim();
            const tels = [ ...s.matchAll(/^TEL[^:\n]*:(.+)$/gim) ].map(m => digitos(m[1])).filter(d => d.length >= 10);
            return { nome: campo(/^FN[^:\n]*:(.+)$/im), email: campo(/^EMAIL[^:\n]*:(.+)$/im), tel: tels.find(d => d.length === 11) || tels[0] || "" };
        }
        const tels = (s.match(/\+?\d[\d \t ().\-]{7,}\d/g) || []).map(digitos).filter(d => d.length === 10 || d.length === 11);
        return { nome: "", email: "", tel: tels.find(d => d.length === 11) || tels[0] || "" };
    }
    async function colar(input) {
        let txt;
        try { txt = await navigator.clipboard.readText(); }
        catch (e) { input.focus(); avisar("Toque e segure o campo do telefone e escolha Colar."); return; }
        const c = lerTexto(txt);
        if (!c.tel) { avisar("Não achei um número no que foi copiado. No app Contatos, toque e segure o número e escolha Copiar."); return; }
        preencher(input, formatar(c.tel));
        const v = VINCULOS[input.id] || {};
        const campoNome = v.nome && document.getElementById(v.nome);
        if (c.nome && campoNome && !campoNome.value.trim()) preencher(campoNome, c.nome);
        const campoEmail = v.email && document.getElementById(v.email);
        if (c.email && campoEmail && !campoEmail.value.trim()) preencher(campoEmail, c.email);
        avisar("Número colado.");
    }

    function ligar(input) {
        if (input.dataset.agendaLigada || input.dataset.agenda === "nao" || PULAR.has(input.id) || input.type === "hidden") return;
        input.dataset.agendaLigada = "1";
        const caixa = document.createElement("span");
        caixa.className = "agenda-campo";
        input.parentNode.insertBefore(caixa, input);
        caixa.appendChild(input);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "agenda-btn";
        const ag = modo() === "agenda";
        b.title = ag ? "Buscar na agenda do celular" : "Colar o número copiado";
        b.setAttribute("aria-label", b.title);
        b.innerHTML = ag ? "<span>📇</span><small>Agenda</small>" : "<span>📋</span><small>Colar</small>";
        b.addEventListener("click", ev => { ev.preventDefault(); if (input.disabled || input.readOnly) return; if (ag) escolher(input); else colar(input); });
        caixa.appendChild(b);
    }
    const SELETOR = 'input[inputmode="tel"], input[type="tel"]';
    function varrer(raiz) {
        if (!raiz || !raiz.querySelectorAll) return;
        if (raiz.matches && raiz.matches(SELETOR)) ligar(raiz);
        raiz.querySelectorAll(SELETOR).forEach(ligar);
    }

    // janela própria no lugar do prompt() (o prompt do navegador não tem como ganhar o botão da agenda)
    function pedirTelefone({ titulo, valor } = {}) {
        if (!modo()) {
            const r = window.prompt(titulo || "Celular / WhatsApp (com DDD):", valor || "");
            return Promise.resolve(r);
        }
        return new Promise(resolve => {
            let dlg = document.getElementById("agendaTelDialog");
            if (!dlg) {
                dlg = document.createElement("dialog");
                dlg.id = "agendaTelDialog";
                dlg.className = "agenda-tel-dialog";
                dlg.innerHTML = `<form method="dialog" class="dialog-card">
                  <h2 id="agendaTelTitulo"></h2>
                  <label><span>Celular / WhatsApp (com DDD)</span><input id="agendaTelInput" inputmode="tel" placeholder="(66) 99999-9999" autocomplete="off" /></label>
                  <div class="dialog-actions"><button type="button" class="secondary-button" data-agenda-cancelar>Cancelar</button><button type="submit" class="primary-button">Salvar</button></div>
                </form>`;
                document.body.appendChild(dlg);
                varrer(dlg);
            }
            const inp = document.getElementById("agendaTelInput");
            document.getElementById("agendaTelTitulo").textContent = titulo || "Celular / WhatsApp";
            inp.value = valor || "";
            let resposta = null;
            dlg.querySelector("[data-agenda-cancelar]").onclick = () => dlg.close();
            dlg.querySelector("form").onsubmit = ev => { ev.preventDefault(); resposta = inp.value; dlg.close(); };
            dlg.onclose = () => resolve(resposta);
            dlg.showModal();
        });
    }

    window.SKLAgenda = { temAgenda, temColar, pedirTelefone, digitos, formatar, lerTexto };
    if (!modo()) return;
    document.documentElement.classList.add("tem-agenda");
    const iniciar = () => {
        varrer(document.body);
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) varrer(n); }))).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
