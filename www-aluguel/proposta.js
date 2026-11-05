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
    const PADRAO_AJUSTES = { base: "auto", faixa: 30, rapido: 8, otimista: 10 };

    // ---------- guardar: tabela imobiliaria_propostas (RPC proposta_salvar / proposta_excluir) ----------
    // Fotos dos imóveis de fora: enquanto não salva ficam no aparelho (data:...); ao salvar vão para o Storage
    // em <carteira>/propostas/<proposta>/<arquivo> e no item fica só o caminho.
    const BUCKET = "fotos-construcoes";
    const ehDataUrl = f => typeof f === "string" && f.startsWith("data:");
    const doRegistro = r => ({ ...(r.dados || {}), id: r.id, titulo: r.titulo || (r.dados && r.dados.titulo) || "", criado_por: r.criado_por, atualizado_em: r.atualizado_em });
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
        await carregar();
        atual = null;
        montarDialogos();
        document.addEventListener("skl-imovel-salvo", aoSalvarImovel);
        render();
    }
    function sair() { atual = null; propostas = []; document.removeEventListener("skl-imovel-salvo", aoSalvarImovel); }
    async function aoMostrar() { if (!atual) await carregar(); render(); }

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
    function arredondar(v) { if (!v) return v; const passo = v >= 100000 ? 1000 : v >= 10000 ? 100 : 10; return Math.round(v / passo) * passo; }

    function calcular(p) {
        const base = baseEfetiva(p), aj = p.ajustes;
        const linhas = p.amostras.map((a, i) => {
            const area = areaBase(a.dados, base), valor = Number(a.dados.valor) || 0;
            let situacao = "ok", motivo = "";
            if (!a.usar) { situacao = "fora"; motivo = "Desmarcada"; }
            else if (!valor) { situacao = "fora"; motivo = "Sem valor"; }
            else if (!area) { situacao = "fora"; motivo = base === "terreno" ? "Sem área do terreno" : "Sem área construída"; }
            return { i, a, area, valor, m2: area && valor ? valor / area : null, situacao, motivo };
        });
        const validas = linhas.filter(l => l.situacao === "ok");
        let med = validas.length ? mediana(validas.map(l => l.m2)) : null;
        if (validas.length >= 3 && aj.faixa > 0) {
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
        if (media && areaAlvo) {
            r.mercado = arredondar(media * areaAlvo);
            r.rapido = arredondar(media * areaAlvo * (1 - aj.rapido / 100));
            r.otimista = arredondar(media * areaAlvo * (1 + aj.otimista / 100));
            r.faixaMin = arredondar(r.min * areaAlvo);
            r.faixaMax = arredondar(r.max * areaAlvo);
            if (r.pedido) {
                r.pedidoM2 = r.pedido / areaAlvo;
                r.difPedido = (r.pedido / r.mercado - 1) * 100;
                r.leitura = r.pedido > r.otimista ? "acima" : r.pedido < r.rapido ? "abaixo" : "dentro";
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
        if (r.leitura === "abaixo") return `O valor pedido está ${pct(r.difPedido)} em relação ao valor de mercado, abaixo da faixa de venda rápida. Vale conferir se não há espaço para pedir mais.`;
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
            <button id="propNova" type="button" class="primary-button">+ Nova proposta</button></div>
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
        box.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => { atual = JSON.parse(JSON.stringify(propostas.find(p => p.id === b.dataset.abrir))); render(); }));
    }

    function nova() {
        const u = ctx.usuario() || {};
        atual = { id: novoId(), titulo: "", finalidade: "venda", cliente: "", corretor: u.display_name || "", validade_dias: 30,
            observacoes: "", alvo: null, amostras: [], ajustes: { ...PADRAO_AJUSTES }, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() };
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
          <span class="eyebrow">4 · CÁLCULO</span>
          <div class="prop-grade prop-ajustes">
            <label><span>Comparar pelo valor do m² da</span><select id="propBase">
              <option value="auto"${p.ajustes.base === "auto" ? " selected" : ""}>Automático (${BASE_TXT[base]})</option>
              <option value="construida"${p.ajustes.base === "construida" ? " selected" : ""}>Área construída</option>
              <option value="terreno"${p.ajustes.base === "terreno" ? " selected" : ""}>Área do terreno</option></select></label>
            <label><span>Deixar de fora quem passa de (% da mediana)</span><input id="propFaixa" type="number" min="0" max="200" value="${p.ajustes.faixa}" /></label>
            <label><span>Venda rápida (% abaixo do mercado)</span><input id="propRapido" type="number" min="0" max="50" step="0.5" value="${p.ajustes.rapido}" /></label>
            <label><span>Otimista (% acima do mercado)</span><input id="propOtimista" type="number" min="0" max="50" step="0.5" value="${p.ajustes.otimista}" /></label>
          </div>
          ${resultadoHtml(p, r)}
        </section>`;
        ligarEditor(box);
        preencherFotos(box);
    }

    function resultadoHtml(p, r) {
        const venda = p.finalidade !== "aluguel", rotulo = venda ? "venda" : "locação";
        if (!r.usadas) return `<p class="muted-text">Adicione imóveis com valor e ${BASE_TXT[r.base]} para ver o cálculo.</p>`;
        return `<div class="prop-estat">
            <div><small>Imóveis no cálculo</small><strong>${r.usadas} de ${p.amostras.length}</strong></div>
            <div><small>Média R$/m²</small><strong>${dinheiro(r.media, 2)}</strong></div>
            <div><small>Mediana R$/m²</small><strong>${dinheiro(r.mediana, 2)}</strong></div>
            <div><small>Menor – maior</small><strong>${dinheiro(r.min, 0)} – ${dinheiro(r.max, 0)}</strong></div>
            <div><small>Confiança</small><strong>${h(CONF_TXT[r.confianca] || "—")}</strong></div>
          </div>
          ${r.mercado ? `<div class="prop-valores">
            <div class="rapido"><small>Venda rápida</small><strong>${dinheiro(r.rapido)}</strong><span>${dinheiro(r.rapido / r.areaAlvo, 2)}/m²</span></div>
            <div class="mercado"><small>Valor de mercado</small><strong>${dinheiro(r.mercado)}</strong><span>${dinheiro(r.media, 2)}/m² × ${numero(r.areaAlvo)} m²</span></div>
            <div class="otimista"><small>Otimista</small><strong>${dinheiro(r.otimista)}</strong><span>${dinheiro(r.otimista / r.areaAlvo, 2)}/m²</span></div>
          </div>
          ${r.pedido ? `<p class="prop-leitura ${r.leitura}">${venda ? "Valor pedido" : "Aluguel pedido"}: <b>${dinheiro(r.pedido)}</b> (${dinheiro(r.pedidoM2, 2)}/m²). ${h(leituraTexto(r))}</p>` : ""}`
            : `<p class="muted-text">Informe a ${BASE_TXT[r.base]} do imóvel avaliado para chegar ao valor de ${rotulo}.</p>`}`;
    }

    function ligarEditor(box) {
        const p = atual;
        const campo = (id, chave, conv = v => v) => { const el = $(id); if (el) el.addEventListener("change", () => { p[chave] = conv(el.value); if (chave === "finalidade") trocarFinalidade(); else if (chave !== "titulo") render(); }); };
        campo("propTitulo", "titulo"); campo("propCliente", "cliente"); campo("propCorretor", "corretor"); campo("propObs", "observacoes");
        campo("propValidade", "validade_dias", v => Math.max(1, Number(v) || 30));
        campo("propFinalidade", "finalidade");
        $("propBase").addEventListener("change", e => { p.ajustes.base = e.target.value; render(); });
        [ [ "propFaixa", "faixa" ], [ "propRapido", "rapido" ], [ "propOtimista", "otimista" ] ].forEach(([ id, k ]) =>
            $(id).addEventListener("change", e => { p.ajustes[k] = Math.max(0, Number(e.target.value) || 0); render(); }));
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
            [ venda ? "Valor pedido" : "Aluguel pedido", d.valor ? dinheiro(d.valor) : "—" ],
            [ "R$/m² pedido", r.pedidoM2 ? dinheiro(r.pedidoM2, 2) : "—" ]
        ].filter(([ , v ]) => v && v !== "—" || true).map(([ k, v ]) => `<tr><td>${h(k)}</td><td>${h(v || "—")}</td></tr>`).join("");
    }
    function resumoDescricao(t, max = 520) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + "…" : t; }

    async function gerarPdf() {
        const p = atual, r = calcular(p);
        if (!p.alvo) return ctx.toast("Escolha o imóvel avaliado.");
        if (!r.mercado) return ctx.toast("Ainda não dá para calcular: confira as áreas e os valores dos imóveis.");
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
        const totalPag = 5 + Math.ceil(r.linhas.length / 2);
        let pag = 0;
        const cab = titulo => `<div class="pp-cab"><img src="${logo}" alt="" /><span>${h(titulo)}</span></div>`;
        const rod = () => `<div class="pp-rod"><span>${h(marca)} · ${h(p.titulo)}</span><span>Página @@PAG@@ de ${totalPag}</span></div>`;
        const fotoBox = (u, cls) => u ? `<div class="${cls}" style="background-image:url('${u}')"></div>` : `<div class="${cls} pp-semfoto">Sem foto</div>`;
        const local = [ a.bairro, [ a.cidade, a.uf ].filter(Boolean).join("/") ].filter(Boolean).join(" · ");

        // escala da régua de valores
        const pontos = [ r.rapido, r.mercado, r.otimista, r.faixaMin, r.faixaMax, r.pedido ].filter(Boolean);
        const lo = Math.min(...pontos) * 0.96, hi = Math.max(...pontos) * 1.04;
        const pos = v => ((v - lo) / (hi - lo) * 100).toFixed(1) + "%";

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
.pp-nota{font-size:9pt!important;color:#5b6c75}
.pp-assin{margin-top:22mm;display:flex;justify-content:space-between;gap:12mm}
.pp-assin div{flex:1;border-top:1px solid #1f2d36;padding-top:2mm;text-align:center;font-size:9.5pt}
@media print{.pp-pg{margin:0;box-shadow:none}}
@media screen and (max-width:860px){.pp-doc{zoom:.45}}
</style>`;

        const capa = `<section class="pp-pg pp-capa">
            <div class="pp-capa-foto" style="${fotosAlvo[0] ? `background-image:url('${fotosAlvo[0]}')` : ""}"></div>
            <div class="pp-capa-faixa"><small>${venda ? "Estudo de mercado · proposta de valor de venda" : "Estudo de mercado · proposta de valor de locação"}</small>
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
              <tr><td></td><td></td><td><b>Imóvel avaliado</b></td><td class="n"><b>${numero(a.area_construida)}</b></td><td class="n"><b>${numero(a.area_terreno)}</b></td><td class="n"><b>${a.quartos ?? "—"}</b></td><td class="n"><b>${dinheiro(a.valor)}</b></td><td class="n"><b>${r.pedidoM2 ? dinheiro(r.pedidoM2, 0) : "—"}</b></td></tr>
            </table>
            <div class="pp-estat"><div><small>Imóveis no cálculo</small><b>${r.usadas} de ${r.linhas.length}</b></div><div><small>Média do m²</small><b>${dinheiro(r.media, 2)}</b></div>
              <div><small>Mediana do m²</small><b>${dinheiro(r.mediana, 2)}</b></div><div><small>Menor – maior m²</small><b>${dinheiro(r.min, 0)} – ${dinheiro(r.max, 0)}</b></div></div>
            ${foraLista.length ? `<p class="pp-nota">Riscados: ${foraLista.map(l => "amostra " + (l.i + 1) + " (" + (l.situacao === "longe" ? "m² muito diferente: " + l.motivo : l.motivo.toLowerCase()) + ")").join("; ")}.</p>` : ""}
            ${rod()}</section>`;

        const valor = `<section class="pp-pg">${cab("Valor sugerido")}
            <h2>Valor sugerido para ${venda ? "a venda" : "a locação"}</h2>
            <p>${h(numero(r.areaAlvo))} m² de ${baseTxt} × ${dinheiro(r.media, 2)} por m² (média de ${r.usadas} imóve${r.usadas > 1 ? "is" : "l"} comparado${r.usadas > 1 ? "s" : ""}).</p>
            <div class="pp-valores">
              <div><small>Venda rápida</small><b>${dinheiro(r.rapido)}</b><span>${dinheiro(r.rapido / r.areaAlvo, 2)}/m² · ${p.ajustes.rapido}% abaixo</span></div>
              <div class="m"><small>Valor de mercado</small><b>${dinheiro(r.mercado)}</b><span>${dinheiro(r.media, 2)}/m²</span></div>
              <div><small>Otimista</small><b>${dinheiro(r.otimista)}</b><span>${dinheiro(r.otimista / r.areaAlvo, 2)}/m² · ${p.ajustes.otimista}% acima</span></div>
            </div>
            <div class="pp-regua"><div class="trilho"></div><div class="faixa" style="left:${pos(r.rapido)};width:calc(${pos(r.otimista)} - ${pos(r.rapido)})"></div>
              <div class="marca" style="left:${pos(r.rapido)}">Rápida<i></i></div><div class="marca" style="left:${pos(r.mercado)}">Mercado<i></i></div><div class="marca" style="left:${pos(r.otimista)}">Otimista<i></i></div>
              ${r.pedido ? `<div class="marca pedido" style="left:${pos(r.pedido)}"><i></i>Pedido ${dinheiro(r.pedido)}</div>` : ""}</div>
            ${r.pedido ? `<p class="pp-leitura">${h(leituraTexto(r))}</p>` : ""}
            <h3>O que cada valor quer dizer</h3>
            <p><b>Valor de mercado:</b> o que os imóveis parecidos da região pedem, em média, por m². É o ponto de partida da negociação.</p>
            <p><b>Venda rápida:</b> preço para atrair mais interessados e fechar em menos tempo.</p>
            <p><b>Otimista:</b> teto razoável para anunciar quando o imóvel tem diferenciais (reforma, acabamento, localização na rua, área de lazer).</p>
            <p>Faixa praticada pelos imóveis comparados, aplicada a este imóvel: ${dinheiro(r.faixaMin)} a ${dinheiro(r.faixaMax)}.</p>
            ${rod()}</section>`;

        const metodo = `<section class="pp-pg">${cab("Como chegamos neste valor")}
            <h2>Como chegamos neste valor</h2>
            <p>1. Escolhemos imóveis parecidos com o seu (mesmo tipo e região comparável) anunciados ${venda ? "para venda" : "para locação"}.</p>
            <p>2. Para cada um, dividimos o valor anunciado pela ${baseTxt} e chegamos ao valor do m².</p>
            <p>3. Deixamos de fora os imóveis com valor do m² mais de ${p.ajustes.faixa}% acima ou abaixo da mediana, para um caso fora do comum não puxar a média.</p>
            <p>4. Multiplicamos a média do m² pela ${baseTxt} do seu imóvel. Desse valor de mercado saem a venda rápida (${p.ajustes.rapido}% abaixo) e o otimista (${p.ajustes.otimista}% acima).</p>
            <h3>Grau de confiança</h3>
            <p>${h(CONF_TXT[r.confianca] || "—")}. ${r.usadas} imóve${r.usadas > 1 ? "is" : "l"} no cálculo${r.cv != null ? `, variação de ${numero(r.cv, 1)}% entre eles` : ""}. Quanto mais imóveis parecidos e menor a variação, mais firme é o valor.</p>
            <h3>Importante</h3>
            <p class="pp-nota">Os valores usados são de anúncio (oferta), não de negócios fechados. Este estudo é uma opinião de mercado preparada pelo corretor para orientar a definição do preço; não é laudo de avaliação nos termos da ABNT NBR 14653 nem parecer técnico de avaliação. Proposta válida até ${validade.toLocaleDateString("pt-BR")}.</p>
            <div class="pp-assin"><div>${h(p.corretor || "Corretor responsável")}<br>${h(marca)}</div><div>${h(p.cliente || "Proprietário / cliente")}<br>Ciente</div></div>
            ${rod()}</section>`;

        // páginas na ordem; a numeração do rodapé segue a ordem em que foram montadas acima
        pag = 1;
        const corpo = `${capa}${imovel}${paginasAmostras.join("")}${resumo}${valor}${metodo}`.replace(/@@PAG@@/g, () => ++pag);
        return `${css}<div class="pp-doc" lang="pt-BR">${corpo}</div>`;
    }

    window.SKLPropostas = { iniciar, sair, aoMostrar, calcular, areasDaDescricao };
})();
