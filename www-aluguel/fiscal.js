// Fiscal → DIMOB (aba "Fiscal · DIMOB" do Financeiro). Confere o ano-calendário (vendas/intermediações e locações), aponta o que falta, deixa completar os
// dados fiscais SEM mexer no negócio original (ficha fiscal de cada operação, partes com CPF/CNPJ e participação,
// ajustes mensais com motivo), imprime o relatório de conferência para o contador e — só depois de o leiaute oficial
// ser conferido — gera o arquivo .txt para IMPORTAR no programa da Receita (PGD). A SKL não transmite nada.
// Fatos e permissão: RPC dimob_dados (só administrador, central_vendas e financeiro). Regras: dimob-motor.js.
// Arquivo: dimob-leiaute.js. Escrita: RPCs dimob_*.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const M = () => window.SKLDimobMotor;
    const L = () => window.SKLDimobLeiaute;
    const GERADOR = "SKL Fiscal 1.0.0";
    const LEIAUTE_PADRAO = "pgd-2.8g";
    const MESES = [ "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez" ];
    const PAPEIS = { comprador: "Comprador", vendedor: "Vendedor", locador: "Locador (proprietário)", locatario: "Locatário (inquilino)" };
    const CAMPOS_AJUSTE = { imposto_retido: "Imposto retido", rendimento: "Rendimento (aluguel)", comissao: "Comissão / taxa" };
    const ORDEM_NIVEL = { erro: 0, alerta: 1, info: 2 };
    const AVISO ="Arquivo preparado para importação no programa oficial DIMOB. A SKL NÃO realiza transmissão à Receita Federal e NÃO emite recibo de entrega.";

    let ctx = null, ligado = false, aba = "resumo", dados = null, apur = null, carregando = null, busca = "";
    let opAberta = null, ajusteAlvo = null;

    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pode = () => !!ctx && ctx.podeGerir();
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const reais = c => c == null ? "—" : "R$ " + (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const reaisCurto = c => !c ? "—" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dataBr = iso => iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—";
    function docFmt(d) {
        const s = String(d || "").replace(/\D/g, "");
        if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
        if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
        return s || "—";
    }
    // texto do usuário ("1.234,56", "-80") → "1234.56" sem passar por ponto flutuante
    function valorTexto(t) {
        let s = String(t == null ? "" : t).trim();
        if (!s) return null;
        const neg = s.startsWith("-");
        s = s.replace(/[^\d.,]/g, "");
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
        if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
        return (neg ? "-" : "") + s;
    }
    const paraCampo = v => v == null || v === "" ? "" : String(v).replace(".", ",");
    function msg(el, texto, ok) { el.textContent = texto || ""; el.hidden = !texto; el.classList.toggle("fiscal-msg-ok", !!ok); }
    const anoPadrao = () => { const d = new Date(); return d.getMonth() <= 1 ? d.getFullYear() - 1 : d.getFullYear(); };
    const leiauteVersao = () => LEIAUTE_PADRAO;
    const leiauteOk = () => !!(L() && L().confirmado(leiauteVersao()) && dados && (dados.leiautes || []).some(x => x.versao === leiauteVersao() && x.confirmado));
    const declaranteSel = () => (dados && dados.declarantes || []).find(d => d.id === $("fiscalDeclarante").value) || (dados && dados.declarantes && dados.declarantes[0]) || null;

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { montarDialogos(); ligarEventos(); ligado = true; }
        $("finAbaFiscal").hidden = !pode();
        dados = null; apur = null;
        const sel = $("fiscalAno");
        if (!sel.options.length) {
            const atual = new Date().getFullYear();
            for (let a = atual; a >= atual - 5; a--) sel.add(new Option(String(a), String(a)));
            sel.value = String(anoPadrao());
        }
        return Promise.resolve();
    }
    function sair() { dados = null; apur = null; }
    function aoMostrar() { if (pode() && !dados) carregar(); else render(); }
    // ganchos chamados pelo financeiro.js ao trocar de aba
    const temAba = a => a === "fiscal" && pode();
    function renderAba(a) {
        const ligada = temAba(a);
        $("finFiscal").hidden = !ligada;
        const barra = document.querySelector("#page-financeiro > .fin-toolbar");
        if (barra) barra.hidden = ligada;
        if (ligada) aoMostrar();
    }
    // tabela oficial de municípios do PGD (~280 KB): só carrega quando a página Fiscal abre
    let tabelaMun = null;
    function carregarTabelaMunicipios() {
        if (window.SKLDimobMunicipios) return Promise.resolve();
        if (!tabelaMun) tabelaMun = new Promise(ok => {
            const s = document.createElement("script");
            s.src = "dimob-municipios.js"; s.onload = () => ok(); s.onerror = () => { tabelaMun = null; ok(); };
            document.head.appendChild(s);
        });
        return tabelaMun;
    }

    async function carregar() {
        if (!pode()) return;
        if (carregando) return carregando;
        $("fiscalConteudo").innerHTML = `<p class="muted-text">Carregando o ano ${h($("fiscalAno").value)}…</p>`;
        carregando = (async () => {
            try {
                await carregarTabelaMunicipios();
                const { data, error } = await ctx.sb.rpc("dimob_dados", { p_carteira: ctx.carteiraId(), p_ano: Number($("fiscalAno").value) });
                if (error) throw error;
                dados = data;
                const sel = $("fiscalDeclarante"), atual = sel.value;
                sel.innerHTML = (dados.declarantes || []).map(d => `<option value="${h(d.id)}">${h(docFmt(d.cnpj))} — ${h(d.nome_empresarial)}</option>`).join("")
                    || `<option value="">Nenhum CNPJ cadastrado</option>`;
                if (atual && [ ...sel.options ].some(o => o.value === atual)) sel.value = atual;
                apurar();
            } catch (e) {
                dados = null; apur = null;
                $("fiscalConteudo").innerHTML = `<div class="fiscal-aviso fiscal-aviso-erro">${h(erro(e))}</div>`;
            } finally { carregando = null; }
        })();
        return carregando;
    }
    function apurar() {
        const def = L() && L().LEIAUTES[leiauteVersao()];
        apur = M().criarApuracao(dados, { declaranteId: $("fiscalDeclarante").value || null, municipiosOficiais: window.SKLDimobMunicipios, limites: def && def.limites });
        if (!window.SKLDimobMunicipios) apur.pendencias.unshift({ nivel: "alerta", origem: null, texto: "Não foi possível carregar a tabela oficial de municípios; os códigos precisam ser informados à mão.", campo: null });
        render();
    }

    // ------------------------------------------------------------------ desenho
    function render() {
        if (!dados || !apur) return;
        document.querySelectorAll("[data-fiscal-aba]").forEach(b => b.classList.toggle("ativa", b.dataset.fiscalAba === aba));
        const nErros = apur.pendencias.filter(p => p.nivel === "erro").length;
        [ "fiscalPendBadge", "finFiscalBadge" ].forEach(id => { const b = $(id); b.textContent = nErros; b.hidden = !nErros; });
        $("fiscalBusca").hidden = !(aba === "vendas" || aba === "locacoes");
        const gerar = $("fiscalGerar");
        gerar.disabled = !leiauteOk() || nErros > 0 || !declaranteSel();
        gerar.title = !leiauteOk() ? "Aguardando a conferência do leiaute oficial de importação (programa da Receita)." : nErros ? "Corrija as pendências antes." : "";
        const html = { resumo: htmlResumo, vendas: htmlVendas, locacoes: htmlLocacoes, pendencias: htmlPendencias, historico: htmlHistorico }[aba]();
        $("fiscalConteudo").innerHTML = html;
    }
    function statusLeiaute() {
        const l = (dados.leiautes || []).find(x => x.versao === leiauteVersao());
        if (leiauteOk() && l && l.validado_pgd && L().validadoPgd(leiauteVersao())) return `<span class="fiscal-selo ok">Leiaute ${h(leiauteVersao())}: importação testada no PGD</span>`;
        if (leiauteOk()) return `<span class="fiscal-selo alerta" title="Leiaute transcrito do programa oficial e conferido campo a campo. Falta importar um arquivo de teste no PGD.">Leiaute PGD ${h(leiauteVersao().replace("pgd-", ""))} — AGUARDANDO VALIDAÇÃO NO PGD</span>`;
        return `<span class="fiscal-selo alerta">Arquivo .txt bloqueado: leiaute oficial de importação ainda não conferido</span>`;
    }
    function cardC(rotulo, valor, sub, alerta) {
        return `<div class="crm-resumo-item${alerta ? " fin-alerta" : ""}"><span>${h(rotulo)}</span><strong>${h(valor)}</strong>${sub ? `<small>${h(sub)}</small>` : ""}</div>`;
    }
    function htmlResumo() {
        const t = apur.totais, d = apur.declarante;
        const nE = apur.erros, nA = apur.alertas;
        const fora = apur.fora;
        return `
          <div class="fiscal-aviso">${h(AVISO)}</div>
          <div class="fiscal-linha-status">${statusLeiaute()}
            ${d ? `<span class="fiscal-selo">${h(docFmt(d.cnpj))} · ${h(d.nome_empresarial)}</span>` : `<span class="fiscal-selo erro">Sem CNPJ declarante</span>`}
            <span class="fiscal-selo ${nE ? "erro" : "ok"}">${nE ? nE + " pendência(s) que impedem o arquivo" : "Sem pendências impeditivas"}</span>
            ${nA ? `<span class="fiscal-selo alerta">${nA} alerta(s) para conferir</span>` : ""}</div>
          <div class="crm-resumo fin-cards">
            ${cardC("Vendas intermediadas", String(t.vendas), `${t.registros_venda} registro(s) por pessoa`)}
            ${cardC("Valor das vendas", reais(t.valor_vendas), "ano da celebração do contrato")}
            ${cardC("Comissões de venda", reais(t.comissao_vendas))}
            ${cardC("Locações", String(t.locacoes), "por locador e locatário")}
            ${cardC("Aluguéis recebidos", reais(t.rendimento_ano), "mês do pagamento")}
            ${cardC("Comissões / taxas", reais(t.comissao_locacao_ano), t.imposto_ano ? "IR retido " + reais(t.imposto_ano) : "")}
          </div>
          ${t.vendas_proprias ? `<p class="muted-text">Vendas próprias (construção/incorporação/loteamento): ${t.vendas_proprias}.</p>` : ""}
          ${t.sem_movimento ? `<div class="fiscal-aviso">Nenhuma operação no ano ${apur.ano}. Pela Receita (pergunta 6), quem não teve operações imobiliárias no ano não é obrigado a entregar — confirme com o contador.</div>` : ""}
          <div class="panel table-panel"><h3 class="fiscal-h3">Locações — totais por mês (reconciliação)</h3>${tabelaMeses([
            [ "Aluguéis (rendimento)", t.rendimento_mes ], [ "Comissão / taxa", t.comissao_mes ], [ "Imposto retido", t.imposto_mes ] ])}</div>
          ${(fora.vendas.length || fora.locacoes.length || fora.locacoes_intermediadas.length) ? `<div class="panel fiscal-fora"><h3 class="fiscal-h3">Fora da declaração</h3>
            <ul>${fora.vendas.map(v => `<li>Venda: ${h(v.titulo)} — ${h(v.motivo || "")}</li>`).join("")}
            ${fora.locacoes.map(v => `<li>Contrato: ${h(v.titulo)} — ${h(v.motivo || "")}</li>`).join("")}
            ${fora.locacoes_intermediadas.length ? `<li>${fora.locacoes_intermediadas.length} locação(ões) só intermediada(s), aguardando decisão do contador (aba Locações).</li>` : ""}</ul></div>` : ""}`;
    }
    function tabelaMeses(linhas) {
        return `<div class="fiscal-rolagem"><table class="crm-tabela fiscal-meses"><thead><tr><th></th>${MESES.map(m => `<th>${m}</th>`).join("")}<th>Total</th></tr></thead><tbody>
          ${linhas.map(([ rot, arr ]) => `<tr><th>${h(rot)}</th>${arr.map(v => `<td>${h(reaisCurto(v))}</td>`).join("")}<td><strong>${h(reaisCurto(arr.reduce((a, b) => a + b, 0)))}</strong></td></tr>`).join("")}
        </tbody></table></div>`;
    }
    const pendDe = (tipo, id) => apur.pendencias.filter(p => p.origem && p.origem.origem_tipo === tipo && p.origem.origem_id === id);
    function seloPend(tipo, id) {
        const p = pendDe(tipo, id), e = p.filter(x => x.nivel === "erro").length, a = p.filter(x => x.nivel === "alerta").length;
        if (e) return `<span class="fiscal-selo erro">${e} pendência(s)</span>`;
        if (a) return `<span class="fiscal-selo alerta">${a} alerta(s)</span>`;
        return `<span class="fiscal-selo ok">OK</span>`;
    }
    const pessoas = lista => lista.length ? lista.map(p => `${h(p.nome)}${p.documento ? ` <small>${h(docFmt(p.documento))}</small>` : ` <small class="fin-txt-alerta">sem CPF/CNPJ</small>`}${p.percentual !== 100 ? ` <small>(${h(String(p.percentual).replace(".", ","))}%)</small>` : ""}`).join("<br>") : `<span class="fin-txt-alerta">não informado</span>`;
    const casa = (t, ...campos) => !busca || M().norm(campos.join(" ")).includes(M().norm(t));
    function htmlVendas() {
        const lista = apur.vendas.filter(v => casa(busca, v.titulo, v.imovel && v.imovel.nome, ...v.compradores.map(p => p.nome + " " + p.documento), ...v.vendedores.map(p => p.nome + " " + p.documento)));
        const foraIds = new Set(apur.fora.vendas.map(v => v.origem_id));
        const fora = (dados.vendas || []).filter(v => foraIds.has(v.origem_id));
        return `<p class="muted-text">Vendas e intermediações contam no ano da assinatura do contrato (não no pagamento nem no registro). Valores em R$; quando há parceria, já com a participação desta imobiliária.</p>
          <div class="panel table-panel">${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Data</th><th>Operação / imóvel</th><th>Comprador(es)</th><th>Vendedor(es)</th><th>Valor</th><th>Comissão</th><th>Situação</th><th></th></tr></thead><tbody>
            ${lista.map(v => `<tr><td>${h(dataBr(v.data_contrato))}</td><td>${h(v.titulo || "")}<span class="fin-sub">${h([ v.imovel && v.imovel.codigo, v.imovel && v.imovel.nome ].filter(Boolean).join(" · "))}${v.tipo_operacao === "venda_propria" ? " · venda própria" : ""}${v.participacao_pct !== 100 ? " · participação " + String(v.participacao_pct).replace(".", ",") + "%" : ""}</span></td>
              <td>${pessoas(v.compradores)}</td><td>${pessoas(v.vendedores)}</td><td>${h(reais(v.valor))}</td><td>${h(reais(v.comissao))}</td>
              <td>${seloPend(v.origem_tipo, v.origem_id)}</td><td><button type="button" class="secondary-button fin-mini" data-fiscal-ficha="${h(v.origem_tipo)}|${h(v.origem_id)}">Ficha fiscal</button></td></tr>`).join("")}
          </tbody></table>` : `<p class="muted-text fiscal-vazio">Nenhuma venda no ano.</p>`}</div>
          ${fora.length ? `<div class="panel fiscal-fora"><h3 class="fiscal-h3">Vendas deixadas fora</h3><ul>${fora.map(v => `<li>${h(v.titulo || "")} — ${h(v.motivo_exclusao || "")} <button type="button" class="text-button" data-fiscal-ficha="negociacao|${h(v.origem_id)}">Ficha</button></li>`).join("")}</ul></div>` : ""}`;
    }
    function htmlLocacoes() {
        const lista = apur.locacoes.filter(g => casa(busca, g.locador.nome, g.locador.documento, g.locatario.nome, g.locatario.documento, g.imovel && g.imovel.nome, g.numero_contrato));
        const inter = apur.fora.locacoes_intermediadas;
        return `<p class="muted-text">Aluguel e comissão no mês em que o inquilino pagou (perg. 20 da Receita). Um registro por locador, com a fração dele. Contratos das mesmas partes no mesmo imóvel são somados, com o número e a data do mais antigo.</p>
          ${lista.length ? lista.map((g, i) => `<details class="panel fiscal-loc"${i < 1 ? " open" : ""}><summary>
              <strong>${h(g.locador.nome || "Locador ?")}</strong> → ${h(g.locatario.nome || "Locatário ?")}
              <span class="fin-sub">${h([ g.imovel && g.imovel.codigo, g.imovel && (g.imovel.nome || g.imovel.logradouro) ].filter(Boolean).join(" · "))} · contrato ${h(g.numero_contrato || "s/nº")} de ${h(dataBr(g.data_contrato))} · ${h(reais(g.meses.rendimento.reduce((a, b) => a + b, 0)))} no ano</span></summary>
              <p class="fiscal-pessoas">Locador: ${pessoas([ g.locador ])} · Locatário: ${pessoas([ g.locatario ])}</p>
              ${tabelaMeses([ [ "Aluguel", g.meses.rendimento ], [ "Comissão", g.meses.comissao ], [ "Imposto retido", g.meses.imposto_retido ] ])}
              <div class="fiscal-origens"><strong>De onde vêm os valores</strong><ul>${g.origens.map(o => `<li>${h(o.titulo)}${o.participacao_pct !== 100 ? ` (fração ${h(String(o.participacao_pct).replace(".", ","))}%)` : ""} ${seloPend(o.origem_tipo, o.origem_id)}
                <button type="button" class="text-button" data-fiscal-ficha="${h(o.origem_tipo)}|${h(o.origem_id)}">Ficha fiscal</button>
                <button type="button" class="text-button" data-fiscal-ajuste="${h(o.origem_tipo)}|${h(o.origem_id)}">Ajustes do mês</button>
                <small>${o.valores.map(v => v.fonte === "ajuste" ? `ajuste ${MESES[v.mes - 1]} ${CAMPOS_AJUSTE[v.campo]} ${reaisCurto(v.valor)} (${v.motivo})` : `${MESES[v.mes - 1]}: aluguel ${reaisCurto(v.rendimento)} / comissão ${reaisCurto(v.comissao)}${v.pago_em ? " pago " + dataBr(v.pago_em) : ""}${v.fonte === "cobranca" ? " (sem repasse)" : ""}`).map(h).join(" · ")}</small></li>`).join("")}</ul></div>
            </details>`).join("") : `<div class="panel"><p class="muted-text fiscal-vazio">Nenhuma locação administrada com pagamento no ano.</p></div>`}
          ${inter.length ? `<div class="panel fiscal-fora"><h3 class="fiscal-h3">Locações só intermediadas (sem administração no sistema) — fora até decisão</h3>
            <p class="muted-text">O aluguel destas não passa pela imobiliária. Decida com o contador: incluir todas (Configurações do módulo) ou uma a uma (Ficha fiscal → Incluir).</p>
            <table class="crm-tabela fin-tabela"><thead><tr><th>Data</th><th>Negócio</th><th>Valor</th><th>Comissão</th><th></th></tr></thead><tbody>
            ${inter.filter(n => casa(busca, n.titulo)).map(n => `<tr><td>${h(dataBr(n.data))}</td><td>${h(n.titulo)}${n.motivo ? `<span class="fin-sub">${h(n.motivo)}</span>` : ""}</td><td>${h(reais(n.valor))}</td><td>${h(reais(n.comissao))}</td>
              <td><button type="button" class="secondary-button fin-mini" data-fiscal-ficha="negociacao|${h(n.origem_id)}">Ficha fiscal</button></td></tr>`).join("")}</tbody></table></div>` : ""}`;
    }
    function htmlPendencias() {
        const grupos = new Map();
        apur.pendencias.forEach(p => {
            const k = p.origem ? p.origem.origem_tipo + "|" + p.origem.origem_id : "geral";
            if (!grupos.has(k)) grupos.set(k, { origem: p.origem, itens: [] });
            grupos.get(k).itens.push(p);
        });
        if (!grupos.size) return `<div class="panel"><p class="muted-text fiscal-vazio">Nenhuma pendência. Confira o relatório com o contador antes de gerar o arquivo.</p></div>`;
        const peso = g => g.itens.some(i => i.nivel === "erro") ? 0 : g.itens.some(i => i.nivel === "alerta") ? 1 : 2;
        const lista = [ ...grupos.values() ].sort((a, b) => (a.origem ? 1 : 0) - (b.origem ? 1 : 0) || peso(a) - peso(b));
        return `<p class="muted-text">Vermelho impede o arquivo. Amarelo é para conferir. Azul é só informação. Nada é preenchido sozinho: o que falta aparece aqui.</p>
          ${lista.map(g => `<div class="panel fiscal-pend"><header><strong>${h(g.origem ? g.origem.titulo || "Operação" : "Empresa declarante e cadastros gerais")}</strong>
            ${g.origem ? `<button type="button" class="secondary-button fin-mini" data-fiscal-ficha="${h(g.origem.origem_tipo)}|${h(g.origem.origem_id)}">Corrigir na ficha fiscal</button>` : `<button type="button" class="secondary-button fin-mini" data-fiscal-acao="geral">Corrigir</button>`}</header>
            <ul>${g.itens.slice().sort((a, b) => ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]).map(i => `<li class="fiscal-nivel-${h(i.nivel)}">${h(i.texto)}</li>`).join("")}</ul></div>`).join("")}`;
    }
    function htmlHistorico() {
        const lista = dados.historico || [];
        return `<p class="muted-text">Cada conferência e cada arquivo ficam guardados com a impressão digital (SHA-256). Gerar de novo cria outro registro; os anteriores não mudam.</p>
          <div class="panel table-panel">${lista.length ? `<table class="crm-tabela fin-tabela"><thead><tr><th>Quando</th><th>Tipo</th><th>CNPJ</th><th>Registros</th><th>Pendências</th><th>Quem</th><th>SHA-256</th><th></th></tr></thead><tbody>
            ${lista.map(e => `<tr><td>${h(new Date(e.created_at).toLocaleString("pt-BR"))}</td><td>${e.tipo === "arquivo" ? "Arquivo .txt" : "Conferência"}${e.retificadora ? " (retificadora)" : ""}<span class="fin-sub">${h(e.gerador_versao || "")}${e.leiaute_versao ? " · " + h(e.leiaute_versao) : ""}</span></td>
              <td>${h(docFmt(e.cnpj))}</td><td>${h(e.registros)}</td><td>${h(e.pendencias)} / ${h(e.alertas)} alerta(s)</td><td>${h(e.gerado_por || "—")}</td><td><code class="fiscal-hash">${h(String(e.sha256 || "").slice(0, 16))}…</code></td>
              <td>${e.tipo === "arquivo" ? `<button type="button" class="secondary-button fin-mini" data-fiscal-baixar="${h(e.id)}">Baixar de novo</button>` : ""}</td></tr>`).join("")}
          </tbody></table>` : `<p class="muted-text fiscal-vazio">Nada gerado para ${apur.ano} ainda.</p>`}</div>`;
    }

    // ------------------------------------------------------------------ diálogos (criados aqui, para não mexer no index de cada cópia além do mínimo)
    function montarDialogos() {
        const div = document.createElement("div");
        div.innerHTML = `
  <dialog id="fiscalDeclDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
    <button class="dialog-close" type="button" value="cancel">×</button>
    <span class="eyebrow">FISCAL · DIMOB</span><h2>Empresa declarante e configurações</h2>
    <p class="muted-text">A declarante é a empresa (CNPJ da matriz) que entrega a DIMOB. O código do município sai sozinho da tabela oficial do programa da Receita (não é o do IBGE); preencha só se quiser outro.</p>
    <div class="fin-grade">
      <label>CNPJ<input id="fdCnpj" inputmode="numeric" autocomplete="off" /></label>
      <label class="fiscal-larga">Nome empresarial<input id="fdNome" autocomplete="off" /></label>
      <label>CPF do responsável<input id="fdCpf" inputmode="numeric" autocomplete="off" /></label>
      <label class="fiscal-larga">Endereço<input id="fdEnd" autocomplete="off" /></label>
      <label>Cidade<input id="fdCidade" autocomplete="off" /></label>
      <label>UF<input id="fdUf" maxlength="2" autocomplete="off" /></label>
      <label>Código do município (Receita)<input id="fdMun" inputmode="numeric" autocomplete="off" placeholder="automático pela tabela" /></label>
    </div>
    <div class="dialog-actions"><button id="fdSalvar" type="button" class="primary-button">Salvar empresa</button></div>
    <div id="fdMsg" class="form-message" hidden></div>
    <hr class="fiscal-hr" />
    <h3 class="fiscal-h3">Como apurar (decisões do contador)</h3>
    <label class="fiscal-check"><input id="fcEncargos" type="checkbox" /> Somar encargos repassados (IPTU, condomínio etc.) ao aluguel declarado</label>
    <label class="fiscal-check"><input id="fcInter" type="checkbox" /> Incluir locações só intermediadas (sem administração) — comissão no mês do fechamento</label>
    <label>Fuso das datas dos negócios<select id="fcFuso"><option value="America/Sao_Paulo">Brasília</option><option value="America/Cuiaba">Mato Grosso / Mato Grosso do Sul</option><option value="America/Manaus">Amazonas</option><option value="America/Porto_Velho">Rondônia</option><option value="America/Rio_Branco">Acre</option><option value="America/Belem">Pará / Amapá</option><option value="America/Fortaleza">Nordeste</option><option value="America/Noronha">Fernando de Noronha</option></select></label>
    <div class="dialog-actions"><button id="fcSalvar" type="button" class="secondary-button">Salvar configurações</button></div>
    <div id="fcMsg" class="form-message" hidden></div>
    <hr class="fiscal-hr" />
    <h3 class="fiscal-h3">Códigos de município dos imóveis</h3>
    <p class="muted-text">Vêm da tabela oficial do PGD pelo nome da cidade. Informe aqui só a cidade que não for encontrada (nome diferente) ou para corrigir.</p>
    <div id="fmLista"></div>
    <div class="fin-grade"><label>Cidade<input id="fmCidade" autocomplete="off" /></label><label>UF<input id="fmUf" maxlength="2" autocomplete="off" /></label>
      <label>Código (Receita)<input id="fmCodigo" inputmode="numeric" autocomplete="off" /></label></div>
    <div class="dialog-actions"><button id="fmSalvar" type="button" class="secondary-button">Salvar código</button></div>
    <div id="fmMsg" class="form-message" hidden></div>
  </form></dialog>

  <dialog id="fiscalOpDialog" class="crm-dialog crm-dialog-larga"><form method="dialog" class="dialog-card">
    <button class="dialog-close" type="button" value="cancel">×</button>
    <span class="eyebrow">FICHA FISCAL · DIMOB</span><h2 id="foTitulo">Operação</h2>
    <p class="muted-text">Esta ficha só complementa a DIMOB. O negócio, o contrato e o cadastro dos clientes não mudam.</p>
    <div id="foPend"></div>
    <div class="fin-grade">
      <label>Tipo<select id="foTipo"><option value="">Automático</option><option value="intermediacao_venda">Intermediação de venda</option><option value="venda_propria">Venda própria (construção/incorporação/loteamento)</option><option value="locacao">Locação</option></select></label>
      <label>Na DIMOB<select id="foIncluir"><option value="auto">Automático</option><option value="sim">Incluir</option><option value="nao">Deixar fora</option></select></label>
      <label class="fiscal-larga" id="foMotivoBox">Motivo de deixar fora<input id="foMotivo" autocomplete="off" placeholder="Ex.: distrato com devolução integral" /></label>
      <label>Nº do contrato<input id="foNumero" autocomplete="off" placeholder="opcional" /></label>
      <label>Data do contrato<input id="foData" type="date" /></label>
      <label>Participação desta imobiliária (%)<input id="foPart" inputmode="decimal" placeholder="100" /></label>
      <label>Valor da operação (se diferente)<input id="foValor" inputmode="decimal" placeholder="usa o do negócio" /></label>
      <label>Comissão (se diferente)<input id="foComissao" inputmode="decimal" placeholder="usa a do negócio" /></label>
      <label id="foPagoBox">Valor pago no ano (venda própria)<input id="foPago" inputmode="decimal" /></label>
    </div>
    <details class="fiscal-det"><summary>Imóvel (se o cadastro estiver incompleto)</summary>
      <div class="fin-grade">
        <label class="fiscal-larga">Endereço<input id="foEnd" autocomplete="off" /></label>
        <label>CEP<input id="foCep" inputmode="numeric" autocomplete="off" /></label>
        <label>Cidade<input id="foCidade" autocomplete="off" /></label>
        <label>UF<input id="foUf" maxlength="2" autocomplete="off" /></label>
        <label>Zona<select id="foRural"><option value="">Do cadastro</option><option value="false">Urbano</option><option value="true">Rural</option></select></label>
      </div></details>
    <div id="foPartes"></div>
    <label>Observação<input id="foObs" autocomplete="off" /></label>
    <div class="dialog-actions"><button id="foSalvar" type="button" class="primary-button">Salvar ficha</button></div>
    <div id="foMsg" class="form-message" hidden></div>
  </form></dialog>

  <dialog id="fiscalAjDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
    <button class="dialog-close" type="button" value="cancel">×</button>
    <span class="eyebrow">AJUSTE MENSAL · DIMOB</span><h2 id="faTitulo">Ajustes</h2>
    <p class="muted-text">Use para imposto retido pelo inquilino pessoa jurídica, estornos ou correções. O valor é SOMADO ao apurado no mês (negativo para reduzir). Motivo obrigatório.</p>
    <div id="faLista"></div>
    <div class="fin-grade">
      <label>Mês<select id="faMes">${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select></label>
      <label>Campo<select id="faCampo">${Object.entries(CAMPOS_AJUSTE).map(([ k, v ]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Valor (R$)<input id="faValor" inputmode="decimal" /></label>
      <label class="fiscal-larga">Motivo<input id="faMotivo" autocomplete="off" /></label>
    </div>
    <div class="dialog-actions"><button id="faSalvar" type="button" class="primary-button">Lançar ajuste</button></div>
    <div id="faMsg" class="form-message" hidden></div>
  </form></dialog>
  <dialog id="fiscalGerarDialog" class="crm-dialog"><form method="dialog" class="dialog-card">
    <button class="dialog-close" type="button" value="cancel">×</button>
    <span class="eyebrow">ARQUIVO DE IMPORTAÇÃO · DIMOB</span><h2>Gerar arquivo .txt</h2>
    <p class="muted-text">${h(AVISO)}</p>
    <div id="fgResumo" class="fiscal-aviso"></div>
    <label class="fiscal-check"><input id="fgRetif" type="checkbox" /> Declaração retificadora</label>
    <label id="fgReciboBox" hidden>Número do recibo da declaração anterior<input id="fgRecibo" inputmode="numeric" maxlength="10" autocomplete="off" /></label>
    <label class="fiscal-check"><input id="fgSitEsp" type="checkbox" /> Situação especial (extinção, fusão, incorporação ou cisão total)</label>
    <div id="fgSitBox" class="fin-grade" hidden>
      <label>Evento<select id="fgSitCod"><option value="01">Extinção</option><option value="02">Fusão</option><option value="03">Incorporação / Incorporada</option><option value="04">Cisão total</option></select></label>
      <label>Data do evento<input id="fgSitData" type="date" /></label>
    </div>
    <div class="dialog-actions"><button id="fgConfirmar" type="button" class="primary-button">Gerar e baixar</button></div>
    <div id="fgMsg" class="form-message" hidden></div>
  </form></dialog>
  <div id="fiscalRelatorio" class="fiscal-relatorio" hidden></div>`;
        while (div.firstElementChild) document.body.appendChild(div.firstElementChild);
        document.querySelectorAll("#fiscalDeclDialog .dialog-close, #fiscalOpDialog .dialog-close, #fiscalAjDialog .dialog-close, #fiscalGerarDialog .dialog-close")
            .forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
    }

    function ligarEventos() {
        document.querySelectorAll("[data-fiscal-aba]").forEach(b => b.addEventListener("click", () => { aba = b.dataset.fiscalAba; render(); }));
        $("fiscalAno").addEventListener("change", () => { dados = null; carregar(); });
        $("fiscalDeclarante").addEventListener("change", () => dados && apurar());
        $("fiscalAtualizar").addEventListener("click", () => { dados = null; carregar(); });
        $("fiscalBusca").addEventListener("input", e => { busca = e.target.value; render(); });
        $("fiscalEmpresa").addEventListener("click", abrirDeclarante);
        $("fiscalRelatorioBtn").addEventListener("click", relatorio);
        $("fiscalCsv").addEventListener("click", planilha);
        $("fiscalGerar").addEventListener("click", abrirGerar);
        $("fgRetif").addEventListener("change", () => { $("fgReciboBox").hidden = !$("fgRetif").checked; });
        $("fgSitEsp").addEventListener("change", () => { $("fgSitBox").hidden = !$("fgSitEsp").checked; });
        $("fgConfirmar").addEventListener("click", gerarArquivo);
        $("fiscalConteudo").addEventListener("click", e => {
            const f = e.target.closest("[data-fiscal-ficha]"); if (f) { const [ t, id ] = f.dataset.fiscalFicha.split("|"); return abrirFicha(t, id); }
            const a = e.target.closest("[data-fiscal-ajuste]"); if (a) { const [ t, id ] = a.dataset.fiscalAjuste.split("|"); return abrirAjustes(t, id); }
            const b = e.target.closest("[data-fiscal-baixar]"); if (b) return baixarDeNovo(b.dataset.fiscalBaixar);
            if (e.target.closest("[data-fiscal-acao=geral]")) abrirDeclarante();
        });
        $("fdSalvar").addEventListener("click", salvarDeclarante);
        $("fcSalvar").addEventListener("click", salvarConfig);
        $("fmSalvar").addEventListener("click", () => salvarMunicipio($("fmCidade").value, $("fmUf").value, $("fmCodigo").value));
        $("fmLista").addEventListener("click", e => {
            const b = e.target.closest("[data-fm-usar]"); if (!b) return;
            const [ cidade, uf ] = b.dataset.fmUsar.split("|"); $("fmCidade").value = cidade; $("fmUf").value = uf; $("fmCodigo").focus();
        });
        $("foIncluir").addEventListener("change", ajustarFicha);
        $("foTipo").addEventListener("change", ajustarFicha);
        $("foSalvar").addEventListener("click", salvarFicha);
        $("foPartes").addEventListener("click", e => {
            const add = e.target.closest("[data-fo-add]");
            if (add) { lerPartes(); const papel = add.dataset.foAdd; opAberta.partes[papel].push({ nome: "", documento: "", percentual: "" }); opAberta.sujo[papel] = true; desenharPartes(); return; }
            const rem = e.target.closest("[data-fo-rem]");
            if (rem) { const [ papel, i ] = rem.dataset.foRem.split("|"); lerPartes(); opAberta.partes[papel].splice(Number(i), 1); opAberta.sujo[papel] = true; desenharPartes(); }
        });
        $("foPartes").addEventListener("input", e => { const r = e.target.closest("[data-fo-papel]"); if (r) opAberta.sujo[r.dataset.foPapel] = true; });
        $("faSalvar").addEventListener("click", salvarAjuste);
        $("faLista").addEventListener("click", async e => {
            const b = e.target.closest("[data-fa-del]"); if (!b) return;
            if (!confirm("Excluir este ajuste?")) return;
            const { error } = await ctx.sb.rpc("dimob_excluir_ajuste", { p_id: b.dataset.faDel });
            if (error) return msg($("faMsg"), erro(error));
            await carregar(); desenharAjustes();
        });
    }

    // ------------------------------------------------------------------ empresa, configurações e municípios
    function abrirDeclarante() {
        const d = declaranteSel() || {};
        $("fdCnpj").value = d.cnpj ? docFmt(d.cnpj) : ""; $("fdNome").value = d.nome_empresarial || ""; $("fdCpf").value = d.cpf_responsavel ? docFmt(d.cpf_responsavel) : "";
        $("fdEnd").value = d.endereco || ""; $("fdCidade").value = d.municipio_nome || ""; $("fdUf").value = d.uf || ""; $("fdMun").value = d.municipio_codigo || "";
        const cfg = dados.config || {};
        $("fcEncargos").checked = !!cfg.incluir_encargos; $("fcInter").checked = !!cfg.incluir_locacao_intermediada; $("fcFuso").value = cfg.fuso || "America/Sao_Paulo";
        [ "fdMsg", "fcMsg", "fmMsg" ].forEach(id => msg($(id), ""));
        desenharMunicipios();
        $("fiscalDeclDialog").showModal();
    }
    function desenharMunicipios() {
        const faltam = apur.pendencias.filter(p => p.campo && p.campo.startsWith("municipio:")).map(p => p.campo.slice(10).split("|"));
        const tem = dados.municipios || [];
        $("fmLista").innerHTML = `${tem.length ? `<ul class="fiscal-lista">${tem.map(m => `<li>${h(m.cidade)}/${h(m.uf)}: <strong>${h(m.codigo)}</strong> <button type="button" class="text-button" data-fm-usar="${h(m.cidade)}|${h(m.uf)}">alterar</button></li>`).join("")}</ul>` : ""}
          ${faltam.length ? `<p class="fin-txt-alerta">Faltam: ${faltam.map(([ uf, c ]) => `<button type="button" class="text-button" data-fm-usar="${h(c)}|${h(uf)}">${h(c)}/${h(uf)}</button>`).join(", ")}</p>` : ""}`;
    }
    async function salvarDeclarante() {
        const d = declaranteSel();
        const { error } = await ctx.sb.rpc("dimob_salvar_declarante", { p: { id: d && d.id || null, carteira_id: ctx.carteiraId(), cnpj: $("fdCnpj").value,
            nome_empresarial: $("fdNome").value, cpf_responsavel: $("fdCpf").value, endereco: $("fdEnd").value, municipio_nome: $("fdCidade").value,
            uf: $("fdUf").value.trim().toUpperCase(), municipio_codigo: $("fdMun").value.replace(/\D/g, "") } });
        if (error) return msg($("fdMsg"), erro(error));
        msg($("fdMsg"), "Empresa salva.", true);
        await carregar(); desenharMunicipios();
    }
    async function salvarConfig() {
        const { error } = await ctx.sb.rpc("dimob_salvar_config", { p_carteira: ctx.carteiraId(), p: { fuso: $("fcFuso").value,
            incluir_encargos: $("fcEncargos").checked, incluir_locacao_intermediada: $("fcInter").checked } });
        if (error) return msg($("fcMsg"), erro(error));
        msg($("fcMsg"), "Configurações salvas.", true);
        await carregar();
    }
    async function salvarMunicipio(cidade, uf, codigo) {
        const { error } = await ctx.sb.rpc("dimob_salvar_municipio", { p_carteira: ctx.carteiraId(), p_cidade: cidade, p_uf: String(uf || "").trim().toUpperCase(), p_codigo: codigo });
        if (error) return msg($("fmMsg"), erro(error));
        msg($("fmMsg"), "Código salvo.", true); $("fmCidade").value = ""; $("fmUf").value = ""; $("fmCodigo").value = "";
        await carregar(); desenharMunicipios();
    }

    // ------------------------------------------------------------------ ficha fiscal da operação
    function fatoDe(tipo, id) {
        if (tipo === "contrato") return (dados.contratos || []).find(c => c.origem_id === id);
        return (dados.vendas || []).find(v => v.origem_id === id) || (dados.locacoes_intermediadas || []).find(v => v.origem_id === id);
    }
    function abrirFicha(tipo, id) {
        const f = fatoDe(tipo, id);
        if (!f) return ctx.toast("Operação não encontrada neste ano.");
        const venda = f.finalidade === "venda";
        const papeis = venda ? [ "comprador", "vendedor" ] : [ "locador", "locatario" ];
        const doCad = { comprador: f.cadastro && f.cadastro.cliente, vendedor: f.cadastro && f.cadastro.proprietario,
            locador: f.cadastro && (f.cadastro.locador || f.cadastro.proprietario), locatario: f.cadastro && (f.cadastro.locatario || f.cadastro.cliente) };
        const partes = {}, sujo = {};
        papeis.forEach(p => {
            const salvas = (f.partes || []).filter(x => x.papel === p);
            partes[p] = salvas.length ? salvas.map(x => ({ nome: x.nome, documento: x.documento ? docFmt(x.documento) : "", percentual: paraCampo(x.percentual), cliente_id: x.cliente_id }))
                : (doCad[p] && doCad[p].nome ? [ { nome: doCad[p].nome, documento: doCad[p].documento ? docFmt(doCad[p].documento) : "", percentual: "100", cliente_id: doCad[p].id } ] : []);
            sujo[p] = false;
        });
        opAberta = { tipo, id, f, papeis, partes, sujo, salvas: new Set((f.partes || []).map(x => x.papel)) };
        $("foTitulo").textContent = f.titulo || (f.numero != null ? "Contrato nº " + f.numero : "Operação");
        $("foTipo").value = f.tipo_operacao || ""; $("foIncluir").value = f.incluir || "auto"; $("foMotivo").value = f.motivo_exclusao || "";
        $("foNumero").value = f.numero_contrato || ""; $("foData").value = f.data_contrato || "";
        $("foData").placeholder = ""; $("foData").title = "Vazio = data do " + (tipo === "contrato" ? "início do contrato (" + dataBr(f.inicio) + ")" : "fechamento (" + dataBr(f.data_ref) + ")");
        $("foPart").value = f.participacao_pct != null && Number(f.participacao_pct) !== 100 ? paraCampo(f.participacao_pct) : "";
        $("foValor").value = paraCampo(f.valor_operacao); $("foComissao").value = paraCampo(f.comissao); $("foPago").value = paraCampo(f.valor_pago_ano);
        const im = f.imovel || {};
        $("foEnd").value = im.informado_manual ? im.logradouro || "" : ""; $("foEnd").placeholder = im.logradouro || "não informado";
        $("foCep").value = ""; $("foCep").placeholder = im.cep || ""; $("foCidade").value = ""; $("foCidade").placeholder = im.cidade || "";
        $("foUf").value = ""; $("foUf").placeholder = im.uf || ""; $("foRural").value = "";
        $("foObs").value = f.observacao || "";
        const contrato = tipo === "contrato";
        [ "foPart", "foValor", "foComissao" ].forEach(i => { $(i).closest("label").hidden = contrato; });
        const p = pendDe(tipo, id);
        $("foPend").innerHTML = p.length ? `<ul class="fiscal-lista">${p.map(i => `<li class="fiscal-nivel-${h(i.nivel)}">${h(i.texto)}</li>`).join("")}</ul>` : "";
        msg($("foMsg"), "");
        ajustarFicha(); desenharPartes();
        $("fiscalOpDialog").showModal();
    }
    function ajustarFicha() {
        $("foMotivoBox").hidden = $("foIncluir").value !== "nao";
        $("foPagoBox").hidden = $("foTipo").value !== "venda_propria";
    }
    function lerPartes() {
        document.querySelectorAll("#foPartes [data-fo-papel]").forEach(row => {
            const papel = row.dataset.foPapel, i = Number(row.dataset.foI);
            const item = opAberta.partes[papel][i]; if (!item) return;
            item.nome = row.querySelector("[data-k=nome]").value; item.documento = row.querySelector("[data-k=doc]").value; item.percentual = row.querySelector("[data-k=pct]").value;
        });
    }
    function desenharPartes() {
        $("foPartes").innerHTML = opAberta.papeis.map(papel => `<div class="fiscal-partes"><h3 class="fiscal-h3">${h(PAPEIS[papel])}${opAberta.salvas.has(papel) ? "" : ` <small class="muted-text">(do cadastro — ao alterar, fica só na DIMOB)</small>`}</h3>
          ${opAberta.partes[papel].map((p, i) => `<div class="fiscal-parte" data-fo-papel="${papel}" data-fo-i="${i}">
            <input data-k="nome" placeholder="Nome completo" value="${h(p.nome)}" autocomplete="off" />
            <input data-k="doc" placeholder="CPF ou CNPJ" value="${h(p.documento)}" inputmode="numeric" autocomplete="off" />
            <input data-k="pct" placeholder="%" value="${h(p.percentual)}" inputmode="decimal" class="fiscal-pct" />
            <button type="button" class="text-button" data-fo-rem="${papel}|${i}" title="Remover">✕</button></div>`).join("") || `<p class="fin-txt-alerta">Ninguém informado.</p>`}
          <button type="button" class="text-button" data-fo-add="${papel}">+ adicionar ${h(PAPEIS[papel].split(" ")[0].toLowerCase())}</button></div>`).join("");
    }
    async function salvarFicha() {
        lerPartes();
        const num = id => { const v = valorTexto($(id).value); if (Number.isNaN(v)) throw new Error("Valor inválido em " + $(id).closest("label").textContent.trim()); return v; };
        let p;
        try {
            p = { origem_tipo: opAberta.tipo, origem_id: opAberta.id, tipo_operacao: $("foTipo").value || null, incluir: $("foIncluir").value,
                motivo_exclusao: $("foMotivo").value, numero_contrato: $("foNumero").value, data_contrato: $("foData").value || null,
                participacao_pct: num("foPart"), valor_operacao: num("foValor"), comissao: num("foComissao"), valor_pago_ano: num("foPago"),
                imovel_logradouro: $("foEnd").value, imovel_cep: $("foCep").value, imovel_cidade: $("foCidade").value, imovel_uf: $("foUf").value.trim().toUpperCase(),
                imovel_rural: $("foRural").value || null, observacao: $("foObs").value };
            const mudados = opAberta.papeis.filter(papel => opAberta.sujo[papel]);
            if (mudados.length) {
                p.partes_papeis = mudados;
                p.partes = [];
                mudados.forEach(papel => opAberta.partes[papel].forEach((x, i) => {
                    if (!String(x.nome || "").trim() && !String(x.documento || "").trim()) return;
                    const pct = valorTexto(x.percentual || "100");
                    if (Number.isNaN(pct)) throw new Error("Percentual inválido para " + (x.nome || PAPEIS[papel]));
                    p.partes.push({ papel, ordem: i + 1, nome: x.nome, documento: x.documento, percentual: pct, cliente_id: x.cliente_id || null });
                }));
                const doc = p.partes.find(x => x.documento && !M().docValido(x.documento));
                if (doc) throw new Error(`CPF/CNPJ inválido: ${doc.nome}`);
                mudados.forEach(papel => {
                    const lista = p.partes.filter(x => x.papel === papel);
                    const soma = lista.reduce((s, x) => s + Number(x.percentual), 0);
                    if (lista.length && Math.abs(soma - 100) > 0.0001) throw new Error(`As participações de ${PAPEIS[papel].toLowerCase()} somam ${String(soma).replace(".", ",")}% — precisam dar 100%.`);
                });
            }
        } catch (e) { return msg($("foMsg"), e.message); }
        $("foSalvar").disabled = true;
        const { error } = await ctx.sb.rpc("dimob_salvar_operacao", { p });
        $("foSalvar").disabled = false;
        if (error) return msg($("foMsg"), erro(error));
        $("fiscalOpDialog").close();
        ctx.toast("Ficha fiscal salva.");
        await carregar();
    }

    // ------------------------------------------------------------------ ajustes mensais
    function abrirAjustes(tipo, id) {
        const f = fatoDe(tipo, id);
        ajusteAlvo = { tipo, id, titulo: f ? f.titulo || (f.numero != null ? "Contrato nº " + f.numero : "") : "" };
        $("faTitulo").textContent = "Ajustes — " + ajusteAlvo.titulo;
        $("faValor").value = ""; $("faMotivo").value = ""; msg($("faMsg"), "");
        desenharAjustes();
        $("fiscalAjDialog").showModal();
    }
    function desenharAjustes() {
        if (!ajusteAlvo) return;
        const lista = (dados.ajustes || []).filter(a => a.origem_tipo === ajusteAlvo.tipo && a.origem_id === ajusteAlvo.id);
        $("faLista").innerHTML = lista.length ? `<ul class="fiscal-lista">${lista.map(a => `<li>${MESES[a.mes - 1]}: ${h(CAMPOS_AJUSTE[a.campo])} ${h(reais(M().centavos(a.valor)))} — ${h(a.motivo)}
            <button type="button" class="text-button" data-fa-del="${h(a.id)}">excluir</button></li>`).join("")}</ul>` : `<p class="muted-text">Nenhum ajuste em ${apur.ano}.</p>`;
    }
    async function salvarAjuste() {
        const v = valorTexto($("faValor").value);
        if (v == null || Number.isNaN(v)) return msg($("faMsg"), "Informe o valor.");
        const { error } = await ctx.sb.rpc("dimob_salvar_ajuste", { p: { origem_tipo: ajusteAlvo.tipo, origem_id: ajusteAlvo.id, ano: apur.ano,
            mes: Number($("faMes").value), campo: $("faCampo").value, valor: v, motivo: $("faMotivo").value } });
        if (error) return msg($("faMsg"), erro(error));
        msg($("faMsg"), "Ajuste lançado.", true); $("faValor").value = ""; $("faMotivo").value = "";
        await carregar(); desenharAjustes();
    }

    // ------------------------------------------------------------------ relatório de conferência, planilha e arquivo
    function projecaoParaGuardar() {
        return { versao_motor: apur.versao_motor, ano: apur.ano, declarante: apur.declarante && { cnpj: apur.declarante.cnpj, nome_empresarial: apur.declarante.nome_empresarial },
            totais: apur.totais, vendas: apur.vendas, locacoes: apur.locacoes, pendencias: apur.pendencias };
    }
    const totaisResumo = () => ({ vendas: apur.totais.vendas, valor_vendas: apur.totais.valor_vendas, comissao_vendas: apur.totais.comissao_vendas,
        locacoes: apur.totais.locacoes, rendimento_ano: apur.totais.rendimento_ano, comissao_locacao_ano: apur.totais.comissao_locacao_ano, imposto_ano: apur.totais.imposto_ano });
    async function registrar(tipo, extra) {
        const d = declaranteSel();
        if (!d) throw new Error("Cadastre a empresa declarante primeiro (botão Empresa e configurações).");
        const { data, error } = await ctx.sb.rpc("dimob_registrar_exportacao", { p: Object.assign({ carteira_id: ctx.carteiraId(), declarante_id: d.id, ano: apur.ano, tipo,
            gerador_versao: GERADOR + " / " + apur.versao_motor, registros: apur.totais.registros_venda + apur.locacoes.length,
            pendencias: apur.erros, alertas: apur.alertas, totais: totaisResumo(), projecao: projecaoParaGuardar() }, extra || {}) });
        if (error) throw error;
        return data;
    }
    async function relatorio() {
        if (!apur) return;
        let reg = null;
        try { reg = await registrar("conferencia"); } catch (e) { ctx.toast(erro(e)); }
        const d = apur.declarante, t = apur.totais;
        const el = $("fiscalRelatorio");
        el.innerHTML = `<div class="fiscal-rel">
          <header><h1>Relatório de conferência — DIMOB ${apur.ano}</h1>
            <p><strong>${h(d ? d.nome_empresarial : "Sem empresa declarante")}</strong>${d ? " · CNPJ " + h(docFmt(d.cnpj)) : ""} · ${h(ctx.carteiraNome())}</p>
            <p class="fiscal-rel-aviso">Documento interno para conferência com o contador. NÃO é comprovante da Receita Federal. ${h(AVISO)}</p>
            <p>Gerado em ${h(new Date().toLocaleString("pt-BR"))} por ${h((ctx.usuario() || {}).display_name || "")} · ${h(GERADOR)} · ${h(apur.versao_motor)}${reg ? ` · SHA-256 ${h(reg.sha256)}` : ""}</p></header>
          <h2>Totais</h2>
          <table><tr><td>Vendas/intermediações</td><td>${t.vendas} (${t.registros_venda} registro(s))</td><td>Valor</td><td>${h(reais(t.valor_vendas))}</td><td>Comissão</td><td>${h(reais(t.comissao_vendas))}</td></tr>
            <tr><td>Locações</td><td>${t.locacoes}</td><td>Aluguéis</td><td>${h(reais(t.rendimento_ano))}</td><td>Comissão/taxa</td><td>${h(reais(t.comissao_locacao_ano))}</td></tr>
            <tr><td>Imposto retido</td><td colspan="5">${h(reais(t.imposto_ano))}</td></tr></table>
          <h2>Vendas e intermediações (ano da celebração)</h2>
          ${apur.vendas.length ? `<table><thead><tr><th>Data</th><th>Imóvel</th><th>Vendedor</th><th>Comprador</th><th>Part.</th><th>Valor</th><th>Comissão</th></tr></thead><tbody>
            ${apur.vendas.map(v => v.registros.map(r => `<tr><td>${h(dataBr(v.data_contrato))}</td><td>${h([ v.imovel.codigo, v.imovel.nome, v.imovel.logradouro, v.imovel.cidade && v.imovel.cidade + "/" + v.imovel.uf ].filter(Boolean).join(" · "))}</td>
              <td>${h(r.vendedor.nome)}<br>${h(docFmt(r.vendedor.documento))}</td><td>${h(r.comprador.nome)}<br>${h(docFmt(r.comprador.documento))}</td><td>${h(String(Math.round(r.participacao_pct * 100) / 100).replace(".", ","))}%</td>
              <td>${h(reais(r.valor))}</td><td>${h(reais(r.comissao))}</td></tr>`).join("")).join("")}</tbody></table>` : "<p>Nenhuma.</p>"}
          <h2>Locações (mês do pagamento)</h2>
          ${apur.locacoes.length ? apur.locacoes.map(g => `<div class="fiscal-rel-loc"><p><strong>${h(g.locador.nome)}</strong> (${h(docFmt(g.locador.documento))}) → ${h(g.locatario.nome)} (${h(docFmt(g.locatario.documento))}) ·
              ${h([ g.imovel.codigo, g.imovel.logradouro, g.imovel.cidade && g.imovel.cidade + "/" + g.imovel.uf ].filter(Boolean).join(" · "))} · contrato ${h(g.numero_contrato || "s/nº")} de ${h(dataBr(g.data_contrato))}</p>
              ${tabelaMeses([ [ "Aluguel", g.meses.rendimento ], [ "Comissão", g.meses.comissao ], [ "Imposto retido", g.meses.imposto_retido ] ])}</div>`).join("") : "<p>Nenhuma.</p>"}
          <h2>Pendências e alertas</h2>
          ${apur.pendencias.length ? `<ul>${apur.pendencias.map(p => `<li>[${h(p.nivel)}] ${h(p.origem ? p.origem.titulo + ": " : "")}${h(p.texto)}</li>`).join("")}</ul>` : "<p>Nenhuma.</p>"}
        </div>`;
        el.hidden = false;
        document.body.classList.add("imprimindo-fiscal");
        const fim = () => { document.body.classList.remove("imprimindo-fiscal"); el.hidden = true; };
        if (window.NativeBridge && typeof window.NativeBridge.printPage === "function") { window.NativeBridge.printPage(); setTimeout(fim, 4000); }
        else { window.addEventListener("afterprint", fim, { once: true }); window.print(); setTimeout(fim, 1500); }
        if (reg) { dados = null; carregar(); }
    }
    function salvarArquivo(nome, bytes, tipo) {
        if (window.NativeBridge && typeof window.NativeBridge.saveTextFile === "function") {
            let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); });
            window.NativeBridge.saveTextFile(btoa(bin), nome, tipo);
            return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([ bytes ], { type: tipo }));
        a.download = nome;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function planilha() {
        if (!apur) return;
        const esc = v => { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const r = c => c == null ? "" : (c / 100).toFixed(2).replace(".", ",");
        const linhas = [ [ "Tipo", "Data do contrato", "Nº", "Imóvel", "Endereço", "Cidade/UF", "Código município", "Vendedor/Locador", "CPF/CNPJ", "Comprador/Locatário", "CPF/CNPJ", "Participação %", "Valor", "Comissão", ...MESES.map(m => "Aluguel " + m), ...MESES.map(m => "Comissão " + m), ...MESES.map(m => "IR " + m) ] ];
        apur.vendas.forEach(v => v.registros.forEach(x => linhas.push([ v.tipo_operacao === "venda_propria" ? "Venda própria" : "Intermediação de venda", dataBr(v.data_contrato), v.numero_contrato || "",
            v.imovel.nome || "", v.imovel.logradouro || "", v.imovel.cidade ? v.imovel.cidade + "/" + v.imovel.uf : "", v.imovel.municipio_codigo || "",
            x.vendedor.nome, docFmt(x.vendedor.documento), x.comprador.nome, docFmt(x.comprador.documento), String(x.participacao_pct).replace(".", ","), r(x.valor), r(x.comissao) ])));
        apur.locacoes.forEach(g => linhas.push([ "Locação", dataBr(g.data_contrato), g.numero_contrato || "", g.imovel.nome || "", g.imovel.logradouro || "",
            g.imovel.cidade ? g.imovel.cidade + "/" + g.imovel.uf : "", g.imovel.municipio_codigo || "", g.locador.nome, docFmt(g.locador.documento), g.locatario.nome, docFmt(g.locatario.documento),
            String(g.locador.percentual).replace(".", ","), "", "", ...g.meses.rendimento.map(r), ...g.meses.comissao.map(r), ...g.meses.imposto_retido.map(r) ]));
        const texto = "﻿" + linhas.map(l => l.map(esc).join(";")).join("\r\n");
        salvarArquivo(`conferencia_dimob_${apur.ano}.csv`, new TextEncoder().encode(texto), "text/csv");
    }
    async function sha256(bytes) {
        if (!(window.crypto && crypto.subtle)) return null;
        const d = await crypto.subtle.digest("SHA-256", bytes);
        return [ ...new Uint8Array(d) ].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    function abrirGerar() {
        if (!apur) return;
        if (!leiauteOk()) return ctx.toast("O arquivo .txt ainda está bloqueado: o leiaute oficial de importação do programa da Receita precisa ser conferido. Use o relatório de conferência.");
        if (apur.erros) { aba = "pendencias"; render(); return ctx.toast("Corrija as pendências antes de gerar o arquivo."); }
        const t = apur.totais;
        $("fgResumo").innerHTML = `${h(apur.declarante.nome_empresarial)} · CNPJ ${h(docFmt(apur.declarante.cnpj))} · ano ${apur.ano}<br>
          ${t.locacoes} registro(s) de locação · ${t.registros_venda} registro(s) de venda${apur.alertas ? ` · <strong>${apur.alertas} alerta(s) para conferir</strong>` : ""}
          ${L().validadoPgd(leiauteVersao()) ? "" : `<br><strong>Leiaute transcrito do PGD ${h(leiauteVersao().replace("pgd-", ""))}, ainda AGUARDANDO VALIDAÇÃO NO PGD: importe e confira no programa da Receita antes de transmitir.</strong>`}`;
        $("fgRetif").checked = false; $("fgRecibo").value = ""; $("fgReciboBox").hidden = true;
        $("fgSitEsp").checked = false; $("fgSitData").value = ""; $("fgSitBox").hidden = true;
        msg($("fgMsg"), "");
        $("fiscalGerarDialog").showModal();
    }
    async function gerarArquivo() {
        const d = declaranteSel();
        const extra = { declarante: d, retificadora: $("fgRetif").checked, recibo: $("fgRecibo").value.replace(/\D/g, ""),
            situacao_especial: $("fgSitEsp").checked, codigo_situacao: $("fgSitCod").value, data_evento: $("fgSitData").value || null };
        $("fgConfirmar").disabled = true;
        try {
            const out = L().gerar(leiauteVersao(), apur, extra);
            const bytes = L().bytes(out.texto);
            const hash = await sha256(bytes);
            const reg = await registrar("arquivo", { leiaute_versao: leiauteVersao(), conteudo: out.texto, sha256: hash, retificadora: extra.retificadora, registros: out.linhas });
            salvarArquivo(`DIMOB_${d.cnpj}_${apur.ano}${extra.retificadora ? "_retificadora" : ""}.txt`, bytes, "text/plain");
            $("fiscalGerarDialog").close();
            ctx.toast("Arquivo gerado (SHA-256 " + String(reg.sha256).slice(0, 12) + "…). Importe no programa DIMOB da Receita e confira lá antes de transmitir.");
            dados = null; carregar();
        } catch (e) { msg($("fgMsg"), erro(e)); }
        finally { $("fgConfirmar").disabled = false; }
    }
    async function baixarDeNovo(id) {
        const { data, error } = await ctx.sb.rpc("dimob_baixar_exportacao", { p_id: id });
        if (error || !data || !data.conteudo) return ctx.toast(error ? erro(error) : "Arquivo não encontrado.");
        salvarArquivo(`DIMOB_${data.cnpj}_${data.ano}.txt`, L().bytes(data.conteudo), "text/plain");
    }

    window.SKLFiscal = { iniciar, sair, aoMostrar, temAba, render: renderAba };
})();
