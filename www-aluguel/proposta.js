// "Proposta de negócios": estudo de mercado com proposta de valor, em PDF com a marca da imobiliária.
// O imóvel avaliado e os imóveis comparados podem vir do cadastro ou ser digitados aqui ("imóvel de fora", com fotos).
// Nada do cadastro é alterado: o que se ajusta (área, valor) vale só dentro da proposta. Um imóvel de fora só entra
// no cadastro se a pessoa tocar em "Cadastrar na Central" (abre o cadastro normal, já preenchido).
// Cálculo (método comparativo simplificado): R$/m² de cada amostra = valor ÷ área; amostras muito longe da mediana
// ficam de fora; valor de mercado = média do R$/m² × área do imóvel; venda rápida e otimista = mercado − / + um percentual.
(function () {
    "use strict";
    let ctx = null, propostas = [], atual = null, buscaModo = "amostra", pendenteCadastro = null;
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const dinheiro = (v, casas = 0) => v == null || !isFinite(v) ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    const numero = (v, casas = 2) => v == null || !isFinite(v) || !v ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
    const pct = v => (v > 0 ? "+" : "") + v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
    const novoId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    const TIPOS = [ "Casa", "Casa de condomínio", "Sobrado", "Apartamento", "Cobertura", "Kitnet/Studio", "Sala comercial", "Ponto comercial", "Galpão", "Terreno", "Chácara/Sítio", "Fazenda", "Sítio", "Chácara rural", "Área rural", "Outro" ];
    const SO_TERRENO = [ "Terreno", "Terreno rural", "Área rural" ];
    // Configuração da imobiliária (carteiras_aluguel.proposta_config, gravada pela Central em "⚙ Configuração da proposta").
    // Toda proposta nova começa com estes valores; o que o corretor muda vale só na proposta dele.
    const CFG_PADRAO = {
        faixa: 30, min_corte: 3, min_amostras: 3, calculo: "media", oferta: 0, arredondar: 0,
        oportunidade: 10, competitivo: 5, otimista: 10, ajuste_max: 15, sugerido: "competitivo", validade: 30,
        corretor_altera: true, mostrar_estatisticas: true, mostrar_pedido_pdf: false, texto_pdf: "",
        exclusividade_ligada: true, ex_prazo: 90, ex_comissao: 6, ex_autorizacao: true,
        ex_texto: "Trabalhamos para vender o seu imóvel pelo melhor valor possível, no menor tempo, com segurança na documentação e acompanhamento em cada etapa. Com a exclusividade, concentramos o esforço de toda a equipe no seu imóvel e você tem um único responsável por cuidar de tudo.",
        ex_plano: "Fotos e descrição caprichadas do imóvel\nAnúncio no site da imobiliária e nos principais portais\nDivulgação para a nossa carteira de clientes e corretores parceiros\nPlaca no imóvel, com a sua autorização\nVisitas sempre acompanhadas por um corretor\nRetorno ao proprietário a cada 15 dias, com visitas e propostas recebidas",
        ex_compromissos: "Atender os interessados com agilidade\nConferir o perfil dos interessados antes das visitas\nApresentar por escrito todas as propostas recebidas\nAcompanhar a documentação até a assinatura da escritura"
    };
    let cfg = { ...CFG_PADRAO };
    const FAIXAS = [ [ "oportunidade", "Valor de oportunidade" ], [ "competitivo", "Valor competitivo" ], [ "mercado", "Valor de mercado" ], [ "otimista", "Valor otimista" ] ];
    const NOME_FAIXA = Object.fromEntries(FAIXAS);
    const CURTO = { oportunidade: "Oportunidade", competitivo: "Competitivo", mercado: "Mercado", otimista: "Otimista" };
    const ehCentral = () => !!ctx && [ "administrador", "central_vendas" ].includes(ctx.papel && ctx.papel());
    const travado = () => !ehCentral() && cfg.corretor_altera === false;
    function ajustesPadrao() {
        return { base: "auto", faixa: cfg.faixa, min_corte: cfg.min_corte, calculo: cfg.calculo, oferta: cfg.oferta,
            oportunidade: cfg.oportunidade, competitivo: cfg.competitivo, otimista: cfg.otimista, ajuste: 0, ajuste_motivo: "", sugerido: cfg.sugerido };
    }
    // propostas antigas (antes de 05/11/2026) tinham "rapido" e destacavam o valor de mercado
    function normalizar(p) {
        const aj = p.ajustes || {};
        if (aj.oportunidade == null) {
            p.ajustes = { ...ajustesPadrao(), base: aj.base || "auto", faixa: aj.faixa ?? 30, min_corte: 3, calculo: "media", oferta: 0,
                oportunidade: aj.rapido ?? 8, competitivo: cfg.competitivo, otimista: aj.otimista ?? 10, sugerido: "mercado" };
        } else p.ajustes = { ...ajustesPadrao(), ...aj };
        if (!p.tipo) p.tipo = "estudo";
        if (p.incluir_corretor == null) p.incluir_corretor = p.tipo === "exclusividade";
        if (p.mostrar_pedido == null) p.mostrar_pedido = !!cfg.mostrar_pedido_pdf;
        if (!p.exclusividade) p.exclusividade = { prazo_dias: cfg.ex_prazo, comissao_pct: cfg.ex_comissao, autorizacao: !!cfg.ex_autorizacao };
        return p;
    }

    // ---------- guardar: tabela imobiliaria_propostas (RPC proposta_salvar / proposta_excluir) ----------
    // Fotos dos imóveis de fora: enquanto não salva ficam no aparelho (data:...); ao salvar vão para o Storage
    // em <carteira>/propostas/<proposta>/<arquivo> e no item fica só o caminho.
    const BUCKET = "fotos-construcoes";
    const ehDataUrl = f => typeof f === "string" && f.startsWith("data:");
    const doRegistro = r => normalizar({ ...(r.dados || {}), id: r.id, titulo: r.titulo || (r.dados && r.dados.titulo) || "", criado_por: r.criado_por, atualizado_em: r.atualizado_em });
    async function carregarConfig() {
        try {
            const { data, error } = await ctx.sb.rpc("proposta_config", { p_carteira: ctx.carteiraId() });
            cfg = { ...CFG_PADRAO, ...((!error && data) || {}) };
        } catch { cfg = { ...CFG_PADRAO }; }
    }
    async function carregar() {
        const { data, error } = await ctx.sb.from("imobiliaria_propostas").select("id, titulo, dados, criado_por, criado_em, atualizado_em")
            .eq("carteira_id", ctx.carteiraId()).order("atualizado_em", { ascending: false });
        if (error) { console.error(error); propostas = []; return; }
        propostas = (data || []).map(doRegistro);
    }
    function caminhosDe(p) {
        const lista = [];
        [ p && p.alvo, ...((p && p.amostras) || []) ].forEach(i => { if (i && i.origem === "fora") (i.fotos || []).forEach(f => { if (!ehDataUrl(f)) lista.push(f); }); });
        return lista;
    }

    async function iniciar(contexto) {
        ctx = contexto;
        propostas = [];
        await carregarConfig();
        await carregar();
        atual = null;
        montarDialogos();
        document.addEventListener("skl-imovel-salvo", aoSalvarImovel);
        render();
    }
    function sair() { atual = null; propostas = []; document.removeEventListener("skl-imovel-salvo", aoSalvarImovel); }
    async function aoMostrar() { if (!atual) { await carregarConfig(); await carregar(); } render(); }

    // ---------- áreas: o cadastro tem um campo só (area_m2); a descrição costuma dizer "X m² de área construída em terreno de Y m²" ----------
    function lerNumero(s) { const v = Number(String(s).replace(/\./g, "").replace(",", ".")); return v >= 10 && v <= 10000000 ? v : null; }
    function areasDaDescricao(txt) {
        const t = String(txt || "").replace(/\s+/g, " ");
        const N = "(\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";
        const m1 = t.match(new RegExp(N + "\\s*m(?:²|2)\\s*(?:de\\s*)?(?:[áa]rea\\s*)?constru[íi]da", "i"))
            || t.match(new RegExp("[áa]rea\\s*constru[íi]da\\s*(?:de|:|com)?\\s*" + N + "\\s*m", "i"));
        const m2 = t.match(new RegExp("terreno\\s*(?:de|com|:|medindo)?\\s*" + N + "\\s*m", "i"))
            || t.match(new RegExp(N + "\\s*m(?:²|2)\\s*de\\s*terreno", "i"));
        return { ac: m1 ? lerNumero(m1[1]) : null, at: m2 ? lerNumero(m2[1]) : null };
    }
    function dadosDoCadastro(c, finalidade) {
        const area = Number(c.area_m2) || null;
        const { ac, at } = areasDaDescricao(c.descricao);
        let construida = null, terreno = null, lido = false;
        if (SO_TERRENO.includes(c.tipo_imovel) || c.lote || c.rural) terreno = area;
        else if (ac) { construida = ac; terreno = at || (area && area !== ac ? area : null); lido = true; }
        else if (at && area === at) { terreno = at; lido = true; }
        else { construida = area; terreno = at; lido = !!at; }
        const venda = finalidade !== "aluguel";
        return {
            nome: c.nome, codigo: c.codigo || "", tipo_imovel: c.tipo_imovel || "", bairro: c.bairro || "", cidade: c.cidade || "", uf: c.uf || "",
            logradouro: c.logradouro || "", numero: c.numero || "", edificio: c.edificio || "",
            area_construida: construida, area_terreno: terreno, areas_da_descricao: lido,
            quartos: c.quartos, suites: c.suites, banheiros: c.banheiros, vagas: c.vagas,
            valor: Number(venda ? c.valor_venda : c.valor_aluguel) || null, valor_condominio: Number(c.valor_condominio) || null,
            status: c.status, descricao: c.descricao || "", anunciado_por: nomeMarca(), link: ""
        };
    }

    const nomeMarca = () => (window.SKL_MARCA && window.SKL_MARCA.nome) || ctx.carteiraNome() || "Imobiliária";

    // ---------- cálculo ----------
    function baseEfetiva(p) {
        if (p.ajustes.base !== "auto") return p.ajustes.base;
        const a = p.alvo && p.alvo.dados;
        if (a && a.area_construida) return "construida";
        if (a && a.area_terreno) return "terreno";
        const comAc = p.amostras.filter(x => x.dados.area_construida).length;
        return comAc >= p.amostras.length / 2 ? "construida" : "terreno";
    }
    const areaBase = (d, base) => Number(base === "terreno" ? d.area_terreno : d.area_construida) || 0;
    const mediana = v => { const s = [ ...v ].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    function arredondar(v) {
        if (!v) return v;
        const passo = Number(cfg.arredondar) > 0 && v >= 100000 ? Number(cfg.arredondar) : v >= 100000 ? 1000 : v >= 10000 ? 100 : 10;
        return Math.round(v / passo) * passo;
    }

    function calcular(p) {
        const base = baseEfetiva(p), aj = p.ajustes;
        const oferta = Math.min(50, Math.max(0, Number(aj.oferta) || 0)) / 100;
        const linhas = p.amostras.map((a, i) => {
            const area = areaBase(a.dados, base), valor = Number(a.dados.valor) || 0;
            let situacao = "ok", motivo = "";
            if (!a.usar) { situacao = "fora"; motivo = "Desmarcada"; }
            else if (!valor) { situacao = "fora"; motivo = "Sem valor"; }
            else if (!area) { situacao = "fora"; motivo = base === "terreno" ? "Sem área do terreno" : "Sem área construída"; }
            // desconto de negociação: o anúncio costuma fechar abaixo do pedido
            return { i, a, area, valor, m2: area && valor ? valor * (1 - oferta) / area : null, situacao, motivo };
        });
        const validas = linhas.filter(l => l.situacao === "ok");
        let med = validas.length ? mediana(validas.map(l => l.m2)) : null;
        if (validas.length >= Math.max(2, Number(aj.min_corte) || 3) && aj.faixa > 0) {
            validas.forEach(l => {
                const desvio = (l.m2 / med - 1) * 100;
                if (Math.abs(desvio) > aj.faixa) { l.situacao = "longe"; l.motivo = `${pct(desvio)} da mediana`; }
            });
        }
        const usadas = linhas.filter(l => l.situacao === "ok");
        const m2s = usadas.map(l => l.m2);
        const media = m2s.length ? m2s.reduce((s, x) => s + x, 0) / m2s.length : null;
        if (m2s.length) med = mediana(m2s);
        const desvio = m2s.length > 1 ? Math.sqrt(m2s.reduce((s, x) => s + (x - media) ** 2, 0) / (m2s.length - 1)) : 0;
        const alvo = p.alvo ? p.alvo.dados : null;
        const areaAlvo = alvo ? areaBase(alvo, base) : 0;
        const r = { base, linhas, usadas: usadas.length, media, mediana: med, min: m2s.length ? Math.min(...m2s) : null, max: m2s.length ? Math.max(...m2s) : null,
            cv: media ? desvio / media * 100 : null, areaAlvo, pedido: alvo ? Number(alvo.valor) || null : null };
        // m² de partida (média ou mediana) e o ajuste por diferenciais do imóvel avaliado
        r.m2Partida = aj.calculo === "mediana" ? med : media;
        r.m2 = r.m2Partida ? r.m2Partida * (1 + (Number(aj.ajuste) || 0) / 100) : null;
        if (r.m2 && areaAlvo) {
            const m = r.m2 * areaAlvo;
            r.mercado = arredondar(m);
            r.oportunidade = arredondar(m * (1 - (Number(aj.oportunidade) || 0) / 100));
            r.competitivo = arredondar(m * (1 - (Number(aj.competitivo) || 0) / 100));
            r.otimista = arredondar(m * (1 + (Number(aj.otimista) || 0) / 100));
            r.rapido = r.oportunidade;
            r.m2Faixa = { oportunidade: r.m2 * (1 - (Number(aj.oportunidade) || 0) / 100), competitivo: r.m2 * (1 - (Number(aj.competitivo) || 0) / 100),
                mercado: r.m2, otimista: r.m2 * (1 + (Number(aj.otimista) || 0) / 100) };
            r.sugerido = r[aj.sugerido] || r.mercado;
            r.faixaMin = arredondar(r.min * areaAlvo);
            r.faixaMax = arredondar(r.max * areaAlvo);
            if (r.pedido) {
                r.pedidoM2 = r.pedido / areaAlvo;
                r.difPedido = (r.pedido / r.mercado - 1) * 100;
                r.leitura = r.pedido > r.otimista ? "acima" : r.pedido < r.oportunidade ? "abaixo" : "dentro";
            }
        }
        r.confianca = !r.usadas ? "" : r.usadas < 3 ? "baixa" : r.cv != null && r.cv > 25 ? "media" : r.usadas >= 5 ? "alta" : "media";
        return r;
    }
    const BASE_TXT = { construida: "área construída", terreno: "área do terreno" };
    const CONF_TXT = { baixa: "Baixa (poucos imóveis comparados)", media: "Média", alta: "Boa" };
    function leituraTexto(r) {
        if (!r.leitura) return "";
        if (r.leitura === "acima") return `O valor pedido está ${pct(r.difPedido)} em relação ao valor de mercado, acima até da faixa otimista. Tende a ficar mais tempo anunciado e a receber propostas abaixo do pedido.`;
        if (r.leitura === "abaixo") return `O valor pedido está ${pct(r.difPedido)} em relação ao valor de mercado, abaixo até do valor de oportunidade. Vale conferir se não há espaço para pedir mais.`;
        return `O valor pedido está ${pct(r.difPedido)} em relação ao valor de mercado, dentro da faixa praticada na região.`;
    }

    // ---------- tela ----------
    function render() {
        const box = $("propostasConteudo");
        if (!box || !ctx) return;
        if (!atual) return renderLista(box);
        renderEditor(box);
    }

    function renderLista(box) {
        const ordenadas = [ ...propostas ].sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
        box.innerHTML = `<div class="page-actions"><p>Monte um estudo de mercado com proposta de valor para o proprietário: escolha o imóvel, os imóveis parecidos para comparar
            (do cadastro ou de fora) e gere o PDF com a marca da imobiliária.</p>
            <div class="prop-lista-acoes">
              <button id="propEuCorretor" type="button" class="secondary-button">👤 Eu corretor</button>
              ${ehCentral() ? `<button id="propConfig" type="button" class="secondary-button">⚙ Configuração da proposta</button>` : ""}
              <button id="propNova" type="button" class="primary-button">+ Nova proposta</button></div></div>
          <p class="prop-aviso">${ctx.pode && ctx.pode("ver_equipe_toda") ? "Aqui aparecem as propostas de toda a equipe." : "Aqui aparecem as propostas que você criou."}</p>
          ${ordenadas.length ? `<div class="prop-lista">${ordenadas.map(p => {
                const r = calcular(p);
                return `<button type="button" class="prop-cartao" data-abrir="${h(p.id)}">
                  <strong>${h(p.titulo || "Proposta sem título")}</strong>
                  <span>${h(p.alvo ? [ p.alvo.dados.tipo_imovel, p.alvo.dados.bairro ].filter(Boolean).join(" · ") : "Imóvel ainda não escolhido")}</span>
                  <span>${p.amostras.length} imóve${p.amostras.length === 1 ? "l" : "is"} comparado${p.amostras.length === 1 ? "" : "s"}${r.mercado ? " · mercado " + dinheiro(r.mercado) : ""}</span>
                  <small>${h(p.cliente || "")}${p.cliente ? " · " : ""}${new Date(p.atualizado_em).toLocaleDateString("pt-BR")}</small></button>`;
            }).join("")}</div>` : `<div class="empty-state">Nenhuma proposta ainda. Toque em "+ Nova proposta".</div>`}`;
        $("propNova").addEventListener("click", nova);
        $("propEuCorretor").addEventListener("click", () => abrirEuCorretor());
        if ($("propConfig")) $("propConfig").addEventListener("click", abrirConfig);
        box.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => { atual = normalizar(JSON.parse(JSON.stringify(propostas.find(p => p.id === b.dataset.abrir)))); render(); }));
    }

    function nova() {
        const u = ctx.usuario() || {};
        atual = normalizar({ id: novoId(), titulo: "", finalidade: "venda", cliente: "", corretor: u.display_name || "", corretor_id: u.id || null,
            validade_dias: Number(cfg.validade) || 30, observacoes: "", alvo: null, amostras: [], ajustes: ajustesPadrao(), tipo: "estudo",
            criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
        render();
    }

    function cartaoImovelHtml(item, papel, idx) {
        const d = item.dados;
        const foto = `<div class="prop-foto" data-foto="${papel}:${idx}"></div>`;
        const linha2 = [ d.tipo_imovel, d.bairro, d.cidade ].filter(Boolean).join(" · ");
        const carac = [ d.quartos ? d.quartos + " qto" : "", d.suites ? d.suites + " suíte" : "", d.vagas ? d.vagas + " vaga" : "" ].filter(Boolean).join(" · ");
        return `${foto}<div class="prop-im-info"><strong>${d.codigo ? "Cód. " + h(d.codigo) + " · " : ""}${h(d.nome || "Imóvel")}</strong>
          <span>${h(linha2)}</span><span>${h(carac)}</span>
          <span class="prop-origem ${item.origem}">${item.origem === "cadastro" ? "Do cadastro" : "De fora" + (d.anunciado_por ? " · " + h(d.anunciado_por) : "")}</span></div>`;
    }

    function renderEditor(box) {
        const p = atual, r = calcular(p), base = r.base;
        const venda = p.finalidade !== "aluguel";
        box.innerHTML = `
        <div class="prop-topo">
          <button id="propVoltar" type="button" class="secondary-button">← Propostas</button>
          <div class="prop-topo-acoes">
            <button id="propPdf" type="button" class="primary-button">📄 Gerar PDF</button>
            <button id="propSalvar" type="button" class="secondary-button">Salvar</button>
            <button id="propExcluir" type="button" class="danger-button">Excluir</button>
          </div>
        </div>
        <section class="panel form-panel prop-bloco">
          <span class="eyebrow">1 · PROPOSTA</span>
          <div class="prop-grade">
            <label class="prop-largo"><span>Título</span><input id="propTitulo" value="${h(p.titulo)}" placeholder="Ex.: Estudo de mercado — Casa no Sagrada Família" /></label>
            <label><span>Finalidade</span><select id="propFinalidade"><option value="venda"${venda ? " selected" : ""}>Venda</option><option value="aluguel"${venda ? "" : " selected"}>Locação</option></select></label>
            <label><span>Para (proprietário ou cliente)</span><input id="propCliente" value="${h(p.cliente)}" placeholder="Nome de quem vai receber" /></label>
            <label><span>Corretor responsável</span><input id="propCorretor" value="${h(p.corretor)}" /></label>
            <label><span>Validade (dias)</span><input id="propValidade" type="number" min="1" max="365" value="${h(p.validade_dias)}" /></label>
            <label class="prop-largo"><span>Observações (vão no PDF)</span><textarea id="propObs" rows="2" placeholder="Ex.: imóvel reformado em 2024; documentação em dia.">${h(p.observacoes)}</textarea></label>
          </div>
        </section>
        <section class="panel form-panel prop-bloco">
          <span class="eyebrow">2 · IMÓVEL AVALIADO</span>
          ${p.alvo ? `<div class="prop-alvo">${cartaoImovelHtml(p.alvo, "alvo", 0)}
              <div class="prop-alvo-campos">
                <label><span>Área construída (m²)</span><input data-alvo-campo="area_construida" inputmode="decimal" value="${p.alvo.dados.area_construida ? numero(p.alvo.dados.area_construida) : ""}" /></label>
                <label><span>Área do terreno (m²)</span><input data-alvo-campo="area_terreno" inputmode="decimal" value="${p.alvo.dados.area_terreno ? numero(p.alvo.dados.area_terreno) : ""}" /></label>
                <label><span>${venda ? "Valor pedido" : "Aluguel pedido"}</span><input data-alvo-campo="valor" inputmode="decimal" value="${p.alvo.dados.valor ? dinheiro(p.alvo.dados.valor, 2) : ""}" /></label>
              </div>
              ${p.alvo.dados.areas_da_descricao ? `<p class="prop-dica">📏 As áreas foram lidas da descrição do anúncio. Confira antes de gerar o PDF.</p>` : ""}
              <div class="prop-alvo-acoes">
                <button type="button" class="secondary-button" data-editar="alvo">Editar dados</button>
                <button type="button" class="secondary-button" id="propTrocarAlvo">Trocar imóvel</button>
                ${p.alvo.origem === "fora" ? `<button type="button" class="secondary-button" data-cadastrar="alvo">Cadastrar na Central</button>` : ""}
              </div></div>`
            : `<p class="muted-text">Escolha o imóvel que vai ser avaliado.</p>
               <div class="prop-botoes"><button id="propAlvoCadastro" type="button" class="primary-button">Escolher do cadastro</button>
               <button id="propAlvoFora" type="button" class="secondary-button">Imóvel de fora (digitar)</button></div>`}
        </section>
        <section class="panel form-panel prop-bloco">
          <span class="eyebrow">3 · IMÓVEIS PARA COMPARAR</span>
          <div class="prop-botoes">
            <button id="propSugerir" type="button" class="primary-button"${p.alvo ? "" : " disabled"}>✨ Sugerir do mesmo bairro</button>
            <button id="propAddCadastro" type="button" class="secondary-button">+ Do cadastro</button>
            <button id="propAddFora" type="button" class="secondary-button">+ Imóvel de fora</button>
          </div>
          ${p.amostras.length ? `<div class="prop-amostras">${r.linhas.map(l => {
                const d = l.a.dados;
                return `<div class="prop-amostra ${l.situacao}">
                  <label class="prop-usar" title="Usar no cálculo"><input type="checkbox" data-usar="${l.i}"${l.a.usar ? " checked" : ""} /><b>${l.i + 1}</b></label>
                  <div class="prop-amostra-im">${cartaoImovelHtml(l.a, "amostra", l.i)}</div>
                  <div class="prop-amostra-num">
                    <span><small>Constr.</small>${numero(d.area_construida)} m²</span>
                    <span><small>Terreno</small>${numero(d.area_terreno)} m²</span>
                    <span><small>${venda ? "Valor" : "Aluguel"}</small>${dinheiro(d.valor)}</span>
                    <span class="prop-m2"><small>R$/m² (${base === "terreno" ? "terreno" : "constr."})</small>${l.m2 ? dinheiro(l.m2, 2) : "—"}</span>
                  </div>
                  <div class="prop-amostra-acoes">
                    ${l.situacao !== "ok" ? `<em class="prop-motivo">${h(l.motivo === "Desmarcada" ? "Fora do cálculo" : l.situacao === "longe" ? "Muito diferente: " + l.motivo : l.motivo)}</em>` : ""}
                    ${d.areas_da_descricao ? `<em class="prop-motivo leve">Áreas lidas da descrição</em>` : ""}
                    <button type="button" class="secondary-button" data-editar="${l.i}">Editar</button>
                    ${l.a.origem === "fora" ? `<button type="button" class="secondary-button" data-cadastrar="${l.i}">Cadastrar na Central</button>` : ""}
                    <button type="button" class="secondary-button" data-remover="${l.i}">Tirar</button>
                  </div></div>`;
            }).join("")}</div>` : `<p class="muted-text">Ainda nenhum. Use "Sugerir do mesmo bairro" ou adicione um por um. O ideal é de 4 a 8 imóveis parecidos.</p>`}
        </section>
        <section class="panel form-panel prop-bloco">
          <span class="eyebrow">4 · CÁLCULO E REGULAÇÃO</span>
          ${regulacaoHtml(p, r)}
          <div id="propResultado">${resultadoHtml(p, r)}</div>
        </section>
        ${tipoHtml(p)}`;
        ligarEditor(box);
        preencherFotos(box);
    }

    // controles do cálculo: os deslizantes redesenham só o resultado (sem perder o dedo no controle)
    function regulacaoHtml(p, r) {
        const aj = p.ajustes, trava = travado(), dis = trava ? " disabled" : "", max = Math.max(0, Number(cfg.ajuste_max) || 0);
        const venda = p.finalidade !== "aluguel";
        const deslizante = (chave, rotulo, min, maxv, sinal) => `<label class="prop-desl"><span>${rotulo}</span>
            <input type="range" data-desl="${chave}" min="${min}" max="${maxv}" step="0.5" value="${aj[chave] || 0}"${chave === "ajuste" ? "" : dis} />
            <b data-desl-valor="${chave}">${sinal(aj[chave] || 0)}</b></label>`;
        return `<div class="prop-grade prop-ajustes">
            <label><span>Comparar pelo valor do m² da</span><select id="propBase">
              <option value="auto"${aj.base === "auto" ? " selected" : ""}>Automático (${BASE_TXT[r.base]})</option>
              <option value="construida"${aj.base === "construida" ? " selected" : ""}>Área construída</option>
              <option value="terreno"${aj.base === "terreno" ? " selected" : ""}>Área do terreno</option></select></label>
            <label><span>Calcular pela</span><select id="propCalculo"${dis}><option value="media"${aj.calculo !== "mediana" ? " selected" : ""}>Média do m²</option>
              <option value="mediana"${aj.calculo === "mediana" ? " selected" : ""}>Mediana do m²</option></select></label>
            <label><span>Deixar de fora quem passa de (% da mediana)</span><input id="propFaixa" type="number" min="0" max="200" value="${aj.faixa}"${dis} /></label>
            <label><span>Desconto de negociação dos anúncios (%)</span><input id="propOferta" type="number" min="0" max="30" step="0.5" value="${aj.oferta || 0}"${dis} /></label>
          </div>
          <div class="prop-regula">
            ${max ? deslizante("ajuste", "Ajuste por diferenciais do imóvel", -max, max, v => (v > 0 ? "+" : "") + numero(v, 1).replace("—", "0") + "%") : ""}
            ${max ? `<label class="prop-largo prop-motivo-aj"><span>Motivo do ajuste (vai no PDF)</span><input id="propAjusteMotivo" value="${h(aj.ajuste_motivo || "")}" placeholder="Ex.: piscina e reforma recente; rua sem saída" /></label>` : ""}
            ${deslizante("oportunidade", "Oportunidade (abaixo do mercado)", 0, 30, v => "−" + numero(v, 1).replace("—", "0") + "%")}
            ${deslizante("competitivo", "Competitivo (abaixo do mercado)", 0, 20, v => "−" + numero(v, 1).replace("—", "0") + "%")}
            ${deslizante("otimista", "Otimista (acima do mercado)", 0, 30, v => "+" + numero(v, 1).replace("—", "0") + "%")}
            ${trava ? `<p class="prop-dica">🔒 Os percentuais seguem a configuração da imobiliária. Você pode usar o ajuste por diferenciais (até ±${numero(max, 1)}%).</p>` : ""}
            <div class="prop-sugerido"><span>Valor sugerido para ${venda ? "a venda" : "a locação"}:</span>
              ${FAIXAS.map(([ k, n ]) => `<button type="button" data-sugerido="${k}" class="${aj.sugerido === k ? "on" : ""}">${CURTO[k]}</button>`).join("")}</div>
          </div>`;
    }

    function barrasHtml(p, r) {
        const linhas = [ ...FAIXAS.map(([ k, n ]) => ({ n, m2: r.m2Faixa[k], total: r[k], faixa: true, on: p.ajustes.sugerido === k })),
            ...r.linhas.filter(l => l.situacao === "ok").map(l => ({ n: "Amostra " + (l.i + 1), m2: l.m2 })) ];
        const max = Math.max(...linhas.map(l => l.m2 || 0)) || 1;
        return linhas.map(l => `<div class="prop-barra"><span>${h(l.n)}</span><div><i class="${l.faixa ? "faixa" : "amostra"}${l.on ? " on" : ""}" style="width:${Math.max(18, l.m2 / max * 100).toFixed(1)}%">
            ${l.total ? `<b>${dinheiro(l.total)}</b>` : ""}<em>${dinheiro(l.m2, 2)}/m²</em></i></div></div>`).join("");
    }

    function resultadoHtml(p, r) {
        const venda = p.finalidade !== "aluguel", rotulo = venda ? "venda" : "locação";
        if (!r.usadas) return `<p class="muted-text">Adicione imóveis com valor e ${BASE_TXT[r.base]} para ver o cálculo.</p>`;
        const aj = Number(p.ajustes.ajuste) || 0;
        return `<div class="prop-estat">
            <div><small>Imóveis no cálculo</small><strong>${r.usadas} de ${p.amostras.length}</strong></div>
            <div><small>Média R$/m²</small><strong>${dinheiro(r.media, 2)}</strong></div>
            <div><small>Mediana R$/m²</small><strong>${dinheiro(r.mediana, 2)}</strong></div>
            <div><small>Menor – maior</small><strong>${dinheiro(r.min, 0)} – ${dinheiro(r.max, 0)}</strong></div>
            <div><small>Confiança</small><strong>${h(CONF_TXT[r.confianca] || "—")}</strong></div>
          </div>
          ${r.mercado ? `<div class="prop-previa">
            <div class="prop-previa-topo"><strong>Valor sugerido para ${venda ? "a venda" : "a locação"} do imóvel</strong>
              <div><small>${h(NOME_FAIXA[p.ajustes.sugerido] || "Valor de mercado")}</small><b>${dinheiro(r.sugerido)}</b></div></div>
            <p class="prop-conta">${dinheiro(r.m2Partida, 2)}/m² (${p.ajustes.calculo === "mediana" ? "mediana" : "média"})${aj ? ` ${aj > 0 ? "+" : "−"} ${numero(Math.abs(aj), 1)}% de ajuste = ${dinheiro(r.m2, 2)}/m²` : ""} × ${numero(r.areaAlvo)} m² = ${dinheiro(r.mercado)}</p>
            ${barrasHtml(p, r)}
            ${r.usadas < (Number(cfg.min_amostras) || 0) ? `<p class="prop-dica">⚠ A imobiliária pede pelo menos ${cfg.min_amostras} imóveis no cálculo para gerar o PDF.</p>` : ""}
          </div>
          ${r.pedido ? `<p class="prop-leitura ${r.leitura}">${venda ? "Valor pedido" : "Aluguel pedido"}: <b>${dinheiro(r.pedido)}</b> (${dinheiro(r.pedidoM2, 2)}/m²). ${h(leituraTexto(r))}
            <small>${p.mostrar_pedido ? "O valor pedido vai no PDF." : "Este aviso fica só na tela; o valor pedido não vai no PDF."}</small></p>` : ""}`
            : `<p class="muted-text">Informe a ${BASE_TXT[r.base]} do imóvel avaliado para chegar ao valor de ${rotulo}.</p>`}`;
    }

    function tipoHtml(p) {
        const ex = p.tipo === "exclusividade" && cfg.exclusividade_ligada !== false;
        const u = ctx.usuario() || {};
        const equipe = ehCentral() || (ctx.veTudo && ctx.veTudo()) ? (ctx.equipe() || []).filter(c => c.active !== false) : [];
        const opcoesCorretor = equipe.length ? equipe : [ { id: u.id, display_name: u.display_name } ];
        if (!opcoesCorretor.some(c => c.id === (p.corretor_id || u.id))) opcoesCorretor.unshift({ id: p.corretor_id || u.id, display_name: p.corretor || u.display_name });
        return `<section class="panel form-panel prop-bloco">
          <span class="eyebrow">5 · TIPO DE PROPOSTA</span>
          <div class="prop-tipos">
            <button type="button" data-tipo="estudo" class="${ex ? "" : "on"}"><b>📊 Apenas estudo de mercado</b><span>Capa, imóvel, comparados, resumo e valor sugerido</span></button>
            ${cfg.exclusividade_ligada !== false ? `<button type="button" data-tipo="exclusividade" class="${ex ? "on" : ""}"><b>🏅 Com apresentação de exclusividade</b><span>Estudo + seu corretor + plano de divulgação + condições</span></button>` : ""}
          </div>
          <div class="prop-grade">
            <label><span>Corretor da apresentação</span><select id="propCorretorId"${opcoesCorretor.length > 1 ? "" : " disabled"}>
              ${opcoesCorretor.map(c => `<option value="${h(c.id)}"${c.id === (p.corretor_id || u.id) ? " selected" : ""}>${h(c.display_name || "—")}</option>`).join("")}</select></label>
            <label class="prop-check"><input type="checkbox" id="propIncluirCorretor"${p.incluir_corretor ? " checked" : ""} /> Incluir a página "Seu corretor"</label>
            <label class="prop-check"><input type="checkbox" id="propMostrarPedido"${p.mostrar_pedido ? " checked" : ""} /> Mostrar o valor pedido pelo proprietário no PDF</label>
            ${ex ? `<label><span>Prazo da exclusividade (dias)</span><input id="propExPrazo" type="number" min="1" max="730" value="${h(p.exclusividade.prazo_dias)}" /></label>
              <label><span>Comissão da imobiliária (%)</span><input id="propExComissao" type="number" min="0" max="30" step="0.5" value="${h(p.exclusividade.comissao_pct)}" /></label>
              <label class="prop-check"><input type="checkbox" id="propExAutorizacao"${p.exclusividade.autorizacao ? " checked" : ""} /> Incluir a autorização de venda para assinar</label>` : ""}
          </div>
          <p class="prop-dica" id="propPerfilAviso" hidden></p>
        </section>`;
    }

    function ligarEditor(box) {
        const p = atual;
        const campo = (id, chave, conv = v => v) => { const el = $(id); if (el) el.addEventListener("change", () => { p[chave] = conv(el.value); if (chave === "finalidade") trocarFinalidade(); else if (chave !== "titulo") render(); }); };
        campo("propTitulo", "titulo"); campo("propCliente", "cliente"); campo("propCorretor", "corretor"); campo("propObs", "observacoes");
        campo("propValidade", "validade_dias", v => Math.max(1, Number(v) || 30));
        campo("propFinalidade", "finalidade");
        $("propBase").addEventListener("change", e => { p.ajustes.base = e.target.value; render(); });
        $("propCalculo").addEventListener("change", e => { p.ajustes.calculo = e.target.value; atualizarResultado(); });
        [ [ "propFaixa", "faixa" ], [ "propOferta", "oferta" ] ].forEach(([ id, k ]) =>
            $(id).addEventListener("change", e => { p.ajustes[k] = Math.max(0, Number(e.target.value) || 0); render(); }));
        box.querySelectorAll("[data-desl]").forEach(inp => inp.addEventListener("input", () => {
            const k = inp.dataset.desl;
            p.ajustes[k] = Number(inp.value) || 0;
            const v = p.ajustes[k], txt = numero(Math.abs(v), 1).replace("—", "0") + "%";
            box.querySelector(`[data-desl-valor="${k}"]`).textContent = k === "ajuste" ? (v > 0 ? "+" : v < 0 ? "−" : "") + txt : k === "otimista" ? "+" + txt : "−" + txt;
            atualizarResultado();
        }));
        const motivo = $("propAjusteMotivo");
        if (motivo) motivo.addEventListener("input", () => { p.ajustes.ajuste_motivo = motivo.value; });
        box.querySelectorAll("[data-sugerido]").forEach(b => b.addEventListener("click", () => {
            p.ajustes.sugerido = b.dataset.sugerido;
            box.querySelectorAll("[data-sugerido]").forEach(x => x.classList.toggle("on", x === b));
            atualizarResultado();
        }));
        box.querySelectorAll("[data-tipo]").forEach(b => b.addEventListener("click", () => {
            if (p.tipo === b.dataset.tipo) return;
            p.tipo = b.dataset.tipo;
            if (p.tipo === "exclusividade") p.incluir_corretor = true;
            render();
        }));
        const ck = (id, fn) => { const el = $(id); if (el) el.addEventListener("change", () => fn(el)); };
        ck("propIncluirCorretor", el => { p.incluir_corretor = el.checked; avisoPerfil(); });
        ck("propMostrarPedido", el => { p.mostrar_pedido = el.checked; atualizarResultado(); });
        ck("propExAutorizacao", el => { p.exclusividade.autorizacao = el.checked; });
        ck("propExPrazo", el => { p.exclusividade.prazo_dias = Math.max(1, Number(el.value) || 90); });
        ck("propExComissao", el => { p.exclusividade.comissao_pct = Math.max(0, Number(String(el.value).replace(",", ".")) || 0); });
        ck("propCorretorId", el => {
            p.corretor_id = el.value;
            p.corretor = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : p.corretor;
            if ($("propCorretor")) $("propCorretor").value = p.corretor;
            avisoPerfil();
        });
        avisoPerfil();
        $("propVoltar").addEventListener("click", () => { if (mudou() && !confirm("Sair sem salvar as mudanças desta proposta?")) return; atual = null; render(); });
        $("propSalvar").addEventListener("click", () => salvar(true));
        $("propExcluir").addEventListener("click", excluir);
        $("propPdf").addEventListener("click", gerarPdf);
        const ligar = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
        ligar("propAlvoCadastro", () => abrirBusca("alvo"));
        ligar("propTrocarAlvo", () => abrirBusca("alvo"));
        ligar("propAlvoFora", () => abrirFormulario("alvo"));
        ligar("propAddCadastro", () => abrirBusca("amostra"));
        ligar("propAddFora", () => abrirFormulario("novo"));
        ligar("propSugerir", sugerir);
        box.querySelectorAll("[data-alvo-campo]").forEach(inp => inp.addEventListener("change", () => {
            const k = inp.dataset.alvoCampo;
            p.alvo.dados[k] = k === "valor" ? ctx.parseValor(inp.value) : lerArea(inp.value);
            p.alvo.dados.areas_da_descricao = false;
            render();
        }));
        box.querySelectorAll("[data-usar]").forEach(cb => cb.addEventListener("change", () => { p.amostras[+cb.dataset.usar].usar = cb.checked; render(); }));
        box.querySelectorAll("[data-remover]").forEach(b => b.addEventListener("click", () => { p.amostras.splice(+b.dataset.remover, 1); render(); }));
        box.querySelectorAll("[data-editar]").forEach(b => b.addEventListener("click", () => abrirFormulario(b.dataset.editar)));
        box.querySelectorAll("[data-cadastrar]").forEach(b => b.addEventListener("click", () => cadastrarNaCentral(b.dataset.cadastrar)));
    }
    const lerArea = v => { const n = ctx.parseValor(String(v || "").replace(/m²|m2/gi, "")); return n > 0 ? n : null; };
    function atualizarResultado() { const el = $("propResultado"); if (el && atual) el.innerHTML = resultadoHtml(atual, calcular(atual)); }

    // ---------- perfil profissional ("Eu corretor") ----------
    const perfis = new Map();
    async function perfilDe(usuarioId, recarregar) {
        const id = usuarioId || (ctx.usuario() || {}).id;
        if (!recarregar && perfis.has(id)) return perfis.get(id);
        const { data, error } = await ctx.sb.rpc("perfil_profissional", { p_carteira: ctx.carteiraId(), p_usuario: id || null });
        if (error) throw error;
        perfis.set(id, data);
        return data;
    }
    const perfilVazio = d => !d || !d.perfil || !(d.perfil.historia || d.perfil.creci || d.perfil.nome_apresentacao);
    async function avisoPerfil() {
        const el = $("propPerfilAviso");
        if (!el || !atual) return;
        if (!atual.incluir_corretor) { el.hidden = true; return; }
        try {
            const d = await perfilDe(atual.corretor_id);
            const meu = !atual.corretor_id || atual.corretor_id === (ctx.usuario() || {}).id;
            if (!perfilVazio(d)) { el.hidden = true; return; }
            el.hidden = false;
            el.innerHTML = meu ? `👤 Seu perfil profissional ainda está vazio. <button type="button" class="secondary-button" id="propAbrirPerfil">Preencher "Eu corretor"</button>`
                : `👤 ${h(d.nome || "Este corretor")} ainda não preencheu o "Eu corretor". A página sai só com nome e foto.`;
            const b = $("propAbrirPerfil");
            if (b) b.addEventListener("click", () => abrirEuCorretor());
        } catch { el.hidden = true; }
    }

    const DIFERENCIAIS = [ "Fotos profissionais", "Vídeo do imóvel", "Retorno semanal ao proprietário", "Anúncio nos principais portais",
        "Acompanho todas as visitas", "Atendimento aos fins de semana", "Ajuda com financiamento", "Especialista em alto padrão", "Especialista em imóveis rurais" ];
    let perfilAberto = null;
    async function abrirEuCorretor() {
        montarDialogos();
        let d;
        try { d = await perfilDe(null, true); } catch (e) { return ctx.toast(ctx.traduzErro ? ctx.traduzErro(e.message || String(e)) : String(e.message || e)); }
        perfilAberto = d;
        const p = d.perfil || {}, set = (id, v) => { $(id).value = v == null ? "" : v; };
        set("euNome", p.nome_apresentacao || d.apelido || d.nome); set("euCreci", p.creci); set("euDesde", p.desde);
        set("euBairros", p.bairros); set("euEspecialidade", p.especialidade); set("euHistoria", p.historia);
        set("euWhats", p.whatsapp || d.telefone); set("euEmail", p.email || d.email); set("euInstagram", p.instagram);
        const marcados = new Set(p.diferenciais || []);
        const extras = (p.diferenciais || []).filter(x => !DIFERENCIAIS.includes(x));
        $("euDiferenciais").innerHTML = [ ...DIFERENCIAIS, ...extras ].map(x => `<label class="prop-check"><input type="checkbox" value="${h(x)}"${marcados.has(x) ? " checked" : ""} /> ${h(x)}</label>`).join("");
        set("euOutroDif", "");
        $("euNumNegocios").textContent = d.negocios_fechados || 0;
        $("euNumCaptados").textContent = d.imoveis_captados || 0;
        $("euMostrarNegocios").checked = !!p.mostrar_negocios;
        $("euMostrarCaptados").checked = !!p.mostrar_captados;
        $("euMostrarFoto").checked = p.mostrar_foto !== false;
        $("euMostrarContato").checked = p.mostrar_contato !== false;
        $("euCorretorDialog").showModal();
    }
    async function salvarEuCorretor() {
        const v = id => $(id).value.trim();
        const dif = [ ...$("euDiferenciais").querySelectorAll("input:checked") ].map(i => i.value);
        v("euOutroDif").split(/[;\n]/).map(s => s.trim()).filter(Boolean).forEach(s => { if (!dif.includes(s)) dif.push(s.slice(0, 80)); });
        const desde = parseInt(v("euDesde"), 10);
        const dados = { nome_apresentacao: v("euNome").slice(0, 80), creci: v("euCreci").slice(0, 40),
            desde: desde >= 1950 && desde <= new Date().getFullYear() ? desde : null, bairros: v("euBairros").slice(0, 300),
            especialidade: v("euEspecialidade").slice(0, 120), historia: v("euHistoria").slice(0, 1500), diferenciais: dif.slice(0, 15),
            whatsapp: v("euWhats").slice(0, 30), email: v("euEmail").slice(0, 120), instagram: v("euInstagram").replace(/^@/, "").slice(0, 60),
            mostrar_negocios: $("euMostrarNegocios").checked, mostrar_captados: $("euMostrarCaptados").checked,
            mostrar_foto: $("euMostrarFoto").checked, mostrar_contato: $("euMostrarContato").checked };
        const b = $("euSalvar");
        b.disabled = true;
        try {
            const { error } = await ctx.sb.rpc("perfil_profissional_salvar", { p_carteira: ctx.carteiraId(), p_dados: dados });
            if (error) throw error;
            perfis.delete((ctx.usuario() || {}).id);
            $("euCorretorDialog").close();
            ctx.toast("Perfil profissional salvo.");
            avisoPerfil();
        } catch (e) { ctx.toast(ctx.traduzErro ? ctx.traduzErro(e.message || String(e)) : String(e.message || e)); }
        finally { b.disabled = false; }
    }

    // ---------- configuração da imobiliária (só Central e administrador) ----------
    const CAMPOS_CFG = [ [ "faixa", "n" ], [ "min_corte", "n" ], [ "min_amostras", "n" ], [ "calculo", "s" ], [ "oferta", "n" ], [ "arredondar", "n" ],
        [ "oportunidade", "n" ], [ "competitivo", "n" ], [ "otimista", "n" ], [ "ajuste_max", "n" ], [ "sugerido", "s" ], [ "validade", "n" ],
        [ "corretor_altera", "b" ], [ "mostrar_estatisticas", "b" ], [ "mostrar_pedido_pdf", "b" ], [ "texto_pdf", "s" ],
        [ "exclusividade_ligada", "b" ], [ "ex_prazo", "n" ], [ "ex_comissao", "n" ], [ "ex_autorizacao", "b" ], [ "ex_texto", "s" ], [ "ex_plano", "s" ], [ "ex_compromissos", "s" ] ];
    function preencherConfig(c) {
        CAMPOS_CFG.forEach(([ k, t ]) => { const el = $("cfg_" + k); if (!el) return; if (t === "b") el.checked = !!c[k]; else el.value = c[k] == null ? "" : c[k]; });
    }
    function abrirConfig() {
        montarDialogos();
        preencherConfig(cfg);
        $("propConfigDialog").showModal();
    }
    async function salvarConfig() {
        const nova = {};
        CAMPOS_CFG.forEach(([ k, t ]) => {
            const el = $("cfg_" + k); if (!el) return;
            nova[k] = t === "b" ? el.checked : t === "n" ? Math.max(0, Number(String(el.value).replace(",", ".")) || 0) : String(el.value).slice(0, 4000);
        });
        nova.min_corte = Math.max(2, nova.min_corte || 3);
        const b = $("cfgSalvar");
        b.disabled = true;
        try {
            const { data, error } = await ctx.sb.rpc("configurar_proposta", { p_carteira: ctx.carteiraId(), p_config: nova });
            if (error) throw error;
            cfg = { ...CFG_PADRAO, ...(data || nova) };
            $("propConfigDialog").close();
            ctx.toast("Configuração salva. Vale para as propostas novas.");
            render();
        } catch (e) { ctx.toast(ctx.traduzErro ? ctx.traduzErro(e.message || String(e)) : String(e.message || e)); }
        finally { b.disabled = false; }
    }
    function dialogosNovos() {
        const n = (id, rot, extra = "") => `<label><span>${rot}</span><input id="cfg_${id}" type="number" ${extra} /></label>`;
        const ck = (id, rot) => `<label class="prop-check prop-largo"><input type="checkbox" id="cfg_${id}" /> ${rot}</label>`;
        return `
        <dialog id="propConfigDialog" class="crm-dialog crm-dialog-larga">
          <form method="dialog" class="dialog-card">
            <button class="dialog-close" type="submit" value="cancel">×</button>
            <span class="eyebrow">PROPOSTA DE NEGÓCIOS</span>
            <h2>Configuração da proposta</h2>
            <p class="muted-text">Vale para todas as propostas novas da imobiliária. O que o corretor muda vale só na proposta dele.</p>
            <h3 class="prop-cfg-sec">Imóveis comparados</h3>
            <div class="prop-grade">
              ${n("faixa", "Deixar de fora quem passa de (% da mediana)", 'min="0" max="200"')}
              ${n("min_corte", "Só deixar de fora a partir de (imóveis)", 'min="2" max="20"')}
              ${n("min_amostras", "Mínimo de imóveis para gerar o PDF", 'min="1" max="20"')}
            </div>
            <h3 class="prop-cfg-sec">Valor de mercado</h3>
            <div class="prop-grade">
              <label><span>Calcular pela</span><select id="cfg_calculo"><option value="media">Média do m²</option><option value="mediana">Mediana do m²</option></select></label>
              ${n("oferta", "Desconto de negociação dos anúncios (%)", 'min="0" max="30" step="0.5"')}
              <label><span>Arredondar o valor para</span><select id="cfg_arredondar"><option value="0">Automático (R$ 1.000)</option><option value="5000">R$ 5.000</option><option value="10000">R$ 10.000</option></select></label>
              ${n("ajuste_max", "Ajuste por diferenciais: até (± %)", 'min="0" max="40"')}
            </div>
            <h3 class="prop-cfg-sec">Faixas de preço</h3>
            <div class="prop-grade">
              ${n("oportunidade", "Oportunidade (% abaixo do mercado)", 'min="0" max="40" step="0.5"')}
              ${n("competitivo", "Competitivo (% abaixo do mercado)", 'min="0" max="30" step="0.5"')}
              ${n("otimista", "Otimista (% acima do mercado)", 'min="0" max="40" step="0.5"')}
              <label><span>Valor sugerido já escolhido</span><select id="cfg_sugerido">${FAIXAS.map(([ k, t ]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
              ${n("validade", "Validade da proposta (dias)", 'min="1" max="365"')}
            </div>
            <h3 class="prop-cfg-sec">Quem pode mexer e o que vai no PDF</h3>
            <div class="prop-grade">
              ${ck("corretor_altera", "Corretor pode mudar os percentuais na proposta dele (o ajuste por diferenciais fica sempre liberado, até o limite acima)")}
              ${ck("mostrar_estatisticas", "Mostrar média, mediana e menor/maior m² no resumo do PDF")}
              ${ck("mostrar_pedido_pdf", "Mostrar o valor pedido pelo proprietário no PDF (a pessoa pode mudar em cada proposta)")}
              <label class="prop-largo"><span>Texto extra no fim do PDF (opcional)</span><textarea id="cfg_texto_pdf" rows="2"></textarea></label>
            </div>
            <h3 class="prop-cfg-sec">Apresentação de exclusividade</h3>
            <div class="prop-grade">
              ${ck("exclusividade_ligada", "Mostrar o botão \"Com apresentação de exclusividade\"")}
              ${n("ex_prazo", "Prazo padrão (dias)", 'min="1" max="730"')}
              ${n("ex_comissao", "Comissão padrão (%)", 'min="0" max="30" step="0.5"')}
              ${ck("ex_autorizacao", "Incluir a autorização de venda para assinar (modelo: revise com o jurídico da imobiliária)")}
              <label class="prop-largo"><span>Por que anunciar com a imobiliária</span><textarea id="cfg_ex_texto" rows="3"></textarea></label>
              <label class="prop-largo"><span>Plano de divulgação (um item por linha)</span><textarea id="cfg_ex_plano" rows="5"></textarea></label>
              <label class="prop-largo"><span>Nossos compromissos (um item por linha)</span><textarea id="cfg_ex_compromissos" rows="4"></textarea></label>
            </div>
            <div class="dialog-actions">
              <button id="cfgPadrao" type="button" class="secondary-button">Voltar ao padrão</button>
              <button id="cfgSalvar" type="button" class="primary-button">Salvar configuração</button>
            </div>
          </form>
        </dialog>
        <dialog id="euCorretorDialog" class="crm-dialog crm-dialog-larga">
          <form method="dialog" class="dialog-card">
            <button class="dialog-close" type="submit" value="cancel">×</button>
            <span class="eyebrow">EU CORRETOR</span>
            <h2>Meu perfil profissional</h2>
            <p class="muted-text">Preenche sozinho a página "Seu corretor" das propostas. Escreva como quer ser apresentado ao proprietário.</p>
            <div class="prop-grade">
              <label><span>Nome de apresentação</span><input id="euNome" maxlength="80" /></label>
              <label><span>CRECI</span><input id="euCreci" maxlength="40" placeholder="Ex.: CRECI-MT 12345-F" /></label>
              <label><span>Atuo no mercado desde (ano)</span><input id="euDesde" type="number" min="1950" max="2100" placeholder="Ex.: 2016" /></label>
              <label><span>Especialidade</span><input id="euEspecialidade" maxlength="120" placeholder="Ex.: casas de médio e alto padrão" /></label>
              <label class="prop-largo"><span>Bairros e regiões em que mais atuo</span><input id="euBairros" maxlength="300" /></label>
              <label class="prop-largo"><span>Minha história (o que quero passar ao cliente)</span><textarea id="euHistoria" rows="4" maxlength="1500"></textarea></label>
            </div>
            <h3 class="prop-cfg-sec">Meus diferenciais</h3>
            <div id="euDiferenciais" class="prop-difs"></div>
            <label class="prop-largo"><span>Outro diferencial (separe por ;)</span><input id="euOutroDif" /></label>
            <h3 class="prop-cfg-sec">Contato e o que aparece</h3>
            <div class="prop-grade">
              <label><span>WhatsApp</span><input id="euWhats" inputmode="tel" /></label>
              <label><span>E-mail</span><input id="euEmail" type="email" /></label>
              <label><span>Instagram</span><input id="euInstagram" placeholder="@seuperfil" /></label>
              <label class="prop-check"><input type="checkbox" id="euMostrarFoto" /> Mostrar minha foto</label>
              <label class="prop-check"><input type="checkbox" id="euMostrarContato" /> Mostrar meu contato</label>
              <label class="prop-check"><input type="checkbox" id="euMostrarNegocios" /> Mostrar negócios fechados (<b id="euNumNegocios">0</b>)</label>
              <label class="prop-check"><input type="checkbox" id="euMostrarCaptados" /> Mostrar imóveis captados (<b id="euNumCaptados">0</b>)</label>
            </div>
            <p class="muted-text">Os números vêm do sistema: negócios ganhos de venda e locação e imóveis captados aprovados nesta imobiliária.</p>
            <div class="dialog-actions"><button id="euSalvar" type="button" class="primary-button">Salvar</button></div>
          </form>
        </dialog>`;
    }
    let fotografia = "";
    const retrato = p => JSON.stringify({ ...p, atualizado_em: "" });
    function mudou() { const salvo = propostas.find(x => x.id === atual.id); return !salvo ? (atual.alvo || atual.amostras.length) : retrato(salvo) !== retrato(atual); }

    // trocar venda ↔ locação: os valores dos imóveis do cadastro são relidos (aluguel ou venda)
    function trocarFinalidade() {
        const mapa = new Map(ctx.imoveis().map(c => [ c.id, c ]));
        const reler = item => {
            if (!item || item.origem !== "cadastro") return;
            const c = mapa.get(item.imovel_id);
            if (c) item.dados.valor = Number(atual.finalidade === "aluguel" ? c.valor_aluguel : c.valor_venda) || null;
        };
        reler(atual.alvo); atual.amostras.forEach(reler);
        render();
    }

    let salvando = false;
    async function salvar(avisar) {
        if (salvando) return false;
        if (!atual.titulo) atual.titulo = atual.alvo ? "Estudo de mercado — " + (atual.alvo.dados.nome || "imóvel") : "Proposta sem título";
        salvando = true;
        const botao = $("propSalvar");
        if (botao) { botao.disabled = true; botao.textContent = "Salvando…"; }
        try {
            // fotos novas dos imóveis de fora vão para o Storage
            const carteira = ctx.carteiraId();
            for (const item of [ atual.alvo, ...atual.amostras ]) {
                if (!item || item.origem !== "fora" || !item.fotos) continue;
                for (let i = 0; i < item.fotos.length; i++) {
                    if (!ehDataUrl(item.fotos[i])) continue;
                    const path = `${carteira}/propostas/${atual.id}/${Date.now()}_${i + 1}.jpg`;
                    const { error } = await ctx.sb.storage.from(BUCKET).upload(path, dataUrlParaArquivo(item.fotos[i], "foto.jpg"), { upsert: false, contentType: "image/jpeg" });
                    if (error) throw error;
                    item.fotos[i] = path;
                }
            }
            const { id, titulo, criado_por, atualizado_em, ...dados } = atual;
            const { data, error } = await ctx.sb.rpc("proposta_salvar", { p_carteira: carteira, p_id: id, p_titulo: titulo, p_dados: JSON.parse(JSON.stringify(dados)) });
            if (error) throw error;
            const anterior = propostas.find(p => p.id === atual.id);
            const sobrando = anterior ? caminhosDe(anterior).filter(f => !caminhosDe(atual).includes(f)) : [];
            if (sobrando.length) ctx.sb.storage.from(BUCKET).remove(sobrando).catch(() => {});
            const salvo = doRegistro(data);
            propostas = [ salvo, ...propostas.filter(p => p.id !== salvo.id) ];
            atual = JSON.parse(JSON.stringify(salvo));
            if (avisar) ctx.toast("Proposta salva.");
            return true;
        } catch (e) {
            ctx.toast(ctx.traduzErro ? ctx.traduzErro(e.message || String(e)) : (e.message || String(e)));
            return false;
        } finally {
            salvando = false;
            render();
        }
    }
    async function excluir() {
        const salvo = propostas.find(p => p.id === atual.id);
        if (!confirm("Excluir esta proposta? Os imóveis do cadastro não mudam.")) return;
        if (salvo) {
            const { error } = await ctx.sb.rpc("proposta_excluir", { p_id: atual.id });
            if (error) return ctx.toast(ctx.traduzErro ? ctx.traduzErro(error.message) : error.message);
            const fotos = caminhosDe(salvo);
            if (fotos.length) ctx.sb.storage.from(BUCKET).remove(fotos).catch(() => {});
            propostas = propostas.filter(p => p.id !== atual.id);
        }
        atual = null;
        render();
        ctx.toast("Proposta excluída.");
    }

    // ---------- fotos ----------
    async function urlFoto(f) { if (ehDataUrl(f)) return f; try { return await ctx.fotoUrl(f); } catch { return ""; } }
    async function urlsDe(item, max = 1) {
        if (item.origem === "fora") return (await Promise.all((item.fotos || []).slice(0, max).map(urlFoto))).filter(Boolean);
        const c = ctx.imoveis().find(x => x.id === item.imovel_id);
        const paths = ((c && c.fotos) || item.fotos_paths || []).slice(0, max).map(f => f.path || f);
        const urls = [];
        for (const path of paths) { try { const u = await ctx.fotoUrl(path); if (u) urls.push(u); } catch {} }
        return urls;
    }
    async function preencherFotos(box) {
        for (const el of box.querySelectorAll("[data-foto]")) {
            const [ papel, idx ] = el.dataset.foto.split(":");
            const item = papel === "alvo" ? atual.alvo : atual.amostras[+idx];
            if (!item) continue;
            const [ url ] = await urlsDe(item, 1);
            if (url) el.style.backgroundImage = `url("${url}")`; else el.classList.add("sem");
        }
    }
    async function comprimir(file, max = 1400, q = 0.8) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
            const e = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * e); c.height = Math.round(img.height * e);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL("image/jpeg", q);
        } finally { URL.revokeObjectURL(url); }
    }
    function dataUrlParaArquivo(dataUrl, nome) {
        const [ cab, b64 ] = dataUrl.split(",");
        const tipo = (cab.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([ bytes ], nome, { type: tipo });
    }

    // ---------- buscar no cadastro ----------
    function montarDialogos() {
        if (!$("propConfigDialog")) {
            document.body.insertAdjacentHTML("beforeend", dialogosNovos());
            $("cfgSalvar").addEventListener("click", salvarConfig);
            $("cfgPadrao").addEventListener("click", () => preencherConfig(CFG_PADRAO));
            $("euSalvar").addEventListener("click", salvarEuCorretor);
        }
        if ($("propBuscaDialog")) return;
        document.body.insertAdjacentHTML("beforeend", `
        <dialog id="propBuscaDialog" class="crm-dialog crm-dialog-larga">
          <form method="dialog" class="dialog-card">
            <button class="dialog-close" type="submit" value="cancel">×</button>
            <span class="eyebrow">PROPOSTA DE NEGÓCIOS</span>
            <h2 id="propBuscaTitulo">Escolher do cadastro</h2>
            <div class="prop-busca-topo">
              <input id="propBuscaTexto" type="search" autocomplete="off" placeholder="Código, nome, rua ou bairro" />
              <select id="propBuscaBairro"><option value="">Todos os bairros</option></select>
              <select id="propBuscaTipo"><option value="">Todos os tipos</option></select>
            </div>
            <div id="propBuscaLista" class="prop-busca-lista"></div>
            <div class="dialog-actions"><span id="propBuscaQtd" class="muted-text"></span>
              <button id="propBuscaAdicionar" type="button" class="primary-button">Adicionar</button></div>
          </form>
        </dialog>
        <dialog id="propImovelDialog" class="crm-dialog crm-dialog-larga">
          <form method="dialog" class="dialog-card" id="propImovelForm">
            <button class="dialog-close" type="submit" value="cancel">×</button>
            <span class="eyebrow" id="propImEyebrow">IMÓVEL DE FORA</span>
            <h2 id="propImTitulo">Imóvel de fora</h2>
            <p id="propImAviso" class="prop-dica"></p>
            <div class="prop-grade">
              <label class="prop-largo"><span>Nome / título do anúncio</span><input id="propImNome" placeholder="Ex.: Casa térrea 3 quartos" /></label>
              <label><span>Tipo</span><select id="propImTipo">${TIPOS.map(t => `<option>${h(t)}</option>`).join("")}</select></label>
              <label><span>Bairro / condomínio</span><input id="propImBairro" /></label>
              <label><span>Cidade</span><input id="propImCidade" /></label>
              <label><span>UF</span><input id="propImUf" maxlength="2" /></label>
              <label class="prop-largo"><span>Rua e número</span><input id="propImRua" /></label>
              <label><span>Área construída (m²)</span><input id="propImAc" inputmode="decimal" /></label>
              <label><span>Área do terreno (m²)</span><input id="propImAt" inputmode="decimal" /></label>
              <label><span>Quartos</span><input id="propImQuartos" type="number" min="0" /></label>
              <label><span>Suítes</span><input id="propImSuites" type="number" min="0" /></label>
              <label><span>Banheiros</span><input id="propImBanheiros" type="number" min="0" /></label>
              <label><span>Vagas</span><input id="propImVagas" type="number" min="0" /></label>
              <label><span id="propImValorRotulo">Valor anunciado</span><input id="propImValor" inputmode="decimal" placeholder="R$" /></label>
              <label><span>Condomínio (mês)</span><input id="propImCond" inputmode="decimal" placeholder="R$" /></label>
              <label><span>Anunciado por</span><input id="propImAnunciante" placeholder="Ex.: Imobiliária X, proprietário, portal" /></label>
              <label><span>Link do anúncio</span><input id="propImLink" type="url" placeholder="https://" /></label>
              <label class="prop-largo"><span>Descrição</span><textarea id="propImDescricao" rows="3"></textarea></label>
            </div>
            <div class="prop-im-fotos">
              <div id="propImFotos" class="prop-im-fotos-lista"></div>
              <label class="secondary-button prop-foto-botao">📷 Adicionar fotos<input id="propImFotosInput" type="file" accept="image/*" multiple hidden /></label>
            </div>
            <p class="muted-text prop-im-nota">Fica só nesta proposta. Para ele entrar no sistema, toque em "Cadastrar na Central".</p>
            <div class="dialog-actions">
              <button id="propImCadastrar" type="button" class="secondary-button">Cadastrar na Central</button>
              <button id="propImSalvar" type="button" class="primary-button">Salvar na proposta</button>
            </div>
          </form>
        </dialog>`);
        $("propBuscaTexto").addEventListener("input", desenharBusca);
        $("propBuscaBairro").addEventListener("change", desenharBusca);
        $("propBuscaTipo").addEventListener("change", desenharBusca);
        $("propBuscaAdicionar").addEventListener("click", adicionarDaBusca);
        $("propImFotosInput").addEventListener("change", async e => {
            const arquivos = [ ...e.target.files ];
            e.target.value = "";
            for (const f of arquivos) { try { fotosForm.push(await comprimir(f)); } catch {} }
            desenharFotosForm();
        });
        $("propImSalvar").addEventListener("click", () => salvarFormulario(false));
        $("propImCadastrar").addEventListener("click", () => salvarFormulario(true));
    }

    let escolhidos = new Set();
    function candidatos() {
        return ctx.imoveis().filter(c => c.aprovacao === "aprovado" || !c.aprovacao)
            .filter(c => atual.finalidade === "aluguel" ? c.para_aluguel !== false : c.para_venda);
    }
    function abrirBusca(modo) {
        buscaModo = modo;
        escolhidos = new Set();
        const lista = candidatos();
        const bairros = [ ...new Set(lista.map(c => c.bairro).filter(Boolean)) ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        const tipos = [ ...new Set(lista.map(c => c.tipo_imovel).filter(Boolean)) ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        $("propBuscaBairro").innerHTML = `<option value="">Todos os bairros</option>` + bairros.map(b => `<option>${h(b)}</option>`).join("");
        $("propBuscaTipo").innerHTML = `<option value="">Todos os tipos</option>` + tipos.map(b => `<option>${h(b)}</option>`).join("");
        // sem trava: abre com todos os bairros e cidades (o "Sugerir do mesmo bairro" é só um atalho)
        $("propBuscaTexto").value = "";
        $("propBuscaTitulo").textContent = modo === "alvo" ? "Imóvel a ser avaliado" : "Imóveis para comparar";
        $("propBuscaAdicionar").textContent = modo === "alvo" ? "Usar este imóvel" : "Adicionar";
        desenharBusca();
        $("propBuscaDialog").showModal();
    }
    function desenharBusca() {
        const t = norm($("propBuscaTexto").value), bairro = $("propBuscaBairro").value, tipo = $("propBuscaTipo").value;
        const ja = new Set(atual.amostras.filter(a => a.imovel_id).map(a => a.imovel_id));
        if (atual.alvo && atual.alvo.imovel_id) ja.add(atual.alvo.imovel_id);
        const lista = candidatos().filter(c => (!bairro || c.bairro === bairro) && (!tipo || c.tipo_imovel === tipo)
            && (!t || norm([ c.codigo, c.nome, c.bairro, c.logradouro, c.edificio ].join(" ")).includes(t)))
            .sort((a, b) => String(a.codigo || "").localeCompare(String(b.codigo || ""))).slice(0, 80);
        const venda = atual.finalidade !== "aluguel";
        $("propBuscaLista").innerHTML = lista.length ? lista.map(c => {
            const usado = ja.has(c.id);
            return `<label class="prop-busca-item${usado ? " usado" : ""}"><input type="${buscaModo === "alvo" ? "radio" : "checkbox"}" name="propBuscaSel" value="${h(c.id)}"${usado ? " disabled" : ""}${escolhidos.has(c.id) ? " checked" : ""} />
              <span class="prop-foto" data-busca-foto="${h(c.id)}"></span>
              <span class="prop-busca-txt"><strong>${c.codigo ? "Cód. " + h(c.codigo) + " · " : ""}${h(c.nome)}</strong>
              <small>${h([ c.tipo_imovel, c.bairro, c.area_m2 ? numero(c.area_m2) + " m²" : "", c.quartos ? c.quartos + " qto" : "" ].filter(Boolean).join(" · "))}</small>
              <small>${dinheiro(venda ? c.valor_venda : c.valor_aluguel)}${c.status && c.status !== "disponivel" ? " · " + h(c.status) : ""}${usado ? " · já está na proposta" : ""}</small></span></label>`;
        }).join("") : `<p class="muted-text">Nenhum imóvel com esse filtro.</p>`;
        $("propBuscaLista").querySelectorAll("input[name=propBuscaSel]").forEach(inp => inp.addEventListener("change", () => {
            if (buscaModo === "alvo") escolhidos = new Set([ inp.value ]); else if (inp.checked) escolhidos.add(inp.value); else escolhidos.delete(inp.value);
            $("propBuscaQtd").textContent = escolhidos.size ? `${escolhidos.size} escolhido${escolhidos.size > 1 ? "s" : ""}` : "";
        }));
        $("propBuscaQtd").textContent = escolhidos.size ? `${escolhidos.size} escolhido${escolhidos.size > 1 ? "s" : ""}` : "";
        if (ctx.fotosCapa) ctx.fotosCapa(lista).then(mapa => mapa.forEach((url, id) => {
            const el = $("propBuscaLista").querySelector(`[data-busca-foto="${CSS.escape(id)}"]`);
            if (el) el.style.backgroundImage = `url("${url}")`;
        })).catch(() => {});
    }
    function itemDoCadastro(c) {
        return { origem: "cadastro", imovel_id: c.id, usar: true, dados: dadosDoCadastro(c, atual.finalidade), fotos_paths: (c.fotos || []).slice(0, 6).map(f => f.path) };
    }
    function adicionarDaBusca() {
        const mapa = new Map(ctx.imoveis().map(c => [ c.id, c ]));
        const lista = [ ...escolhidos ].map(id => mapa.get(id)).filter(Boolean);
        if (!lista.length) return ctx.toast("Escolha pelo menos um imóvel.");
        if (buscaModo === "alvo") {
            atual.alvo = itemDoCadastro(lista[0]);
            if (!atual.titulo) atual.titulo = "Estudo de mercado — " + lista[0].nome;
        } else lista.forEach(c => atual.amostras.push(itemDoCadastro(c)));
        $("propBuscaDialog").close();
        render();
    }

    // sugestão: mesmo bairro e mesmo tipo; se faltar, mesmo tipo em outros bairros; os de área mais parecida primeiro
    function sugerir() {
        const alvo = atual.alvo.dados, base = baseEfetiva(atual), areaAlvo = areaBase(alvo, base);
        const ja = new Set(atual.amostras.map(a => a.imovel_id).filter(Boolean));
        if (atual.alvo.imovel_id) ja.add(atual.alvo.imovel_id);
        const valorDe = c => Number(atual.finalidade === "aluguel" ? c.valor_aluguel : c.valor_venda) || 0;
        const lista = candidatos().filter(c => !ja.has(c.id) && valorDe(c) > 0 && Number(c.area_m2) > 0);
        const perto = c => { const a = areaBase(dadosDoCadastro(c, atual.finalidade), base) || Number(c.area_m2); return areaAlvo ? Math.abs(a / areaAlvo - 1) : 0; };
        const mesmoBairro = lista.filter(c => c.bairro && c.bairro === alvo.bairro && c.tipo_imovel === alvo.tipo_imovel).sort((a, b) => perto(a) - perto(b));
        let escolha = mesmoBairro.slice(0, 6);
        let aviso = "";
        if (escolha.length < 3) {
            const outros = lista.filter(c => c.tipo_imovel === alvo.tipo_imovel && !escolha.includes(c)).sort((a, b) => perto(a) - perto(b));
            const faltam = 4 - escolha.length;
            if (outros.length && faltam > 0) { escolha = escolha.concat(outros.slice(0, faltam)); aviso = " Poucos no mesmo bairro: completei com o mesmo tipo em bairros próximos da lista. Confira."; }
        }
        if (!escolha.length) return ctx.toast("Não achei imóveis parecidos no cadastro. Adicione imóveis de fora.");
        escolha.forEach(c => atual.amostras.push(itemDoCadastro(c)));
        render();
        ctx.toast(`${escolha.length} imóve${escolha.length > 1 ? "is" : "l"} adicionado${escolha.length > 1 ? "s" : ""}.${aviso}`);
    }

    // ---------- imóvel de fora (ou editar os dados de um da proposta) ----------
    let formAlvo = null, fotosForm = [];
    function abrirFormulario(qual) {
        formAlvo = qual;
        const item = qual === "alvo" ? atual.alvo : qual === "novo" ? null : atual.amostras[+qual];
        const d = item ? item.dados : { cidade: "", uf: "" };
        const doCadastro = item && item.origem === "cadastro";
        fotosForm = item && item.origem === "fora" ? [ ...(item.fotos || []) ] : [];
        $("propImEyebrow").textContent = qual === "alvo" ? "IMÓVEL AVALIADO" : "IMÓVEL PARA COMPARAR";
        $("propImTitulo").textContent = doCadastro ? "Ajustar dados nesta proposta" : item ? "Imóvel de fora" : "Novo imóvel de fora";
        $("propImAviso").textContent = doCadastro ? "As mudanças valem só para esta proposta. O cadastro do imóvel não muda." : "";
        $("propImAviso").hidden = !doCadastro;
        const set = (id, v) => { $(id).value = v == null ? "" : v; };
        set("propImNome", d.nome); set("propImBairro", d.bairro); set("propImCidade", d.cidade); set("propImUf", d.uf);
        set("propImRua", [ d.logradouro, d.numero ].filter(Boolean).join(", "));
        if (d.tipo_imovel && ![ ...$("propImTipo").options ].some(o => o.value === d.tipo_imovel)) $("propImTipo").insertAdjacentHTML("beforeend", `<option>${h(d.tipo_imovel)}</option>`);
        $("propImTipo").value = d.tipo_imovel || (atual.alvo ? atual.alvo.dados.tipo_imovel : "Casa") || "Casa";
        set("propImAc", d.area_construida ? numero(d.area_construida) : ""); set("propImAt", d.area_terreno ? numero(d.area_terreno) : "");
        set("propImQuartos", d.quartos); set("propImSuites", d.suites); set("propImBanheiros", d.banheiros); set("propImVagas", d.vagas);
        set("propImValor", d.valor ? dinheiro(d.valor, 2) : ""); set("propImCond", d.valor_condominio ? dinheiro(d.valor_condominio, 2) : "");
        set("propImAnunciante", d.anunciado_por); set("propImLink", d.link); set("propImDescricao", d.descricao);
        $("propImValorRotulo").textContent = atual.finalidade === "aluguel" ? "Aluguel anunciado" : qual === "alvo" ? "Valor pedido" : "Valor anunciado";
        [ "propImNome", "propImTipo", "propImBairro", "propImCidade", "propImUf", "propImRua", "propImQuartos", "propImSuites", "propImBanheiros", "propImVagas", "propImCond", "propImAnunciante", "propImLink", "propImDescricao" ]
            .forEach(id => { $(id).disabled = !!doCadastro; });
        document.querySelector("#propImovelDialog .prop-im-fotos").hidden = !!doCadastro;
        document.querySelector("#propImovelDialog .prop-im-nota").hidden = !!doCadastro;
        $("propImCadastrar").hidden = !!doCadastro || !ctx.novoImovel;
        desenharFotosForm();
        $("propImovelDialog").showModal();
    }
    function desenharFotosForm() {
        $("propImFotos").innerHTML = fotosForm.map((u, i) => `<span class="prop-im-foto" data-form-foto="${i}">${i === 0 ? "<em>Capa</em>" : ""}<button type="button" data-tirar-foto="${i}" aria-label="Tirar foto">×</button></span>`).join("")
            || `<span class="muted-text">Sem fotos.</span>`;
        fotosForm.forEach((f, i) => urlFoto(f).then(u => { const el = $("propImFotos").querySelector(`[data-form-foto="${i}"]`); if (el && u) el.style.backgroundImage = `url("${u}")`; }));
        $("propImFotos").querySelectorAll("[data-tirar-foto]").forEach(b => b.addEventListener("click", () => { fotosForm.splice(+b.dataset.tirarFoto, 1); desenharFotosForm(); }));
    }
    function lerFormulario(base) {
        const v = id => $(id).value.trim(), inteiro = id => v(id) === "" ? null : Math.max(0, parseInt(v(id), 10) || 0);
        const rua = v("propImRua"), virgula = rua.lastIndexOf(",");
        return { ...base, nome: v("propImNome"), tipo_imovel: v("propImTipo"), bairro: v("propImBairro"), cidade: v("propImCidade"), uf: v("propImUf").toUpperCase(),
            logradouro: virgula > 0 ? rua.slice(0, virgula).trim() : rua, numero: virgula > 0 ? rua.slice(virgula + 1).trim() : "",
            area_construida: lerArea(v("propImAc")), area_terreno: lerArea(v("propImAt")), areas_da_descricao: false,
            quartos: inteiro("propImQuartos"), suites: inteiro("propImSuites"), banheiros: inteiro("propImBanheiros"), vagas: inteiro("propImVagas"),
            valor: ctx.parseValor(v("propImValor")) || null, valor_condominio: ctx.parseValor(v("propImCond")) || null,
            anunciado_por: v("propImAnunciante"), link: v("propImLink"), descricao: v("propImDescricao") };
    }
    function salvarFormulario(eCadastrar) {
        const qual = formAlvo;
        const item = qual === "alvo" ? atual.alvo : qual === "novo" ? null : atual.amostras[+qual];
        const doCadastro = item && item.origem === "cadastro";
        const dados = lerFormulario(item ? item.dados : {});
        if (!doCadastro && !dados.nome) dados.nome = [ dados.tipo_imovel, dados.bairro ].filter(Boolean).join(" — ") || "Imóvel de fora";
        let novo;
        if (doCadastro) { item.dados.area_construida = dados.area_construida; item.dados.area_terreno = dados.area_terreno; item.dados.valor = dados.valor; item.dados.areas_da_descricao = false; novo = item; }
        else if (item) { item.dados = dados; item.fotos = [ ...fotosForm ]; novo = item; }
        else { novo = { origem: "fora", usar: true, dados, fotos: [ ...fotosForm ] }; if (qual === "alvo") atual.alvo = novo; else atual.amostras.push(novo); }
        if (qual === "alvo" && !atual.alvo) atual.alvo = novo;
        if (qual === "alvo" && !atual.titulo) atual.titulo = "Estudo de mercado — " + dados.nome;
        $("propImovelDialog").close();
        render();
        if (eCadastrar) cadastrarNaCentral(qual === "novo" ? String(atual.amostras.length - 1) : qual);
    }

    // abre o cadastro normal do imóvel já preenchido; ao salvar, este item passa a ser "do cadastro"
    async function cadastrarNaCentral(qual) {
        const item = qual === "alvo" ? atual.alvo : atual.amostras[+qual];
        if (!item || !ctx.novoImovel) return;
        const d = item.dados;
        const arquivos = [];
        for (const [ i, f ] of (item.fotos || []).entries()) {
            try {
                if (ehDataUrl(f)) arquivos.push(dataUrlParaArquivo(f, `proposta_${i + 1}.jpg`));
                else { const u = await urlFoto(f); const b = await (await fetch(u)).blob(); arquivos.push(new File([ b ], `proposta_${i + 1}.jpg`, { type: b.type || "image/jpeg" })); }
            } catch {}
        }
        pendenteCadastro = { propostaId: atual.id, qual };
        ctx.novoImovel({ ...d, finalidade: atual.finalidade, area: d.area_construida || d.area_terreno }, arquivos);
    }
    function aoSalvarImovel(e) {
        const imovel = e.detail;
        if (!pendenteCadastro || !atual || pendenteCadastro.propostaId !== atual.id || !imovel) return;
        const item = pendenteCadastro.qual === "alvo" ? atual.alvo : atual.amostras[+pendenteCadastro.qual];
        pendenteCadastro = null;
        if (!item || item.origem !== "fora") return;
        item.origem = "cadastro";
        item.imovel_id = imovel.id;
        item.dados.codigo = imovel.codigo || "";
        item.dados.anunciado_por = nomeMarca();
        item.fotos_paths = (imovel.fotos || []).map(f => f.path);
        delete item.fotos;
        salvar(false);
        ctx.toast("Imóvel cadastrado na Central e ligado a esta proposta.");
    }

    // ---------- PDF ----------
    const corVar = (nome, padrao) => (getComputedStyle(document.documentElement).getPropertyValue(nome) || "").trim() || padrao;
    let logoUrl = null;
    function descobrirLogo() {
        if (logoUrl) return Promise.resolve(logoUrl);
        return new Promise(ok => {
            const i = new Image();
            i.onload = () => { logoUrl = "logo-documentos.png"; ok(logoUrl); };
            i.onerror = () => { logoUrl = "logo.png"; ok(logoUrl); };
            i.src = "logo-documentos.png";
        });
    }
    function fichaLinhas(d, venda, r) {
        const area = (v) => v ? numero(v) + " m²" : "—";
        return [
            [ "Tipo", d.tipo_imovel ], [ "Bairro", d.bairro ], [ "Cidade", [ d.cidade, d.uf ].filter(Boolean).join(" / ") ],
            [ "Área construída", area(d.area_construida) ], [ "Área do terreno", area(d.area_terreno) ],
            [ "Quartos / suítes", [ d.quartos, d.suites ].map(x => x == null ? "—" : x).join(" / ") ],
            [ "Banheiros / vagas", [ d.banheiros, d.vagas ].map(x => x == null ? "—" : x).join(" / ") ],
            ...(atual && atual.mostrar_pedido ? [ [ venda ? "Valor pedido" : "Aluguel pedido", d.valor ? dinheiro(d.valor) : "—" ],
                [ "R$/m² pedido", r.pedidoM2 ? dinheiro(r.pedidoM2, 2) : "—" ] ] : [])
        ].map(([ k, v ]) => `<tr><td>${h(k)}</td><td>${h(v || "—")}</td></tr>`).join("");
    }
    function resumoDescricao(t, max = 520) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + "…" : t; }

    async function gerarPdf() {
        const p = atual, r = calcular(p);
        if (!p.alvo) return ctx.toast("Escolha o imóvel avaliado.");
        if (!r.mercado) return ctx.toast("Ainda não dá para calcular: confira as áreas e os valores dos imóveis.");
        if (r.usadas < (Number(cfg.min_amostras) || 0)) return ctx.toast(`A imobiliária pede pelo menos ${cfg.min_amostras} imóveis no cálculo para gerar o PDF.`);
        if (!ctx.imprimir) return ctx.toast("Impressão indisponível.");
        $("propPdf").disabled = true;
        try {
            const html = await montarPdf(p, r);
            ctx.imprimir(html);
        } finally { const b = $("propPdf"); if (b) b.disabled = false; }
    }

    async function montarPdf(p, r) {
        const venda = p.finalidade !== "aluguel";
        const marca = nomeMarca();
        const azul = corVar("--navy", "#003E67"), escuro = corVar("--navy-deep", "#00263F"), destaque = corVar("--gold", "#FF7433");
        const logo = await descobrirLogo();
        const fotosAlvo = await urlsDe(p.alvo, 5);
        const fotosAm = [];
        for (const l of r.linhas) fotosAm.push((await urlsDe(l.a, 1))[0] || "");
        const hoje = new Date();
        const validade = new Date(hoje.getTime() + (Number(p.validade_dias) || 30) * 86400000);
        const a = p.alvo.dados;
        const baseTxt = BASE_TXT[r.base];
        const usadas = r.linhas.filter(l => l.situacao === "ok");
        const foraLista = r.linhas.filter(l => l.situacao !== "ok");
        let pag = 0;
        const cab = titulo => `<div class="pp-cab"><img src="${logo}" alt="" /><span>${h(titulo)}</span></div>`;
        const rod = () => `<div class="pp-rod"><span>${h(marca)} · ${h(p.titulo)}</span><span>Página @@PAG@@ de @@TOT@@</span></div>`;
        const ex = p.tipo === "exclusividade" && cfg.exclusividade_ligada !== false;
        const aj = p.ajustes, ajuste = Number(aj.ajuste) || 0;
        // perfil do corretor da apresentação (página "Seu corretor")
        let corretor = null, fotoCorretor = "";
        if (p.incluir_corretor) {
            try { corretor = await perfilDe(p.corretor_id, true); } catch { corretor = null; }
            if (corretor && corretor.foto_path && (corretor.perfil || {}).mostrar_foto !== false) {
                try { const { data } = await ctx.sb.storage.from("fotos-perfil").createSignedUrl(corretor.foto_path, 3600); fotoCorretor = (data && data.signedUrl) || ""; } catch {}
            }
        }
        const nomeCorretor = (corretor && corretor.perfil && corretor.perfil.nome_apresentacao) || p.corretor || "";
        const linhasDe = t => String(t || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
        const fotoBox = (u, cls) => u ? `<div class="${cls}" style="background-image:url('${u}')"></div>` : `<div class="${cls} pp-semfoto">Sem foto</div>`;
        const local = [ a.bairro, [ a.cidade, a.uf ].filter(Boolean).join("/") ].filter(Boolean).join(" · ");

        const paginasAmostras = [];
        for (let i = 0; i < r.linhas.length; i += 2) {
            paginasAmostras.push(`<section class="pp-pg">${cab("Imóveis comparados")}
              <h2>Imóveis comparados <em>${i + 1}${r.linhas[i + 1] ? "–" + (i + 2) : ""} de ${r.linhas.length}</em></h2>
              ${r.linhas.slice(i, i + 2).map((l, k) => {
                const d = l.a.dados;
                return `<div class="pp-amostra${l.situacao !== "ok" ? " fora" : ""}">
                  ${fotoBox(fotosAm[i + k], "pp-amostra-foto")}
                  <div class="pp-amostra-dados">
                    <span class="pp-num">Amostra ${l.i + 1}${l.situacao !== "ok" ? " · fora do cálculo" : ""}</span>
                    <strong>${h(d.nome || "Imóvel")}</strong>
                    <span class="pp-local">${h([ d.tipo_imovel, d.bairro ].filter(Boolean).join(" · "))}</span>
                    <span class="pp-anun">Anunciado por: ${h(d.anunciado_por || (l.a.origem === "cadastro" ? marca : "—"))}${d.codigo ? " · Cód. " + h(d.codigo) : ""}</span>
                    <div class="pp-faixa-valor"><small>${venda ? "Valor anunciado" : "Aluguel anunciado"}</small><b>${dinheiro(d.valor)}</b></div>
                    <div class="pp-faixa-valor m2"><small>Valor do m² (${baseTxt})</small><b>${l.m2 ? dinheiro(l.m2, 2) : "—"}</b></div>
                    <table class="pp-mini"><tr><th>Área construída</th><th>Área do terreno</th><th>Quartos</th><th>Vagas</th></tr>
                      <tr><td>${numero(d.area_construida)} m²</td><td>${numero(d.area_terreno)} m²</td><td>${d.quartos ?? "—"}</td><td>${d.vagas ?? "—"}</td></tr></table>
                    ${l.situacao !== "ok" ? `<p class="pp-motivo">Não entrou no cálculo: ${h(l.situacao === "longe" ? "valor do m² muito diferente dos demais (" + l.motivo + ")" : l.motivo.toLowerCase())}.</p>` : ""}
                  </div></div>`;
            }).join("")}${rod()}</section>`);
        }

        const css = `<style>
@page{size:A4;margin:0}
.pp-doc{--az:${azul};--esc:${escuro};--dest:${destaque};font-family:'Roboto','Segoe UI',Arial,sans-serif;color:#1f2d36}
.pp-doc *{box-sizing:border-box}
.pp-doc table{min-width:0!important;width:100%;table-layout:auto}
.pp-pg{width:210mm;height:297mm;margin:0 auto 18px;padding:17mm 17mm 22mm;background:#fff;position:relative;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.1);page-break-after:always;break-after:page}
.pp-pg::before{content:"";position:absolute;inset:8mm;border:.8pt solid var(--az);border-radius:3mm;pointer-events:none}
.pp-pg::after{content:"";position:absolute;left:8mm;right:8mm;top:8mm;height:1.6mm;background:var(--dest);border-radius:3mm 3mm 0 0;pointer-events:none}
.pp-pg:last-child{page-break-after:auto;break-after:auto}
.pp-doc,.pp-doc *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pp-cab{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--az);padding-bottom:8px;margin-bottom:18px}
.pp-cab img{height:15mm;max-width:70mm;object-fit:contain}
.pp-cab span{font-size:10pt;letter-spacing:.12em;text-transform:uppercase;color:var(--az);font-weight:700}
.pp-rod{position:absolute;left:17mm;right:17mm;bottom:12mm;display:flex;justify-content:space-between;font-size:8pt;color:#7a8a93;border-top:1px solid #e1e7ea;padding-top:4px}
.pp-doc h2{font-size:19pt;color:var(--esc);margin:0 0 12px;font-weight:800;letter-spacing:-.01em}
.pp-doc h2 em{font-style:normal;color:var(--dest);font-size:12pt;margin-left:8px}
.pp-doc h3{font-size:12pt;color:var(--az);margin:16px 0 6px;text-transform:uppercase;letter-spacing:.06em}
.pp-doc p{font-size:10.5pt;line-height:1.55;margin:0 0 8px;text-align:justify;hyphens:auto}
.pp-capa{padding:17mm 17mm 14mm;display:flex;flex-direction:column}
.pp-capa-foto{height:138mm;background:#dfe6ea center/cover no-repeat;position:relative;border-radius:2.5mm 2.5mm 0 0;overflow:hidden}
.pp-capa-foto::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 50%,rgba(0,0,0,.45))}
.pp-capa-faixa{background:var(--az);color:#fff;padding:10mm 11mm 9mm;flex:1;display:flex;flex-direction:column;gap:3mm;border-radius:0 0 2.5mm 2.5mm}
.pp-capa-faixa small{letter-spacing:.18em;text-transform:uppercase;font-size:9.5pt;color:var(--dest);font-weight:700}
.pp-capa-faixa strong{font-size:25pt;line-height:1.15;font-weight:800}
.pp-capa-faixa span{font-size:12pt;opacity:.92}
.pp-capa-pe{background:#fff;padding:7mm 2mm 0;display:flex;justify-content:space-between;align-items:center;gap:10mm}
.pp-capa-pe img{height:20mm;max-width:85mm;object-fit:contain}
.pp-capa-pe div{display:grid;gap:1.5mm;text-align:right;font-size:10pt;color:#4c5d66}
.pp-capa-pe b{color:var(--esc)}
.pp-galeria{display:grid;grid-template-columns:2fr 1fr;grid-template-rows:42mm 42mm;gap:3mm;margin-bottom:12px}
.pp-galeria .g0{grid-row:1/3}
.pp-galeria.n1{grid-template-columns:1fr}
.pp-galeria.n2 .g1{grid-row:1/3}
.pp-galeria div{background:#e3e9ec center/cover no-repeat;border-radius:2mm}
.pp-ficha{width:100%;border-collapse:collapse;font-size:10.5pt}
.pp-ficha td{padding:5px 6px;border-bottom:1px solid #e3e9ec}
.pp-ficha td:first-child{color:#5b6c75;width:42%}
.pp-ficha td:last-child{font-weight:700;color:var(--esc)}
.pp-duas{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
.pp-amostra{display:grid;grid-template-columns:78mm 1fr;gap:6mm;padding:5mm 0;border-bottom:1px solid #e3e9ec;min-height:108mm}
.pp-amostra.fora{opacity:.6}
.pp-amostra-foto{background:#e3e9ec center/cover no-repeat;border-radius:2mm;height:96mm}
.pp-semfoto{display:flex;align-items:center;justify-content:center;color:#8a99a1;font-size:10pt}
.pp-amostra-dados{display:flex;flex-direction:column;gap:2.4mm}
.pp-num{color:var(--dest);font-weight:800;letter-spacing:.1em;text-transform:uppercase;font-size:10pt}
.pp-amostra-dados strong{font-size:13pt;color:var(--esc);line-height:1.25}
.pp-local,.pp-anun{font-size:9.5pt;color:#5b6c75}
.pp-faixa-valor{background:var(--esc);color:#fff;border-radius:2mm;padding:2.5mm 4mm;display:flex;justify-content:space-between;align-items:baseline}
.pp-faixa-valor.m2{background:var(--az)}
.pp-faixa-valor small{font-size:9pt;opacity:.85}
.pp-faixa-valor b{font-size:13pt}
.pp-mini{width:100%;border-collapse:collapse;font-size:9pt;margin-top:1mm}
.pp-mini th{color:var(--az);font-weight:700;text-align:left;padding:2px 3px}
.pp-mini td{padding:2px 3px}
.pp-motivo{font-size:9pt!important;color:#9a5a1d}
.pp-resumo{width:100%;border-collapse:collapse;font-size:9pt}
.pp-resumo th{background:var(--esc);color:#fff;padding:5px 4px;text-align:left;font-weight:700}
.pp-resumo td{padding:4px;border-bottom:1px solid #e3e9ec;vertical-align:middle}
.pp-resumo td.n,.pp-resumo th.n{text-align:right;white-space:nowrap}
.pp-resumo tr.fora td{color:#9aa7ae;text-decoration:line-through}
.pp-resumo .mini{width:16mm;height:11mm;background:#e3e9ec center/cover no-repeat;border-radius:1mm}
.pp-estat{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:12px 0}
.pp-estat div{border:1px solid #dfe6ea;border-radius:2mm;padding:3mm;display:grid;gap:1mm}
.pp-estat small{font-size:8.5pt;color:#5b6c75}
.pp-estat b{font-size:12pt;color:var(--esc)}
.pp-valores{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:4mm;margin:6mm 0}
.pp-valores div{border-radius:3mm;padding:5mm 4mm;display:grid;gap:1.5mm;text-align:center;border:1.5px solid var(--az)}
.pp-valores .m{background:var(--az);color:#fff;border-color:var(--az);transform:scale(1.04)}
.pp-valores small{font-size:9pt;text-transform:uppercase;letter-spacing:.1em;font-weight:700}
.pp-valores b{font-size:17pt}
.pp-valores span{font-size:9pt;opacity:.85}
.pp-regua{position:relative;height:30mm;margin:10mm 4mm 4mm}
.pp-regua .trilho{position:absolute;left:0;right:0;top:12mm;height:3mm;background:#e3e9ec;border-radius:2mm}
.pp-regua .faixa{position:absolute;top:12mm;height:3mm;background:var(--az);border-radius:2mm;opacity:.85}
.pp-regua .marca{position:absolute;top:0;transform:translateX(-50%);text-align:center;font-size:8pt;color:#4c5d66;white-space:nowrap}
.pp-regua .marca i{display:block;width:2px;height:6mm;background:#4c5d66;margin:1mm auto 0}
.pp-regua .marca.pedido{top:16mm;color:var(--dest);font-weight:800}
.pp-regua .marca.pedido i{background:var(--dest);margin:0 auto 1mm;height:5mm}
.pp-leitura{border-left:4px solid var(--dest);background:#fbf7f2;padding:4mm 5mm;font-size:10.5pt}
.pp-sug-topo{display:flex;justify-content:space-between;align-items:center;gap:8mm;margin:2mm 0 7mm}
.pp-sug-topo h2{max-width:95mm;margin:0;text-transform:uppercase;font-size:17pt;letter-spacing:.02em;line-height:1.25}
.pp-sug-caixa{background:var(--esc);color:#fff;border-radius:3mm;padding:4mm 6mm;display:grid;gap:1mm;text-align:right;min-width:62mm}
.pp-sug-caixa small{font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--dest);font-weight:700}
.pp-sug-caixa b{font-size:20pt}
.pp-sug-caixa span{font-size:9pt;opacity:.85}
.pp-barras{display:grid;gap:2.2mm;margin-bottom:5mm}
.pp-barra{display:grid;grid-template-columns:44mm 1fr;align-items:center;gap:4mm}
.pp-barra>span{font-size:10pt;text-transform:uppercase;letter-spacing:.04em;color:#33454f;text-align:right}
.pp-barra i{display:flex;justify-content:space-between;align-items:center;gap:3mm;background:#2f6aa3;color:#fff;font-style:normal;border-radius:1.5mm;padding:2.3mm 3.5mm;font-size:10pt;white-space:nowrap}
.pp-barra.faixa i{background:#3f8f3a}
.pp-barra.faixa.on i{background:#24661f;box-shadow:0 0 0 1.2pt var(--dest)}
.pp-barra.faixa.on>span{color:var(--esc);font-weight:800}
.pp-barra i b{font-size:10.5pt}
.pp-barra i em{font-style:normal;opacity:.92}
.pp-conta{font-size:9.5pt!important;color:#4c5d66}
.pp-corretor{display:flex;align-items:center;gap:8mm;margin:4mm 0 6mm}
.pp-cor-foto{width:42mm;height:42mm;border-radius:50%;background:#e3e9ec center/cover no-repeat;flex:none;border:1.5mm solid #fff;box-shadow:0 0 0 .8pt var(--az)}
.pp-cor-ini{display:flex;align-items:center;justify-content:center;font-size:26pt;font-weight:800;color:var(--az)}
.pp-corretor small{letter-spacing:.14em;text-transform:uppercase;font-size:9pt;color:var(--dest);font-weight:700}
.pp-corretor h2{margin:1mm 0 1.5mm}
.pp-corretor span{display:block;font-size:10.5pt;color:#4c5d66}
.pp-cor-esp{margin-top:1.5mm;color:var(--az)!important;font-weight:700}
.pp-cor-num{display:grid;grid-template-columns:repeat(auto-fit,minmax(40mm,1fr));gap:4mm;margin:2mm 0 4mm}
.pp-cor-num div{background:var(--az);color:#fff;border-radius:2.5mm;padding:4mm;display:grid;gap:1mm;text-align:center}
.pp-cor-num b{font-size:20pt}
.pp-cor-num small{font-size:9pt;text-transform:uppercase;letter-spacing:.08em}
.pp-cor-contato{display:flex;flex-wrap:wrap;gap:3mm;margin-top:6mm}
.pp-cor-contato span{border:1px solid var(--az);color:var(--esc);border-radius:10mm;padding:1.5mm 4mm;font-size:10pt}
.pp-lista,.pp-plano{margin:0 0 4mm;padding-left:6mm;font-size:10.5pt;line-height:1.6}
.pp-plano li::marker{color:var(--dest);font-weight:800}
.pp-lista li::marker{color:var(--dest)}
.pp-cond{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin:6mm 0}
.pp-cond div{border:1.5px solid var(--az);border-radius:3mm;padding:4mm;display:grid;gap:1.5mm;text-align:center}
.pp-cond div:first-child{background:var(--az);color:#fff}
.pp-cond small{font-size:8.5pt;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.pp-cond b{font-size:16pt}
.pp-cond span{font-size:8.5pt;opacity:.85}
.pp-campos{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:5mm}
.pp-campos td{border:1px solid #cfd9de;padding:2.6mm 3mm;height:9mm}
.pp-campos td:first-child{width:46mm;color:#5b6c75;background:#f4f7f8}
.pp-local-data{margin-top:8mm!important}
.pp-test{margin-top:14mm}
.pp-nota{font-size:9pt!important;color:#5b6c75}
.pp-assin{margin-top:22mm;display:flex;justify-content:space-between;gap:12mm}
.pp-assin div{flex:1;border-top:1px solid #1f2d36;padding-top:2mm;text-align:center;font-size:9.5pt}
@media print{.pp-pg{margin:0;box-shadow:none}}
@media screen and (max-width:860px){.pp-doc{zoom:.45}}
</style>`;

        const capa = `<section class="pp-pg pp-capa">
            <div class="pp-capa-foto" style="${fotosAlvo[0] ? `background-image:url('${fotosAlvo[0]}')` : ""}"></div>
            <div class="pp-capa-faixa"><small>${ex ? "Estudo de mercado · proposta de exclusividade" : venda ? "Estudo de mercado · proposta de valor de venda" : "Estudo de mercado · proposta de valor de locação"}</small>
              <strong>${h(a.nome || p.titulo)}</strong><span>${h(local)}</span>
              ${p.cliente ? `<span>Preparado para: <b>${h(p.cliente)}</b></span>` : ""}</div>
            <div class="pp-capa-pe"><img src="${logo}" alt="${h(marca)}" />
              <div><span>${h(hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }))}</span>
              ${p.corretor ? `<span>Corretor: <b>${h(p.corretor)}</b></span>` : ""}<span>${h(marca)}</span></div></div>
</section>`;

        const imovel = `<section class="pp-pg">${cab("O imóvel")}
            <h2>O imóvel avaliado</h2>
            ${fotosAlvo.length ? `<div class="pp-galeria n${Math.min(3, fotosAlvo.length)}">${fotosAlvo.slice(0, 3).map((u, i) => `<div class="g${i}" style="background-image:url('${u}')"></div>`).join("")}</div>` : ""}
            <div class="pp-duas"><div><h3>Ficha</h3><table class="pp-ficha">${fichaLinhas(a, venda, r)}</table></div>
              <div><h3>Descrição</h3><p>${h(resumoDescricao(a.descricao) || "—")}</p>
              ${p.observacoes ? `<h3>Observações</h3><p>${h(p.observacoes)}</p>` : ""}</div></div>
            ${rod()}</section>`;

        const resumo = `<section class="pp-pg">${cab("Resumo comparativo")}
            <h2>Resumo comparativo</h2>
            <p>Valores de ${venda ? "venda" : "aluguel"} anunciados de imóveis parecidos, comparados pelo valor do m² da ${baseTxt}.</p>
            <table class="pp-resumo"><tr><th></th><th>Nº</th><th>Imóvel</th><th class="n">Constr.</th><th class="n">Terreno</th><th class="n">Qtos</th><th class="n">${venda ? "Valor" : "Aluguel"}</th><th class="n">R$/m²</th></tr>
              ${r.linhas.map((l, k) => { const d = l.a.dados; return `<tr class="${l.situacao !== "ok" ? "fora" : ""}"><td>${fotosAm[k] ? `<div class="mini" style="background-image:url('${fotosAm[k]}')"></div>` : ""}</td>
                <td>${l.i + 1}</td><td>${h((d.codigo ? d.codigo + " · " : "") + (d.bairro || d.nome || ""))}</td><td class="n">${numero(d.area_construida)}</td><td class="n">${numero(d.area_terreno)}</td>
                <td class="n">${d.quartos ?? "—"}</td><td class="n">${dinheiro(d.valor)}</td><td class="n">${l.m2 ? dinheiro(l.m2, 0) : "—"}</td></tr>`; }).join("")}
              <tr><td></td><td></td><td><b>Imóvel avaliado</b></td><td class="n"><b>${numero(a.area_construida)}</b></td><td class="n"><b>${numero(a.area_terreno)}</b></td><td class="n"><b>${a.quartos ?? "—"}</b></td><td class="n"><b>${p.mostrar_pedido ? dinheiro(a.valor) : "—"}</b></td><td class="n"><b>${p.mostrar_pedido && r.pedidoM2 ? dinheiro(r.pedidoM2, 0) : "—"}</b></td></tr>
            </table>
            ${Number(aj.oferta) ? `<p class="pp-nota">O valor do m² de cada imóvel já considera ${numero(aj.oferta, 1)}% de desconto de negociação sobre o valor anunciado.</p>` : ""}
            ${cfg.mostrar_estatisticas !== false ? `<div class="pp-estat"><div><small>Imóveis no cálculo</small><b>${r.usadas} de ${r.linhas.length}</b></div><div><small>Média do m²</small><b>${dinheiro(r.media, 2)}</b></div>
              <div><small>Mediana do m²</small><b>${dinheiro(r.mediana, 2)}</b></div><div><small>Menor – maior m²</small><b>${dinheiro(r.min, 0)} – ${dinheiro(r.max, 0)}</b></div></div>` : ""}
            ${foraLista.length ? `<p class="pp-nota">Riscados: ${foraLista.map(l => "amostra " + (l.i + 1) + " (" + (l.situacao === "longe" ? "m² muito diferente: " + l.motivo : l.motivo.toLowerCase()) + ")").join("; ")}.</p>` : ""}
            ${rod()}</section>`;

        // página final no formato que o mercado conhece (valor sugerido + barras das faixas e das amostras)
        const barras = [ ...FAIXAS.map(([ k, n ]) => ({ n, m2: r.m2Faixa[k], total: r[k], faixa: true, on: aj.sugerido === k })),
            ...usadas.map(l => ({ n: "Amostra " + (l.i + 1), m2: l.m2 })) ];
        const maxBarra = Math.max(...barras.map(b => b.m2 || 0)) || 1;
        const pctTxt = v => numero(Math.abs(Number(v) || 0), 1).replace("—", "0") + "%";
        const valor = `<section class="pp-pg">${cab("Valor sugerido")}
            <div class="pp-sug-topo"><h2>Valor sugerido para ${venda ? "a venda" : "a locação"} do imóvel</h2>
              <div class="pp-sug-caixa"><small>${h(NOME_FAIXA[aj.sugerido] || "Valor de mercado")}</small><b>${dinheiro(r.sugerido)}</b><span>${dinheiro(r.m2Faixa[aj.sugerido] || r.m2, 2)}/m²</span></div></div>
            <div class="pp-barras">${barras.map(b => `<div class="pp-barra${b.faixa ? " faixa" : ""}${b.on ? " on" : ""}"><span>${h(b.n)}</span>
              <div><i style="width:${Math.max(30, b.m2 / maxBarra * 100).toFixed(1)}%">${b.total ? `<b>${dinheiro(b.total)}</b>` : ""}<em>${dinheiro(b.m2, 2)}/m²</em></i></div></div>`).join("")}</div>
            <p class="pp-conta">${numero(r.areaAlvo)} m² de ${baseTxt} × ${dinheiro(r.m2, 2)} por m²${ajuste ? ` (${aj.calculo === "mediana" ? "mediana" : "média"} de ${dinheiro(r.m2Partida, 2)} ${ajuste > 0 ? "+" : "−"} ${pctTxt(ajuste)} de ajuste)` : ` (${aj.calculo === "mediana" ? "mediana" : "média"} de ${r.usadas} imóve${r.usadas > 1 ? "is" : "l"} comparado${r.usadas > 1 ? "s" : ""})`} = ${dinheiro(r.mercado)}.</p>
            ${ajuste && aj.ajuste_motivo ? `<p class="pp-leitura"><b>Ajuste de ${ajuste > 0 ? "+" : "−"}${pctTxt(ajuste)}:</b> ${h(aj.ajuste_motivo)}</p>` : ""}
            ${p.mostrar_pedido && r.pedido ? `<p class="pp-leitura">${h(leituraTexto(r))}</p>` : ""}
            <h3>O que cada valor quer dizer</h3>
            <p><b>Oportunidade (${pctTxt(aj.oportunidade)} abaixo):</b> preço para atrair muitos interessados e fechar rápido.</p>
            <p><b>Competitivo (${pctTxt(aj.competitivo)} abaixo):</b> um pouco abaixo do mercado, para se destacar entre os imóveis parecidos.</p>
            <p><b>Mercado:</b> o que os imóveis parecidos da região pedem por m², aplicado ao seu imóvel. É o ponto de partida da negociação.</p>
            <p><b>Otimista (${pctTxt(aj.otimista)} acima):</b> teto razoável quando o imóvel tem diferenciais (reforma, acabamento, localização, lazer).</p>
            ${rod()}</section>`;

        const metodo = `<section class="pp-pg">${cab("Como chegamos neste valor")}
            <h2>Como chegamos neste valor</h2>
            <p>1. Escolhemos imóveis parecidos com o seu (mesmo tipo e região comparável) anunciados ${venda ? "para venda" : "para locação"}.</p>
            <p>2. Para cada um, dividimos o valor anunciado${Number(aj.oferta) ? ` (com ${pctTxt(aj.oferta)} de desconto de negociação)` : ""} pela ${baseTxt} e chegamos ao valor do m².</p>
            <p>3. Deixamos de fora os imóveis com valor do m² mais de ${aj.faixa}% acima ou abaixo da mediana, para um caso fora do comum não puxar o resultado.</p>
            <p>4. Multiplicamos a ${aj.calculo === "mediana" ? "mediana" : "média"} do m²${ajuste ? `, com ${ajuste > 0 ? "+" : "−"}${pctTxt(ajuste)} de ajuste pelos diferenciais do imóvel,` : ""} pela ${baseTxt} do seu imóvel e chegamos ao valor de mercado. Dele saem o valor de oportunidade (${pctTxt(aj.oportunidade)} abaixo), o competitivo (${pctTxt(aj.competitivo)} abaixo) e o otimista (${pctTxt(aj.otimista)} acima).</p>
            <h3>Grau de confiança</h3>
            <p>${h(CONF_TXT[r.confianca] || "—")}. ${r.usadas} imóve${r.usadas > 1 ? "is" : "l"} no cálculo${r.cv != null ? `, variação de ${numero(r.cv, 1)}% entre eles` : ""}. Quanto mais imóveis parecidos e menor a variação, mais firme é o valor.</p>
            <h3>Importante</h3>
            <p class="pp-nota">Os valores usados são de anúncio (oferta), não de negócios fechados. Este estudo é uma opinião de mercado preparada pelo corretor para orientar a definição do preço; não é laudo de avaliação nos termos da ABNT NBR 14653 nem parecer técnico de avaliação. Proposta válida até ${validade.toLocaleDateString("pt-BR")}.</p>
            ${cfg.texto_pdf ? `<p class="pp-nota">${h(cfg.texto_pdf)}</p>` : ""}
            ${ex ? "" : `<div class="pp-assin"><div>${h(p.corretor || "Corretor responsável")}<br>${h(marca)}</div><div>${h(p.cliente || "Proprietário / cliente")}<br>Ciente</div></div>`}
            ${rod()}</section>`;

        // ---- página "Seu corretor" ----
        let paginaCorretor = "";
        if (p.incluir_corretor) {
            const pf = (corretor && corretor.perfil) || {};
            const nome = pf.nome_apresentacao || p.corretor || (corretor && corretor.nome) || "";
            const anos = pf.desde ? new Date().getFullYear() - Number(pf.desde) : null;
            const numeros = [ anos > 0 ? [ anos === 1 ? "ano de mercado" : "anos de mercado", anos ] : null,
                pf.mostrar_negocios && corretor ? [ "negócios fechados", corretor.negocios_fechados || 0 ] : null,
                pf.mostrar_captados && corretor ? [ "imóveis captados", corretor.imoveis_captados || 0 ] : null ].filter(Boolean);
            const contato = pf.mostrar_contato !== false ? [ pf.whatsapp ? "WhatsApp " + pf.whatsapp : "", pf.email || "", pf.instagram ? "@" + pf.instagram : "" ].filter(Boolean) : [];
            paginaCorretor = `<section class="pp-pg">${cab("Seu corretor")}
              <div class="pp-corretor">
                ${fotoCorretor ? `<div class="pp-cor-foto" style="background-image:url('${fotoCorretor}')"></div>` : `<div class="pp-cor-foto pp-cor-ini">${h(nome.split(/\s+/).map(w => w[0] || "").slice(0, 2).join("").toUpperCase())}</div>`}
                <div><small>Quem vai cuidar do seu imóvel</small><h2>${h(nome)}</h2>
                  <span>${h([ pf.creci, marca ].filter(Boolean).join(" · "))}</span>
                  ${pf.especialidade ? `<span class="pp-cor-esp">${h(pf.especialidade)}</span>` : ""}</div>
              </div>
              ${numeros.length ? `<div class="pp-cor-num">${numeros.map(([ t, v ]) => `<div><b>${h(String(v))}</b><small>${h(t)}</small></div>`).join("")}</div>` : ""}
              ${pf.historia ? `<h3>Minha história</h3><p>${h(pf.historia)}</p>` : ""}
              ${pf.bairros ? `<h3>Onde mais atuo</h3><p>${h(pf.bairros)}</p>` : ""}
              ${(pf.diferenciais || []).length ? `<h3>Como eu trabalho</h3><ul class="pp-lista">${pf.diferenciais.map(d => `<li>${h(d)}</li>`).join("")}</ul>` : ""}
              ${contato.length ? `<div class="pp-cor-contato">${contato.map(c => `<span>${h(c)}</span>`).join("")}</div>` : ""}
              ${rod()}</section>`;
        }

        // ---- apresentação de exclusividade ----
        let paginasEx = "";
        if (ex) {
            const e = p.exclusividade || {}, prazo = Number(e.prazo_dias) || 90, comissao = Number(e.comissao_pct) || 0;
            const plano = linhasDe(cfg.ex_plano), comp = linhasDe(cfg.ex_compromissos);
            const negocio = venda ? "venda" : "locação";
            paginasEx += `<section class="pp-pg">${cab("Por que com a " + marca)}
              <h2>Por que anunciar com a ${h(marca)}</h2>
              ${cfg.ex_texto ? `<p>${h(cfg.ex_texto)}</p>` : ""}
              ${plano.length ? `<h3>Plano de divulgação do seu imóvel</h3><ol class="pp-plano">${plano.map(x => `<li>${h(x)}</li>`).join("")}</ol>` : ""}
              ${comp.length ? `<h3>Nossos compromissos com você</h3><ul class="pp-lista">${comp.map(x => `<li>${h(x)}</li>`).join("")}</ul>` : ""}
              ${rod()}</section>`;
            paginasEx += `<section class="pp-pg">${cab("Proposta de exclusividade")}
              <h2>Proposta de exclusividade</h2>
              <p>Para cuidar da ${negocio} do seu imóvel com toda a nossa estrutura, propomos as condições abaixo.</p>
              <div class="pp-cond">
                <div><small>Valor de anúncio sugerido</small><b>${dinheiro(r.sugerido)}</b><span>${h(NOME_FAIXA[aj.sugerido] || "Valor de mercado")}</span></div>
                <div><small>Prazo da exclusividade</small><b>${prazo} dias</b><span>a partir da assinatura</span></div>
                <div><small>Comissão da imobiliária</small><b>${numero(comissao, 2).replace("—", "0")}%</b><span>sobre o valor da ${negocio}, paga só quando o negócio fechar</span></div>
              </div>
              <h3>Como funciona</h3>
              <p>Durante o prazo, a ${h(marca)} é a única imobiliária responsável por anunciar e negociar o imóvel. Todos os interessados, inclusive os que procurarem o proprietário diretamente, são atendidos por nós, e você recebe o retorno de cada visita e de cada proposta.</p>
              <p>O valor de anúncio pode ser revisto a qualquer momento, em comum acordo, com base no retorno dos interessados.</p>
              <div class="pp-assin"><div>${h(nomeCorretor || "Corretor responsável")}<br>${h(marca)}</div><div>${h(p.cliente || "Proprietário")}<br>De acordo</div></div>
              ${rod()}</section>`;
            if (e.autorizacao) {
                const end = [ a.logradouro, a.numero, a.bairro, [ a.cidade, a.uf ].filter(Boolean).join("/") ].filter(Boolean).join(", ");
                paginasEx += `<section class="pp-pg">${cab("Autorização")}
                  <h2>Autorização de ${negocio} com exclusividade</h2>
                  <table class="pp-campos">
                    <tr><td>Proprietário(a)</td><td>${h(p.cliente || "")}</td></tr><tr><td>CPF/CNPJ</td><td></td></tr>
                    <tr><td>Endereço do proprietário</td><td></td></tr><tr><td>Telefone / e-mail</td><td></td></tr>
                    <tr><td>Imóvel</td><td>${h([ a.tipo_imovel, a.nome ].filter(Boolean).join(" · "))}</td></tr><tr><td>Endereço do imóvel</td><td>${h(end)}</td></tr>
                    <tr><td>Matrícula / cartório</td><td></td></tr>
                  </table>
                  <p>O(A) proprietário(a) acima identificado(a) autoriza a ${h(marca)} a promover, com exclusividade, a ${negocio} do imóvel descrito, pelo valor de anúncio de <b>${dinheiro(r.sugerido)}</b>, pelo prazo de <b>${prazo} dias</b> contados da assinatura deste documento.</p>
                  <p>Pela intermediação, será devida à ${h(marca)} a remuneração de <b>${numero(comissao, 2).replace("—", "0")}%</b> sobre o valor da ${negocio}, paga na conclusão do negócio. Durante o prazo, a remuneração também é devida se o negócio for fechado diretamente pelo(a) proprietário(a) ou por terceiros.</p>
                  <p>O(A) proprietário(a) declara que as informações do imóvel são verdadeiras e se compromete a fornecer a documentação necessária.</p>
                  <p class="pp-local-data">${h(a.cidade || "")}, ____ de ______________ de ________.</p>
                  <div class="pp-assin"><div>Proprietário(a)</div><div>${h(marca)}<br>${h(nomeCorretor)}</div></div>
                  <div class="pp-assin pp-test"><div>Testemunha 1 · CPF</div><div>Testemunha 2 · CPF</div></div>
                  ${rod()}</section>`;
            }
        }

        // páginas na ordem; a numeração do rodapé segue a ordem em que foram montadas
        pag = 1;
        const corpoSem = `${capa}${paginaCorretor}${imovel}${paginasAmostras.join("")}${resumo}${valor}${metodo}${paginasEx}`;
        const total = (corpoSem.match(/class="pp-pg/g) || []).length;
        const corpo = corpoSem.replace(/@@PAG@@/g, () => ++pag).replace(/@@TOT@@/g, total);
        return `${css}<div class="pp-doc" lang="pt-BR">${corpo}</div>`;
    }

    window.SKLPropostas = { iniciar, sair, aoMostrar, calcular, areasDaDescricao, abrirEuCorretor };
})();
