// Financeiro → aba "📒 Contabilidade": arquivo do mês para o contador, pelo dia em que o dinheiro entrou ou saiu (regime de caixa).
// Junta o que já está no sistema, sem digitar de novo:
//   - aluguel recebido do inquilino e repasse ao proprietário (dinheiro de terceiros, que só passa pela imobiliária);
//   - receitas da imobiliária: taxa de administração e intermediação (do repasse), comissões de venda recebidas e outras receitas;
//   - despesas lançadas (com o plano de contas) e comissões pagas aos corretores.
// Sai uma planilha CSV (Excel em português: ";" e vírgula nos valores) e um resumo para imprimir ou salvar em PDF.
// Só lê: nada é gravado. Aparece para quem gere o financeiro (administrador, Central e financeiro).
(function () {
    "use strict";
    let ctx = null, ligado = false, linhas = [], periodo = null;
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pode = () => !!ctx && ctx.podeGerir();
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const numBr = v => Number(v || 0).toFixed(2).replace(".", ",");
    const dataBr = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "";
    const mesAno = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "";
    const r2 = n => Math.round(Number(n || 0) * 100) / 100;

    // o que cada linha é para a contabilidade
    const NAT = {
        terceiros_entrada: "Recebido para repasse (aluguel)",
        terceiros_saida: "Repasse ao proprietário",
        receita: "Receita da imobiliária",
        despesa: "Despesa da imobiliária"
    };

    function iniciar(contexto) {
        ctx = contexto;
        linhas = []; periodo = null;
        if (!ligado) { montar(); ligado = true; }
        return Promise.resolve();
    }
    function sair() { linhas = []; periodo = null; }
    const temAba = a => a === "contabil" && pode();
    function renderAba(a) {
        const ligada = temAba(a);
        $("finContabil").hidden = !ligada;
        const barra = document.querySelector("#page-financeiro > .fin-toolbar");
        if (barra && ligada) barra.hidden = true;
    }

    function mesPassado() {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    function montar() {
        $("finContabil").innerHTML = `<section class="panel ctb-topo">
            <span class="eyebrow">CONTABILIDADE</span>
            <h2>Arquivo para o contador</h2>
            <p>Tudo o que entrou e saiu no período, pela data do pagamento, já separado entre o dinheiro da imobiliária e o dinheiro dos
              proprietários (aluguel que só passa pela imobiliária). Envie a planilha ao contador: ele importa no sistema dele, sem digitar de novo.</p>
            <div class="ctb-periodo">
              <label><span>Mês</span><input id="ctbMes" type="month" value="${mesPassado()}" /></label>
              <span class="muted-text">ou</span>
              <label><span>De</span><input id="ctbDe" type="date" /></label>
              <label><span>Até</span><input id="ctbAte" type="date" /></label>
              <button type="button" class="primary-button" id="ctbGerar">Montar</button>
            </div>
          </section>
          <div id="ctbResultado"></div>`;
        $("ctbGerar").addEventListener("click", gerar);
        $("ctbMes").addEventListener("change", () => { $("ctbDe").value = ""; $("ctbAte").value = ""; });
    }

    function lerPeriodo() {
        const de = $("ctbDe").value, ate = $("ctbAte").value;
        if (de || ate) {
            if (!de || !ate) { ctx.toast("Preencha as duas datas (De e Até)."); return null; }
            if (de > ate) { ctx.toast("A data inicial é depois da final."); return null; }
            return { ini: de, fim: ate, rotulo: `${dataBr(de)} a ${dataBr(ate)}`, arquivo: `${de}_a_${ate}` };
        }
        const m = $("ctbMes").value;
        if (!m) { ctx.toast("Escolha o mês."); return null; }
        const [ a, mm ] = m.split("-").map(Number);
        const fim = new Date(a, mm, 0).getDate();
        return { ini: `${m}-01`, fim: `${m}-${String(fim).padStart(2, "0")}`, rotulo: new Date(a, mm - 1, 15).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }), arquivo: m };
    }

    async function emLotes(tabela, colunas, campo, ids) {
        const saida = [];
        const lista = [ ...new Set(ids.filter(Boolean)) ];
        for (let i = 0; i < lista.length; i += 150) {
            const { data, error } = await ctx.sb.from(tabela).select(colunas).in(campo, lista.slice(i, i + 150));
            if (error) throw error;
            saida.push(...(data || []));
        }
        return saida;
    }

    async function gerar() {
        const p = lerPeriodo();
        if (!p) return;
        periodo = p;
        $("ctbResultado").innerHTML = `<p class="muted-text">Juntando os lançamentos…</p>`;
        try {
            linhas = await juntar(p);
            desenhar();
        } catch (e) {
            $("ctbResultado").innerHTML = `<p class="form-message">${h(erro(e))}</p>`;
        }
    }

    async function juntar(p) {
        const cid = ctx.carteiraId();
        const fimTs = p.fim + "T23:59:59.999";
        const [ cob, repPagos, receb, lanc, coms, planos, contas ] = await Promise.all([
            ctx.sb.from("aluguel_cobrancas").select("id,contrato_id,parcela,competencia,vencimento,valor_total,valor_pago,multa,juros,desconto,pago_em,forma_pagamento,tipo")
                .eq("carteira_id", cid).eq("status", "paga").gte("pago_em", p.ini).lte("pago_em", p.fim),
            ctx.sb.from("aluguel_repasses").select("id,contrato_id,cobranca_id,proprietario_id,competencia,valor_liquido,pago_em,observacao")
                .eq("carteira_id", cid).eq("status", "pago").gte("pago_em", p.ini).lte("pago_em", p.fim),
            ctx.sb.from("crm_comissao_recebiveis").select("id,negociacao_id,parcela,valor,recebido_em,conta_id,observacao")
                .eq("carteira_id", cid).gte("recebido_em", p.ini).lte("recebido_em", p.fim),
            ctx.sb.from("fin_lancamentos").select("id,descricao,natureza,valor,vencimento,pago_em,plano_conta_id,plano_origem,conta_id,observacao")
                .eq("carteira_id", cid).gte("pago_em", p.ini).lte("pago_em", p.fim),
            ctx.sb.from("comissoes_aluguel").select("id,corretor_id,corretor_nome,beneficiario_nome,valor_comissao,pago_em,tipo,componente,competencia,construcao_id,observacao")
                .eq("carteira_id", cid).eq("status", "paga").gte("pago_em", p.ini).lte("pago_em", fimTs),
            ctx.sb.from("fin_plano_contas").select("id,nome,grupo").eq("carteira_id", cid),
            ctx.sb.from("fin_contas_bancarias").select("id,nome,banco").eq("carteira_id", cid)
        ]);
        for (const r of [ cob, repPagos, receb, lanc, coms, planos, contas ]) if (r.error) throw r.error;
        const cobrancas = cob.data || [];
        // taxa de administração e intermediação: ficam com a imobiliária no dia em que o aluguel é recebido
        const repDaCob = cobrancas.length ? await emLotes("aluguel_repasses", "id,cobranca_id,proprietario_id,taxa_adm,intermediacao", "cobranca_id", cobrancas.map(c => c.id)) : [];
        const idsContrato = [ ...cobrancas.map(c => c.contrato_id), ...(repPagos.data || []).map(r => r.contrato_id) ];
        const contratos = idsContrato.length ? await emLotes("aluguel_contratos", "id,numero,construcao_id,inquilino_id,proprietario_id,inquilino_nome,proprietario_nome,imovel_avulso", "id", idsContrato) : [];
        const negs = (receb.data || []).length ? await emLotes("crm_negociacoes", "id,titulo,cliente_id,construcao_id", "id", receb.data.map(r => r.negociacao_id)) : [];
        const idsCli = [ ...contratos.flatMap(c => [ c.inquilino_id, c.proprietario_id ]), ...negs.map(n => n.cliente_id), ...(repPagos.data || []).map(r => r.proprietario_id) ];
        const clientes = idsCli.length ? await emLotes("crm_clientes", "id,nome,cpf", "id", idsCli) : [];

        const mCont = new Map(contratos.map(c => [ c.id, c ]));
        const mCli = new Map(clientes.map(c => [ c.id, c ]));
        const mNeg = new Map(negs.map(n => [ n.id, n ]));
        const mPlano = new Map((planos.data || []).map(x => [ x.id, x ]));
        const mConta = new Map((contas.data || []).map(x => [ x.id, x ]));
        const mImovel = new Map((ctx.imoveis() || []).map(i => [ i.id, i ]));
        const imovelTxt = (id, avulso) => {
            const i = mImovel.get(id);
            if (i) return [ i.codigo && "Cód. " + i.codigo, i.nome ].filter(Boolean).join(" · ");
            return avulso && (avulso.descricao || avulso.endereco) || "";
        };
        const pessoa = (id, nomeLivre) => { const c = mCli.get(id); return { nome: (c && c.nome) || nomeLivre || "", doc: (c && c.cpf) || "" }; };
        const contaTxt = id => { const c = mConta.get(id); return c ? [ c.nome, c.banco ].filter(Boolean).join(" · ") : ""; };
        const out = [];
        const add = l => { if (r2(l.valor) !== 0) out.push({ ...l, valor: r2(l.valor) }); };

        for (const c of cobrancas) {
            const k = mCont.get(c.contrato_id) || {};
            const inq = pessoa(k.inquilino_id, k.inquilino_nome);
            const valor = c.valor_pago != null ? c.valor_pago : c.valor_total;
            const extras = [ Number(c.multa) && `multa ${dinheiro(c.multa)}`, Number(c.juros) && `juros ${dinheiro(c.juros)}`, Number(c.desconto) && `desconto ${dinheiro(c.desconto)}` ].filter(Boolean).join(", ");
            add({ data: c.pago_em, tipo: "Entrada", natureza: "terceiros_entrada", categoria: c.tipo === "rescisao" ? "Rescisão de contrato" : "Aluguel",
                historico: `${c.tipo === "rescisao" ? "Acerto de rescisão" : "Aluguel " + mesAno(c.competencia || c.vencimento)}${k.numero ? " · contrato nº " + k.numero : ""}${extras ? " (" + extras + ")" : ""}`,
                pessoa: inq.nome, doc: inq.doc, imovel: imovelTxt(k.construcao_id, k.imovel_avulso), documento: `Recibo ${c.parcela ? "parcela " + c.parcela : ""}`.trim(),
                conta: c.forma_pagamento || "", valor });
            for (const r of repDaCob.filter(x => x.cobranca_id === c.id)) {
                const prop = pessoa(r.proprietario_id || k.proprietario_id, k.proprietario_nome);
                add({ data: c.pago_em, tipo: "Retido", natureza: "receita", categoria: "Taxa de administração", historico: `Taxa de administração · aluguel ${mesAno(c.competencia || c.vencimento)}`,
                    pessoa: prop.nome, doc: prop.doc, imovel: imovelTxt(k.construcao_id, k.imovel_avulso), documento: k.numero ? "Contrato nº " + k.numero : "", conta: "", valor: r.taxa_adm });
                add({ data: c.pago_em, tipo: "Retido", natureza: "receita", categoria: "Intermediação (1º aluguel)", historico: `Intermediação da locação${k.numero ? " · contrato nº " + k.numero : ""}`,
                    pessoa: prop.nome, doc: prop.doc, imovel: imovelTxt(k.construcao_id, k.imovel_avulso), documento: k.numero ? "Contrato nº " + k.numero : "", conta: "", valor: r.intermediacao });
            }
        }
        for (const r of repPagos.data || []) {
            const k = mCont.get(r.contrato_id) || {};
            const prop = pessoa(r.proprietario_id || k.proprietario_id, k.proprietario_nome);
            add({ data: r.pago_em, tipo: "Saída", natureza: "terceiros_saida", categoria: "Repasse de aluguel", historico: `Repasse do aluguel ${mesAno(r.competencia)}${k.numero ? " · contrato nº " + k.numero : ""}`,
                pessoa: prop.nome, doc: prop.doc, imovel: imovelTxt(k.construcao_id, k.imovel_avulso), documento: "Demonstrativo de repasse", conta: "", valor: r.valor_liquido });
        }
        for (const r of receb.data || []) {
            const n = mNeg.get(r.negociacao_id) || {};
            const cli = pessoa(n.cliente_id);
            add({ data: r.recebido_em, tipo: "Entrada", natureza: "receita", categoria: "Comissão de venda", historico: `Comissão de venda${n.titulo ? " · " + n.titulo : ""}${r.parcela ? " · parcela " + r.parcela : ""}`,
                pessoa: cli.nome, doc: cli.doc, imovel: imovelTxt(n.construcao_id), documento: "", conta: contaTxt(r.conta_id), valor: r.valor });
        }
        for (const l of lanc.data || []) {
            const pl = mPlano.get(l.plano_conta_id);
            add({ data: l.pago_em, tipo: l.natureza === "receita" ? "Entrada" : "Saída", natureza: l.natureza === "receita" ? "receita" : "despesa",
                categoria: (pl && [ pl.grupo, pl.nome ].filter(Boolean).join(" › ")) || l.plano_origem || (l.natureza === "receita" ? "Outras receitas" : "Outras despesas"),
                historico: [ l.descricao, l.observacao ].filter(Boolean).join(" · "), pessoa: "", doc: "", imovel: "", documento: "", conta: contaTxt(l.conta_id), valor: l.valor });
        }
        for (const c of coms.data || []) {
            add({ data: String(c.pago_em).slice(0, 10), tipo: "Saída", natureza: "despesa", categoria: "Comissão paga a corretor",
                historico: `Comissão${c.componente ? " · " + c.componente : ""}${c.competencia ? " · " + mesAno(c.competencia) : ""}`,
                pessoa: c.beneficiario_nome || c.corretor_nome || "", doc: "", imovel: imovelTxt(c.construcao_id), documento: "", conta: "", valor: c.valor_comissao });
        }
        const ordem = { terceiros_entrada: 0, receita: 1, terceiros_saida: 2, despesa: 3 };
        return out.sort((a, b) => String(a.data).localeCompare(String(b.data)) || ordem[a.natureza] - ordem[b.natureza]);
    }

    function totais() {
        const t = { terceiros_entrada: 0, terceiros_saida: 0, receita: 0, despesa: 0 };
        const porCat = new Map();
        for (const l of linhas) {
            t[l.natureza] = r2(t[l.natureza] + l.valor);
            const k = l.natureza + "|" + l.categoria;
            porCat.set(k, r2((porCat.get(k) || 0) + l.valor));
        }
        return { t, porCat };
    }

    function desenhar() {
        const { t, porCat } = totais();
        const cats = nat => [ ...porCat.entries() ].filter(([ k ]) => k.startsWith(nat + "|")).sort((a, b) => b[1] - a[1])
            .map(([ k, v ]) => `<li><span>${h(k.split("|")[1])}</span><b>${dinheiro(v)}</b></li>`).join("") || `<li class="muted-text">Nada no período</li>`;
        const prev = linhas.slice(0, 300);
        $("ctbResultado").innerHTML = linhas.length ? `<section class="panel">
            <div class="ctb-cab"><div><span class="eyebrow">${h(periodo.rotulo.toUpperCase())}</span><h3>${linhas.length} lançamento(s)</h3></div>
              <div class="ctb-botoes"><button type="button" class="primary-button" id="ctbCsv">⬇ Planilha para o contador</button>
              <button type="button" class="secondary-button" id="ctbPdf">🖨 Resumo em PDF</button></div></div>
            <div class="ctb-quadros">
              <div class="ctb-quadro ctb-rec"><span>Receitas da imobiliária</span><strong>${dinheiro(t.receita)}</strong><ul>${cats("receita")}</ul></div>
              <div class="ctb-quadro ctb-desp"><span>Despesas da imobiliária</span><strong>${dinheiro(t.despesa)}</strong><ul>${cats("despesa")}</ul></div>
              <div class="ctb-quadro ctb-res"><span>Resultado da imobiliária</span><strong>${dinheiro(t.receita - t.despesa)}</strong>
                <p class="muted-text">Receitas menos despesas no período.</p></div>
              <div class="ctb-quadro ctb-terc"><span>Dinheiro dos proprietários</span>
                <ul><li><span>Aluguéis recebidos</span><b>${dinheiro(t.terceiros_entrada)}</b></li><li><span>Repassado</span><b>${dinheiro(t.terceiros_saida)}</b></li></ul>
                <p class="muted-text">Não é receita da imobiliária: só passa por ela. A taxa de administração e a intermediação já estão nas receitas.</p></div>
            </div>
            <div class="tabela-rola"><table class="crm-tabela ctb-tabela"><thead><tr><th>Data</th><th>Natureza</th><th>Categoria</th><th>Histórico</th><th>Pessoa</th><th class="n">Valor</th></tr></thead><tbody>
              ${prev.map(l => `<tr><td data-r="Data">${h(dataBr(l.data))}</td><td data-r="Natureza">${h(NAT[l.natureza])}</td><td data-r="Categoria">${h(l.categoria)}</td>
                <td data-r="Histórico">${h(l.historico)}</td><td data-r="Pessoa">${h(l.pessoa || "—")}</td>
                <td data-r="Valor" class="n ${l.tipo === "Saída" ? "ctb-saida" : ""}">${l.tipo === "Saída" ? "−" : ""}${dinheiro(l.valor)}</td></tr>`).join("")}
            </tbody></table></div>
            ${linhas.length > prev.length ? `<p class="muted-text">Mostrando ${prev.length} de ${linhas.length}. A planilha leva todos.</p>` : ""}
          </section>` : `<section class="panel"><p class="muted-text">Nenhum recebimento, repasse, comissão ou despesa paga em ${h(periodo.rotulo)}.</p></section>`;
        if (!linhas.length) return;
        $("ctbCsv").addEventListener("click", baixarCsv);
        $("ctbPdf").addEventListener("click", resumoPdf);
    }

    function baixarCsv() {
        const esc = v => { const s = String(v == null ? "" : v); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const cab = [ "Data", "Tipo", "Natureza", "Categoria", "Histórico", "Pessoa", "CPF/CNPJ", "Imóvel", "Documento", "Conta/forma", "Entrada", "Saída" ];
        const corpo = linhas.map(l => [ dataBr(l.data), l.tipo, NAT[l.natureza], l.categoria, l.historico, l.pessoa, l.doc, l.imovel, l.documento, l.conta,
            l.tipo === "Saída" ? "" : numBr(l.valor), l.tipo === "Saída" ? numBr(l.valor) : "" ]);
        const texto = "﻿" + [ cab, ...corpo ].map(l => l.map(esc).join(";")).join("\r\n");
        const nome = `contabilidade_${periodo.arquivo}.csv`;
        if (window.NativeBridge && typeof window.NativeBridge.saveTextFile === "function") {
            window.NativeBridge.saveTextFile(btoa(unescape(encodeURIComponent(texto))), nome, "text/csv");
            return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([ texto ], { type: "text/csv;charset=utf-8" }));
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function resumoPdf() {
        if (!window.SKLFinanceiro || !window.SKLFinanceiro.imprimir) return;
        const { t, porCat } = totais();
        const tabela = nat => {
            const itens = [ ...porCat.entries() ].filter(([ k ]) => k.startsWith(nat + "|")).sort((a, b) => b[1] - a[1]);
            return itens.length ? itens.map(([ k, v ]) => `<tr><td>${h(k.split("|")[1])}</td><td class="n">${dinheiro(v)}</td></tr>`).join("") : `<tr><td colspan="2">Nada no período</td></tr>`;
        };
        window.SKLFinanceiro.imprimir(`<div class="fin-doc">
            <h2>Resumo para a contabilidade</h2>
            <p><b>${h(ctx.carteiraNome())}</b> · período: ${h(periodo.rotulo)} · regime de caixa (data do pagamento)</p>
            <h3>Receitas da imobiliária</h3><table class="fin-doc-tabela">${tabela("receita")}<tr class="forte"><td>Total</td><td class="n">${dinheiro(t.receita)}</td></tr></table>
            <h3>Despesas da imobiliária</h3><table class="fin-doc-tabela">${tabela("despesa")}<tr class="forte"><td>Total</td><td class="n">${dinheiro(t.despesa)}</td></tr></table>
            <h3>Resultado do período</h3><table class="fin-doc-tabela"><tr class="forte"><td>Receitas − despesas</td><td class="n">${dinheiro(t.receita - t.despesa)}</td></tr></table>
            <h3>Dinheiro dos proprietários (não é receita)</h3><table class="fin-doc-tabela">
              <tr><td>Aluguéis recebidos dos inquilinos</td><td class="n">${dinheiro(t.terceiros_entrada)}</td></tr>
              <tr><td>Repassado aos proprietários</td><td class="n">${dinheiro(t.terceiros_saida)}</td></tr></table>
            <p class="fin-doc-rodape">${linhas.length} lançamento(s). A lista completa está na planilha "contabilidade_${h(periodo.arquivo)}.csv". Gerado em ${h(new Date().toLocaleString("pt-BR"))}.</p>
          </div>`);
    }

    window.SKLContabil = { iniciar, sair, temAba, render: renderAba };
})();
