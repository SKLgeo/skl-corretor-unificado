// Serializador do arquivo de importação da DIMOB. Separado do motor (dimob-motor.js): aqui só se transforma a projeção
// fiscal em linhas de tamanho fixo, seguindo a DEFINIÇÃO do leiaute (registros e campos).
// Fonte: programa oficial PGD DIMOB 2.8g (Receita Federal) → Ajuda → "Instruções de Importação" (páginas importacao_*.htm,
// copiadas em docs/fiscal/dimob/pgd_2.8g_ajuda/). Transcrito em 21/10/2026. Os testes comparam início/fim/tamanho de cada
// campo com as tabelas dessas páginas. "validado_pgd" só vira true depois de um arquivo de teste ser importado no PGD.
(function (raiz) {
    "use strict";
    const VERSAO = "dimob-leiaute 2.0.0";

    // ---- formatação de campo (convenções do leiaute: "Convenções de formato e tamanho dos campos")
    // F fixo | B brancos | X alfanumérico à esquerda com brancos | N numérico à direita com zeros (vazio = zeros)
    // R$ 14 posições: 12 inteiras + 2 decimais, zeros à esquerda, só >= 0 (recebe CENTAVOS inteiros)
    // DATA DDMMAAAA | CPF/CNPJ: CNPJ 14 posições; CPF 11 posições alinhado à esquerda com brancos à direita
    // Organização do arquivo: ASCII de Hex 20 a Hex 7E; fim de registro Hex 0D + Hex 0A.
    const TROCAS = { "ª": "a", "º": "o", "°": "o", "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "´": "'", "`": "'", "¨": " ", "…": "...", " ": " " };
    function semAcento(t) { return String(t == null ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    function ascii(t) {
        return semAcento(t).replace(/[ªº°–—‘’“”´`¨… ]/g, c => TROCAS[c]).replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7e]/g, " ");
    }
    function formatar(campo, valor) {
        const n = campo.tamanho;
        if (!Number.isInteger(n) || n <= 0) throw new Error(`Campo ${campo.nome}: tamanho inválido`);
        let s;
        switch (campo.tipo) {
            case "F": s = String(campo.fixo); break;
            case "B": return " ".repeat(n);
            case "N": {
                const d = String(valor == null ? "" : valor).replace(/\D/g, "");
                if (d.length > n) throw new Error(`Campo ${campo.nome}: ${d.length} dígitos, cabem ${n}`);
                s = d.padStart(n, "0"); break;
            }
            case "V": {
                const v = valor == null ? 0 : valor;
                if (!Number.isInteger(v)) throw new Error(`Campo ${campo.nome}: valor precisa estar em centavos inteiros`);
                if (v < 0) throw new Error(`Campo ${campo.nome}: valor negativo`);
                s = String(v).padStart(n, "0"); break;
            }
            case "D": {
                if (!valor) { if (campo.vazio === "zeros") return "0".repeat(n); throw new Error(`Campo ${campo.nome}: data obrigatória`); }
                const [a, m, d] = String(valor).slice(0, 10).split("-");
                s = d + m + a; break;
            }
            case "C": {
                const d = String(valor == null ? "" : valor).replace(/\D/g, "");
                if (d.length === 14) s = d;
                else if (d.length === 11) s = d.padEnd(14, " ");
                else throw new Error(`Campo ${campo.nome}: CPF/CNPJ com ${d.length} dígitos`);
                break;
            }
            case "A": {
                let t = ascii(valor);
                if (campo.maiusculas) t = t.toUpperCase();
                s = t.length > n ? t.slice(0, n) : t.padEnd(n, " "); break;
            }
            default: throw new Error(`Campo ${campo.nome}: tipo ${campo.tipo} desconhecido`);
        }
        if (s.length !== n) throw new Error(`Campo ${campo.nome}: conteúdo com ${s.length} posições, esperado ${n}`);
        return s;
    }

    // ---- helpers da definição
    const F = (nome, tamanho, fixo) => ({ nome, tipo: "F", tamanho, fixo });
    const B = (nome, tamanho) => ({ nome, tipo: "B", tamanho });
    const c = (nome, tipo, tamanho, valor, extra) => Object.assign({ nome, tipo, tamanho, valor }, extra || {});
    const MESES = [ "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro" ];
    const cnpjDecl = ctx => ctx.projecao.declarante.cnpj;
    const ano = ctx => ctx.projecao.ano;
    const tipoImovel = im => (im && im.rural) ? "R" : "U";
    const enderecoImovel = im => [ im && im.logradouro, im && im.bairro ].filter(Boolean).join(" - ");

    // Ordem dos registros: Header, R01, R02…, R03…, R04…, T9 (ordem numérica crescente, "Descrição e críticas dos registros").
    function registrosPgd28g() {
        const mensais = [];
        MESES.forEach((m, i) => {
            mensais.push(c(`Valor do Aluguel no mês de ${m}`, "V", 14, x => x.item.meses.rendimento[i]));
            mensais.push(c(`Valor da Comissão no mês de ${m}`, "V", 14, x => x.item.meses.comissao[i]));
            mensais.push(c(`Valor do Imposto no mês de ${m}`, "V", 14, x => x.item.meses.imposto_retido[i]));
        });
        return [
            { id: "Header", tamanho_linha: 374, campos: [ F("Sistema", 5, "DIMOB"), B("Reservado", 369) ] },
            { id: "R01", tamanho_linha: 270, campos: [
                F("Tipo", 3, "R01"),
                c("CNPJ do declarante", "N", 14, cnpjDecl),
                c("Ano-calendário", "N", 4, ano),
                c("Declaração Retificadora", "N", 1, x => x.extra.retificadora ? 1 : 0),
                c("Número do Recibo (se for retificadora)", "N", 10, x => x.extra.retificadora ? x.extra.recibo : ""),
                c("Situação Especial", "N", 1, x => x.extra.situacao_especial ? 1 : 0),
                c("Data do evento situação especial", "D", 8, x => x.extra.situacao_especial ? x.extra.data_evento : null, { vazio: "zeros" }),
                c("Código da situação especial", "N", 2, x => x.extra.situacao_especial ? x.extra.codigo_situacao : "00"),
                c("Nome Empresarial", "A", 60, x => x.projecao.declarante.nome_empresarial),
                c("CPF do Responsável pela pessoa jurídica perante à RFB", "N", 11, x => x.projecao.declarante.cpf_responsavel),
                c("Endereço completo do contribuinte", "A", 120, x => x.projecao.declarante.endereco),
                c("UF do Contribuinte", "A", 2, x => x.projecao.declarante.uf),
                c("Código do Município do Contribuinte", "N", 4, x => x.projecao.declarante.municipio_codigo),
                B("Reservado", 20), B("Reservado", 10) ] },
            { id: "R02", tamanho_linha: 799, para: p => p.locacoes, campos: [
                F("Tipo", 3, "R02"),
                c("CNPJ do declarante", "N", 14, cnpjDecl),
                c("Ano-calendário", "N", 4, ano),
                c("Sequencial da Locação", "N", 7, x => x.sequencial),
                c("CPF/CNPJ do Locador", "C", 14, x => x.item.locador.documento),
                c("Nome/Nome Empresarial do Locador", "A", 60, x => x.item.locador.nome),
                c("CPF/CNPJ do Locatário", "C", 14, x => x.item.locatario.documento),
                c("Nome/Nome Empresarial do Locatário", "A", 60, x => x.item.locatario.nome),
                c("Número do Contrato", "A", 6, x => x.item.numero_contrato),
                c("Data do Contrato", "D", 8, x => x.item.data_contrato),
                ...mensais,
                c("Tipo do Imóvel", "A", 1, x => tipoImovel(x.item.imovel)),
                c("Endereço do Imóvel", "A", 60, x => enderecoImovel(x.item.imovel)),
                c("CEP", "N", 8, x => x.item.imovel.cep),
                c("Código do Município do Imóvel", "N", 4, x => x.item.imovel.municipio_codigo),
                B("Reservado", 20),
                c("UF", "A", 2, x => x.item.imovel.uf),
                B("Reservado", 10) ] },
            { id: "R03", tamanho_linha: 249, para: p => p.vendas.filter(v => v.tipo_operacao === "venda_propria").flatMap(v => v.registros.map(r => ({ v, r }))), campos: [
                F("Tipo", 3, "R03"),
                c("CNPJ do declarante", "N", 14, cnpjDecl),
                c("Ano-calendário", "N", 4, ano),
                c("Sequencial da Venda", "N", 7, x => x.sequencial),
                c("CPF/CNPJ do Comprador", "C", 14, x => x.item.r.comprador.documento),
                c("Nome/Nome Empresarial do Comprador", "A", 60, x => x.item.r.comprador.nome),
                c("Número do Contrato", "A", 6, x => x.item.v.numero_contrato),
                c("Data do Contrato", "D", 8, x => x.item.v.data_contrato),
                c("Valor da Operação", "V", 14, x => x.item.r.valor),
                c("Valor Pago no Ano", "V", 14, x => x.item.r.valor_pago_ano),
                c("Tipo do Imóvel", "A", 1, x => tipoImovel(x.item.v.imovel)),
                c("Endereço do Imóvel", "A", 60, x => enderecoImovel(x.item.v.imovel)),
                c("CEP", "N", 8, x => x.item.v.imovel.cep),
                c("Código do Município do Imóvel", "N", 4, x => x.item.v.imovel.municipio_codigo),
                B("Reservado", 20),
                c("UF", "A", 2, x => x.item.v.imovel.uf),
                B("Reservado", 10) ] },
            { id: "R04", tamanho_linha: 323, para: p => p.vendas.filter(v => v.tipo_operacao !== "venda_propria").flatMap(v => v.registros.map(r => ({ v, r }))), campos: [
                F("Tipo", 3, "R04"),
                c("CNPJ do declarante", "N", 14, cnpjDecl),
                c("Ano-calendário", "N", 4, ano),
                c("Seqüencial da Venda", "N", 7, x => x.sequencial),
                c("CPF/CNPJ do Comprador", "C", 14, x => x.item.r.comprador.documento),
                c("Nome/Nome Empresarial do Comprador", "A", 60, x => x.item.r.comprador.nome),
                c("CPF/CNPJ do Vendedor", "C", 14, x => x.item.r.vendedor.documento),
                c("Nome/Nome Empresarial do Vendedor", "A", 60, x => x.item.r.vendedor.nome),
                c("Número do Contrato", "A", 6, x => x.item.v.numero_contrato),
                c("Data do Contrato", "D", 8, x => x.item.v.data_contrato),
                c("Valor da Venda", "V", 14, x => x.item.r.valor),
                c("Valor da Comissão", "V", 14, x => x.item.r.comissao),
                c("Tipo do Imóvel", "A", 1, x => tipoImovel(x.item.v.imovel)),
                c("Endereço do Imóvel", "A", 60, x => enderecoImovel(x.item.v.imovel)),
                c("CEP", "N", 8, x => x.item.v.imovel.cep),
                c("Código do Município do Imóvel", "N", 4, x => x.item.v.imovel.municipio_codigo),
                B("Reservado", 20),
                c("UF", "A", 2, x => x.item.v.imovel.uf),
                B("Reservado", 10) ] },
            { id: "T9", tamanho_linha: 102, campos: [ F("Tipo", 2, "T9"), B("Reservado", 100) ] }
        ];
    }

    const LEIAUTES = {
        "pgd-2.8g": {
            versao: "pgd-2.8g",
            fonte: "PGD DIMOB 2.8g (Receita Federal) — Ajuda → Instruções de Importação",
            confirmado: true,       // transcrito do programa oficial e conferido campo a campo pelos testes
            validado_pgd: true,     // amostra fictícia importada no PGD 2.8g em 21/10/2026: 7 linhas, todos os registros gravados (docs/fiscal/dimob/amostra/EVIDENCIA_*)
            charset: "ascii",
            fim_de_linha: "\r\n",
            anos: [ 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026 ], // Anos.txt do PGD 2.8g
            limites: { nome: 60, endereco_imovel: 60, endereco_declarante: 120, numero_contrato: 6 },
            registros: registrosPgd28g()
        }
    };

    class LeiauteNaoConfirmado extends Error {
        constructor(versao) { super(`Leiaute ${versao || "?"} ainda não foi conferido com o programa oficial da Receita; o arquivo não pode ser gerado.`); this.code = "LEIAUTE_NAO_CONFIRMADO"; }
    }

    function linha(registro, contexto) {
        return registro.campos.map(cp => {
            try { return formatar(cp, typeof cp.valor === "function" ? cp.valor(contexto) : cp.valor); }
            catch (e) { e.message = `${registro.id}${contexto.sequencial ? " nº " + contexto.sequencial : ""}: ${e.message}`; throw e; }
        }).join("");
    }
    function serializar(def, projecao, extra) {
        if (!def || !def.confirmado || !Array.isArray(def.registros) || !def.registros.length || !def.fim_de_linha) throw new LeiauteNaoConfirmado(def && def.versao);
        const linhas = [], contagem = {};
        def.registros.forEach(reg => {
            const itens = reg.para ? reg.para(projecao) : [ null ];
            if (itens.length > 9999999) throw new Error(`Registro ${reg.id}: mais de 9.999.999 ocorrências`);
            itens.forEach((item, i) => {
                const l = linha(reg, { projecao, extra: extra || {}, item, indice: i, sequencial: reg.para ? i + 1 : 0 });
                if (reg.tamanho_linha && l.length !== reg.tamanho_linha) throw new Error(`Registro ${reg.id}: linha com ${l.length} posições, esperado ${reg.tamanho_linha}`);
                linhas.push(l);
            });
            contagem[reg.id] = itens.length;
        });
        const texto = linhas.join(def.fim_de_linha) + (def.fim_no_final === false ? "" : def.fim_de_linha);
        if (def.charset === "ascii" && /[^\x20-\x7e\r\n]/.test(texto)) throw new Error("Há caracteres fora do padrão ASCII (Hex 20 a 7E) no arquivo.");
        return { texto, linhas: linhas.length, contagem };
    }
    function gerar(versao, projecao, extra) {
        const def = LEIAUTES[versao];
        if (!def) throw new LeiauteNaoConfirmado(versao);
        if (projecao.erros > 0) { const e = new Error("Corrija as pendências antes de gerar o arquivo."); e.code = "PENDENCIAS"; throw e; }
        const x = extra || {};
        if (x.retificadora && !/^\d{1,10}$/.test(String(x.recibo || ""))) throw Object.assign(new Error("Retificadora: informe o número do recibo da declaração anterior (até 10 dígitos)."), { code: "DADO_INVALIDO" });
        if (x.situacao_especial && (!x.data_evento || !/^0[1-4]$/.test(String(x.codigo_situacao || "")))) throw Object.assign(new Error("Situação especial: informe o tipo e a data do evento."), { code: "DADO_INVALIDO" });
        if (def.anos && !def.anos.includes(Number(projecao.ano))) throw Object.assign(new Error(`O programa ${versao} aceita os anos ${def.anos[0]} a ${def.anos[def.anos.length - 1]}.`), { code: "DADO_INVALIDO" });
        return serializar(def, projecao, x);
    }
    function bytes(texto) { // arquivo é ASCII puro: 1 byte por caractere
        const b = new Uint8Array(texto.length);
        for (let i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i) & 0xff;
        return b;
    }
    const confirmado = versao => !!(LEIAUTES[versao] && LEIAUTES[versao].confirmado && LEIAUTES[versao].registros);
    const validadoPgd = versao => !!(LEIAUTES[versao] && LEIAUTES[versao].validado_pgd);

    const api = { VERSAO, LEIAUTES, LeiauteNaoConfirmado, formatar, serializar, gerar, bytes, confirmado, validadoPgd, semAcento, ascii };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else raiz.SKLDimobLeiaute = api;
})(typeof window !== "undefined" ? window : this);
