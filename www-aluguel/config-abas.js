// Configurações em abas (05/11/2026): a tela juntava uns 15 quadros um embaixo do outro. Agora cada quadro vai para uma aba
// pelo id (ou, se for um quadro novo, pelo texto do "eyebrow"); só aparecem as abas que têm algum quadro visível para quem
// está usando. Os módulos continuam criando os quadros como antes — este arquivo só organiza. A aba escolhida fica no aparelho.
(function () {
    "use strict";
    const ABAS = [
        [ "conta", "👤 Minha conta" ],
        [ "imobiliaria", "🏢 Imobiliária e acessos" ],
        [ "imoveis", "⌂ Imóveis" ],
        [ "crm", "▤ CRM" ],
        [ "comissoes", "% Comissões" ],
        [ "site", "🌐 Site, portal e PIX" ],
        [ "documentos", "📄 Documentos" ],
        [ "outros", "⋯ Outros" ]
    ];
    const POR_ID = {
        aparenciaPanel: "conta", passwordForm: "conta",
        funcoesCarteiraPanel: "imobiliaria", permissoesPanel: "imobiliaria",
        settingsCadastroPanel: "imoveis",
        crmConfigPanel: "crm", crmMotivosPanel: "crm", crmFaixasPanel: "crm", crmRoletaPanel: "crm",
        comRegrasPanel: "comissoes",
        integracoesPanel: "site", portalPixPanel: "site", portalPinPanel: "site",
        docModelosPanel: "documentos"
    };
    const POR_TEXTO = [
        [ /PERFIL|SEGURAN|CARTEIRA|SOBRE|APAR[ÊE]NCIA/, "conta" ],
        [ /FUN[ÇC][ÕO]ES|ACESSO/, "imobiliaria" ],
        [ /IM[ÓO]VE|CADASTRO|QUALIDADE/, "imoveis" ],
        [ /CRM|ROLETA|FUNI|PERDA/, "crm" ],
        [ /COMISS/, "comissoes" ],
        [ /PORTAL|PIX|SITE|INTEGRA/, "site" ],
        [ /DOCUMENTO|CONTRATO|MODELO/, "documentos" ]
    ];
    const CHAVE = "sklu_alug_config_aba";
    let atual = "";
    try { atual = localStorage.getItem(CHAVE) || ""; } catch {}
    let montando = false;

    function abaDe(el) {
        if (el.id && POR_ID[el.id]) return POR_ID[el.id];
        const eb = ((el.querySelector(".eyebrow") || {}).textContent || "").toUpperCase();
        const achou = POR_TEXTO.find(([ re ]) => re.test(eb));
        return achou ? achou[1] : "outros";
    }

    function montar() {
        const pagina = document.getElementById("page-settings");
        const grade = pagina && pagina.querySelector(".settings-grid");
        if (!grade || montando) return;
        montando = true;
        try {
            let barra = document.getElementById("cfgAbas");
            if (!barra) {
                barra = document.createElement("nav");
                barra.id = "cfgAbas";
                barra.className = "cfg-abas";
                barra.setAttribute("aria-label", "Partes das configurações");
                grade.parentNode.insertBefore(barra, grade);
                barra.addEventListener("click", e => {
                    const b = e.target.closest("[data-cfg-aba]");
                    if (!b) return;
                    atual = b.dataset.cfgAba;
                    try { localStorage.setItem(CHAVE, atual); } catch {}
                    montar();
                    const topo = barra.getBoundingClientRect().top + window.scrollY - 70;
                    if (window.scrollY > topo) window.scrollTo(0, Math.max(0, topo));
                });
            }
            // mede quem está visível sem o filtro da aba (quadros escondidos por permissão/função não contam)
            const filhos = [ ...grade.children ];
            filhos.forEach(el => el.removeAttribute("data-cfg-fora"));
            const contagem = {};
            filhos.forEach(el => {
                el.dataset.cfgAba = abaDe(el);
                if (!el.hidden && getComputedStyle(el).display !== "none") contagem[el.dataset.cfgAba] = (contagem[el.dataset.cfgAba] || 0) + 1;
            });
            const existentes = ABAS.filter(([ k ]) => contagem[k]);
            if (!existentes.length) return;
            if (!contagem[atual]) atual = existentes[0][0];
            filhos.forEach(el => { if (el.dataset.cfgAba !== atual) el.setAttribute("data-cfg-fora", ""); });
            const html = existentes.map(([ k, n ]) => `<button type="button" data-cfg-aba="${k}" class="${k === atual ? "ativo" : ""}">${n}<small>${contagem[k]}</small></button>`).join("");
            if (barra.dataset.html !== html) { barra.innerHTML = html; barra.dataset.html = html; }
            const ativo = barra.querySelector(".ativo");
            if (ativo && barra.scrollWidth > barra.clientWidth) barra.scrollTo({ left: Math.max(0, ativo.offsetLeft - 20) });
        } finally { montando = false; }
    }

    let espera = null;
    const agendar = () => { clearTimeout(espera); espera = setTimeout(montar, 60); };
    function iniciar() {
        const grade = document.querySelector("#page-settings .settings-grid");
        if (!grade) return;
        montar();
        // quadros criados ou escondidos depois (permissões, funções ligadas/desligadas, módulos que carregam mais tarde)
        new MutationObserver(muts => { if (!montando && muts.some(m => m.type === "childList" || m.attributeName === "hidden" || m.attributeName === "style")) agendar(); })
            .observe(grade, { childList: true, subtree: true, attributes: true, attributeFilter: [ "hidden", "style" ] });
        new MutationObserver(agendar).observe(document.body, { attributes: true, attributeFilter: [ "class" ] });
        // ao abrir a tela de Configurações, confere de novo (quem entrou pode ter outro tipo de acesso)
        new MutationObserver(agendar).observe(document.getElementById("page-settings"), { attributes: true, attributeFilter: [ "class", "hidden" ] });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
    window.SKLConfigAbas = { montar };
})();
