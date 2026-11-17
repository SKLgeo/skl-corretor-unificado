// Página pública de UM imóvel (link do "Enviar ao cliente") ou de uma SELEÇÃO de imóveis (vários num link só).
// Lê o feed da imobiliária (imobiliaria-feed) pelo token (?f=) + código (?c=) ou só pela chave do link (?e=, seleção).
// Não mostra proprietário nem corretor; o número do WhatsApp vem do link (?w=) de quem enviou. Endereço exato e mapa só quando
// o corretor marcou "Incluir localização" (o feed só devolve a localização com a chave).
// 17/11/2026 — "links que avisam": com a chave de um link, a página avisa o corretor quando o cliente abre (imovel_link_aberto)
// e o cliente pode tocar em ❤ Gostei (imovel_link_gostei). Quem está logado no sistema neste aparelho não conta como abertura.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const q = new URLSearchParams(location.search);
    const token = q.get("f") || "", codigo = q.get("c") || "", whats = (q.get("w") || "").replace(/\D/g, ""), envio = q.get("e") || "";
    const SUPA = "https://xigwlofqkmiibzbongkn.supabase.co";
    const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpZ3dsb2Zxa21paWJ6Ym9uZ2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NzM3NzQsImV4cCI6MjEwNDA0OTc3NH0.USYZqjxQKZxV0Cj5ThaNirNuctJxMfXC6kPqPYK9fgc";
    const FEED = SUPA + "/functions/v1/imobiliaria-feed";
    const dinheiro = v => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const linkRastreado = /^[0-9a-f]{32}$/.test(envio);
    let fotos = [], atual = 0, dados = null, gostei = new Set(), rastreia = false, atualId = null, ignorarPop = false;

    // aparelho de quem usa o sistema (sessão salva do app no mesmo endereço): abrir aqui não avisa o corretor
    function aparelhoDaEquipe() {
        try {
            for (let k = 0; k < localStorage.length; k++) {
                const chave = localStorage.key(k) || "";
                if (/(^|-)auth(-token)?$/.test(chave) && /access_token/.test(localStorage.getItem(chave) || "")) return true;
            }
        } catch { /* sem localStorage: conta normalmente */ }
        return false;
    }
    async function rpc(nome, corpo) {
        try {
            const r = await fetch(`${SUPA}/rest/v1/rpc/${nome}`, { method: "POST",
                headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
            return r.ok ? await r.json() : null;
        } catch { return null; }
    }
    function lerGostei(res) { if (res && Array.isArray(res.gostei)) { gostei = new Set(res.gostei); return true; } return false; }

    function falha(t) { $("carregando").textContent = t; $("carregando").hidden = false; }
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
        if (!doVoltar && history.state && history.state.tela) { ignorarPop = true; history.back(); }
    }
    function precos(i) {
        const ap = i.valor_a_partir ? "a partir de " : "";
        const p = [];
        if (i.valor_aluguel) p.push([ "Aluguel", ap + dinheiro(i.valor_aluguel) + "/mês" ]);
        if (i.valor_venda) p.push([ "Venda", ap + dinheiro(i.valor_venda) ]);
        return p;
    }
    const UNID = { ha: "hectares", alq_mineiro: "alq. goiano", alq_paulista: "alq. paulista", alq_baiano: "alq. baiano", alq_norte: "alq. do Norte" };
    function caracteristicas(i) {
        // área: urbano sempre em m²; rural na unidade do cadastro, com o número exato (ex.: 4,6064 hectares)
        const areaRural = i.rural && UNID[i.area_unidade] && Number(i.area_valor) > 0;
        return [ [ areaRural ? i.area_valor : i.area_m2, areaRural ? UNID[i.area_unidade] : "m²" ], [ i.quartos, "quartos" ], [ i.suites, "suítes" ], [ i.banheiros, "banheiros" ], [ i.vagas, "vagas" ], [ i.salas, "salas" ] ].filter(x => x[0]);
    }
    function botaoGostei(el, id) {
        const ativo = gostei.has(id);
        el.classList.toggle("ativo", ativo);
        if (el.id === "gosteiGrande") el.textContent = ativo ? "❤ Você gostou deste imóvel" : "♡ Gostei deste imóvel";
        else { el.textContent = ativo ? "❤" : "♡"; el.setAttribute("aria-label", ativo ? "Tirar o gostei" : "Gostei"); }
    }
    async function alternarGostei(id) {
        const marcar = !gostei.has(id);
        if (marcar) gostei.add(id); else gostei.delete(id);
        atualizarGosteis();
        const res = await rpc("imovel_link_gostei", { p_chave: envio, p_construcao: id, p_gostei: marcar });
        if (!lerGostei(res)) { if (marcar) gostei.delete(id); else gostei.add(id); }
        atualizarGosteis();
    }
    function atualizarGosteis() {
        document.querySelectorAll("[data-gostei]").forEach(b => botaoGostei(b, b.dataset.gostei));
        if (atualId && !$("gosteiGrande").hidden) botaoGostei($("gosteiGrande"), atualId);
    }

    // ---------- ficha de um imóvel ----------
    function mostrarImovel(i, comVoltar) {
        atualId = i.id;
        document.title = `${i.titulo} — ${dados.carteira.nome}`;
        fotos = i.fotos_url || [];
        atual = 0;
        $("miniaturas").innerHTML = "";
        fotos.forEach((u, k) => { const im = document.createElement("img"); im.src = u; im.alt = ""; im.addEventListener("click", () => mostrarFoto(k)); $("miniaturas").appendChild(im); });
        $("ant").hidden = $("prox").hidden = fotos.length < 2;
        $("miniaturas").hidden = fotos.length < 2;
        $("foto").removeAttribute("src");
        if (fotos.length) mostrarFoto(0); else { $("foto").alt = "Sem fotos"; $("contador").textContent = ""; }
        $("codigo").textContent = `${i.tipo || "Imóvel"} · cód. ${i.codigo}`;
        $("titulo").textContent = i.titulo;
        const e = i.endereco || {};
        const rua = i.localizacao ? [ e.logradouro, e.numero ].filter(Boolean).join(", ") : "";
        $("local").textContent = [ rua, e.bairro, [ e.cidade, e.uf ].filter(Boolean).join("/") ].filter(Boolean).join(" · ");
        $("precos").innerHTML = "";
        precos(i).forEach(([ r, v ]) => { const div = document.createElement("div"); div.className = "preco"; div.innerHTML = "<span></span><strong></strong>"; div.firstChild.textContent = r; div.lastChild.textContent = v; $("precos").appendChild(div); });
        const extras = [];
        if (i.condominio && i.condominio.valor) extras.push("Condomínio " + dinheiro(i.condominio.valor));
        else if (i.condominio && i.condominio.tipo === "incluso") extras.push("Condomínio incluso");
        if (i.iptu && i.iptu.valor) extras.push("IPTU " + dinheiro(i.iptu.valor) + "/ano");
        else if (i.iptu && i.iptu.tipo === "incluso") extras.push("IPTU incluso");
        $("extras").textContent = extras.join(" · ");
        const carac = caracteristicas(i);
        $("carac").innerHTML = "";
        carac.forEach(([ v, r ]) => { const div = document.createElement("div"); div.innerHTML = "<strong></strong><span></span>"; div.firstChild.textContent = Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 }); div.lastChild.textContent = r; $("carac").appendChild(div); });
        $("carac").parentElement.hidden = !carac.length;
        $("descricao").textContent = i.descricao || "";
        $("descBox").hidden = !i.descricao;
        $("rodape").textContent = dados.carteira.nome + (dados.carteira.site ? " · " + dados.carteira.site : "");
        $("whats").hidden = true;
        if (whats.length >= 10) {
            $("whats").href = `https://wa.me/55${whats}?text=${encodeURIComponent(`Olá! Tenho interesse no imóvel ${i.titulo} (cód. ${i.codigo}).`)}`;
            $("whats").hidden = false;
        }
        $("mapa").hidden = true;
        if (i.latitude && i.longitude) {
            $("mapa").href = `https://www.google.com/maps/search/?api=1&query=${i.latitude},${i.longitude}`;
            $("mapa").hidden = false;
        }
        $("gosteiGrande").hidden = !rastreia;
        if (rastreia) botaoGostei($("gosteiGrande"), i.id);
        $("voltarSelecao").hidden = !comVoltar;
        $("carregando").hidden = true;
        $("selecao").hidden = true;
        $("conteudo").hidden = false;
        window.scrollTo(0, 0);
    }

    // ---------- seleção (lista) ----------
    function mostrarLista() {
        atualId = null;
        const lista = dados.imoveis || [];
        document.title = `${(dados.selecao && dados.selecao.titulo) || "Imóveis selecionados"} — ${dados.carteira.nome}`;
        $("selCarteira").textContent = dados.carteira.nome;
        $("selTitulo").textContent = (dados.selecao && dados.selecao.titulo) || "Imóveis selecionados para você";
        const fora = ((dados.selecao && dados.selecao.quantidade) || lista.length) - lista.length;
        $("selQtd").textContent = `${lista.length} imóve${lista.length === 1 ? "l" : "is"}${rastreia ? " · toque em ♡ nos que você gostar" : ""}${fora > 0 ? ` · ${fora} já não ${fora === 1 ? "está" : "estão"} disponível(is)` : ""}`;
        $("selLista").innerHTML = "";
        lista.forEach(i => {
            const card = document.createElement("div");
            card.className = "sel-card";
            card.setAttribute("role", "button");
            card.tabIndex = 0;
            const capa = (i.fotos_url || [])[0];
            if (capa) { const im = document.createElement("img"); im.src = capa; im.alt = ""; im.loading = "lazy"; card.appendChild(im); }
            else { const s = document.createElement("span"); s.className = "sem-foto"; card.appendChild(s); }
            const info = document.createElement("div");
            info.className = "info";
            const t = document.createElement("strong"); t.textContent = i.titulo;
            const e = i.endereco || {};
            const l = document.createElement("small"); l.textContent = [ `cód. ${i.codigo}`, e.bairro, e.cidade ].filter(Boolean).join(" · ");
            const c = document.createElement("small"); c.textContent = caracteristicas(i).map(([ v, r ]) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${r}`).join(" · ");
            const v = document.createElement("div"); v.className = "valor"; v.textContent = precos(i).map(p => p[0] + " " + p[1]).join(" | ");
            info.append(t, l, c, v);
            card.appendChild(info);
            if (rastreia) {
                const g = document.createElement("button");
                g.type = "button"; g.className = "gostei"; g.dataset.gostei = i.id;
                g.addEventListener("click", ev => { ev.stopPropagation(); alternarGostei(i.id); });
                card.appendChild(g);
            }
            const abrir = () => { history.pushState({ ficha: i.id }, ""); abrirFicha(i); };
            card.addEventListener("click", abrir);
            card.addEventListener("keydown", ev => { if (ev.key === "Enter") abrir(); });
            $("selLista").appendChild(card);
        });
        atualizarGosteis();
        $("selRodape").textContent = dados.carteira.nome + (dados.carteira.site ? " · " + dados.carteira.site : "");
        $("conteudo").hidden = true;
        $("carregando").hidden = true;
        $("selecao").hidden = false;
    }
    function abrirFicha(i) {
        mostrarImovel(i, true);
        if (rastreia) rpc("imovel_link_aberto", { p_chave: envio, p_construcao: i.id });
    }

    async function carregar() {
        const listaModo = !codigo && !!envio;
        if (!token || (!codigo && !listaModo)) return falha("Link incompleto.");
        try {
            const r = await fetch(`${FEED}?t=${encodeURIComponent(token)}${codigo ? "&codigo=" + encodeURIComponent(codigo) : ""}${envio ? "&e=" + encodeURIComponent(envio) : ""}`);
            dados = await r.json();
        } catch { return falha("Não foi possível carregar agora. Tente de novo em instantes."); }
        if (!dados || !dados.ok) return falha("Este link não está mais disponível.");
        if (dados.link_invalido) return falha("Este link venceu ou foi apagado. Peça um link novo ao corretor.");
        // registra a abertura (e lê os "gostei" já marcados); fora do aparelho da equipe
        if (linkRastreado && !aparelhoDaEquipe()) rastreia = lerGostei(await rpc("imovel_link_aberto", { p_chave: envio }));
        if (listaModo) {
            if (!(dados.imoveis || []).length) return falha("Os imóveis desta seleção não estão mais disponíveis.");
            mostrarLista();
            return;
        }
        const i = dados.imoveis && dados.imoveis[0];
        if (!i) return falha("Este imóvel não está mais disponível.");
        mostrarImovel(i, false);
    }
    $("ant").addEventListener("click", () => mostrarFoto(atual - 1));
    $("prox").addEventListener("click", () => mostrarFoto(atual + 1));
    $("gosteiGrande").addEventListener("click", () => atualId && alternarGostei(atualId));
    $("voltarSelecao").addEventListener("click", () => { if (history.state && history.state.ficha) history.back(); else mostrarLista(); });
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
    // Voltar do celular: fecha a foto em tela cheia; na ficha de uma seleção, volta para a lista
    window.addEventListener("popstate", () => {
        if (ignorarPop) { ignorarPop = false; return; }
        if (!$("tela").hidden) { fecharTela(true); return; }
        if (!codigo && dados && !$("conteudo").hidden) mostrarLista();
    });
    document.addEventListener("keydown", e => {
        if ($("tela").hidden) return;
        if (e.key === "Escape") fecharTela();
        else if (e.key === "ArrowLeft") mostrarFoto(atual - 1);
        else if (e.key === "ArrowRight") mostrarFoto(atual + 1);
    });
    carregar();
})();
