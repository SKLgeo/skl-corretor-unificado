// Motor de apuração da DIMOB (funções puras, sem tela e sem rede). Recebe os FATOS devolvidos pela RPC dimob_dados
// e monta a "projeção fiscal": operações de venda/intermediação e locação já divididas por pessoa, com os valores
// em CENTAVOS (inteiros) e a lista de pendências. O mesmo arquivo roda no app e nos testes (node).
// Regras com base nas Perguntas e Respostas da DIMOB (Receita Federal, consultadas em 21/10/2026):
//   venda/intermediação no ano da celebração do contrato (perg. 7, 25, 46, 52); valor e comissão proporcionais à
//   participação da imobiliária (24, 39); um registro por pessoa com sua participação (37, 47, 60);
//   locação no mês do pagamento pelo locatário (20, 70, 71); juros/multa repassados entram no rendimento (21);
//   intermediação do 1º mês integra a comissão (33); coproprietários divididos pela fração (23);
//   vários contratos entre as mesmas partes: número e data do mais antigo (72).
(function (raiz) {
    "use strict";
    const VERSAO = "dimob-motor 1.0.0";

    const digitos = t => String(t == null ? "" : t).replace(/\D/g, "");
    function docValido(doc) {
        const d = digitos(doc);
        if (d.length === 11) {
            if (/^(\d)\1{10}$/.test(d)) return false;
            for (let t = 9; t < 11; t++) {
                let s = 0;
                for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
                let r = (s * 10) % 11; if (r === 10) r = 0;
                if (r !== Number(d[t])) return false;
            }
            return true;
        }
        if (d.length === 14) {
            if (/^(\d)\1{13}$/.test(d)) return false;
            const calc = n => {
                const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
                let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
                const r = s % 11; return r < 2 ? 0 : 11 - r;
            };
            return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
        }
        return false;
    }
    // reais (número ou texto "1234.56") → centavos inteiros, sem passar por conta em ponto flutuante acumulada
    function centavos(v) {
        if (v == null || v === "") return null;
        const s = String(v).trim();
        const m = /^(-)?(\d+)(?:\.(\d{1,}))?$/.exec(s);
        if (!m) { const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) : null; }
        const dec = (m[3] || "").padEnd(3, "0");
        let c = Number(m[2]) * 100 + Number(dec.slice(0, 2));
        if (Number(dec[2]) >= 5) c += 1; // meio para cima
        return m[1] ? -c : c;
    }
    // divide um total em centavos por frações (percentuais) sem perder nem criar centavo (maiores restos)
    function dividir(total, percentuais) {
        const pesos = percentuais.map(p => Math.round(Number(p) * 10000));
        const soma = pesos.reduce((a, b) => a + b, 0);
        if (!soma) return percentuais.map(() => 0);
        const sinal = total < 0 ? -1 : 1, abs = Math.abs(total);
        const base = pesos.map(p => Math.floor(abs * p / soma));
        let resto = abs - base.reduce((a, b) => a + b, 0);
        const ordem = pesos.map((p, i) => ({ i, r: (abs * p) % soma })).sort((a, b) => b.r - a.r || a.i - b.i);
        for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) base[ordem[k].i] += 1;
        return base.map(v => v * sinal);
    }
    const proporcional = (total, pct) => dividir(total, [pct, 100 - pct])[0];
    const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
    const mesDe = iso => Number(String(iso).slice(5, 7));
    const zeros12 = () => Array.from({ length: 12 }, () => 0);

    function criarApuracao(dados, opcoes) {
        const op = opcoes || {};
        const ano = Number(dados.ano);
        const cfg = dados.config || {};
        const pend = [];
        const add = (nivel, origem, texto, campo) => pend.push({ nivel, origem: origem || null, texto, campo: campo || null });

        // ---------------- declarante
        const declarantes = dados.declarantes || [];
        let declarante = declarantes.find(d => d.id === op.declaranteId) || declarantes[0] || null;

        // Código do município: o informado pela imobiliária (fiscal_municipios) vale; senão, a tabela oficial do PGD.
        const lim = Object.assign({ nome: 60, endereco_imovel: 60, endereco_declarante: 120, numero_contrato: 6 }, op.limites || {});
        const oficial = op.municipiosOficiais || raiz.SKLDimobMunicipios || null;
        const tabelaOficial = new Map();
        if (oficial && oficial.ufs) Object.entries(oficial.ufs).forEach(([ uf, itens ]) => itens.forEach(([ cod, nome, faixas ]) => tabelaOficial.set(uf + "|" + norm(nome), { cod, faixas })));
        const municipios = new Map((dados.municipios || []).map(m => [m.uf + "|" + norm(m.cidade), m.codigo]));
        const chaveMun = (cidade, uf) => String(uf || "").toUpperCase() + "|" + norm(cidade);
        const codigoMunicipio = (cidade, uf) => (cidade && uf) ? (municipios.get(chaveMun(cidade, uf)) || (tabelaOficial.get(chaveMun(cidade, uf)) || {}).cod || null) : null;
        const cidadesSemCodigo = new Map();

        function conferirImovel(im, origem) {
            const okEnd = im && im.logradouro, okCid = im && im.cidade && im.uf;
            if (!okEnd) add("erro", origem, "Endereço do imóvel não informado.", "imovel.logradouro");
            else if ([ im.logradouro, im.bairro ].filter(Boolean).join(" - ").length > lim.endereco_imovel) add("alerta", origem, `Endereço do imóvel passa de ${lim.endereco_imovel} caracteres e será cortado no arquivo.`, "imovel.logradouro");
            if (!okCid) add("erro", origem, "Cidade/UF do imóvel não informadas.", "imovel.cidade");
            const cep = digitos(im && im.cep);
            if (!cep) add("erro", origem, "CEP do imóvel não informado (obrigatório no leiaute).", "imovel.cep");
            else if (cep.length !== 8) add("erro", origem, "CEP do imóvel precisa ter 8 dígitos.", "imovel.cep");
            const cod = okCid ? codigoMunicipio(im.cidade, im.uf) : null;
            if (okCid && !cod) cidadesSemCodigo.set(chaveMun(im.cidade, im.uf), { cidade: im.cidade, uf: String(im.uf).toUpperCase() });
            const of = okCid ? tabelaOficial.get(chaveMun(im.cidade, im.uf)) : null;
            if (of && cep.length === 8 && of.faixas.length && !of.faixas.some(([ a, b ]) => cep >= a && cep <= b))
                add("alerta", origem, `CEP ${cep} fora da faixa da cidade ${im.cidade}/${String(im.uf).toUpperCase()} na tabela da Receita: confira cidade e CEP.`, "imovel.cep");
            return Object.assign({}, im || {}, { cep: cep || null, uf: im && im.uf ? String(im.uf).toUpperCase() : null, municipio_codigo: cod });
        }
        function conferirNumero(numero, origem) {
            if (!numero) add("alerta", origem, "Sem número de contrato: vai em branco (a Receita aceita sem número, perg. 58/59; o PGD pode pedir).", "numero_contrato");
            else if (String(numero).length > lim.numero_contrato) add("erro", origem, `Número do contrato "${numero}" tem mais de ${lim.numero_contrato} caracteres (limite do leiaute). Informe um número curto na ficha fiscal.`, "numero_contrato");
        }
        if (!declarante) add("erro", null, "Cadastre o CNPJ declarante (a empresa que entrega a DIMOB).", "declarante");
        else {
            declarante = Object.assign({}, declarante, { municipio_codigo: declarante.municipio_codigo || codigoMunicipio(declarante.municipio_nome, declarante.uf) });
            if (!docValido(declarante.cnpj) || digitos(declarante.cnpj).length !== 14) add("erro", null, "CNPJ do declarante inválido.", "declarante.cnpj");
            if (!declarante.cpf_responsavel) add("erro", null, "Informe o CPF do responsável pela declaração.", "declarante.cpf_responsavel");
            else if (!docValido(declarante.cpf_responsavel) || digitos(declarante.cpf_responsavel).length !== 11) add("erro", null, "CPF do responsável inválido.", "declarante.cpf_responsavel");
            if (!declarante.endereco) add("erro", null, "Informe o endereço do declarante.", "declarante.endereco");
            else if (declarante.endereco.length > lim.endereco_declarante) add("alerta", null, `Endereço do declarante passa de ${lim.endereco_declarante} caracteres e será cortado.`, "declarante.endereco");
            if (!declarante.uf || !declarante.municipio_nome) add("erro", null, "Informe cidade e UF do declarante.", "declarante.municipio");
            else if (!declarante.municipio_codigo) add("erro", null, `Cidade do declarante "${declarante.municipio_nome}/${declarante.uf}" não está na tabela da Receita: confira o nome ou informe o código.`, "declarante.municipio_codigo");
            if (String(declarante.nome_empresarial || "").length > lim.nome) add("alerta", null, `Nome empresarial passa de ${lim.nome} caracteres e será cortado.`, "declarante.nome_empresarial");
        }

        function conferirPessoas(lista, papel, origem) {
            if (!lista.length) { add("erro", origem, `Sem ${papel}: informe nome e CPF/CNPJ.`, papel); return; }
            const soma = lista.reduce((s, p) => s + Number(p.percentual || 0), 0);
            if (Math.abs(soma - 100) > 0.0001) add("erro", origem, `As participações de ${papel} somam ${soma}% (precisa dar 100%).`, papel);
            lista.forEach(p => {
                if (!p.nome) add("erro", origem, `Nome do ${papel} não informado.`, papel);
                else if (p.nome.length > lim.nome) add("alerta", origem, `Nome do ${papel} "${p.nome}" passa de ${lim.nome} caracteres e será cortado.`, papel);
                if (!p.documento) add("erro", origem, `CPF/CNPJ do ${papel} "${p.nome || "?"}" não informado.`, papel + ".documento");
                else if (!docValido(p.documento)) add("erro", origem, `CPF/CNPJ do ${papel} "${p.nome || "?"}" inválido.`, papel + ".documento");
            });
        }
        // Partes salvas na DIMOB substituem as do cadastro, papel por papel.
        function partes(op_, papel, doCadastro) {
            const salvas = (op_.partes || []).filter(p => p.papel === papel);
            if (salvas.length) return salvas.map(p => ({ nome: p.nome, documento: digitos(p.documento), percentual: Number(p.percentual), cliente_id: p.cliente_id || null, fonte: "dimob" }));
            if (doCadastro && doCadastro.nome) return [ { nome: doCadastro.nome, documento: digitos(doCadastro.documento), percentual: 100, cliente_id: doCadastro.id || null, fonte: "cadastro" } ];
            return [];
        }
        const ref = o => ({ origem_tipo: o.origem_tipo, origem_id: o.origem_id, titulo: o.titulo || (o.imovel && o.imovel.nome) || (o.numero != null ? "Contrato nº " + o.numero : "") });

        // ---------------- vendas e intermediações (ano da celebração)
        const vendas = [], foraVendas = [];
        (dados.vendas || []).forEach(v => {
            const origem = ref(v);
            if (v.incluir === "nao") { foraVendas.push({ ...origem, motivo: v.motivo_exclusao }); return; }
            const tipo = v.tipo_operacao || "intermediacao_venda";
            const part = Number(v.participacao_pct || 100);
            const valorBruto = centavos(v.valor_operacao != null ? v.valor_operacao : v.valor);
            const comBruta = v.comissao != null ? centavos(v.comissao) : (v.comissao_total != null ? centavos(v.comissao_total) : null);
            const valor = valorBruto == null ? null : (v.valor_operacao != null ? valorBruto : proporcional(valorBruto, part));
            const comissao = comBruta == null ? null : (v.comissao != null ? comBruta : proporcional(comBruta, part));
            if (valor == null) add("erro", origem, "Valor da operação não informado.", "valor");
            if (tipo === "intermediacao_venda" && comissao == null) add("erro", origem, "Comissão não informada (o sistema não assume zero). Se não houve comissão, informe 0 na ficha.", "comissao");
            if (tipo === "intermediacao_venda" && valor === 0 && comissao === 0) add("erro", origem, "Valor da venda e comissão zerados: o leiaute exige um dos dois maior que zero.", "valor");
            if (tipo === "venda_propria" && v.valor_pago_ano == null) add("erro", origem, "Venda própria: informe o valor pago no ano.", "valor_pago_ano");
            if (tipo === "venda_propria" && valor === 0 && centavos(v.valor_pago_ano) === 0) add("erro", origem, "Valor da operação e valor pago no ano zerados: o leiaute exige um dos dois maior que zero.", "valor");
            conferirNumero(v.numero_contrato, origem);
            if (v.parceiros && v.parceiros.length && part === 100 && v.comissao == null)
                add("alerta", origem, "Negócio com parceiro: se o parceiro é outra imobiliária, informe a participação desta imobiliária (perg. 24 da Receita).", "participacao_pct");
            if (v.importada) add("info", origem, "Operação importada do histórico: confira partes e imóvel.", null);
            const compradores = partes(v, "comprador", v.cadastro && v.cadastro.cliente);
            // venda própria (construção/incorporação/loteamento, registro R03): o vendedor é a própria declarante
            const vendedores = tipo === "venda_propria" ? [ { nome: "(declarante)", documento: "", percentual: 100, fonte: "declarante" } ]
                : partes(v, "vendedor", v.cadastro && v.cadastro.proprietario);
            conferirPessoas(compradores, "comprador", origem);
            if (tipo !== "venda_propria") conferirPessoas(vendedores, "vendedor", origem);
            const imovel = conferirImovel(v.imovel, origem);
            if (!v.data_ref) add("erro", origem, "Data do contrato não informada.", "data_contrato");
            if (compradores.length > 1 || vendedores.length > 1)
                add("alerta", origem, "Mais de um comprador ou vendedor: um registro por pessoa com a sua participação (perg. 37/47/60). Confirme com o contador.", null);
            // registros: cada par vendedor × comprador, valores proporcionais às duas frações, sem perder centavo
            const pares = [];
            vendedores.forEach(vd => compradores.forEach(cp => pares.push({ vendedor: vd, comprador: cp, pct: vd.percentual * cp.percentual / 100 })));
            const vals = dividir(valor || 0, pares.map(p => p.pct));
            const coms = dividir(comissao || 0, pares.map(p => p.pct));
            const pagos = dividir(centavos(v.valor_pago_ano) || 0, pares.map(p => p.pct));
            vendas.push({
                ...origem, tipo_operacao: tipo, data_contrato: v.data_ref, numero_contrato: v.numero_contrato || null,
                participacao_pct: part, valor, comissao, valor_pago_ano: centavos(v.valor_pago_ano), imovel, compradores, vendedores,
                registros: pares.map((p, i) => ({ vendedor: p.vendedor, comprador: p.comprador, participacao_pct: p.pct, valor: vals[i], comissao: coms[i], valor_pago_ano: pagos[i] }))
            });
        });
        // possíveis duplicidades: mesmo imóvel, data e valor
        const vistos = new Map();
        vendas.forEach(v => {
            const k = [ (v.imovel && (v.imovel.id || norm(v.imovel.nome))) || "?", v.data_contrato, v.valor ].join("|");
            if (vistos.has(k)) add("alerta", v, "Possível duplicidade: outra venda com o mesmo imóvel, data e valor.", null); else vistos.set(k, v);
        });

        // ---------------- locações administradas (mês do pagamento)
        const ajustesPor = new Map();
        (dados.ajustes || []).forEach(a => {
            const k = a.origem_tipo + "|" + a.origem_id;
            if (!ajustesPor.has(k)) ajustesPor.set(k, []);
            ajustesPor.get(k).push(a);
        });
        const incluirEncargos = !!cfg.incluir_encargos;
        const blocos = []; const foraLocacoes = [];
        (dados.contratos || []).forEach(c => {
            const origem = ref(c);
            if (c.incluir === "nao") { foraLocacoes.push({ ...origem, motivo: c.motivo_exclusao }); return; }
            const meses = { rendimento: zeros12(), comissao: zeros12(), imposto_retido: zeros12() };
            const origemValores = [];
            (c.pagamentos || []).forEach(pg => {
                const m = mesDe(pg.pago_em) - 1;
                let rend, com;
                if (pg.repasse) {
                    rend = centavos(pg.repasse.valor_base) + (incluirEncargos ? (centavos(pg.repasse.itens_repassados) || 0) : 0);
                    com = (centavos(pg.repasse.intermediacao) || 0) + (centavos(pg.repasse.taxa_adm) || 0);
                } else {
                    rend = (centavos(pg.valor_aluguel) || 0) + (centavos(pg.multa) || 0) + (centavos(pg.juros) || 0) - (centavos(pg.desconto) || 0);
                    com = 0;
                    add("alerta", origem, `Pagamento de ${pg.pago_em} sem repasse calculado: comissão do mês ficou zerada.`, "repasse");
                }
                if (pg.tipo && pg.tipo !== "aluguel") add("alerta", origem, `Recebimento do tipo "${pg.tipo}" em ${pg.pago_em}: confirme com o contador se entra como aluguel.`, null);
                meses.rendimento[m] += rend; meses.comissao[m] += com;
                origemValores.push({ mes: m + 1, cobranca_id: pg.cobranca_id, pago_em: pg.pago_em, rendimento: rend, comissao: com, fonte: pg.repasse ? "repasse" : "cobranca" });
            });
            (ajustesPor.get("contrato|" + c.origem_id) || []).forEach(a => {
                const v = centavos(a.valor); meses[a.campo][a.mes - 1] += v;
                origemValores.push({ mes: a.mes, ajuste_id: a.id, campo: a.campo, valor: v, motivo: a.motivo, fonte: "ajuste" });
            });
            ["rendimento", "comissao", "imposto_retido"].forEach(k => meses[k].forEach((v, i) => {
                if (v < 0) add("erro", origem, `Valor negativo em ${k} no mês ${i + 1} (estorno maior que o recebido?).`, k);
            }));
            blocos.push({ c, origem, meses, origemValores,
                numero: c.numero_contrato || (c.numero != null ? String(c.numero) : null),
                data: c.data_contrato || c.inicio,
                locadores: partes(c, "locador", c.cadastro && c.cadastro.locador),
                locatarios: partes(c, "locatario", c.cadastro && c.cadastro.locatario),
                imovel: conferirImovel(c.imovel, origem) });
        });

        // ---------------- locações só intermediadas (sem contrato de administração no sistema)
        const intermediadas = [];
        (dados.locacoes_intermediadas || []).forEach(n => {
            if (n.tem_contrato_adm) return; // o contrato de administração já cobre (evita contar duas vezes)
            const origem = ref(n);
            const decidido = n.incluir === "sim" || (n.incluir !== "nao" && cfg.incluir_locacao_intermediada);
            if (!decidido) { intermediadas.push({ ...origem, valor: centavos(n.valor), comissao: centavos(n.comissao != null ? n.comissao : n.comissao_total), data: n.data_ref, incluida: false, motivo: n.motivo_exclusao || null }); return; }
            const meses = { rendimento: zeros12(), comissao: zeros12(), imposto_retido: zeros12() };
            const m = mesDe(n.data_ref) - 1;
            const comBruta = centavos(n.comissao != null ? n.comissao : n.comissao_total);
            const com = comBruta == null ? null : (n.comissao != null ? comBruta : proporcional(comBruta, Number(n.participacao_pct || 100)));
            if (com == null) add("erro", origem, "Comissão da locação não informada.", "comissao"); else meses.comissao[m] += com;
            const origemValores = [{ mes: m + 1, comissao: com || 0, rendimento: 0, fonte: "negociacao" }];
            (ajustesPor.get("negociacao|" + n.origem_id) || []).forEach(a => { const v = centavos(a.valor); meses[a.campo][a.mes - 1] += v; origemValores.push({ mes: a.mes, ajuste_id: a.id, campo: a.campo, valor: v, motivo: a.motivo, fonte: "ajuste" }); });
            add("alerta", origem, "Locação só intermediada (sem administração): o aluguel não passa pela imobiliária; confirme com o contador os valores mensais.", null);
            intermediadas.push({ ...origem, incluida: true });
            blocos.push({ c: n, origem, meses, origemValores, numero: n.numero_contrato || null, data: n.data_ref,
                locadores: partes(n, "locador", n.cadastro && n.cadastro.proprietario),
                locatarios: partes(n, "locatario", n.cadastro && n.cadastro.cliente),
                imovel: conferirImovel(n.imovel, origem) });
        });
        const pendentesDecisao = intermediadas.filter(i => !i.incluida).length;
        if (pendentesDecisao) add("alerta", null, `${pendentesDecisao} locação(ões) só intermediada(s) ficaram fora. Decida com o contador se entram (Configurações do módulo ou ficha de cada uma).`, "locacao_intermediada");

        // divide por locador (fração) e junta contratos das mesmas partes no mesmo imóvel
        const grupos = new Map();
        blocos.forEach(b => {
            conferirPessoas(b.locadores, "locador", b.origem);
            if (!b.locatarios.length) conferirPessoas(b.locatarios, "locatário", b.origem);
            else {
                conferirPessoas(b.locatarios.slice(0, 1).map(p => ({ ...p, percentual: 100 })), "locatário", b.origem);
                if (b.locatarios.length > 1) add("erro", b.origem, "Mais de um locatário: informe só o locatário que consta no contrato (o registro aceita um).", "locatario");
            }
            if (!b.data) add("erro", b.origem, "Data do contrato de locação não informada.", "data_contrato");
            else if (b.data < "1950-01-01" || Number(String(b.data).slice(0, 4)) > ano) add("erro", b.origem, `Data do contrato ${b.data.split("-").reverse().join("/")} fora do período aceito (1950 até ${ano}).`, "data_contrato");
            conferirNumero(b.numero, b.origem);
            const locatario = b.locatarios[0] || { nome: "", documento: "" };
            const pcts = b.locadores.map(l => l.percentual);
            const divididos = { rendimento: [], comissao: [], imposto_retido: [] };
            Object.keys(divididos).forEach(k => b.meses[k].forEach((v, i) => { divididos[k][i] = dividir(v, pcts.length ? pcts : [100]); }));
            b.locadores.forEach((loc, li) => {
                const chave = [ loc.documento || norm(loc.nome), locatario.documento || norm(locatario.nome), (b.imovel && (b.imovel.id || norm(b.imovel.logradouro))) || "?" ].join("|");
                let g = grupos.get(chave);
                if (!g) {
                    g = { locador: loc, locatario, imovel: b.imovel, numero_contrato: b.numero, data_contrato: b.data, origens: [],
                        meses: { rendimento: zeros12(), comissao: zeros12(), imposto_retido: zeros12() } };
                    grupos.set(chave, g);
                } else if (b.data && (!g.data_contrato || b.data < g.data_contrato)) { g.numero_contrato = b.numero; g.data_contrato = b.data; }
                g.origens.push({ ...b.origem, participacao_pct: loc.percentual, valores: b.origemValores });
                Object.keys(g.meses).forEach(k => { for (let i = 0; i < 12; i++) g.meses[k][i] += divididos[k][i][li] || 0; });
            });
        });
        const locacoes = [...grupos.values()].filter(g => Object.values(g.meses).some(a => a.some(v => v !== 0)) || g.origens.length);

        if (cidadesSemCodigo.size)
            [...cidadesSemCodigo.values()].forEach(c => add("erro", null, `Informe o código do município ${c.cidade}/${c.uf} (tabela do programa da Receita).`, "municipio:" + c.uf + "|" + c.cidade));

        const soma = a => a.reduce((s, v) => s + v, 0);
        const totais = {
            vendas: vendas.filter(v => v.tipo_operacao === "intermediacao_venda").length,
            vendas_proprias: vendas.filter(v => v.tipo_operacao === "venda_propria").length,
            valor_vendas: soma(vendas.map(v => v.valor || 0)),
            comissao_vendas: soma(vendas.map(v => v.comissao || 0)),
            registros_venda: soma(vendas.map(v => v.registros.length)),
            locacoes: locacoes.length,
            rendimento_mes: zeros12().map((_, i) => soma(locacoes.map(g => g.meses.rendimento[i]))),
            comissao_mes: zeros12().map((_, i) => soma(locacoes.map(g => g.meses.comissao[i]))),
            imposto_mes: zeros12().map((_, i) => soma(locacoes.map(g => g.meses.imposto_retido[i])))
        };
        totais.rendimento_ano = soma(totais.rendimento_mes);
        totais.comissao_locacao_ano = soma(totais.comissao_mes);
        totais.imposto_ano = soma(totais.imposto_mes);
        totais.sem_movimento = !vendas.length && !locacoes.length;
        const erros = pend.filter(p => p.nivel === "erro").length;
        return {
            versao_motor: VERSAO, ano, declarante, config: cfg,
            vendas, locacoes, fora: { vendas: foraVendas, locacoes: foraLocacoes, locacoes_intermediadas: intermediadas.filter(i => !i.incluida) },
            pendencias: pend, erros, alertas: pend.filter(p => p.nivel === "alerta").length, totais
        };
    }

    const api = { VERSAO, criarApuracao, docValido, centavos, dividir, digitos, norm };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.SKLDimobMotor = api;
})(typeof window !== "undefined" ? window : this);
