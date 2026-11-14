// Conectores de portais imobiliários — FONTE ÚNICA de mapeamento e validação.
// O mesmo arquivo roda em três lugares (copiado byte a byte; o teste confere):
//   - no app (Central_PC_Alugueis/src → <script>), para a pré-validação na ficha do imóvel e o diagnóstico;
//   - na Edge Function portais-feed (supabase/functions/portais-feed/conectores.js), que monta os XML;
//   - nos testes (Central_PC_Alugueis/testes/portais.test.js, Node).
// Sem import/export: publica globalThis.SKLPortaisConectores.
//
// Regras tiradas SÓ da documentação oficial (conferida em 12/11/2026):
//   VRSync (Grupo OLX): developers.grupozap.com/feeds/vrsync/elements/{header,listing,details}.html
//   Chaves na Mão: tecnologiacnm.github.io/cnm-xml-documentation (tags, fotos, residencial, comercial, estados, exemplo)
// Imovelweb: sem especificação oficial obtida → só catálogo (nada é gerado). MF Rural: sem API oficial → ficha para cadastro manual.
(function (raiz) {
    "use strict";

    const VERSAO = "1.0.0";

    // ------------------------------------------------------------------ catálogo
    const PORTAIS = [
        { id: "olx", nome: "OLX", canal: "grupo_olx", metodo: "feed_vrsync", grupo: "Grupo OLX (Canal Pro)" },
        { id: "zap", nome: "ZAP Imóveis", canal: "grupo_olx", metodo: "feed_vrsync", grupo: "Grupo OLX (Canal Pro)" },
        { id: "vivareal", nome: "Viva Real", canal: "grupo_olx", metodo: "feed_vrsync", grupo: "Grupo OLX (Canal Pro)" },
        { id: "chavesnamao", nome: "Chaves na Mão", canal: "chavesnamao", metodo: "feed_cnm", grupo: "Chaves na Mão" },
        { id: "imovelweb", nome: "Imovelweb", canal: "imovelweb", metodo: "sem_especificacao", grupo: "Imovelweb" },
        { id: "mfrural", nome: "MF Rural", canal: "mfrural", metodo: "manual", grupo: "MF Rural" }
    ];
    // operações por canal: só o que a documentação oficial sustenta
    const CANAIS = {
        grupo_olx: {
            nome: "Grupo OLX (OLX, ZAP Imóveis, Viva Real)", formato: "XML VRSync",
            operacoes: { exportar: true, retirar: "ausência no arquivo (efeito final segue a grade/plano do anunciante)", leads: "webhook homologado (Basic, chave por CRM)", relatorio: "e-mail, webhook e Canal Pro (retorno registrado à mão no SKL)", status_automatico: false },
            leitura: "a cada 12 horas (o horário pode variar)",
            fontes: [ "https://developers.grupozap.com/feeds/integration.html", "https://developers.grupozap.com/feeds/connection_guideline.html",
                "https://developers.grupozap.com/feeds/vrsync/elements/header.html", "https://developers.grupozap.com/feeds/vrsync/elements/listing.html",
                "https://developers.grupozap.com/feeds/vrsync/elements/details.html", "https://developers.grupozap.com/webhooks/integration_leads.html",
                "https://developers.grupozap.com/webhooks/security.html" ]
        },
        chavesnamao: {
            nome: "Chaves na Mão", formato: "XML próprio (Document/imoveis/imovel)",
            operacoes: { exportar: true, retirar: "ausência no arquivo (procedimento a confirmar com o suporte)", leads: "não documentado publicamente", relatorio: "não documentado publicamente", status_automatico: false },
            leitura: "duas janelas diárias (06h–13h e 16h–22h), sem garantia de publicação imediata",
            fontes: [ "https://tecnologiacnm.github.io/cnm-xml-documentation/arquivo/especificacoes/especificacoes-tags.html",
                "https://tecnologiacnm.github.io/cnm-xml-documentation/arquivo/especificacoes/especificacoes-fotos.html",
                "https://help.chavesnamao.com.br/support/solutions/articles/72000662673", "https://help.chavesnamao.com.br/support/solutions/articles/72000638008" ]
        },
        imovelweb: {
            nome: "Imovelweb", formato: "a definir pelo portal",
            operacoes: { exportar: false, retirar: false, leads: false, relatorio: false, status_automatico: false },
            leitura: "desconhecida", fontes: [ "https://help.imovelweb.com.br/" ]
        },
        mfrural: {
            nome: "MF Rural", formato: "cadastro manual no site do portal",
            operacoes: { exportar: false, retirar: "manual", leads: false, relatorio: false, status_automatico: false },
            leitura: "não se aplica (sem sincronização automática)", fontes: [ "https://www.mfrural.com.br/ajuda", "https://www.mfrural.com.br/politica" ]
        }
    };

    const UFS = [ "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO" ];

    // ------------------------------------------------------------------ utilitários
    const sem = v => String(v == null ? "" : v);
    const norm = v => sem(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const esc = v => sem(v).replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
    const cdata = v => "<![CDATA[" + sem(v).replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
    const num = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
    const inteiro = v => { const n = num(v); return n === null ? null : Math.round(n); };
    const positivo = v => { const n = num(v); return n !== null && n > 0; };
    const digitos = v => sem(v).replace(/\D/g, "");
    // texto puro (sem HTML), quebras normalizadas
    function textoPuro(v) {
        return sem(v).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }
    const extensao = p => { const m = /\.([a-z0-9]+)(?:$|\?)/i.exec(sem(p)); return m ? m[1].toLowerCase() : ""; };
    function dataCnm(d) {
        const x = d ? new Date(d) : new Date();
        if (isNaN(x)) return "";
        const p = n => String(n).padStart(2, "0");
        return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())}`;
    }

    // ------------------------------------------------------------------ classificação comum
    // categoria: residencial | comercial | terreno | rural
    function classe(i) {
        const t = norm(i.tipo_imovel);
        if (i.rural || /fazenda|sitio|chacara|rancho|haras|area rural|terreno rural/.test(t)) return "rural";
        if (i.lote || /terreno|lote/.test(t)) return "terreno";
        if (/sala|escritorio|consultorio|loja|ponto|comercial|galpao|barracao|deposito|predio|garagem/.test(t)) return "comercial";
        return "residencial";
    }
    function transacoes(i) {
        const venda = !!i.para_venda, aluguel = !!i.para_aluguel || (!i.para_venda && !i.para_aluguel);
        return { venda, aluguel, ambos: venda && aluguel };
    }
    function areaM2(i) { return num(i.area_m2); }

    // ------------------------------------------------------------------ VRSync (Grupo OLX)
    function tipoVrsync(i) {
        const t = norm(i.tipo_imovel), c = classe(i);
        if (c === "rural") return /fazenda|haras|area rural/.test(t) ? "Residential / Agricultural" : "Residential / Farm Ranch";
        if (c === "terreno") return /comercial/.test(t) ? "Commercial / Land Lot" : "Residential / Land Lot";
        if (/cobertura/.test(t)) return "Residential / Penthouse";
        if (/flat/.test(t)) return "Residential / Flat";
        if (/studio|estudio/.test(t)) return "Residential / Studio";
        if (/kitnet|quitinete/.test(t)) return "Residential / Kitnet";
        if (/loft/.test(t)) return "Residential / Loft";
        if (/apart/.test(t)) return "Residential / Apartment";
        if (/sobrado/.test(t) && !/comercial/.test(t)) return "Residential / Sobrado";
        if (/casa de condominio|condominio/.test(t)) return "Residential / Condo";
        if (/vila/.test(t)) return "Residential / Village House";
        if (/consultorio/.test(t)) return "Commercial / Consultorio";
        if (/sala|escritorio/.test(t)) return "Commercial / Office";
        if (/galpao|barracao|deposito|armazem/.test(t)) return "Commercial / Industrial";
        if (/garagem/.test(t)) return "Commercial / Garage";
        if (/predio/.test(t)) return "Commercial / Building";
        if (/loja|ponto|comercial/.test(t)) return "Commercial / Business";
        if (/^casa/.test(t)) return "Residential / Home";
        return null;
    }
    // regras por tipo (details.html): LotArea para terreno, galpão e fazenda/sítio/chácara; LivingArea para os demais
    const USA_LOT_AREA = [ "Residential / Land Lot", "Commercial / Land Lot", "Commercial / Industrial", "Residential / Farm Ranch", "Residential / Agricultural" ];
    const EXIGE_BANHEIRO = [ "Residential / Apartment", "Residential / Home", "Residential / Condo", "Residential / Village House", "Residential / Farm Ranch",
        "Residential / Penthouse", "Residential / Flat", "Residential / Kitnet", "Residential / Loft", "Residential / Sobrado", "Residential / Agricultural",
        "Commercial / Consultorio", "Commercial / Edificio Residencial", "Commercial / Office" ];
    const EXIGE_QUARTO = [ "Residential / Apartment", "Residential / Home", "Residential / Condo", "Residential / Village House", "Residential / Farm Ranch",
        "Residential / Penthouse", "Residential / Flat", "Residential / Loft", "Residential / Sobrado", "Residential / Agricultural",
        "Commercial / Edificio Residencial", "Residential / Studio" ];
    const QUARTO_ZERO = [ "Residential / Studio", "Residential / Kitnet" ];

    function tituloVrsync(i) {
        let t = textoPuro(i.nome).replace(/\s+/g, " ");
        if (t.length < 10) t = [ t, sem(i.tipo_imovel), i.bairro ? "no " + i.bairro : "" ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        return t.slice(0, 100);
    }
    function fotosValidas(i, aceitas) {
        const todas = Array.isArray(i.fotos) ? i.fotos.filter(Boolean) : [];
        return { todas, aceitas: todas.filter(p => aceitas.includes(extensao(p))) };
    }

    // devolve { erros:[], avisos:[] } — erro = o imóvel NÃO entra no arquivo (portal rejeitaria)
    function validarVrsync(i, ctx) {
        const erros = [], avisos = [];
        const contato = (ctx && ctx.contato) || {};
        if (!i.listing_id && !(ctx && ctx.semListingId)) erros.push("sem identificador de anúncio (ListingID)");
        if (i.listing_id && (sem(i.listing_id).length < 1 || sem(i.listing_id).length > 50)) erros.push("ListingID precisa ter de 1 a 50 caracteres");
        const tipo = tipoVrsync(i);
        if (!tipo) erros.push(`tipo "${sem(i.tipo_imovel) || "—"}" sem correspondência no VRSync (escolha um tipo mais específico)`);
        const titulo = tituloVrsync(i);
        if (titulo.length < 10) avisos.push("título curto (o portal espera de 10 a 100 caracteres)");
        if (textoPuro(i.nome).length > 100) avisos.push("título será cortado em 100 caracteres");
        const desc = textoPuro(i.descricao);
        if (desc.length < 50) erros.push(`descrição com ${desc.length} caracteres (mínimo 50)`);
        if (desc.length > 3000) erros.push(`descrição com ${desc.length} caracteres (máximo 3.000)`);
        const tr = transacoes(i);
        if (tr.venda && !positivo(i.valor_venda)) erros.push("valor de venda não informado");
        if (tr.aluguel && !positivo(i.valor_aluguel)) erros.push("valor do aluguel não informado");
        if (i.valor_a_partir) avisos.push("\"a partir de\" não existe no VRSync: o portal mostra o valor exato");
        if (!positivo(areaM2(i))) erros.push(tipo && USA_LOT_AREA.includes(tipo) ? "área total não informada" : "área útil não informada");
        if (tipo && EXIGE_BANHEIRO.includes(tipo) && !positivo(i.banheiros)) erros.push("número de banheiros é obrigatório para este tipo");
        if (tipo && EXIGE_QUARTO.includes(tipo) && !QUARTO_ZERO.includes(tipo) && !positivo(i.quartos)) erros.push("número de quartos é obrigatório para este tipo");
        if (!sem(i.bairro).trim()) erros.push("bairro não informado");
        if (!sem(i.cidade).trim()) erros.push("cidade não informada");
        if (!UFS.includes(sem(i.uf).toUpperCase())) erros.push("UF ausente ou inválida");
        if (digitos(i.cep).length !== 8) erros.push("CEP obrigatório no VRSync (8 dígitos); o portal não mostra o CEP quando o endereço está oculto");
        const f = fotosValidas(i, [ "jpg", "jpeg" ]);
        if (f.aceitas.length < 5) erros.push(`${f.aceitas.length} foto(s) JPG — o Grupo OLX exige pelo menos 5`);
        if (f.todas.length > f.aceitas.length) avisos.push(`${f.todas.length - f.aceitas.length} foto(s) em formato diferente de JPG ficam de fora (só JPG é importado)`);
        if (!i.site_localizacao) avisos.push("endereço oculto: o portal mostra só o bairro (marque \"Mostrar localização no site\" para enviar rua e mapa)");
        if (!contato.nome || !contato.email) erros.push("contato da imobiliária (nome e e-mail) não configurado no menu Portais");
        return { erros, avisos, tipo };
    }

    function listingVrsync(i, ctx) {
        const c = (ctx && ctx.contato) || {};
        const tipo = tipoVrsync(i);
        const tr = transacoes(i);
        const transacao = tr.ambos ? "Sale/Rent" : tr.venda ? "For Sale" : "For Rent";
        const fotos = fotosValidas(i, [ "jpg", "jpeg" ]).aceitas;
        const fotoUrl = (ctx && ctx.fotoUrl) || (p => p);
        const media = fotos.map((p, k) => `<Item medium="image"${k === 0 ? ' primary="true"' : ""}>${esc(fotoUrl(i, p))}</Item>`).join("");
        const area = inteiro(areaM2(i));
        const lot = tipo && USA_LOT_AREA.includes(tipo);
        const iptuAnual = i.iptu_tipo === "valor" || positivo(i.valor_iptu) ? inteiro(i.valor_iptu) : null;
        const cond = i.condominio_tipo === "nao_tem" ? 0 : (positivo(i.valor_condominio) ? inteiro(i.valor_condominio) : null);
        const quartos = QUARTO_ZERO.includes(tipo) ? 0 : inteiro(i.quartos);
        const desc = textoPuro(i.descricao).replace(/\n/g, "<br>");
        const display = i.site_localizacao ? (sem(i.numero).trim() ? "All" : "Street") : "Neighborhood";
        const uso = /^Commercial/.test(tipo || "") ? "Commercial" : "Residential";
        const t = (n, v, a = "") => (v === null || v === undefined || v === "") ? "" : `<${n}${a}>${esc(v)}</${n}>`;
        return `<Listing>${t("ListingID", i.listing_id)}<Title>${cdata(tituloVrsync(i))}</Title>${t("TransactionType", transacao)}`
            + `<PublicationType>${i.destaque && ctx && ctx.destaquePremium ? "PREMIUM" : "STANDARD"}</PublicationType>`
            + `<Media>${media}</Media>`
            + `<Details>${t("UsageType", uso)}${t("PropertyType", tipo)}<Description>${cdata(desc)}</Description>`
            + (tr.venda ? `<ListPrice currency="BRL">${inteiro(i.valor_venda)}</ListPrice>` : "")
            + (tr.aluguel ? `<RentalPrice currency="BRL" period="Monthly">${inteiro(i.valor_aluguel)}</RentalPrice>` : "")
            + (cond !== null ? `<PropertyAdministrationFee currency="BRL">${cond}</PropertyAdministrationFee>` : "")
            + (iptuAnual ? `<Iptu currency="BRL" period="Yearly">${iptuAnual}</Iptu>` : "")
            + (area ? (lot ? `<LotArea unit="square metres">${area}</LotArea>` : `<LivingArea unit="square metres">${area}</LivingArea>`) : "")
            + (quartos !== null ? t("Bedrooms", quartos) : "") + t("Bathrooms", inteiro(i.banheiros)) + t("Suites", inteiro(i.suites))
            + t("Garage", inteiro(i.vagas), ' type="Parking Space"') + `</Details>`
            + `<Location displayAddress="${display}"><Country abbreviation="BR">Brasil</Country>`
            + `<State abbreviation="${esc(sem(i.uf).toUpperCase())}">${esc(sem(i.uf).toUpperCase())}</State>`
            + `<City>${cdata(i.cidade)}</City><Neighborhood>${cdata(i.bairro)}</Neighborhood>`
            + (i.site_localizacao && i.logradouro ? `<Address>${cdata(i.logradouro)}</Address>` : "")
            + (i.site_localizacao ? t("StreetNumber", i.numero) : "")
            + (i.site_localizacao && i.complemento ? `<Complement>${cdata(i.complemento)}</Complement>` : "")
            + t("PostalCode", digitos(i.cep))
            + (i.site_localizacao && num(i.latitude) !== null ? t("Latitude", num(i.latitude)) + t("Longitude", num(i.longitude)) : "")
            + `</Location>`
            + `<ContactInfo>${c.nome ? `<Name>${cdata(c.nome)}</Name>` : ""}${t("Email", c.email)}${t("Website", c.site)}${t("Telephone", c.telefone)}</ContactInfo>`
            + `</Listing>`;
    }

    // dados = retorno de _portais_feed; ctx = { fotoUrl(imovel, path), agora }
    function montarVrsync(dados, ctx) {
        const cart = (dados && dados.carteira) || {};
        const contato = Object.assign({}, cart.contato || {}, { site: cart.site || null });
        if (!contato.nome) contato.nome = cart.nome;
        const c2 = Object.assign({}, ctx || {}, { contato });
        const itens = [], fora = [];
        for (const i of (dados && dados.imoveis) || []) {
            const v = validarVrsync(i, c2);
            if (v.erros.length) { fora.push({ listing_id: i.listing_id, codigo: i.codigo, erros: v.erros }); continue; }
            itens.push({ listing_id: i.listing_id, codigo: i.codigo, xml: listingVrsync(i, c2), avisos: v.avisos });
        }
        const agora = (ctx && ctx.agora) || new Date();
        const t = (n, v) => v ? `<${n}>${esc(v)}</${n}>` : "";
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
            + `<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">\n`
            + `<Header>${t("Provider", "SKL Geo Soluções")}${t("Email", contato.email)}${t("ContactName", contato.nome)}${t("PublishDate", agora.toISOString().slice(0, 19))}${t("Telephone", contato.telefone)}</Header>\n`
            + `<Listings>\n${itens.map(x => x.xml).join("\n")}\n</Listings>\n</ListingDataFeed>\n`;
        return { xml, itens, fora };
    }

    // ------------------------------------------------------------------ Chaves na Mão
    function finalidadeCnm(i) { const c = classe(i); return c === "rural" ? "RU" : c === "comercial" ? "CO" : "RE"; }
    function tipoCnm(i) {
        const t = norm(i.tipo_imovel), c = classe(i);
        if (c === "rural") return /fazenda|haras|area rural/.test(t) ? "Fazenda" : "Sítio / Chácara";
        if (c === "terreno") return /comercial/.test(t) ? "Terreno comercial" : /condominio/.test(t) ? "Terreno em Condomínio" : "Terreno / Lote";
        if (c === "comercial") {
            if (/sala|escritorio|consultorio|conjunto/.test(t)) return "Conj. Comercial / Sala";
            if (/galpao|barracao|deposito/.test(t)) return "Galpão / Depósito";
            if (/garagem/.test(t)) return "Garagem";
            if (/predio/.test(t)) return "Prédio";
            if (/casa|sobrado/.test(t)) return "Casa / Sobrado Comercial";
            return "Ponto Comercial";
        }
        if (/cobertura/.test(t)) return "Cobertura";
        if (/flat/.test(t)) return "Flat";
        if (/kitnet|studio|estudio|quitinete/.test(t)) return "Kitnet / Stúdio";
        if (/loft/.test(t)) return "Loft";
        if (/apart/.test(t)) return "Apartamento";
        if (/condominio/.test(t)) return "Casa / Sobrado em Condomínio";
        if (/casa|sobrado/.test(t)) return "Casa / Sobrado";
        return null;
    }
    function validarCnm(i) {
        const erros = [], avisos = [];
        if (!i.listing_id) erros.push("sem referência (ListingID)");
        const tipo = tipoCnm(i);
        if (!tipo) erros.push(`tipo "${sem(i.tipo_imovel) || "—"}" sem correspondência na lista do Chaves na Mão`);
        const tr = transacoes(i);
        if (tr.venda && !positivo(i.valor_venda)) erros.push("valor de venda não informado");
        if (tr.aluguel && !positivo(i.valor_aluguel)) erros.push("valor do aluguel não informado");
        if (!UFS.includes(sem(i.uf).toUpperCase())) erros.push("UF ausente ou inválida");
        if (!sem(i.cidade).trim()) erros.push("cidade não informada");
        if (!sem(i.bairro).trim()) erros.push("bairro não informado");
        const desc = textoPuro(i.descricao);
        if (!desc) erros.push("descrição (descritivo) obrigatória");
        if (desc.length > 3000) erros.push(`descrição com ${desc.length} caracteres (máximo 3.000)`);
        const f = fotosValidas(i, [ "jpg", "jpeg", "webp" ]);
        if (!f.aceitas.length) avisos.push("sem fotos JPG/WEBP");
        if (f.aceitas.length > 30) avisos.push(`${f.aceitas.length} fotos: o Chaves na Mão usa só as 30 primeiras`);
        if (f.todas.length > f.aceitas.length) avisos.push(`${f.todas.length - f.aceitas.length} foto(s) PNG ou de outro formato ficam de fora`);
        if (classe(i) === "rural") avisos.push("imóvel rural: finalidade RU; \"Fazenda\" aparece na lista comercial do portal — confirmar com o suporte do Chaves na Mão");
        if (i.valor_a_partir) avisos.push("\"a partir de\" não existe no layout: o portal mostra o valor exato");
        return { erros, avisos, tipo };
    }
    function imovelCnm(i, ctx) {
        const tr = transacoes(i);
        const fotoUrl = (ctx && ctx.fotoUrl) || (p => p);
        const fotos = fotosValidas(i, [ "jpg", "jpeg", "webp" ]).aceitas.slice(0, 30);
        const cls = classe(i);
        const area = num(areaM2(i));
        const vazio = v => (v === null || v === undefined || v === "") ? "" : esc(v);
        const dec = v => { const n = num(v); return n === null || n <= 0 ? "" : String(Math.round(n * 100) / 100); };
        const int0 = v => { const n = inteiro(v); return n === null ? "" : String(n); };
        const mostrar = !!i.site_localizacao;
        const tag = (n, v) => `<${n}>${v}</${n}>`;
        const iptuAnual = positivo(i.valor_iptu) ? dec(i.valor_iptu) : "";
        return "<imovel>"
            + tag("referencia", esc(i.listing_id)) + tag("codigo_cliente", vazio(i.codigo)) + tag("link_cliente", "")
            + tag("titulo", cdata(textoPuro(i.nome).slice(0, 120)))
            + tag("transacao", tr.venda ? "V" : "L") + tag("transacao2", tr.ambos ? "L" : "")
            + tag("finalidade", finalidadeCnm(i)) + tag("finalidade2", "")
            + tag("destaque", i.destaque ? "1" : "0")
            + tag("tipo", esc(tipoCnm(i) || "")) + tag("tipo2", "")
            + tag("valor", dec(tr.venda ? i.valor_venda : i.valor_aluguel)) + tag("valor_locacao", tr.ambos ? dec(i.valor_aluguel) : "")
            + tag("valor_iptu", iptuAnual) + tag("valor_condominio", positivo(i.valor_condominio) ? dec(i.valor_condominio) : "")
            + tag("area_total", (cls === "rural" || cls === "terreno") && area ? dec(area) : "")
            + tag("area_util", cls !== "rural" && cls !== "terreno" && area ? dec(area) : "")
            + tag("conservacao", "")
            + tag("quartos", int0(i.quartos)) + tag("suites", int0(i.suites)) + tag("garagem", int0(i.vagas)) + tag("banheiro", int0(i.banheiros))
            + tag("closet", "") + tag("salas", int0(i.salas)) + tag("despensa", "") + tag("bar", "") + tag("cozinha", "") + tag("quarto_empregada", "")
            + tag("escritorio", "") + tag("area_servico", "") + tag("lareira", "") + tag("varanda", "") + tag("lavanderia", "") + tag("aceita_pet", "")
            + tag("estado", esc(sem(i.uf).toUpperCase())) + tag("cidade", cdata(i.cidade)) + tag("bairro", cdata(i.bairro))
            + tag("cep", mostrar ? digitos(i.cep).slice(0, 9) : "")
            + tag("endereco", mostrar && i.logradouro ? cdata(sem(i.logradouro).slice(0, 200)) : "")
            + tag("numero", mostrar ? esc(sem(i.numero).slice(0, 10)) : "")
            + tag("complemento", mostrar && i.complemento ? cdata(sem(i.complemento).slice(0, 20)) : "")
            + tag("esconder_endereco_imovel", mostrar ? "0" : "1")
            + tag("descritivo", cdata(textoPuro(i.descricao).slice(0, 3000)))
            + "<fotos_imovel>" + fotos.map(p => `<foto><url>${esc(fotoUrl(i, p))}</url><data_atualizacao>${dataCnm(i.updated_at)}</data_atualizacao></foto>`).join("") + "</fotos_imovel>"
            + tag("data_atualizacao", dataCnm(i.updated_at))
            + tag("latitude", mostrar && num(i.latitude) !== null ? String(num(i.latitude)) : "")
            + tag("longitude", mostrar && num(i.longitude) !== null ? String(num(i.longitude)) : "")
            + tag("video", "") + tag("tour_360", "") + "<area_comum></area_comum><area_privativa></area_privativa>"
            + tag("aceita_troca", "") + tag("periodo_locacao", tr.aluguel && !tr.ambos ? "1" : tr.ambos ? "1" : "")
            + "</imovel>";
    }
    function montarCnm(dados, ctx) {
        const itens = [], fora = [];
        for (const i of (dados && dados.imoveis) || []) {
            const v = validarCnm(i);
            if (v.erros.length) { fora.push({ listing_id: i.listing_id, codigo: i.codigo, erros: v.erros }); continue; }
            itens.push({ listing_id: i.listing_id, codigo: i.codigo, xml: imovelCnm(i, ctx), avisos: v.avisos });
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Document>\n<imoveis>\n${itens.map(x => x.xml).join("\n")}\n</imoveis>\n</Document>\n`;
        return { xml, itens, fora };
    }

    // ------------------------------------------------------------------ MF Rural (sem API oficial → cadastro manual)
    const BRL = v => num(v) === null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    function validarMfRural(i) {
        const erros = [], avisos = [ "SEM API OFICIAL CONFIRMADA / PUBLICAÇÃO MANUAL: o anúncio é cadastrado à mão no site do MF Rural" ];
        if (classe(i) !== "rural") erros.push("o MF Rural é para imóveis rurais (marque \"Tipo de área: Rural\" no cadastro)");
        if (!positivo(areaM2(i))) erros.push("área não informada");
        const tr = transacoes(i);
        if (tr.venda && !positivo(i.valor_venda)) erros.push("valor de venda não informado");
        if (!tr.venda && tr.aluguel && !positivo(i.valor_aluguel)) erros.push("valor de arrendamento/locação não informado");
        if (!sem(i.cidade).trim() || !sem(i.uf).trim()) erros.push("cidade/UF não informadas");
        if (!(i.fotos || []).length) avisos.push("sem fotos para anexar");
        return { erros, avisos };
    }
    // texto pronto para copiar; NUNCA leva matrícula, CAR, CCIR, ITR, proprietário ou perímetro (KML)
    function fichaMfRural(i) {
        const area = num(areaM2(i));
        const ha = area ? area / 10000 : null;
        const tr = transacoes(i);
        const linhas = [
            `Título: ${textoPuro(i.nome)}`,
            `Categoria sugerida: Fazendas / Imóveis Rurais${!tr.venda && tr.aluguel ? " → Arrendamentos" : ""}`,
            `Tipo: ${sem(i.tipo_imovel)}`,
            ha ? `Área: ${ha.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha (${Math.round(area).toLocaleString("pt-BR")} m²)` : "",
            i.area_unidade && i.area_unidade !== "m2" && i.area_unidade !== "ha" && num(i.area_valor) ? `Área no cadastro: ${num(i.area_valor).toLocaleString("pt-BR")} (${i.area_unidade})` : "",
            tr.venda && positivo(i.valor_venda) ? `Valor de venda: ${BRL(i.valor_venda)}${i.valor_a_partir ? " (a partir de)" : ""}` : "",
            !tr.venda && tr.aluguel && positivo(i.valor_aluguel) ? `Valor: ${BRL(i.valor_aluguel)}` : "",
            ha && tr.venda && positivo(i.valor_venda) ? `Valor por hectare: ${BRL(Number(i.valor_venda) / ha)}` : "",
            `Localização: ${[ i.bairro, i.cidade, sem(i.uf).toUpperCase() ].filter(Boolean).join(" · ")}`,
            (i.benfeitorias || []).length ? `Benfeitorias: ${(i.benfeitorias || []).map(b => typeof b === "string" ? b : b && b.nome).filter(Boolean).join(", ")}` : "",
            i.codigo ? `Código interno: ${i.codigo}` : "",
            "",
            "Descrição:",
            textoPuro(i.descricao)
        ];
        return linhas.filter((l, k) => l !== "" || k === 11).join("\n");
    }

    // ------------------------------------------------------------------ despacho
    function validarCanal(canal, i, ctx) {
        if (canal === "grupo_olx") return validarVrsync(i, Object.assign({ semListingId: true }, ctx || {}));
        if (canal === "chavesnamao") return validarCnm(Object.assign({}, i, { listing_id: i.listing_id || "PREVIA" }));
        if (canal === "mfrural") return validarMfRural(i);
        if (canal === "imovelweb") return { erros: [ "Imovelweb sem especificação oficial obtida para a SKL: integração aguardando o portal" ], avisos: [] };
        return { erros: [ "canal desconhecido" ], avisos: [] };
    }

    raiz.SKLPortaisConectores = {
        VERSAO, PORTAIS, CANAIS, UFS,
        classe, transacoes, textoPuro, extensao,
        tipoVrsync, validarVrsync, listingVrsync, montarVrsync,
        tipoCnm, finalidadeCnm, validarCnm, imovelCnm, montarCnm,
        validarMfRural, fichaMfRural, validarCanal
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
