// Documentos da administração de aluguéis:
//  - Modelos de documento (Configurações): texto com marcadores {{...}}; vem um modelo SKL de contrato de locação para começar.
//  - Gerar o contrato preenchido (no contrato do Financeiro) → impressão / PDF.
//  - Vistoria de entrada, saída e periódica com ambientes, itens, estado, fotos e leituras → termo impresso (a de saída compara com a entrada).
//  - Anexos (RG, comprovantes, contrato assinado, matrícula...) em cliente, negociação, contrato e imóvel — bucket privado documentos-aluguel.
//  - Informe de rendimentos anual por proprietário (base para o Imposto de Renda), a partir dos repasses do Financeiro.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const TIPOS = { contrato_locacao: "Contrato de locação", contrato_venda: "Contrato de compra e venda", proposta: "Proposta", termo_vistoria: "Termo de vistoria", outro: "Outro" };
    const ESTADOS = { novo: "Novo", bom: "Bom", regular: "Regular", ruim: "Ruim", danificado: "Danificado", nao_tem: "Não tem" };
    const AMBIENTES_PADRAO = [ "Fachada / entrada", "Sala", "Cozinha", "Quarto 1", "Quarto 2", "Banheiro", "Área de serviço", "Garagem" ];
    const ITENS_PADRAO = [ "Piso", "Paredes / pintura", "Teto", "Portas e fechaduras", "Janelas e vidros", "Tomadas e iluminação", "Hidráulica / torneiras" ];
    const GARANTIAS = { nenhuma: "sem garantia", caucao: "caução", fiador: "fiador", seguro_fianca: "seguro-fiança", titulo_capitalizacao: "título de capitalização" };
    const INDICES = { IPCA: "IPCA/IBGE", IGPM: "IGP-M/FGV", INPC: "INPC/IBGE", IVAR: "IVAR/FGV", nenhum: "sem reajuste" };

    let ctx = null, modelos = [], modeloAberto = null;
    let vistoria = null, ambientes = [], contratoDaVistoria = null;
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => v == null || v === "" ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dataBr = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
    const mesAno = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—";
    const hojeIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const podeGerir = () => !!ctx && ctx.podeGerir();
    function cliente(id) {
        const crm = window.SKLCRM && window.SKLCRM.interno;
        return (crm && crm.clientes instanceof Map && crm.clientes.get(id)) || (window.SKLFinanceiro && window.SKLFinanceiro.cliente(id)) || null;
    }
    const imovel = id => ctx.imoveis().find(i => i.id === id) || null;

    // ------------------------------------------------------------------ número por extenso (valores em reais)
    function extenso(valor) {
        const un = [ "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove" ];
        const dz = [ "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa" ];
        const ct = [ "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos" ];
        const ate999 = n => {
            if (n === 0) return "";
            if (n === 100) return "cem";
            const c = Math.floor(n / 100), r = n % 100, partes = [];
            if (c) partes.push(ct[c]);
            if (r) partes.push(r < 20 ? un[r] : dz[Math.floor(r / 10)] + (r % 10 ? " e " + un[r % 10] : ""));
            return partes.join(" e ");
        };
        const inteiro = n => {
            if (n === 0) return "zero";
            const grupos = [ [ 1e9, "bilhão", "bilhões" ], [ 1e6, "milhão", "milhões" ], [ 1e3, "mil", "mil" ] ];
            const partes = [];
            for (const [ base, sing, plur ] of grupos) {
                const q = Math.floor(n / base);
                if (q) { partes.push(base === 1e3 && q === 1 ? "mil" : ate999(q) + " " + (q === 1 ? sing : plur)); n %= base; }
            }
            if (n) partes.push((partes.length && (n < 100 || n % 100 === 0) ? "e " : "") + ate999(n));
            return partes.join(" ").replace(/\s+/g, " ");
        };
        const v = Math.round(Number(valor || 0) * 100);
        const reais = Math.floor(v / 100), cent = v % 100;
        let txt = reais ? inteiro(reais) + (reais === 1 ? " real" : (reais % 1e6 === 0 ? " de reais" : " reais")) : "";
        if (cent) txt += (txt ? " e " : "") + inteiro(cent) + (cent === 1 ? " centavo" : " centavos");
        return txt || "zero real";
    }

    // ------------------------------------------------------------------ modelo SKL de contrato de locação (ponto de partida; a imobiliária revisa com o jurídico)
    const MODELO_CONTRATO = `# CONTRATO DE LOCAÇÃO {{contrato.finalidade_texto}}
Contrato nº {{contrato.numero}}

Pelo presente instrumento particular, de um lado {{locador.nome}}, CPF/CNPJ {{locador.cpf}}, doravante LOCADOR, representado neste ato por {{imobiliaria.nome}}, administradora do imóvel; e de outro lado {{locatario.nome}}, CPF {{locatario.cpf}}, telefone {{locatario.telefone}}, e-mail {{locatario.email}}, doravante LOCATÁRIO, têm justo e contratado o seguinte:

## 1. Do imóvel
O LOCADOR dá em locação ao LOCATÁRIO o imóvel {{imovel.titulo}} (código {{imovel.codigo}}), situado em {{imovel.endereco}}, no estado descrito no termo de vistoria de entrada, que faz parte deste contrato.

## 2. Do prazo
A locação terá prazo de {{contrato.prazo_meses}} meses, com início em {{contrato.inicio}} e término em {{contrato.fim}}. Findo o prazo, se o LOCATÁRIO continuar no imóvel sem oposição do LOCADOR, a locação passa a vigorar por prazo indeterminado, nas mesmas condições (Lei nº 8.245/1991).

## 3. Do aluguel e encargos
O aluguel mensal é de {{contrato.valor}} ({{contrato.valor_extenso}}), com vencimento todo dia {{contrato.dia_vencimento}} do mês seguinte ao vencido, pago na forma indicada pela administradora. {{contrato.itens}}

## 4. Do atraso
O pagamento após o vencimento terá multa de {{contrato.multa}}% sobre o valor devido, mais juros de {{contrato.juros}}% ao mês, proporcionais aos dias de atraso, e correção monetária.

## 5. Do reajuste
O aluguel será reajustado a cada 12 meses pela variação acumulada do índice {{contrato.indice}}, ou por outro que venha a substituí-lo.

## 6. Da garantia
Para garantia das obrigações deste contrato, foi prestada a modalidade: {{contrato.garantia}}. {{contrato.garantia_detalhe}}

## 7. Da conservação e uso
O LOCATÁRIO usará o imóvel somente para fins {{contrato.uso}}, mantendo-o limpo e conservado, e o devolverá no estado em que recebeu, conforme a vistoria de entrada, ressalvado o desgaste natural pelo uso normal. Benfeitorias dependem de autorização por escrito do LOCADOR.

## 8. Da rescisão
A devolução do imóvel antes do fim do prazo sujeita o LOCATÁRIO à multa proporcional ao tempo restante, equivalente a 3 (três) aluguéis, conforme o art. 4º da Lei nº 8.245/1991. A infração de qualquer cláusula permite a rescisão do contrato.

## 9. Das disposições gerais
As partes elegem o foro da comarca de {{cidade}} para resolver qualquer questão deste contrato. E por estarem de acordo, assinam em duas vias, com duas testemunhas.

{{cidade}}, {{hoje_extenso}}.



______________________________________
{{locador.nome}} — LOCADOR (p.p. {{imobiliaria.nome}})


______________________________________
{{locatario.nome}} — LOCATÁRIO


Testemunhas:
1. ______________________________  CPF: _______________
2. ______________________________  CPF: _______________`;

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        modelos = [];
        criarPainelModelos();
        criarDialogs();
        if (!$("docInformeBtn") && $("finAtualizar")) {
            $("finAtualizar").insertAdjacentHTML("afterend", '<button id="docInformeBtn" type="button" class="secondary-button">Informe de rendimentos</button>');
            $("docInformeBtn").addEventListener("click", abrirInforme);
        }
        if ($("docInformeBtn")) $("docInformeBtn").hidden = !ctx.veTudo();
        carregarModelos();
    }
    async function carregarModelos() {
        const { data } = await ctx.sb.from("doc_modelos_aluguel").select("*").eq("carteira_id", ctx.carteiraId()).order("tipo").order("nome");
        modelos = data || [];
        desenharModelos();
    }
    function criarPainelModelos() {
        let p = $("docModelosPanel");
        if (!p) {
            p = document.createElement("div");
            p.id = "docModelosPanel";
            p.className = "panel form-panel ext-painel-largo";
            const ancora = $("crmRoletaPanel");
            if (!ancora) return;
            ancora.parentNode.insertBefore(p, ancora);
        }
        p.hidden = !ctx.veTudo();
    }
    function desenharModelos() {
        const p = $("docModelosPanel");
        if (!p || p.hidden) return;
        p.innerHTML = `<span class="eyebrow">DOCUMENTOS</span><h2>Modelos de documentos</h2>
          <p>O contrato é gerado a partir de um modelo com marcadores ({{locatario.nome}}, {{contrato.valor}}…) que o sistema preenche sozinho. Revise o modelo com o jurídico da imobiliária antes de usar.</p>
          <div class="ext-lista">${modelos.length ? modelos.map(m => `<div class="ext-item"><span><strong>${h(m.nome)}</strong><small>${h(TIPOS[m.tipo] || m.tipo)}${m.padrao ? " · padrão" : ""}</small></span>
            ${podeGerir() ? `<button type="button" class="secondary-button fin-mini" data-mod="${h(m.id)}">Editar</button>` : ""}</div>`).join("")
            : `<p class="muted-text">Nenhum modelo ainda.${podeGerir() ? ` Comece pelo modelo SKL de contrato de locação.` : ""}</p>`}</div>
          ${podeGerir() ? `<div class="ext-int-acoes">${modelos.some(m => m.tipo === "contrato_locacao") ? "" : `<button type="button" class="primary-button" id="docUsarModeloSkl">Usar modelo SKL de contrato de locação</button>`}
            <button type="button" class="secondary-button" id="docNovoModelo">+ Novo modelo</button></div>` : ""}`;
        p.querySelectorAll("[data-mod]").forEach(b => b.addEventListener("click", () => abrirModelo(modelos.find(m => m.id === b.dataset.mod))));
        const usar = $("docUsarModeloSkl");
        if (usar) usar.addEventListener("click", () => abrirModelo(null, { tipo: "contrato_locacao", nome: "Contrato de locação (modelo SKL)", conteudo: MODELO_CONTRATO, padrao: true }));
        const novo = $("docNovoModelo");
        if (novo) novo.addEventListener("click", () => abrirModelo(null, { tipo: "contrato_locacao", nome: "", conteudo: "", padrao: !modelos.length }));
    }

    // ------------------------------------------------------------------ diálogos criados aqui (não poluem o index.html)
    function criarDialogs() {
        if ($("docModeloDialog")) return;
        document.body.insertAdjacentHTML("beforeend", `
<dialog id="docModeloDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">MODELO DE DOCUMENTO</span><h2 id="docModeloTitulo">Modelo</h2>
  <div class="form-row"><label><span>Nome</span><input id="docModeloNome" autocomplete="off" /></label>
    <label><span>Tipo</span><select id="docModeloTipo">${Object.entries(TIPOS).map(([ v, t ]) => `<option value="${v}">${t}</option>`).join("")}</select></label></div>
  <label class="check-inline"><input id="docModeloPadrao" type="checkbox" /> Modelo padrão deste tipo</label>
  <label><span>Texto (linhas que começam com # e ## viram títulos)</span><textarea id="docModeloTexto" rows="18" class="ext-textarea"></textarea></label>
  <details class="ext-marcadores"><summary>Marcadores disponíveis</summary><p class="muted-text">
    {{locador.nome}} {{locador.cpf}} {{locador.telefone}} {{locador.email}} · {{locatario.nome}} {{locatario.cpf}} {{locatario.telefone}} {{locatario.email}} ·
    {{imovel.titulo}} {{imovel.codigo}} {{imovel.tipo}} {{imovel.endereco}} · {{contrato.numero}} {{contrato.valor}} {{contrato.valor_extenso}} {{contrato.dia_vencimento}}
    {{contrato.inicio}} {{contrato.fim}} {{contrato.prazo_meses}} {{contrato.indice}} {{contrato.multa}} {{contrato.juros}} {{contrato.garantia}} {{contrato.garantia_detalhe}}
    {{contrato.caucao}} {{contrato.itens}} {{contrato.taxa_adm}} {{contrato.uso}} {{contrato.finalidade_texto}} · {{imobiliaria.nome}} {{cidade}} {{hoje}} {{hoje_extenso}}</p></details>
  <p id="docModeloMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="docModeloExcluir" type="button" class="danger-button">Excluir</button><button id="docModeloSalvar" type="button" class="primary-button">Salvar modelo</button></div>
</form></dialog>
<dialog id="docVistoriaDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">VISTORIA</span><h2 id="docVisTitulo">Vistoria</h2>
  <p id="docVisInfo" class="muted-text"></p>
  <div class="fin-grade">
    <label><span>Tipo</span><select id="docVisTipo"><option value="entrada">Entrada (antes de entregar as chaves)</option><option value="saida">Saída (devolução)</option><option value="periodica">Periódica</option></select></label>
    <label><span>Data</span><input id="docVisData" type="date" /></label>
    <label><span>Vistoriador</span><input id="docVisResp" autocomplete="off" /></label>
    <label><span>Acompanhado por</span><input id="docVisAcomp" autocomplete="off" placeholder="inquilino / proprietário" /></label>
    <label><span>Leitura água</span><input id="docVisAgua" autocomplete="off" /></label>
    <label><span>Leitura luz</span><input id="docVisLuz" autocomplete="off" /></label>
    <label><span>Leitura gás</span><input id="docVisGas" autocomplete="off" /></label>
    <label><span>Chaves entregues (qtd.)</span><input id="docVisChaves" type="number" min="0" /></label>
  </div>
  <div id="docVisAmbientes" class="ext-ambientes"></div>
  <div class="ext-int-acoes"><button id="docVisAddAmb" type="button" class="secondary-button fin-mini">+ Ambiente</button></div>
  <label><span>Observações gerais</span><textarea id="docVisObs" rows="2"></textarea></label>
  <p id="docVisMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="docVisExcluir" type="button" class="danger-button" hidden>Excluir</button><button id="docVisImprimir" type="button" class="secondary-button" hidden>Imprimir termo</button><button id="docVisSalvar" type="button" class="primary-button">Salvar vistoria</button></div>
</form></dialog>
<dialog id="docInformeDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
  <button class="dialog-close" type="button" data-fechar>×</button>
  <span class="eyebrow">IMPOSTO DE RENDA</span><h2>Informe de rendimentos</h2>
  <p class="muted-text">Aluguéis recebidos no ano (pela data do pagamento), com a taxa de administração e o valor repassado — base para a declaração do proprietário (e para o carnê-leão, quando o inquilino é pessoa física).</p>
  <div class="form-row"><label><span>Ano</span><select id="docInfAno"></select></label><label><span>Proprietário</span><select id="docInfProp"></select></label></div>
  <p id="docInfMsg" class="form-message" hidden></p>
  <div class="dialog-actions"><button id="docInfGerar" type="button" class="primary-button">Gerar informe</button></div>
</form></dialog>`);
        document.querySelectorAll("#docModeloDialog [data-fechar], #docVistoriaDialog [data-fechar], #docInformeDialog [data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
        $("docModeloSalvar").addEventListener("click", salvarModelo);
        $("docModeloExcluir").addEventListener("click", excluirModelo);
        $("docVisAddAmb").addEventListener("click", () => { ambientes.push({ nome: "Novo ambiente", itens: ITENS_PADRAO.slice(0, 3).map(i => ({ item: i, estado: "bom", obs: "" })), fotos: [] }); desenharAmbientes(); });
        $("docVisSalvar").addEventListener("click", salvarVistoria);
        $("docVisImprimir").addEventListener("click", () => imprimirVistoria(vistoria));
        $("docVisExcluir").addEventListener("click", excluirVistoria);
        $("docInfGerar").addEventListener("click", gerarInforme);
    }
    function msg(el, texto) { el.textContent = texto; el.hidden = !texto; }

    function abrirModelo(m, base) {
        const d = m || base;
        modeloAberto = m ? m.id : null;
        $("docModeloTitulo").textContent = m ? "Editar modelo" : "Novo modelo";
        $("docModeloNome").value = d.nome || "";
        $("docModeloTipo").value = d.tipo || "contrato_locacao";
        $("docModeloPadrao").checked = !!d.padrao;
        $("docModeloTexto").value = d.conteudo || "";
        $("docModeloExcluir").hidden = !m;
        msg($("docModeloMsg"), "");
        $("docModeloDialog").showModal();
    }
    async function salvarModelo() {
        const dados = { nome: $("docModeloNome").value.trim(), tipo: $("docModeloTipo").value, padrao: $("docModeloPadrao").checked, conteudo: $("docModeloTexto").value };
        const { error } = await ctx.sb.rpc("doc_salvar_modelo", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: modeloAberto });
        if (error) { msg($("docModeloMsg"), erro(error)); return; }
        $("docModeloDialog").close();
        ctx.toast("Modelo salvo.");
        carregarModelos();
    }
    async function excluirModelo() {
        if (!modeloAberto || !window.confirm("Excluir este modelo?")) return;
        const { error } = await ctx.sb.rpc("doc_excluir_modelo", { p_id: modeloAberto });
        if (error) { msg($("docModeloMsg"), erro(error)); return; }
        $("docModeloDialog").close();
        carregarModelos();
    }

    // ------------------------------------------------------------------ preencher modelo
    function enderecoImovel(i) {
        if (!i) return "—";
        const p = [ [ i.logradouro, i.numero ].filter(Boolean).join(", "), i.complemento, i.bairro, [ i.cidade, i.uf ].filter(Boolean).join("/"), i.cep ? "CEP " + i.cep : "" ].filter(Boolean);
        return p.join(" — ") || i.endereco || "—";
    }
    function valoresContrato(c) {
        const im = imovel(c.construcao_id) || {};
        const loc = cliente(c.proprietario_id) || {}, inq = cliente(c.inquilino_id) || {};
        const comercial = /sala|loja|ponto|comercial|galp|barrac|escrit/i.test(im.tipo_imovel || "");
        const itens = (c.itens_mensais || []).filter(i => i.valor);
        const hoje = new Date();
        return {
            "locador.nome": loc.nome || "____________________", "locador.cpf": loc.cpf || "______________", "locador.telefone": loc.telefone || "", "locador.email": loc.email || "",
            "locatario.nome": inq.nome || "____________________", "locatario.cpf": inq.cpf || "______________", "locatario.telefone": inq.telefone || "", "locatario.email": inq.email || "",
            "imovel.titulo": im.nome || "", "imovel.codigo": im.codigo || "", "imovel.tipo": im.tipo_imovel || "", "imovel.endereco": enderecoImovel(im),
            "contrato.numero": c.numero, "contrato.valor": dinheiro(c.valor_aluguel), "contrato.valor_extenso": extenso(c.valor_aluguel),
            "contrato.dia_vencimento": c.dia_vencimento, "contrato.inicio": dataBr(c.inicio), "contrato.fim": dataBr(c.fim), "contrato.prazo_meses": c.prazo_meses,
            "contrato.indice": INDICES[c.indice_reajuste] || c.indice_reajuste, "contrato.multa": String(c.multa_atraso_pct).replace(".", ","),
            "contrato.juros": String(c.juros_mes_pct).replace(".", ","), "contrato.garantia": GARANTIAS[c.garantia] || c.garantia,
            "contrato.garantia_detalhe": c.garantia_detalhe || "", "contrato.caucao": c.caucao_valor ? dinheiro(c.caucao_valor) : "",
            "contrato.itens": itens.length ? "Junto com o aluguel serão cobrados: " + itens.map(i => `${i.descricao} (${dinheiro(i.valor)})`).join(", ") + "." : "",
            "contrato.taxa_adm": String(c.taxa_adm_pct).replace(".", ","), "contrato.uso": comercial ? "comerciais" : "residenciais",
            "contrato.finalidade_texto": comercial ? "NÃO RESIDENCIAL" : "RESIDENCIAL",
            "imobiliaria.nome": ctx.carteiraNome(), "cidade": im.cidade || "__________",
            "hoje": hoje.toLocaleDateString("pt-BR"), "hoje_extenso": hoje.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })
        };
    }
    function textoParaHtml(texto, valores) {
        const preenchido = String(texto || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (k in valores ? String(valores[k] ?? "") : m));
        return preenchido.split(/\n/).map(l => {
            if (/^##\s/.test(l)) return `<h4>${h(l.replace(/^##\s*/, ""))}</h4>`;
            if (/^#\s/.test(l)) return `<h3>${h(l.replace(/^#\s*/, ""))}</h3>`;
            return l.trim() ? `<p>${h(l)}</p>` : `<div class="ext-espaco"></div>`;
        }).join("");
    }
    function gerarContrato(c) {
        const m = modelos.find(x => x.tipo === "contrato_locacao" && x.padrao) || modelos.find(x => x.tipo === "contrato_locacao");
        const texto = m ? m.conteudo : MODELO_CONTRATO;
        const html = `<div class="fin-doc ext-contrato">${textoParaHtml(texto, valoresContrato(c))}
          ${m ? "" : `<p class="fin-doc-rodape">Gerado com o modelo SKL de referência. Cadastre o modelo da imobiliária em Configurações → Modelos de documentos.</p>`}</div>`;
        window.SKLFinanceiro.imprimir(html);
    }

    // ------------------------------------------------------------------ dentro do contrato (Financeiro)
    function aoAbrirContrato(c) {
        let box = $("docContratoBox");
        if (!box) {
            box = document.createElement("div");
            box.id = "docContratoBox";
            box.className = "ext-contrato-box";
            const ancora = $("finCtHistoricoBox");
            if (!ancora) return;
            ancora.parentNode.insertBefore(box, ancora);
        }
        box.hidden = !c;
        if (!c) { box.innerHTML = ""; return; }
        box.innerHTML = `<div class="ext-int-acoes"><button type="button" class="primary-button" id="docGerarContrato">Gerar contrato (PDF)</button>
            ${podeGerir() ? `<button type="button" class="secondary-button" id="docNovaVistoria">+ Vistoria</button>` : ""}</div>
          <div class="ext-sub"><span class="crm-rotulo">Vistorias</span><div id="docVistoriasLista" class="ext-lista"><p class="muted-text">Carregando…</p></div></div>
          <div class="ext-sub"><span class="crm-rotulo">Documentos do contrato</span><div id="docAnexosContrato"></div></div>`;
        $("docGerarContrato").addEventListener("click", () => gerarContrato(c));
        const nv = $("docNovaVistoria");
        if (nv) nv.addEventListener("click", () => abrirVistoria(null, c, vistoriasDoContrato));
        listarVistorias(c);
        anexos($("docAnexosContrato"), "contrato", c.id, { podeEnviar: podeGerir(), categorias: [ "Contrato assinado", "Documentos do inquilino", "Documentos do fiador", "Comprovante", "Outro" ] });
    }
    async function listarVistorias(c) {
        const { data } = await ctx.sb.from("aluguel_vistorias").select("*").eq("contrato_id", c.id).order("realizada_em");
        const lista = data || [];
        vistoriasDoContrato = lista;
        const box = $("docVistoriasLista");
        if (!box) return;
        box.innerHTML = lista.length ? lista.map(v => `<div class="ext-item"><span><strong>${h({ entrada: "Entrada", saida: "Saída", periodica: "Periódica" }[v.tipo])}</strong>
            <small>${h(dataBr(v.realizada_em))} · ${(v.ambientes || []).length} ambiente(s)${v.responsavel ? " · " + h(v.responsavel) : ""}</small></span>
            <button type="button" class="secondary-button fin-mini" data-vis="${h(v.id)}">Abrir</button></div>`).join("")
            : `<p class="muted-text">Nenhuma vistoria. Faça a de entrada antes de entregar as chaves.</p>`;
        box.querySelectorAll("[data-vis]").forEach(b => b.addEventListener("click", () => abrirVistoria(lista.find(v => v.id === b.dataset.vis), c, lista)));
    }

    // ------------------------------------------------------------------ vistoria
    let vistoriasDoContrato = [];
    function abrirVistoria(v, c, lista) {
        vistoria = v; contratoDaVistoria = c; vistoriasDoContrato = lista || [];
        const im = imovel(c.construcao_id) || {};
        $("docVisTitulo").textContent = v ? "Vistoria de " + ({ entrada: "entrada", saida: "saída", periodica: "rotina" }[v.tipo]) : "Nova vistoria";
        $("docVisInfo").textContent = `Contrato nº ${c.numero} · ${im.nome || ""} · ${enderecoImovel(im)}`;
        const temEntrada = vistoriasDoContrato.some(x => x.tipo === "entrada");
        $("docVisTipo").value = v ? v.tipo : (temEntrada ? "saida" : "entrada");
        $("docVisData").value = v ? v.realizada_em : hojeIso();
        $("docVisResp").value = v ? (v.responsavel || "") : ((ctx.usuario() || {}).display_name || "");
        $("docVisAcomp").value = v ? (v.acompanhante || "") : "";
        const l = (v && v.leituras) || {};
        $("docVisAgua").value = l.agua || ""; $("docVisLuz").value = l.luz || ""; $("docVisGas").value = l.gas || "";
        $("docVisChaves").value = v && v.chaves_entregues != null ? v.chaves_entregues : "";
        $("docVisObs").value = v ? (v.observacoes || "") : "";
        // nova vistoria de saída começa pelos ambientes da entrada (mesmos itens, para comparar)
        const entrada = vistoriasDoContrato.find(x => x.tipo === "entrada");
        ambientes = JSON.parse(JSON.stringify(v ? v.ambientes || []
            : (entrada && $("docVisTipo").value !== "entrada" ? entrada.ambientes.map(a => ({ nome: a.nome, itens: a.itens.map(i => ({ item: i.item, estado: i.estado, obs: "" })), fotos: [] }))
                : AMBIENTES_PADRAO.map(n => ({ nome: n, itens: ITENS_PADRAO.map(i => ({ item: i, estado: "bom", obs: "" })), fotos: [] })))));
        const so = !podeGerir();
        [ "docVisTipo", "docVisData", "docVisResp", "docVisAcomp", "docVisAgua", "docVisLuz", "docVisGas", "docVisChaves", "docVisObs" ].forEach(id => { $(id).disabled = so; });
        $("docVisAddAmb").hidden = so; $("docVisSalvar").hidden = so;
        $("docVisImprimir").hidden = !v;
        $("docVisExcluir").hidden = !v || so;
        msg($("docVisMsg"), "");
        desenharAmbientes();
        $("docVistoriaDialog").showModal();
    }
    function desenharAmbientes() {
        const so = !podeGerir();
        const box = $("docVisAmbientes");
        box.innerHTML = ambientes.map((a, ai) => `<details class="ext-ambiente"${ai === 0 ? " open" : ""} data-a="${ai}">
          <summary><input data-amb-nome value="${h(a.nome)}"${so ? " disabled" : ""} /><span class="muted-text">${a.itens.filter(i => [ "ruim", "danificado" ].includes(i.estado)).length ? "⚠ itens com problema" : ""}</span>
            ${so ? "" : `<button type="button" class="text-button crm-remover" data-amb-remover title="Tirar ambiente">✕</button>`}</summary>
          <table class="ext-itens"><thead><tr><th>Item</th><th>Estado</th><th>Observação</th><th></th></tr></thead><tbody>
          ${a.itens.map((it, ii) => `<tr data-i="${ii}"><td><input data-k="item" value="${h(it.item)}"${so ? " disabled" : ""} /></td>
            <td><select data-k="estado"${so ? " disabled" : ""}>${Object.entries(ESTADOS).map(([ v, t ]) => `<option value="${v}"${v === it.estado ? " selected" : ""}>${t}</option>`).join("")}</select></td>
            <td><input data-k="obs" value="${h(it.obs || "")}"${so ? " disabled" : ""} placeholder="ex.: risco na porta" /></td>
            <td>${so ? "" : `<button type="button" class="text-button crm-remover" data-item-remover>✕</button>`}</td></tr>`).join("")}
          </tbody></table>
          ${so ? "" : `<button type="button" class="text-button" data-item-add>+ item</button>`}
          <div class="ext-fotos" data-fotos></div>
          ${vistoria && !so ? `<label class="secondary-button fin-mini ext-foto-btn">📷 Fotos deste ambiente<input type="file" accept="image/*" multiple hidden data-foto-input /></label>`
            : (!vistoria && !so ? `<p class="muted-text">Salve a vistoria para anexar fotos.</p>` : "")}
        </details>`).join("");
        box.querySelectorAll(".ext-ambiente").forEach(el => {
            const ai = Number(el.dataset.a), a = ambientes[ai];
            const nome = el.querySelector("[data-amb-nome]");
            nome.addEventListener("click", e => e.preventDefault());
            nome.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") e.stopPropagation(); });
            nome.addEventListener("input", () => { a.nome = nome.value; });
            const rem = el.querySelector("[data-amb-remover]");
            if (rem) rem.addEventListener("click", e => { e.preventDefault(); if (window.confirm(`Tirar o ambiente "${a.nome}"?`)) { ambientes.splice(ai, 1); desenharAmbientes(); } });
            el.querySelectorAll("tbody tr").forEach(tr => {
                const ii = Number(tr.dataset.i);
                tr.querySelectorAll("[data-k]").forEach(c => c.addEventListener(c.tagName === "SELECT" ? "change" : "input", () => { a.itens[ii][c.dataset.k] = c.value; }));
                const r = tr.querySelector("[data-item-remover]");
                if (r) r.addEventListener("click", () => { a.itens.splice(ii, 1); desenharAmbientes(); });
            });
            const add = el.querySelector("[data-item-add]");
            if (add) add.addEventListener("click", () => { a.itens.push({ item: "", estado: "bom", obs: "" }); desenharAmbientes(); });
            desenharFotosAmbiente(el.querySelector("[data-fotos]"), a);
            const inp = el.querySelector("[data-foto-input]");
            if (inp) inp.addEventListener("change", () => enviarFotosAmbiente(inp, a, el.querySelector("[data-fotos]")));
        });
    }
    async function desenharFotosAmbiente(box, a) {
        const fotos = a.fotos || [];
        if (!fotos.length) { box.innerHTML = ""; return; }
        const { data } = await ctx.sb.storage.from("documentos-aluguel").createSignedUrls(fotos, 3600);
        box.innerHTML = (data || []).map(u => u.signedUrl ? `<a href="${h(u.signedUrl)}" target="_blank" rel="noopener"><img src="${h(u.signedUrl)}" alt="" /></a>` : "").join("");
    }
    async function enviarFotosAmbiente(input, a, box) {
        const arquivos = [ ...input.files ];
        input.value = "";
        if (!arquivos.length || !vistoria) return;
        ctx.toast(`Enviando ${arquivos.length} foto(s)…`);
        for (const f of arquivos) {
            const caminho = `${ctx.carteiraId()}/vistoria/${vistoria.id}/${Date.now()}_${f.name.replace(/[^\w.-]+/g, "_").slice(-60)}`;
            const { error } = await ctx.sb.storage.from("documentos-aluguel").upload(caminho, f, { contentType: f.type || "image/jpeg" });
            if (error) { ctx.toast(erro(error)); return; }
            a.fotos = (a.fotos || []).concat(caminho);
        }
        await salvarVistoria(true);
        desenharFotosAmbiente(box, a);
    }
    function coletarVistoria() {
        return {
            contrato_id: contratoDaVistoria.id, tipo: $("docVisTipo").value, realizada_em: $("docVisData").value,
            responsavel: $("docVisResp").value.trim(), acompanhante: $("docVisAcomp").value.trim(),
            leituras: { agua: $("docVisAgua").value.trim(), luz: $("docVisLuz").value.trim(), gas: $("docVisGas").value.trim() },
            chaves_entregues: $("docVisChaves").value, observacoes: $("docVisObs").value.trim(),
            ambientes: ambientes.map(a => ({ nome: (a.nome || "").trim() || "Ambiente", itens: a.itens.filter(i => (i.item || "").trim()).map(i => ({ item: i.item.trim(), estado: i.estado, obs: (i.obs || "").trim() })), fotos: a.fotos || [] }))
        };
    }
    async function salvarVistoria(silencioso) {
        const { data, error } = await ctx.sb.rpc("vistoria_salvar", { p_carteira: ctx.carteiraId(), p_dados: coletarVistoria(), p_id: vistoria ? vistoria.id : null });
        if (error) { msg($("docVisMsg"), erro(error)); return; }
        const nova = !vistoria;
        vistoria = data;
        if (silencioso === true) return;
        ctx.toast(nova ? "Vistoria salva. Agora dá para anexar fotos em cada ambiente." : "Vistoria salva.");
        $("docVisImprimir").hidden = false;
        $("docVisExcluir").hidden = !podeGerir();
        if (nova) desenharAmbientes();
        listarVistorias(contratoDaVistoria);
    }
    async function excluirVistoria() {
        if (!vistoria || !window.confirm("Excluir esta vistoria e as fotos dela?")) return;
        const fotos = (vistoria.ambientes || []).flatMap(a => a.fotos || []);
        const { error } = await ctx.sb.rpc("vistoria_excluir", { p_id: vistoria.id });
        if (error) { msg($("docVisMsg"), erro(error)); return; }
        if (fotos.length) await ctx.sb.storage.from("documentos-aluguel").remove(fotos);
        $("docVistoriaDialog").close();
        listarVistorias(contratoDaVistoria);
    }
    async function imprimirVistoria(v) {
        if (!v) return;
        const c = contratoDaVistoria, im = imovel(c.construcao_id) || {};
        const entrada = v.tipo !== "entrada" ? vistoriasDoContrato.find(x => x.tipo === "entrada") : null;
        const estadoEntrada = (amb, item) => {
            if (!entrada) return null;
            const a = entrada.ambientes.find(x => x.nome === amb);
            const i = a && a.itens.find(x => x.item === item);
            return i ? i.estado : null;
        };
        const fotos = (v.ambientes || []).flatMap(a => a.fotos || []);
        const urls = new Map();
        if (fotos.length) {
            const { data } = await ctx.sb.storage.from("documentos-aluguel").createSignedUrls(fotos, 3600);
            (data || []).forEach(u => { if (u.signedUrl) urls.set(u.path, u.signedUrl); });
        }
        const inq = cliente(c.inquilino_id) || {}, prop = cliente(c.proprietario_id) || {};
        const l = v.leituras || {};
        const html = `<div class="fin-doc ext-vistoria"><header><div><strong>${h(ctx.carteiraNome())}</strong><span>Termo de vistoria de ${h({ entrada: "entrada", saida: "saída", periodica: "rotina" }[v.tipo])}</span></div><small>${h(dataBr(v.realizada_em))}</small></header>
          <p>Imóvel: <strong>${h(im.nome || "")}</strong> (cód. ${h(im.codigo || "")}) — ${h(enderecoImovel(im))}<br>
          Contrato nº ${h(c.numero)} · Locatário: <strong>${h(inq.nome || "—")}</strong> · Locador: ${h(prop.nome || "—")}<br>
          Vistoriador: ${h(v.responsavel || "—")}${v.acompanhante ? ` · Acompanhado por: ${h(v.acompanhante)}` : ""}</p>
          ${l.agua || l.luz || l.gas || v.chaves_entregues != null ? `<p>Leituras — água: ${h(l.agua || "—")} · luz: ${h(l.luz || "—")} · gás: ${h(l.gas || "—")}${v.chaves_entregues != null ? ` · chaves entregues: ${h(v.chaves_entregues)}` : ""}</p>` : ""}
          ${(v.ambientes || []).map(a => `<h4>${h(a.nome)}</h4><table class="fin-doc-tabela ext-doc-itens"><tr class="cab"><td>Item</td>${entrada ? "<td>Na entrada</td>" : ""}<td>Estado</td><td>Observação</td></tr>
            ${a.itens.map(i => { const e0 = estadoEntrada(a.nome, i.item); const ordem = [ "novo", "bom", "regular", "ruim", "danificado" ]; const piorou = e0 && ordem.includes(e0) && ordem.indexOf(i.estado) > ordem.indexOf(e0);
              return `<tr${piorou ? ` class="ext-piorou"` : ""}><td>${h(i.item)}</td>${entrada ? `<td>${h(ESTADOS[e0] || "—")}</td>` : ""}<td>${h(ESTADOS[i.estado] || i.estado)}</td><td>${h(i.obs || "")}</td></tr>`; }).join("")}</table>
            ${(a.fotos || []).length ? `<div class="ext-doc-fotos">${a.fotos.map(p => urls.get(p) ? `<img src="${h(urls.get(p))}" alt="" />` : "").join("")}</div>` : ""}`).join("")}
          ${v.observacoes ? `<p><strong>Observações:</strong> ${h(v.observacoes)}</p>` : ""}
          ${entrada ? `<p class="fin-doc-rodape">Itens destacados pioraram em relação à vistoria de entrada de ${h(dataBr(entrada.realizada_em))}.</p>` : ""}
          <p>As partes declaram que o imóvel está no estado descrito acima.</p>
          <div class="ext-assinaturas"><div class="fin-assinatura">Locatário</div><div class="fin-assinatura">Vistoriador / ${h(ctx.carteiraNome())}</div></div></div>`;
        window.SKLFinanceiro.imprimir(html);
    }

    // ------------------------------------------------------------------ anexos (componente reaproveitado em cliente, negociação, contrato, imóvel)
    async function anexos(box, entidade, id, opcoes) {
        if (!box) return;
        const op = opcoes || {};
        box.innerHTML = `<p class="muted-text">Carregando documentos…</p>`;
        const { data, error } = await ctx.sb.from("crm_documentos").select("*").eq("entidade", entidade).eq("entidade_id", id).order("created_at", { ascending: false });
        if (error) { box.innerHTML = `<p class="muted-text">Documentos indisponíveis.</p>`; return; }
        const lista = data || [];
        const eu = (ctx.usuario() || {}).id;
        box.innerHTML = `<div class="ext-lista">${lista.length ? lista.map(d => `<div class="ext-item"><span><strong>${h(d.nome)}</strong>
            <small>${h(d.categoria || "")}${d.categoria ? " · " : ""}${h(new Date(d.created_at).toLocaleDateString("pt-BR"))}${d.tamanho ? " · " + Math.max(1, Math.round(d.tamanho / 1024)) + " KB" : ""}</small></span>
            <span class="ext-item-acoes"><button type="button" class="secondary-button fin-mini" data-abrir="${h(d.id)}">Abrir</button>
            ${d.enviado_por === eu || ctx.gestao() || podeGerir() ? `<button type="button" class="text-button" data-apagar="${h(d.id)}">Excluir</button>` : ""}</span></div>`).join("")
            : `<p class="muted-text">Nenhum documento anexado.</p>`}</div>
          ${op.podeEnviar === false ? "" : `<div class="ext-anexar"><select data-cat>${(op.categorias || [ "Documento pessoal", "Comprovante de renda", "Comprovante de endereço", "Outro" ]).map(c => `<option>${h(c)}</option>`).join("")}</select>
            <label class="secondary-button fin-mini">📎 Anexar arquivo<input type="file" hidden data-arquivo accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.kml,.kmz,.zip" /></label></div>`}`;
        box.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", async () => {
            const d = lista.find(x => x.id === b.dataset.abrir);
            const { data: u, error: e2 } = await ctx.sb.storage.from("documentos-aluguel").createSignedUrl(d.path, 600);
            if (e2 || !u) { ctx.toast("Não foi possível abrir o arquivo."); return; }
            window.open(u.signedUrl, "_blank", "noopener");
        }));
        box.querySelectorAll("[data-apagar]").forEach(b => b.addEventListener("click", async () => {
            const d = lista.find(x => x.id === b.dataset.apagar);
            if (!window.confirm(`Excluir "${d.nome}"?`)) return;
            const { error: e3 } = await ctx.sb.storage.from("documentos-aluguel").remove([ d.path ]);
            if (e3) { ctx.toast(erro(e3)); return; }
            const { error: e4 } = await ctx.sb.rpc("doc_excluir", { p_id: d.id });
            if (e4) { ctx.toast(erro(e4)); return; }
            anexos(box, entidade, id, op);
        }));
        const inp = box.querySelector("[data-arquivo]");
        if (inp) inp.addEventListener("change", async () => {
            const f = inp.files[0];
            inp.value = "";
            if (!f) return;
            if (f.size > 20 * 1024 * 1024) { ctx.toast("Arquivo maior que 20 MB."); return; }
            const caminho = `${ctx.carteiraId()}/${entidade}/${id}/${Date.now()}_${f.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
            ctx.toast("Enviando…");
            const { error: e5 } = await ctx.sb.storage.from("documentos-aluguel").upload(caminho, f, { contentType: f.type || undefined });
            if (e5) { ctx.toast(erro(e5)); return; }
            const { error: e6 } = await ctx.sb.rpc("doc_registrar", { p_carteira: ctx.carteiraId(), p_entidade: entidade, p_id: id,
                p_dados: { nome: f.name, categoria: box.querySelector("[data-cat]").value, path: caminho, tamanho: f.size, tipo_mime: f.type } });
            if (e6) { await ctx.sb.storage.from("documentos-aluguel").remove([ caminho ]); ctx.toast(erro(e6)); return; }
            ctx.toast("Documento anexado.");
            anexos(box, entidade, id, op);
        });
    }

    // Anexos de um cadastro que ainda não foi salvo: os arquivos ficam na fila e sobem depois de salvar (enviar(entidade, id)).
    function anexosNovos(box, opcoes) {
        const op = opcoes || {};
        const fila = [];
        const desenhar = () => {
            box.innerHTML = `<div class="ext-lista">${fila.length ? fila.map((f, i) => `<div class="ext-item"><span><strong>${h(f.arquivo.name)}</strong>
                <small>${h(f.categoria)} · ${Math.max(1, Math.round(f.arquivo.size / 1024))} KB · enviado ao salvar</small></span>
                <span class="ext-item-acoes"><button type="button" class="text-button" data-tirar="${i}">Tirar</button></span></div>`).join("")
                : `<p class="muted-text">Nenhum documento escolhido.</p>`}</div>
              <div class="ext-anexar"><select data-cat>${(op.categorias || [ "Outro" ]).map(c => `<option>${h(c)}</option>`).join("")}</select>
                <label class="secondary-button fin-mini">📎 Anexar arquivo<input type="file" hidden data-arquivo multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.kml,.kmz,.zip" /></label></div>`;
            box.querySelectorAll("[data-tirar]").forEach(b => b.addEventListener("click", () => { fila.splice(Number(b.dataset.tirar), 1); desenhar(); }));
            const inp = box.querySelector("[data-arquivo]");
            inp.addEventListener("change", () => {
                const categoria = box.querySelector("[data-cat]").value;
                [ ...inp.files ].forEach(arquivo => {
                    if (arquivo.size > 20 * 1024 * 1024) { ctx.toast(`"${arquivo.name}" passa de 20 MB.`); return; }
                    fila.push({ arquivo, categoria });
                });
                desenhar();
            });
        };
        desenhar();
        return {
            quantidade: () => fila.length,
            async enviar(entidade, id) {
                let falhas = 0;
                for (const { arquivo, categoria } of fila.splice(0)) {
                    const caminho = `${ctx.carteiraId()}/${entidade}/${id}/${Date.now()}_${arquivo.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
                    const { error: e1 } = await ctx.sb.storage.from("documentos-aluguel").upload(caminho, arquivo, { contentType: arquivo.type || undefined });
                    if (e1) { falhas++; continue; }
                    const { error: e2 } = await ctx.sb.rpc("doc_registrar", { p_carteira: ctx.carteiraId(), p_entidade: entidade, p_id: id,
                        p_dados: { nome: arquivo.name, categoria, path: caminho, tamanho: arquivo.size, tipo_mime: arquivo.type } });
                    if (e2) { falhas++; await ctx.sb.storage.from("documentos-aluguel").remove([ caminho ]); }
                }
                return falhas;
            }
        };
    }

    // ------------------------------------------------------------------ informe de rendimentos
    function abrirInforme() {
        const ano = new Date().getFullYear();
        $("docInfAno").innerHTML = [ ano - 1, ano, ano - 2 ].map(a => `<option value="${a}">${a}</option>`).join("");
        const props = new Map();
        ((window.SKLFinanceiro && window.SKLFinanceiro.contratos()) || []).forEach(c => { if (c.proprietario_id) props.set(c.proprietario_id, (cliente(c.proprietario_id) || {}).nome || "Proprietário"); });
        $("docInfProp").innerHTML = `<option value="">Todos os proprietários</option>` + [ ...props ].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([ id, n ]) => `<option value="${h(id)}">${h(n)}</option>`).join("");
        msg($("docInfMsg"), "");
        $("docInformeDialog").showModal();
    }
    async function gerarInforme() {
        const ano = Number($("docInfAno").value);
        const { data, error } = await ctx.sb.rpc("fin_informe_rendimentos", { p_carteira: ctx.carteiraId(), p_ano: ano, p_proprietario: $("docInfProp").value || null });
        if (error) { msg($("docInfMsg"), erro(error)); return; }
        if (!data || !data.length) { msg($("docInfMsg"), `Nenhum aluguel recebido em ${ano} para esta seleção.`); return; }
        $("docInformeDialog").close();
        const html = data.map(p => `<div class="fin-doc ext-informe"><header><div><strong>${h(ctx.carteiraNome())}</strong><span>Informe de rendimentos de aluguel — ${ano}</span></div><small>Emitido em ${h(new Date().toLocaleDateString("pt-BR"))}</small></header>
          <p>Beneficiário (locador): <strong>${h(p.proprietario || "—")}</strong>${p.proprietario_cpf ? ` · CPF/CNPJ ${h(p.proprietario_cpf)}` : ""}<br>
          Fonte pagadora / administradora: ${h(ctx.carteiraNome())}</p>
          <table class="fin-doc-tabela ext-doc-itens"><tr class="cab"><td>Mês</td><td>Contrato / imóvel</td><td>Aluguel</td><td>Multa e juros</td><td>Intermediação</td><td>Taxa adm.</td><td>Repassado</td></tr>
          ${p.contratos.map(l => `<tr><td>${h(mesAno(l.competencia))}</td><td>nº ${h(l.contrato)} · ${h(l.imovel || "")}<br><small>Inquilino: ${h(l.inquilino || "—")}${l.inquilino_cpf ? " · CPF " + h(l.inquilino_cpf) : ""}</small></td>
            <td>${h(dinheiro(l.aluguel))}</td><td>${h(dinheiro(l.multa_juros))}</td><td>${h(dinheiro(l.intermediacao))}</td><td>${h(dinheiro(l.taxa_adm))}</td><td>${h(dinheiro(l.liquido))}</td></tr>`).join("")}
          <tr class="forte"><td colspan="2">Totais do ano</td><td>${h(dinheiro(p.total_aluguel))}</td><td>${h(dinheiro(p.total_multa_juros))}</td><td>${h(dinheiro(p.total_intermediacao))}</td><td>${h(dinheiro(p.total_taxa_adm))}</td><td>${h(dinheiro(p.total_liquido))}</td></tr></table>
          <p class="fin-doc-rodape">Rendimento bruto de aluguel: ${h(dinheiro(Number(p.total_aluguel) + Number(p.total_multa_juros)))}. Despesas dedutíveis pagas à administradora (intermediação + administração): ${h(dinheiro(Number(p.total_intermediacao) + Number(p.total_taxa_adm)))}.
          Valores pela data do pagamento do aluguel. Confira com o contador antes de declarar.</p></div>`).join(`<div class="ext-quebra"></div>`);
        window.SKLFinanceiro.imprimir(html);
    }

    window.SKLDocumentos = { iniciar, aoAbrirContrato, anexos, anexosNovos, abrirInforme, extenso, valoresContrato };
})();
