// Zoom só nas fotos: a página não amplia (pinça, Ctrl + roda do mouse, Ctrl + / Ctrl -), e na foto em tela cheia
// dá para ampliar com dois dedos, com a roda do mouse ou com duplo toque/clique, e arrastar a foto ampliada.
(function () {
    "use strict";
    const ESCALA_MAX = 5;

    // trava o zoom do sistema; dentro de [data-zoom-foto] quem cuida é o próprio zoom da foto
    function travarPagina() {
        const naFoto = el => !!(el && el.closest && el.closest("[data-zoom-foto]"));
        document.addEventListener("wheel", e => { if (e.ctrlKey && !naFoto(e.target)) e.preventDefault(); }, { passive: false });
        document.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && [ "+", "=", "-", "_", "0" ].includes(e.key)) e.preventDefault();
        });
        // Safari (iPhone/iPad) ignora o "user-scalable=no": a pinça é barrada aqui
        [ "gesturestart", "gesturechange", "gestureend" ].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
        document.addEventListener("touchmove", e => { if (e.touches.length > 1 && !naFoto(e.target)) e.preventDefault(); }, { passive: false });
        // se o iPhone ampliou mesmo assim (ao tocar num campo), volta ao tamanho normal quando sai do campo
        document.addEventListener("focusout", () => setTimeout(desfazerZoom, 80));
        window.addEventListener("orientationchange", () => setTimeout(desfazerZoom, 300));
        // tela ampliada fora de um campo (a pinça está travada, então a pessoa não conseguiria afastar): volta sozinha
        const campoAtivo = () => { const el = document.activeElement; return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); };
        let espera = null;
        if (window.visualViewport) window.visualViewport.addEventListener("resize", () => {
            clearTimeout(espera);
            espera = setTimeout(() => { if (!campoAtivo()) desfazerZoom(); }, 400);
        });
        window.addEventListener("pageshow", () => setTimeout(desfazerZoom, 300));
        document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(desfazerZoom, 300); });
    }
    function desfazerZoom() {
        const vv = window.visualViewport;
        const cel = window.SKLCelular;
        const base = cel && cel.escalaBase ? cel.escalaBase() : 1; // no celular em pé a escala normal é maior que 1 (celular.js)
        if (!vv || vv.scale <= base * 1.01) return;
        if (cel && cel.reaplicarViewport) { cel.reaplicarViewport(); return; }
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        const original = meta.getAttribute("content");
        meta.setAttribute("content", original.replace(/,?\s*maximum-scale=[^,]*/, "") + ", maximum-scale=1.0");
        setTimeout(() => meta.setAttribute("content", original), 60);
    }

    // liga o zoom numa <img>; devolve { reset(), ampliado() } (ampliado = não trocar de foto ao arrastar)
    function ligar(img) {
        let s = 1, tx = 0, ty = 0, gesto = false;
        const ponteiros = new Map();
        let pinca = null, arrasto = null, ultimoToque = 0;
        img.setAttribute("data-zoom-foto", "");
        img.style.touchAction = "none";
        img.style.transformOrigin = "50% 50%";
        img.draggable = false;

        function aplicar() {
            if (s <= 1.001) { s = 1; tx = 0; ty = 0; }
            const r = img.getBoundingClientRect();
            const w = r.width / s, hgt = r.height / s;           // tamanho sem zoom
            const mx = Math.max(0, (w * s - w) / 2), my = Math.max(0, (hgt * s - hgt) / 2);
            tx = Math.max(-mx, Math.min(mx, tx));
            ty = Math.max(-my, Math.min(my, ty));
            img.style.transform = s === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${s})`;
            img.style.cursor = s > 1 ? "grab" : "zoom-in";
        }
        // amplia mantendo o ponto (px, py) da tela parado sob o dedo/cursor
        function zoomEm(novo, px, py) {
            novo = Math.max(1, Math.min(ESCALA_MAX, novo));
            const r = img.getBoundingClientRect();
            const cx = r.left + r.width / 2 - tx, cy = r.top + r.height / 2 - ty; // centro sem deslocamento
            const k = novo / s;
            tx = (px - cx) - (px - cx - tx) * k;
            ty = (py - cy) - (py - cy - ty) * k;
            s = novo;
            aplicar();
        }
        img.addEventListener("wheel", e => {
            e.preventDefault();
            zoomEm(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
        }, { passive: false });
        img.addEventListener("dblclick", e => { e.preventDefault(); zoomEm(s > 1 ? 1 : 2.5, e.clientX, e.clientY); });
        img.addEventListener("pointerdown", e => {
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            img.setPointerCapture(e.pointerId);
            if (ponteiros.size === 2) {
                const [ a, b ] = [ ...ponteiros.values() ];
                pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
                gesto = true;
            } else if (ponteiros.size === 1) {
                arrasto = { x: e.clientX, y: e.clientY, tx, ty };
                if (e.pointerType === "touch") {
                    const agora = Date.now();
                    if (agora - ultimoToque < 300) { zoomEm(s > 1 ? 1 : 2.5, e.clientX, e.clientY); gesto = true; }
                    ultimoToque = agora;
                }
            }
        });
        img.addEventListener("pointermove", e => {
            if (!ponteiros.has(e.pointerId)) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinca && ponteiros.size >= 2) {
                const [ a, b ] = [ ...ponteiros.values() ];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinca.d > 0) zoomEm(pinca.s * d / pinca.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
            } else if (arrasto && s > 1) {
                tx = arrasto.tx + (e.clientX - arrasto.x);
                ty = arrasto.ty + (e.clientY - arrasto.y);
                aplicar();
                gesto = true;
            }
        });
        const soltar = e => {
            ponteiros.delete(e.pointerId);
            if (ponteiros.size < 2) pinca = null;
            if (ponteiros.size === 0) { arrasto = null; setTimeout(() => { gesto = false; }, 50); }
            else if (ponteiros.size === 1) { const [ p ] = [ ...ponteiros.values() ]; arrasto = { x: p.x, y: p.y, tx, ty }; }
        };
        img.addEventListener("pointerup", soltar);
        img.addEventListener("pointercancel", soltar);
        aplicar();
        return {
            reset() { s = 1; tx = 0; ty = 0; aplicar(); },
            ampliado() { return s > 1.01 || gesto || ponteiros.size > 1; }
        };
    }

    window.SKLZoomFoto = { travarPagina, ligar };
})();
