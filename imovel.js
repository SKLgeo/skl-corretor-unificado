// Página pública de UM imóvel (link do "Enviar ao cliente"): lê o feed da imobiliária (imobiliaria-feed) pelo token + código.
// Não mostra proprietário, corretor nem endereço exato (só bairro/cidade); o número do WhatsApp vem do link (?w=) de quem enviou.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const q = new URLSearchParams(location.search);
    const token = q.get("f") || "", codigo = q.get("c") || "", whats = (q.get("w") || "").replace(/\D/g, "");
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
    }
    async function carregar() {
        if (!token || !codigo) return falha("Link incompleto.");
        let d;
        try {
            const r = await fetch(`${FEED}?t=${encodeURIComponent(token)}&codigo=${encodeURIComponent(codigo)}`);
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
        $("local").textContent = [ e.bairro, [ e.cidade, e.uf ].filter(Boolean).join("/") ].filter(Boolean).join(" · ");
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
        // área grande (rural, gleba) em hectares
        const areaHa = Number(i.area_m2) >= 10000;
        const carac = [ [ areaHa ? Math.round(Number(i.area_m2) / 100) / 100 : i.area_m2, areaHa ? "hectares" : "m²" ], [ i.quartos, "quartos" ], [ i.suites, "suítes" ], [ i.banheiros, "banheiros" ], [ i.vagas, "vagas" ], [ i.salas, "salas" ] ].filter(x => x[0]);
        $("carac").innerHTML = "";
        carac.forEach(([ v, r ]) => { const div = document.createElement("div"); div.innerHTML = "<strong></strong><span></span>"; div.firstChild.textContent = Number(v).toLocaleString("pt-BR"); div.lastChild.textContent = r; $("carac").appendChild(div); });
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
    let x0 = null;
    $("foto").addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    $("foto").addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) mostrarFoto(atual + (dx < 0 ? 1 : -1)); x0 = null; });
    carregar();
})();
