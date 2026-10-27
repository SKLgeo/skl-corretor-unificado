// Página pública de UM imóvel (link do "Enviar ao cliente"): lê o feed da imobiliária (imobiliaria-feed) pelo token + código.
// Não mostra proprietário nem corretor; o número do WhatsApp vem do link (?w=) de quem enviou. Endereço exato e mapa só quando
// o corretor marcou "Incluir localização" (o link traz ?e=<chave> e o feed só devolve a localização com ela).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const q = new URLSearchParams(location.search);
    const token = q.get("f") || "", codigo = q.get("c") || "", whats = (q.get("w") || "").replace(/\D/g, ""), envio = q.get("e") || "";
    const FEED = "https://xigwlofqkmiibzbongkn.supabase.co/functions/v1/imobiliaria-feed";
    const dinheiro = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    let fotos = [], atual = 0;

    function falha(t) { $("carregando").textContent = t; }
    function mostrarFoto(i) {
        if (!fotos.length) return;
        atual = (i + fotos.length) % fotos.length;
        $("foto").src = fotos[atual];
        $("contador").textContent = `${atual + 1}/${fotos.length}`;
        [ ...$("miniaturas").children ].forEach((m, k) => m.classList.toggle("ativa", k === atual));
        if (!$("tela").hidden) desenharTela();
    }
    // foto em tela cheia: toque na foto abre; setas, arrastar o dedo, teclado; Voltar do celular fecha
    function desenharTela() {
        $("telaFoto").src = fotos[atual];
        $("telaCont").textContent = `${atual + 1}/${fotos.length}`;
        $("telaAnt").hidden = $("telaProx").hidden = fotos.length < 2;
    }
    function abrirTela() {
        if (!fotos.length || !$("tela").hidden) return;
        $("tela").hidden = false;
        document.body.classList.add("tela-aberta");
        desenharTela();
        history.pushState({ tela: 1 }, "");
    }
    function fecharTela(doVoltar) {
        if ($("tela").hidden) return;
        $("tela").hidden = true;
        document.body.classList.remove("tela-aberta");
        if (!doVoltar && history.state && history.state.tela) history.back();
    }
    async function carregar() {
        if (!token || !codigo) return falha("Link incompleto.");
        let d;
        try {
            const r = await fetch(`${FEED}?t=${encodeURIComponent(token)}&codigo=${encodeURIComponent(codigo)}${envio ? "&e=" + encodeURIComponent(envio) : ""}`);
            d = await r.json();
        } catch { return falha("Não foi possível carregar agora. Tente de novo em instantes."); }
        const i = d && d.ok && d.imoveis && d.imoveis[0];
        if (!i) return falha("Este imóvel não está mais disponível.");
        document.title = `${i.titulo} — ${d.carteira.nome}`;
        fotos = i.fotos_url || [];
        $("miniaturas").innerHTML = "";
        fotos.forEach((u, k) => { const im = document.createElement("img"); im.src = u; im.alt = ""; im.addEventListener("click", () => mostrarFoto(k)); $("miniaturas").appendChild(im); });
        $("ant").hidden = $("prox").hidden = fotos.length < 2;
        $("miniaturas").hidden = fotos.length < 2;
        if (fotos.length) mostrarFoto(0); else $("foto").alt = "Sem fotos";
        $("codigo").textContent = `${i.tipo || "Imóvel"} · cód. ${i.codigo}`;
        $("titulo").textContent = i.titulo;
        const e = i.endereco || {};
        const rua = i.localizacao ? [ e.logradouro, e.numero ].filter(Boolean).join(", ") : "";
        $("local").textContent = [ rua, e.bairro, [ e.cidade, e.uf ].filter(Boolean).join("/") ].filter(Boolean).join(" · ");
        const precos = [];
        if (i.valor_aluguel) precos.push([ "Aluguel", dinheiro(i.valor_aluguel) + "/mês" ]);
        if (i.valor_venda) precos.push([ "Venda", dinheiro(i.valor_venda) ]);
        $("precos").innerHTML = "";
        precos.forEach(([ r, v ]) => { const div = document.createElement("div"); div.className = "preco"; div.innerHTML = "<span></span><strong></strong>"; div.firstChild.textContent = r; div.lastChild.textContent = v; $("precos").appendChild(div); });
        const extras = [];
        if (i.condominio && i.condominio.valor) extras.push("Condomínio " + dinheiro(i.condominio.valor));
        else if (i.condominio && i.condominio.tipo === "incluso") extras.push("Condomínio incluso");
        if (i.iptu && i.iptu.valor) extras.push("IPTU " + dinheiro(i.iptu.valor) + "/ano");
        else if (i.iptu && i.iptu.tipo === "incluso") extras.push("IPTU incluso");
        $("extras").textContent = extras.join(" · ");
        // área: urbano sempre em m²; rural na unidade do cadastro, com o número exato (ex.: 4,6064 hectares)
        const UNID = { ha: "hectares", alq_mineiro: "alq. goiano", alq_paulista: "alq. paulista", alq_baiano: "alq. baiano", alq_norte: "alq. do Norte" };
        const areaRural = i.rural && UNID[i.area_unidade] && Number(i.area_valor) > 0;
        const carac = [ [ areaRural ? i.area_valor : i.area_m2, areaRural ? UNID[i.area_unidade] : "m²" ], [ i.quartos, "quartos" ], [ i.suites, "suítes" ], [ i.banheiros, "banheiros" ], [ i.vagas, "vagas" ], [ i.salas, "salas" ] ].filter(x => x[0]);
        $("carac").innerHTML = "";
        carac.forEach(([ v, r ]) => { const div = document.createElement("div"); div.innerHTML = "<strong></strong><span></span>"; div.firstChild.textContent = Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 }); div.lastChild.textContent = r; $("carac").appendChild(div); });
        $("carac").parentElement.hidden = !carac.length;
        $("descricao").textContent = i.descricao || "";
        $("descBox").hidden = !i.descricao;
        $("rodape").textContent = d.carteira.nome + (d.carteira.site ? " · " + d.carteira.site : "");
        if (whats.length >= 10) {
            $("whats").href = `https://wa.me/55${whats}?text=${encodeURIComponent(`Olá! Tenho interesse no imóvel ${i.titulo} (cód. ${i.codigo}).`)}`;
            $("whats").hidden = false;
        }
        if (i.latitude && i.longitude) {
            $("mapa").href = `https://www.google.com/maps/search/?api=1&query=${i.latitude},${i.longitude}`;
            $("mapa").hidden = false;
        }
        $("carregando").hidden = true;
        $("conteudo").hidden = false;
    }
    $("ant").addEventListener("click", () => mostrarFoto(atual - 1));
    $("prox").addEventListener("click", () => mostrarFoto(atual + 1));
    // arrastar o dedo troca a foto; toque sem arrastar (na foto da página) abre em tela cheia
    function deslize(el, aoTocar) {
        let x0 = null, y0 = null;
        el.addEventListener("touchstart", e => { if (e.touches.length > 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
        el.addEventListener("touchend", e => {
            if (x0 == null) return;
            const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { mostrarFoto(atual + (dx < 0 ? 1 : -1)); e.preventDefault(); }
            else if (aoTocar && Math.abs(dx) < 10 && Math.abs(dy) < 10) { aoTocar(); e.preventDefault(); }
        });
    }
    deslize($("foto"), abrirTela);
    deslize($("tela"));
    $("foto").addEventListener("click", abrirTela);
    $("telaFechar").addEventListener("click", () => fecharTela());
    $("telaAnt").addEventListener("click", e => { e.stopPropagation(); mostrarFoto(atual - 1); });
    $("telaProx").addEventListener("click", e => { e.stopPropagation(); mostrarFoto(atual + 1); });
    $("tela").addEventListener("click", e => { if (e.target === $("tela")) fecharTela(); });
    window.addEventListener("popstate", () => fecharTela(true));
    document.addEventListener("keydown", e => {
        if ($("tela").hidden) return;
        if (e.key === "Escape") fecharTela();
        else if (e.key === "ArrowLeft") mostrarFoto(atual - 1);
        else if (e.key === "ArrowRight") mostrarFoto(atual + 1);
    });
    carregar();
})();
