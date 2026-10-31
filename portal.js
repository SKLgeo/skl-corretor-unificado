// Portal do cliente (inquilino e proprietário): entra pelo link pessoal que a Central envia (portal.html#t=<token>), sem conta nem senha.
// O token vai no "#" (não chega ao servidor da página nem ao Referer). Tudo é lido de uma vez pela RPC portal_dados(token);
// arquivos e fotos passam pela Edge Function portal-cliente. PIX = BR Code estático com a chave da imobiliária (pix.js).
(function () {
    "use strict";
    const CFG = window.SKL_PORTAL_CONFIG || {};
    const SUPA = CFG.supabase_url || "https://xigwlofqkmiibzbongkn.supabase.co";
    const ANON = CFG.anon_key || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpZ3dsb2Zxa21paWJ6Ym9uZ2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NzM3NzQsImV4cCI6MjEwNDA0OTc3NH0.USYZqjxQKZxV0Cj5ThaNirNuctJxMfXC6kPqPYK9fgc";
    const $ = id => document.getElementById(id);
    const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinheiro = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const data = d => d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "—";
    const mesAno = d => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—";
    const token = (new URLSearchParams(location.hash.slice(1)).get("t") || new URLSearchParams(location.search).get("t") || "").trim();
    const INDICE = { IPCA: "IPCA", IGPM: "IGP-M", INPC: "INPC", IVAR: "IVAR", nenhum: "sem reajuste" };
    const GARANTIA = { nenhuma: "Sem garantia", caucao: "Caução", fiador: "Fiador", seguro_fianca: "Seguro fiança", titulo_capitalizacao: "Título de capitalização" };
    const CH_STATUS = { aberto: "Aberto", em_andamento: "Em andamento", aguardando: "Aguardando", concluido: "Concluído" };
    let D = null, aba = "inquilino", fotosChamado = [];

    async function rpc(nome, corpo) {
        const r = await fetch(`${SUPA}/rest/v1/rpc/${nome}`, { method: "POST",
            headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(textoErro(j && j.message));
        return j;
    }
    async function funcao(corpo) {
        const r = await fetch(`${SUPA}/functions/v1/portal-cliente`, { method: "POST",
            headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify({ token, ...corpo }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.erro || "Não foi possível concluir agora.");
        return j;
    }
    const textoErro = m => { m = String(m || "Não foi possível carregar agora."); return m.includes(":") ? m.slice(m.indexOf(":") + 1).trim() : m; };
    let toastT;
    function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200); }

    // ------------------------------------------------------------------ janelas (Voltar do celular fecha a janela)
    function abrir(dlg) { if (dlg.open) return; dlg.showModal(); history.pushState({ janela: dlg.id }, ""); }
    function fechar(dlg) { if (!dlg.open) return; dlg.close(); }
    document.querySelectorAll("dialog.janela").forEach(dlg => {
        dlg.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => { if (history.state && history.state.janela === dlg.id) history.back(); else fechar(dlg); }));
        dlg.addEventListener("cancel", ev => { ev.preventDefault(); if (history.state && history.state.janela === dlg.id) history.back(); else fechar(dlg); });
    });
    window.addEventListener("popstate", () => document.querySelectorAll("dialog.janela[open]").forEach(fechar));

    // ------------------------------------------------------------------ carregar
    async function carregar() {
        if (!/^[0-9a-f]{48}$/.test(token)) return falha("Link incompleto. Abra o link exatamente como a imobiliária enviou.");
        try { D = await rpc("portal_dados", { p_token: token }); }
        catch (e) { return falha(e.message); }
        const nomeImob = (D.carteira && D.carteira.nome) || "Imobiliária";
        $("imobNome").textContent = nomeImob;
        document.title = `Portal do cliente — ${nomeImob}`;
        $("faixaPrevia").hidden = !D.previa;
        const nome = (D.cliente && (D.cliente.apelido || D.cliente.nome)) || "";
        $("ola").textContent = nome ? `Olá, ${nome.split(" ")[0]}` : "Olá";
        const temInq = D.inquilino.length > 0, temProp = D.proprietario.length > 0 || D.imoveis.length > 0;
        $("olaSub").textContent = temInq && temProp ? "Aqui estão seus aluguéis e seus imóveis administrados."
            : temInq ? "Aqui estão o seu contrato, as cobranças e os recibos." : "Aqui estão seus imóveis, os repasses e o informe de rendimentos.";
        aba = temInq ? "inquilino" : "proprietario";
        $("abas").hidden = !(temInq && temProp);
        $("abas").innerHTML = `<button type="button" data-aba="inquilino">🏠 Meu aluguel</button><button type="button" data-aba="proprietario">🔑 Meus imóveis</button>`;
        $("abas").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { aba = b.dataset.aba; desenhar(); }));
        $("rodape").innerHTML = `Este link é pessoal: não compartilhe.${D.expira_em ? " Vale até " + data(D.expira_em) + "." : ""}<br>Desenvolvido por SKL Geo Soluções`;
        $("carregando").hidden = true;
        $("conteudo").hidden = false;
        desenhar();
    }
    function falha(t) { $("carregando").textContent = t; $("imobNome").textContent = "Portal do cliente"; }

    function desenhar() {
        $("abas").querySelectorAll("button").forEach(b => b.classList.toggle("ativa", b.dataset.aba === aba));
        $("paginaInquilino").hidden = aba !== "inquilino";
        $("paginaProprietario").hidden = aba !== "proprietario";
        if (aba === "inquilino") desenharInquilino(); else desenharProprietario();
        desenharChamados();
        desenharDocumentos();
    }

    // ------------------------------------------------------------------ inquilino
    // o endereço montado pelo banco já traz bairro e cidade; sem ele, junta as partes
    const enderecoDe = im => im.endereco || [ im.bairro, im.cidade ].filter(Boolean).join(" · ");
    const valorAPagar = b => Number(b.valor_total) + Number(b.multa_estimada || 0) + Number(b.juros_estimado || 0);
    function seloCobranca(b) {
        if (b.status === "paga") return `<span class="selo ok">Paga em ${data(b.pago_em)}</span>`;
        if (b.dias_atraso > 0) return `<span class="selo atraso">Vencida há ${b.dias_atraso} dia${b.dias_atraso > 1 ? "s" : ""}</span>`;
        return `<span class="selo aberta">Vence em ${data(b.vencimento)}</span>`;
    }
    function desenharInquilino() {
        const box = $("paginaInquilino");
        box.innerHTML = D.inquilino.map(c => {
            const abertas = c.cobrancas.filter(b => b.status === "aberta").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
            const pagas = c.cobrancas.filter(b => b.status === "paga");
            const prox = abertas[0];
            const im = c.imovel || {};
            return `<section class="cartao">
              <span class="eyebrow">CONTRATO Nº ${h(c.numero)}${c.status !== "ativo" ? " · ENCERRADO" : ""}</span>
              <p class="imovel-nome">${h(im.nome || "Imóvel")}${im.codigo ? ` <small class="muted">cód. ${h(im.codigo)}</small>` : ""}</p>
              <p class="muted pequeno">${h(enderecoDe(im))}</p>
              <div class="linha-info">
                <div><span>Aluguel</span><strong>${dinheiro(c.valor_aluguel)}</strong></div>
                <div><span>Vencimento</span><strong>Todo dia ${h(c.dia_vencimento)}</strong></div>
                <div><span>Vigência</span><strong>${data(c.inicio)} a ${data(c.fim)}</strong></div>
                <div><span>Reajuste</span><strong>${h(INDICE[c.indice_reajuste] || c.indice_reajuste)}${c.proximo_reajuste ? " · " + data(c.proximo_reajuste) : ""}</strong></div>
                <div><span>Garantia</span><strong>${h(GARANTIA[c.garantia] || c.garantia || "—")}</strong></div>
              </div>
              ${prox ? `<div class="destaque${prox.dias_atraso > 0 ? " atraso" : ""}">
                  <span class="eyebrow">${prox.dias_atraso > 0 ? "COBRANÇA EM ATRASO" : "PRÓXIMA COBRANÇA"}</span>
                  <p class="valor-grande">${dinheiro(valorAPagar(prox))}</p>
                  <p class="muted pequeno">Referente a ${h(mesAno(prox.competencia))} · ${seloCobranca(prox)}</p>
                  ${detalheCobranca(prox)}
                  ${D.carteira.pix ? `<button type="button" class="botao pix" data-pix="${h(prox.id)}">Pagar com PIX</button>` : `<p class="muted pequeno">Fale com a imobiliária para receber os dados de pagamento.</p>`}
                </div>` : `<div class="destaque"><span class="selo ok">Tudo em dia</span><p class="muted pequeno" style="margin:6px 0 0">Nenhuma cobrança em aberto agora.</p></div>`}
              ${abertas.length > 1 ? `<h3>Outras cobranças em aberto</h3><div class="lista">${abertas.slice(1).map(b => itemCobranca(b)).join("")}</div>` : ""}
              <h3>Pagamentos e recibos</h3>
              ${pagas.length ? `<div class="lista">${pagas.slice(0, 6).map(b => itemCobranca(b)).join("")}</div>
                ${pagas.length > 6 ? `<details class="mais"><summary>Ver todos (${pagas.length})</summary><div class="lista" style="margin-top:8px">${pagas.slice(6).map(b => itemCobranca(b)).join("")}</div></details>` : ""}`
                : `<p class="vazio">Nenhum pagamento registrado ainda.</p>`}
            </section>`;
        }).join("") || `<section class="cartao"><p class="vazio">Nenhum contrato de aluguel em seu nome.</p></section>`;
        box.querySelectorAll("[data-pix]").forEach(b => b.addEventListener("click", () => abrirPix(b.dataset.pix)));
        box.querySelectorAll("[data-recibo]").forEach(b => b.addEventListener("click", () => recibo(b.dataset.recibo)));
    }
    function detalheCobranca(b) {
        const linhas = [ [ "Aluguel", b.valor_aluguel ] ];
        (b.itens || []).forEach(i => linhas.push([ i.descricao || "Item", i.valor ]));
        if (Number(b.desconto)) linhas.push([ "Desconto", -b.desconto ]);
        if (Number(b.multa_estimada)) linhas.push([ "Multa por atraso", b.multa_estimada ]);
        if (Number(b.juros_estimado)) linhas.push([ `Juros (${b.dias_atraso} dias)`, b.juros_estimado ]);
        return `<details class="mais"><summary>Ver o que compõe o valor</summary><div class="documento"><table>
            ${linhas.map(([ t, v ]) => `<tr><td>${h(t)}</td><td class="n">${dinheiro(v)}</td></tr>`).join("")}
            <tr class="tot"><td>Total</td><td class="n">${dinheiro(valorAPagar(b))}</td></tr></table>
            ${b.dias_atraso > 0 ? `<p class="muted pequeno">Multa e juros calculados até hoje; o valor final é confirmado pela imobiliária.</p>` : ""}</div></details>`;
    }
    function itemCobranca(b) {
        return `<div class="item"><div><strong>${h(mesAno(b.competencia))}${b.tipo === "rescisao" ? " · rescisão" : ""}</strong>
            <small>${b.status === "paga" ? "Pago " + dinheiro(b.valor_pago) : "Vence " + data(b.vencimento)}</small></div>
            <div class="direita">${b.status === "paga" ? `<span class="selo ok">Paga</span><button type="button" class="mini" data-recibo="${h(b.id)}">Recibo</button>`
                : `${seloCobranca(b)}<strong>${dinheiro(valorAPagar(b))}</strong>${D.carteira.pix ? `<button type="button" class="mini pix" data-pix="${h(b.id)}">PIX</button>` : ""}`}</div></div>`;
    }
    function acharCobranca(id) {
        for (const c of D.inquilino) { const b = c.cobrancas.find(x => x.id === id); if (b) return { c, b }; }
        return {};
    }

    function abrirPix(id) {
        const { c, b } = acharCobranca(id);
        if (!b || !D.carteira.pix) return;
        const valor = valorAPagar(b);
        const codigo = window.SKLPix.payload({ ...D.carteira.pix, valor, txid: "ALG" + String(c.numero) + "P" + String(b.parcela || "") + b.id.replace(/-/g, "").slice(0, 10) });
        $("pixTitulo").textContent = `Aluguel de ${mesAno(b.competencia)}`;
        $("pixValor").textContent = dinheiro(valor);
        $("pixAtraso").hidden = !(b.dias_atraso > 0);
        $("pixAtraso").textContent = `Com multa e juros de ${b.dias_atraso} dias de atraso, calculados até hoje.`;
        $("pixRecebedor").textContent = D.carteira.pix.nome;
        $("pixCodigo").value = codigo;
        const qr = window.qrcode(0, "M");
        qr.addData(codigo);
        qr.make();
        $("pixQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        abrir($("pixDialog"));
    }
    $("pixCopiar").addEventListener("click", async () => {
        const t = $("pixCodigo").value;
        try { await navigator.clipboard.writeText(t); toast("Código copiado. Cole no app do banco."); }
        catch { $("pixCodigo").select(); document.execCommand("copy"); toast("Código copiado."); }
    });

    // ------------------------------------------------------------------ proprietário
    function desenharProprietario() {
        const box = $("paginaProprietario");
        const anos = D.informes || [];
        box.innerHTML = D.proprietario.map(c => {
            const im = c.imovel || {};
            return `<section class="cartao">
              <span class="eyebrow">CONTRATO Nº ${h(c.numero)}${c.status !== "ativo" ? " · ENCERRADO" : ""}</span>
              <p class="imovel-nome">${h(im.nome || "Imóvel")}${im.codigo ? ` <small class="muted">cód. ${h(im.codigo)}</small>` : ""}</p>
              <p class="muted pequeno">${h(enderecoDe(im))}</p>
              <div class="linha-info">
                <div><span>Inquilino</span><strong>${h(c.inquilino || "—")}</strong></div>
                <div><span>Aluguel</span><strong>${dinheiro(c.valor_aluguel)}</strong></div>
                <div><span>Taxa de administração</span><strong>${h(Number(c.taxa_adm_pct).toLocaleString("pt-BR"))}%</strong></div>
                <div><span>Vigência</span><strong>${data(c.inicio)} a ${data(c.fim)}</strong></div>
                <div><span>Situação do aluguel</span><strong>${c.status !== "ativo" ? "Contrato encerrado" : c.aluguel_em_atraso ? `<span class="selo atraso">Em atraso</span>` : `<span class="selo ok">Em dia</span>`}</strong></div>
              </div>
              <h3>Repasses</h3>
              ${c.repasses.length ? `<div class="lista">${c.repasses.slice(0, 6).map(r => itemRepasse(c, r)).join("")}</div>
                ${c.repasses.length > 6 ? `<details class="mais"><summary>Ver todos (${c.repasses.length})</summary><div class="lista" style="margin-top:8px">${c.repasses.slice(6).map(r => itemRepasse(c, r)).join("")}</div></details>` : ""}`
                : `<p class="vazio">Nenhum repasse ainda.</p>`}
            </section>`;
        }).join("")
        + (D.imoveis.length ? `<section class="cartao"><h2>Meus imóveis na imobiliária</h2><div class="lista">${D.imoveis.map(i => `<div class="item"><div><strong>${h(i.nome)}</strong><small>cód. ${h(i.codigo || "—")} · ${h([ i.bairro, i.cidade ].filter(Boolean).join(", "))}</small></div><div class="direita"><span class="selo ${i.status === "alugado" || i.status === "vendido" ? "ok" : "aberta"}">${h(rotuloImovel(i.status))}</span></div></div>`).join("")}</div></section>` : "")
        + `<section class="cartao"><h2>Informe de rendimentos</h2>
            ${anos.length ? `<p class="muted pequeno">Para a declaração do Imposto de Renda: aluguéis recebidos, taxas pagas à imobiliária e valor líquido, por ano.</p>
              <div class="lista">${anos.map(a => `<div class="item"><div><strong>Ano ${h(a.ano)}</strong><small>Líquido recebido ${dinheiro(a.total_liquido)}</small></div><div class="direita"><button type="button" class="mini" data-informe="${h(a.ano)}">Abrir informe</button></div></div>`).join("")}</div>`
              : `<p class="vazio">O informe aparece aqui depois do primeiro aluguel recebido.</p>`}</section>`;
        box.querySelectorAll("[data-repasse]").forEach(b => b.addEventListener("click", () => demonstrativo(b.dataset.contrato, b.dataset.repasse)));
        box.querySelectorAll("[data-informe]").forEach(b => b.addEventListener("click", () => informe(Number(b.dataset.informe))));
    }
    const rotuloImovel = s => ({ disponivel: "Disponível", alugado: "Alugado", reservado: "Reservado", indisponivel: "Indisponível", em_negociacao: "Em negociação", vendido: "Vendido" }[s] || s || "—");
    function itemRepasse(c, r) {
        return `<div class="item"><div><strong>${h(mesAno(r.competencia))}</strong>
            <small>${r.status === "pago" ? "Repassado em " + data(r.pago_em) : "Previsto para " + data(r.previsto_para)}</small></div>
            <div class="direita"><strong>${dinheiro(r.valor_liquido)}</strong><span class="selo ${r.status === "pago" ? "ok" : "pendente"}">${r.status === "pago" ? "Repassado" : "A repassar"}</span>
            <button type="button" class="mini" data-contrato="${h(c.id)}" data-repasse="${h(r.id)}">Demonstrativo</button></div></div>`;
    }

    // ------------------------------------------------------------------ documentos para imprimir
    function mostrarDocumento(html) {
        $("docConteudo").innerHTML = html;
        $("impressao").innerHTML = `<div class="documento">${html}</div>`;
        abrir($("docDialog"));
    }
    $("docImprimir").addEventListener("click", () => window.print());
    const cabecalho = titulo => `<span class="eyebrow">${h(D.carteira.nome)}</span><h2>${h(titulo)}</h2>`;

    function recibo(id) {
        const { c, b } = acharCobranca(id);
        if (!b) return;
        const im = c.imovel || {};
        const linhas = [ [ "Aluguel", b.valor_aluguel ] ];
        (b.itens || []).forEach(i => linhas.push([ i.descricao || "Item", i.valor ]));
        if (Number(b.desconto)) linhas.push([ "Desconto", -b.desconto ]);
        if (Number(b.multa)) linhas.push([ "Multa", b.multa ]);
        if (Number(b.juros)) linhas.push([ "Juros", b.juros ]);
        mostrarDocumento(`${cabecalho("Recibo de aluguel")}
            <p>Recebemos de <b>${h(D.cliente.nome)}</b> a importância de <b>${dinheiro(b.valor_pago)}</b>, referente ao aluguel de
            <b>${h(mesAno(b.competencia))}</b> do imóvel <b>${h(im.nome || "")}</b>${im.endereco ? ", " + h(im.endereco) : ""} (contrato nº ${h(c.numero)}).</p>
            <table>${linhas.map(([ t, v ]) => `<tr><td>${h(t)}</td><td class="n">${dinheiro(v)}</td></tr>`).join("")}
            <tr class="tot"><td>Total pago</td><td class="n">${dinheiro(b.valor_pago)}</td></tr></table>
            <p>Pago em ${data(b.pago_em)}${b.forma_pagamento ? " · " + h(b.forma_pagamento) : ""}. Vencimento: ${data(b.vencimento)}.</p>
            <p class="muted pequeno">Recibo emitido pelo portal do cliente · ${h(D.carteira.nome)}.</p>`);
    }
    function demonstrativo(contratoId, repasseId) {
        const c = D.proprietario.find(x => x.id === contratoId);
        const r = c && c.repasses.find(x => x.id === repasseId);
        if (!r) return;
        const im = c.imovel || {};
        mostrarDocumento(`${cabecalho("Demonstrativo de repasse")}
            <p><b>${h(D.cliente.nome)}</b> · ${h(im.nome || "")} · contrato nº ${h(c.numero)} · inquilino: ${h(c.inquilino || "—")}</p>
            <p>Competência: <b>${h(mesAno(r.competencia))}</b></p>
            <table>
              <tr><td>Valor recebido do inquilino</td><td class="n">${dinheiro(r.valor_recebido)}</td></tr>
              ${Number(r.intermediacao) ? `<tr><td>(−) Intermediação</td><td class="n">${dinheiro(-r.intermediacao)}</td></tr>` : ""}
              ${Number(r.taxa_adm) ? `<tr><td>(−) Taxa de administração</td><td class="n">${dinheiro(-r.taxa_adm)}</td></tr>` : ""}
              ${Number(r.itens_retidos) ? `<tr><td>(−) Itens retidos (condomínio, IPTU pagos pela imobiliária…)</td><td class="n">${dinheiro(-r.itens_retidos)}</td></tr>` : ""}
              <tr class="tot"><td>Líquido para o proprietário</td><td class="n">${dinheiro(r.valor_liquido)}</td></tr>
            </table>
            <p>${r.status === "pago" ? "Repassado em " + data(r.pago_em) : "Previsto para " + data(r.previsto_para)}.</p>`);
    }
    function informe(ano) {
        const a = (D.informes || []).find(x => x.ano === ano);
        if (!a) return;
        mostrarDocumento(`${cabecalho("Informe de rendimentos de aluguel — ano-calendário " + ano)}
            <p>Beneficiário: <b>${h(D.cliente.nome)}</b>${D.proprietario_cpf ? " · CPF/CNPJ " + h(D.proprietario_cpf) : ""}</p>
            <div class="tabela-rola"><table><thead><tr><th>Mês</th><th>Imóvel</th><th>Inquilino</th><th class="n">Aluguel</th><th class="n">Taxas</th><th class="n">Líquido</th></tr></thead><tbody>
            ${a.contratos.map(x => `<tr><td>${h(mesAno(x.competencia))}</td><td>${h(x.imovel || "")}</td><td>${h(x.inquilino || "")}${x.inquilino_cpf ? `<br><small>${h(x.inquilino_cpf)}</small>` : ""}</td>
              <td class="n">${dinheiro(Number(x.aluguel) + Number(x.multa_juros || 0))}</td><td class="n">${dinheiro(Number(x.intermediacao) + Number(x.taxa_adm))}</td><td class="n">${dinheiro(x.liquido)}</td></tr>`).join("")}
            </tbody></table></div>
            <table>
              <tr><td>Total de aluguéis recebidos</td><td class="n">${dinheiro(a.total_aluguel)}</td></tr>
              ${Number(a.total_multa_juros) ? `<tr><td>Multa e juros recebidos</td><td class="n">${dinheiro(a.total_multa_juros)}</td></tr>` : ""}
              <tr><td>Intermediação e taxa de administração pagas</td><td class="n">${dinheiro(Number(a.total_intermediacao) + Number(a.total_taxa_adm))}</td></tr>
              <tr class="tot"><td>Total líquido repassado</td><td class="n">${dinheiro(a.total_liquido)}</td></tr>
            </table>
            <p class="muted pequeno">Valores pela data de pagamento do inquilino. Confira com o seu contador antes de declarar.</p>`);
    }

    // ------------------------------------------------------------------ chamados
    function desenharChamados() {
        const ativos = [ ...D.inquilino, ...D.proprietario ].filter(c => c.status === "ativo");
        const lista = D.chamados || [];
        $("boxChamados").innerHTML = `<h2>Manutenção</h2>
            ${lista.length ? `<div class="lista">${lista.map(ch => `<div class="item"><div><strong>Nº ${h(ch.numero)} · ${h(ch.titulo)}</strong>
                <small>${h((ch.imovel && ch.imovel.nome) || "")} · aberto em ${data(ch.aberto_em)}${ch.fotos ? ` · ${ch.fotos} foto${ch.fotos > 1 ? "s" : ""}` : ""}</small>
                ${ch.andamento.length > 1 ? `<ul class="andamento">${ch.andamento.slice(1).map(e => `<li>${data(e.quando)}: ${h(e.texto)}</li>`).join("")}</ul>` : ""}</div>
                <div class="direita"><span class="selo ${ch.status === "concluido" ? "ok" : ch.status === "aguardando" ? "pendente" : "aberta"}">${h(CH_STATUS[ch.status] || ch.status)}</span></div></div>`).join("")}</div>`
              : `<p class="vazio">Nenhum chamado. Se algo precisar de conserto, abra um chamado aqui.</p>`}
            ${ativos.length ? `<button type="button" class="botao secundario" id="abrirChamado">🛠️ Abrir chamado de manutenção</button>` : ""}`;
        const b = $("abrirChamado");
        if (b) b.addEventListener("click", () => {
            if (D.previa) { toast("Na pré-visualização da Central não dá para abrir chamado."); return; }
            $("chImovel").innerHTML = ativos.map(c => `<option value="${h(c.id)}">${h((c.imovel && c.imovel.nome) || "Contrato " + c.numero)}</option>`).join("");
            $("chTitulo").value = ""; $("chDescricao").value = ""; $("chErro").hidden = true;
            fotosChamado = []; desenharFotos();
            abrir($("chamadoDialog"));
        });
    }
    function desenharFotos() {
        $("chFotos").innerHTML = fotosChamado.map(f => `<img src="${f.url}" alt="" />`).join("");
        $("chFotoInput").parentElement.hidden = fotosChamado.length >= 3;
    }
    // reduz a foto no aparelho (lado maior 1600 px, JPEG) antes de enviar
    function reduzir(arquivo) {
        return new Promise((ok, erro) => {
            const img = new Image();
            img.onload = () => {
                const k = Math.min(1, 1600 / Math.max(img.width, img.height));
                const cv = document.createElement("canvas");
                cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                URL.revokeObjectURL(img.src);
                cv.toBlob(b => b ? ok(b) : erro(new Error("Não foi possível ler a foto.")), "image/jpeg", 0.82);
            };
            img.onerror = () => erro(new Error("Não foi possível ler a foto."));
            img.src = URL.createObjectURL(arquivo);
        });
    }
    $("chFotoInput").addEventListener("change", async ev => {
        const f = ev.target.files[0];
        ev.target.value = "";
        if (!f) return;
        try { const blob = await reduzir(f); fotosChamado.push({ blob, url: URL.createObjectURL(blob), nome: f.name }); desenharFotos(); }
        catch (e) { toast(e.message); }
    });
    const base64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
    $("chamadoForm").addEventListener("submit", async ev => {
        ev.preventDefault();
        const bt = $("chEnviar");
        bt.disabled = true; bt.textContent = "Enviando…";
        $("chErro").hidden = true;
        try {
            const ch = await rpc("portal_abrir_chamado", { p_token: token, p_dados: { contrato_id: $("chImovel").value, categoria: $("chCategoria").value,
                titulo: $("chTitulo").value, descricao: $("chDescricao").value } });
            let falhas = 0;
            for (const f of fotosChamado) {
                try { await funcao({ action: "foto", chamado_id: ch.id, nome: f.nome, tipo: "image/jpeg", base64: await base64(f.blob) }); }
                catch { falhas++; }
            }
            if (history.state && history.state.janela === "chamadoDialog") history.back(); else fechar($("chamadoDialog"));
            toast(`Chamado nº ${ch.numero} enviado. A imobiliária já foi avisada.${falhas ? ` (${falhas} foto(s) não foram)` : ""}`);
            D = await rpc("portal_dados", { p_token: token });
            desenhar();
        } catch (e) {
            $("chErro").textContent = e.message; $("chErro").hidden = false;
        } finally { bt.disabled = false; bt.textContent = "Enviar chamado"; }
    });

    // ------------------------------------------------------------------ documentos liberados pela imobiliária
    function desenharDocumentos() {
        const lista = D.documentos || [];
        $("boxDocumentos").hidden = !lista.length;
        $("boxDocumentos").innerHTML = `<h2>Documentos</h2><div class="lista">${lista.map(d => `<div class="item"><div><strong>${h(d.nome)}</strong>
            <small>${h(d.categoria || "")}${d.categoria ? " · " : ""}${data(d.enviado_em)}</small></div><div class="direita"><button type="button" class="mini" data-doc="${h(d.id)}">Abrir</button></div></div>`).join("")}</div>`;
        $("boxDocumentos").querySelectorAll("[data-doc]").forEach(b => b.addEventListener("click", async () => {
            const janela = window.open("", "_blank");
            try { const j = await funcao({ action: "arquivo", documento_id: b.dataset.doc }); if (janela) janela.location = j.url; else location.href = j.url; }
            catch (e) { if (janela) janela.close(); toast(e.message); }
        }));
    }

    carregar();
})();
