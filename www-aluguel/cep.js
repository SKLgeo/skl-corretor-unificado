// CEP → endereço (10/11/2026, pedido da Cerrado): ao digitar os 8 números do CEP, busca rua, bairro, cidade e UF.
// Serviços públicos e gratuitos, sem chave: ViaCEP (principal) e BrasilAPI (reserva). Só o CEP sai do aparelho.
// Preenche os campos vazios; campo já preenchido com outro valor não é trocado sozinho: aparece "Usar o endereço do CEP".
// Mesmo arquivo no navegador (window.SKLCep) e nos testes (require).
(function (raiz) {
    "use strict";
    const cache = new Map();
    const digitos = v => String(v || "").replace(/\D/g, "");
    function formatar(v) { const d = digitos(v).slice(0, 8); return d.length > 5 ? d.slice(0, 5) + "-" + d.slice(5) : d; }

    function comLimite(url, ms) {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = setTimeout(() => ctl && ctl.abort(), ms);
        return fetch(url, ctl ? { signal: ctl.signal } : {}).finally(() => clearTimeout(t));
    }
    // { cep, logradouro, bairro, cidade, uf } | null (CEP não existe) — erro de rede lança
    async function buscar(cep) {
        const d = digitos(cep);
        if (d.length !== 8) return null;
        if (cache.has(d)) return cache.get(d);
        let res = null, falhou = 0;
        try {
            const r = await comLimite(`https://viacep.com.br/ws/${d}/json/`, 6000);
            if (r.ok) { const j = await r.json(); res = j && !j.erro ? { cep: formatar(d), logradouro: j.logradouro || "", bairro: j.bairro || "", cidade: j.localidade || "", uf: j.uf || "" } : null; }
            else falhou++;
        } catch (e) { falhou++; }
        if (!res && falhou) {
            try {
                const r = await comLimite(`https://brasilapi.com.br/api/cep/v1/${d}`, 6000);
                if (r.ok) { const j = await r.json(); res = { cep: formatar(d), logradouro: j.street || "", bairro: j.neighborhood || "", cidade: j.city || "", uf: j.state || "" }; }
                else if (r.status !== 404) throw new Error("rede");
            } catch (e) { throw new Error("Não consegui consultar o CEP agora (sem internet?). Preencha o endereço à mão."); }
        }
        cache.set(d, res);
        return res;
    }

    // campos: { cep, logradouro, bairro, cidade, uf, numero, aviso } (elementos ou ids); depois?: chamado após preencher
    function ligar(campos, depois) {
        const el = x => typeof x === "string" ? document.getElementById(x) : x;
        const cepEl = el(campos.cep);
        if (!cepEl || cepEl.dataset.sklCep) return;
        cepEl.dataset.sklCep = "1";
        cepEl.setAttribute("inputmode", "numeric");
        cepEl.setAttribute("maxlength", "9");
        let ultimo = "";
        const avisar = (texto, tipo, botao) => {
            const a = el(campos.aviso);
            if (!a) return;
            a.hidden = !texto;
            a.className = "cep-aviso" + (tipo ? " " + tipo : "");
            a.textContent = texto || "";
            if (botao) { const b = document.createElement("button"); b.type = "button"; b.className = "text-button"; b.textContent = botao.rotulo; b.addEventListener("click", botao.acao); a.append(" ", b); }
        };
        async function consultar() {
            const d = digitos(cepEl.value);
            if (cepEl.value !== formatar(cepEl.value)) cepEl.value = formatar(cepEl.value);
            if (d.length !== 8) { if (!d.length) avisar(""); return; }
            if (d === ultimo) return;
            ultimo = d;
            avisar("Buscando o endereço do CEP…", "buscando");
            let r;
            try { r = await buscar(d); } catch (e) { ultimo = ""; avisar(e.message, "erro"); return; }
            if (digitos(cepEl.value) !== d) return;   // a pessoa já mudou o CEP
            if (!r) { avisar("CEP não encontrado. Confira os números ou preencha o endereço à mão.", "erro"); return; }
            const pares = [ [ "logradouro", r.logradouro ], [ "bairro", r.bairro ], [ "cidade", r.cidade ], [ "uf", r.uf ] ]
                .map(([ k, v ]) => [ el(campos[k]), v ]).filter(([ e, v ]) => e && v);
            // campo "vazio" = em branco ou com um valor padrão que o app colocou (data-cep-pode-trocar), ex.: a cidade da imobiliária
            const livre = e => !e.value.trim() || e.dataset.cepPodeTrocar === "1";
            const diferentes = pares.filter(([ e, v ]) => !livre(e) && e.value.trim().toLowerCase() !== v.toLowerCase());
            pares.forEach(([ e, v ]) => { if (livre(e)) { e.value = v; e.dataset.cepPodeTrocar = ""; e.dispatchEvent(new Event("input", { bubbles: true })); } });
            const resumo = [ r.logradouro, r.bairro, r.cidade && r.uf ? `${r.cidade}/${r.uf}` : r.cidade ].filter(Boolean).join(" · ");
            const trocar = () => { pares.forEach(([ e, v ]) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }); avisar(`Endereço do CEP: ${resumo}.`, "ok"); if (depois) depois(r); };
            if (diferentes.length) avisar(`O CEP é de ${resumo}. Mantive o que já estava escrito.`, "aviso", { rotulo: "Usar o endereço do CEP", acao: trocar });
            else avisar(`Endereço do CEP: ${resumo}.${r.logradouro ? "" : " (CEP geral da cidade: escreva a rua.)"}`, "ok");
            const num = el(campos.numero);
            if (num && !num.value.trim() && r.logradouro && document.activeElement === cepEl) num.focus();
            if (depois) depois(r);
        }
        cepEl.addEventListener("input", consultar);
        // o que a pessoa escreve à mão deixa de ser "valor padrão"
        [ "logradouro", "bairro", "cidade", "uf" ].forEach(k => { const e = el(campos[k]); if (e) e.addEventListener("input", ev => { if (ev.isTrusted) e.dataset.cepPodeTrocar = ""; }); });
        cepEl.addEventListener("change", consultar);
        // reabrir o formulário com outro registro: zera o "último CEP buscado"
        cepEl.addEventListener("skl-cep-limpar", () => { ultimo = ""; avisar(""); });
    }
    function limpar(campoCep) {
        const e = typeof campoCep === "string" ? document.getElementById(campoCep) : campoCep;
        if (e) e.dispatchEvent(new Event("skl-cep-limpar"));
    }

    const api = { buscar, ligar, limpar, formatar, digitos };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else raiz.SKLCep = api;
})(typeof window !== "undefined" ? window : globalThis);
