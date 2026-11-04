// Módulo "IA de busca de imóveis" da plataforma SKL (log: docs/ia_busca/PLANO_E_PROGRESSO.md).
// O corretor ou a Central cola o pedido (ex.: mensagem de um parceiro) e decide buscar. Nada é puxado automaticamente.
//  - interpretar(texto) transforma o texto em filtros. No MODO SIMULADO isso é feito por regras locais, sem IA e sem custo.
//    Quando o módulo for ligado, a mesma função passa a chamar a Edge Function ia-busca e devolve o MESMO formato de pedido.
//  - cruzar(pedido) compara o pedido com os imóveis da própria carteira (sempre local, custo zero).
//  - Pesquisa no mercado (internet): no modo simulado só mostra exemplos, para testar a tela.
(function () {
    "use strict";
    const MODO = "simulado";
    let ctx = null;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const normal = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const dinheiro = v => v == null ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const areaTexto = m2 => m2 >= 10000 ? `${(m2 / 10000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : `${Math.round(m2).toLocaleString("pt-BR")} m²`;

    // ------------------------------------------------------------------ leitura do texto (simulado)
    // Cada tipo pedido aceita uma família de tipos cadastrados (pedido "casa" serve para sobrado e casa de condomínio).
    const TIPOS = [
        { re: /casas? (de|em) condominio|condominio fechado/, tipo: "Casa de condomínio", aceita: [ "Casa de condomínio" ] },
        { re: /\bcobertura/, tipo: "Cobertura", aceita: [ "Cobertura" ] },
        { re: /\b(apartamentos?|aptos?|ap)\b/, tipo: "Apartamento", aceita: [ "Apartamento", "Cobertura" ] },
        { re: /\b(kitnets?|kitinete|quitinetes?|kit|studio|estudio)\b/, tipo: "Kitnet/Studio", aceita: [ "Kitnet/Studio" ] },
        { re: /\bsobrados?\b/, tipo: "Sobrado", aceita: [ "Sobrado" ] },
        { re: /\bcasas?\b/, tipo: "Casa", aceita: [ "Casa", "Sobrado", "Casa de condomínio" ] },
        { re: /\bsalas? comercia(l|is)|\bsalas?\b/, tipo: "Sala comercial", aceita: [ "Sala comercial" ] },
        { re: /\b(ponto comercial|pontos? comercia|lojas?|ponto)\b/, tipo: "Ponto comercial", aceita: [ "Ponto comercial", "Sala comercial" ] },
        { re: /\b(galpao|galpoes|barracao|barracoes)\b/, tipo: "Galpão", aceita: [ "Galpão" ] },
        { re: /\bterrenos? rura/, tipo: "Terreno rural", aceita: [ "Terreno rural", "Área rural" ], rural: true },
        { re: /\b(terrenos?|lotes?)\b/, tipo: "Terreno", aceita: [ "Terreno" ] },
        { re: /\bfazendas?\b/, tipo: "Fazenda", aceita: [ "Fazenda", "Área rural" ], rural: true },
        { re: /\bharas\b/, tipo: "Haras", aceita: [ "Haras", "Fazenda" ], rural: true },
        { re: /\branchos?\b/, tipo: "Rancho", aceita: [ "Rancho", "Chácara rural", "Chácara/Sítio" ] },
        { re: /\bsitios?\b/, tipo: "Sítio", aceita: [ "Sítio", "Chácara rural", "Chácara/Sítio" ] },
        { re: /\bchacaras?\b/, tipo: "Chácara", aceita: [ "Chácara/Sítio", "Chácara rural", "Sítio" ] },
        { re: /\barea rural\b/, tipo: "Área rural", aceita: [ "Área rural", "Fazenda", "Terreno rural" ], rural: true }
    ];
    const NUMERO_POR_EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
    const EXTRAS = [
        [ "piscina", /\bpiscina/ ], [ "mobiliado", /\b(mobiliad|semimobiliad|com moveis)/ ], [ "aceita pet", /\b(pets?|cachorros?|gatos?|animal|animais)\b/ ],
        [ "área gourmet", /\b(area gourmet|espaco gourmet|churrasqueira)/ ], [ "edícula", /\bedicula/ ], [ "energia solar", /\b(energia solar|placas? solar)/ ],
        [ "represa/rio", /\b(represa|rio|corrego|lago|nascente)\b/ ]
    ];
    function numeroBr(t) {
        // "2.500" → 2500; "1,2" → 1.2; "450.000,00" → 450000
        let s = String(t).trim();
        if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
        else s = s.replace(",", ".");
        return Number(s);
    }
    function lerQuantidade(texto, palavra) {
        const re = new RegExp(`(\\d+|${Object.keys(NUMERO_POR_EXTENSO).join("|")})\\s*(?:ou mais\\s*)?(?:${palavra})`);
        const m = texto.match(re);
        if (!m) return null;
        return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMERO_POR_EXTENSO[m[1]];
    }
    function lerValores(texto) {
        // dinheiro: "R$ 2.500", "até 3 mil", "500k", "1,2 milhão", "entre 300 e 400 mil", "de 2 a 3 mil"
        const MULT = { mil: 1e3, k: 1e3, milhao: 1e6, milhoes: 1e6, mi: 1e6 };
        const NUM = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d+)?)";
        const MUL = "(mil|k|milhao|milhoes|mi)?\\b";
        const valor = (n, mul, mulPadrao) => numeroBr(n) * (MULT[mul || mulPadrao] || 1);
        const faixa = texto.match(new RegExp(`(?:entre|de)\\s*(?:r\\$\\s*)?${NUM}\\s*${MUL}\\s*(?:e|a|ate)\\s*(?:r\\$\\s*)?${NUM}\\s*${MUL}`));
        if (faixa && (faixa[2] || faixa[4] || /r\$/.test(faixa[0]) || numeroBr(faixa[3]) >= 100)) {
            const max = valor(faixa[3], faixa[4]);
            const min = valor(faixa[1], faixa[2], faixa[4]);
            if (!/\b(m2|m²|metros|ha|hectares?|alq)/.test(texto.slice(faixa.index + faixa[0].length, faixa.index + faixa[0].length + 10))) return { valor_min: Math.min(min, max), valor_max: Math.max(min, max) };
        }
        const re = new RegExp(`(ate|maximo|no maximo|teto|orcamento|valor|pagar|a partir de|acima de|minimo|r\\$)?\\s*(?:de\\s*)?(?:r\\$\\s*)?${NUM}\\s*${MUL}(\\s*(?:m2|m²|metros|ha|hectares?|alq\\w*|quartos?|qts?|dorm\\w*|suites?|vagas?|banheiros?|km|anos?|dias?|meses|x\\b))?`, "g");
        const achados = [];
        let m;
        while ((m = re.exec(texto))) {
            if (m[5]) continue; // é área, quantidade ou prazo, não dinheiro
            const n = valor(m[2], m[3]);
            const temDica = !!(m[1] || m[3]);
            if (!temDica || n < 100) continue;
            achados.push({ n, minimo: /a partir de|acima de|minimo/.test(m[1] || "") });
        }
        const out = {};
        achados.forEach(a => { if (a.minimo) out.valor_min = a.n; else if (out.valor_max == null) out.valor_max = a.n; });
        return out;
    }
    function lerArea(texto) {
        const m = texto.match(/(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*(m2|m²|metros quadrados|metros|ha|hectares?|alqueires?|alq)\b/);
        if (!m) return {};
        const n = numeroBr(m[1]);
        if (/^(ha|hectare)/.test(m[2])) return { area_min_m2: n * 10000 };
        if (/^alq/.test(m[2])) return { area_min_m2: n * 48400, aviso: `"${m[0]}": considerei alqueire goiano (4,84 ha). Confirme com o parceiro.` };
        return { area_min_m2: n };
    }
    function interpretarLocal(textoOriginal, imoveis) {
        const bruto = String(textoOriginal || "");
        const telefone = (bruto.match(/\(?\b\d{2}\)?\s?9?\s?\d{4}[-\s]?\d{4}\b/) || [])[0] || null;
        const texto = normal(bruto.replace(telefone || "\u0000", " ")).replace(/\s+/g, " ");
        const pedido = { origem: MODO, finalidade: null, tipos: [], aceita_tipos: [], rural: null, bairros: [], cidade: null, extras: [], avisos: [] };

        const aluga = /\b(alug\w*|locac\w*|locar|loca[cç]ao)\b/.test(texto);
        const compra = /\b(compra\w*|venda|a venda|adquirir|financ\w*|a vista|permuta)\b/.test(texto);
        if (aluga && !compra) pedido.finalidade = "locacao";
        else if (compra && !aluga) pedido.finalidade = "venda";
        else if (aluga && compra) pedido.avisos.push("O texto fala em comprar e em alugar: busquei nos dois.");

        let resto = texto;
        TIPOS.forEach(t => {
            if (!t.re.test(resto)) return;
            resto = resto.replace(new RegExp(t.re.source, "g"), " ");
            pedido.tipos.push(t.tipo);
            t.aceita.forEach(a => { if (!pedido.aceita_tipos.includes(a)) pedido.aceita_tipos.push(a); });
            if (t.rural) pedido.rural = true;
        });
        if (/\b(rural|zona rural|roca)\b/.test(texto)) pedido.rural = true;

        const quartos = lerQuantidade(texto, "quartos?|qts?\\b|q\\b|dorm\\w*");
        const suites = lerQuantidade(texto, "suites?");
        const vagas = lerQuantidade(texto, "vagas?|carros?");
        const banheiros = lerQuantidade(texto, "banheiros?|wc");
        if (quartos != null || suites != null) pedido.quartos_min = Math.max(quartos || 0, suites || 0);
        if (suites != null) pedido.suites_min = suites;
        if (vagas != null) pedido.vagas_min = vagas;
        else if (/\b(garagem|vaga)\b/.test(texto)) pedido.vagas_min = 1;
        if (banheiros != null) pedido.banheiros_min = banheiros;

        Object.assign(pedido, lerValores(texto));
        const area = lerArea(texto);
        if (area.area_min_m2) pedido.area_min_m2 = area.area_min_m2;
        if (area.aviso) pedido.avisos.push(area.aviso);

        // bairros e cidades: só os que existem na carteira (o texto é comparado com a lista, não adivinhado)
        const conhecidos = (lista) => [ ...new Set(lista.filter(Boolean)) ].sort((a, b) => b.length - a.length);
        conhecidos(imoveis.map(i => i.bairro)).forEach(b => {
            const n = normal(b).trim();
            if (n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto) && !pedido.bairros.some(x => normal(x).includes(n))) pedido.bairros.push(b);
        });
        conhecidos(imoveis.map(i => i.cidade)).forEach(c => {
            if (!pedido.cidade && new RegExp(`\\b${normal(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto)) pedido.cidade = c;
        });
        EXTRAS.forEach(([ nome, re ]) => { if (re.test(texto)) pedido.extras.push(nome); });
        if (telefone) pedido.contato = { telefone };
        if (!pedido.tipos.length && pedido.quartos_min == null && pedido.valor_max == null && !pedido.bairros.length && !pedido.area_min_m2)
            pedido.avisos.push("Não reconheci tipo, valor, quartos, área nem bairro neste texto.");
        return pedido;
    }
    async function interpretar(texto) {
        // MODO real (futuro): const { data } = await ctx.sb.functions.invoke("ia-busca", { body: { acao: "interpretar", carteira_id, texto } });
        return interpretarLocal(texto, ctx ? ctx.imoveis() : []);
    }

    // ------------------------------------------------------------------ cruzamento com a carteira (sempre local)
    function valorDoImovel(i, finalidade) {
        const v = finalidade === "venda" ? i.valor_venda : finalidade === "locacao" ? i.valor_aluguel : (i.para_venda ? i.valor_venda : i.valor_aluguel);
        return v == null || v === "" ? null : Number(v);
    }
    function serve(i, finalidade) {
        if ((i.aprovacao || "aprovado") !== "aprovado" || i.status !== "disponivel") return false;
        if (finalidade === "venda") return !!i.para_venda;
        if (finalidade === "locacao") return i.para_aluguel !== false;
        return true;
    }
    function avaliar(pedido, i, finalidade) {
        const c = [];
        const add = (ok, acerto, falta, peso = 1) => c.push({ ok, acerto, falta, peso });
        if (pedido.aceita_tipos.length) {
            const ok = pedido.aceita_tipos.some(t => normal(t) === normal(i.tipo_imovel));
            add(ok, i.tipo_imovel, `é ${i.tipo_imovel || "outro tipo"}`, 2);
        }
        if (pedido.rural && !pedido.aceita_tipos.length) add(!!i.rural, "rural", "não é rural", 2);
        if (pedido.bairros.length) {
            const b = normal(i.bairro);
            const ok = !!b && pedido.bairros.some(x => { const n = normal(x); return b.includes(n) || n.includes(b); });
            add(ok, i.bairro, `fica em ${i.bairro || "bairro não informado"}`);
        }
        if (pedido.cidade) add(normal(i.cidade) === normal(pedido.cidade), i.cidade, `fica em ${i.cidade || "cidade não informada"}`);
        const valor = valorDoImovel(i, finalidade);
        if (pedido.valor_max != null || pedido.valor_min != null) {
            let ok = valor != null, falta = "sem valor informado";
            if (ok && pedido.valor_max != null && valor > pedido.valor_max) {
                ok = false; falta = `${dinheiro(valor - pedido.valor_max)} acima do máximo`;
                if (valor <= pedido.valor_max * 1.1) { c.push({ ok: false, falta: falta + " (até 10%, dá para negociar?)", peso: 1, meio: true }); }
            }
            if (ok && pedido.valor_min != null && valor < pedido.valor_min) { ok = false; falta = "abaixo do valor mínimo"; }
            if (!c.some(x => x.meio)) add(ok, dinheiro(valor), falta, 2);
        }
        const qtd = (campo, min, nome) => { if (min == null) return; const n = Number(i[campo]) || 0; add(n >= min, `${n} ${nome}`, `${n} ${nome}`); };
        qtd("quartos", pedido.quartos_min, "quarto(s)");
        qtd("suites", pedido.suites_min, "suíte(s)");
        qtd("vagas", pedido.vagas_min, "vaga(s)");
        qtd("banheiros", pedido.banheiros_min, "banheiro(s)");
        if (pedido.area_min_m2) {
            const a = Number(i.area_m2) || 0;
            add(a >= pedido.area_min_m2 * 0.85, a ? areaTexto(a) : "", a ? `${areaTexto(a)} (pedido: ${areaTexto(pedido.area_min_m2)})` : "área não informada");
        }
        const descricao = normal([ i.descricao, i.nome, (i.benfeitorias || []).map(b => b && b.nome).join(" ") ].join(" "));
        pedido.extras.forEach(nome => {
            const item = EXTRAS.find(e => e[0] === nome);
            add(item[1].test(descricao), nome, `não cita ${nome}`, 0.5);
        });
        if (!c.length) return null;
        const total = c.reduce((s, x) => s + x.peso, 0);
        const pontos = c.reduce((s, x) => s + (x.ok ? x.peso : x.meio ? x.peso / 2 : 0), 0);
        return { pct: Math.round(pontos * 100 / total), faltas: c.filter(x => !x.ok).map(x => x.falta), valor };
    }
    function cruzar(pedido, imoveis, minimo = 60) {
        const lista = imoveis || (ctx ? ctx.imoveis() : []);
        const fins = pedido.finalidade ? [ pedido.finalidade ] : [ "locacao", "venda" ];
        const res = [];
        lista.forEach(i => {
            let melhor = null;
            fins.forEach(f => {
                if (!serve(i, f)) return;
                const r = avaliar(pedido, i, f);
                if (r && (!melhor || r.pct > melhor.pct)) melhor = { ...r, finalidade: f };
            });
            if (melhor && melhor.pct >= minimo) res.push({ imovel: i, ...melhor });
        });
        return res.sort((a, b) => b.pct - a.pct || (a.valor ?? 0) - (b.valor ?? 0)).slice(0, 15);
    }

    // ------------------------------------------------------------------ pesquisa no mercado (só exemplo no modo simulado)
    function exemplosMercado(pedido) {
        const tipo = pedido.tipos[0] || "Imóvel";
        const base = pedido.valor_max || (pedido.finalidade === "locacao" ? 2500 : 450000);
        return [ 0.92, 0.98, 1.05 ].map((f, k) => ({
            titulo: `${tipo}${pedido.quartos_min ? ` ${pedido.quartos_min} quartos` : ""}${pedido.bairros[0] ? ` — ${pedido.bairros[0]}` : ""}`,
            fonte: `Portal de exemplo ${k + 1}`,
            valor: Math.round(base * f / 10) * 10
        }));
    }

    // ------------------------------------------------------------------ tela
    function chips(p) {
        const c = [];
        if (p.finalidade) c.push(p.finalidade === "venda" ? "Comprar" : "Alugar");
        p.tipos.forEach(t => c.push(t));
        if (p.rural) c.push("Rural");
        if (p.quartos_min != null) c.push(`${p.quartos_min}+ quartos`);
        if (p.suites_min != null) c.push(`${p.suites_min}+ suítes`);
        if (p.vagas_min != null) c.push(`${p.vagas_min}+ vagas`);
        if (p.banheiros_min != null) c.push(`${p.banheiros_min}+ banheiros`);
        if (p.valor_min != null && p.valor_max != null) c.push(`${dinheiro(p.valor_min)} a ${dinheiro(p.valor_max)}`);
        else if (p.valor_max != null) c.push(`até ${dinheiro(p.valor_max)}`);
        else if (p.valor_min != null) c.push(`a partir de ${dinheiro(p.valor_min)}`);
        if (p.area_min_m2) c.push(`${areaTexto(p.area_min_m2)}+`);
        p.bairros.forEach(b => c.push("📍 " + b));
        if (p.cidade) c.push("🏙️ " + p.cidade);
        p.extras.forEach(e => c.push("✓ " + e));
        if (p.contato && p.contato.telefone) c.push("☎ " + p.contato.telefone);
        return c.map(x => `<span class="iab-chip">${h(x)}</span>`).join("");
    }
    function resumo(i) {
        const p = [];
        if (Number(i.area_m2) > 0) p.push(window.SKLRural ? window.SKLRural.areaTexto(i) : areaTexto(Number(i.area_m2)));
        if (Number(i.quartos) > 0) p.push(`${i.quartos} qto${i.quartos == 1 ? "" : "s"}`);
        if (Number(i.suites) > 0) p.push(`${i.suites} suíte${i.suites == 1 ? "" : "s"}`);
        if (Number(i.vagas) > 0) p.push(`${i.vagas} vaga${i.vagas == 1 ? "" : "s"}`);
        return p.join(" · ");
    }
    function textoParaParceiro(lista) {
        const linhas = [ "Tenho estas opções para o seu cliente:", "" ];
        lista.forEach(r => {
            const i = r.imovel;
            linhas.push(`🏠 ${i.nome}${i.codigo ? ` (cód. ${i.codigo})` : ""}`);
            const local = [ i.bairro, i.cidade ].filter(Boolean).join(", ");
            if (local) linhas.push(`📍 ${local}`);
            if (r.valor != null) linhas.push(`💰 ${r.finalidade === "venda" ? "Venda" : "Aluguel"}: ${dinheiro(r.valor)}${r.finalidade === "venda" ? "" : "/mês"}`);
            if (resumo(i)) linhas.push(`📐 ${resumo(i)}`);
            linhas.push("");
        });
        return linhas.join("\n").trim();
    }
    // Pesquisa na internet: só a Central (administrador/central_vendas). Gestor, financeiro e corretor pedem à Central.
    // Futuro: cota direta para alguns corretores, liberada pela Central e travada no servidor.
    function podePesquisarMercado() {
        return !!ctx && [ "administrador", "central_vendas" ].includes(ctx.papel ? ctx.papel() : "");
    }
    function montar(box) {
        if (!box) return;
        box.classList.add("iab");
        box.innerHTML = `
<div class="iab-cabeca">
  <div><span class="eyebrow">BUSCA POR PEDIDO</span><h2>Encontrar imóvel para um pedido</h2>
  <p class="muted-text">Cole a mensagem do parceiro ou descreva o que o cliente procura. A busca só acontece quando você clicar.</p></div>
  ${MODO === "simulado" ? `<span class="iab-selo" title="O texto é lido por regras do próprio app. Nenhuma IA é chamada e não há custo.">MODO SIMULADO · sem IA</span>` : ""}
</div>
<textarea class="iab-texto" rows="4" placeholder="ex.: Bom dia! Cliente procura casa 3 quartos com 2 vagas no Jardim Itália ou Vila Aurora, aluguel até 3 mil. Aceita pet."></textarea>
<div class="iab-acoes">
  <button type="button" class="primary-button" data-iab="buscar">Buscar na carteira</button>
  <button type="button" class="secondary-button" data-iab="limpar">Limpar</button>
</div>
<div class="iab-saida" hidden>
  <div class="iab-entendi"><span class="eyebrow">O QUE ENTENDI</span><div class="iab-chips"></div><ul class="iab-avisos"></ul></div>
  <div class="iab-resultados"></div>
  <div class="iab-mercado"></div>
</div>`;
        const q = sel => box.querySelector(sel);
        let ultimo = null, resultados = [];
        q('[data-iab="limpar"]').addEventListener("click", () => { q(".iab-texto").value = ""; q(".iab-saida").hidden = true; q(".iab-texto").focus(); });
        q('[data-iab="buscar"]').addEventListener("click", async () => {
            const texto = q(".iab-texto").value.trim();
            if (texto.length < 8) { aviso("Escreva ou cole o pedido antes de buscar."); return; }
            ultimo = await interpretar(texto);
            resultados = cruzar(ultimo);
            q(".iab-saida").hidden = false;
            q(".iab-chips").innerHTML = chips(ultimo) || `<span class="muted-text">nada reconhecido</span>`;
            q(".iab-avisos").innerHTML = ultimo.avisos.map(a => `<li>${h(a)}</li>`).join("");
            renderResultados();
            renderMercado();
        });
        function renderResultados() {
            const r = q(".iab-resultados");
            if (!resultados.length) {
                r.innerHTML = `<span class="eyebrow">NA CARTEIRA</span><p class="muted-text">Nenhum imóvel disponível combina com pelo menos 60% do pedido.</p>`;
                return;
            }
            r.innerHTML = `<div class="iab-linha"><span class="eyebrow">NA CARTEIRA · ${resultados.length} OPÇ${resultados.length === 1 ? "ÃO" : "ÕES"}</span>
  <button type="button" class="secondary-button" data-iab="copiar">Copiar lista para o parceiro</button></div>
<div class="iab-lista">${resultados.map(x => {
                const i = x.imovel;
                const cor = x.pct >= 90 ? "alta" : x.pct >= 75 ? "media" : "baixa";
                return `<article class="iab-card">
  <span class="iab-pct iab-pct-${cor}">${x.pct}%</span>
  <div><strong>${h(i.nome)}</strong>${i.codigo ? ` <small>cód. ${h(i.codigo)}</small>` : ""}
  <p>${h([ i.tipo_imovel, i.bairro, i.cidade ].filter(Boolean).join(" · "))}</p>
  <p>${x.valor != null ? `<b>${dinheiro(x.valor)}${x.finalidade === "venda" ? "" : "/mês"}</b> · ` : ""}${h(resumo(i))}</p>
  ${x.faltas.length ? `<p class="iab-faltas">Não bate: ${h(x.faltas.join("; "))}</p>` : `<p class="iab-ok">Bate com tudo o que foi pedido</p>`}</div>
</article>`;
            }).join("")}</div>`;
            q('[data-iab="copiar"]').addEventListener("click", async () => {
                const t = textoParaParceiro(resultados.slice(0, 5));
                try { await navigator.clipboard.writeText(t); aviso("Lista copiada. Cole no WhatsApp."); } catch (e) { window.prompt("Copie o texto:", t); }
            });
        }
        function renderMercado() {
            const m = q(".iab-mercado");
            if (!podePesquisarMercado()) {
                m.innerHTML = `<span class="eyebrow">PESQUISA NO MERCADO</span>
<p class="muted-text">A pesquisa na internet é feita pela Central. Você pode pedir que ela pesquise este pedido.</p>
<button type="button" class="secondary-button" data-iab="pedir">Pedir pesquisa à Central</button>`;
                q('[data-iab="pedir"]').addEventListener("click", () => aviso(MODO === "simulado" ? "Modo simulado: o pedido não é gravado nem enviado." : "Pedido enviado à Central."));
                return;
            }
            m.innerHTML = `<div class="iab-linha"><span class="eyebrow">PESQUISA NO MERCADO</span><small class="muted-text">${MODO === "simulado" ? "cota: simulada" : ""}</small></div>
<p class="muted-text">Procura anúncios parecidos na internet. Usa 1 pesquisa da cota do mês.</p>
<button type="button" class="secondary-button" data-iab="mercado">Pesquisar no mercado</button><div class="iab-mercado-lista"></div>`;
            q('[data-iab="mercado"]').addEventListener("click", () => {
                q(".iab-mercado-lista").innerHTML = `<p class="iab-exemplo">EXEMPLO — no modo simulado nada é pesquisado; estes anúncios são inventados para testar a tela.</p>` +
                    exemplosMercado(ultimo).map(e => `<article class="iab-card iab-card-mercado"><div><strong>${h(e.titulo)}</strong><p>${h(e.fonte)} · <b>${dinheiro(e.valor)}</b></p></div></article>`).join("");
            });
        }
    }
    function aviso(t) { if (ctx && ctx.toast) ctx.toast(t); else window.alert(t); }
    function iniciar(contexto) {
        ctx = contexto;
        const pagina = document.getElementById("iaBuscaPainel");
        if (pagina && !pagina.dataset.montado) { montar(pagina); pagina.dataset.montado = "1"; }
    }

    window.SKLIABusca = { MODO, iniciar, montar, interpretar, interpretarLocal, cruzar };
})();
