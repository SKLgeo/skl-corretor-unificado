// Imóveis rurais: unidades de área (m², hectare, alqueires), leitura do perímetro em KML/KMZ (sem biblioteca externa:
// o KMZ é um .zip e é aberto com DecompressionStream), área calculada do polígono e exportação de volta para KML.
// O perímetro é guardado em construcoes.perimetro como geometria GeoJSON (Polygon ou MultiPolygon, [lng, lat]).
(function () {
    "use strict";
    // fator = metros quadrados por unidade (mesma tabela da função area_fator do banco)
    const UNIDADES = {
        m2: { sigla: "m²", nome: "Metros quadrados (m²)", fator: 1 },
        ha: { sigla: "ha", nome: "Hectares (ha)", fator: 10000 },
        alq_mineiro: { sigla: "alq. goiano", nome: "Alqueire goiano / mineiro (4,84 ha)", fator: 48400 },
        alq_paulista: { sigla: "alq. paulista", nome: "Alqueire paulista (2,42 ha)", fator: 24200 },
        alq_baiano: { sigla: "alq. baiano", nome: "Alqueire baiano (9,68 ha)", fator: 96800 },
        alq_norte: { sigla: "alq. do Norte", nome: "Alqueire do Norte (2,72 ha)", fator: 27225 }
    };
    const TIPOS_RURAIS = [ "Fazenda", "Sítio", "Chácara rural", "Haras", "Rancho", "Área rural", "Terreno rural" ];
    const MAX_PONTOS = 4000;

    const numero = (v, casas) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas == null ? 2 : casas });
    const fator = u => (UNIDADES[u] || UNIDADES.m2).fator;

    // Área para mostrar. Urbano (casa, apto, lote, terreno): sempre em m². Rural: na unidade do cadastro, com o número
    // exato (até 4 casas, ex.: "4,6064 ha"), sem arredondar.
    function areaTexto(c) {
        if (!c) return "";
        const u = c.rural && c.area_unidade && UNIDADES[c.area_unidade] ? c.area_unidade : "m2";
        if (u !== "m2" && c.area_valor != null && Number(c.area_valor) > 0) return `${numero(c.area_valor, 4)} ${UNIDADES[u].sigla}`;
        return Number(c.area_m2) > 0 ? `${numero(c.area_m2, c.rural ? 4 : 2)} m²` : "";
    }
    // A mesma área em outra unidade, até 4 casas (23,4571 ha → 234.571 m²)
    function converter(valor, de, para) {
        const n = Number(valor);
        if (!Number.isFinite(n)) return null;
        return Math.round(n * fator(de) / fator(para) * 10000) / 10000;
    }
    // "= 48,4 ha · 10 alq. goiano · 20 alq. paulista · 484.000 m²" — a mesma área nas outras unidades usuais (até 4 casas)
    function conversaoTexto(m2, unidadeAtual) {
        if (!(m2 > 0)) return "";
        const partes = [];
        if (unidadeAtual !== "ha") partes.push(`${numero(m2 / 10000, 4)} ha`);
        if (unidadeAtual !== "alq_mineiro" && m2 >= 4840) partes.push(`${numero(m2 / 48400, 4)} alq. goiano`);
        if (unidadeAtual !== "alq_paulista" && m2 >= 2420) partes.push(`${numero(m2 / 24200, 4)} alq. paulista`);
        if (unidadeAtual !== "m2") partes.push(`${numero(m2, 4)} m²`);
        return partes.length ? "= " + partes.join(" · ") : "";
    }

    // ------------------------------------------------------------------ KMZ (zip) → texto do KML
    async function inflar(bytes) {
        if (typeof DecompressionStream === "undefined") throw new Error("Este aparelho não abre KMZ. Envie o arquivo .kml.");
        const stream = new Blob([ bytes ]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async function kmlDoKmz(buffer) {
        const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
        let fim = -1;
        for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
        }
        if (fim < 0) throw new Error("Arquivo KMZ inválido.");
        const total = dv.getUint16(fim + 10, true);
        let p = dv.getUint32(fim + 16, true);
        const entradas = [];
        for (let k = 0; k < total && dv.getUint32(p, true) === 0x02014b50; k++) {
            const metodo = dv.getUint16(p + 10, true), tamanho = dv.getUint32(p + 20, true);
            const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
            const local = dv.getUint32(p + 42, true);
            const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLen));
            entradas.push({ nome, metodo, tamanho, local });
            p += 46 + nLen + xLen + cLen;
        }
        const kmls = entradas.filter(e => /\.kml$/i.test(e.nome));
        const e = kmls.find(x => /(^|\/)doc\.kml$/i.test(x.nome)) || kmls[0];
        if (!e) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
        const ini = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        const dados = u8.subarray(ini, ini + e.tamanho);
        const bytes = e.metodo === 0 ? dados : e.metodo === 8 ? await inflar(dados) : null;
        if (!bytes) throw new Error("Compactação do KMZ não suportada.");
        return new TextDecoder().decode(bytes);
    }

    // ------------------------------------------------------------------ KML → GeoJSON (só áreas)
    function lerCoordenadas(texto) {
        return String(texto || "").trim().split(/\s+/).map(t => t.split(",").map(Number))
            .filter(p => p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
            .map(p => [ Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7 ]);
    }
    function fecharAnel(anel) {
        if (anel.length && (anel[0][0] !== anel[anel.length - 1][0] || anel[0][1] !== anel[anel.length - 1][1])) anel.push(anel[0].slice());
        return anel;
    }
    const filhos = (el, nome) => [ ...el.getElementsByTagNameNS("*", nome) ];
    function kmlParaGeometria(texto) {
        const doc = new DOMParser().parseFromString(texto, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) throw new Error("O arquivo KML está com erro e não pôde ser lido.");
        const poligonos = [];
        filhos(doc, "Polygon").forEach(pg => {
            const externo = filhos(pg, "outerBoundaryIs")[0];
            const anel = externo && lerCoordenadas((filhos(externo, "coordinates")[0] || {}).textContent);
            if (!anel || anel.length < 3) return;
            const furos = filhos(pg, "innerBoundaryIs").map(ib => fecharAnel(lerCoordenadas((filhos(ib, "coordinates")[0] || {}).textContent))).filter(a => a.length >= 4);
            poligonos.push([ fecharAnel(anel), ...furos ]);
        });
        // perímetro desenhado como linha fechada (comum em arquivos de topógrafo)
        if (!poligonos.length) {
            filhos(doc, "LineString").forEach(ls => {
                const linha = lerCoordenadas((filhos(ls, "coordinates")[0] || {}).textContent);
                if (linha.length >= 3) poligonos.push([ fecharAnel(linha) ]);
            });
        }
        if (!poligonos.length) throw new Error("Não achei nenhuma área (polígono) no arquivo. Confira se o KML tem o perímetro desenhado.");
        // arquivos muito detalhados: reduz os pontos para caber no cadastro
        const totalPontos = poligonos.reduce((s, pg) => s + pg.reduce((t, a) => t + a.length, 0), 0);
        if (totalPontos > MAX_PONTOS) {
            const passo = Math.ceil(totalPontos / MAX_PONTOS);
            poligonos.forEach(pg => pg.forEach((anel, i) => {
                const reduzido = anel.filter((_, k) => k % passo === 0 || k === anel.length - 1);
                if (reduzido.length >= 4) pg[i] = fecharAnel(reduzido.slice(0, -1));
            }));
        }
        return poligonos.length === 1 ? { type: "Polygon", coordinates: poligonos[0] } : { type: "MultiPolygon", coordinates: poligonos };
    }

    async function lerArquivo(arquivo) {
        if (!arquivo) throw new Error("Nenhum arquivo escolhido.");
        if (arquivo.size > 25 * 1024 * 1024) throw new Error("Arquivo maior que 25 MB.");
        const buffer = await arquivo.arrayBuffer();
        const u8 = new Uint8Array(buffer);
        const ehZip = u8[0] === 0x50 && u8[1] === 0x4b;
        const texto = ehZip ? await kmlDoKmz(buffer) : new TextDecoder().decode(u8);
        return kmlParaGeometria(texto);
    }

    // ------------------------------------------------------------------ área, centro e exportação
    const rad = g => g * Math.PI / 180;
    // Área de um anel em m²: projeção local no elipsoide WGS84 (raios de curvatura na latitude média) + fórmula do laço.
    // Para áreas do tamanho de imóveis o erro fica bem abaixo de 0,1%.
    function areaAnel(anel) {
        const a = 6378137, e2 = 0.00669437999014;
        const lat0 = rad(anel.reduce((s, p) => s + p[1], 0) / anel.length);
        const w = 1 - e2 * Math.sin(lat0) ** 2;
        const M = a * (1 - e2) / Math.pow(w, 1.5), N = a / Math.sqrt(w);
        let s = 0;
        for (let i = 0; i < anel.length - 1; i++) {
            const x1 = rad(anel[i][0]) * N * Math.cos(lat0), y1 = rad(anel[i][1]) * M;
            const x2 = rad(anel[i + 1][0]) * N * Math.cos(lat0), y2 = rad(anel[i + 1][1]) * M;
            s += x1 * y2 - x2 * y1;
        }
        return Math.abs(s / 2);
    }
    function poligonosDe(g) {
        if (!g) return [];
        return g.type === "Polygon" ? [ g.coordinates ] : g.type === "MultiPolygon" ? g.coordinates : [];
    }
    function areaM2(g) {
        return poligonosDe(g).reduce((s, pg) => s + Math.max(0, areaAnel(pg[0]) - pg.slice(1).reduce((t, a) => t + areaAnel(a), 0)), 0);
    }
    function centro(g) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        poligonosDe(g).forEach(pg => pg[0].forEach(([ x, y ]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
        return isFinite(minX) ? { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 } : null;
    }
    function paraKml(g, nome) {
        const esc = v => String(v || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const anel = a => `<LinearRing><coordinates>${a.map(([ x, y ]) => `${x},${y},0`).join(" ")}</coordinates></LinearRing>`;
        const pols = poligonosDe(g).map(pg => `<Polygon><outerBoundaryIs>${anel(pg[0])}</outerBoundaryIs>${pg.slice(1).map(a => `<innerBoundaryIs>${anel(a)}</innerBoundaryIs>`).join("")}</Polygon>`);
        return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(nome)}</name>
<Style id="area"><LineStyle><color>ff00d4ff</color><width>3</width></LineStyle><PolyStyle><color>4000d4ff</color></PolyStyle></Style>
<Placemark><name>${esc(nome)}</name><styleUrl>#area</styleUrl>${pols.length > 1 ? `<MultiGeometry>${pols.join("")}</MultiGeometry>` : pols.join("")}</Placemark></Document></kml>`;
    }
    // Baixa o perímetro como .kml (Google Earth, GPS de campo, etc.). No app Android usa a ponte nativa.
    function baixarKml(c) {
        if (!c || !c.perimetro) return;
        const nome = (c.codigo ? c.codigo + "_" : "") + String(c.nome || "area").replace(/[^\w.-]+/g, "_").slice(0, 60) + ".kml";
        const kml = paraKml(c.perimetro, c.nome || "Área");
        if (window.NativeBridge && typeof window.NativeBridge.saveTextFile === "function") {
            try { window.NativeBridge.saveTextFile(btoa(unescape(encodeURIComponent(kml))), nome, "application/vnd.google-earth.kml+xml"); return; } catch (e) { /* segue para o download comum */ }
        }
        const url = URL.createObjectURL(new Blob([ kml ], { type: "application/vnd.google-earth.kml+xml" }));
        const a = document.createElement("a");
        a.href = url; a.download = nome;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    function camada(L, g, opcoes) {
        return L.geoJSON(g, { style: Object.assign({ color: "#f5b400", weight: 3, fillColor: "#f5d000", fillOpacity: 0.18 }, opcoes || {}), interactive: false });
    }

    window.SKLRural = { UNIDADES, TIPOS_RURAIS, fator, converter, areaTexto, conversaoTexto, lerArquivo, areaM2, centro, paraKml, baixarKml, camada };
})();
