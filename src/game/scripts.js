window.addEventListener("load", function(){
    //canvas setup
    const canvas = document.getElementById("canvas1"); // Define canvas
    const ctx = canvas.getContext("2d"); // Define context -- Hardware-accelerated by the GPU in all modern browsers (Chrome, Firefox, Edge) and Electron
    canvas.width = 1280; // Set canvas width (adjust as needed)
    canvas.height = 720; // Set canvas height (adjust as needed)

    //START ALPHA CHANGE 496 -- add AssetsLoading skeleton (Design 2: warm-up + keep cache) --
    class AssetsLoading { // let's turn JavaScript into a high performance rendering engine -- optimizing memory management for modern hardware as if we were developing on 90s consoles -- 
        //solving the garbage collection issue by creating a static memory pattern -- zero allocation during execution -- stable 60+fps gameplay 
        
        //Align constructor signature with Game usage (no required ctx args) --
        constructor(game) {
            this.game = game;
            this.canvas = (game && game.canvas) ? game.canvas : null; // use Game’s canvas
            this.ctx = null; // we’ll create/use our own offscreen warming ctx in later steps

            //Create persistent offscreen warm-up surface (Design 2 keep-cache) --
            this.warmCanvas = null;
            this.warmCtx = null;
            try {
                const w = (this.canvas && this.canvas.width) ? this.canvas.width : ((game && game.width) ? game.width : 1);
                const h = (this.canvas && this.canvas.height) ? this.canvas.height : ((game && game.height) ? game.height : 1);

                if (typeof OffscreenCanvas === "function") {
                    this.warmCanvas = new OffscreenCanvas(w, h);
                    this.warmCtx = this.warmCanvas.getContext("2d");
                } else {
                    const c = document.createElement("canvas");
                    c.width = w;
                    c.height = h;
                    this.warmCanvas = c;
                    this.warmCtx = c.getContext("2d");
                }
            } catch (e) {
                this.warmCanvas = null;
                this.warmCtx = null;
                this.lastError = e;
            }
            //Create persistent offscreen warm-up surface (Design 2 keep-cache) --

            // Design 2: our own persistent cache (CanvasImageSource like ImageBitmap/OffscreenCanvas)
            this.cache = new Map(); // key -> render-ready source

            //START ALPHA CHANGE 590 -- AssetsLoading: store scaled-sheet sampling META (single source of truth)
            this.sheetMeta = new Map(); // key -> { stride, strideX, strideY, srcW, srcH, offX, offY } ALPHA CHANGE 608 (added strideX/strideY for non-square images )
            //NOTE: for square sheets, strideX/strideY may be omitted and 'stride' is used --
            //FINISH ALPHA CHANGE 590 -- AssetsLoading: store scaled-sheet sampling META

            // Task queue for warm-up steps (we'll fill this in later steps)
            this.tasks = [];
            this.totalTasks = 0;
            this.completedTasks = 0;

            this.isComplete = false;
            this.lastError = null;
            this.currentLabel = "";
        }

        addTask(label, fn) {
            this.tasks.push({ label: String(label || ""), fn });
            this.totalTasks = this.tasks.length;
        }

        //Build task list for all DOM <img> assets (from index.html) --
        buildTasks() {
            // reset
            this.tasks = [];
            this.totalTasks = 0;
            this.completedTasks = 0;
            this.isComplete = false;
            this.lastError = null;
            this.currentLabel = "";

            const ids = [
                // characters
                "player",
                "playerPowerup",
                "angler1",
                "angler2",
                "lucky",
                "hivewhale",
                "drone",
                "bulbwhale",
                "moonfish",
                "razorfin",
                "stalker",
                "missile",
                // props
                "gears",
                "Explosion", // ALPHA CHANGE 539 -- AssetsLoading: include unified Explosion sheet in warm-up list --
                "shield",
                "fireball",
                "fireball2", // ALPHA CHANGE 534 -- AssetsLoading: include fireball2 in warm-up list --
                // environment
                "layer1",
                "layer2",
                "layer3",
                "layer4",
                "lamp1",
                "lamp2",
                "lamp3",
                "lamp4",
                "lamp5",
                "lamp6",
                "lamp7",
                "lamp8",
                "lamp9",
                "lamp10",
                "lamp11",
                "lamp12",
                "lamp13",
                "lamp14",
                "pipe1",
                "pipe2",
                "pipe3",
                "pipe4",
                "pipe5",
                "pipe6",
                "pipe7",
                "pipe8",
                "pipe9",
                "pipe10",
                "pipe11",
                "pipe12",
                "pipe13",
                "pipe14",
                "pipe15",
                "train",
                "mech_red",
                "mech_white",
                "mech_grey",
                "tank",
                "truck",
                "background_ship",
                // menu background
                "menuBackground",
                "menuBackgroundMultiplayer",
                "menuBackgroundOptions",
                // INNBC Universe images
                "universeAlienInvasion",
                "universeStarfighter",
                "universeLab",
                "universeScientist",
                "universeNews", //ALPHA CHANGE 525 -- AssetsLoading: include universeNews in warm-up list --
                "universeCredits"
            ];

            for (const id of ids) {

                //START ALPHA CHANGE 499 -- AssetsLoading: async decode + keep-cache (Design 2 baseline) --
                this.addTask(`asset:${id}`, () => {
                    const img = this.getImgOrThrow(id);

                    // Wait for load if decode() isn't available or fails
                    const waitForLoad = () => {
                        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                        return new Promise((resolve, reject) => {
                            const onLoad = () => resolve();
                            const onErr  = () => reject(new Error(`[AssetsLoading] <img> failed to load id=${id}`));
                            try {
                                img.addEventListener("load", onLoad, { once: true });
                                img.addEventListener("error", onErr, { once: true });
                            } catch (_) {
                                // fallback: if event listeners fail, just resolve when it looks complete
                                setTimeout(() => {
                                    (img.complete && img.naturalWidth > 0) ? resolve() : reject(new Error(`[AssetsLoading] <img> not ready id=${id}`));
                                }, 0);
                            }
                        });
                    };

                    const doDecode = () => {
                        if (typeof img.decode === "function") {
                            return img.decode().catch(() => waitForLoad());
                        }
                        return waitForLoad();
                    };

                //START ALPHA CHANGE 625 -- AssetsLoading: multi-scale sheetScaled caching for Explosion and Particles (avoid duplication) --
                const scaledSheetMultiOnly = {
                        // Explosion uses multiple fixed scales (per enemy type / network event)
                        "Explosion": { stride: 512, srcSizeW: 512, srcSizeH: 512, scales: [0.22, 0.23, 0.24, 0.25, 0.28, 0.30, 0.35, 0.39, 0.40, 0.50] },
                        //ALPHA CHANGE 630 -- gears: cache scaled sheet at 3 fixed particle sizes --
                         "gears": { stride: 768, srcSizeW: 768, srcSizeH: 768, scales: [0.02, 0.03, 0.05] },
                };

                const cacheScaledSheetMultiOnlyIfConfigured = () => {
                        const cfg = scaledSheetMultiOnly[id];
                        if (!cfg) return Promise.resolve(false);
                        if (!this.warmCtx || !this.warmCanvas) return Promise.resolve(false);
                        if (typeof createImageBitmap !== "function") return Promise.resolve(false);

                        const strideX0 = ((cfg.strideX | 0) || 0) || ((cfg.stride | 0) || 0);
                        const strideY0 = ((cfg.strideY | 0) || 0) || ((cfg.stride | 0) || 0);
                        const isSquare0 = (strideX0 > 0 && strideY0 > 0 && strideX0 === strideY0);

                        const scales = Array.isArray(cfg.scales) ? cfg.scales : [];
                        let didAny = false;

                        // run sequentially to avoid resizing warmCanvas concurrently
                        let chain = Promise.resolve();
                        for (const sRaw of scales) {
                            chain = chain.then(() => {
                                const s = Math.round(((typeof sRaw === "number" && isFinite(sRaw) && sRaw > 0) ? sRaw : 1) * 10000) / 10000;

                                // Key format matches the square-sheet consumers (Explosion is square)
                                const key = isSquare0
                                    ? `img:${id}:sheetScaled:${s}:stride:${strideX0}`
                                    : `img:${id}:sheetScaled:${s}:stride:${strideX0}x${strideY0}`;

                                // already cached?
                                if (this.getCachedIfValid && this.getCachedIfValid(key)) {
                                    didAny = true;
                                    return Promise.resolve();
                                }

                                // grid sizing
                                let cols = 1, rows = 1;
                                try {
                                    if (strideX0 > 0 && img.naturalWidth  > 0 && (img.naturalWidth  % strideX0) === 0) cols = (img.naturalWidth  / strideX0) | 0;
                                    if (strideY0 > 0 && img.naturalHeight > 0 && (img.naturalHeight % strideY0) === 0) rows = (img.naturalHeight / strideY0) | 0;
                                } catch (_) {}

                                const scaledStrideX = strideX0 > 0 ? Math.max(1, Math.round(strideX0 * s)) : 0;
                                const scaledStrideY = strideY0 > 0 ? Math.max(1, Math.round(strideY0 * s)) : 0;

                                const w = (strideX0 > 0 && cols > 1) ? (scaledStrideX * cols) : Math.max(1, Math.round(img.naturalWidth  * s));
                                const h = (strideY0 > 0 && rows > 1) ? (scaledStrideY * rows) : Math.max(1, Math.round(img.naturalHeight * s));

                                try {
                                    this.warmCanvas.width = w;
                                    this.warmCanvas.height = h;
                                } catch (_) {
                                    return Promise.resolve();
                                }

                                try {
                                    this.warmCtx.clearRect(0, 0, w, h);
                                    this.warmCtx.drawImage(img, 0, 0, w, h); // prescale sheet once
                                } catch (_) {
                                    return Promise.resolve();
                                }

                                return createImageBitmap(this.warmCanvas).then((bm) => {
                                    if (!bm) return;
                                    this.setCached(key, bm);
                                    didAny = true;

                                    // Write META (same format as scaledSheetOnly path)
                                    const scaledSrcW = Math.max(1, Math.round((cfg.srcSizeW || 0) * s));
                                    const scaledSrcH = Math.max(1, Math.round((cfg.srcSizeH || 0) * s));
                                    const offX = Math.round((scaledStrideX - scaledSrcW) / 2);
                                    const offY = Math.round((scaledStrideY - scaledSrcH) / 2);

                                    if (this.sheetMeta) {
                                        this.sheetMeta.set(key, {
                                            stride: (isSquare0 ? scaledStrideX : undefined),
                                            strideX: scaledStrideX,
                                            strideY: scaledStrideY,
                                            srcW: scaledSrcW,
                                            srcH: scaledSrcH,
                                            offX,
                                            offY
                                        });
                                    }
                                }).catch(() => {});
                            });
                        }

                        return chain.then(() => didAny).catch(() => didAny);
                };
                //FINISH ALPHA CHANGE 625 -- AssetsLoading: multi-scale sheetScaled caching for Explosion and Particles --

                //START ALPHA CHANGE 633 -- AssetsLoading: cache scaled static bitmaps for pipes (1:1 blit; avoid runtime scaling) --
                const scaledStaticOnly = {
                    // Pipes are static single images drawn at fixed sizes (see Pipe1..7 constructors)
                    "pipe1": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe2": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe3": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe4": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe5": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe6": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe7": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe8": { srcW: 768, srcH: 768, scale: 0.9 },
                    "pipe9": { srcW: 768, srcH: 768, scale: 0.9 },
                    "pipe10": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe11": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe12": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe13": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe14": { srcW: 768, srcH: 768, scale: 0.8 },
                    "pipe15": { srcW: 768, srcH: 768, scale: 0.8 }
                };

                const cacheScaledStaticOnlyIfConfigured = () => {
                    const cfg = scaledStaticOnly[id];
                    if (!cfg) return Promise.resolve(false);
                    if (!this.warmCtx || !this.warmCanvas) return Promise.resolve(false);
                    if (typeof createImageBitmap !== "function") return Promise.resolve(false);

                    const s = Math.round(((cfg.scale || 1) * 10000)) / 10000;

                    const baseW = ((cfg.srcW | 0) > 0) ? (cfg.srcW | 0) : ((img && img.naturalWidth)  ? img.naturalWidth  : 1);
                    const baseH = ((cfg.srcH | 0) > 0) ? (cfg.srcH | 0) : ((img && img.naturalHeight) ? img.naturalHeight : 1);

                    const w = Math.max(1, Math.round(baseW * s));
                    const h = Math.max(1, Math.round(baseH * s));

                    const key = `img:${id}:scaled:${w}x${h}`;

                    // already cached?
                    try {
                        if (this.getCachedIfValid && this.getCachedIfValid(key)) return Promise.resolve(true);
                    } catch (_) {}

                    try {
                        this.warmCanvas.width = w;
                        this.warmCanvas.height = h;
                    } catch (_) {
                        return Promise.resolve(false);
                    }

                    try {
                        this.warmCtx.clearRect(0, 0, w, h);
                        this.warmCtx.drawImage(img, 0, 0, w, h); // prescale once
                    } catch (_) {
                        return Promise.resolve(false);
                    }

                    return createImageBitmap(this.warmCanvas).then((bm) => {
                        if (bm) this.setCached(key, bm);
                        return !!bm;
                    }).catch(() => false);
                };
                //FINISH ALPHA CHANGE 633 -- AssetsLoading: cache scaled static bitmaps for pipes --

                //START ALPHA CHANGE 586 -- AssetsLoading: cache ONLY scaled enemy sheets (no natural bitmap) for configured ids --
                // NOTE: I add crop box here as well so AssetsLoading can be the ONLY source of truth for scaled sampling meta (save a few CPU cicles down the road)
                const scaledSheetOnly = {//must match the scale and stride of the class instances 
                        // Enemy sprite-sheets (start with Angler1; add others next)
                        "angler1": { scale: 0.7125, stride: 512, srcSizeW: 400, srcSizeH: 400 },
                        "angler2": { scale: 0.64,   stride: 512, srcSizeW: 330, srcSizeH: 290 },
                        "lucky":   { scale: 0.3,    stride: 512, srcSizeW: 320, srcSizeH: 300 },
                        "hivewhale": { scale: 1.0,  stride: 640, srcSizeW: 420, srcSizeH: 400 },
                        "drone":  { scale: 0.3833,  stride: 512, srcSizeW: 300, srcSizeH: 260 },
                        "missile":  { scale: 0.5,   stride: 607, srcSizeW: 607, srcSizeH: 301 },
                        "bulbwhale": { scale: 1.0,  stride: 512, srcSizeW: 330, srcSizeH: 330 },
                        "moonfish": { scale: 0.5537, stride: 512, srcSizeW: 410, srcSizeH: 300 },
                        "stalker":  { scale: 0.9,    stride: 512, srcSizeW: 350, srcSizeH: 350 },
                        "razorfin": { scale: 0.9,    stride: 512, srcSizeW: 320, srcSizeH: 360 },
                        //player
                        "player":   { scale: 1.0,    stride: 512, srcSizeW: 300, srcSizeH: 200 },
                        "playerPowerup": { scale: 1.0, stride: 512, srcSizeW: 300, srcSizeH: 200 },
                        "shield":   { scale: 1.05,   stride: 512, srcSizeW: 360, srcSizeH: 360 },
                        "fireball":  { scale: 0.1,    stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        "fireball2": { scale: 0.1,    stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        // Lamps use full-cell (no crop), so srcSizeW/H == strideX/Y (or stride for square)
                        "lamp1": { scale: 1,   stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp2": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp3": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp4": { scale: 1,   stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp5": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp6": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp7": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp8": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp9": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp10": { scale: 0.8, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp11": { scale: 0.8, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp12": { scale: 0.8, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp13": { scale: 0.8, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        "lamp14": { scale: 1, stride: 640, srcSizeW: 640, srcSizeH: 640 },
                        // train (7x7, full-cell 512x512) for sheetScaled+META path
                        "train": { scale: 1.0, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        // background_ship -- ALPHA CHANGE 643
                        "background_ship": { scale: 0.2, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        // add ground props (full-cell 7x7, 512 stride) --
                        "truck":     { scale: 0.6, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        "tank":      { scale: 0.6, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        "mech_red":  { scale: 0.3, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        "mech_white":{ scale: 0.3, stride: 512, srcSizeW: 512, srcSizeH: 512 },
                        "mech_grey": { scale: 0.3, stride: 512, srcSizeW: 512, srcSizeH: 512 },

                    };

                const cacheScaledSheetOnlyIfConfigured = () => {
                        const cfg = scaledSheetOnly[id];
                        if (!cfg) return Promise.resolve(false);
                        if (!this.warmCtx || !this.warmCanvas) return Promise.resolve(false);
                        if (typeof createImageBitmap !== "function") return Promise.resolve(false);

                        const s = Math.round((cfg.scale || 1) * 10000) / 10000;
                        //START ALPHA CHANGE 609 -- AssetsLoading: support non-square 7x7 sheets (strideX/strideY) --
                        const strideX = ((cfg.strideX | 0) || 0) || ((cfg.stride | 0) || 0);
                        const strideY = ((cfg.strideY | 0) || 0) || ((cfg.stride | 0) || 0);

                        const isSquare = (strideX > 0 && strideY > 0 && strideX === strideY);

                        // Key format:
                        // - square: keep legacy key (so enemies remain unchanged)
                        // - non-square: include both strides to avoid collisions
                        const key = isSquare
                            ? `img:${id}:sheetScaled:${s}:stride:${strideX}`
                            : `img:${id}:sheetScaled:${s}:stride:${strideX}x${strideY}`;
                        //FINISH ALPHA CHANGE 609 -- AssetsLoading: support non-square 7x7 sheets --

                        // Preserve exact cell grid (avoid drift across cols/rows)
                        let cols = 1, rows = 1;
                        try {
                            if (strideX > 0 && img.naturalWidth  > 0 && (img.naturalWidth  % strideX) === 0) cols = (img.naturalWidth  / strideX) | 0;
                            if (strideY > 0 && img.naturalHeight > 0 && (img.naturalHeight % strideY) === 0) rows = (img.naturalHeight / strideY) | 0;
                        } catch (_) {}

                        const scaledStrideX = strideX > 0 ? Math.max(1, Math.round(strideX * s)) : 0;
                        const scaledStrideY = strideY > 0 ? Math.max(1, Math.round(strideY * s)) : 0;

                        const w = (strideX > 0 && cols > 1) ? (scaledStrideX * cols) : Math.max(1, Math.round(img.naturalWidth  * s));
                        const h = (strideY > 0 && rows > 1) ? (scaledStrideY * rows) : Math.max(1, Math.round(img.naturalHeight * s));

                        try {
                             this.warmCanvas.width = w;
                             this.warmCanvas.height = h;
                        } catch (_) {
                            return Promise.resolve(false);
                        }

                        try {
                             this.warmCtx.clearRect(0, 0, w, h);
                             this.warmCtx.drawImage(img, 0, 0, w, h); // prescale sheet once
                        } catch (_) {
                            return Promise.resolve(false);
                        }

                        return createImageBitmap(this.warmCanvas).then((bm) => {
                            if (bm) {
                                this.setCached(key, bm);

                                //START ALPHA CHANGE 609 -- AssetsLoading: write META with strideX/strideY + scaled crop --
                                if (cfg && typeof cfg.srcSizeW === "number" && typeof cfg.srcSizeH === "number") {
                                    const scaledSrcW = Math.max(1, Math.round(cfg.srcSizeW * s));
                                    const scaledSrcH = Math.max(1, Math.round(cfg.srcSizeH * s));

                                    const scaledOffX = Math.round((scaledStrideX - scaledSrcW) / 2);
                                    const scaledOffY = Math.round((scaledStrideY - scaledSrcH) / 2);

                                    if (this.sheetMeta) {
                                        this.sheetMeta.set(key, {
                                          // keep legacy stride for square consumers
                                          stride: (isSquare ? scaledStrideX : undefined),
                                          strideX: scaledStrideX,
                                          strideY: scaledStrideY,
                                          srcW: scaledSrcW,
                                          srcH: scaledSrcH,
                                          offX: scaledOffX,
                                          offY: scaledOffY
                                        });
                                    }
                                }
                                //FINISH ALPHA CHANGE 609 -- AssetsLoading: write META with strideX/strideY + scaled crop --
                            }             
                            return !!bm; //consistent with createImageBitmap success flag ("!!bm" forces it to become a boolean: either true or false -- returns the boolean true if "bm" is truthy) -- resolve → true, reject → false, and !!bm is just defensive/consistency
                    }).catch(() => false); // → returns false if Promise rejects (Reject → return false)
                };
                //If createImageBitmap() succeeds → bm is an ImageBitmap object → truthy → "valid bitmap", If createImageBitmap() fails → goes to .catch() → never enters .then() → never checks !!bm (rejection → false)
                //FINISH ALPHA CHANGE 586 -- AssetsLoading: cache ONLY scaled enemy sheets --

                    const cacheNaturalBitmap = () => {
                        if (typeof createImageBitmap !== "function") return Promise.resolve(null);
                        return createImageBitmap(img).then((bm) => {
                            if (bm) this.setCached(`img:${id}`, bm);
                            return bm;
                        }).catch(() => null);
                    };

                    const maybeCacheScaledScreen = () => {
                        // Only do full-screen prescale for big menu/universe backgrounds (your menus draw them scaled to canvas).
                        const isScreenBg =
                            id === "menuBackground" ||
                            id === "menuBackgroundMultiplayer" ||
                            id === "menuBackgroundOptions" ||
                            id.indexOf("universe") === 0;

                        if (!isScreenBg) return Promise.resolve();

                        const w = (this.canvas && this.canvas.width) ? this.canvas.width : ((this.game && this.game.width) ? this.game.width : 1280);
                        const h = (this.canvas && this.canvas.height) ? this.canvas.height : ((this.game && this.game.height) ? this.game.height : 720);

                        if (!this.warmCtx || !this.warmCanvas) return Promise.resolve();

                        try {
                            //START ALPHA CHANGE 586a -- ensure warm canvas matches screen size (since we now resize it for sheets too) --
                            if (this.warmCanvas.width !== w) this.warmCanvas.width = w;
                            if (this.warmCanvas.height !== h) this.warmCanvas.height = h;
                            //FINISH ALPHA CHANGE 586a -- ensure warm canvas matches screen size --
                            this.warmCtx.clearRect(0, 0, w, h);
                            this.warmCtx.drawImage(img, 0, 0, w, h); // prescale into warm canvas
                        } catch (_) {
                            return Promise.resolve();
                        }

                        if (typeof createImageBitmap !== "function") return Promise.resolve();

                        return createImageBitmap(this.warmCanvas).then((bm) => {
                            if (bm) this.setCached(`img:${id}:scaled:${w}x${h}`, bm);
                        }).catch(() => {});
                    };

                    return doDecode()
                         //START ALPHA CHANGE 626 -- AssetsLoading: Explosion multi-scale uses scaledSheetMultiOnly first --
                        .then(() => cacheScaledSheetMultiOnlyIfConfigured())
                        .then((didMultiScaled) => {
                            if (didMultiScaled) return true;
                            return cacheScaledSheetOnlyIfConfigured();
                        })
                        //FINISH ALPHA CHANGE 626 -- AssetsLoading: Explosion multi-scale uses scaledSheetMultiOnly first --

                        //START ALPHA CHANGE 633 -- AssetsLoading: pipes use pre-scaled static bitmap before caching img:${id} --
                        .then((didScaled) => {
                            if (didScaled) return true;
                            return cacheScaledStaticOnlyIfConfigured();
                        })
                        //FINISH ALPHA CHANGE 633 -- AssetsLoading: pipes pre-scaled static bitmap --

                        .then((didScaled) => {
                            // If we made a scaled sheet, we DO NOT create img:${id} at all (no duplication) -- IMPORTANTE NIENTE INUTILE DUPLICAZIONE (SCALED + NON SCALED)
                            if (didScaled) return null;
                            return cacheNaturalBitmap();
                        })
                        .then(() => maybeCacheScaledScreen());
                });
                //FINISH ALPHA CHANGE 499 -- AssetsLoading: async decode + keep-cache (Design 2 baseline) --
            }
        }
        //Build task list for all DOM <img> assets (from index.html) --

        getPercent() {
            if (!this.totalTasks) return this.isComplete ? 100 : 0;
            const p = Math.round((this.completedTasks / this.totalTasks) * 100);
            return Math.max(0, Math.min(100, p));
        }

        isRenderReady() {
            return !!this.isComplete;
        }

        getCached(key) {
            return this.cache.get(key);
        }

        setCached(key, source) {
            this.cache.set(key, source);
        }

        //START ALPHA CHANGE 591 -- AssetsLoading: getter for scaled-sheet META
        getSheetMeta(key) {
            try {
                const m = this.sheetMeta && this.sheetMeta.get(key);
                if (!m) return null;

                //START ALPHA CHANGE 610 -- AssetsLoading: META validator supports strideX/strideY OR legacy stride --
                const hasLegacyStride = (typeof m.stride === "number" && m.stride > 0);
                const hasXY = (typeof m.strideX === "number" && m.strideX > 0 && typeof m.strideY === "number" && m.strideY > 0);

                if (!hasLegacyStride && !hasXY) return null;
                if (typeof m.srcW !== "number" || typeof m.srcH !== "number") return null;
                if (typeof m.offX !== "number" || typeof m.offY !== "number") return null;

                return m;
                //FINISH ALPHA CHANGE 610 -- AssetsLoading: META validator supports strideX/strideY OR legacy stride --
            } catch (_) {
                return null;
            }
        }
        //FINISH ALPHA CHANGE 591 -- AssetsLoading: getter for scaled-sheet META
        
        //core utility -- "is this cache entry valid and renderable?"
        getCachedIfValid(key) {
            try {
                const cached = this.cache.get(key);
                return this._isValidCanvasSource(cached) ? cached : null;
            } catch (_) {
                return null;
            }
        }
        //START ALPHA CHANGE 583 -- requestScaledSheet(): optional on-demand sheetScaled builder (deduped) --
        // ENGINE FEATURE (optional): Lazy creation / rebuild of cached scaled sprite-sheets.
        //
        // What it does:
        // - Builds a scaled bitmap from a DOM <img> using warmCanvas, then caches it under a deterministic key.
        // - Returns the cache KEY string (not the bitmap), so callers can fetch via getCachedOrFallback/getCachedIfValid.
        //
        // Dedupe:
        // - (1) Cache peek via getCachedIfValid(key)
        // - (2) In-flight promise map per key to prevent duplicate builds.
        //
        // Not wired in shipped game:
        // - The shipped game does NOT call requestScaledSheet() anywhere.
        // - All required sheetScaled assets are generated during the initial AssetsLoading warm-up.
        //
        // Future use:
        // - Can be wired later as a “self-heal fallback” to build missing scales at runtime.
        // - Without call sites it never runs and has zero runtime cost.
        //FINISH: note warmCanvas is shared; runtime builds are serialized via _scaleChain583.
        requestScaledSheet(id, scale, meta) {
            try {
                const imgId = String(id || "");
                if (!imgId) return null;

                const sRaw = (typeof scale === "number" && isFinite(scale) && scale > 0) ? scale : 1;
                // normalize to reduce key churn from float noise
                const s = Math.round(sRaw * 10000) / 10000;

                const stride = (meta && typeof meta.stride === "number" && meta.stride > 0) ? (meta.stride | 0) : 0;
                const key = stride
                    ? `img:${imgId}:sheetScaled:${s}:stride:${stride}`
                    : `img:${imgId}:sheetScaled:${s}`;

                // already cached?
                const already = this.getCachedIfValid(key);
                if (already) return key;

                // in-flight?
                if (!this._inFlightScaled) this._inFlightScaled = new Map();
                if (this._inFlightScaled.has(key)) return key;

                const buildScaled = () => {
                    const img = this.getImgOrThrow(imgId);

                    const waitForLoad = () => {
                        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                        return new Promise((resolve, reject) => {
                            const onLoad = () => resolve();
                            const onErr  = () => reject(new Error(`[AssetsLoading] <img> failed to load id=${imgId}`));
                            try {
                                img.addEventListener("load", onLoad, { once: true });
                                img.addEventListener("error", onErr, { once: true });
                            } catch (_) {
                                setTimeout(() => {
                                    (img.complete && img.naturalWidth > 0) ? resolve() : reject(new Error(`[AssetsLoading] <img> not ready id=${imgId}`));
                                }, 0);
                            }
                        });
                    };

                    const doDecode = () => {
                        if (typeof img.decode === "function") {
                            return img.decode().catch(() => waitForLoad());
                        }
                        return waitForLoad();
                    };

                    const doScaleToBitmap = () => {
                        if (!this.warmCanvas || !this.warmCtx) return Promise.resolve();

                        let targetW = 1, targetH = 1;

                        if (stride > 0) {
                            const cols = Math.max(1, Math.round(img.naturalWidth / stride));
                            const rows = Math.max(1, Math.round(img.naturalHeight / stride));
                            const scaledStride = Math.max(1, Math.round(stride * s));
                            targetW = Math.max(1, cols * scaledStride);
                            targetH = Math.max(1, rows * scaledStride);
                        } else {
                            targetW = Math.max(1, Math.round(img.naturalWidth  * s));
                            targetH = Math.max(1, Math.round(img.naturalHeight * s));
                        }

                        // resize warm surface to exact target; re-grab ctx if needed
                        try {
                            if (this.warmCanvas.width !== targetW) this.warmCanvas.width = targetW;
                            if (this.warmCanvas.height !== targetH) this.warmCanvas.height = targetH;
                            if (!this.warmCtx) this.warmCtx = this.warmCanvas.getContext("2d");
                        } catch (_) {}

                        try {
                            this.warmCtx.clearRect(0, 0, targetW, targetH);
                            this.warmCtx.drawImage(img, 0, 0, targetW, targetH);
                        } catch (_) {
                            return Promise.resolve();
                        }

                        if (typeof createImageBitmap !== "function") return Promise.resolve();

                        return createImageBitmap(this.warmCanvas).then((bm) => {
                            if (bm) this.setCached(key, bm);
                        }).catch(() => {});
                    };

                    return doDecode().then(() => doScaleToBitmap());
                };

                // If still in loading phase, queue into task system (non-blocking, 1 per frame).
                // If already render-ready, run async in the background (deduped + serialized).
                let p;
                if (typeof this.isRenderReady === "function" && !this.isRenderReady()) {
                    this.addTask(`sheetScaled:${imgId}:${s}`, () => buildScaled());
                    p = Promise.resolve(); // task runner will execute it
                } else {
                    if (!this._scaleChain583) this._scaleChain583 = Promise.resolve();
                    p = this._scaleChain583 = this._scaleChain583
                        .then(() => buildScaled())
                        .catch(() => {})
                        .finally(() => {});
                }

                this._inFlightScaled.set(key, p);
                // clean inflight when the promise finishes (task mode resolves immediately, but safe)
                Promise.resolve(p).finally(() => {
                    try { this._inFlightScaled.delete(key); } catch (_) {}
                });

                return key;
            } catch (_) {
                return null;
            }
        }
        //FINISH ALPHA CHANGE 583 -- requestScaledSheet(): optional on-demand sheetScaled builder (deduped) --

        //START ALPHA CHANGE 499 -- AssetsLoading: cache validation + fallback + optional self-heal rebuild --
        _isValidCanvasSource(src) {
            // Accepts ImageBitmap / OffscreenCanvas / HTMLCanvasElement / HTMLImageElement, etc.
            if (!src) return false;

            // ImageBitmap exposes width/height; canvas exposes width/height; <img> exposes naturalWidth/naturalHeight.
            const w = (typeof src.width === "number" ? src.width : 0) || (typeof src.naturalWidth === "number" ? src.naturalWidth : 0);
            const h = (typeof src.height === "number" ? src.height : 0) || (typeof src.naturalHeight === "number" ? src.naturalHeight : 0);

            return !!(w > 0 && h > 0);
        }

        _queueRebuildOnce(key, label, fn) {
            // Ensures we don't spam rebuild tasks repeatedly.
            if (!this._rebuildQueued) this._rebuildQueued = new Set();
            if (this._rebuildQueued.has(key)) return;

            this._rebuildQueued.add(key);
            this.addTask(label || (`rebuild:${key}`), () => {
                try {
                    if (typeof fn === "function") fn();
                } finally {
                    try { this._rebuildQueued.delete(key); } catch (_) {}
                }
            });
        }

        getCachedOrFallback(key, fallbackSource, rebuildLabel, rebuildFn) {
            const cached = this.cache.get(key);
            const hadCached = !!cached; //ALPHA CHANGE 531 -- fix fallback logger (define hadCached) --
            if (this._isValidCanvasSource(cached)) return cached;

            // If we have a cached entry but it's not valid, drop it and optionally schedule a rebuild.
            if (cached) {
                try { this.cache.delete(key); } catch (_) {}
                if (rebuildFn) this._queueRebuildOnce(key, rebuildLabel, rebuildFn);
            }
            try { //START ALPHA CHANGE 531 -- log fallback (once per key, no spam) -- se fallisce la cache a carica l'img direttamente
                if (!this._warnedFallback) this._warnedFallback = new Set();
                if (!this._warnedFallback.has(key)) {
                    const fw = (fallbackSource && (fallbackSource.width || fallbackSource.naturalWidth)) || 0;
                    const fh = (fallbackSource && (fallbackSource.height || fallbackSource.naturalHeight)) || 0;
                    console.warn(`[AssetsLoading] getCachedOrFallback FALLBACK key=${key} hadCached=${hadCached} fallback=${fallbackSource ? 'yes' : 'no'} fallbackWH=${fw}x${fh}`);
                    this._warnedFallback.add(key);
                }
            } catch (_) {} //FINISH ALPHA CHANGE 531 -- log fallback (once per key) --
            return fallbackSource;
        }

        getImgOrThrow(id) {
            const img = document.getElementById(id);
            if (!img) throw new Error(`[AssetsLoading] Missing <img> element id=${id}`);
            return img;
        }
        //FINISH ALPHA CHANGE 499 -- AssetsLoading: cache validation + fallback + optional self-heal rebuild --

        // Runs a single warm-up task (we'll hook this into the loading loop later)
        runOne() {
            if (this.isComplete) return false;

            //START ALPHA CHANGE 499 -- AssetsLoading: support async task execution without blocking frames --
            if (this._pendingPromise) return false; // a previous task is still running
            //FINISH ALPHA CHANGE 499 -- AssetsLoading: support async task execution without blocking frames --

            const t = this.tasks.shift();
            if (!t) {
                this.isComplete = true;
                return false;
            }
            this.currentLabel = t.label;
            try {
                const r = (typeof t.fn === "function") ? t.fn() : null;


            //START ALPHA CHANGE 499 -- AssetsLoading: if task returns Promise, wait across frames --
                if (r && typeof r.then === "function") {
                    this._pendingPromise = r;
                    r.then(() => {
                        this.completedTasks++;
                    }).catch((e) => {
                        this.lastError = e;
                        this.completedTasks++;
                    }).finally(() => {
                        this._pendingPromise = null;
                        if (this.completedTasks >= this.totalTasks) this.isComplete = true;
                    });
                    return true;
                }
            //FINISH ALPHA CHANGE 499 -- AssetsLoading: if task returns Promise, wait across frames --


                this.completedTasks++;
            } catch (e) {
                this.lastError = e;
                // Keep going; we'll decide later if errors should block loading
                this.completedTasks++;
            }
            if (this.completedTasks >= this.totalTasks) this.isComplete = true;
            return true;
        }
    }
    //FINISH ALPHA CHANGE 496 -- add AssetsLoading skeleton (Design 2: warm-up + keep cache) --

    class InputHandler {
    constructor(game, canvas) {
        this.game = game;
        this.canvas = canvas; // Store canvas reference
        this.togglePause = false;
        this.nameInput = "";
        this.maxNameInputLength = 20;
        this.nameInputCursor = null; // Initialize for simplified name input
        this.lastShotTime = 0;
        this.shotInterval = 100;
        this.mouseX = 0;
        this.mouseY = 0;
        //start change -- initialize gamepad state//
        this.gamepadConnected = false;
        this.gamepadIndex = null;
        this.lastGamepadButtons = new Array(16).fill(false); // Track button states for edge detection
        //start change -- expand lastGamepadNav for game-over//
        this.lastGamepadNav = { up: false, down: false, left: false, right: false };
        this.justBoundGamepadInput = false; // New flag to track binding completion
        //finish change//
        //START ALPHA CHANGE 12 -- separate edges: analog vs d-pad for menus—
        this.lastAnalogNav = { up: false, down: false }; // left stick Y edges
        this.lastDpadNav   = { up: false, down: false }; // D-pad up/down edges
        //FINISH ALPHA CHANGE 12 -- separate edges—
        //START ALPHA CHANGE 14 -- analog hold-to-scroll (joinLobby list) config/state --
        this.listAnalogDelayMs = 350;  // initial delay before auto-repeat (ms)
        this.listAnalogRateMs  = 85;   // repeat every N ms while held
        this._listAnalogDir        = 0;  // -1 up, +1 down, 0 idle
        this._listAnalogStartedAt  = 0;
        this._listAnalogLastFireAt = 0;
        //FINISH ALPHA CHANGE 14 -- tieni premuto l'analogico e ripete l'azione
        //START ALPHA CHANGE -- initialize prevGameState for state transition tracking--
        this._prevGameState = null;
        //FINISH ALPHA CHANGE -- initialize prevGameState for state transition tracking--
        this.lastGamepadAxes = new Array(4).fill(0); // Track axis states
        window.addEventListener("gamepadconnected", e => {
            this.gamepadConnected = true;
            this.gamepadIndex = e.gamepad.index;
            console.log("Gamepad connected:", e.gamepad.id);
        });
        window.addEventListener("gamepaddisconnected", () => { //replaced "e" with "()" as it was declared but not used 
            this.gamepadConnected = false;
            this.gamepadIndex = null;
            console.log("Gamepad disconnected");
        });
        //finish change//
        //Keyboard (keydown event listener): Manages menu navigation and selection with ArrowUp, ArrowDown, Enter, and Escape
        window.addEventListener("keydown", e => {
            // START FIX: Prioritize gameOver block for menu input
            if (this.game.gameOver && this.game.gameOverMenuActive) {
                if (this.game.awaitingNameInput) {
                    if (e.key === "Enter" && this.nameInput.length > 0) {
                        console.log("Enter pressed in game-over, submitting:", this.nameInput);
                        this.game.submitName(this.nameInput);
                        this.nameInput = "";
                        return;
                    } else if (e.key === "Backspace") {
                        this.nameInput = this.nameInput.slice(0, -1);
                    } else if (e.key.length === 1 && e.key !== " " && this.nameInput.length < this.maxNameInputLength) {
                        this.nameInput += e.key;
                    }
                    return;
                }
                if (e.key === "ArrowUp") {
                    this.game.ui.selectedGameOverIndex = (this.game.ui.selectedGameOverIndex - 1 + this.game.ui.gameOverItems.length) % this.game.ui.gameOverItems.length;
                } else if (e.key === "ArrowDown") {
                    this.game.ui.selectedGameOverIndex = (this.game.ui.selectedGameOverIndex + 1) % this.game.ui.gameOverItems.length;
                } else if (e.key === "Enter") {
                    const selectedItem = this.game.ui.gameOverItems[this.game.ui.selectedGameOverIndex];
                    if (selectedItem === "Restart") {
                        this.game.reset();
                    } else if (selectedItem === "Main Menu") {
                        this.game.returnToMainMenu();
                    }
                }
                return;
            }
            if (this.game.gameState === "mainMenu") {
                if (e.key === "ArrowUp") {
                    this.game.ui.selectedMenuIndex = (this.game.ui.selectedMenuIndex - 1 + this.game.ui.menuItems.length) % this.game.ui.menuItems.length;
                } else if (e.key === "ArrowDown") {
                    this.game.ui.selectedMenuIndex = (this.game.ui.selectedMenuIndex + 1) % this.game.ui.menuItems.length;
            //start change -- updating main menu selection for multiplayer and INNBC Universe//
            } else if (e.key === "Enter") {
                const selectedItem = this.game.ui.menuItems[this.game.ui.selectedMenuIndex];
                if (selectedItem === "New Game") {
                    this.game.startGame();
                } else if (selectedItem === "Options") {
                    this.game.gameState = "options";
                    this.game.ui.selectedOptionIndex = 0;
                    this.game.sound.pauseSoundtrack();
                } else if (selectedItem === "Multiplayer") {
                    this.game.gameState = "multiplayer";
                    this.game.ui.selectedMultiplayerIndex = 0;
                    //START ALPHA CHANGE 228 -- reset Multiplayer naming defaults on keyboard entry --
                    this.game.ui._lobbyRegionIndex = 0;        // US
                    this.game.ui._lobbyCustomTag   = "COOP";   // default tag
                    this.game.ui._editingLobbyCustom = false;  // not editing on entry
                    this.game.ui._customCharIndex = 0;         // safe baseline
                    //FINISH ALPHA CHANGE 228 -- reset Multiplayer naming defaults on keyboard entry --
                    this.game.sound.pauseSoundtrack();
                } else if (selectedItem === "INNBC Universe") {
                    this.game.gameState = "innbcUniverse";
                    this.game.ui.selectedInnbcUniverseIndex = 0;
                    this.game.sound.pauseSoundtrack();
                //start change -- add Full Screen to main menu//
                } else if (selectedItem === "Full Screen") {
                    this.game.toggleFullScreen();
                    console.log("Enter pressed: Toggled Full Screen to:", this.game.fullScreen ? "On" : "Off");
                //finish change//
                }   else if (selectedItem === "Quit Game") {
                    if (window.require) {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.send('quit-game');
                        console.log("Sent quit-game IPC to main process");
                    } else {
                       console.warn("Electron not available, quit-game skipped");
                }
              }
            }
            //finish change//
            return;
            }
            if (this.game.gameState === "options") {
                if (this.game.ui.awaitingKeyInput) {
                    if (e.key === "Escape") {
                        this.game.ui.awaitingKeyInput = false;
                        this.game.keyConflict = false; // Clear conflict on cancel
                        return;
                    }
                    const selectedAction = this.game.ui.optionsItems[this.game.ui.selectedOptionIndex].action;
                    if (selectedAction !== "Back" && selectedAction !== "FPS Counter" && selectedAction !== "Full Screen") { // New: skip key rebinding for the FPS toggle & full screen
                        if (this.game.checkKeyConflict(e.key, selectedAction)) {
                            this.game.keyConflict = true; // Set conflict and keep message
                            console.log(`Key ${e.key} already in use for another action`);
                            return; // Stay in awaitingKeyInput
                        }
                        // Valid key: bind it and clear conflict
                        const actionKeyMap = {
                            "Move Up": "moveUp",
                            "Move Down": "moveDown",
                            "Move Left": "moveLeft",
                            "Move Right": "moveRight",
                            "Fire": "fire",
                            "Pause": "pause"
                            // "Debug Toggle": "debug" // Commented out for release
                        };
                        this.game.keyBindings[actionKeyMap[selectedAction]] = e.key;
                        this.game.saveKeyBindings();
                        this.game.ui.awaitingKeyInput = false;
                        this.game.keyConflict = false; // Clear conflict on successful bind
                        console.log(`Rebound ${selectedAction} to ${e.key}`);
                    }
                    return;
                }
                if (e.key === "ArrowUp") {
                    this.game.ui.selectedOptionIndex = (this.game.ui.selectedOptionIndex - 1 + this.game.ui.optionsItems.length) % this.game.ui.optionsItems.length;
                    this.game.keyConflict = false; // Clear conflict when navigating
                } else if (e.key === "ArrowDown") {
                    this.game.ui.selectedOptionIndex = (this.game.ui.selectedOptionIndex + 1) % this.game.ui.optionsItems.length;
                    this.game.keyConflict = false; // Clear conflict when navigating
                    //START ALPHA CHANGE 288 -- Difficulty cycles: Hard(1:00) ⇄ Normal(1:30) + save --
                } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    const selectedAction = this.game.ui.optionsItems[this.game.ui.selectedOptionIndex].action;
                    if (selectedAction === "Timer") { // internal key kept; UI shows "Difficulty"
                        //START ALPHA CHANGE 430 -- Arrow L/R: cycle by labels (Hard flag vs Normal/Easy timers) --
                        const NORMAL =  90000; // 1:30 (default)
                        const EASY   = 120000; // 2:00
                        const currentLabel = this.game.hardMode ? "Hard"
                            : ((this.game.timeLimit|0) >= EASY ? "Easy" : "Normal");
                        const order = ["Normal","Hard","Easy"]; //ordine in cui ciclano -- tasti freccia -- ALPHA CHANGE 529 
                        const dir = (e.key === "ArrowRight") ? +1 : -1;
                        const nextLabel = order[(order.indexOf(currentLabel) + dir + order.length) % order.length];

                        if (nextLabel === "Hard") {
                            this.game.hardMode = true;
                            this.game.timeLimit = NORMAL;        // keep Normal timer
                        } else if (nextLabel === "Normal") {
                            this.game.hardMode = false;
                            this.game.timeLimit = NORMAL;
                        } else { // "Easy"
                            this.game.hardMode = false;
                            this.game.timeLimit = EASY;
                        }
                        this.game.saveHardModeSetting(); //persist immediately in localStorage
                        this.game.saveTimeLimitSetting(); //persist immediately in localStorage
                        //FINISH ALPHA CHANGE 430 -- Arrow L/R label cycle --
                    }
                    //FINISH ALPHA CHANGE 288 -- Difficulty cycles --
                } else if (e.key === "Enter") {
                    const selectedAction = this.game.ui.optionsItems[this.game.ui.selectedOptionIndex].action;
                    if (selectedAction === "Back") {
                        this.game.gameState = "mainMenu";
                        this.game.ui.selectedMenuIndex = 0;
                        this.game.keyConflict = false; // Clear conflict on exit
                    } else if (selectedAction === "FPS Counter") { // New: Toggle FPS
                        this.game.showFPS = !this.game.showFPS;
                        this.game.saveFPSSetting();
                        console.log("Toggled FPS Counter:", this.game.showFPS ? "On" : "Off");
                    } else if (selectedAction === "Full Screen") {
                        this.game.toggleFullScreen();
                       console.log("Toggled Full Screen:", this.game.fullScreen ? "On" : "Off");
                       //start change -- adding a check for gamepad setup menu
                    } else if (selectedAction === "Gamepad Setup") {
                       this.game.gameState = "gamepadSetup";
                       this.game.ui.selectedGamepadIndex = 0;
                       this.game.ui.awaitingGamepadInput = false;
                       console.log("Enter pressed: Transitioned to gamepad setup menu");
                       //finish change
                    } else if (selectedAction === "Reset All Settings") { // Added for reset
                        this.game.resetAllSettings();
                      console.log("Reset all settings to defaults");
                    //START ALPHA CHANGE 202 -- Options: activate Reset Score instead of key-binding prompt --
                    } else if (selectedAction === "Reset Score") {
                        if (this.game.leaderboard && typeof this.game.leaderboard.resetScores === "function") {
                            this.game.leaderboard.resetScores();
                            console.log("Reset Score: leaderboard cleared");
                        } else {
                            console.warn("Reset Score: leaderboard unavailable or missing resetScores()");
                        }
                    //FINISH ALPHA CHANGE 202 -- Options: activate Reset Score instead of key-binding prompt --
                    //START ALPHA CHANGE 289 -- Options: prevent key-binding prompt for Difficulty item 
                    //Just like the special-cased “Reset Score” so Enter wouldn’t open the key-rebind prompt, 
                    //we also special-case "Timer" -- and any other new menu elements will also need it (and mouse click will also need it)
                    } else if (selectedAction === "Timer") {
                        //Enter also cycles Difficulty (Hard→Normal→Easy) and saves --
                        //START ALPHA CHANGE 419 -- New difficulty cycle: Hard (flag) ↔ Normal/Easy (timer); remove old HARD=60000 use --
                        const NORMAL =  90000; // 1:30
                        const EASY   = 120000; // 2:00

                        // Current difficulty from (hardMode flag, timeLimit bucket)
                        const currentLabel = this.game.hardMode ? "Hard"
                            : ((this.game.timeLimit|0) >= EASY ? "Easy" : "Normal");

                        const order = ["Normal","Hard","Easy"]; // ALPHA CHANGE 529 -- ordine ciclaggio tasto enter tastiera 
                        const nextLabel = order[(order.indexOf(currentLabel) + 1) % order.length];

                        if (nextLabel === "Hard") {
                            // Hard = set flag, keep timer at NORMAL to avoid shortening the clock
                            this.game.hardMode = true;
                            this.game.timeLimit = NORMAL;
                            this.game.saveHardModeSetting();
                            this.game.saveTimeLimitSetting();
                        } else if (nextLabel === "Normal") {
                            this.game.hardMode = false;
                            this.game.timeLimit = NORMAL;
                            this.game.saveHardModeSetting();
                            this.game.saveTimeLimitSetting();
                        } else { // "Easy"
                            this.game.hardMode = false;
                            this.game.timeLimit = EASY;
                            this.game.saveHardModeSetting();
                            this.game.saveTimeLimitSetting();
                        }

                        this.game.ui.awaitingKeyInput = false; // stay in options, no binding prompt
                        this.game.keyConflict = false;
                        console.log("Difficulty changed via Enter ->", nextLabel);
                        //FINISH ALPHA CHANGE 419 -- New difficulty cycle --    
                        //FINISH ALPHA CHANGE 289 -- Enter also cycles Difficulty and saves --              
                    } else {
                        this.game.ui.awaitingKeyInput = true;
                        this.game.keyConflict = false; // Clear conflict to allow fresh binding
                    }
                } else if (e.key === "Escape") {
                    this.game.gameState = "mainMenu";
                    this.game.ui.selectedMenuIndex = 0;
                    this.game.keyConflict = false; // Clear conflict on exit
                }
                return;
            }
            //start change -- add gamepad setup submenu navigation and rebinding//
if (this.game.gameState === "gamepadSetup") {//Here we ignore keyboard inputs for awaitingGamepadInput (same for gamepad->keyboard in ALPHA 732)
    if (this.game.ui.awaitingGamepadInput) {
        if (e.key === "Escape") {
            this.game.ui.awaitingGamepadInput = false;
            this.game.gamepadConflict = false;
            return;
        }
        return; // Wait for gamepad input, ignore keyboard
    }
    if (e.key === "ArrowUp") {
        this.game.ui.selectedGamepadIndex = (this.game.ui.selectedGamepadIndex - 1 + this.game.ui.gamepadItems.length) % this.game.ui.gamepadItems.length;
        this.game.gamepadConflict = false;
    } else if (e.key === "ArrowDown") {
        this.game.ui.selectedGamepadIndex = (this.game.ui.selectedGamepadIndex + 1) % this.game.ui.gamepadItems.length;
        this.game.gamepadConflict = false;
    } else if (e.key === "Enter") {
        const selectedAction = this.game.ui.gamepadItems[this.game.ui.selectedGamepadIndex].action;
        if (selectedAction === "Back") {
            this.game.gameState = "options";
            this.game.ui.selectedOptionIndex = 0;
            this.game.gamepadConflict = false;
        } else {
            this.game.ui.awaitingGamepadInput = true;
            this.game.gamepadConflict = false;
        }
    } else if (e.key === "Escape") {
        this.game.gameState = "options";
        this.game.ui.selectedOptionIndex = 0;
        this.game.gamepadConflict = false;
    }
    return;
}
//finish change//
            //start change -- add joinLobby state and update multiplayer menu navigation for keyboard 
            //START ALPHA CHANGE -- update joinLobby keyboard navigation with focus and empty list handling--
            if (this.game.gameState === "joinLobby") {//ALPHA CHANGE 734 -- defensive guard against non-array (undefined) -- 
                const real = Array.isArray(this.game.steamMultiplayer.lobbies) ? this.game.steamMultiplayer.lobbies : [];
                const lobbyCount = real.length;
                // Force focus to buttons if no lobbies
                if (lobbyCount === 0 && this.game.ui.joinLobbyFocus !== 'buttons') {
                    this.game.ui.joinLobbyFocus = 'buttons';
                    this.game.ui.selectedJoinLobbyIndex = Math.min(this.game.ui.selectedJoinLobbyIndex || 0, (this.game.ui.joinLobbyItems?.length || 1) - 1);
                    console.log("joinLobby: no lobbies -> focus set to buttons (keyboard)");
                }
                const focusIsList = this.game.ui.joinLobbyFocus === 'list';
                let selectedIndex, maxIndex;
                if (focusIsList && lobbyCount > 0) {
                    selectedIndex = this.game.ui.selectedMultiplayerIndex;
                    maxIndex = Math.max(0, lobbyCount - 1);
                    if (e.key === "ArrowUp") {
                        this.game.ui.selectedMultiplayerIndex = Math.max(0, selectedIndex - 1);
                        this.game.steamMultiplayer.selectedLobbyIndex = this.game.ui.selectedMultiplayerIndex;
                        console.log("joinLobby(list): ArrowUp, selectedMultiplayerIndex:", this.game.ui.selectedMultiplayerIndex);
                    } else if (e.key === "ArrowDown") {
                        this.game.ui.selectedMultiplayerIndex = Math.min(maxIndex, selectedIndex + 1);
                        this.game.steamMultiplayer.selectedLobbyIndex = this.game.ui.selectedMultiplayerIndex;
                        if (selectedIndex === maxIndex) {
                            this.game.ui.joinLobbyFocus = 'buttons';
                            this.game.ui.selectedJoinLobbyIndex = 0;
                            console.log("joinLobby: Moved focus to buttons (keyboard)");
                        }
                    } else if (e.key === "Enter") {
                        const lobby = real[this.game.ui.selectedMultiplayerIndex];//ALPHA CHANGE 734 -- use guarded lobby list (real[]) -- 
                        if (lobby) {
                            this.game.steamMultiplayer.joinLobby(lobby.id);
                            console.log("joinLobby: Enter joined lobby:", lobby.id);
                        } else {
                            console.log("joinLobby: Enter ignored, no lobby at index", this.game.ui.selectedMultiplayerIndex);
                        }
                    }
                } else {
                    selectedIndex = this.game.ui.selectedJoinLobbyIndex;
                    maxIndex = Math.max(0, this.game.ui.joinLobbyItems.length - 1);
                    if (e.key === "ArrowUp") {
                        this.game.ui.selectedJoinLobbyIndex = Math.max(0, selectedIndex - 1);
                        if (selectedIndex === 0 && lobbyCount > 0) {
                            this.game.ui.joinLobbyFocus = 'list';
                            this.game.ui.selectedMultiplayerIndex = 0; // start change -- pick first lobby when entering list -- finish change
                            this.game.steamMultiplayer.selectedLobbyIndex = this.game.ui.selectedMultiplayerIndex;
                            console.log("joinLobby: Moved focus to lobby list (keyboard)");
                        }
                    } else if (e.key === "ArrowDown") {
                        this.game.ui.selectedJoinLobbyIndex = Math.min(maxIndex, selectedIndex + 1);
                    } else if (e.key === "Enter") {
                        const btn = this.game.ui.joinLobbyItems[this.game.ui.selectedJoinLobbyIndex];
                        if (btn === "Refresh") {
                            this.game.steamMultiplayer._lastLobbyRefreshManual = true; //START ALPHA CHANGE 100
                            this.game.steamMultiplayer._lastLobbyRefreshAt = performance.now(); 
                            this.game.steamMultiplayer.requestLobbyList(); 
                            console.log("joinLobby: Enter refreshed lobby list (manual)"); //FINISH ALPHA CHANGE 100
                        } else if (btn === "Back") {
                            //START ALPHA CHANGE 2 -- reset gamepad button states on keyboard exit from joinLobby--
                            this.game.gameState = "multiplayer";
                            this.game.ui.selectedMultiplayerIndex = 0;
                            this.game.steamMultiplayer.selectedLobbyIndex = 0;
                            this.game.ui.joinLobbyFocus = 'list';
                            this.game.ui.selectedJoinLobbyIndex = 0;
                        if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                 //FINISH ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                console.log("Keyboard exited joinLobby to multiplayer, reset gamepad button states");
                            }
                        }
                        console.log("joinLobby: Enter returned to multiplayer");                      
                        }//FINISH ALPHA CHANGE 2 -- reset gamepad button states on keyboard exit from joinLobby--
                        //START ALPHA CHANGE 91 -- use centralized teardown: returnToMainMenu() instead of local resets
                         else if (btn === "Leave Lobby") {
                            this.game.returnToMainMenu(); //START ALPHA CHANGE 91
                            console.log("joinLobby: Enter -> Leave Lobby via returnToMainMenu()");
                        }
                        //FINISH ALPHA CHANGE 91
                    }
                }
                if (e.key === "Escape") {
                    //START ALPHA CHANGE 240 -- map ESC to Leave Lobby in joinLobby overlay; otherwise keep legacy back --
                    const inLobbyNow = (this.game.steamMultiplayer.lobbyState === "inLobby");
                    if (inLobbyNow) {
                        this.game.returnToMainMenu();
                        console.log("joinLobby: ESC -> Leave Lobby via returnToMainMenu() (keyboard)");
                    } else {
                        // Legacy back path when not in an active lobby overlay
                        this.game.gameState = "multiplayer";
                        this.game.ui.selectedMultiplayerIndex = 0;
                        this.game.steamMultiplayer.selectedLobbyIndex = 0;
                        this.game.ui.joinLobbyFocus = 'list';
                        this.game.ui.selectedJoinLobbyIndex = 0;
                        if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                console.log("Keyboard escaped joinLobby to multiplayer, reset gamepad button states");
                            }
                        }
                        console.log("joinLobby: Escaped to multiplayer (keyboard)");
                    }
                    //FINISH ALPHA CHANGE 240 -- map ESC to Leave Lobby in joinLobby overlay; otherwise keep legacy back --
            }
            return;
            }
            //FINISH ALPHA CHANGE -- update joinLobby keyboard navigation with focus and empty list handling--
            //finish change -- add joinLobby state and update multiplayer menu navigation for keyboard

            //START ALPHA CHANGE -- add keyboard navigation for multiplayer menu--
            if (this.game.gameState === "multiplayer") {
                //START ALPHA CHANGE 214 -- add Region/Custom rows + inline Custom editing --
                // Lazily ensure the editing flag exists (UI constructor already set _lobbyRegions/_lobbyRegionIndex/_lobbyCustomTag)
                if (typeof this.game.ui._editingLobbyCustom !== "boolean") this.game.ui._editingLobbyCustom = false;

                const inLobby = (this.game.steamMultiplayer.lobbyState === "inLobby");
                const baseItems = inLobby ? ["Start Game", "Leave Lobby"]
                                          : ["Region", "Custom Tag", "Create Lobby", "Join Lobby", "Back"];
                const maxIndex = baseItems.length - 1;
                const sel = Math.max(0, Math.min(this.game.ui.selectedMultiplayerIndex ?? 0, maxIndex));

                // If we're actively editing the Custom tag, capture text keys and backspace here
                if (!inLobby && this.game.ui._editingLobbyCustom) {
                    // Accept A–Z, 0–9, underscore; Backspace deletes; Enter/Escape ends edit
                    if (e.key === "Backspace") {
                        this.game.ui._lobbyCustomTag = (this.game.ui._lobbyCustomTag || "").slice(0, -1);
                        //START ALPHA CHANGE 274 -- sync gamepad cursor with flashing letter after keyboard edit (Backspace)
                        const cur = String(this.game.ui._lobbyCustomTag).toUpperCase();
                        const last = Math.max(0, cur.length - 1);
                        this.game.ui._customCursorPos = last;
                        const ch = cur[last] || "A";
                        const palette = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
                        const pi = palette.indexOf(ch);
                        this.game.ui._customCharIndex = (pi >= 0 ? pi : 0);
                        //FINISH ALPHA CHANGE 274
                        e.preventDefault();
                        return;
                    } else if (e.key === "Enter" || e.key === "Escape") {
                        this.game.ui._editingLobbyCustom = false;
                        console.log("multiplayer: Custom edit finished (keyboard)");
                        e.preventDefault();
                        return;
                    } else if (/^[a-zA-Z0-9_]$/.test(e.key)) {
                        const next = (this.game.ui._lobbyCustomTag || "") + e.key.toUpperCase();
                        this.game.ui._lobbyCustomTag = next.replace(/[^A-Z0-9_]/g, "").slice(0, 6);
                        //START ALPHA CHANGE 274 -- sync gamepad cursor with flashing letter after keyboard edit (typed char)
                        const cur = String(this.game.ui._lobbyCustomTag).toUpperCase();
                        const last = Math.max(0, cur.length - 1);
                        this.game.ui._customCursorPos = last;
                        const ch = cur[last] || "A";
                        const palette = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
                        const pi = palette.indexOf(ch);
                        this.game.ui._customCharIndex = (pi >= 0 ? pi : 0);
                        //FINISH ALPHA CHANGE 274
                        e.preventDefault();
                        return;
                    }
                    // While editing, ignore navigation keys below unless handled here.
                }
                
                if (e.key === "ArrowUp") {
                    this.game.ui.selectedMultiplayerIndex = Math.max(0, sel - 1);
                    console.log("multiplayer: ArrowUp, selectedMultiplayerIndex:", this.game.ui.selectedMultiplayerIndex);
                } else if (e.key === "ArrowDown") {
                    this.game.ui.selectedMultiplayerIndex = Math.min(maxIndex, sel + 1);
                    console.log("multiplayer: ArrowDown, selectedMultiplayerIndex:", this.game.ui.selectedMultiplayerIndex);
                    } else if (!inLobby && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                        // Left/Right only meaningful on Region/Custom
                    if (sel === 0) { // Region
                        const regions = this.game.ui._lobbyRegions || [{ code: "US", label: "United States" }];
                        const len = regions.length;
                        let idx = this.game.ui._lobbyRegionIndex || 0;
                        idx = (e.key === "ArrowLeft") ? (idx - 1 + len) % len : (idx + 1) % len;
                        this.game.ui._lobbyRegionIndex = idx;
                        console.log("multiplayer: Region cycled to", regions[idx]?.code);
                    } else if (sel === 1) { // Custom: Left/Right do nothing; handled via typing when editing
                        // no-op è giusto left e right non si usano qui 
                    }
                    } else if (!inLobby && sel === 1) {
                    // Enter on Custom toggles inline edit mode
                    this.game.ui._editingLobbyCustom = !this.game.ui._editingLobbyCustom;
                    console.log("multiplayer: Custom edit", this.game.ui._editingLobbyCustom ? "started" : "stopped");
                } else if (e.key === "Enter") {
                    const chosen = baseItems[this.game.ui.selectedMultiplayerIndex];
                    if (inLobby) {
                        if (chosen === "Start Game" && this.game.steamMultiplayer.isHost) {
                            this.game.steamMultiplayer.startMultiplayerGame();
                            console.log("multiplayer: Enter started game");
                        } else if (chosen === "Leave Lobby") {
                            this.game.steamMultiplayer.leaveLobby();
                            console.log("multiplayer: Enter left lobby");
                        }
                    } else {
                        if (chosen === "Create Lobby") {
                            // Note: Region/Custom metadata will be attached in a later step (post-create).
                            this.game.steamMultiplayer.createLobby();
                            console.log("multiplayer: Enter created lobby");
                        } else if (chosen === "Join Lobby") {
                            //START ALPHA CHANGE 2 -- reset gamepad button states on keyboard
                            this.game.gameState = "joinLobby";
                            // start change -- enter joinLobby focused on buttons, no preselected list (keyboard) --
                            this.game.ui.joinLobbyFocus = 'buttons';
                            this.game.ui.selectedJoinLobbyIndex = 1; // "Back"
                            this.game.ui.selectedMultiplayerIndex = -1;
                            // finish change
                            this.game.steamMultiplayer.requestLobbyList();
                        if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on state transitions --
                                console.log("Keyboard entered joinLobby, reset gamepad button states");
                            }
                        }
                        console.log("multiplayer: Enter transitioned to joinLobby");
                        //FINISH ALPHA CHANGE 2 -- reset gamepad button states on keyboard entry to joinLobby--
                        } else if (chosen === "Back") {
                            //START ALPHA CHANGE 2 -- reset gamepad button states on keyboard exit from multiplayer--
                            this.game.gameState = "mainMenu";
                            this.game.ui.selectedMenuIndex = 0;
                            if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on multiplayer->mainMenu transitions --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on multiplayer->mainMenu transitions --
                                console.log("Keyboard exited multiplayer to mainMenu, reset gamepad button states");
                            }
                        }
                        console.log("multiplayer: Enter returned to mainMenu");
                        //FINISH ALPHA CHANGE 2 -- reset gamepad button states on keyboard exit from multiplayer--
                        }
                    }
                } else if (e.key === "Escape") {
                    //START ALPHA CHANGE 239 -- ESC: if in-lobby overlay, trigger Leave Lobby; else legacy back to main menu --
                    const inLobbyNow = (this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby");
                    if (inLobbyNow) {
                        this.game.steamMultiplayer.leaveLobby();
                        console.log("multiplayer: ESC -> Leave Lobby (keyboard)");
                    } else {
                        this.game.gameState = "mainMenu";
                        this.game.ui.selectedMenuIndex = 0;
                        if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on multiplayer->mainMenu transitions --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //START ALPHA CHANGE 716 -- gamepad: guard button snapshots on multiplayer->mainMenu transitions --
                                console.log("Keyboard escaped multiplayer to mainMenu, reset gamepad button states");
                            }
                        }
                        console.log("multiplayer: Escaped to mainMenu");
                    }
                    //FINISH ALPHA CHANGE 239 -- ESC: if in-lobby overlay, trigger Leave Lobby; else legacy back to main menu --
                }
                return;
                //FINISH ALPHA CHANGE 214 -- add Region/Custom rows + inline Custom editing --
            }
            //FINISH ALPHA CHANGE -- add keyboard navigation for multiplayer menu--

//start change -- update keyboard navigation for INNBC Universe to support story pages and links//
if (this.game.gameState === "innbcUniverse") {
    const totalBounds = this.game.ui.innbcUniverseItemBounds.length;
    const buttonStart = totalBounds - 2; // First button index
    if (e.key === "ArrowLeft") {
        this.game.ui.selectedInnbcUniverseIndex = buttonStart; // Always select left button
        console.log("ArrowLeft: Selected index:", this.game.ui.selectedInnbcUniverseIndex);
    } else if (e.key === "ArrowRight") {
        this.game.ui.selectedInnbcUniverseIndex = totalBounds - 1; // Always select right button
        console.log("ArrowRight: Selected index:", this.game.ui.selectedInnbcUniverseIndex);
    } else if (e.key === "Enter") {
        const selectedItem = this.game.ui.innbcUniverseItemBounds[this.game.ui.selectedInnbcUniverseIndex];
        if (selectedItem.action === "MenuBack") {
            this.game.gameState = "mainMenu";
            this.game.ui.selectedMenuIndex = 0;
            this.game.innbcUniverse.currentUniversePage = 0;
            console.log("Enter: Main Menu in INNBC Universe, returned to main menu");
        } else if (selectedItem.action === "Next") {
            this.game.innbcUniverse.currentUniversePage = Math.min(this.game.innbcUniverse.currentUniversePage + 1, this.game.innbcUniverse.innbcUniversePages.length - 1);
            this.game.ui.selectedInnbcUniverseIndex = buttonStart; // Reset to first button
            console.log("Enter: Next in INNBC Universe, page:", this.game.innbcUniverse.currentUniversePage);
        } else if (selectedItem.action === "Back") {
            this.game.innbcUniverse.currentUniversePage = Math.max(this.game.innbcUniverse.currentUniversePage - 1, 0);
            this.game.ui.selectedInnbcUniverseIndex = buttonStart; // Reset to first button
            console.log("Enter: Back in INNBC Universe, page:", this.game.innbcUniverse.currentUniversePage);
        }
    } else if (e.key === "Escape") {
        this.game.gameState = "mainMenu";
        this.game.ui.selectedMenuIndex = 0;
        this.game.innbcUniverse.currentUniversePage = 0;
        console.log("Escape: Returned to main menu from INNBC Universe");
    }
    return;
}
//finish change//
if (this.game.gameState === "placeholder") {
    this.game.gameState = "mainMenu";
    this.game.ui.selectedMenuIndex = 0;
    return;
}
//finish change//
            // START CHANGE: Handle pause menu navigation
            if (this.game.gameState === "playing" && !this.game.gameOver) { // FIRST SYNTAX ERROR FIX: Start consolidated "playing" block, removed incorrect nesting
                if (this.game.paused) {
                    if (e.key === "ArrowUp") {
                        this.game.ui.selectedPauseIndex = (this.game.ui.selectedPauseIndex - 1 + 3) % 3; // 3 items
                        console.log("Pause: ArrowUp, selectedPauseIndex:", this.game.ui.selectedPauseIndex);
                    } else if (e.key === "ArrowDown") {
                        this.game.ui.selectedPauseIndex = (this.game.ui.selectedPauseIndex + 1) % 3; // 3 items
                        console.log("Pause: ArrowDown, selectedPauseIndex:", this.game.ui.selectedPauseIndex);
                    } else if (e.key === "Enter") {
                        const selectedItem = ["Resume", "Main Menu", "Full Screen"][this.game.ui.selectedPauseIndex];
                        console.log("Pause: Enter pressed, selectedItem:", selectedItem);
                        if (selectedItem === "Resume") {
                            this.game.paused = false;
                            this.game.ui.selectedPauseIndex = 0; // Reset to "Resume"
                        } else if (selectedItem === "Main Menu") {
                            this.game.returnToMainMenu();
                        } else if (selectedItem === "Full Screen") {
                            this.game.toggleFullScreen();
                            console.log("Pause: Toggled Full Screen to:", this.game.fullScreen ? "On" : "Off");
                        }
                    } else if ((e.key === this.game.keyBindings.pause || e.key === "Escape") && !this.togglePause) {
                        this.togglePause = true;
                        this.game.paused = false;
                        this.game.ui.selectedPauseIndex = 0; // Reset to "Resume"
                        console.log("Pause: Toggled off with", e.key);
                    }
                    return;
                } // SECOND SYNTAX ERROR FIX: Removed incorrect "});" that was here, closing the paused block only
           // Gameplay inputs (not paused)
        if (this.game.awaitingNameInput) {
            if (e.key === "Enter" && this.nameInput.length > 0) {
                console.log("Enter pressed, submitting:", this.nameInput);
                this.game.submitName(this.nameInput);
                this.nameInput = "";
            } else if (e.key === "Backspace") {
                this.nameInput = this.nameInput.slice(0, -1);
            } else if (e.key.length === 1 && e.key !== " " && this.nameInput.length < this.maxNameInputLength) {
                this.nameInput += e.key;
            }
            return;
        }
        if (e.key === this.game.keyBindings.moveUp && this.game.keys.indexOf(e.key) === -1) {
            this.game.keys.push(e.key);
        } else if (e.key === this.game.keyBindings.moveDown && this.game.keys.indexOf(e.key) === -1) {
            this.game.keys.push(e.key);
        } else if (e.key === this.game.keyBindings.moveLeft && this.game.keys.indexOf(e.key) === -1) {
            this.game.keys.push(e.key);
        } else if (e.key === this.game.keyBindings.moveRight && this.game.keys.indexOf(e.key) === -1) {
            this.game.keys.push(e.key);
        } else if (e.key === this.game.keyBindings.fire && !this.game.paused) {
            //START GAMMA CHANGE 5A
            // Client in multiplayer: don't shoot locally; mark key as held so SteamMultiplayer can encode it BUT DON'T CALL player.shoot() + ALPHA 482 (gamepad guard) + ALPHA 176
            // Always mark the fire key as "held" in this.game.keys (no OS key-repeat dependency) in ALPHA CHANGE 485
            //moved the MP guard to ALPHA CHANGE 485 so this can generically apply to SP/HOST/Client 
                if (this.game.keys.indexOf(e.key) === -1) this.game.keys.push(e.key);
             
            //FINISH GAMMA CHANGE 5A
        } 

        else if ((e.key === this.game.keyBindings.pause || e.key === "Escape") && !this.togglePause) {
            this.togglePause = true;
            this.game.paused = true;
            this.game.ui.selectedPauseIndex = 0; // Reset to "Resume"
            console.log("Pause: Toggled on with", e.key);
        }
        return;
    }
});

        window.addEventListener("keyup", e => {
            if (this.game.keys.indexOf(e.key) > -1) {
                this.game.keys.splice(this.game.keys.indexOf(e.key), 1);
            }
            if (e.key === this.game.keyBindings.pause || e.key === "Escape") { // FIFTH FIX: Support both pause key and Escape for togglePause reset
                this.togglePause = false;
                console.log("Keyup: Reset togglePause for", e.key); // SIXTH FIX: Add debug log for togglePause reset
            }
        });
   

        window.addEventListener("paste", e => {
            if (this.game.gameState === "playing" && this.game.awaitingNameInput) {
                const pastedText = (e.clipboardData || window.clipboardData).getData("text").trim();
                this.nameInput = pastedText.slice(0, this.maxNameInputLength);
                e.preventDefault();
                console.log("Pasted name (limited to 20):", this.nameInput);
            }
        });        
//let's try move here the first listener to check if position solves the issue -- spoiler, it does!
//start change -- add mousemove event listener for menu hovering -- this controls mouse movements//
        window.addEventListener("mousemove", e => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mouseX = (e.clientX - rect.left) * scaleX;
            this.mouseY = (e.clientY - rect.top) * scaleY;
    //start change -- add debug log to confirm mousemove event and game state--after coordinate update, added raw coordinates
    //console.log(`MouseMove Triggered - Game State: ${this.game.gameState}, Mouse Coords: (${this.mouseX}, ${this.mouseY}), Raw: (${e.clientX}, ${e.clientY})`);
    //finish change--
        //START ALPHA CHANGE 707 -- gameplay: hide cursor after inactivity (canvas-only; no per-frame checks) -- Video-player style: show cursor on motion,
        //then hide it after 1s of no motion *while playing*. In menus, we never schedule a hide; moving the mouse once will always show the cursor again
        //because this works only after you move the mouse, to already start with hidden pointer in gameplay we added ALPHA 708. both ALPHA 707 and 708 
        //store in the InputHandler instance property "this._cursorHideTimer707" so 707 can overwrite the 708 in case of a pending timer set by 708 with 
        //a “clear + null” pattern. It’s a property on the InputHandler instance (the object created by new InputHandler(...)). So it’s one shared slot.
            try {
                // Always show cursor on any mouse movement
                if (this.canvas && this.canvas.style) this.canvas.style.cursor = "default";

                const isPlaying707 = !!(this.game && this.game.gameState === "playing");
                if (isPlaying707) {
                    if (this._cursorHideTimer707) {
                        clearTimeout(this._cursorHideTimer707);
                        this._cursorHideTimer707 = null;
                    }
                    this._cursorHideTimer707 = setTimeout(() => {
                        try {
                            // Only hide if we are STILL in gameplay when the timer fires
                            if (this.game && this.game.gameState === "playing" && this.canvas && this.canvas.style) {
                                this.canvas.style.cursor = "none";
                            }
                        } catch (_) {}
                    }, 1000);
                } else {
                    // Not playing: cancel any pending hide so menus won’t get hidden by a leftover gameplay timer
                    if (this._cursorHideTimer707) {
                        clearTimeout(this._cursorHideTimer707);
                        this._cursorHideTimer707 = null;
                    }
                }
            } catch (_) {}
        //FINISH ALPHA CHANGE 707 -- gameplay: hide cursor after inactivity (canvas-only) --
            if (this.game.gameState === "mainMenu") {
                let updated = false;
                this.game.ui.menuItemBounds.forEach((item, index) => {
                    if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                        this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                        this.game.ui.selectedMenuIndex = index;
                        updated = true;
                    }
                });
                if (!updated) this.game.ui.selectedMenuIndex = -1; // Clear selection
            } else if (this.game.gameState === "options") { //options setup: se muovi via il puntatore mentre awaitingKeyInput is true ricorda la selezione (no undefined)
                //START ALPHA CHANGE 719 -- mouse hover: keep Options selection sticky while awaiting key bind --
                if (this.game.ui.awaitingKeyInput) return;
                //FINISH ALPHA CHANGE 719 -- mouse hover: keep Options selection sticky while awaiting key bind --
                let updated = false;
                this.game.ui.optionsItemBounds.forEach((item, index) => {
                    if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                        this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                        this.game.ui.selectedOptionIndex = index;
                        updated = true;
                    }
                });
                if (!updated) this.game.ui.selectedOptionIndex = -1;
            } else if (this.game.gameState === "gamepadSetup") {//gamepad setup: ricorda la selezione anche se muovi via il mouse (no undefined)
                //START ALPHA CHANGE 719 -- mouse hover: keep Gamepad Setup selection sticky while awaiting gamepad bind --
                if (this.game.ui.awaitingGamepadInput) return;
                //FINISH ALPHA CHANGE 719 -- mouse hover: keep Gamepad Setup selection sticky while awaiting gamepad bind --
                let updated = false;
                this.game.ui.gamepadItemBounds.forEach((item, index) => {
                    if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                        this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                        this.game.ui.selectedGamepadIndex = index;
                        updated = true;
                    }
                });
                if (!updated) this.game.ui.selectedGamepadIndex = -1;
           } else if (this.game.gameState === "multiplayer") {
                let updated = false;
                this.game.ui.multiplayerItemBounds.forEach((item, index) => {
                    if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                        this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                        this.game.ui.selectedMultiplayerIndex = index;
                        updated = true;
                    }
                });
                if (!updated) this.game.ui.selectedMultiplayerIndex = -1;
                        } else if (this.game.gameState === "joinLobby") {
                let updated = false;

                // start change -- joinLobby mouse hover prioritizes buttons, then lobby list --
                // 1) Hit-test buttons ("Refresh", "Back")
                this.game.ui.joinLobbyItemBounds.forEach((btn, idx) => {
                    if (this.mouseX >= btn.x && this.mouseX <= btn.x + btn.width &&
                        this.mouseY >= btn.y && this.mouseY <= btn.y + btn.height) {
                        this.game.ui.joinLobbyFocus = 'buttons';       // start change
                        this.game.ui.selectedJoinLobbyIndex = idx;     // start change
                        updated = true;
                    }
                });

                // 2) If no button hovered, hit-test lobby rows
                if (!updated) {
                    this.game.ui.multiplayerItemBounds.forEach((row, index) => {
                        if (this.mouseX >= row.x && this.mouseX <= row.x + row.width &&
                            this.mouseY >= row.y && this.mouseY <= row.y + row.height) {
                            this.game.ui.joinLobbyFocus = 'list';                   // start change
                            this.game.ui.selectedMultiplayerIndex = index;          // start change
                            if (row.action === "joinLobby") {
                                this.game.steamMultiplayer.selectedLobbyIndex = index;
                            }
                            updated = true;
                        }
                    });
                }

                // 3) If nothing hovered, clear highlights (keep focus stable)
                if (!updated) {
                    if (this.game.ui.joinLobbyFocus === 'buttons') {
                        this.game.ui.selectedJoinLobbyIndex = -1;  // start change
                    } else {
                        this.game.ui.selectedMultiplayerIndex = -1; // start change
                    }
                }
                // finish change -- joinLobby mouse hover prioritizes buttons, then lobby list --

                if (!updated) this.game.ui.selectedMultiplayerIndex = -1;
            } else if (this.game.gameState === "innbcUniverse") {
                let updated = false;
                this.game.ui.innbcUniverseItemBounds.forEach((item, index) => {
                    if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                        this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                        this.game.ui.selectedInnbcUniverseIndex = index;
                        updated = true;
                    }
                });
                if (!updated) this.game.ui.selectedInnbcUniverseIndex = -1;
            }
        });
        //finish change//

//START ALPHA CHANGE 13 -- mouse wheel scroll for multiplayer item lists (does not change selection/focus)--
window.addEventListener("wheel", (e) => {
    const state = this.game.gameState;

    //START ALPHA CHANGE 275 -- mouse wheel cycles Region in Multiplayer base state when Region row is selected
    if (state === "multiplayer") {
        const inLobby = (this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby");
        // Only when NOT in overlay (inLobby) and Region row (index 0) is selected
        if (!inLobby && this.game.ui && this.game.ui.selectedMultiplayerIndex === 0) {
            if (e.preventDefault) e.preventDefault(); // stop page scroll
            const regions = this.game.ui._lobbyRegions || [{ code: "US", label: "United States" }];
            const len = regions.length || 1;
            let idx = this.game.ui._lobbyRegionIndex || 0;
            const step = e.deltaY > 0 ? 1 : -1; // wheel down -> next, wheel up -> previous
            idx = (idx + step + len) % len;
            this.game.ui._lobbyRegionIndex = idx;
            console.log("multiplayer: Region cycled (wheel) to", regions[idx]?.code);
            return; // handled
        }
    }
    //FINISH ALPHA CHANGE 275 -- mouse wheel cycles Region in Multiplayer base state
    //mouse wheel scroll for joinLobby list
    if (state !== "joinLobby") return;

    // Prevent page scroll; Electron usually allows this, but be explicit
    if (e.preventDefault) e.preventDefault();

    // Effective lobby count must match UI.draw logic:
    const realCount = Array.isArray(this.game.steamMultiplayer.lobbies) ? this.game.steamMultiplayer.lobbies.length : 0;
    const fakeCount = (realCount === 0 && this.game.ui && this.game.ui.debugJoinLobby)
        ? (this.game.ui.debugJoinLobbyCount || 10)
        : 0;
    const effectiveCount = realCount > 0 ? realCount : fakeCount;

    const visibleItems = 10;  // must match UI.draw
    if (effectiveCount <= visibleItems) return; // nothing to scroll

    // Initialize if needed
    if (typeof this.game.ui.joinLobbyScrollOffset !== "number") this.game.ui.joinLobbyScrollOffset = 0;

    // One row per wheel “notch” (ignore delta magnitude variations)
    const step = e.deltaY > 0 ? 1 : -1;
    const maxOffset = Math.max(0, effectiveCount - visibleItems);
    this.game.ui.joinLobbyScrollOffset = Math.max(0, Math.min(maxOffset, this.game.ui.joinLobbyScrollOffset + step));
}, { passive: false });
//FINISH ALPHA CHANGE 13 --


//Mouse Input (click Listener)
window.addEventListener("click", e => {

    //START ALPHA CHANGE 733 -- options keybind: disable mouse click actions while awaitingKeyInput/awaitingGamepadInput --
    if (this.game && this.game.ui && (this.game.ui.awaitingKeyInput || this.game.ui.awaitingGamepadInput)) {
        console.log("Mouse click ignored: awaiting input (finish bind with key, or cancel with ESC/Create)");
        return;// do nothing while we await for the binding of keyboard (awaitingKeyInput) or gamepad buttons (awaitingGamepadInput)
    }
    //FINISH ALPHA CHANGE 733 -- options keybind: disable mouse click actions while awaitingKeyInput/awaitingGamepadInput --

    if (this.game.gameState === "mainMenu") {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        this.mouseX = (e.clientX - rect.left) * scaleX;
        this.mouseY = (e.clientY - rect.top) * scaleY;
        let stateChanged = false;
        this.game.ui.menuItemBounds.forEach((item) => { //uses only item and not index unlike the other forEach calls 
            if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                if (item.text === "New Game") {
                    this.game.startGame();
                    stateChanged = true;
                } else if (item.text === "Options") {
                    this.game.gameState = "options";
                    this.game.ui.selectedOptionIndex = 0;
                    this.game.ui.awaitingKeyInput = false; // Ensure not in rebinding mode
                    this.game.sound.pauseSoundtrack();
                    stateChanged = true;
                    console.log("Clicked Options, transitioned to options menu");
                } else if (item.text === "Multiplayer") {
                    this.game.gameState = "multiplayer";
                    this.game.ui.selectedMultiplayerIndex = 0;
                    this.game.sound.pauseSoundtrack();
                    stateChanged = true;
                    //START ALPHA CHANGE 231 -- reset Region/Custom defaults on mouse-enter Multiplayer --
                    this.game.ui._lobbyRegionIndex  = 0;       // default: US
                    this.game.ui._lobbyCustomTag    = "COOP";  // default custom tag
                    this.game.ui._editingLobbyCustom = false;  // not editing on entry
                    this.game.ui._customCharIndex    = 0;      // safe baseline for chooser
                    //FINISH ALPHA CHANGE 231 -- reset Region/Custom defaults on mouse-enter Multiplayer --
                    console.log("Clicked Multiplayer, transitioned to multiplayer menu");
                } else if (item.text === "INNBC Universe") {
                    this.game.gameState = "innbcUniverse";
                    this.game.ui.selectedInnbcUniverseIndex = 0;
                    this.game.sound.pauseSoundtrack();
                    stateChanged = true;
                    console.log("Clicked INNBC Universe, transitioned to INNBC Universe menu");
                //start change -- add Full Screen to main menu//
                } else if (item.text === "Full Screen") {
                    this.game.toggleFullScreen();
                    stateChanged = true;
                    console.log("Clicked Full Screen, toggled to:", this.game.fullScreen ? "On" : "Off");
                //finish change//
                } else if (item.text === "Quit Game") {
                    if (window.require) {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.send('quit-game');
                        console.log("Clicked Quit Game, sent quit-game IPC to main process");
                    } else {
                        console.warn("Electron not available, quit-game skipped");
                    }
                    stateChanged = true;
                }
            }
        });
        if (stateChanged) return; // Prevent options click logic after state change
    }

if (this.game.gameState === "options") {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.mouseX = (e.clientX - rect.left) * scaleX;
    this.mouseY = (e.clientY - rect.top) * scaleY;
    this.game.ui.optionsItemBounds.forEach((item, index) => { //uses item and index 
        if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
            this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
            this.game.ui.selectedOptionIndex = index;
            if (item.action === "Back") {
                this.game.gameState = "mainMenu";
                this.game.ui.selectedMenuIndex = 0;
                this.game.ui.awaitingKeyInput = false;
                console.log("Clicked Back, returned to main menu");
            } else if (item.action === "FPS Counter") { // New: Toggle FPS
                this.game.showFPS = !this.game.showFPS;
                this.game.saveFPSSetting();
                console.log("Clicked FPS Counter, toggled to:", this.game.showFPS ? "On" : "Off");
            } else if (item.action === "Full Screen") {
                this.game.toggleFullScreen();
                console.log("Clicked Full Screen, toggled to:", this.game.fullScreen ? "On" : "Off");
                //start change -- handle click to enter gamepad setup submenu//
                } else if (item.action === "Gamepad Setup") {
                    this.game.gameState = "gamepadSetup";
                    this.game.ui.selectedGamepadIndex = 0;
                    this.game.ui.awaitingGamepadInput = false;
                    console.log("Clicked Gamepad Setup, transitioned to gamepad setup menu");
                //finish change//
                } else if (item.action === "Reset All Settings") {
                this.game.resetAllSettings();
                console.log("Reset All Settings triggered via mouse");
            //START ALPHA CHANGE 200 -- handle Reset Score via mouse in options -- it also prevents 
            } else if (item.action === "Reset Score") {
                this.game.leaderboard.resetScores();
                console.log("Reset Score triggered via mouse");
            //FINISH ALPHA CHANGE 200 -- handle Reset Score via mouse in options --
            //START ALPHA CHANGE 292 -- Options: prevent key-binding prompt for "Difficulty" on mouse click 
            /* Without it, the existing fallback path (else { this.game.ui.awaitingKeyInput = true; }) 
            would trigger the key-rebinding prompt when you click Timer. Since Timer is edited with Left/Right only (no key binding), 
            we need that small mouse special-case to avoid the prompt and keep UX consistent */
             //START ALPHA CHANGE 292 -- Mouse: clicking Difficulty (Timer action) cycles Hard→Normal→Easy and persists --
            } else if (item.action === "Timer") {
                //START ALPHA CHANGE 431 -- Mouse: cycle Difficulty by labels (Hard flag vs Normal/Easy timers) --
                const NORMAL =  90000; // 1:30
                const EASY   = 120000; // 2:00
                 const currentLabel = this.game.hardMode ? "Hard"
                    : ((this.game.timeLimit|0) >= EASY ? "Easy" : "Normal");
                const order = ["Normal","Hard","Easy"]; //ALPHA CHANGE 529 -- mouse button cycling I like more this way
                const nextLabel = order[(order.indexOf(currentLabel) + 1) % order.length];

                if (nextLabel === "Hard") {
                    this.game.hardMode = true;
                    this.game.timeLimit = NORMAL;     // keep Normal timer when Hard is active
                } else if (nextLabel === "Normal") {
                    this.game.hardMode = false;
                    this.game.timeLimit = NORMAL;
                } else { // "Easy"
                    this.game.hardMode = false;
                    this.game.timeLimit = EASY;
                }
                this.game.saveHardModeSetting(); //persist immediately in localStorage
                this.game.saveTimeLimitSetting(); //persist immediately in localStorage
                this.game.ui.awaitingKeyInput = false; // never open key-rebind prompt
                this.game.keyConflict = false;
                console.log("Clicked Timer (Difficulty):", nextLabel);
                //FINISH ALPHA CHANGE 431 -- Mouse label cycle --
            //FINISH ALPHA CHANGE 292 -- Mouse: clicking Difficulty cycles & persists --
            } else {
                this.game.ui.awaitingKeyInput = true;
                console.log("Clicked option:", item.action, "awaiting key input");
            }
        }
    });
    //start change -- handle mouse clicks in gamepad setup submenu//
} else if (this.game.gameState === "gamepadSetup") {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.mouseX = (e.clientX - rect.left) * scaleX;
    this.mouseY = (e.clientY - rect.top) * scaleY;
    let stateChanged = false;
    this.game.ui.gamepadItemBounds.forEach((item, index) => { //uses item and index 
        if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
            this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
            this.game.ui.selectedGamepadIndex = index;
            console.log("Clicked item:", item.action, "at index:", index, "coords:", this.mouseX, this.mouseY); // Added debug log to confirm click detection
            if (item.action === "Back") {
                this.game.gameState = "options";
                this.game.ui.selectedOptionIndex = 0;
                this.game.ui.awaitingGamepadInput = false;
                stateChanged = true;
                console.log("Clicked Back in Gamepad Setup, returned to options");       
            } else {
                this.game.ui.awaitingGamepadInput = true;
                console.log("Clicked gamepad option:", item.action, "awaiting gamepad input");
            }
        }
    });
    if (stateChanged) return; // Prevent further gamepadSetup click logic after state change
    //finish change//
    //start change -- mouse click event for multiplayer menu
        } else if (this.game.gameState === "multiplayer") {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mouseX = (e.clientX - rect.left) * scaleX;
            this.mouseY = (e.clientY - rect.top) * scaleY;
            let stateChanged = false;
            this.game.ui.multiplayerItemBounds.forEach((item, index) => { //uses item and index 
                if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
                    this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
                    this.game.ui.selectedMultiplayerIndex = index;
                    if (this.game.steamMultiplayer.lobbyState === "inLobby") {
                        if (item.text === "Start Game" && this.game.steamMultiplayer.isHost) {
                            this.game.steamMultiplayer.startMultiplayerGame();
                            console.log("multiplayer: Enter started game");
                        } else if (item.text === "Leave Lobby") { //START ALPHA CHANGE 235
                            this.game.steamMultiplayer.leaveLobby();
                            stateChanged = true;
                            console.log("Clicked Leave Lobby in Multiplayer");
                        } //FINISH ALPHA CHANGE 235
                    } else {
                        if (item.text === "Create Lobby") {
                            this.game.steamMultiplayer.createLobby();
                            stateChanged = true;
                            console.log("Clicked Create Lobby in Multiplayer");
                        } else if (item.text === "Join Lobby") {
                            //START ALPHA CHANGE 2 -- reset gamepad button states on mouse entry to joinLobby--
                           this.game.gameState = "joinLobby";
                           // start change -- enter joinLobby with buttons focus; no preselect (mouse) --
                           this.game.ui.joinLobbyFocus = 'buttons';
                           this.game.ui.selectedJoinLobbyIndex = -1; // no highlight until hover
                           this.game.ui.selectedMultiplayerIndex = -1;
                           // finish change
                        this.game.steamMultiplayer.requestLobbyList();
                        if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //FINISH ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                                console.log("Mouse entered joinLobby, reset gamepad button states");
                            }
                        }
                        console.log("Clicked Join Lobby, transitioned to joinLobby menu");
                        //FINISH ALPHA CHANGE 2 -- reset gamepad button states on mouse entry to joinLobby--
                        } else if (item.text === "Back") {
                            //START ALPHA CHANGE 2 -- reset gamepad button states on mouse exit from multiplayer--
                            this.game.gameState = "mainMenu";
                            this.game.ui.selectedMenuIndex = 0;
                           if (this.gamepadConnected && this.gamepadIndex !== null) {
                            const gamepad = navigator.getGamepads()[this.gamepadIndex];
                            if (gamepad) {
                                //START ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                                this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                                this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                                //START ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                                console.log("Mouse exited multiplayer to mainMenu, reset gamepad button states");
                            }
                        }
                        console.log("Clicked Back in Multiplayer, returned to main menu");
                        //FINISH ALPHA CHANGE 2 -- reset gamepad button states on mouse exit from multiplayer--
                        }
                    }
                }
            });
            if (stateChanged) return; // Prevent further multiplayer click logic after state change
            // start change -- mouse click handling for joinLobby (buttons first, then lobby rows) --
        } else if (this.game.gameState === "joinLobby") {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mouseX = (e.clientX - rect.left) * scaleX;
            this.mouseY = (e.clientY - rect.top) * scaleY;
            let stateChanged = false;

            // 1) Hit-test buttons: "Refresh", "Back"
            for (let i = 0; i < this.game.ui.joinLobbyItemBounds.length; i++) {
                const btn = this.game.ui.joinLobbyItemBounds[i];
                if (this.mouseX >= btn.x && this.mouseX <= btn.x + btn.width &&
                    this.mouseY >= btn.y && this.mouseY <= btn.y + btn.height) {

                    this.game.ui.joinLobbyFocus = 'buttons';           // start change
                    this.game.ui.selectedJoinLobbyIndex = i;           // start change

                    if (btn.action === "refresh") {
                        this.game.steamMultiplayer._lastLobbyRefreshManual = true; //START ALPHA CHANGE 99
                        this.game.steamMultiplayer._lastLobbyRefreshAt = performance.now(); 
                        this.game.steamMultiplayer.requestLobbyList();
                        stateChanged = true;
                        console.log("Clicked Refresh in joinLobby (manual)"); //FINISH ALPHA CHANGE 99
                    } else if (btn.action === "back") {
                        //START ALPHA CHANGE 2 -- reset gamepad button states on mouse exit from joinLobby--
                        this.game.gameState = "multiplayer";
                        this.game.ui.selectedMultiplayerIndex = 0;
                        this.game.steamMultiplayer.selectedLobbyIndex = 0;
                        this.game.ui.joinLobbyFocus = 'list';          // predictable re-entry
                       this.game.ui.selectedJoinLobbyIndex = 0;
                    if (this.gamepadConnected && this.gamepadIndex !== null) {
                        const gamepad = navigator.getGamepads()[this.gamepadIndex];
                        if (gamepad) {
                            //START ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                            this.lastGamepadButtons[0] = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                            this.lastGamepadButtons[1] = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                            //START ALPHA CHANGE 716 -- gamepad: guard button[0]/[1] reads on mouse-driven state changes --
                            console.log("Mouse exited joinLobby to multiplayer, reset gamepad button states");
                        }
                    }
                    console.log("Clicked Back in joinLobby, returned to multiplayer");             
                    stateChanged = true;
                    } //FINISH ALPHA CHANGE 2 -- reset gamepad button states on mouse exit from joinLobby--
                    //START ALPHA CHANGE 92 -- mouse: use centralized teardown via returnToMainMenu()
                    else if (btn.action === "leave") {
                        this.game.returnToMainMenu(); //START ALPHA CHANGE 92
                        console.log("Clicked Leave Lobby (joinLobby overlay) -> returnToMainMenu()");
                        stateChanged = true;
                    }
                    //FINISH ALPHA CHANGE 92
                    break;
                }
            }
            if (stateChanged) return;

            // 2) Hit-test lobby rows (multiplayerItemBounds)
            for (let i = 0; i < this.game.ui.multiplayerItemBounds.length; i++) {
                const row = this.game.ui.multiplayerItemBounds[i];
                if (this.mouseX >= row.x && this.mouseX <= row.x + row.width &&
                    this.mouseY >= row.y && this.mouseY <= row.y + row.height) {

                    this.game.ui.joinLobbyFocus = 'list';              // start change
                    this.game.ui.selectedMultiplayerIndex = i;         // start change
                    if (row.action === "joinLobby" && row.lobbyId) {
                        this.game.steamMultiplayer.selectedLobbyIndex = i;
                        this.game.steamMultiplayer.joinLobby(row.lobbyId);
                        stateChanged = true;
                        console.log("Clicked Join Lobby:", row.lobbyId);
                    }
                    break;
                }
            }
            if (stateChanged) return;
        // finish change -- mouse click handling for joinLobby (buttons first, then lobby rows) --
            //finish change multiplayer mouse click event for multiplayer menu 
//start change -- update mouse navigation for INNBC Universe to support story pages and links//
} else if (this.game.gameState === "innbcUniverse") {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.mouseX = (e.clientX - rect.left) * scaleX;
    this.mouseY = (e.clientY - rect.top) * scaleY;
    console.log("Click at", this.mouseX, this.mouseY, "Selected Index:", this.game.ui.selectedInnbcUniverseIndex, "Bounds:", this.game.ui.innbcUniverseItemBounds); // Debug
    let stateChanged = false;
    this.game.ui.innbcUniverseItemBounds.forEach((item, index) => {// uses item and index
        if (this.mouseX >= item.x && this.mouseX <= item.x + item.width &&
            this.mouseY >= item.y && this.mouseY <= item.y + item.height) {
            this.game.ui.selectedInnbcUniverseIndex = index;
            if (item.action === "MenuBack") {
                this.game.gameState = "mainMenu";
                this.game.ui.selectedMenuIndex = 0;
                this.game.innbcUniverse.currentUniversePage = 0;
                stateChanged = true;
                console.log("Clicked Main Menu in INNBC Universe, returned to main menu");
            } else if (item.action === "Next") {
                this.game.innbcUniverse.currentUniversePage = Math.min(this.game.innbcUniverse.currentUniversePage + 1, this.game.innbcUniverse.innbcUniversePages.length - 1);
                this.game.ui.selectedInnbcUniverseIndex = 0;
                stateChanged = true;
                console.log("Clicked Next in INNBC Universe, page:", this.game.innbcUniverse.currentUniversePage);
            } else if (item.action === "Back") {
                this.game.innbcUniverse.currentUniversePage = Math.max(this.game.innbcUniverse.currentUniversePage - 1, 0);
                this.game.ui.selectedInnbcUniverseIndex = 0;
                stateChanged = true;
                console.log("Clicked Back in INNBC Universe, page:", this.game.innbcUniverse.currentUniversePage);
            } else if (item.action === "Link") {
                window.open(item.url, "_blank");
                console.log("Clicked link in INNBC Universe:", item.url);
            }
        }
    });
    if (stateChanged) return; // Prevent further processing after state change
}
//finish change//
});

 }//FINE DELLA CLASSE constructor di Inputhandler constructor(game, canvas)
 
 //START ALPHA CHANGE 708 -- cursor: duplicate ALPHA 707 hide-after-1s logic outside mousemove -- 
 //arms the hide logic the first time when gameplay starts (so it works even if you never move the mouse unlike ALPHA 707) 
 //Note: both ALPHA 707 and 708 store in the InputHandler instance property "this._cursorHideTimer707" with a “clear + null” pattern,
 //each re-arm cancels the prior pending hide and replaces it
    armCursorHideTimer707() {
        try {
            // Always show cursor immediately, then (if playing) schedule hide after inactivity window.
            if (this.canvas && this.canvas.style) this.canvas.style.cursor = "default";

            const isPlaying707 = !!(this.game && this.game.gameState === "playing");
            if (isPlaying707) {
                if (this._cursorHideTimer707) {
                    clearTimeout(this._cursorHideTimer707);
                    this._cursorHideTimer707 = null;
                }
                this._cursorHideTimer707 = setTimeout(() => {
                    try {
                        // Only hide if we are STILL in gameplay when the timer fires
                        if (this.game && this.game.gameState === "playing" && this.canvas && this.canvas.style) {
                            this.canvas.style.cursor = "none";
                        }
                    } catch (_) {}
                }, 1000);
            } else {
                // Not playing: cancel any pending hide so menus won’t get hidden by a leftover gameplay timer
                if (this._cursorHideTimer707) {
                    clearTimeout(this._cursorHideTimer707);
                    this._cursorHideTimer707 = null;
                }
            }
        } catch (_) {}
    }

    showCursorAndCancel707() {
        try {
            if (this._cursorHideTimer707) {
                clearTimeout(this._cursorHideTimer707);
                this._cursorHideTimer707 = null;
            }
        } catch (_) {}
        try {
            if (this.canvas && this.canvas.style) this.canvas.style.cursor = "default";
        } catch (_) {}
    }
    //FINISH ALPHA CHANGE 708 -- cursor: reuse ALPHA 707 hide-after-2s logic outside mousemove --

 //START ALPHA CHANGE 485 -- pollHeldKeysForGameplay: per-frame keyboard autofire for SP/host (runs even without gamepad) --
 // Actual firing is handled per-frame in pollHeldKeysForGameplay() for single-player/host only
pollHeldKeysForGameplay() {
    const kbFireKey486 = this.game && this.game.keyBindings && this.game.keyBindings.fire;
    const sm486 = this.game && this.game.steamMultiplayer; //this gates the MP client so it does not call this.game.player.shoot();
    const isMultiplayerClient486 = !!(sm486 && sm486.isMultiplayer && !sm486.isHost);

    if (isMultiplayerClient486) return;
    if (!kbFireKey486) return;
    if (!this.game || this.game.gameState !== "playing" || this.game.paused || this.game.gameOver) return;
    if (!this.game.player) return;
    if (!this.game.keys || this.game.keys.indexOf(kbFireKey486) === -1) return;

    const now486 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now486 - this.lastShotTime >= this.shotInterval) {
        this.game.player.shoot();
        this.lastShotTime = now486;
    }
}
//FINISH ALPHA CHANGE 485 -- pollHeldKeysForGameplay: per-frame keyboard autofire for SP/host (runs even without gamepad) --

//start change -- add pollGamepad method for rebinding in gamepad setup submenu//
//pollGamepadForMenus() is for navigating/selecting menu items, and pollGamepad() is for capturing the next input 
//during rebinding (it’s a no-op unless this.ui.awaitingGamepadInput === true). That’s why you “need both”.
//In pratica, questo registra i tasti, mentre pollGamepadForMenus li muove (per quello lo ignoriamo al rebinding: ALPHA CHANGE 729)
pollGamepad() {
    if (!this.gamepadConnected || this.gamepadIndex === null || !this.game.ui.awaitingGamepadInput) {
        return;
    }
    const gamepad = navigator.getGamepads()[this.gamepadIndex];
    if (!gamepad) return;

    const actionKeyMap = {
        "Move Up": "moveUp",
        "Move Down": "moveDown",
        "Move Left": "moveLeft",
        "Move Right": "moveRight",
        "Fire": "fire",
        "Pause": "pause"
        // "Debug Toggle": "debug" // Commented out for release
    };
    const selectedAction = this.game.ui.gamepadItems[this.game.ui.selectedGamepadIndex].action;
    const targetKey = actionKeyMap[selectedAction];

    //start change -- add Triangle (button_3) to cancel gamepad binding and fix X/Circle conflicts//
    // Check for Triangle (button_3) to cancel binding, like Escape
    /*if (gamepad.buttons[3] && gamepad.buttons[3].pressed && !this.lastGamepadButtons[3]) {
        this.game.ui.awaitingGamepadInput = false;
        this.game.gamepadConflict = false;
        this.lastGamepadButtons[3] = true;
        this.justBoundGamepadInput = false; // Reset on cancel
        console.log("Gamepad binding canceled with Triangle button");
        return;
    } else if (!(gamepad.buttons[3] && gamepad.buttons[3].pressed)) {
        this.lastGamepadButtons[3] = false;
    }*/ 
    // commented out binding cancellation logic to avoid conflict with key binding of the same button (I used button_8)
    //START ALPHA CHANGE 728 -- gamepadSetup: reserve Create (button_8) as "cancel bind" (like ESC) --
    const createPressed728 = !!(gamepad.buttons[8] && gamepad.buttons[8].pressed);
    if (createPressed728 && !this.lastGamepadButtons[8]) {
        this.game.ui.awaitingGamepadInput = false;
        this.game.gamepadConflict = false;
        this.lastGamepadButtons[8] = true;
        this.justBoundGamepadInput = true; // treat cancel like "just finished capture" so menus don't consume held inputs
        console.log("Gamepad binding canceled with Create button (button_8)");
        return;
    } else if (!createPressed728) {
        this.lastGamepadButtons[8] = false;
    }
    //FINISH ALPHA CHANGE 728 -- gamepadSetup: reserve Create (button_8) as "cancel bind" (like ESC) --

    // Check buttons (0-15 for PS5 DualSense: X=0, Circle=1, Square=2, Triangle=3, Options=9, Touchpad=13)
    for (let i = 0; i < Math.min(gamepad.buttons.length, this.lastGamepadButtons.length); i++) {
        //START ALPHA CHANGE 716 -- gamepad: guard gamepad.buttons[i].pressed during rebinding --
        const buttonPressed = !!(gamepad.buttons[i] && gamepad.buttons[i].pressed);
        //FINISH ALPHA CHANGE 716 -- gamepad: guard gamepad.buttons[i].pressed during rebinding --
        if (buttonPressed && !this.lastGamepadButtons[i]) {
            const input = `button_${i}`;
            if (this.game.checkGamepadConflict(input, selectedAction)) {
                this.game.gamepadConflict = true;
                console.log(`Gamepad input ${input} already in use for another action`);
                return;
            }
            this.game.gamepadBindings[targetKey] = input;
            this.game.saveGamepadBindings();
            this.game.ui.awaitingGamepadInput = false;
            this.game.gamepadConflict = false;
            this.justBoundGamepadInput = true; // Set flag on successful binding
            console.log(`Rebound ${selectedAction} to ${input}`);
            return;
        }
        this.lastGamepadButtons[i] = buttonPressed;
    }

    // Check axes (0-3 for PS5 DualSense: left stick X=0, Y=1, right stick X=2, Y=3)
    const deadZone = 0.5; // Threshold for stick movement
    for (let i = 0; i < Math.min(gamepad.axes.length, this.lastGamepadAxes.length); i++) {
        const axisValue = gamepad.axes[i];
        const prevAxisValue = this.lastGamepadAxes[i];
        let input = null;
        if (axisValue > deadZone && prevAxisValue <= deadZone) {
            input = `axis_${i}_pos`;
        } else if (axisValue < -deadZone && prevAxisValue >= -deadZone) {
            input = `axis_${i}_neg`;
        }
        if (input) {
            if (this.game.checkGamepadConflict(input, selectedAction)) {
                this.game.gamepadConflict = true;
                console.log(`Gamepad input ${input} already in use for another action`);
                return;
            }
            this.game.gamepadBindings[targetKey] = input;
            this.game.saveGamepadBindings();
            this.game.ui.awaitingGamepadInput = false;
            this.game.gamepadConflict = false;
            this.justBoundGamepadInput = true; // Set flag on successful binding
            console.log(`Rebound ${selectedAction} to ${input}`);
            return;
        }
    }
    // Update axis states
    for (let i = 0; i < Math.min(gamepad.axes.length, this.lastGamepadAxes.length); i++) {
        this.lastGamepadAxes[i] = gamepad.axes[i];
    }
}
//finish change//
//start change -- unify pause, game-over, and virtual keyboard logic into pollGamepadForGameplay to match keyboard behavior//
// Step 1: Update pollGamepadForGameplay to handle pause, game-over, and virtual keyboard
pollGamepadForGameplay() {
    if (!this.gamepadConnected || this.gamepadIndex === null) {
        //console.log("pollGamepadForGameplay: Skipped - connected:", this.gamepadConnected, "index:", this.gamepadIndex);
        return;
    }
    const gamepad = navigator.getGamepads()[this.gamepadIndex];
    if (!gamepad) {
        console.log("pollGamepadForGameplay: No gamepad detected");
        return;
    }

    // Ensure this.game.keys is defined
    if (!this.game.keys) {
        console.warn("this.game.keys was undefined, reinitializing");
        this.game.keys = [];
    }

    const actionKeyMap = {
        "moveUp": this.game.keyBindings.moveUp,
        "moveDown": this.game.keyBindings.moveDown,
        "moveLeft": this.game.keyBindings.moveLeft,
        "moveRight": this.game.keyBindings.moveRight,
        "fire": this.game.keyBindings.fire,
        "pause": this.game.keyBindings.pause
        // "debug": this.game.keyBindings.debug // Commented out for release
    };

    //START ALPHA CHANGE 714 -- gamepad: safe button reads for short controllers / bad bindings (avoid crash on missing indices) --
    const safeBtnPressed714 = (idx) => {
        try {
            return !!(gamepad && gamepad.buttons && gamepad.buttons[idx] && gamepad.buttons[idx].pressed);
        } catch (_) {
            return false;
        }
    };
    //FINISH ALPHA CHANGE 714 -- gamepad: safe button reads for short controllers / bad bindings --

    // Log raw inputs for debugging gamepad mappings
    //console.log("Gamepad axes[0]:", gamepad.axes[0], "axes[1]:", gamepad.axes[1], "buttons[0]:", gamepad.buttons[0].pressed, "buttons[1]:", gamepad.buttons[1].pressed, "buttons[9]:", gamepad.buttons[9].pressed, "buttons[12]:", gamepad.buttons[12].pressed, "buttons[13]:", gamepad.buttons[13].pressed, "buttons[14]:", gamepad.buttons[14].pressed, "buttons[15]:", gamepad.buttons[15].pressed);

    //start change -- consolidate gamepad pause toggle to handle both paused and unpaused states --
if (this.game.gameState === "playing" && !this.game.gameOver) {
    // Handle pause toggle independently
    const pauseButtonIndex = parseInt(this.game.gamepadBindings.pause.split("_")[1] || 9);
    //START ALPHA CHANGE 714 -- gamepad: safe pause button read (avoid crash on short controllers) --
    const pauseButtonPressed = safeBtnPressed714(pauseButtonIndex);
    //FINISH ALPHA CHANGE 714 -- gamepad: safe pause button read --
    if (pauseButtonPressed && !this.lastGamepadButtons[pauseButtonIndex]) {
        this.togglePause = true;
        this.game.paused = !this.game.paused; // Toggle pause state
        this.game.ui.selectedPauseIndex = 0;
        console.log("Pause: Toggled", this.game.paused ? "on" : "off", "with gamepad button", this.game.gamepadBindings.pause);
    } else if (!pauseButtonPressed && this.lastGamepadButtons[pauseButtonIndex]) {
        this.togglePause = false; // Reset togglePause on button release
        console.log("Gamepad pause button released, reset togglePause");
    }
    this.lastGamepadButtons[pauseButtonIndex] = pauseButtonPressed;

    // Handle other gameplay inputs only when not paused
    if (!this.game.paused) {
        for (let action in this.game.gamepadBindings) {
            if (action === "pause") continue; // Skip pause, handled above
            const input = this.game.gamepadBindings[action];
            if (input.startsWith("axis_")) {
                const [_, axisIndex, direction] = input.split("_");
                const axisValue = gamepad.axes[parseInt(axisIndex)];
                const deadZone = 0.5;
                const isActive = direction === "pos" ? axisValue > deadZone : axisValue < -deadZone;
                const key = actionKeyMap[action];
                if (isActive && this.game.keys.indexOf(key) === -1) {
                    this.game.keys.push(key);
                } else if (!isActive && this.game.keys.indexOf(key) !== -1) {
                    this.game.keys.splice(this.game.keys.indexOf(key), 1);
                }
            } else if (input.startsWith("button_")) {
                const buttonIndex = parseInt(input.split("_")[1]);
                //START ALPHA CHANGE 714 -- gamepad: safe action binding read (avoid crash if button index is missing) --
                const buttonPressed = safeBtnPressed714(buttonIndex);
                //FINISH ALPHA CHANGE 714 -- gamepad: safe action binding read --
                const key = actionKeyMap[action];
                //start change -- delete "&& !this.lastGamepadButtons[buttonIndex])" after "buttonPressed" to allow autofire
                if (action === "fire" && buttonPressed) {
                    const sm = this.game && this.game.steamMultiplayer;
                    //START ALPHA CHANGE 482 -- gamepad fire: client in MP uses input flags only, host/SP shoots locally + GAMMA CHANGE 5A (keyboard guard) + additional guard in ALPHA CHANGE 176 (projectile guard)
                    // Multiplayer client: only set the fire key so SteamMultiplayer can encode it without calling player.shoot() to avoid leaking projectiles 
                    if (sm && sm.isMultiplayer && !sm.isHost) {
                        if (this.game.keys.indexOf(key) === -1) {
                            this.game.keys.push(key);
                        }
                                      
                    } else {
                        // Single-player or host: original local fire with cooldown
                        //FINISH ALPHA CHANGE 482 -- gamepad fire: client in MP uses input flags only, host/SP shoots locally --
                    const currentTime = performance.now();
                    if (currentTime - this.lastShotTime >= this.shotInterval) {
                        this.game.player.shoot(); //host and SP only call this.game.player.shoot() to avoid leaking projectiles 
                        this.lastShotTime = currentTime;
                    }
                 }
                    //finish change
                } else if (action !== "fire" && action !== "debug" && buttonPressed && this.game.keys.indexOf(key) === -1) {
                    this.game.keys.push(key);
                } else if (!buttonPressed && this.game.keys.indexOf(key) !== -1) {
                    this.game.keys.splice(this.game.keys.indexOf(key), 1); // Safeguarded
                }
                this.lastGamepadButtons[buttonIndex] = buttonPressed;
            }
        }
    }
}
//finish change--

    // Handle pause menu navigation and selection
    if (this.game.gameState === "playing" && this.game.paused) {
        const pauseItems = ["Resume", "Main Menu", "Full Screen"];
        const deadZone = 0.5;
        const axisValue = gamepad.axes[1];
        //START ALPHA CHANGE 714 -- gamepad: use safeBtnPressed714 for hard-coded pause menu buttons --
        const upPressed = axisValue < -deadZone || safeBtnPressed714(12);
        const downPressed = axisValue > deadZone || safeBtnPressed714(13);
        const confirmPressed = safeBtnPressed714(0);
        const cancelPressed = safeBtnPressed714(1);
        //FINISH ALPHA CHANGE 714 -- gamepad: use safeBtnPressed714 for hard-coded pause menu buttons --

        if (upPressed && !this.lastGamepadNav.up) {
            this.game.ui.selectedPauseIndex = Math.max(0, this.game.ui.selectedPauseIndex - 1);
            this.lastGamepadNav.up = true;
            console.log("Pause Menu: Navigated up to index", this.game.ui.selectedPauseIndex);
        } else if (!upPressed) {
            this.lastGamepadNav.up = false;
        }
        if (downPressed && !this.lastGamepadNav.down) {
            this.game.ui.selectedPauseIndex = Math.min(pauseItems.length - 1, this.game.ui.selectedPauseIndex + 1);
            this.lastGamepadNav.down = true;
            console.log("Pause Menu: Navigated down to index", this.game.ui.selectedPauseIndex);
        } else if (!downPressed) {
            this.lastGamepadNav.down = false;
        }

        if (confirmPressed && !this.lastGamepadButtons[0]) {
            const selectedOption = pauseItems[this.game.ui.selectedPauseIndex];
            console.log("Pause Menu: Confirmed option", selectedOption);
            if (selectedOption === "Resume") {
                this.game.paused = false;
                this.togglePause = false;
            } else if (selectedOption === "Main Menu") {
                this.game.returnToMainMenu();
            } else if (selectedOption === "Full Screen") {
                this.game.toggleFullScreen();
            }
            this.lastGamepadButtons[0] = true;
        } else if (!confirmPressed) {
            this.lastGamepadButtons[0] = false;
        }

        if (cancelPressed && !this.lastGamepadButtons[1]) {
            this.game.paused = false;
            this.togglePause = false;
            console.log("Pause Menu: Canceled (Resumed)");
            this.lastGamepadButtons[1] = true;
        } else if (!cancelPressed) {
            this.lastGamepadButtons[1] = false;
        }
    }

    // Handle game-over menu and simplified name input
    if (this.game.gameState === "playing" && this.game.gameOver && this.game.gameOverMenuActive) { //ignore gamepad inputs during game-over menu delay
         // START ENHANCEMENT: Skip processing if just bound an input
    if (this.justBoundGamepadInput) {
        //START ALPHA CHANGE 714 -- gamepad: guard gameplay reads (works on controllers with fewer buttons) --
        this.lastGamepadButtons[0] = safeBtnPressed714(0);
        this.lastGamepadButtons[1] = safeBtnPressed714(1);
        this.lastGamepadButtons[9] = safeBtnPressed714(9);
         //FINISH ALPHA CHANGE 714 -- gamepad: guard gameplay reads (works on controllers with fewer buttons) --
        this.justBoundGamepadInput = false; // Reset immediately
        return;
    }
    // END ENHANCEMENT
        const deadZone = 0.5;
        const axisYValue = gamepad.axes[1];
        //const axisXValue = gamepad.axes[0]; -- removed, no need left and right analog input
        //START ALPHA CHANGE 714 -- gamepad: guard gameplay reads (works on controllers with fewer buttons) -- 
        const upPressed = axisYValue < -deadZone || safeBtnPressed714(12);
        const downPressed = axisYValue > deadZone || safeBtnPressed714(13);
        // const leftPressed = axisXValue < -deadZone || gamepad.buttons[14].pressed; -- removed, no need d-pad left 
        // const rightPressed = axisXValue > deadZone || gamepad.buttons[15].pressed; -- removed, no need d-pad right 
        const confirmPressed = safeBtnPressed714(0);
        const cancelPressed = safeBtnPressed714(1);
        const startPressed = safeBtnPressed714(9);
        //FINISH ALPHA CHANGE 714 -- gamepad: guard gameplay reads (works on controllers with fewer buttons) --

        if (this.game.awaitingNameInput) {
            // Simplified name input for gamepad
            if (!this.nameInputCursor) {
                this.nameInputCursor = {
                    chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
                    currentLetter: "A",
                    cursorIndex: this.nameInput.length // Start at end of existing nameInput
                };
            }

            // Navigate letters with up/down
            if (upPressed && !this.lastGamepadNav.up) {
                const currentIdx = this.nameInputCursor.chars.indexOf(this.nameInputCursor.currentLetter);
                this.nameInputCursor.currentLetter = this.nameInputCursor.chars[(currentIdx - 1 + this.nameInputCursor.chars.length) % this.nameInputCursor.chars.length];
                this.lastGamepadNav.up = true;
                console.log("Name Input: Changed to letter", this.nameInputCursor.currentLetter);
            } else if (!upPressed) {
                this.lastGamepadNav.up = false;
            }
            if (downPressed && !this.lastGamepadNav.down) {
                const currentIdx = this.nameInputCursor.chars.indexOf(this.nameInputCursor.currentLetter);
                this.nameInputCursor.currentLetter = this.nameInputCursor.chars[(currentIdx + 1) % this.nameInputCursor.chars.length];
                this.lastGamepadNav.down = true;
                console.log("Name Input: Changed to letter", this.nameInputCursor.currentLetter);
            } else if (!downPressed) {
                this.lastGamepadNav.down = false;
            }

            // Confirm letter (X button)
            if (confirmPressed && !this.lastGamepadButtons[0] && this.nameInput.length < this.maxNameInputLength) {
                this.nameInput += this.nameInputCursor.currentLetter;
                this.nameInputCursor.cursorIndex = this.nameInput.length;
                this.nameInputCursor.currentLetter = "A"; // Reset to "A" for next position
                console.log("Name Input: Added letter", this.nameInputCursor.currentLetter, "name now:", this.nameInput);
                this.lastGamepadButtons[0] = true;
            } else if (!confirmPressed) {
                this.lastGamepadButtons[0] = false;
            }

            // Delete letter (Circle button)
            if (cancelPressed && !this.lastGamepadButtons[1] && this.nameInput.length > 0) {
                this.nameInput = this.nameInput.slice(0, -1);
                this.nameInputCursor.cursorIndex = this.nameInput.length;
                this.nameInputCursor.currentLetter = "A"; // Reset to "A"
                console.log("Name Input: Deleted letter, name now:", this.nameInput);
                this.lastGamepadButtons[1] = true;
            } else if (!cancelPressed) {
                this.lastGamepadButtons[1] = false;
            }

           // Submit name (Start button)
            if (startPressed && !this.lastGamepadButtons[9]) {
                this.game.submitName(this.nameInput);
                this.nameInput = "";
                this.nameInputCursor = null;
                console.log("Name Input: Submitted name with Start", this.nameInput);
                this.lastGamepadButtons[9] = true;
            } else if (!startPressed) {
                this.lastGamepadButtons[9] = false;
            }
        } else {
            // Game-over menu navigation
            if (upPressed && !this.lastGamepadNav.up) {
                this.game.ui.selectedGameOverIndex = Math.max(0, this.game.ui.selectedGameOverIndex - 1);
                this.lastGamepadNav.up = true;
                console.log("Game Over: Navigated up to index", this.game.ui.selectedGameOverIndex);
            } else if (!upPressed) {
                this.lastGamepadNav.up = false;
            }
            if (downPressed && !this.lastGamepadNav.down) {
                this.game.ui.selectedGameOverIndex = Math.min(this.game.ui.gameOverItems.length - 1, this.game.ui.selectedGameOverIndex + 1);
                this.lastGamepadNav.down = true;
                console.log("Game Over: Navigated down to index", this.game.ui.selectedGameOverIndex);
            } else if (!downPressed) {
                this.lastGamepadNav.down = false;
            }

            // Confirm selection
            if (confirmPressed && !this.lastGamepadButtons[0]) {
                const selectedOption = this.game.ui.gameOverItems[this.game.ui.selectedGameOverIndex];
                console.log("Game Over: Confirmed option", selectedOption);
                if (selectedOption === "Restart") {
                    this.lastShotTime = performance.now(); //ALPHA CHANGE 457 -- block residual confirm press from firing a shot
                    this.game.reset();
                } else if (selectedOption === "Main Menu") {
                    this.game.returnToMainMenu();
                }
                this.lastGamepadButtons[0] = true;
            } else if (!confirmPressed) {
                this.lastGamepadButtons[0] = false;
            }

            // Cancel to Main Menu
            if (cancelPressed && !this.lastGamepadButtons[1]) {
                this.game.returnToMainMenu();
                console.log("Game Over: Canceled to Main Menu");
                this.lastGamepadButtons[1] = true;
            } else if (!cancelPressed) {
                this.lastGamepadButtons[1] = false;
            }
        }
    }

    // Reset togglePause when Start button is released
    //START ALPHA CHANGE 714 -- gamepad: safe Start button read (avoid crash on short controllers) --
    const startButtonPressed = safeBtnPressed714(9);
    //FINISH ALPHA CHANGE 714 -- gamepad: safe Start button read --
    if (!startButtonPressed && this.lastGamepadButtons[9]) {
        this.togglePause = false;
        console.log("Gamepad Start button released, reset togglePause");
    }
    this.lastGamepadButtons[9] = startButtonPressed;
}
//finish change
//start change -- fix pollGamepadForMenus to use correct menu item arrays and indices//
//pollGamepadForMenus() (despite the name) is your central menu input loop. It reads both keyboard and gamepad state, normalizes them into confirmPressed, upPressed, etc., applies edge detection and selection logic, 
//and then executes the single switch/case that handles items like “Reset All Settings.” But you still need to define the case in the keydown handler or it'll prompt rebind button (see ALPHA CHANGE 202)
pollGamepadForMenus() {
    if (!this.gamepadConnected || this.gamepadIndex === null || !["mainMenu", "options", "gamepadSetup", "multiplayer", "innbcUniverse", "joinLobby"].includes(this.game.gameState)) {
        // Changed: Added joinLobby to valid states to ensure it’s processed
        return;
    }
    const gamepad = navigator.getGamepads()[this.gamepadIndex];
    if (!gamepad) return;

    //START ALPHA CHANGE 715 -- menus: safe gamepad button reads (avoid crash on short controllers) --
    const safeMenuBtnPressed715 = (idx) => {
        try {
            return !!(gamepad && gamepad.buttons && gamepad.buttons[idx] && gamepad.buttons[idx].pressed);
        } catch (_) {
            return false;
        }
    };
    //FINISH ALPHA CHANGE 715 -- menus: safe gamepad button reads (avoid crash on short controllers) --

    // Use left stick Y-axis (axis_1) or D-pad up/down (buttons 12/13) for navigation
    //START ALPHA CHANGE 12 -- split analog vs D-pad at the source—
    // Read left stick Y and D-pad separately
    const axisValue = gamepad.axes[1]; // axis_1: negative = up, positive = down
    const deadZone = 0.5;
    // D-pad (legacy/global menus use these)
    const upPressed = safeMenuBtnPressed715(12); // D-pad up ONLY -- ALPHA CHANGE 715 -- safe gamepad button reads
    const downPressed = safeMenuBtnPressed715(13); // D-pad down ONLY -- ALPHA CHANGE 715 -- safe gamepad button reads
    // Analog stick (for list-style UI we want to isolate from D-pad)
    const analogUpPressed   = axisValue < -deadZone;
    const analogDownPressed = axisValue >  deadZone;
    // One-frame edges per channel
    const analogUpEdge   = analogUpPressed   && !this.lastAnalogNav.up;
    const analogDownEdge = analogDownPressed && !this.lastAnalogNav.down;

    const dpadUpEdge     = upPressed   && !this.lastDpadNav.up;
    const dpadDownEdge   = downPressed && !this.lastDpadNav.down;
    //FINISH ALPHA CHANGE 12 --

    const confirmPressed = safeMenuBtnPressed715(0); // X button for Enter -- ALPHA CHANGE 715 -- safe gamepad button reads
    const cancelPressed = safeMenuBtnPressed715(1); // Circle button for Escape -- ALPHA CHANGE 715 -- safe gamepad button reads

    //START ALPHA CHANGE 729 -- gamepadSetup: while rebinding, freeze menu navigation; swallow held inputs --
    const createPressed729 = safeMenuBtnPressed715(8); // "Create" button on PS controllers (reserved for cancel during bind)
    this.lastGamepadButtons = this.lastGamepadButtons || new Array(16).fill(false);

    //START ALPHA CHANGE 732 -- options: while awaiting keyboard bind, freeze gamepad menu; Create cancels --
    if (this.game.gameState === "options" && this.game.ui.awaitingKeyInput) {
        const prevCreate = !!this.lastGamepadButtons[8];
        const createEdge = createPressed729 && !prevCreate;

        if (createEdge) {
            this.game.ui.awaitingKeyInput = false;
            this.game.keyConflict = false; // Clear conflict on cancel
            console.log("options: Create -> cancel keyboard bind (gamepad)");
        }

        // Consume current states so no nav/action edges fire while binding (or right after cancel)
        this.lastAnalogNav.up = analogUpPressed;
        this.lastAnalogNav.down = analogDownPressed;
        this.lastDpadNav.up = upPressed;
        this.lastDpadNav.down = downPressed;
        this.lastGamepadButtons[0] = confirmPressed;
        this.lastGamepadButtons[1] = cancelPressed;
        this.lastGamepadButtons[8] = createPressed729;

        // Keep this in sync so confirm/cancel guards don't get stuck
        this.game.ui.wasAwaitingGamepadInput = this.game.ui.awaitingGamepadInput;

        return;
    }
    //FINISH ALPHA CHANGE 732 -- options: while awaiting keyboard bind, freeze gamepad menu; Create cancels --

    if (this.game.gameState === "gamepadSetup") {
        // During capture: ignore all menu input (no selector movement); only update edge memory.
        if (this.game.ui.awaitingGamepadInput) {
            // (Cancel itself is handled in pollGamepad() so Create cannot be bound accidentally.)

            // Consume current states so nothing fires as an "edge" when capture ends.
            this.lastAnalogNav.up = analogUpPressed;
            this.lastAnalogNav.down = analogDownPressed;
            this.lastDpadNav.up = upPressed;
            this.lastDpadNav.down = downPressed;
            this.lastGamepadButtons[0] = confirmPressed;
            this.lastGamepadButtons[1] = cancelPressed;
            this.lastGamepadButtons[8] = createPressed729;
            return;
        }

        // Right after a successful bind (or a cancel), swallow one frame so held stick/D-pad doesn't move the selection.
        if (this.justBoundGamepadInput) {
            this.justBoundGamepadInput = false;

            this.lastAnalogNav.up = analogUpPressed;
            this.lastAnalogNav.down = analogDownPressed;
            this.lastDpadNav.up = upPressed;
            this.lastDpadNav.down = downPressed;
            this.lastGamepadButtons[0] = confirmPressed;
            this.lastGamepadButtons[1] = cancelPressed;
            this.lastGamepadButtons[8] = createPressed729;
            return;
        }
    }
    //FINISH ALPHA CHANGE 729 -- gamepadSetup: while rebinding, freeze menu navigation; swallow held inputs --

    // start change -- consume current button states on menu/state entry so no carried-over edge fires --
    this.lastGamepadNav = this.lastGamepadNav || {};// intentionally an object (used like:this.lastGamepadNav.up/down etc.) So || {} is correct. But lastGamepadButtons is used as an array
    this.lastGamepadButtons = this.lastGamepadButtons || new Array(16).fill(false); // ALPHA CHANGE 730 -- lastGamepadButtons must be a fixed-size Array (never {}) -- (this.lastGamepadButtons[0], [1], [8], etc.)
    if (this._prevGameState !== this.game.gameState) {
        // reset nav edges
        this.lastGamepadNav.up = false;
        this.lastGamepadNav.down = false;

        //START ALPHA CHANGE 12 -- also reset split edge memories—
        this.lastAnalogNav.up = false;
        this.lastAnalogNav.down = false;
        this.lastDpadNav.up = false;
        this.lastDpadNav.down = false;
        //FINISH ALPHA CHANGE 12 —

        // consume buttons so edge detection won't trigger this frame
        this.lastGamepadButtons[0] = confirmPressed; // X
        this.lastGamepadButtons[1] = cancelPressed;  // Circle
        // (optional) if you also rely on left/right: initialize them here too
        // this.lastGamepadButtons[14] = gamepad.buttons[14]?.pressed; // D-pad left
        // this.lastGamepadButtons[15] = gamepad.buttons[15]?.pressed; // D-pad right
        // console.log("Consumed button edges on state entry:", this.game.gameState);
    }
    // finish change -- consume current button states on menu/state entry --

    // Determine menu-specific index and items -- Read the UI’s current index → selectedIndex = this.game.ui.…
    let selectedIndex, items, maxIndex;
    if (["mainMenu", "options", "gamepadSetup", "multiplayer", "joinLobby"].includes(this.game.gameState)) {
        if (this.game.gameState === "mainMenu") {
            selectedIndex = this.game.ui.selectedMenuIndex;
            items = this.game.ui.menuItems;
            maxIndex = items.length - 1;
        } else if (this.game.gameState === "options") {
            selectedIndex = this.game.ui.selectedOptionIndex;
            items = this.game.ui.optionsItems;
            maxIndex = items.length - 1;
        } else if (this.game.gameState === "gamepadSetup") {
            selectedIndex = this.game.ui.selectedGamepadIndex;
            items = this.game.ui.gamepadItems;
            maxIndex = items.length - 1;
        } else if (this.game.gameState === "multiplayer") {
             const inLobby = (this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby"); //START ALPHA CHANGE 237
            selectedIndex = this.game.ui.selectedMultiplayerIndex;                                            
            // Use the *same* items the UI draws: in-lobby → ["Start Game","Leave Lobby"], else default list   
            items = inLobby ? ["Start Game", "Leave Lobby"] : this.game.ui.multiplayerItems;                  
            maxIndex = items.length - 1; 
            //START ALPHA CHANGE 238 -- when we *enter* in-lobby overlay, force default to "Start Game" (index 0)
            this._wasInLobbyMenu = this._wasInLobbyMenu || false;
            if (inLobby && !this._wasInLobbyMenu) {
                this.game.ui.selectedMultiplayerIndex = 0; // default highlight = "Start Game"
                selectedIndex = 0;
            }
            this._wasInLobbyMenu = inLobby;
            //FINISH ALPHA CHANGE 238 -- default to Start Game on in-lobby entry                                                                     
            // Clamp & write back so the highlight always points to a visible row                              
            const clamped = Math.max(0, Math.min((selectedIndex ?? 0), maxIndex));                            
            if (clamped !== selectedIndex) {                                                                  
                this.game.ui.selectedMultiplayerIndex = clamped;                                              
                selectedIndex = clamped;                                                                      
            }  //FINISH ALPHA CHANGE 237                         
        } else if (this.game.gameState === "joinLobby") {
          //START ALPHA CHANGE -- reset gamepad nav state on joinLobby entry with empty list--
                //const lobbyCount = this.game.steamMultiplayer.lobbies.length; commented out for the change

                //start change -- Merge real + fake when debug flag is on so inputs see the same list size the UI draws
                const real = Array.isArray(this.game.steamMultiplayer.lobbies) ? this.game.steamMultiplayer.lobbies : [];
                const fake = (this.game.ui && this.game.ui.debugJoinLobby)
                    ? Array.from({ length: this.game.ui.debugJoinLobbyCount || 10 }, (_, k) => ({ id: `FAKE12345678910-${101 + k}` }))
                    : [];
                const sourceLobbies = real.concat(fake);
                const lobbyCount = sourceLobbies.length;
                //finish change 

                // Force focus to buttons and reset nav state if no lobbies
                if (lobbyCount === 0 && this.game.ui.joinLobbyFocus !== 'buttons') {
                    this.game.ui.joinLobbyFocus = 'buttons';
                    this.game.ui.selectedJoinLobbyIndex = Math.min(this.game.ui.selectedJoinLobbyIndex || 0, (this.game.ui.joinLobbyItems?.length || 1) - 1);
                    // Reset all gamepad navigation flags to clear stale state
                    this.lastGamepadNav.up = false;
                    this.lastGamepadNav.down = false;
                    this.lastGamepadButtons[0] = false; // Reset confirm (X)
                    this.lastGamepadButtons[1] = false; // Reset cancel (Circle)
                    console.log("joinLobby: no lobbies -> focus set to buttons (all nav flags reset)");
                }
                const inList = this.game.ui.joinLobbyFocus === 'list';
                if (inList) {
                    selectedIndex = this.game.ui.selectedMultiplayerIndex; // Lobby cursor
                    items = new Array(lobbyCount); // Logical list length
                } else {
                    selectedIndex = this.game.ui.selectedJoinLobbyIndex; // Buttons cursor
                    items = this.game.ui.joinLobbyItems; // ["Refresh", "Back"]
                }
                maxIndex = Math.max(0, (items?.length || 0) - 1);

                //START ALPHA CHANGE 3 -- only run “index fixups” when there is actual GAMEPAD input this frame --
                const anyNav = upPressed || downPressed || confirmPressed || cancelPressed;

                // Reset out-of-bounds on entry
                if (inList) {
                    if (anyNav && (selectedIndex < 0 || selectedIndex >= lobbyCount)) {
                        selectedIndex = 0;
                        this.game.ui.selectedMultiplayerIndex = 0;
                        this.game.steamMultiplayer.selectedLobbyIndex = 0;
                        console.log("joinLobby(list): reset selectedMultiplayerIndex to 0");
                    }
                } else {
                    if (anyNav && (selectedIndex < 0 || selectedIndex >= (this.game.ui.joinLobbyItems?.length || 0))) {
                        selectedIndex = 0;
                        this.game.ui.selectedJoinLobbyIndex = 0;
                        console.log("joinLobby(buttons): reset selectedJoinLobbyIndex to 0");
                    }
                }
                //FINISH ALPHA CHANGE 3 -- only run index fixups when the gamepad actually moved/pressed --
                //uncomment log for debug (spammy log)
                //console.log(`joinLobby focus=${this.game.ui.joinLobbyFocus}, up=${upPressed}, down=${downPressed}, idx=${selectedIndex}, max=${maxIndex}, lobbies=${lobbyCount}`);
                //FINISH ALPHA CHANGE -- reset gamepad nav state on joinLobby entry with empty list--
            }
        
        // Handle up/down navigation -- Modify the UI based on gamepad input → selectedIndex = Math.max/min
        //START ALPHA CHANGE 20 -- use separate analog and D-pad constants for non-joinLobby menus --
        // Let BOTH sources move the cursor independently for non-joinLobby menus.
        if (this.game.gameState !== "joinLobby") {
            //START ALPHA CHANGE 545 -- gamepad: wrap selection only for mainMenu/options/gamepadSetup (keep others clamped) --
            const wrapMenus = (this.game.gameState === "mainMenu" || this.game.gameState === "options" || this.game.gameState === "gamepadSetup");
            const wrapLen = (typeof maxIndex === "number") ? (maxIndex + 1) : 0;
            //FINISH ALPHA CHANGE 545 -- gamepad: wrap selection only for mainMenu/options/gamepadSetup (keep others clamped) --
            // Analog edges
            if (analogUpEdge) {
                //START ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                if (wrapMenus && wrapLen > 0) selectedIndex = (selectedIndex - 1 + wrapLen) % wrapLen;
                else selectedIndex = Math.max(0, selectedIndex - 1);
                //FINISH ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                console.log(`${this.game.gameState}: Navigated up (analog) to index`, selectedIndex);
            }
            if (analogDownEdge) {
                //START ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                if (wrapMenus && wrapLen > 0) selectedIndex = (selectedIndex + 1) % wrapLen;
                else selectedIndex = Math.min(maxIndex, selectedIndex + 1);
                //FINISH ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                console.log(`${this.game.gameState}: Navigated down (analog) to index`, selectedIndex);
            }
            // D-pad edges
            if (dpadUpEdge) {
                //START ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                if (wrapMenus && wrapLen > 0) selectedIndex = (selectedIndex - 1 + wrapLen) % wrapLen;
                else selectedIndex = Math.max(0, selectedIndex - 1);
                //FINISH ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                console.log(`${this.game.gameState}: Navigated up (D-pad) to index`, selectedIndex);
            }
            if (dpadDownEdge) {
                //START ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                if (wrapMenus && wrapLen > 0) selectedIndex = (selectedIndex + 1) % wrapLen;
                else selectedIndex = Math.min(maxIndex, selectedIndex + 1);
                //FINISH ALPHA CHANGE 546 -- apply wrapMenus/wrapLen instead of always clamping --
                console.log(`${this.game.gameState}: Navigated down (D-pad) to index`, selectedIndex);
            }

            // Maintain per-source “held” state so edges work correctly next frame
            this.lastAnalogNav.up   = analogUpPressed;
            this.lastAnalogNav.down = analogDownPressed;
            this.lastDpadNav.up     = upPressed;
            this.lastDpadNav.down   = downPressed;

            // (Optional) keep legacy aggregate flags in sync for any other code:
            this.lastGamepadNav.up   = upPressed   || analogUpPressed;
            this.lastGamepadNav.down = downPressed || analogDownPressed;
        }
        //FINISH ALPHA CHANGE 20 --

        //START ALPHA CHANGE 293 -- Options: Left/Right cycles Difficulty (Timer) and saves immediately --
        if (this.game.gameState === "options" && selectedIndex != null) {
            const item = items[selectedIndex];
            if (item && item.action === "Timer") { // internal key retained; UI shows "Difficulty"
                // Read left/right: D-pad (14/15) + left stick X (axis 0)
                const axisX = (gamepad.axes && gamepad.axes.length > 0) ? gamepad.axes[0] : 0;
                const analogLeftPressed  = axisX < -deadZone;
                const analogRightPressed = axisX >  deadZone;

                // Edge detection (same pattern as Multiplayer Region)
                const analogLeftEdge  = !!analogLeftPressed  && !this.lastAnalogNav.left;
                const analogRightEdge = !!analogRightPressed && !this.lastAnalogNav.right;
                const dpadLeftNow  = !!(gamepad.buttons[14] && gamepad.buttons[14].pressed);
                const dpadRightNow = !!(gamepad.buttons[15] && gamepad.buttons[15].pressed);
                const dpadLeftEdge  = dpadLeftNow  && !this.lastGamepadButtons[14];
                const dpadRightEdge = dpadRightNow && !this.lastGamepadButtons[15];

                // Cycle buckets: Hard(new setting) ↔ Easy(180s) ↔ Normal(90s) 
                //START ALPHA CHANGE 433 -- Labels cycle:  Normal(90s) ↔ Hard(flag) ↔ Easy(180s); remove HARD=60000 usage --
                const NORMAL =  90000; //1:30
                const EASY   = 120000; //2:00

                const currentLabel = this.game.hardMode ? "Hard"
                    : ((this.game.timeLimit|0) >= EASY ? "Easy" : "Normal");
                const order = ["Normal","Hard","Easy"]; //ALPHA CHANGE 529 -- changed cycling order letf/right gamepad 

                // decide direction by edge
                const dir =
                    (analogLeftEdge || dpadLeftEdge)   ? -1 :
                    (analogRightEdge || dpadRightEdge) ? +1 : 0;

                if (dir !== 0) {
                    const nextLabel = order[(order.indexOf(currentLabel) + dir + order.length) % order.length];

                    if (nextLabel === "Hard") {
                        this.game.hardMode = true;
                        this.game.timeLimit = NORMAL; // Hard keeps Normal timer
                    } else if (nextLabel === "Normal") {
                        this.game.hardMode = false;
                        this.game.timeLimit = NORMAL;
                    } else { // "Easy"
                        this.game.hardMode = false;
                        this.game.timeLimit = EASY;
                    }
                    this.game.saveHardModeSetting(); // persist immediately in localStorage
                    this.game.saveTimeLimitSetting(); // persist immediately in localStorage

            console.log("Difficulty cycled", dir < 0 ? "LEFT" : "RIGHT", "via gamepad →", nextLabel);
        }
        //FINISH ALPHA CHANGE 433 -- Labels cycle --

                // Update held states for next-frame edge detection
                this.lastAnalogNav.left  = !!analogLeftPressed;
                this.lastAnalogNav.right = !!analogRightPressed;
                this.lastGamepadButtons[14] = dpadLeftNow;
                this.lastGamepadButtons[15] = dpadRightNow;
            }
        }
        //FINISH ALPHA CHANGE 293 -- Options: Left/Right cycles Difficulty (Timer) and saves immediately --

        //START ALPHA CHANGE 218 -- Multiplayer: Left/Right cycles Region when selected (pre-lobby only) --
        if (this.game.gameState === "multiplayer") {
            const inLobby = (this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby");
            if (!inLobby && selectedIndex === 0) { // "Region" row
                // Read left/right inputs: D-pad (buttons 14/15) + left stick X (axis 0)
                const axisX = (gamepad.axes && gamepad.axes.length > 0) ? gamepad.axes[0] : 0;
                const analogLeftPressed  = axisX < -deadZone;
                const analogRightPressed = axisX >  deadZone;

                // Edge detection for analog left/right (extend lastAnalogNav with .left/.right)
                const analogLeftEdge  =  !!analogLeftPressed  && !this.lastAnalogNav.left;
                const analogRightEdge =  !!analogRightPressed && !this.lastAnalogNav.right;

                // D-pad left/right edges using lastGamepadButtons[14]/[15]
                const dpadLeftNow  = !!(gamepad.buttons[14] && gamepad.buttons[14].pressed);
                const dpadRightNow = !!(gamepad.buttons[15] && gamepad.buttons[15].pressed);
                const dpadLeftEdge  = dpadLeftNow  && !this.lastGamepadButtons[14];
                const dpadRightEdge = dpadRightNow && !this.lastGamepadButtons[15];

                // Apply changes when any left/right edge fires
                if (analogLeftEdge || dpadLeftEdge || analogRightEdge || dpadRightEdge) {
                    const regions = (this.game.ui && Array.isArray(this.game.ui._lobbyRegions) && this.game.ui._lobbyRegions.length)
                        ? this.game.ui._lobbyRegions
                        : [{ code: "US", label: "United States" }];
                    const len = regions.length;
                    let idx = (typeof this.game.ui._lobbyRegionIndex === "number") ? this.game.ui._lobbyRegionIndex : 0;

                    if (analogLeftEdge || dpadLeftEdge)  idx = (idx - 1 + len) % len;
                    if (analogRightEdge || dpadRightEdge) idx = (idx + 1) % len;

                    this.game.ui._lobbyRegionIndex = idx;
                    console.log("multiplayer: Region cycled to", regions[idx] && regions[idx].code);
                }

                // Update edge trackers
                this.lastAnalogNav.left  = !!analogLeftPressed;
                this.lastAnalogNav.right = !!analogRightPressed;
                this.lastGamepadButtons[14] = dpadLeftNow;
                this.lastGamepadButtons[15] = dpadRightNow;
            }
        }
        //FINISH ALPHA CHANGE 218 -- Multiplayer: Left/Right cycles Region when selected (pre-lobby only) --

        //START ALPHA CHANGE 224 -- Multiplayer Custom: flash last letter; L/R overwrite it; X advances; Circle backspaces (never empty) --
        if (this.game.gameState === "multiplayer") {
            const inLobby = (this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby");
            if (!inLobby && selectedIndex === 1) { // "Custom" row
                // Ensure state exists
                if (typeof this.game.ui._lobbyCustomTag !== "string") this.game.ui._lobbyCustomTag = "COOP";
                const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
                const lenChars = chars.length;

                // Cursor = index of letter that flashes (start on last; if empty, we will keep one 'A')
                if (typeof this.game.ui._customCursorPos !== "number") {
                    const len = this.game.ui._lobbyCustomTag.length;
                    this.game.ui._customCursorPos = Math.max(0, len > 0 ? len - 1 : 0);
                }
                // Palette index: current char at cursor, or 'A'
                if (typeof this.game.ui._customCharIndex !== "number") {
                    const cur = String(this.game.ui._lobbyCustomTag).toUpperCase();
                    const at  = cur[this.game.ui._customCursorPos] || "A";
                    const pos = Math.max(0, chars.indexOf(at));
                    this.game.ui._customCharIndex = (pos >= 0 ? pos : 0);
                }

                // Inputs
                const axisX = (gamepad.axes && gamepad.axes.length > 0) ? gamepad.axes[0] : 0;
                const analogLeftPressed  = axisX < -deadZone;
                const analogRightPressed = axisX >  deadZone;
                const analogLeftEdge  =  !!analogLeftPressed  && !this.lastAnalogNav.left;
                const analogRightEdge =  !!analogRightPressed && !this.lastAnalogNav.right;

                const dpadLeftNow  = !!(gamepad.buttons[14] && gamepad.buttons[14].pressed);
                const dpadRightNow = !!(gamepad.buttons[15] && gamepad.buttons[15].pressed);
                const dpadLeftEdge  = dpadLeftNow  && !this.lastGamepadButtons[14];
                const dpadRightEdge = dpadRightNow && !this.lastGamepadButtons[15];

                const confirmNow = !!(gamepad.buttons[0] && gamepad.buttons[0].pressed); // X
                const cancelNow  = !!(gamepad.buttons[1] && gamepad.buttons[1].pressed); // Circle
                const confirmEdge = confirmNow && !this.lastGamepadButtons[0];
                const cancelEdge  = cancelNow  && !this.lastGamepadButtons[1];

                const curStr0 = String(this.game.ui._lobbyCustomTag).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 6);
                let curStr = curStr0;
                let cursor = this.game.ui._customCursorPos;
                let idx    = this.game.ui._customCharIndex;

                // L/R cycles the current flashing letter (overwrite only on change)
                //START ALPHA CHANGE 233
                const prevIdx = idx; // remember previous candidate to detect actual change
                //FINISH ALPHA CHANGE 233
                if (analogLeftEdge || dpadLeftEdge) {
                    idx = (idx - 1 + lenChars) % lenChars;
                }
                if (analogRightEdge || dpadRightEdge) {
                    idx = (idx + 1) % lenChars;
                }
                // Apply overwrite only if L/R changed the candidate this frame
                //START ALPHA CHANGE 233
                if ((analogLeftEdge || dpadLeftEdge || analogRightEdge || dpadRightEdge) && idx !== prevIdx) {
                    const ch = chars[idx];
                    if (curStr.length === 0) {
                        // never show empty while selected: start as current candidate at cursor 0
                        curStr = ch;
                        cursor = 0;
                    } else {
                        // overwrite at cursor
                        curStr = curStr.slice(0, cursor) + ch + curStr.slice(cursor + 1);
                    }
                }
                //FINISH ALPHA CHANGE 233
                // X confirms current letter and advances the cursor.
                if (confirmEdge) {
                    if (cursor < 5) {
                        if (cursor === curStr.length - 1) {
                            // extend to next slot with an 'A' flashing
                            const next = curStr + "A";
                            curStr = next.slice(0, 6);
                            cursor = Math.min(curStr.length - 1, cursor + 1);
                            idx = chars.indexOf("A");
                            if (idx < 0) idx = 0;
                        } else {
                            // move to next existing slot
                            cursor = Math.min(curStr.length - 1, cursor + 1);
                            const chNext = curStr[cursor] || "A";
                            const pos = Math.max(0, chars.indexOf(chNext));
                            idx = (pos >= 0 ? pos : 0);
                        }
                    }
                }

                // Circle backspace: delete last char (like original flow)
                if (cancelEdge) {
                    if (curStr.length > 1) {
                        // remove the last char and move cursor to new last
                        curStr = curStr.slice(0, -1);
                        cursor = curStr.length - 1;
                        const ch = curStr[cursor] || "A";
                        const pos = Math.max(0, chars.indexOf(ch));
                        idx = (pos >= 0 ? pos : 0);
                    } else {
                        // at length 1 → keep single flashing 'A'
                        curStr = "A";
                        cursor = 0;
                        idx = chars.indexOf("A");
                        if (idx < 0) idx = 0;
                    }
                }

                // Commit back
                this.game.ui._lobbyCustomTag = curStr;
                this.game.ui._customCursorPos = cursor;
                this.game.ui._customCharIndex = idx;

                // Update edge trackers
                this.lastAnalogNav.left  = !!analogLeftPressed;
                this.lastAnalogNav.right = !!analogRightPressed;
                this.lastGamepadButtons[14] = dpadLeftNow;
                this.lastGamepadButtons[15] = dpadRightNow;
                this.lastGamepadButtons[0]  = confirmNow;
                this.lastGamepadButtons[1]  = cancelNow;

                // Keep selection on "Custom" row while adjusting letters.
            }
        }
        //FINISH ALPHA CHANGE 224 -- Multiplayer Custom overwrite-at-cursor, advance on X, backspace with non-empty guarantee --
        
        // Update state-specific index -- Write back into the UI state → this.game.ui.… = selectedIndex
        if (this.game.gameState === "mainMenu") {
            this.game.ui.selectedMenuIndex = selectedIndex;
        } else if (this.game.gameState === "options") {
            this.game.ui.selectedOptionIndex = selectedIndex;
        } else if (this.game.gameState === "gamepadSetup") {
            this.game.ui.selectedGamepadIndex = selectedIndex;
        } else if (this.game.gameState === "multiplayer") {
            this.game.ui.selectedMultiplayerIndex = selectedIndex;
       } else if (this.game.gameState === "joinLobby") {

    //START ALPHA CHANGE 12 -- analog=list, D-pad=buttons (exclusive)--

    // Effective lobby rows exactly like UI.draw:
    const _realCount = Array.isArray(this.game.steamMultiplayer.lobbies) ? this.game.steamMultiplayer.lobbies.length : 0;
    const _fakeCount = (_realCount === 0 && this.game.ui && this.game.ui.debugJoinLobby)
        ? (this.game.ui.debugJoinLobbyCount || 10)
        : 0;
    const _effectiveCount = _realCount > 0 ? _realCount : _fakeCount;

    // Focus switch: analog moves → list, dpad moves → buttons
    if (this.game.ui.joinLobbyFocus !== 'list' && (analogUpEdge || analogDownEdge)) {
        if (_effectiveCount > 0) {
            this.game.ui.joinLobbyFocus = 'list';
            this.game.ui.selectedMultiplayerIndex = Math.max(0, this.game.ui.selectedMultiplayerIndex || 0);
            // clamp Steam index to real region
            this.game.steamMultiplayer.selectedLobbyIndex =
                this.game.ui.selectedMultiplayerIndex < _realCount ? this.game.ui.selectedMultiplayerIndex : 0;

            // consume analog edges; clear d-pad edges to avoid bounce
            this.lastAnalogNav.up = analogUpPressed;
            this.lastAnalogNav.down = analogDownPressed;
            this.lastDpadNav.up = false;
            this.lastDpadNav.down = false;
            // console.log("joinLobby: analog → focus=list");
            //START ALPHA CHANGE 15 — reset analog repeat timers on focus enter (list)
                this._listAnalogDir = 0;
                this._listAnalogStartedAt = 0;
                this._listAnalogLastFireAt = 0;
            //FINISH ALPHA CHANGE 15
        }
    } else if (this.game.ui.joinLobbyFocus === 'list' && (dpadUpEdge || dpadDownEdge)) {
        this.game.ui.joinLobbyFocus = 'buttons';
        this.game.ui.selectedJoinLobbyIndex = Math.max(0, this.game.ui.selectedJoinLobbyIndex || 0);

        // consume d-pad edges; clear analog edges to avoid bounce
        this.lastDpadNav.up = upPressed;
        this.lastDpadNav.down = downPressed;
        this.lastAnalogNav.up = false;
        this.lastAnalogNav.down = false;
        // console.log("joinLobby: d-pad → focus=buttons");
        //START ALPHA CHANGE 15 — reset analog repeat timers on focus leave (list)
            this._listAnalogDir = 0;
            this._listAnalogStartedAt = 0;
            this._listAnalogLastFireAt = 0;
        //FINISH ALPHA CHANGE 15
    }

    // Move within the focused region:
    if (this.game.ui.joinLobbyFocus === 'list') {
        if (_effectiveCount === 0) {
            // park on buttons if no rows
            this.game.ui.joinLobbyFocus = 'buttons';
            this.game.ui.selectedJoinLobbyIndex = Math.max(0, this.game.ui.selectedJoinLobbyIndex || 0);
            this.lastAnalogNav.up = false;
            this.lastAnalogNav.down = false;
            //START ALPHA CHANGE 15 — also clear repeat timers when list becomes empty
                this._listAnalogDir = 0;
                this._listAnalogStartedAt = 0;
                this._listAnalogLastFireAt = 0;
            //FINISH ALPHA CHANGE 15
        } else {
                //START ALPHA CHANGE 15 — analog hold-to-repeat for list navigation
                const now = performance.now();
                // -1 = up, +1 = down, 0 = idle
                const dir = analogUpPressed ? -1 : (analogDownPressed ? +1 : 0);

                // reset or arm timers if direction changed
                if (dir !== this._listAnalogDir) {
                    this._listAnalogDir = dir;
                    this._listAnalogStartedAt  = dir ? now : 0;
                    this._listAnalogLastFireAt = 0;
                }

                // start from current, clamp to range
                let li = Math.max(0, Math.min(this.game.ui.selectedMultiplayerIndex || 0, _effectiveCount - 1));

                // immediate single step on edges
                if (analogUpEdge && dir === -1)   li = Math.max(0, li - 1);
                if (analogDownEdge && dir === +1) li = Math.min(_effectiveCount - 1, li + 1);

                // continuous steps while held past the delay
                if (dir !== 0) {
                    const heldFor   = now - this._listAnalogStartedAt;
                    const sinceFire = now - (this._listAnalogLastFireAt || 0);
                    if (heldFor >= this.listAnalogDelayMs && sinceFire >= this.listAnalogRateMs) {
                        li = Math.max(0, Math.min(_effectiveCount - 1, li + dir));
                        this._listAnalogLastFireAt = now;
                    }
                }

                this.game.ui.selectedMultiplayerIndex = li;
                // keep Steam selection valid (0..real-1), fake rows don’t map to Steam
                this.game.steamMultiplayer.selectedLobbyIndex = (li < _realCount) ? li : 0;
                //FINISH ALPHA CHANGE 15
            }
    } else {
        // buttons focus (Refresh/Back) button logic 
        const btnCount = (this.game.ui.joinLobbyItems?.length || 1);
        let bi = Math.max(0, Math.min(this.game.ui.selectedJoinLobbyIndex || 0, btnCount - 1));
        if (dpadUpEdge)   bi = Math.max(0, bi - 1);
        if (dpadDownEdge) bi = Math.min(btnCount - 1, bi + 1);
        this.game.ui.selectedJoinLobbyIndex = bi;
    }

  //FINISH ALPHA CHANGE 12 --
  }
}
//start change -- filter Link items and set button indices for innbcUniverse --
    else if (this.game.gameState === "innbcUniverse") {
    selectedIndex = this.game.ui.selectedInnbcUniverseIndex; //which UI row/button is currently highlighted
    items = this.game.ui.innbcUniverseItemBounds; //the array that represents what’s selectable for the current gameState
    maxIndex = items.length - 1; //the last valid index for clamping / bounds checks  
} 
//finish change--

//start change -- match keyboard navigation for innbcUniverse buttons for gamepad --
if (this.game.gameState === "innbcUniverse") {
    const axisValueX = gamepad.axes[0]; // axis_0: negative = left, positive = right
    const leftPressed = axisValueX < -deadZone || safeMenuBtnPressed715(14); // D-pad left -- ALPHA CHANGE 715 -- safe gamepad button reads
    const rightPressed = axisValueX > deadZone || safeMenuBtnPressed715(15); // D-pad right -- ALPHA CHANGE 715 -- safe gamepad button reads
    const totalBounds = this.game.ui.innbcUniverseItemBounds.length;
    const buttonStart = totalBounds - 2; // First button index
    if (leftPressed && !this.lastGamepadNav.left && !this.game.ui.awaitingGamepadInput) {
        this.game.ui.selectedInnbcUniverseIndex = buttonStart; // Select left button
        this.lastGamepadNav.left = true;
        console.log(`Menu (${this.game.gameState}): Navigated left to index`, this.game.ui.selectedInnbcUniverseIndex);
    } else if (!leftPressed) {
        this.lastGamepadNav.left = false;
    }
    if (rightPressed && !this.lastGamepadNav.right && !this.game.ui.awaitingGamepadInput) {
        this.game.ui.selectedInnbcUniverseIndex = totalBounds - 1; // Select right button
        this.lastGamepadNav.right = true;
        console.log(`Menu (${this.game.gameState}): Navigated right to index`, this.game.ui.selectedInnbcUniverseIndex);
    } else if (!rightPressed) {
        this.lastGamepadNav.right = false;
    }
    //finish change
    
} // closes innbcUniverse block
//finish change--

    // Modified: Skip confirm/cancel if just bound an input
    if (this.justBoundGamepadInput) {
        this.lastGamepadButtons[0] = confirmPressed;
        this.lastGamepadButtons[1] = cancelPressed;
        this.justBoundGamepadInput = false; // Reset immediately
        this.game.ui.wasAwaitingGamepadInput = this.game.ui.awaitingGamepadInput;
        return;
    }

    // Handle confirm (Enter equivalent)
    //start change -- add Triangle (button_3) to cancel gamepad binding and fix X/Circle conflicts//
    if (confirmPressed && !this.lastGamepadButtons[0] && !this.game.ui.awaitingGamepadInput && !this.game.ui.wasAwaitingGamepadInput) {
        // start change -- add bounds check before accessing items[selectedIndex] --
    if (selectedIndex < 0 || selectedIndex >= items.length) {
        selectedIndex = Math.max(0, Math.min(maxIndex, selectedIndex));
        this.game.ui.selectedMultiplayerIndex = selectedIndex;
        this.game.steamMultiplayer.selectedLobbyIndex = selectedIndex < this.game.steamMultiplayer.lobbies.length ? selectedIndex : 0;
        console.log(`joinLobby: Adjusted selectedIndex to ${selectedIndex} to stay within bounds (maxIndex: ${maxIndex})`);
    }
    // finish change -- add bounds check before accessing items[selectedIndex] --
        //START GAMMA CHANGE 14
        let selectedOption;
        if (this.game.gameState === "joinLobby") {
            // In joinLobby, items may be a holey Array(lobbyCount); don't read .text on undefined
            if (this.game.ui.joinLobbyFocus === 'buttons') {
                const btns = this.game.ui.joinLobbyItems || [];
                selectedOption = btns[selectedIndex];
            } else {
                selectedOption = "LobbyRow"; // list row; handled in the joinLobby branch below
            }
        } else {
            const it = items && items[selectedIndex];
            selectedOption = (it && (it.text || it.action)) || it;
        }
        //FINISH GAMMA CHANGE 14    
        console.log(`Menu (${this.game.gameState}): Confirmed option`, selectedOption);
        // Call menu-specific selection handler
        if (this.game.gameState === "mainMenu") {
            const item = this.game.ui.menuItems[selectedIndex];
            if (item === "New Game") {
                this.lastShotTime = performance.now(); // Reset lastShotTime to block initial fire shot by residual input
                this.game.startGame();
            } else if (item === "Options") {
                this.game.gameState = "options";
                this.game.ui.selectedOptionIndex = 0;
                this.game.sound.pauseSoundtrack();
            } else if (item === "Multiplayer") {
                this.game.gameState = "multiplayer";
                this.game.ui.selectedMultiplayerIndex = 0;
                //START ALPHA CHANGE 227 -- reset Multiplayer naming defaults on entry --
                this.game.ui._lobbyRegionIndex = 0;        // default region = US
                this.game.ui._lobbyCustomTag   = "COOP";   // default custom = COOP
                this.game.ui._editingLobbyCustom = false;  // not actively editing on entry
                this.game.ui._customCharIndex = 0;         // safe baseline; draw logic handles last-letter blink
                //FINISH ALPHA CHANGE 227 -- reset Multiplayer naming defaults on entry --
                this.game.sound.pauseSoundtrack();
            } else if (item === "INNBC Universe") {
                this.game.gameState = "innbcUniverse";
                this.game.ui.selectedInnbcUniverseIndex = 0;
                this.game.sound.pauseSoundtrack();
            //start change -- add Full Screen to main menu//
            } else if (item === "Full Screen") {
                this.game.toggleFullScreen();
                console.log("Gamepad confirmed Full Screen, toggled to:", this.game.fullScreen ? "On" : "Off");
            //finish change//
            }  else if (item === "Quit Game") {
                 if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('quit-game');
                console.log("Gamepad confirmed Quit Game, sent quit-game IPC to main process");
            } else {
                console.warn("Electron not available, quit-game skipped");
            }
           }

        //start change -- add handling for Reset All Settings in gamepad input for options menu//
        } else if (this.game.gameState === "options") {
            const item = this.game.ui.optionsItems[selectedIndex];
            if (item.action === "Back") {
                this.game.gameState = "mainMenu";
                this.game.ui.selectedMenuIndex = 0;
                this.game.keyConflict = false;
            } else if (item.action === "FPS Counter") {
                this.game.showFPS = !this.game.showFPS;
                this.game.saveFPSSetting();
            } else if (item.action === "Full Screen") {
                this.game.toggleFullScreen();
            } else if (item.action === "Gamepad Setup") {
                this.game.gameState = "gamepadSetup";
                this.game.ui.selectedGamepadIndex = 0;
                this.game.ui.awaitingGamepadInput = false;
            } else if (item.action === "Reset All Settings") {
                this.game.resetAllSettings();
                console.log("Reset All Settings triggered via gamepad");
            //START ALPHA CHANGE 200 -- handle Reset Score via keyboard in options --
            } else if (item.action === "Reset Score") {
                this.game.leaderboard.resetScores();
                console.log("Reset Score triggered via gamepad");
            //FINISH ALPHA CHANGE 200 -- handle Reset Score via keyboard in options --
            //START ALPHA CHANGE 294 -- Options: X (confirm) cycles Difficulty and saves, no rebind prompt --
            } else if (item.action === "Timer") {
                //START ALPHA CHANGE 432 -- Gamepad X: cycle by labels (Hard flag vs Normal/Easy timers) --
                const NORMAL =  90000; // 1:30
                const EASY   = 120000; // 2:00

                const currentLabel = this.game.hardMode ? "Hard"
                    : ((this.game.timeLimit|0) >= EASY ? "Easy" : "Normal");
                const order = ["Normal","Hard","Easy"]; //ALPHA CHANGE 529 -- changed cycling order -- gamepad X button 
                const nextLabel = order[(order.indexOf(currentLabel) + 1) % order.length];

                if (nextLabel === "Hard") {
                    this.game.hardMode = true;
                    this.game.timeLimit = NORMAL;     // keep Normal timer in Hard
                } else if (nextLabel === "Normal") {
                    this.game.hardMode = false;
                    this.game.timeLimit = NORMAL;
                } else { // "Easy"
                    this.game.hardMode = false;
                    this.game.timeLimit = EASY;
                }
                this.game.saveHardModeSetting();  //persist immediately in localStorage
                this.game.saveTimeLimitSetting(); //persist immediately in localStorage
                //FINISH ALPHA CHANGE 432 -- Gamepad X label cycle --
                this.game.ui.awaitingKeyInput = false; // never open key-binding prompt
                this.game.keyConflict = false;
                console.log("Gamepad confirmed Difficulty ->", nextLabel);
            //FINISH ALPHA CHANGE 294 -- Options: X (confirm) cycles Difficulty and saves --
            } else {
                this.game.ui.awaitingKeyInput = true;
                this.game.keyConflict = false;
            }
        } else if (this.game.gameState === "gamepadSetup") {
            const item = this.game.ui.gamepadItems[selectedIndex];
            if (item.action === "Back") {
                this.game.gameState = "options";
                this.game.ui.selectedOptionIndex = 0;
                this.game.ui.awaitingGamepadInput = false;
            } else {
                this.game.ui.awaitingGamepadInput = true;
                this.game.gamepadConflict = false;
            }
            //start change -- Updated the multiplayer block to handle confirm actions for X button 
        } else if (this.game.gameState === "multiplayer") {
                const item = this.game.ui.multiplayerItemBounds[selectedIndex];
                if (this.game.steamMultiplayer.lobbyState === "inLobby") {
                    if (item.text === "Start Game" && this.game.steamMultiplayer.isHost) {
                        this.game.steamMultiplayer.startMultiplayerGame();
                        console.log("Gamepad confirmed Start Game in Multiplayer");
                    } else if (item.text === "Leave Lobby") {
                        this.game.steamMultiplayer.leaveLobby();
                        console.log("Gamepad confirmed Leave Lobby in Multiplayer");
                    }
                } else {
                    if (item.text === "Create Lobby") {
                        this.game.steamMultiplayer.createLobby();
                        console.log("Gamepad confirmed Create Lobby in Multiplayer");
                    } else if (item.text === "Join Lobby") {
                        this.game.gameState = "joinLobby";
                        // start change -- enter joinLobby focused on buttons, no preselected list (gamepad) --
                        this.game.ui.joinLobbyFocus = 'buttons';
                        this.game.ui.selectedJoinLobbyIndex = 1; // "Back"
                        this.game.ui.selectedMultiplayerIndex = -1;
                        // finish change
                        this.game.steamMultiplayer.requestLobbyList();
                        console.log("Gamepad confirmed Join Lobby, transitioned to joinLobby menu");
                    } else if (item.text === "Back") {
                        this.game.gameState = "mainMenu";
                        this.game.ui.selectedMenuIndex = 0;
                        console.log("Gamepad confirmed Back in Multiplayer, returned to main menu");
                    }
                }
            } else if (this.game.gameState === "joinLobby") { //this is the confirm block for joinLobby 
                //start change -- joinLobby confirm uses focus-based selection--
                if (this.game.ui.joinLobbyFocus === 'list') {
                    const idx = this.game.ui.selectedMultiplayerIndex;

                    // start change -- Merge real + fake so selection matches what UI shows --
                const real = Array.isArray(this.game.steamMultiplayer.lobbies)
                    ? this.game.steamMultiplayer.lobbies
                    : [];
                const fake = (this.game.ui && this.game.ui.debugJoinLobby)
                    ? Array.from({ length: this.game.ui.debugJoinLobbyCount || 10 }, (_, k) => ({
                        id: `FAKE12345678910-${101 + k}`
                    }))
                    : [];
                const sourceLobbies = real.concat(fake);
                const lobby = sourceLobbies[idx];
                // finish change

                if (lobby && String(lobby.id).startsWith("FAKE")) {
                    console.log("Debug lobby selected (no join performed):", lobby.id); //start change
                } else if (lobby) {

                        this.game.steamMultiplayer.joinLobby(lobby.id);
                        console.log("Gamepad confirmed Join Lobby (list):", lobby.id);
                    } else {
                        console.log("Gamepad confirm ignored: no lobby at index", idx);
                    }
                } else {
                    const btn = this.game.ui.joinLobbyItems[this.game.ui.selectedJoinLobbyIndex];
                    if (btn === "Refresh") {
                        this.game.steamMultiplayer._lastLobbyRefreshManual = true; //START ALPHA CHANGE 101
                        this.game.steamMultiplayer._lastLobbyRefreshAt = performance.now(); 
                        this.game.steamMultiplayer.requestLobbyList(); 
                        console.log("Gamepad confirmed Refresh in joinLobby (manual)"); //FINISH ALPHA CHANGE 101
                    } else if (btn === "Back") {
                        this.game.gameState = "multiplayer";
                        this.game.ui.selectedMultiplayerIndex = 0;
                        this.game.steamMultiplayer.selectedLobbyIndex = 0;
                        this.game.ui.joinLobbyFocus = 'list'; // Reset focus for re-entry
                        this.game.ui.selectedJoinLobbyIndex = 0; // Reset button presses for next entry
                        console.log("Gamepad confirmed Back in joinLobby, returned to multiplayer");
                    }
                    //START ALPHA CHANGE 93 -- gamepad: route new “Leave Lobby” to unified teardown
                    else if (btn === "Leave Lobby") {
                        this.game.returnToMainMenu();
                        console.log("Gamepad confirmed Leave Lobby (joinLobby overlay) -> returnToMainMenu()");
                    }
                    //FINISH ALPHA CHANGE 93
                }
                //finish change -- joinLobby confirm uses focus-based selection--
        } else if (this.game.gameState === "innbcUniverse") {
            const item = this.game.ui.innbcUniverseItemBounds[selectedIndex];
            if (item.action === "MenuBack") {
                this.game.gameState = "mainMenu";
                this.game.ui.selectedMenuIndex = 0;
                this.game.innbcUniverse.currentUniversePage = 0;
            } else if (item.action === "Next") {
                this.game.innbcUniverse.currentUniversePage = Math.min(this.game.innbcUniverse.currentUniversePage + 1, this.game.innbcUniverse.innbcUniversePages.length - 1);
                this.game.ui.selectedInnbcUniverseIndex = 0;
            } else if (item.action === "Back") {
                this.game.innbcUniverse.currentUniversePage = Math.max(this.game.innbcUniverse.currentUniversePage - 1, 0);
                this.game.ui.selectedInnbcUniverseIndex = 0;
            } 
        }
        this.lastGamepadButtons[0] = true;
    } else if (!confirmPressed) {
        this.lastGamepadButtons[0] = false;
    }

    

    // Handle cancel (Escape equivalent) for options, gamepadSetup, multiplayer, and innbcUniverse
    if (cancelPressed && !this.lastGamepadButtons[1] && !this.game.ui.awaitingGamepadInput && !this.game.ui.wasAwaitingGamepadInput && ["options", "gamepadSetup", "multiplayer", "innbcUniverse", "joinLobby"].includes(this.game.gameState)) {
        //START ALPHA CHANGE 241
        // In-lobby overlays (host or client): Circle should behave like "Leave Lobby"
        const inLobby = !!(this.game.steamMultiplayer && this.game.steamMultiplayer.lobbyState === "inLobby");
        if ((this.game.gameState === "multiplayer" && inLobby) || (this.game.gameState === "joinLobby" && inLobby)) {
            this.game.returnToMainMenu();
            console.log("Cancel: Leave Lobby from overlay (Circle) -> returnToMainMenu()");
            } else {
                // Legacy back path for all other menus (unchanged)  //FINISH ALPHA CHANGE 241
        //START ALPHA CHANGE 727 -- gamepad: cancel back from joinLobby (non-overlay) resets joinLobby UI --
        const wasJoinLobby = (this.game.gameState === "joinLobby");
        this.game.gameState = wasJoinLobby ? "multiplayer" : "mainMenu";
        //FINISH ALPHA CHANGE 727 -- gamepad: cancel back from joinLobby (non-overlay) resets joinLobby UI --
            this.game.ui.selectedMenuIndex = 0;
            this.game.ui.awaitingGamepadInput = false;
            this.game.gamepadConflict = false;
            this.game.innbcUniverse.currentUniversePage = 0;
            if (wasJoinLobby) {
                this.game.ui.selectedMultiplayerIndex = 0;
                this.game.steamMultiplayer.selectedLobbyIndex = 0;
                this.game.ui.joinLobbyFocus = 'list'; // Reset focus to list on cancel (defaulting to 'list' for consistency when entering joinLobby)
                this.game.ui.selectedJoinLobbyIndex = 0; // Reset for next entry
            }
            console.log("Menu: Canceled back to", this.game.gameState);
        } 
        this.lastGamepadButtons[1] = true;
    } else if (!cancelPressed) {
        this.lastGamepadButtons[1] = false;
    }
    //START ALPHA CHANGE 12 -- sync edge memories for split inputs—
    this.lastAnalogNav.up   = analogUpPressed;
    this.lastAnalogNav.down = analogDownPressed;
    this.lastDpadNav.up     = upPressed;     // D-pad up
    this.lastDpadNav.down   = downPressed;   // D-pad down
    //FINISH ALPHA CHANGE 12 —
    // Update wasAwaitingGamepadInput for next frame
    this.game.ui.wasAwaitingGamepadInput = this.game.ui.awaitingGamepadInput;
    this.justBoundGamepadInput = false; // Reset flag at end of frame
    //START ALPHA CHANGE -- track state for next frame--
        this._prevGameState = this.game.gameState;
    //FINISH ALPHA CHANGE -- track state for next frame--
    //finish change//
}
//finish change//
//finish change//
} // End of InputHandler class
    class SoundController {
        constructor() {
            this.powerUpSound = document.getElementById("powerup");
            this.powerUpSound.volume = 0.4; // pick what feels right (e.g. 0.2–1)

            this.powerDownSound = document.getElementById("powerdown");
            this.powerDownSound.volume = 0.3; // pick what feels right (e.g. 0.2–1)

            this.explosionSound = document.getElementById("explosion");
            this.explosionSound.volume = 0.8; // pick what feels right (e.g. 0.2–1)

            this.shotSound = document.getElementById("shot");
            this.shotSound.volume = 0.3; // pick what feels right (e.g. 0.2–1)

            this.hitSound = document.getElementById("hit");
            this.hitSound.volume = 0.6; // pick what feels right (e.g. 0.2–1)

            this.shieldSound = document.getElementById("shieldSound");
            this.shieldSound.volume = 0.8; // pick what feels right (e.g. 0.2–1)

            this.secondaryShot = document.getElementById("secshot");
            this.secondaryShot.volume = 0.2; // pick what feels right (e.g. 0.2–1)

            this.missileSound = document.getElementById("missileSound");//ALPHA CHANGE 737 -- add missile sound effect 
            this.missileSound.volume = 1; // pick what feels right (e.g. 0.2–1)
            
            this.soundtrack = document.getElementById("soundtrack");
            this.soundtrack.loop = true; // Loops continuously
            this.soundtrack.volume = 0.4; // 0.4 Default volume
            //start change -- initialize main menu music--
            this.menuSoundtrack = document.getElementById("menuSoundtrack");
            this.menuSoundtrack.loop = true; // Loops continuously
            this.menuSoundtrack.volume = 0.4; // 0.4 Default volume
            //finish change--
             //START ALPHA CHANGE 549 -- add win voice SFX (Alpha One) --
            this.alphaOneWinSound = document.getElementById("alphaOneWin");
            this.alphaOneWinSound.volume = 1.0; // set win voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 549 -- add win voice SFX (Alpha One) --
            //START ALPHA CHANGE 551 -- add win voice SFX (Alpha Team) --
            this.alphaTeamWinSound = document.getElementById("alphaTeamWin");
            this.alphaTeamWinSound.volume = 1.0; // set win voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 551 -- add win voice SFX (Alpha Team) --
            //START ALPHA CHANGE 556 -- add intro voice SFX (Alpha One) --
            this.introSound = document.getElementById("introMessage");
            this.introSound.volume = 1.0; // set intro voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 556 -- add intro voice SFX (Alpha One) --
            //START ALPHA CHANGE 635 -- add MP intro voice SFX (teamEngaging) --
            this.MPintroSound = document.getElementById("teamEngaging");
            this.MPintroSound.volume = 1.0; // set mp into voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 635 -- add MP intro voice SFX (teamEngaging) --
            //START ALPHA CHANGE 578 -- add lose voice SFX ("cmon") --
            this.cmonSound = document.getElementById("cmon");
            this.cmonSound.volume = 1.0; // set lose voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 578 -- add lose voice SFX ("cmon") --
            //START ALPHA CHANGE 582 -- Universe menu: cache universe voice audio --
            this.universeSound = document.getElementById("universe");
            this.universeSound.volume = 1.0; // set universe voice SFX volume (0.0..1.0) --
            //FINISH ALPHA CHANGE 582 -- Universe menu: cache universe voice audio --
        }
        powerUp() {
            this.powerUpSound.currentTime = 0;
            this.powerUpSound.play();
        }
        powerDown() {
            this.powerDownSound.currentTime = 0;
            this.powerDownSound.play();
        }
        explosion() {
            this.explosionSound.currentTime = 0;
            this.explosionSound.play();
        }
        shot() {
            this.shotSound.currentTime = 0;
            this.shotSound.play();
        }
        hit() {
            this.hitSound.currentTime = 0;
            this.hitSound.play();
        }
        shield() {
            this.shieldSound.currentTime = 0;
            this.shieldSound.play();
        }
        secondShot() {
            this.secondaryShot.currentTime = 0;
            this.secondaryShot.play();
        }
        missile()//ALPHA CHANGE 737 -- add missile sound effect 
        {
            this.missileSound.currentTime = 0;
            this.missileSound.play();   
        }
        //START ALPHA CHANGE 549 -- win voice SFX (Alpha One) --
        alphaOneWin() {
            this.alphaOneWinSound.currentTime = 0;
            this.alphaOneWinSound.play();
        }
        //FINISH ALPHA CHANGE 549 -- win voice SFX (Alpha One) --
        //START ALPHA CHANGE 551 -- win voice SFX (Alpha Team) --
        alphaTeamWin() {
            this.alphaTeamWinSound.currentTime = 0;
            this.alphaTeamWinSound.play();
        }
        //FINISH ALPHA CHANGE 551 -- win voice SFX (Alpha Team) --
        //START ALPHA CHANGE 579 -- lose voice SFX ("cmon") --
        cmon() {
            this.cmonSound.currentTime = 0;
            this.cmonSound.play();
        }
        //FINISH ALPHA CHANGE 579 -- lose voice SFX ("cmon") --
        //START ALPHA CHANGE 556 -- intro voice SFX (Alpha One) --
        intro() {
            this.introSound.currentTime = 0;
            this.introSound.play();
        }
        //FINISH ALPHA CHANGE 556 -- intro voice SFX (Alpha One) --
        //START ALPHA CHANGE 635 -- MP intro voice SFX (teamEngaging) --
        MPintro() {
            this.MPintroSound.currentTime = 0;
            this.MPintroSound.play();
        }
        //FINISH ALPHA CHANGE 635 -- MP intro voice SFX (teamEngaging) --
        //START ALPHA CHANGE 582 -- Universe menu: play/stop universe voice --
        universeVoicePlay() {
            this.universeSound.loop = false;
            this.universeSound.currentTime = 0;
            this.universeSound.play();
        }
        universeVoiceStop() {
            this.universeSound.pause();
            this.universeSound.currentTime = 0;
        }
        //FINISH ALPHA CHANGE 582 -- Universe menu: play/stop universe voice --
        playSoundtrack() {
            this.soundtrack.play();
        }
        pauseSoundtrack() {
            this.soundtrack.pause();
        }
        resetSoundtrack() {
            this.soundtrack.currentTime = 0;
            this.soundtrack.play();
        }
        //start change -- add methods for main menu music--
        playMenuSoundtrack() {
            this.menuSoundtrack.play();
        }
        pauseMenuSoundtrack() {
            this.menuSoundtrack.pause();
        }
        resetMenuSoundtrack() {
            this.menuSoundtrack.currentTime = 0;
            this.menuSoundtrack.play();
        }
        //finish change--
    }
    class Shield {
        constructor(game){
            this.game = game;

            //START ALPHA CHANGE 455 -- Shield: 7×7 Razorfin-style sheet with 360×360 crop + scale --
            this.image = document.getElementById("shield");

            // 7×7 layout: 512 stride per cell (3584 / 7)
            this._srcStride  = 512;

            // Centered crop 360×360 inside each 512×512 cell
            this._srcSizeW   = 360;
            this._srcSizeH   = 360;
            this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2;
            this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2;

            // On-screen size via scale (tweak as desired)
            this.scale  = 1.05;
            this.width  = Math.round(this._srcSizeW * this.scale);
            this.height = Math.round(this._srcSizeH * this.scale);

            //START ALPHA CHANGE 623 -- Shield: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 623 -- Shield: keep ONLY normalized sheetScale --

            // Linear frame index across 7×7 (TOP→BOTTOM)
            this.frameX   = 0;    // 0..48
            this.maxFrame = 48;   // use all 49 frames
            //FINISH ALPHA CHANGE 455 -- Shield: 7×7 Razorfin-style sheet with 360×360 crop + scale --

            // Time-based animation fields (Shield already used this pattern)
            this.fps      = 60;
            this.timer    = 0;
            this.interval = 1000 / this.fps;

            //START ALPHA CHANGE 456 -- Shield: 2s burst-only activation window on hit --
            this.active         = false;   // shield is OFF by default
            this.activeTimer    = 0;      // elapsed time of current burst (ms)
            this.activeDuration = 1000;   // 2 seconds per activation -- tuned down to 1s
            //FINISH ALPHA CHANGE 456 -- Shield: 2s burst-only activation window on hit --
        }
        update(deltaTime){
            //START ALPHA CHANGE 456 -- Shield: animate only while active + auto-stop after 2s --
            if (!this.active) return;  // no animation while shield is off

            this.activeTimer += deltaTime;

            if (this.timer > this.interval){
                this.frameX++;
                if (this.frameX > this.maxFrame) this.frameX = 0; // Loop continuously during burst
                this.timer = 0;
            } else {
                this.timer += deltaTime;
            }

            // Stop after activeDuration
            if (this.activeTimer >= this.activeDuration){
                this.active      = false;
                this.activeTimer = 0;
                this.timer       = 0;
                this.frameX      = 0; // reset for next burst
            }
            //FINISH ALPHA CHANGE 456 -- Shield: animate only while active + auto-stop after 2s --
        }
        draw(context){
            //START ALPHA CHANGE 456 -- Shield: draw only while active --
            if (!this.active) return;
            //FINISH ALPHA CHANGE 456 -- Shield: draw only while active --

           //START ALPHA CHANGE 619 -- Shield: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
            let src = this.image;

            // Default: RAW sampling + runtime scaling (fallback stays identical)
            let stride = this._srcStride;
            let offX   = this._srcOffsetX;
            let offY   = this._srcOffsetY;
            let srcW   = this._srcSizeW;
            let srcH   = this._srcSizeH;

            // Default DEST is legacy behavior
            let destW  = this.width;
            let destH  = this.height;

            try {
                const al = this.game && this.game.assetsLoading;
                const id = (this.image && this.image.id) ? this.image.id : null; // "shield"
                if (al && id && typeof al.getCachedOrFallback === "function") {
                    const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                    const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> returns raw <img>

                    if (cand && cand !== this.image) {
                        const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                        if (meta) {
                            // Scaled-sheet path: 1:1 sampling using META
                            src    = cand;
                            stride = meta.stride;
                            offX   = meta.offX;
                            offY   = meta.offY;
                            srcW   = meta.srcW;
                            srcH   = meta.srcH;

                            // guaranteed 1:1 blit (no resample)
                            destW = srcW;
                            destH = srcH;

                            // keep instance sizing aligned to 1:1 draw size (once)
                            if (!this._scaledSizeSynced624) {
                                this.width  = destW;
                                this.height = destH;
                                this._scaledSizeSynced624 = true;
                            }
                        } else {
                            // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                            try {
                                if (!this._warnedMetaMissing624) this._warnedMetaMissing624 = new Set();
                                if (!this._warnedMetaMissing624.has(scaledKey)) {
                                    console.warn(`[Shield] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                    this._warnedMetaMissing624.add(scaledKey);
                                }
                            } catch (_) {}

                            src    = this.image;
                            stride = this._srcStride;
                            offX   = this._srcOffsetX;
                            offY   = this._srcOffsetY;
                            srcW   = this._srcSizeW;
                            srcH   = this._srcSizeH;
                            destW  = this.width;
                            destH  = this.height;
                        }
                    } else {
                        // Raw fallback path stays legacy
                        src = this.image;
                    }
                }
            } catch (_) {}

            // Frame index -> (col,row) TOP→BOTTOM
            const idx = this.frameX | 0;         // 0..48
            const col = idx % 7;                 // 0..6
            const row = (idx / 7) | 0;           // 0..6
            const sx  = col * stride + offX;
            const sy  = row * stride + offY;

            // Center on player using the DEST size we are actually drawing
            const dx = this.game.player.x + (this.game.player.width  - destW) / 2;
            const dy = this.game.player.y + (this.game.player.height - destH) / 2;

            context.drawImage(
                src,
                sx, sy, srcW, srcH,
                dx, dy, destW, destH
            );
            //FINISH ALPHA CHANGE 619 -- Shield: META-only sheetScaled sampling + 1:1 dest sizing --
            //FINISH ALPHA CHANGE 455 -- Shield: 7×7 TOP→BOTTOM draw using crop + scale (visual-only) --
            //move shield Forward/back (along the ship’s axis): change dest X to this.game.player.x + OFFSET_X (positive = forward/right; negative = back/left)
            //Up/down: change dest Y to this.game.player.y + OFFSET_Y (positive = down; negative = up) 
            //Examples: Move forward by 24 px: use this.game.player.x + 24, Move down by 6 px: use this.game.player.y + 6
            //this.image, sx(source x), sy(source y), sw(source width), sh(source height), 
            // dx(destination x), dy, dw(scaling down), dh(scaling down)
        }
        reset(){
             //START ALPHA CHANGE 456 -- Shield: trigger a fresh 2s burst on collision --
            this.frameX      = 0;    // Restart animation from first frame
            this.timer       = 0;    // Reset frame timer
            this.activeTimer = 0;    // Restart 2s window (tuned down to 1s)
            this.active      = true; // Turn shield ON for a new burst
            this.game.sound.shield(); // Play sound
            //FINISH ALPHA CHANGE 456 -- Shield: trigger a fresh 2s burst on collision --
        }
          
    }

    class Projectile {
        constructor(game, x, y){
            this.game = game;
            this.x = x;
            this.y = y;
            //START ALPHA CHANGE 533 -- Projectile: 7x7 sheet (3584x3584), 512x512 safe cell + scale-driven size + collrect--
            this._srcStride  = 512;   // 3584 / 7
            this._srcSizeW   = 512;   // full cell (no crop)
            this._srcSizeH   = 512;   // full cell (no crop)
            this._srcOffsetX = 0;
            this._srcOffsetY = 0; 

            this.scale  = 0.1; // start here; tune live (0.4, 0.35, 0.25, etc.)
            this.width  = Math.round(this._srcSizeW * this.scale);
            this.height = Math.round(this._srcSizeH * this.scale);

            //START ALPHA CHANGE 621 -- Projectile: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 621 -- Projectile: keep ONLY normalized sheetScale --

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.36;  // legacy-equivalent of old colliderScale=0.36 (width)
            this.colliderScaleY = 0.36;  // legacy-equivalent of old colliderScale=0.36 (height)
            this.colliderOffsetX = 2;   // +right / -left (pixels)
            this.colliderOffsetY = 0;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --
    
            //FINISH ALPHA CHANGE 533 -- Projectile: 7x7 sheet (3584x3584), 512x512 safe cell + scale-driven size + collrect --

            this.speed = 10;  //8=default speed -- 10=fast paced 
            this.markedForDeletion = false;
            this.image = document.getElementById("fireball"); 
            // we set alt sprite in "p.image = document.getElementById("fireball2");" -- calling a new class with this same class properties
            this.frameX = 0;
            this.maxFrame = 48; //ALPHA CHANGE 533 -- Projectile: use all 49 frames (0..48) --
            this.fps = 60;
            this.timer = 0;
            this.interval = 1000/this.fps;
            //we have 49 frames so it is initial frame 0 and max frame 48
            this.motionFps = 60; // make motion frame rate independent -- delta time based 
        }
        update(deltaTime){
            const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000;
            this.x += this.speed * deltaTime * motionScale; // with motionFps = 60, total pixels/second match old 60fps behavior
            if (this.timer > this.interval){
                if (this.frameX < this.maxFrame) this.frameX++;
                else this.frameX = 0;
                this.timer = 0;
            } else {
                this.timer += deltaTime;
                //keep increasing timer until it reaches deltatime
            }//original line:  if (this.x > this.game.width * 0.8) this.markedForDeletion = true; you set 80%, 100% when you want the projectile to disappear -- 100% means left egde not right side (disappears off-sceen)         
            //START ALPHA CHANGE 536 -- Projectile: deletion based on collider rect (dx+dw) instead of draw rect -- the real projectile footprint is best represented by the collider rect so we used dw (collider width)
            const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
            const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x; //dx = collider-left (this.x + this.colOX) when collider exists, else this.x
            const dw = hasCol ? (this.colW | 0) : this.width; //dw = collider-width (this.colW) when collider exists, else this.width
            if (dx + dw > this.game.width) this.markedForDeletion = true; //and then delete when dx + dw > this.game.width
            //FINISH ALPHA CHANGE 536
        }
        draw(context){
            //START ALPHA CHANGE 502 -- Projectile: prefer cached decoded ImageBitmap to avoid first-draw decode hitch --
            //for the alt sprite it will compute "getCachedOrFallback("img:fireball2", this.image)" as the later assignment "p.image = document.getElementById("fireball2");" wins
            let src = this.image;
            //START ALPHA CHANGE 621 -- Projectile: use scaled sheet cache (META 1:1) for fireball/fireball2, else RAW fallback --
            // Default: RAW sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
            let stride = this._srcStride;
            let offX   = this._srcOffsetX;
            let offY   = this._srcOffsetY;
            let srcW   = this._srcSizeW;
            let srcH   = this._srcSizeH;

            // Default DEST is legacy behavior (RAW fallback stays identical)
            let destW  = this.width;
            let destH  = this.height;

            try {
                const al = this.game && this.game.assetsLoading;
                const id = (this.image && this.image.id) ? this.image.id : "fireball";
                if (al && id && typeof al.getCachedOrFallback === "function") {
                    const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                    const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                    if (cand && cand !== this.image) {
                        const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                        if (meta) {
                            // Scaled-sheet path: 1:1 sampling using META (no per-frame scaled math)
                            src    = cand;
                            stride = meta.stride;
                            offX   = meta.offX;
                            offY   = meta.offY;
                            srcW   = meta.srcW;
                            srcH   = meta.srcH;

                            // guaranteed 1:1 blit (no resample)
                            destW = srcW;
                            destH = srcH;

                            // Sync collider to cached 1:1 draw size (once)
                            if (!this._scaledColliderSynced621) {
                                this.width  = destW;
                                this.height = destH;

                                //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                                const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                                const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                                const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                                const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                                this.colW  = Math.round(this.width  * sx666);
                                this.colH  = Math.round(this.height * sy666);
                                this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                                this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                                //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                                this._scaledColliderSynced621 = true;
                            }
                        } else {
                            // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                            try {
                                if (!this._warnedMetaMissing621) this._warnedMetaMissing621 = new Set();
                                if (!this._warnedMetaMissing621.has(scaledKey)) {
                                    console.warn(`[Projectile] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                    this._warnedMetaMissing621.add(scaledKey);
                                }
                            } catch (_) {}
                            src    = this.image;
                            stride = this._srcStride;
                            offX   = this._srcOffsetX;
                            offY   = this._srcOffsetY;
                            srcW   = this._srcSizeW;
                            srcH   = this._srcSizeH;
                            destW  = this.width;
                            destH  = this.height;
                        }
                    } else {
                        // Raw fallback path stays as legacy (runtime scaling happens because dest is this.width/height)
                        src = this.image;
                    }
                }
            } catch (_) {}
            
            //START ALPHA CHANGE 533 -- Projectile: 7x7 TOP→BOTTOM frame mapping (linear 0..48) + debug collrect--
            const idx = this.frameX | 0;       // 0..48
            const col = idx % 7;               // 0..6
            const row = (idx / 7) | 0;         // 0..6 (TOP→BOTTOM)
            const sx  = col * stride + offX;
            const sy  = row * stride + offY;

            context.drawImage(
                src,
                sx, sy, srcW, srcH,
                this.x, this.y, destW, destH
            );
            //FINISH ALPHA CHANGE 621 -- Projectile: use scaled sheet cache (META 1:1) for fireball/fireball2, else RAW fallback --
            //Projectile: debug overlay using tight collider (no label) --
            if (this.game && this.game.debug) {
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;
                const dw = hasCol ? (this.colW | 0) : this.width;
                const dh = hasCol ? (this.colH | 0) : this.height;
                context.strokeRect(dx, dy, dw, dh);
            }
            //FINISH ALPHA CHANGE 533 -- Projectile: 7x7 TOP→BOTTOM frame mapping (linear 0..48) + debug collrect --
            //this is so it can animate all the frames from the sprite sheat
            //FINISH ALPHA CHANGE 502 -- Projectile: prefer cached decoded ImageBitmap to avoid first-draw decode hitch --
            
        }

    }
    //middle size 
    class Particle {
     constructor(game, x, y, scaleOverride){//ALPHA CHANGE 547 -- added scaleOverride
        this.game = game;
        this.x = x;
        this.y = y;
        this.image = document.getElementById("gears"); //questa è l'immagine vera e propria -- this.image -- che poi diventa scr 
        this.frameX = Math.floor(Math.random() * 3);
        this.frameY = Math.floor(Math.random() * 3);
        //START ALPHA CHANGE 547 -- particles: gears sheet is 3x3 @ 768 stride; compute on-screen size via scale --
        this._srcStride  = 768;
        this._srcSizeW   = 768;
        this._srcSizeH   = 768;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        //START ALPHA CHANGE 627 -- Particles: remove random size variation (fixed base scales) --
        const baseScale = 0.03; // Particle = medium
        const scale = (typeof scaleOverride === "number") ? scaleOverride : baseScale;
        this.scale = scale;
        this.size  = Math.max(1, Math.round(this._srcSizeW * this.scale));
        //FINISH ALPHA CHANGE 627 -- Particles: remove random size variation (fixed base scales) --

        //START ALPHA CHANGE 627 -- Particle: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 627 -- Particle: keep ONLY normalized sheetScale --

        //START ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --
        this.effectiveRadius = 0.9; // 1.0 = full cell; 0.9 ≈ treat visible gear as ~10% smaller for bounds/bounce
        this.radius = (this.size * 0.5) * this.effectiveRadius; // physics radius (center-based)
        //FINISH ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --

        this.speedX = Math.random() * 6 - 3;
        this.speedY = Math.random() * -15;
        this.gravity = 0.4;
        this.markedForDeletion = false;
        this.angle = 0;
        this.va = Math.random() * 0.2 - 0.1;
        this.bounced = false;
        this.bottomBounceBoundary = Math.random() * 80 + 60;
        //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        this.motionFps = 60; // interpret speeds/gravities/va as "per frame at 60 fps" (frame rate independent)
        //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
     }
     update(deltaTime){
        //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // ms → virtual frames
        // rotation (angle += va) becomes time-based
        this.angle += this.va * deltaTime * motionScale;
        // gravity (speedY += gravity) becomes time-based
        this.speedY += this.gravity * deltaTime * motionScale;
        // horizontal motion: treat (speedX + game.speed) as per-frame at 60 fps
        this.x -= (this.speedX + this.game.speed) * deltaTime * motionScale;
        // vertical motion: y += speedY, time-based
        this.y += this.speedY * deltaTime * motionScale;
        //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        //START ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --
        if (this.y > this.game.height + this.radius || this.x < 0 - this.radius) this.markedForDeletion = true;
        //FINISH ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --

        //START ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
        if (this.y > this.game.height - this.bottomBounceBoundary - this.radius && this.bounced < 2){
        //FINISH ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
            this.bounced++;
            this.speedY *= -0.5;
        }
     }
     draw(context){
         //START ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (raw 768×768 sampled, scaled to this.size at draw time)
        let destW  = this.size;
        let destH  = this.size;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : "gears";
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-particle scaled math)
                        src    = cand;
                        stride = (typeof meta.stride === "number" && meta.stride > 0) ? meta.stride : this._srcStride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep physics radius aligned to 1:1 draw size (once)
                        if (!this._scaledSizeSynced632) {
                            this.size = destW;
                            if (typeof this.effectiveRadius === "number" && isFinite(this.effectiveRadius)) {
                                this.radius = (this.size * 0.5) * this.effectiveRadius;
                            }
                            this._scaledSizeSynced632 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing632) this._warnedMetaMissing632 = new Set();
                            if (!this._warnedMetaMissing632.has(scaledKey)) {
                                console.warn(`[Particle] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing632.add(scaledKey);
                            }
                        } catch (_) {}
                        src = this.image;
                    }
                } else {
                    // Raw fallback path stays legacy
                    src = this.image;
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing --

        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.angle);

        //START ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
        context.drawImage(
            src,
            this.frameX * stride + offX,
            this.frameY * stride + offY,
            srcW,
            srcH,
            //START ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
            -destW * 0.5,
            -destH * 0.5,
            destW,
            destH
            //FINISH ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
        );
        //FINISH ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
        context.restore();
        //this.x, this.y already defined in line 90, qui diventa zero, serve per farle ruotare su se stesse
     }
    }
    //smallest size
    class Particle2 {
        constructor(game, x, y, scaleOverride){//ALPHA CHANGE 547 -- added scaleOverride
           this.game = game;
           this.x = x;
           this.y = y;
           this.image = document.getElementById("gears");
           this.frameX = Math.floor(Math.random() * 3);
           this.frameY = Math.floor(Math.random() * 3);
          //START ALPHA CHANGE 547 -- particles: gears sheet is 3x3 @ 768 stride; compute on-screen size via scale --
           this._srcStride  = 768;
           this._srcSizeW   = 768;
           this._srcSizeH   = 768;
           this._srcOffsetX = 0;
           this._srcOffsetY = 0;

           //START ALPHA CHANGE 628 -- Particle2: remove random size variation (fixed base scales) --
           const baseScale = 0.02; // Particle2 = smaller
           const scale = (typeof scaleOverride === "number") ? scaleOverride : baseScale;
           this.scale = scale;
           this.size  = Math.max(1, Math.round(this._srcSizeW * this.scale));
           //FINISH ALPHA CHANGE 628 -- Particle2: remove random size variation (fixed base scales) --

           //START ALPHA CHANGE 628 -- Particle: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
           this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
           //FINISH ALPHA CHANGE 628 -- Particle: keep ONLY normalized sheetScale --

           //START ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --
           this.effectiveRadius = 0.9; // 1.0 = full cell; 0.9 ≈ treat visible gear as ~10% smaller for bounds/bounce
           this.radius = (this.size * 0.5) * this.effectiveRadius; // physics radius (center-based)
           //FINISH ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --

           this.speedX = Math.random() * 6 - 3;
           this.speedY = Math.random() * -15;
           this.gravity = 0.5;
           this.markedForDeletion = false;
           this.angle = 0;
           this.va = Math.random() * 0.2 - 0.1;
           this.bounced = false;
           this.bottomBounceBoundary = Math.random() * 80 + 60;
           //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
           this.motionFps = 60; // interpret speeds/gravities/va as "per frame at 60 fps" (frame rate independent)
           //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        }
        update(deltaTime){
        //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // ms → virtual frames
        // rotation (angle += va) becomes time-based
        this.angle += this.va * deltaTime * motionScale;
        // gravity (speedY += gravity) becomes time-based
        this.speedY += this.gravity * deltaTime * motionScale;
        // horizontal motion: treat (speedX + game.speed) as per-frame at 60 fps
        this.x -= (this.speedX + this.game.speed) * deltaTime * motionScale;
        // vertical motion: y += speedY, time-based
        this.y += this.speedY * deltaTime * motionScale;
        //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --

        //START ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --
        if (this.y > this.game.height + this.radius || this.x < 0 - this.radius) this.markedForDeletion = true;
        //FINISH ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --

        //START ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
        if (this.y > this.game.height - this.bottomBounceBoundary - this.radius && this.bounced < 2){
        //FINISH ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
               this.bounced++;
               this.speedY *= -0.5;
           }
        }
        draw(context){
            //START ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (raw 768×768 sampled, scaled to this.size at draw time)
        let destW  = this.size;
        let destH  = this.size;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : "gears";
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-particle scaled math)
                        src    = cand;
                        stride = (typeof meta.stride === "number" && meta.stride > 0) ? meta.stride : this._srcStride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep physics radius aligned to 1:1 draw size (once)
                        if (!this._scaledSizeSynced632) {
                            this.size = destW;
                            if (typeof this.effectiveRadius === "number" && isFinite(this.effectiveRadius)) {
                                this.radius = (this.size * 0.5) * this.effectiveRadius;
                            }
                            this._scaledSizeSynced632 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing632) this._warnedMetaMissing632 = new Set();
                            if (!this._warnedMetaMissing632.has(scaledKey)) {
                                console.warn(`[Particle2] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing632.add(scaledKey);
                            }
                        } catch (_) {}
                        src = this.image;
                    }
                } else {
                    // Raw fallback path stays legacy
                    src = this.image;
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing --

        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.angle);

        //START ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
        context.drawImage(
            src,
            this.frameX * stride + offX,
            this.frameY * stride + offY,
            srcW,
            srcH,
            //START ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
            -destW * 0.5,
            -destH * 0.5,
            destW,
            destH
            //FINISH ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
        );
           //FINISH ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
           context.restore();
           //this.x, this.y already defined in line 90, qui diventa zero, serve per farle ruotare su se stesse
           //FINISH ALPHA CHANGE 502 -- Particle2: prefer cached decoded ImageBitmap for gears (avoid first-draw decode hitch) --
        }
       }
       //biggest size
       class Particle3 {
        constructor(game, x, y, scaleOverride){//ALPHA CHANGE 547 -- added scaleOverride
           this.game = game;
           this.x = x;
           this.y = y;
           this.image = document.getElementById("gears");
           this.frameX = Math.floor(Math.random() * 3);
           this.frameY = Math.floor(Math.random() * 3);
           //START ALPHA CHANGE 547 -- particles: gears sheet is 3x3 @ 768 stride; compute on-screen size via scale --
           this._srcStride  = 768;
           this._srcSizeW   = 768;
           this._srcSizeH   = 768;
           this._srcOffsetX = 0;
           this._srcOffsetY = 0;

           //START ALPHA CHANGE 629 -- Particle3: remove random size variation (fixed base scales) --
           const baseScale = 0.05; // Particle3 = bigger
           const scale = (typeof scaleOverride === "number") ? scaleOverride : baseScale;
           this.scale = scale;
           this.size  = Math.max(1, Math.round(this._srcSizeW * this.scale));
           //FINISH ALPHA CHANGE 629 -- Particle3: remove random size variation (fixed base scales) --

           //START ALPHA CHANGE 629 -- Particle: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
           this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
           //FINISH ALPHA CHANGE 629 -- Particle: keep ONLY normalized sheetScale --

           //START ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --
           this.effectiveRadius = 0.9; // 1.0 = full cell; 0.9 ≈ treat visible gear as ~10% smaller for bounds/bounce
           this.radius = (this.size * 0.5) * this.effectiveRadius; // physics radius (center-based)
           //FINISH ALPHA CHANGE 548 -- particles: effectiveRadius accounts for padding inside each 768×768 cell --

           this.speedX = Math.random() * 6 - 3;
           this.speedY = Math.random() * -15;
           this.gravity = 0.5;
           this.markedForDeletion = false;
           this.angle = 0;
           this.va = Math.random() * 0.2 - 0.1;
           this.bounced = false;
           this.bottomBounceBoundary = Math.random() * 80 + 60;
           //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
           this.motionFps = 60; // interpret speeds/gravities/va as "per frame at 60 fps" (frame rate independent)
           //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        }
        update(deltaTime){
        //START ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // ms → virtual frames
        // rotation (angle += va) becomes time-based
        this.angle += this.va * deltaTime * motionScale;
        // gravity (speedY += gravity) becomes time-based
        this.speedY += this.gravity * deltaTime * motionScale;
        // horizontal motion: treat (speedX + game.speed) as per-frame at 60 fps
        this.x -= (this.speedX + this.game.speed) * deltaTime * motionScale;
        // vertical motion: y += speedY, time-based
        this.y += this.speedY * deltaTime * motionScale;
        //FINISH ALPHA CHANGE 445 -- Particle: dt-based motion and rotation using motionFps --

        //START ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --
        if (this.y > this.game.height + this.radius || this.x < 0 - this.radius) this.markedForDeletion = true;
        //FINISH ALPHA CHANGE 548 -- particles: bounds use radius (center-based) instead of raw size --
        //START ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
        if (this.y > this.game.height - this.bottomBounceBoundary - this.radius && this.bounced < 2){
        //FINISH ALPHA CHANGE 548 -- particles: bounce threshold uses radius so sprite doesn't sink --
               this.bounced++;
               this.speedY *= -0.5;
           }
        }
        draw(context){
        //START ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (raw 768×768 sampled, scaled to this.size at draw time)
        let destW  = this.size;
        let destH  = this.size;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : "gears";
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-particle scaled math)
                        src    = cand;
                        stride = (typeof meta.stride === "number" && meta.stride > 0) ? meta.stride : this._srcStride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep physics radius aligned to 1:1 draw size (once)
                        if (!this._scaledSizeSynced632) {
                            this.size = destW;
                            if (typeof this.effectiveRadius === "number" && isFinite(this.effectiveRadius)) {
                                this.radius = (this.size * 0.5) * this.effectiveRadius;
                            }
                            this._scaledSizeSynced632 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing632) this._warnedMetaMissing632 = new Set();
                            if (!this._warnedMetaMissing632.has(scaledKey)) {
                                console.warn(`[Particle3] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing632.add(scaledKey);
                            }
                        } catch (_) {}
                        src = this.image;
                    }
                } else {
                    // Raw fallback path stays legacy
                    src = this.image;
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 632 -- Particle: META-only sheetScaled sampling + 1:1 dest sizing --

        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.angle);

        //START ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
        context.drawImage(
            src,
            this.frameX * stride + offX,
            this.frameY * stride + offY,
            srcW,
            srcH,
            //START ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
            -destW * 0.5,
            -destH * 0.5,
            destW,
            destH
            //FINISH ALPHA CHANGE 548 -- particles: draw centered (rotate around true center); remove extra draw multipliers --
        );
        //FINISH ALPHA CHANGE 547 -- particles: use 768 stride from high-res gears sheet; scale via this.size --
        context.restore();
        //FINISH ALPHA CHANGE 503 -- Particle3: prefer cached decoded ImageBitmap for gears (avoid first-draw decode hitch) --
        //this.x, this.y already defined in line 90, qui diventa zero, serve per farle ruotare su se stesse
        }
       }

    class Player {
        constructor(game){
            this.game = game;

        //START ALPHA CHANGE 355 -- match enemy template: 7×7 sheet, 300×200 crop, scale sizing, tight collider, two images --
        // 7×7 layout: 512 stride per cell
        this._srcStride  = 512;

        // Centered crop 300×200 inside each 512×512 cell
        this._srcSizeW   = 300;
        this._srcSizeH   = 200;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 106
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 156

        // On-screen (and collision) size via scale (like enemies)
        this.scale  = 1.0;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 607 -- Player: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 607 -- Player: keep ONLY normalized sheetScale --

        // Position (kept from original)
        this.x = 20;
        this.y = 100;

        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.8;  // legacy-equivalent of old colliderScale=0.8 (width)
        this.colliderScaleY = 0.6;  // legacy-equivalent of old colliderScale=0.8 (height)
        this.colliderOffsetX = 0;   // +right / -left (pixels)
        this.colliderOffsetY = 5;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --

        // Animation frames: use full 7×7 (49 frames), linear 0..48; frameY kept but unused
        this.frameX = 0;
        this.frameY = 0;
        this.maxFrame = 48;

        // Images: normal + power-up (index.html must include <img id="playerPowerup">)
        this.image      = document.getElementById("player");
        this.imagePower = document.getElementById("playerPowerup");
        //FINISH ALPHA CHANGE 355

        // Movement & gameplay (unchanged)
        this.speedY = 0;
        this.speedX = 0;
        this.maxSpeed = 5;
        this.projectiles = [];

        // Power-up logic (unchanged)
        this.powerUp = false;
        this.powerUpTimer = 0;
        this.powerUpLimit = 10000;

        this.markedForDeletion = false; // keep flag

        //START ALPHA CHANGE 441 -- Player: add Shield-style time-based animation fields --
        this.fps = 20;                    // target visual FPS for Player (tweak as desired)
        this.interval = 1000 / this.fps;  // ms per frame
        this.timer = 0;                   // accumulated elapsed time for frame stepping
        //FINISH ALPHA CHANGE 441 -- Player: add time-based animation fields --

        this.motionFps = 60; // constructor value to set movements as frame rate independent 

        }
        update(deltaTime) {
    if (!this.game.gameOver) { // Add check to skip movement when game-over
        if (this.game.keys.includes(this.game.keyBindings.moveUp)) this.speedY = -this.maxSpeed;
        else if (this.game.keys.includes(this.game.keyBindings.moveDown)) this.speedY = this.maxSpeed;
        else this.speedY = 0;
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScaleY = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        this.y += this.speedY * deltaTime * motionScaleY;   // with motionFps = 60, total pixels/second match old 60fps behavior (match the old this.y += this.speedY;)
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --

        if (this.game.keys.includes(this.game.keyBindings.moveLeft)) this.speedX = -this.maxSpeed;
        else if (this.game.keys.includes(this.game.keyBindings.moveRight)) this.speedX = this.maxSpeed;
        else this.speedX = 0;
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScaleX = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        this.x += this.speedX * deltaTime * motionScaleX;   // with motionFps = 60, total pixels/second match old 60fps behavior (match the old this.x += this.speedX;)
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
    } else {
        this.speedX = 0; // Ensure no residual movement
        this.speedY = 0;
    }
        // END FIX
        
            //vertical boudaries -- così non va fuori dallo schermo
            //se la posizione y è maggiore dell'altezza del gioco meno quella dello sprite make sure we cannot move past this point
            if (this.y > this.game.height - this.height * 0.5) this.y = this.game.height - this.height * 0.5;
            else if (this.y < -this.height * 0.5) this.y = -this.height * 0.5;
            else if (this.x > this.game.width - this.width * 0.5) this.x = this.game.width - this.width * 0.5;
            else if (this.x < -this.width * 0.5) this.x = -this.width * 0.5;

            //handle projectiles
            this.projectiles.forEach(projectile => {
                projectile.update(deltaTime);
            });
            this.projectiles = this.projectiles.filter(projectile => !projectile.markedForDeletion);

            
            //START ALPHA CHANGE 442 -- Player: time-based frame advance using deltaTime (Shield-style) --
            this.timer += deltaTime;
            if (this.timer > this.interval) {
                this.timer = 0; // reset accumulator after stepping one frame
                this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
            }
            //FINISH ALPHA CHANGE 442 -- Player: time-based frame advance using deltaTime --

            //power up logic (unchanged; frameY no longer used by drawing)
            if (this.powerUp){
                if (this.powerUpTimer > this.powerUpLimit){
                    this.powerUpTimer = 0;
                    this.powerUp = false;
                    this.frameY = 0;
                    this.game.sound.powerDown();
                    this.game.ammoTimer = 0; // Reset to ensure recharge starts immediately
                } else {
                    this.powerUpTimer += deltaTime;
                    this.frameY = 1;
                  //this.game.ammo += 0.1; Removed: No longer needed, handled in Game.update
                }

            }

        }
        draw(context){ // draw projectiles first (unchanged)
            this.projectiles.forEach(projectile => {
                projectile.draw(context);
            });
        //START ALPHA CHANGE 357 -- choose sprite by state and delegate to unified 7×7 routine --
        //START ALPHA CHANGE 601 -- Player: META-only scaled sampling moved into _drawFrom7x7 (like Angler1) --
        let img = (this.powerUp && this.imagePower) ? this.imagePower : this.image;
        const id = (this.powerUp ? "playerPowerup" : "player"); // matches <img id="...">
        this._drawFrom7x7(context, img, id);
        //FINISH ALPHA CHANGE 601 -- Player: META-only scaled sampling moved into _drawFrom7x7 --
        //FINISH ALPHA CHANGE 357       
        }
        
        //START ALPHA CHANGE 358 -- unified enemy-style 7×7 draw + tight collider debug --
        _drawFrom7x7(context, img, id){
        //START ALPHA CHANGE 602 -- Player: META-only scaled sampling + 1:1 dest sizing + collider sync (per sheet id) --
        let src = img;
    // Defaults: RAW sampling + runtime scaling (legacy behavior)
    let stride = this._srcStride;
    let offX   = this._srcOffsetX;
    let offY   = this._srcOffsetY;
    let srcW   = this._srcSizeW;
    let srcH   = this._srcSizeH;

    let destW  = this.width;
    let destH  = this.height;

    try {
        const al = this.game && this.game.assetsLoading;
        if (al && id && typeof al.getCachedOrFallback === "function") {
            const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
            const cand = al.getCachedOrFallback(scaledKey, img); // if missing -> returns raw <img>

            if (cand && cand !== img) {
                const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                if (meta) {
                    // Scaled-sheet path: 1:1 sampling using META
                    src    = cand;
                    stride = meta.stride;
                    offX   = meta.offX;
                    offY   = meta.offY;
                    srcW   = meta.srcW;
                    srcH   = meta.srcH;

                    // 1:1 blit (no resample)
                    destW = srcW;
                    destH = srcH;

                    // Sync width/height + collider ONCE per sheet id
                    if (!this._scaledColliderSynced602) this._scaledColliderSynced602 = {};
                    if (!this._scaledColliderSynced602[id]) {
                        this.width  = destW;
                        this.height = destH;

                        //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                        const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                        const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                        const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                        const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                        this.colW  = Math.round(this.width  * sx666);
                        this.colH  = Math.round(this.height * sy666);
                        this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                        this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                        //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                        this._scaledColliderSynced602[id] = true;
                    }
                } else {
                    // META missing -> force RAW fallback + warn once
                    try {
                        if (!this._warnedMetaMissing602) this._warnedMetaMissing602 = new Set();
                        if (!this._warnedMetaMissing602.has(scaledKey)) {
                            console.warn(`[Player] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                            this._warnedMetaMissing602.add(scaledKey);
                        }
                    } catch (_) {}

                    src    = img;
                    stride = this._srcStride;
                    offX   = this._srcOffsetX;
                    offY   = this._srcOffsetY;
                    srcW   = this._srcSizeW;
                    srcH   = this._srcSizeH;
                    destW  = this.width;
                    destH  = this.height;
                }
            } else {
                // RAW fallback
                src = img;
            }
        }
    } catch (_) {}
        // Map linear frameX -> (col,row) on 7×7 grid (TOP→BOTTOM)
        const idx = this.frameX | 0;           // 0..48
        const col = idx % 7;                   // 0..6
        const row = (idx / 7) | 0;             // 0..6
        const sx  = col * stride + offX;
        const sy  = row * stride + offY;

        // Draw cropped region scaled to on-screen size
        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
        );
        //FINISH ALPHA CHANGE 602 -- Player: META-only scaled sampling + collider sync --

        // Debug overlay (tight collider like enemies)
        if (this.game && this.game.debug) {
            const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
            const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;
            const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;
            const dw = hasCol ? (this.colW | 0) : this.width;
            const dh = hasCol ? (this.colH | 0) : this.height;
            context.strokeRect(dx, dy, dw, dh);
        }
    }
    //FINISH ALPHA CHANGE 358

        // Normal state: Shoot from center cannon (unchanged offsets)
        shootCenter(){
            if (this.game.ammo > 0 && !this.powerUp) { // Only shoot in normal state
                //START ALPHA CHANGE 535 -- Projectile: use blue sheet for single-shot; keep Projectile class shared --
                const p = new Projectile(this.game, this.x +235, this.y +73); // X at center of 200x200 sprite y to test
                p.image = document.getElementById("fireball2"); // single fire (blue)
                this.projectiles.push(p);
                //FINISH ALPHA CHANGE 535 -- Projectile: use blue sheet for single-shot; keep Projectile class shared --
                this.game.sound.shot();                       // Bigger X number --> further right -- bigger Y--> further down
           }
          }
          // Power-up state: Shoot from top cannon (unchanged offsets)
        shootTop() {
        if (this.game.ammo > 0) {
        //START ALPHA CHANGE 536 -- Projectile: force red sheet for power-up top shot --
        const p = new Projectile(this.game, this.x + 228, this.y + 32); // Top cannon  Bigger Y number = down
        p.image = document.getElementById("fireball"); // power-up (red)
        this.projectiles.push(p);
        //FINISH ALPHA CHANGE 536 -- Projectile: force red sheet for power-up top shot --
        this.game.sound.shot();
        }
       }
        // Power-up state: Shoot from bottom cannon   
        shootBottom() {
            if (this.game.ammo > 0) {
              //START ALPHA CHANGE 537 -- Projectile: force red sheet for power-up bottom shot --
              const p = new Projectile(this.game, this.x + 228, this.y + 133); // Bottom cannon
              p.image = document.getElementById("fireball"); // power-up (red)
              this.projectiles.push(p);
              //FINISH ALPHA CHANGE 537 -- Projectile: force red sheet for power-up bottom shot --
              this.game.sound.secondShot();
            }
          }
          // Unified shoot method to handle state-based shooting (unchanged)
          shoot() {
            if (this.game.ammo > 0) { // Only shoot if ammo is positive
              if (!this.powerUp) {
                this.shootCenter();
                this.game.ammo--;
              } else {
                this.shootTop();
                this.shootBottom();
                this.game.ammo--;
              }
              // Ensure ammo doesn't go negative
              if (this.game.ammo < 0) this.game.ammo = 0;
            }
          }
        enterPowerUp(){ // (unchanged)
            this.powerUpTimer = 0;
            this.powerUp = true;
            if (this.game.ammo < this.game.maxAmmo) this.game.ammo = this.game.maxAmmo;
            this.game.sound.powerUp();
        }
    }

    class Enemy {
        constructor(game){
            this.game = game;
            this.x = this.game.width;
            this.markedForDeletion = false;
            this.frameX = 0;
            this.speedX = 0; //we overwrite this value in each enemy constructor (if this.speedX is undefined → NaN so we put "0" as a safeguard here) 
            //START ALPHA CHANGE 441 -- prune legacy base fields used by old tick-anim/draw --
            // Removed: this.frameY (enemies map frameX -> col/row internally)
            // Removed: this.maxFrame (each subclass defines its own)
            //FINISH ALPHA CHANGE 441
            //START ALPHA CHANGE 443 -- global motion calibration for dt-based enemy movement --
            this.motionFps = 60; // reference FPS: 60 keeps current per-frame tuning as 60fps-equivalent speed
            //FINISH ALPHA CHANGE 443 -- global motion calibration for dt-based enemy movement --

            //START ALPHA CHANGE 449 -- host: record enemy spawn gameTime and spawnX for dt-based kinematics --
            // gameTime is the authoritative host clock in ms; use it as spawn timestamp when the enemy is created.
            this.__spawnGameTimeMs = (this.game && typeof this.game.gameTime === 'number')
                ? (this.game.gameTime | 0)
                : 0;
            // Keep a reference X we can use later as the origin for x(t) on host/client.
            this.__spawnX = this.x;
            //FINISH ALPHA CHANGE 449 -- host: record enemy spawn gameTime and spawnX --
           
        }
        update(deltaTime){//deltaTime declared but not used fallback: “if some enemy doesn’t override update, at least it moves/culls and won’t crash" 
            this.x += this.speedX - this.game.speed; //base speed for the movement 
            //if enemies are off screen deletion true
            if (this.x + this.width < 0) this.markedForDeletion = true; //base cull -- deletion of enemies off screen 
            // no animation here (time-based lives in subclasses)
        }
        //START ALPHA CHANGE 441 -- base fallback draw: log once in debug if no override for this.game.debug exist in enemy constructor
        draw(context){ //"context" declared but not used: intentionally a no-op fallback that only logs once in debug if an enemy forgot to implement draw
          if (this.game && this.game.debug && !this._warnedNoDraw) {
              const name = (this && this.type) ? this.type
                         : (this && this.constructor ? this.constructor.name : "Enemy");
              console.log(`[Enemy.draw] No draw() override for ${name}. Using base fallback.`);
              this._warnedNoDraw = true; // avoid spamming every frame
           }
        // no-op: safe fallback -- in caso che non definiamo la logica del debug nel construcor del nemico, abbiamo un fallback per evitare il crash
        }
        //FINISH ALPHA CHANGE 441 -- base fallback draw --
    }

    //START ALPHA CHANGE 316 -- switch Angler1 to 7x7 (3584x3584) sheet, top→bottom, full 49 frames --
    class Angler1 extends Enemy { 
        constructor(game){
            super(game);
            this.image = document.getElementById("angler1");
            // 7×7 layout: 3584 / 7 = 512 stride per cell
            this._srcStride = 512;
            
            // Centered non-square crop (320×290) in each 512×512 cell:
            // offsets: x = (512 - 400)/2 = 56, y = (512 - 400)/2 = 56 -- faccio 400 perchè ha le ali molto grandi se no le taglia fuori
            this._srcSizeW = 400;
            this._srcSizeH = 400;
            this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 56 px
            this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 56 px
            
            // Scale factor for on-screen size (collision box handled separately)
            this.scale = 0.7125; // tweak as desired (keep ~228px wide): 0.7125 → Math.round(400 * 0.7125) = 285px
            this.width  = Math.round(this._srcSizeW * this.scale);
            this.height = Math.round(this._srcSizeH * this.scale);

            //START ALPHA CHANGE 593 -- Angler1: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading)
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 593 -- Angler1: keep ONLY normalized sheetScale

            this.y = Math.random() * (this.game.height * 0.95 - this.height); // Y spawning position

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.65;  // legacy-equivalent of old colliderScale=0.65 (width)
            this.colliderScaleY = 0.45;  // legacy-equivalent of old colliderScale=0.65 (height)
            this.colliderOffsetX =  3;   // +right / -left (pixels)
            this.colliderOffsetY = -3;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --


            // Use all 49 frames in strict row-major order (TOP→BOTTOM)
            this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
            this.frameX = 0;              // start at Row0,Col0
            this.frameY = 0;              // not used; row derived in draw

            //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
            // Time-based animation fields (Shield-style)
            this.fps = 20;                          // target visual FPS for Angler1
            this.interval = 1000 / this.fps;        // ms per frame
            this.timer = 0;                         // accumulated elapsed time
            //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --


            // Keep gameplay tuning as before
            this.lives = 6;               // prima 2
            this.score = 3;
            //this.shieldDamage = 6;      // optional: rely on global shieldDepleteAmount unless set
            this.type = "angler1";
            const raw = Math.random() * -1.5 -0.5; //standard base speed 
            this.speedX = Math.round(raw * 100) / 100; // rounded to int16 fixed-point ×100 (2 decimals = 100) snapshot precision
// -- switch Angler1 to 7x7 sheet, top→bottom, full 49 frames --
        }

//START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
       //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //cull -- deletes enemies off the screen 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --


        //draw(): map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM --
        draw(context){
             //START ALPHA CHANGE 590 -- Angler1: optional 1:1 dest sizing when scaled sheet is used (avoid any resample) --
            let src = this.image;

            // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
            let stride = this._srcStride;
            let offX   = this._srcOffsetX;
            let offY   = this._srcOffsetY;
            let srcW   = this._srcSizeW;
            let srcH   = this._srcSizeH;

            // Default DEST is legacy behavior (RAW fallback stays identical)
            let destW  = this.width;
            let destH  = this.height;


            try {
                 const al = this.game && this.game.assetsLoading;
                 const id = (this.image && this.image.id) ? this.image.id : null; // "angler1"
                 if (al && id && typeof al.getCachedOrFallback === "function") {
                 const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                 const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                    if (cand && cand !== this.image) {
                        const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    //FINISH ALPHA CHANGE 594 -- Angler1: META-only scaled sampling --
                        if (meta) {
                            // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                            src    = cand;
                            stride = meta.stride;
                            offX   = meta.offX;
                            offY   = meta.offY;
                            srcW   = meta.srcW;
                            srcH   = meta.srcH;

                            // guaranteed 1:1 blit (no resample)
                            destW = srcW;
                            destH = srcH;

                        //START ALPHA CHANGE 593 -- Angler1: sync gameplay collider to cached 1:1 draw size (once) --
                            if (!this._scaledColliderSynced593) {
                                this.width  = destW;
                                this.height = destH;

                                //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                                const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                                const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                                const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                                const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                                this.colW  = Math.round(this.width  * sx666);
                                this.colH  = Math.round(this.height * sy666);
                                this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                                this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                                //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --


                            this._scaledColliderSynced593 = true;
                        }
                        //FINISH ALPHA CHANGE 593 -- Angler1: sync gameplay collider to cached 1:1 draw size (once) --
                     } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once (so you notice immediately)
                        try {
                             if (!this._warnedMetaMissing595) this._warnedMetaMissing595 = new Set();
                             if (!this._warnedMetaMissing595.has(scaledKey)) {
                                 console.warn(`[Angler1] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                 this._warnedMetaMissing595.add(scaledKey);
                            }
                        } catch (_) {}
                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                        } //FINISH ALPHA CHANGE 594 -- Angler1: META-only scaled sampling --
                    } else {
                        // Raw fallback path stays as legacy (runtime scaling happens because dest is this.width/height)
                        src = this.image;
                    }
                }
            } catch (_) {}
            //Angler1: ONLY scaled-cache OR raw fallback

            const idx = this.frameX | 0;                // 0..48 advanced by update()
            const col = idx % 7;                        // 0..6
            const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM)
            //Angler1: use meta as a source for geometry variables when scaled sheet is used --
            const sx = col * stride + offX;
            const sy = row * stride + offY;
            context.drawImage(
                src,
                sx, sy, srcW, srcH,
                this.x, this.y, destW, destH
            );
            //FINISH ALPHA CHANGE 590 -- Angler1: optional 1:1 dest sizing when scaled sheet is used (avoid any resample) --

            // Debug overlay (tied to global game.debug)
            if (this.game && this.game.debug) {
                 // prefer tight collider when defined; otherwise fallback to legacy draw rect
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
                const dw = hasCol ? (this.colW | 0) : this.width;             
                const dh = hasCol ? (this.colH | 0) : this.height;            
                context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335

                //show current lives fixed to stick to the collider rectangle 
                //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
                context.save();
                context.textAlign = "left";
                context.textBaseline = "top";
                context.font = "20px Helvetica";
                context.fillStyle = "#ffffff";
                // place just above the collider; tweak -18 if you want tighter/looser spacing
                context.fillText(String(this.lives), dx, dy - 18);
                context.restore();
                //FINISH ALPHA CHANGE 441
            }
        }
        //FINISH ALPHA CHANGE 316 -- draw(): TOP→BOTTOM, full 49 frames --
        
    }
    class Angler2 extends Enemy { 
        constructor(game){
            super(game);
            // 7×7 layout: 3584 / 7 = 512 stride per cell (same as Stalker)
            this.image = document.getElementById("angler2");
            this._srcStride = 512;

            // Centered non-square crop (330×290) inside each 512×512 cell:
            // offsets: x = (512 - 330)/2 = 91, y = (512 - 290)/2 = 111
            this._srcSizeW = 330;
            this._srcSizeH = 290;
            this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 91 px
            this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 111 px



            // On-screen (collision handled separately) size via scale:
            // old width was 213px ⇒ scale = 213 / 330 ≈ 0.645454...
            this.scale = 0.64;                      // ~0.64545 potevi anche scrivere direttamente 0.64
            this.width  = Math.round(this._srcSizeW * this.scale); // ≈ 213
            this.height = Math.round(this._srcSizeH * this.scale); // ≈ 187

            //START ALPHA CHANGE 595 -- Angler2: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading)
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 595 -- Angler2: keep ONLY normalized sheetScale

            this.y = Math.random() * (this.game.height * 0.95 - this.height);

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.74;  // legacy-equivalent of old colliderScale=0.8 (width)
            this.colliderScaleY = 0.55;  // legacy-equivalent of old colliderScale=0.8 (height)
            this.colliderOffsetX = -5;   // +right / -left (pixels)
            this.colliderOffsetY = 0;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --


            // Use all 49 frames in strict row-major order, but DRAW rows bottom→top
            this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
            this.frameX = 0;              // start at Row0,Col0 (logical index)
            this.frameY = 0;              // not used; row derived in draw

            //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
            // Time-based animation fields (Shield-style)
            this.fps = 20;                          // target visual FPS for Angler2
            this.interval = 1000 / this.fps;        // ms per frame
            this.timer = 0;                         // accumulated elapsed time
            //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

            // Keep gameplay tuning as before
            this.lives = 6;               // prima 3
            this.score = 3;
            //this.shieldDamage = 6;      // optional: rely on global shieldDepleteAmount unless set
            this.type = "angler2";
            const raw = Math.random() * -1.5 -0.5; //standard base speed 
            this.speedX = Math.round(raw * 100) / 100;
        }

       //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //overwrites global clear enemy 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --


        // Draw: map linear index -> (col,row) with 7 cols, 7 rows; **rows 6→0 (bottom→top)**
        draw(context){
            //START ALPHA CHANGE 595 -- Angler2: META-only scaled sampling + optional 1:1 dest sizing (avoid any resample) --
            let src = this.image;

            // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
            let stride = this._srcStride;
            let offX   = this._srcOffsetX;
            let offY   = this._srcOffsetY;
            let srcW   = this._srcSizeW;
            let srcH   = this._srcSizeH;

            // Default DEST is legacy behavior (RAW fallback stays identical)
            let destW  = this.width;
            let destH  = this.height;

            try {
                const al = this.game && this.game.assetsLoading;
                const id = (this.image && this.image.id) ? this.image.id : null; // "angler2"
                if (al && id && typeof al.getCachedOrFallback === "function") {
                    const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                    const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                    if (cand && cand !== this.image) {
                        const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                        if (meta) {
                            // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                            src    = cand;
                            stride = meta.stride;
                            offX   = meta.offX;
                            offY   = meta.offY;
                            srcW   = meta.srcW;
                            srcH   = meta.srcH;

                            // guaranteed 1:1 blit (no resample)
                            destW = srcW;
                            destH = srcH;

                            //START ALPHA CHANGE 596 -- Angler2: sync gameplay collider to cached 1:1 draw size (once) --
                            if (!this._scaledColliderSynced598) {
                                this.width  = destW;
                                this.height = destH;

                                //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                                const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                                const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                                const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                                const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                                this.colW  = Math.round(this.width  * sx666);
                                this.colH  = Math.round(this.height * sy666);
                                this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                                this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                                //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                                this._scaledColliderSynced598 = true;
                            }
                            //FINISH ALPHA CHANGE 596 -- Angler2: sync gameplay collider to cached 1:1 draw size (once) --
                        } else {
                            // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                            try {
                                if (!this._warnedMetaMissing599) this._warnedMetaMissing599 = new Set();
                                if (!this._warnedMetaMissing599.has(scaledKey)) {
                                    console.warn(`[Angler2] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                    this._warnedMetaMissing599.add(scaledKey);
                                }
                            } catch (_) {}

                            src    = this.image;
                            stride = this._srcStride;
                            offX   = this._srcOffsetX;
                            offY   = this._srcOffsetY;
                            srcW   = this._srcSizeW;
                            srcH   = this._srcSizeH;
                            destW  = this.width;
                            destH  = this.height;
                        }
                    } else {
                        // Raw fallback path stays as legacy (runtime scaling happens because dest is this.width/height)
                        src = this.image;
                    }
                }
            } catch (_) {}
            //FINISH ALPHA CHANGE 595 -- Angler2: META-only scaled sampling --

            const idx = this.frameX | 0;                // 0..48 advanced by update()
            const col = idx % 7;                        // 0..6
            //const row = 6 - ((idx / 7) | 0);            // 6..0  (bottom→top like Stalker)
            const row = (idx / 7) | 0;                    //ALPHA CHANGE 320 -- 0..6 (TOP→BOTTOM) -- abbiamo cambiato a top to bottom
            //dest sizing 
            const sx = col * stride + offX;
            const sy = row * stride + offY;
            context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
            );
            //1:1 dest sizing: this.width, this.height---> destW, destH

            // Debug overlay (tied to global game.debug)
            if (this.game && this.game.debug) {
                // prefer tight collider when defined; otherwise fallback to legacy draw rect
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
                const dw = hasCol ? (this.colW | 0) : this.width;             
                const dh = hasCol ? (this.colH | 0) : this.height;            
                context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335
                //show current lives -- fixed to stick to the collider rectangle 
                //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
                context.save();
                context.textAlign = "left";
                context.textBaseline = "top";
                context.font = "20px Helvetica";
                context.fillStyle = "#ffffff";
                // place just above the collider; tweak -18 if you want tighter/looser spacing
                context.fillText(String(this.lives), dx, dy - 18);
                context.restore();
                //FINISH ALPHA CHANGE 441
            }
        }
    }

//START ALPHA CHANGE 323 -- LuckyFish: 7x7 sheet (3584x3584), 320x300 crop, scaled to width 99, top→bottom, custom anim + debug --
    class LuckyFish extends Enemy { // powerup enemy quello piccolino 
    constructor(game){
        super(game);
        this.image = document.getElementById("lucky");

        // 7×7 layout: 3584 / 7 = 512 stride per cell
        this._srcStride = 512;

        // Centered crop 320×300 inside each 512×512 cell:
        // offsets: x = (512 - 320)/2 = 96, y = (512 - 300)/2 = 106
        this._srcSizeW = 320;
        this._srcSizeH = 300;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 96 px
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 106 px

        // Scale to match legacy on-screen width (old width = 99px) un po piu grande lo facciamo 
        this.scale  = 0.3;                         // ≈ 0.3 (99/320)
        this.width  = Math.round(this._srcSizeW * this.scale); // ≈ 99
        this.height = Math.round(this._srcSizeH * this.scale); // ≈ 93

        //START ALPHA CHANGE 597 -- LuckyFish: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading)
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 597 -- LuckyFish: keep ONLY normalized sheetScale

        // Position (keep original random Y range behavior)
        this.y = Math.random() * (this.game.height * 0.95 - this.height);

        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.78;  // legacy-equivalent of old colliderScale=0.85 (width)
        this.colliderScaleY = 0.45;  // legacy-equivalent of old colliderScale=0.85 (height)
        this.colliderOffsetX = -2;   // +right / -left (pixels)
        this.colliderOffsetY = 2;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --


        // Use all 49 frames in strict row-major order (TOP→BOTTOM)
        this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
        this.frameX = 0;              // start at Row0,Col0
        this.frameY = 0;              // not used; row derived in draw

        //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
        // Time-based animation fields (Shield-style)
        this.fps = 20;                          // target visual FPS for Luckyfish
        this.interval = 1000 / this.fps;        // ms per frame
        this.timer = 0;                         // accumulated elapsed time
        //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

        // Gameplay (keep power-up semantics)
        this.lives = 3;
        this.score = 10;      // score penalty on kill path uses this puniamo pesantemente i giocatori poco precisi 
        this.type = "lucky";
        const raw = Math.random() * -1.5 -0.5; //standard base speed
        this.speedX = Math.round(raw * 100) / 100; 
    }

    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //overwrites global enemy clear 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

    // Draw: map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM
    draw(context){
       //START ALPHA CHANGE 602 -- LuckyFish: META-only scaled sampling + optional 1:1 dest sizing (avoid any resample) --
        let src = this.image;

        // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (RAW fallback stays identical)
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "lucky"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        //START ALPHA CHANGE 603 -- LuckyFish: sync gameplay collider to cached 1:1 draw size (once) --
                        if (!this._scaledColliderSynced603) {
                            this.width  = destW;
                            this.height = destH;

                            //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                            const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                            const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                            const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                            const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                            this.colW  = Math.round(this.width  * sx666);
                            this.colH  = Math.round(this.height * sy666);
                            this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                            this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                            //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                            this._scaledColliderSynced603 = true;
                        }
                        //FINISH ALPHA CHANGE 603 -- LuckyFish: sync gameplay collider to cached 1:1 draw size (once) --
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing604) this._warnedMetaMissing604 = new Set();
                            if (!this._warnedMetaMissing604.has(scaledKey)) {
                                console.warn(`[LuckyFish] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing604.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    // Raw fallback path stays as legacy
                    src = this.image;
                }
            }
        } catch (_) {}
        //LuckyFish: META-only scaled sampling --

        const idx = this.frameX | 0;                // 0..48 advanced by update()
        const col = idx % 7;                        // 0..6
        const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM)

        const sx = col * stride + offX;
        const sy = row * stride + offY;

        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
        );
        //FINISH ALPHA CHANGE 597 -- LuckyFish: META-only scaled sampling + optional 1:1 dest sizing --

        // Debug overlay (tied to global game.debug)
        if (this.game && this.game.debug) {
           // prefer tight collider when defined; otherwise fallback to legacy draw rect
            const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
            const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
            const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
            const dw = hasCol ? (this.colW | 0) : this.width;             
            const dh = hasCol ? (this.colH | 0) : this.height;            
            context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335
            //show current lives -- fixed to stick to the collider rectangle 
            //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
            context.save();
            context.textAlign = "left";
            context.textBaseline = "top";
            context.font = "20px Helvetica";
            context.fillStyle = "#ffffff";
            // place just above the collider; tweak -18 if you want tighter/looser spacing
            context.fillText(String(this.lives), dx, dy - 18);
            context.restore();
            //FINISH ALPHA CHANGE 441
        }
    }
}
//FINISH ALPHA CHANGE 323 -- LuckyFish swap complete --

    //START ALPHA CHANGE 321 -- switch HiveWhale to 7x7 (4480x4480) sheet, top→bottom, full 49 frames --
    class HiveWhale extends Enemy { 
        constructor(game){
            super(game);
            // Sheet layout: 4480 / 7 = 640 stride per cell
            this.image = document.getElementById("hivewhale");
            this._srcStride = 640;

            // Centered crop 420×400 inside each 640×640 cell:
            // offsets: x = (640 - 420)/2 = 110, y = (640 - 400)/2 = 120
            this._srcSizeW = 420;
            this._srcSizeH = 400;
            this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 110 px
            this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 120 px

            // On-screen size via scale (1.0 = crop size)
            this.scale  = 1.0;                                           //START ALPHA CHANGE 336
            this.width  = Math.round(this._srcSizeW * this.scale);       //START ALPHA CHANGE 336
            this.height = Math.round(this._srcSizeH * this.scale);       //START ALPHA CHANGE 336

            //START ALPHA CHANGE 598 -- HiveWhale: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 598 -- HiveWhale: keep ONLY normalized sheetScale --

            this.y = Math.random() * (this.game.height * 0.95 - this.height);

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.93;  // legacy-equivalent of old colliderScale=0.95 (width)
            this.colliderScaleY = 0.45;  // legacy-equivalent of old colliderScale=0.95 (height)
            this.colliderOffsetX = 0;   // +right / -left (pixels)
            this.colliderOffsetY = -15;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --


            // Use all 49 frames in strict row-major order (TOP→BOTTOM)
            this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
            this.frameX = 0;              // start at Row0,Col0
            this.frameY = 0;              // not used; row derived in draw

            //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
            // Time-based animation fields (Shield-style)
            this.fps = 20;                          // target visual FPS for HiveWhale
            this.interval = 1000 / this.fps;        // ms per frame
            this.timer = 0;                         // accumulated elapsed time
            //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

            // Gameplay (kept from original)
            this.lives = 20;
            this.score = 15;
            this.shieldDamage = 20;       // shared-shield hit on body collision (power-ups ignore this)
            this.type = "hive";
            const raw = Math.random() * -1.2 - 0.2; // we set the speed here and we override the standard enemy speed (Base Enemy: this.speedX = Math.random() * -1.5 - 0.5;) -- a more negative value means faster leftward motion
            this.speedX = Math.round(raw * 100) / 100; //per arrotondare a due decimali unit16 precision come nel GAME_STATE quindi uso raw (valore originale)
// -- switch HiveWhale to 7x7 sheet, top→bottom, full 49 frames --
        }
    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //overwrites global clear enemy 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

        // -- draw(): map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM --
        draw(context){
       //START ALPHA CHANGE 597 -- HiveWhale: META-only scaled sampling + optional 1:1 dest sizing when scaled sheet is used --
            let src = this.image;

            // Default: RAW-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
            let stride = this._srcStride;
            let offX   = this._srcOffsetX;
            let offY   = this._srcOffsetY;
            let srcW   = this._srcSizeW;
            let srcH   = this._srcSizeH;

            // Default DEST is legacy behavior (RAW fallback stays identical)
            let destW  = this.width;
            let destH  = this.height;

            try {
                const al = this.game && this.game.assetsLoading;
                const id = (this.image && this.image.id) ? this.image.id : null; // "hivewhale"
                if (al && id && typeof al.getCachedOrFallback === "function") {
                    const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                    const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                    if (cand && cand !== this.image) {
                        const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                        if (meta) {
                            // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                            src    = cand;
                            stride = meta.stride;
                            offX   = meta.offX;
                            offY   = meta.offY;
                            srcW   = meta.srcW;
                            srcH   = meta.srcH;

                            // guaranteed 1:1 blit (no resample)
                            destW = srcW;
                            destH = srcH;

                            //START ALPHA CHANGE 598 -- HiveWhale: sync gameplay collider to cached 1:1 draw size (once) --
                            if (!this._scaledColliderSynced598) {
                                this.width  = destW;
                                this.height = destH;

                                //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                                const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                                const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                                const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                                const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                                this.colW  = Math.round(this.width  * sx666);
                                this.colH  = Math.round(this.height * sy666);
                                this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                                this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                                //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                                this._scaledColliderSynced598 = true;
                            }
                            //FINISH ALPHA CHANGE 598 -- HiveWhale: sync gameplay collider to cached 1:1 draw size (once) --
                        } else {
                            // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                            try {
                                if (!this._warnedMetaMissing597) this._warnedMetaMissing597 = new Set();
                                if (!this._warnedMetaMissing597.has(scaledKey)) {
                                    console.warn(`[HiveWhale] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                    this._warnedMetaMissing597.add(scaledKey);
                                }
                            } catch (_) {}

                            // IMPORTANT: reset ALL geometry + dest to RAW (no half-switched state)
                            src    = this.image;
                            stride = this._srcStride;
                            offX   = this._srcOffsetX;
                            offY   = this._srcOffsetY;
                            srcW   = this._srcSizeW;
                            srcH   = this._srcSizeH;
                            destW  = this.width;
                            destH  = this.height;
                        }
                    } else {
                        // Raw fallback path stays as legacy
                        src = this.image;
                    }
                }
            } catch (_) {}
            //FINISH ALPHA CHANGE 597 -- HiveWhale: META-only scaled sampling + optional 1:1 dest sizing --
            const idx = this.frameX | 0;                // 0..48 advanced by update()
            const col = idx % 7;                        // 0..6
            const row = (idx / 7) | 0;                  // 0..6  (TOP→BOTTOM)
            const sx = col * stride + offX;
            const sy = row * stride + offY;
            context.drawImage(
                src,
                sx, sy, srcW, srcH,   // source rect (420×400)
                this.x, this.y, destW, destH   // dest rect (420×400 on-screen)
            );

            // Debug overlay (tied to global game.debug)
            if (this.game && this.game.debug) {
                // prefer tight collider when defined; otherwise fallback to legacy draw rect
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
                const dw = hasCol ? (this.colW | 0) : this.width;             
                const dh = hasCol ? (this.colH | 0) : this.height;            
                context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335

                //show current lives -- fixed to stick to the collider rectangle 
                //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
                context.save();
                context.textAlign = "left";
                context.textBaseline = "top";
                context.font = "20px Helvetica";
                context.fillStyle = "#ffffff";
                // place just above the collider; tweak -18 if you want tighter/looser spacing
                context.fillText(String(this.lives), dx, dy - 18);
                context.restore();
                //FINISH ALPHA CHANGE 441
            }
        }
        //FINISH ALPHA CHANGE 321 -- draw(): TOP→BOTTOM, full 49 frames --
}

//START ALPHA CHANGE 322 -- Drone: 7x7 sheet (3584x3584), 300x260 crop, scaled to old width (115), top→bottom, custom anim + debug --
    class Drone extends Enemy {   
    constructor(game, x, y){
        super(game);
        this.image = document.getElementById("drone");

        // 7×7 layout: 3584 / 7 = 512 stride per cell
        this._srcStride = 512;

        // Centered crop 300×260 inside each 512×512 cell:
        // offsets: x = (512 - 300)/2 = 106, y = (512 - 260)/2 = 126
        this._srcSizeW = 300;
        this._srcSizeH = 260;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 106 px
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 126 px

        // Scale to match legacy on-screen width (old width = 115px):
        this.scale  = 0.3833;                      // 0.3833 → Math.round(300*0.3833)=115, Math.round(260*0.3833)=100
        this.width  = Math.round(this._srcSizeW * this.scale); // 115
        this.height = Math.round(this._srcSizeH * this.scale); // ≈ 100

        //START ALPHA CHANGE 599 -- Drone: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 599 -- Drone: keep ONLY normalized sheetScale --

        // Position from caller (keeps existing spawn API)
        this.x = x;
        this.y = y;

        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.78;  // legacy-equivalent of old colliderScale=0.85 (width)
        this.colliderScaleY = 0.60;  // legacy-equivalent of old colliderScale=0.85 (height)
        this.colliderOffsetX = 0;   // +right / -left (pixels)
        this.colliderOffsetY = 5;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --



        // Full 49 frames in strict row-major order (TOP→BOTTOM)
        this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
        this.frameX = 0;              // start at Row0,Col0
        this.frameY = 0;              // not used; row derived in draw

        //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
        // Time-based animation fields (Shield-style)
        this.fps = 20;                          // target visual FPS for Drone
        this.interval = 1000 / this.fps;        // ms per frame
        this.timer = 0;                         // accumulated elapsed time
        //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

        // Gameplay (kept from original)
        this.lives = 3;
        this.score = 2;
        // this.shieldDamage = 3;      // rely on global shieldDepleteAmount unless you want per-enemy override
        this.type = "drone";
        const raw = Math.random() * -4.2 - 0.5;
        this.speedX = Math.round(raw * 100) / 100;
    }

    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true;// overwrites global clear enemy

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

    // Draw: map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM
    draw(context){
        //START ALPHA CHANGE 601 -- Drone: META-only scaled sampling + optional 1:1 dest sizing when scaled sheet is used --
        let src = this.image;

        // Default: RAW-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (RAW fallback stays identical)
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "drone"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        //START ALPHA CHANGE 598 -- Drone: sync gameplay collider to cached 1:1 draw size (once) --
                        if (!this._scaledColliderSynced602) {
                            this.width  = destW;
                            this.height = destH;

                            //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                            const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                            const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                            const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                            const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                            this.colW  = Math.round(this.width  * sx666);
                            this.colH  = Math.round(this.height * sy666);
                            this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                            this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                            //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                            this._scaledColliderSynced602 = true;
                        }
                        //FINISH ALPHA CHANGE 598 -- Drone: sync gameplay collider to cached 1:1 draw size (once) --
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing601) this._warnedMetaMissing601 = new Set();
                            if (!this._warnedMetaMissing601.has(scaledKey)) {
                                console.warn(`[Drone] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing601.add(scaledKey);
                            }
                        } catch (_) {}

                        // IMPORTANT: reset ALL geometry + dest to RAW (no half-switched state)
                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    // Raw fallback path stays as legacy
                    src = this.image;
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 598 -- Drone: META-only scaled sampling + optional 1:1 dest sizing --

        const idx = this.frameX | 0;                // 0..48 advanced by update()
        const col = idx % 7;                        // 0..6
        const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM)
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
        );

        // Debug overlay (tied to global game.debug)
        if (this.game && this.game.debug) {
            // prefer tight collider when defined; otherwise fallback to legacy draw rect
            const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
            const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
            const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
            const dw = hasCol ? (this.colW | 0) : this.width;             
            const dh = hasCol ? (this.colH | 0) : this.height;            
            context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335
            //show current lives -- fixed to stick to the collider rectangle 
            //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
            context.save();
            context.textAlign = "left";
            context.textBaseline = "top";
            context.font = "20px Helvetica";
            context.fillStyle = "#ffffff";
            // place just above the collider; tweak -18 if you want tighter/looser spacing
            context.fillText(String(this.lives), dx, dy - 18);
            context.restore();
            //FINISH ALPHA CHANGE 441
        }
    }
}
//FINISH ALPHA CHANGE 322 -- Drone swap complete --

//START ALPHA CHANGE 371 -- NEW enemy: Missile (7×7, 607×301 crop, TOP→BOTTOM; unified ticker) --
class Missile extends Enemy {
    constructor(game, x, y) {
        super(game);
        this.image = document.getElementById("missile"); // sprite tag 

        // 7×7 layout: 4249 / 7 = 607 stride per cell
        this._srcStride  = 607;

        // Centered crop 607×301 inside each 607×607 cell
        this._srcSizeW   = 607;
        this._srcSizeH   = 301;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 0 -- esempio con 400 di crop quando aveva 605 stride: (605 − 400)/2 = 102.5 non va bene perchè deve essere un numero senza decimali, allora usi 401
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 153

        // On-screen size (~200×100)
        this.scale  = 0.5;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 599 -- Missile: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 599 -- Missile: keep ONLY normalized sheetScale --

        //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
        // Time-based animation fields (Shield-style)
        this.fps = 60;                          // target visual FPS for Missile
        this.interval = 1000 / this.fps;        // ms per frame
        this.timer = 0;                         // accumulated elapsed time
        //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

        // Position + faster travel
        this.x = x; //important: if you do this.x = x then you can pass this argument in the constructor and it can be overrided externally (as we do for game,x,y but not for speed)
        this.y = y;
        this.type = "missile";

        // Per-missile random speed (same range you used at spawn), quantized to 2 decimals -- centralized it here from ALPHA CHANGE 372-3
        const raw = Math.random() * -7 - 5;
        this.speedX = Math.round(raw * 100) / 100; //by not setting this.speedX= speedX ma direttamente this.speedX, questo valore non viene dato al constructor dall'esterno ma direttamente dalla classe
        //If you pass -8, it will actually move at -9 per frame on screen (because -8 - 1 = -9). Randomized value (e.g., Math.random() * -7 - 5) → produces a range.
        //Good compromise: Math.random() * -7 - 5, and -1 for testing (very slow so you can check the animation)

        // Gameplay + collider
        
        //START ALPHA CHANGE 663 (ex ALPHA CHANGE 422) -- Hard/Easy mode raise/reduces missile shield damage/durability  --
        const isHard663 = !!(this.game && this.game.hardMode);
        const isEasy663 = !!(this.game && !this.game.hardMode && ((this.game.timeLimit|0) >= 120000));
        this.shieldDamage = isEasy663 ? 7 : (isHard663 ? 25 : 15); //Easy=7, Normal=15, Hard=25
        this.lives = isEasy663 ? 3 : (isHard663 ? 8 : 6); //Easy=3, Normal=6, Hard=8
        //FINISH ALPHA CHANGE 663 (ALPHA CHANGE 422) -- Hard/Easy mode raise/reduces missile shield damage/durability --
      
        this.score = 2;  // default 
        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 -- Missile collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.4;  // legacy-equivalent of old colliderScale=0.4 (width)
        this.colliderScaleY = 0.3;  // legacy-equivalent of old colliderScale=0.4 (height)
        this.colliderOffsetX = 0;   // +right / -left (pixels)
        this.colliderOffsetY = -5;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 -- Missile collider: split X/Y scale + optional offsets --

        // START ALPHA CHANGE 375 -- 7×7 sheet: use full 49 frames (0..48), TOP→BOTTOM --
        this.frameX = 0;
        this._frameCount = 49;                 // 7×7
        this.maxFrame = 48;                    // 0..48
        // FINISH ALPHA CHANGE 375 -- 7×7 full-frames setup --
    }

    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //overwrites global enemy clear

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

    draw(context) {
        //START ALPHA CHANGE 597 -- Missile: optional 1:1 dest sizing when scaled sheet is used (META from AssetsLoading) --
        let src = this.image;

        // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (RAW fallback stays identical)
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "missile"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        //START ALPHA CHANGE 597a -- Missile: sync gameplay collider to cached 1:1 draw size (once) --
                        if (!this._scaledColliderSynced597a) {
                            this.width  = destW;
                            this.height = destH;

                            //START ALPHA CHANGE 664 -- Missile collider: resync using X/Y scales + offsets (cached 1:1) --
                            const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                            const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                            const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                            const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                            this.colW  = Math.round(this.width  * sx666);
                            this.colH  = Math.round(this.height * sy666);
                            this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                            this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                            //FINISH ALPHA CHANGE 664 -- Missile collider: resync using X/Y scales + offsets (cached 1:1) --

                            this._scaledColliderSynced597a = true;
                        }
                        //FINISH ALPHA CHANGE 599 -- Missile: sync gameplay collider to cached 1:1 draw size (once) --
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing597b) this._warnedMetaMissing597b = new Set();
                            if (!this._warnedMetaMissing597b.has(scaledKey)) {
                                console.warn(`[Missile] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing597b.add(scaledKey);
                            }
                        } catch (_) {}

                        // IMPORTANT: reset ALL geometry + dest (in case anything was already switched)
                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } // else: raw fallback stays as legacy
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 599 -- Missile: optional 1:1 dest sizing when scaled sheet is used --

        // -- 7×7 mapping: linear 0..48 → (col,row) TOP→BOTTOM --
        const idx = this.frameX | 0;                // 0..48 advanced by update()/visuals-only tick
        const col = idx % 7;                        // 0..6
        const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM)
        const sx  = col * stride + offX;
        const sy  = row * stride + offY;

        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
        );

        if (this.game && this.game.debug) { //debug rect
            const dx = this.x + (this.colOX | 0);
            const dy = this.y + (this.colOY | 0);
            const dw = this.colW | 0;
            const dh = this.colH | 0;
            context.strokeRect(dx, dy, dw, dh);
            //show current lives -- fixed to stick to the collider rectangle 
            //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
            context.save();
            context.textAlign = "left";
            context.textBaseline = "top";
            context.font = "20px Helvetica";
            context.fillStyle = "#ffffff";
            // place just above the collider; tweak -18 if you want tighter/looser spacing
            context.fillText(String(this.lives), dx, dy - 18);
            context.restore();
            //FINISH ALPHA CHANGE 441
        }
    }
}
//FINISH ALPHA CHANGE 371 -- NEW enemy: Missile --

//START ALPHA CHANGE 315 -- swap BulbWhale to 7x7 sheet (3584x3584), top→bottom; custom anim; debug --
    class BulbWhale extends Enemy {
        constructor(game){
            super(game);
            this.image = document.getElementById("bulbwhale");
            // 7×7 sheet: 3584 / 7 = 512 stride per cell
            this._srcStride = 512;
            
            // Non-square crop centered in each 512×512 cell:
            // crop = 330×330 ⇒ offsets: x=(512-330)/2=91, y=(512-330)/2=91
            this._srcSizeW = 330;
            this._srcSizeH = 330;
            this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 91 px
            this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 91 px

            // On-screen size via scale (1.0 = crop size)
            this.scale  = 1.0;                                           //START ALPHA CHANGE 336
            this.width  = Math.round(this._srcSizeW * this.scale);       //START ALPHA CHANGE 336
            this.height = Math.round(this._srcSizeH * this.scale);       //START ALPHA CHANGE 336

            //START ALPHA CHANGE 600 -- BulbWhale: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 600 -- BulbWhale: keep ONLY normalized sheetScale --

            this.y = Math.random() * (this.game.height * 0.95 - this.height);

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.78;  // legacy-equivalent of old colliderScale=0.8 (width)
            this.colliderScaleY = 0.4;  // legacy-equivalent of old colliderScale=0.8 (height)
            this.colliderOffsetX = 0;   // +right / -left (pixels)
            this.colliderOffsetY = 20;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --



            // Animate in row-major, TOP→BOTTOM, but stop at Row6,Col5 (linear index 47)
            this.maxFrame = 47;           // last valid linear frame = row 6 * 7 + col 5
            this.frameX = 0;              // start at Row0, Col0
            this.frameY = 0;              // not used; row derived in draw

            //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
            // Time-based animation fields (Shield-style)
            this.fps = 20;                          // target visual FPS for BulbWhale
            this.interval = 1000 / this.fps;        // ms per frame
            this.timer = 0;                         // accumulated elapsed time
            //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --


            // Gameplay values kept from previous BulbWhale (adjust as desired)
            this.lives = 20;
            this.score = 15;
            this.shieldDamage = 20;       // shared-shield hit on body collision (power-ups ignore this)
            this.type = "bulbwhale";
            const raw = Math.random() * -1.2 - 0.2;
            this.speedX = Math.round(raw * 100) / 100;
// -- swap BulbWhale to 7x7 sheet (3584x3584), top→bottom; custom anim; debug --
        }
//START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //clear enemies 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..47 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

        // -- draw(): map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM --
        draw(context){
        //START ALPHA CHANGE 600 -- BulbWhale: optional 1:1 dest sizing when scaled sheet is used (META from AssetsLoading) --
        let src = this.image;

        // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (RAW fallback stays identical)
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "bulbwhale"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        //START ALPHA CHANGE 600a -- BulbWhale: sync gameplay collider to cached 1:1 draw size (once) --
                        if (!this._scaledColliderSynced600a) {
                            this.width  = destW;
                            this.height = destH;

                            //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                            const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                            const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                            const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                            const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                            this.colW  = Math.round(this.width  * sx666);
                            this.colH  = Math.round(this.height * sy666);
                            this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                            this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                            //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                            this._scaledColliderSynced600a = true;
                        }
                        //FINISH ALPHA CHANGE 600a -- BulbWhale: sync gameplay collider to cached 1:1 draw size (once) --
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing600b) this._warnedMetaMissing600b = new Set();
                            if (!this._warnedMetaMissing600b.has(scaledKey)) {
                                console.warn(`[BulbWhale] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing600b.add(scaledKey);
                            }
                        } catch (_) {}

                        // IMPORTANT: reset ALL geometry + dest (in case anything was already switched)
                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } // else: raw fallback stays legacy
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 600 -- BulbWhale: optional 1:1 dest sizing when scaled sheet is used --
            const idx = this.frameX | 0;                // 0..47 advanced by update()
            const col = idx % 7;                        // 0..6
            const row = (idx / 7) | 0;                  // 0..6  (TOP→BOTTOM)
            const sx = col * stride + offX;
            const sy = row * stride + offY;
            context.drawImage(
                src,
                sx, sy, srcW, srcH,   // source rect (crop 310×270)
                this.x, this.y, destW, destH   // dest rect (310×270 on-screen)
            );

            // Debug overlay (matches your global debug toggle)
            if (this.game && this.game.debug) {
                 // prefer tight collider when defined; otherwise fallback to legacy draw rect
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
                const dw = hasCol ? (this.colW | 0) : this.width;             
                const dh = hasCol ? (this.colH | 0) : this.height;            
                context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335

                //show current lives -- fixed to stick to the collider rectangle 
                //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
                context.save();
                context.textAlign = "left";
                context.textBaseline = "top";
                context.font = "20px Helvetica";
                context.fillStyle = "#ffffff";
                // place just above the collider; tweak -18 if you want tighter/looser spacing
                context.fillText(String(this.lives), dx, dy - 18);
                context.restore();
                //FINISH ALPHA CHANGE 441
            }
        }
        //FINISH ALPHA CHANGE 315 -- draw(): map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM --
    }//top→bottom row order and a loop that stops at Row 6, Col 5 (i.e., last linear frame = 47)

//START ALPHA CHANGE 324 -- MoonFish: 7x7 sheet (3584x3584), 410x300 crop, scaled to width 227, top→bottom, custom anim + debug --
    class MoonFish extends Enemy { // powerup enemy
    constructor(game){
        super(game);
        this.image = document.getElementById("moonfish");

        // 7×7 layout: 3584 / 7 = 512 stride per cell
        this._srcStride = 512;

        // Centered crop 320×300 inside each 512×512 cell:
        // offsets: x = (512 - 410)/2 = 51, y = (512 - 300)/2 = 106
        this._srcSizeW = 410;
        this._srcSizeH = 300;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 51 px
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 106 px

        // Scale to match legacy on-screen Moon width (old width = 227px) with the new 410-wide crop
        this.scale  = 0.5537;                       // ≈ 0.55 (227/410)
        this.width  = Math.round(this._srcSizeW * this.scale); // 227
        this.height = Math.round(this._srcSizeH * this.scale); // ≈ 166

        //START ALPHA CHANGE 602 -- MoonFish: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 602 -- MoonFish: keep ONLY normalized sheetScale --

        // Position (keep original random Y behavior)
        this.y = Math.random() * (this.game.height * 0.95 - this.height);

        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.58;  // legacy-equivalent of old colliderScale=0.7 (width)
        this.colliderScaleY = 0.4;  // legacy-equivalent of old colliderScale=0.7 (height)
        this.colliderOffsetX = -5;   // +right / -left (pixels)
        this.colliderOffsetY = 10;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --

        // Use all 49 frames in strict row-major order (TOP→BOTTOM)
        this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is the last)
        this.frameX = 0;              // start at Row0,Col0
        this.frameY = 0;              // not used; row derived in draw

        //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
        // Time-based animation fields (Shield-style)
        this.fps = 20;                          // target visual FPS for MoonFish
        this.interval = 1000 / this.fps;        // ms per frame
        this.timer = 0;                         // accumulated elapsed time
        //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

        // Gameplay (kept from original)
        this.lives = 5;
        this.score = 10; //puniamo pesantemente i giocatori non precisi 
        this.type = "moon";
        const raw = Math.random() * -1.2 - 2; // same as original
        this.speedX = Math.round(raw * 100) / 100;
    }

    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; // clear enemies

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --

    // Draw: map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM
    draw(context){
        //START ALPHA CHANGE 603 -- MoonFish: optional 1:1 dest sizing when scaled sheet is used (META from AssetsLoading) --
        let src = this.image;

        // Default: legacy raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior (RAW fallback stays identical)
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "moonfish"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        //START ALPHA CHANGE 603a -- MoonFish: sync gameplay collider to cached 1:1 draw size (once) --
                        if (!this._scaledColliderSynced603a) {
                            this.width  = destW;
                            this.height = destH;

                            //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                            const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                            const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                            const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                            const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                            this.colW  = Math.round(this.width  * sx666);
                            this.colH  = Math.round(this.height * sy666);
                            this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                            this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                            //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                            this._scaledColliderSynced603a = true;
                        }
                        //FINISH ALPHA CHANGE 603a -- MoonFish: sync gameplay collider to cached 1:1 draw size (once) --
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing603b) this._warnedMetaMissing603b = new Set();
                            if (!this._warnedMetaMissing603b.has(scaledKey)) {
                                console.warn(`[MoonFish] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing603b.add(scaledKey);
                            }
                        } catch (_) {}

                        // IMPORTANT: reset ALL geometry + dest (in case anything was already switched)
                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } // else: raw fallback stays legacy
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 603 -- MoonFish: optional 1:1 dest sizing when scaled sheet is used --

        const idx = this.frameX | 0;                // 0..48 advanced by update()
        const col = idx % 7;                        // 0..6
        const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM)
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            this.x, this.y, destW, destH
        );

        // Debug overlay (tied to global game.debug)
        if (this.game && this.game.debug) {
             const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
             const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
             const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
             const dw = hasCol ? (this.colW | 0) : this.width;             
             const dh = hasCol ? (this.colH | 0) : this.height;            
             context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335
            //show current lives -- fixed to stick to the collider rectangle 
            //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
            context.save();
            context.textAlign = "left";
            context.textBaseline = "top";
            context.font = "20px Helvetica";
            context.fillStyle = "#ffffff";
            // place just above the collider; tweak -18 if you want tighter/looser spacing
            context.fillText(String(this.lives), dx, dy - 18);
            context.restore();
            //FINISH ALPHA CHANGE 441
        }
    }
}
//FINISH ALPHA CHANGE 324 -- MoonFish swap complete --

    //START ALPHA CHANGE 307 -- switch to 7x7 sheet (3584x3584), 49 frames; bottom→top row order --
    class Stalker extends Enemy {  
        constructor(game){
            super(game);     
            this.image = document.getElementById("stalker");
            this._srcStride = 512;        // 3584 / 7 = 512 stride per cell

             // On-screen size via scale (tweak as desired)
            this.scale  = 0.9;                                      // tweak as desired (1.0 = original 350×350)
            this.width  = Math.round(350 * this.scale);             // on-screen (and collision) size
            this.height = Math.round(350 * this.scale);             // on-screen (and collision) size

            //START ALPHA CHANGE 604 -- Stalker: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
            this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
            //FINISH ALPHA CHANGE 604 -- Stalker: keep ONLY normalized sheetScale --
            
            // Position like original (random Y within safe band)
            this.y = Math.random() * (this.game.height * 0.95 - this.height);
            
            //Stalker uses a square crop (350×350). Because width == height, you can store a single size (_srcSize) 
            //and a single centered offset (_srcOffset)
            this._srcSize = 350;          // crop size to fully include the sprite
            this._srcOffset = (this._srcStride - this._srcSize) / 2; // 81 px offset for 350 crop centered in 512 cell

            //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
            //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
            this.colliderScaleX = 0.56;  // legacy-equivalent of old colliderScale=0.6 (width)
            this.colliderScaleY = 0.4;  // legacy-equivalent of old colliderScale=0.6 (height)
            this.colliderOffsetX = 0;   // +right / -left (pixels)
            this.colliderOffsetY = 18;   // +down  / -up   (pixels)

            this.colW  = Math.round(this.width  * this.colliderScaleX);
            this.colH  = Math.round(this.height * this.colliderScaleY);
            this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
            this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
            //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --
            
            //START ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --
            // Time-based animation fields (Shield-style)
            this.fps = 20;                          // target visual FPS for Stalker
            this.interval = 1000 / this.fps;        // ms per frame
            this.timer = 0;                         // accumulated elapsed time
            //FINISH ALPHA CHANGE 437 -- switch to time-based animation (refresh-independent) --

            // Linear index now spans 0..48 (7*7 - 1); start at frame 0 for deterministic loop
            this.maxFrame = 48;           // 49 frames total
            this.frameX = 0;              // fixed start at row 0, col 0 (logical index)
            this.frameY = 0;              // not used for animation (row derived in draw)
            this.lives = 10;              //numero di vite
            this.score = 7;              //numero di punto che assegna
            //START ALPHA CHANGE 311 -- per-enemy shield damage (shared shield uses this when body-colliding) --
            this.shieldDamage = 15;        // Stalker drains 15 shield on body collision (host logic reads this) -- you can also use this.lives -- if not set it will use the default 10 
            //FINISH ALPHA CHANGE 311
            this.type = "stalk";
            const raw = Math.random() * -1 - 1;
            this.speedX = Math.round(raw * 100) / 100;
            //FINISH ALPHA CHANGE 307 -- switch to 7x7 sheet (3584x3584), 49 frames; bottom→top row order --
           
        }
    //START ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; //clear enemies

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- make update(deltaTime) time-based like Shield --
    //START ALPHA CHANGE 307 -- draw(): map linear index -> (col,row) with 7 columns, 7 rows; rows 6→0 --
    draw(context){
    //START ALPHA CHANGE 604 -- Stalker: META-only scaled sampling (like Angler1) + optional 1:1 dest sizing --
    let src = this.image;

    // Default: raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
    let stride = this._srcStride;
    let offX   = this._srcOffset;
    let offY   = this._srcOffset;
    let srcW   = this._srcSize;
    let srcH   = this._srcSize;

    // Default DEST is legacy behavior (RAW fallback stays identical)
    let destW  = this.width;
    let destH  = this.height;

    try {
        const al = this.game && this.game.assetsLoading;
        const id = (this.image && this.image.id) ? this.image.id : null; // "stalker"
        if (al && id && typeof al.getCachedOrFallback === "function") {
            const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
            const cand = al.getCachedOrFallback(scaledKey, this.image);

            if (cand && cand !== this.image) {
                const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                if (meta) {
                    // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                    src    = cand;
                    stride = meta.stride;
                    offX   = meta.offX;
                    offY   = meta.offY;
                    srcW   = meta.srcW;
                    srcH   = meta.srcH;

                    // guaranteed 1:1 blit (no resample)
                    destW = srcW;
                    destH = srcH;

                    // Sync gameplay collider to cached 1:1 draw size (once)
                    if (!this._scaledColliderSynced596) {
                        this.width  = destW;
                        this.height = destH;

                        //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                        const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                        const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                        const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                        const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                        this.colW  = Math.round(this.width  * sx666);
                        this.colH  = Math.round(this.height * sy666);
                        this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                        this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                        //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --


                        this._scaledColliderSynced596 = true;
                    }
                } else {
                    // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                    try {
                        if (!this._warnedMetaMissing596) this._warnedMetaMissing596 = new Set();
                        if (!this._warnedMetaMissing596.has(scaledKey)) {
                            console.warn(`[Stalker] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                            this._warnedMetaMissing596.add(scaledKey);
                        }
                    } catch (_) {}

                    // IMPORTANT: reset everything back to RAW defaults
                    src    = this.image;
                    stride = this._srcStride;
                    offX   = this._srcOffset;
                    offY   = this._srcOffset;
                    srcW   = this._srcSize;
                    srcH   = this._srcSize;
                    destW  = this.width;
                    destH  = this.height;
                }
            } else {
                // Raw fallback path stays as legacy
                src = this.image;
            }
        }
    } catch (_) {}
    //FINISH ALPHA CHANGE 604 -- Stalker: META-only scaled sampling --

    const idx = this.frameX | 0;                // 0..48
    const col = idx % 7;                        // 0..6
    const row = 6 - ((idx / 7) | 0);            // 6..0 (bottom→top) KEEP AS-IS

    const sx = col * stride + offX;
    const sy = row * stride + offY;

    context.drawImage(
        src,
        sx, sy, srcW, srcH,
        this.x, this.y, destW, destH
    );
            // optional debug: // context.strokeRect; enables debug mode when this.debug = true
            //
            if (this.game && this.game.debug) {// prefer tight collider when defined; otherwise fallback to legacy draw rect
                const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number'); //START ALPHA CHANGE 335
                const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     
                const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
                const dw = hasCol ? (this.colW | 0) : this.width;             
                const dh = hasCol ? (this.colH | 0) : this.height;            
                context.strokeRect(dx, dy, dw, dh); //FINISH ALPHA CHANGE 335
                
                //show current lives -- fixed to stick to the collider rectangle 
                //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
                context.save();
                context.textAlign = "left";
                context.textBaseline = "top";
                context.font = "20px Helvetica";
                context.fillStyle = "#ffffff";
                // place just above the collider; tweak -18 if you want tighter/looser spacing
                context.fillText(String(this.lives), dx, dy - 18);
                context.restore();
                //FINISH ALPHA CHANGE 441
            }
            //FINISH ALPHA CHANGE 302
        }
        //FINISH ALPHA CHANGE 307 -- draw(): map linear index -> (col,row) with 7 columns, 7 rows; rows 6→0 --
    }

//START ALPHA CHANGE 327 -- Razorfin: 7x7 (3584x3584), 320x380 crop, scaling, TOP→BOTTOM, custom anim + debug --
    class Razorfin extends Enemy { 
    constructor(game){
        super(game);
        this.image = document.getElementById("razorfin");

        // 7×7 layout: 3584 / 7 = 512 stride per cell
        this._srcStride = 512;

        // Centered crop 320×380 inside each 512×512 cell:
        // offsets: x = (512 - 320)/2 = 96, y = (512 - 380)/2 = 66
        this._srcSizeW = 320;
        this._srcSizeH = 360;
        this._srcOffsetX = (this._srcStride - this._srcSizeW) / 2; // 96 px
        this._srcOffsetY = (this._srcStride - this._srcSizeH) / 2; // 66 px

        // On-screen size via scale (tweak as desired)
        this.scale  = 0.9;                                        
        this.width  = Math.round(this._srcSizeW * this.scale);    
        this.height = Math.round(this._srcSizeH * this.scale);
        
        //START ALPHA CHANGE 598 -- Razorfin: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 598 -- Razorfin: keep ONLY normalized sheetScale --

        // Position like original (random Y within safe band)
        this.y = Math.random() * (this.game.height * 0.95 - this.height);

        //Fantastico -- collisioni con X e y indipendenti e con offsets per il punto centrale -- 
        //START ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets (remove legacy colliderScale) --
        this.colliderScaleX = 0.8;  // legacy-equivalent of old colliderScale=0.8 (width)
        this.colliderScaleY = 0.4;  // legacy-equivalent of old colliderScale=0.8 (height)
        this.colliderOffsetX = 0;   // +right / -left (pixels)
        this.colliderOffsetY = 0;   // +down  / -up   (pixels)

        this.colW  = Math.round(this.width  * this.colliderScaleX);
        this.colH  = Math.round(this.height * this.colliderScaleY);
        this.colOX = Math.round((this.width  - this.colW) / 2) + (this.colliderOffsetX | 0);
        this.colOY = Math.round((this.height - this.colH) / 2) + (this.colliderOffsetY | 0);
        //FINISH ALPHA CHANGE 664 (ex ALPHA CHANGE 331) -- collider: split X/Y scale + optional offsets --



        // Use all 49 frames in strict row-major order (TOP→BOTTOM)
        this.maxFrame = 48;           // linear 0..48 (Row6,Col6 is last)
        this.frameX = 0;              // start at Row0,Col0
        this.frameY = 0;              // not used; row derived in draw

        //START ALPHA CHANGE 437 -- Razorfin: switch to time-based animation (refresh-independent) --
        // Time-based animation fields (Shield-style)
        this.fps = 20;                          // target visual FPS for Razorfin
        this.interval = 1000 / this.fps;        // ms per frame
        this.timer = 0;                         // accumulated elapsed time
        //FINISH ALPHA CHANGE 437 -- Razorfin: switch to time-based animation (refresh-independent) --

        // Gameplay (kept from original)
        this.lives = 12;
        this.score = 8;
        this.type = "razor";
        const raw = Math.random() * -1 - 1;
        this.speedX = Math.round(raw * 100) / 100;
    }

    //START ALPHA CHANGE 437 -- Razorfin: make update(deltaTime) time-based like Shield --
    update(deltaTime){
        // movement + cull (mirror base Enemy.update behavior)
        //START ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) -- frame rate independent -- calls this.motionFps in constructor
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // convert ms to "virtual frames" + fallback (if this.motionFps wasn’t set, pretend it’s 60)
        const vx = this.speedX - this.game.speed; // same tuning as before, now interpreted in pixels/second
        this.x += vx * deltaTime * motionScale;   // with motionFps = 60, total pixels/second match old 60fps behavior 
        //FINISH ALPHA CHANGE 444 -- dt-based movement using motionFps (refresh-independent) --
        if (this.x + this.width < 0) this.markedForDeletion = true; // clear enemy 

        // time-based frame advance using deltaTime (stable across 60/80/120/144 Hz)
        this.timer += deltaTime;
        if (this.timer > this.interval) {
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0; // 0..48 → 0
        }
    }
    //FINISH ALPHA CHANGE 437 -- Razorfin: make update(deltaTime) time-based like Shield --

    // Draw: map linear index -> (col,row) with 7 cols, 7 rows; TOP→BOTTOM
    draw(context){
        //START ALPHA CHANGE 605 -- Razorfin: META-only scaled sampling (like Angler1) + optional 1:1 dest sizing --
    let src = this.image;

    // Default: raw-sheet sampling + runtime scaling (raw srcW/srcH -> dest this.width/this.height)
    let stride = this._srcStride;
    let offX   = this._srcOffsetX;
    let offY   = this._srcOffsetY;
    let srcW   = this._srcSizeW;
    let srcH   = this._srcSizeH;

    // Default DEST is legacy behavior (RAW fallback stays identical)
    let destW  = this.width;
    let destH  = this.height;

    try {
        const al = this.game && this.game.assetsLoading;
        const id = (this.image && this.image.id) ? this.image.id : null; // "razorfin"
        if (al && id && typeof al.getCachedOrFallback === "function") {
            const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
            const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> returns raw <img>

            if (cand && cand !== this.image) {
                const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                if (meta) {
                    // Scaled-sheet path: 1:1 sampling using META (no per-enemy scaled math)
                    src    = cand;
                    stride = meta.stride;
                    offX   = meta.offX;
                    offY   = meta.offY;
                    srcW   = meta.srcW;
                    srcH   = meta.srcH;

                    // guaranteed 1:1 blit (no resample)
                    destW = srcW;
                    destH = srcH;

                    // Sync gameplay collider to cached 1:1 draw size (once)
                    if (!this._scaledColliderSynced598) {
                        this.width  = destW;
                        this.height = destH;

                        //START ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --
                        const sx666 = (typeof this.colliderScaleX === "number" && isFinite(this.colliderScaleX) && this.colliderScaleX > 0) ? this.colliderScaleX : 1;
                        const sy666 = (typeof this.colliderScaleY === "number" && isFinite(this.colliderScaleY) && this.colliderScaleY > 0) ? this.colliderScaleY : 1;
                        const ox666 = (typeof this.colliderOffsetX === "number" && isFinite(this.colliderOffsetX)) ? (this.colliderOffsetX | 0) : 0;
                        const oy666 = (typeof this.colliderOffsetY === "number" && isFinite(this.colliderOffsetY)) ? (this.colliderOffsetY | 0) : 0;

                        this.colW  = Math.round(this.width  * sx666);
                        this.colH  = Math.round(this.height * sy666);
                        this.colOX = Math.round((this.width  - this.colW) / 2) + ox666;
                        this.colOY = Math.round((this.height - this.colH) / 2) + oy666;
                        //FINISH ALPHA CHANGE 664 -- collider: resync using X/Y scales + offsets (cached 1:1) --

                    }
                } else {
                    // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                    try {
                        if (!this._warnedMetaMissing598) this._warnedMetaMissing598 = new Set();
                        if (!this._warnedMetaMissing598.has(scaledKey)) {
                            console.warn(`[Razorfin] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                            this._warnedMetaMissing598.add(scaledKey);
                        }
                    } catch (_) {}

                    // Reset everything back to RAW defaults
                    src    = this.image;
                    stride = this._srcStride;
                    offX   = this._srcOffsetX;
                    offY   = this._srcOffsetY;
                    srcW   = this._srcSizeW;
                    srcH   = this._srcSizeH;
                    destW  = this.width;
                    destH  = this.height;
                }
            } else {
                // Raw fallback path stays as legacy
                src = this.image;
            }
        }
    } catch (_) {}
    //FINISH ALPHA CHANGE 605 -- Razorfin: META-only scaled sampling --

    const idx = this.frameX | 0;                // 0..48
    const col = idx % 7;                        // 0..6
    const row = (idx / 7) | 0;                  // 0..6 (TOP→BOTTOM) KEEP AS-IS

    const sx = col * stride + offX;
    const sy = row * stride + offY;

    context.drawImage(
        src,
        sx, sy, srcW, srcH,
        this.x, this.y, destW, destH
    );

        // Debug overlay (tied to global game.debug)
        if (this.game && this.game.debug) {
            // prefer tight collider when defined; otherwise fallback to legacy draw rect
            const hasCol = (typeof this.colW === 'number' && typeof this.colH === 'number');
            const dx = hasCol ? (this.x + (this.colOX | 0)) : this.x;     //START ALPHA CHANGE 335
            const dy = hasCol ? (this.y + (this.colOY | 0)) : this.y;     
            const dw = hasCol ? (this.colW | 0) : this.width;             
            const dh = hasCol ? (this.colH | 0) : this.height;            
            context.strokeRect(dx, dy, dw, dh);                           //FINISH ALPHA CHANGE 335
            //show current lives -- fixed to stick to the collider rectangle 
            //START ALPHA CHANGE 441 -- debug label anchored to collider rect (no drift)
            context.save();
            context.textAlign = "left";
            context.textBaseline = "top";
            context.font = "20px Helvetica";
            context.fillStyle = "#ffffff";
            // place just above the collider; tweak -18 if you want tighter/looser spacing
            context.fillText(String(this.lives), dx, dy - 18);
            context.restore();
            //FINISH ALPHA CHANGE 441
        }
    }
}
//FINISH ALPHA CHANGE 327 -- Razorfin swap complete --

    class Layer {
        constructor(game, image, speedModifier){
            this.game = game;
            this.image = image;
            this.speedModifier = speedModifier;
            this.width = 1768;
            this.height = 500;
            this.x = 0;
            this.y = 0;
            this.motionFps = 60;

        }
        update(deltaTime){
            //START ALPHA CHANGE 448 -- Layer: dt-based parallax scroll using motionFps -- framerate independent 
            const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // ms → virtual frames
            //START ALPHA CHANGE 579 -- Layer: wrap WITHOUT losing overshoot (prevents long-run drift) --
            // Move first
            this.x -= this.game.speed * this.speedModifier * deltaTime * motionScale;

            // Wrap while preserving overshoot (dt can overshoot past -width)
            while (this.x <= -this.width) this.x += this.width;
            while (this.x > 0) this.x -= this.width; // optional safety if speed ever goes negative
            //FINISH ALPHA CHANGE 579 -- Layer: wrap WITHOUT losing overshoot (prevents long-run drift) --
            //FINISH ALPHA CHANGE 448 -- Layer: dt-based parallax scroll using motionFps --
        }
        draw(context){
            //START ALPHA CHANGE 501 -- Background layers: prefer cached decoded ImageBitmap to avoid first-draw decode hitch --
            let src = this.image;
            try {
                const al = this.game && this.game.assetsLoading;
                const id = (this.image && this.image.id) ? this.image.id : null; // "layer1".."layer4"
                if (al && id && typeof al.getCachedOrFallback === "function") {
                    src = al.getCachedOrFallback(`img:${id}`, this.image);
                }
            } catch (_) {}
            context.drawImage(src, this.x, this.y);
            context.drawImage(src, this.x + this.width, this.y); 
            //if AssetsLoading cached ImageBitmap under key img:layer1/2/3/4 exists src becomes that cached bitmap else src stays as the original <img> (fallback)
            //FINISH ALPHA CHANGE 501 -- Background layers: prefer cached decoded ImageBitmap to avoid first-draw decode hitch --
        }
    }

//START ALPHA CHANGE 555 -- AnimatedBackground: scaffold (draw between layer2 and layer3) --
class AnimatedBackground {
    constructor(game, anchorLayer){ // we also pass anchorLayer from layer3 and we don't need this.motionFps here 
        this.game = game;
        this.anchorLayer = anchorLayer || null; // Background passes layer3 here
        //START ALPHA CHANGE 559 -- AnimatedBackground: dt-based motion controls (match layer3) --
        this.motionFps = 60; // reference FPS (same pattern as Layer/Enemy motionScale)
        this.speedModifier = (this.anchorLayer && typeof this.anchorLayer.speedModifier === 'number') ? this.anchorLayer.speedModifier : 2; // match layer3 by default
        //FINISH ALPHA CHANGE 559 -- AnimatedBackground: dt-based motion controls (match layer3) --
        this.speedFactor = 0.9; // 1.0 = identical to layer3; 0.9 = 10% slower (farther); 1.1 = 10% faster (closer) -- ALPHA CHANGE 562  
        this.items = []; 
        this.spacingPx = 420;         // even spacing along X; tweak later
        this.defaultLampY = Math.round(this.game.height * 0.30); // tweak later
        this.defaultPipeY = Math.round(this.game.height * 0.30); // tweak later
        this._lampBag = [];
        this._pipeBag = [];
        this._initEvenSlots();
    }

    //START ALPHA CHANGE 556 -- AnimatedBackground: shuffle-bag picker (cycles through all) --
    _shuffleInPlace(arr){
        for (let i = arr.length - 1; i > 0; i--){
            const j = (Math.random() * (i + 1)) | 0;
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }
    _pickLampKey(){
        if (!this._lampBag || this._lampBag.length === 0){//comment out the "lamp" items you don't want to display for debug tweaks
            this._lampBag = this._shuffleInPlace([
                "lamp1",
                "lamp2",
                "lamp3",
                "lamp4",
                "lamp5",
                "lamp6",
                "lamp7",
                "lamp8",
                "lamp9",
                "lamp10",
                "lamp11",
                "lamp12",
                "lamp13",
                "lamp14"
            ]);
        }
        return this._lampBag.pop();
    }
    _pickPipeKey(){
        if (!this._pipeBag || this._pipeBag.length === 0){//comment out the "pipe" items you don't want to display for debug tweaks
            this._pipeBag = this._shuffleInPlace([
                "pipe1",
                "pipe2",
                "pipe3",
                "pipe4",
                "pipe5",
                "pipe6",
                "pipe7",
                "pipe8",
                "pipe9",
                "pipe10",
                "pipe11",
                "pipe12",
                "pipe13",
                "pipe14",
                "pipe15"
            ]);
        }
        return this._pipeBag.pop();
    }
    _makeItemByKey(key){
        switch (key){
            case "lamp1": return new Lamp1(this.game);
            case "lamp2": return new Lamp2(this.game);
            case "lamp3": return new Lamp3(this.game);
            case "lamp4": return new Lamp4(this.game);
            case "lamp5": return new Lamp5(this.game);
            case "lamp6": return new Lamp6(this.game);
            case "lamp7": return new Lamp7(this.game);
            case "lamp8": return new Lamp8(this.game);
            case "lamp9": return new Lamp9(this.game);
            case "lamp10": return new Lamp10(this.game);
            case "lamp11": return new Lamp11(this.game);
            case "lamp12": return new Lamp12(this.game);
            case "lamp13": return new Lamp13(this.game);
            case "lamp14": return new Lamp14(this.game);
            case "pipe1": return new Pipe1(this.game);
            case "pipe2": return new Pipe2(this.game);
            case "pipe3": return new Pipe3(this.game);
            case "pipe4": return new Pipe4(this.game);
            case "pipe5": return new Pipe5(this.game);
            case "pipe6": return new Pipe6(this.game);
            case "pipe7": return new Pipe7(this.game);
            case "pipe8": return new Pipe8(this.game);
            case "pipe9": return new Pipe9(this.game);
            case "pipe10": return new Pipe10(this.game);
            case "pipe11": return new Pipe11(this.game);
            case "pipe12": return new Pipe12(this.game);
            case "pipe13": return new Pipe13(this.game);
            case "pipe14": return new Pipe14(this.game);
            case "pipe15": return new Pipe15(this.game);
            default: return null;
        }
    }
    _initEvenSlots(){
        const w = (this.game && typeof this.game.width === 'number') ? this.game.width : 1280;
        const count = Math.max(6, Math.ceil((w + this.spacingPx) / this.spacingPx));
        this.items.length = 0;

        for (let i = 0; i < count; i++){
            const isLampSlot = (i % 2 === 0); // lamp -> pipe -> lamp -> pipe
            const key = isLampSlot ? this._pickLampKey() : this._pickPipeKey();
            const it = this._makeItemByKey(key);
            if (!it) continue;
            //START ALPHA CHANGE 562 -- AnimatedBackground: make initial spacing width-aware (match recycle spacing) --
            if (i === 0) this._cursorX = 0; // reset cursor at start of init
            it.x = this._cursorX; // world X; we integrate x with dx in update()

            // advance cursor using the same “right edge + spacingPx” idea used by recycle
            this._cursorX += (it.width || 0) + this.spacingPx;
            //FINISH ALPHA CHANGE 562 -- AnimatedBackground: make initial spacing width-aware (match recycle spacing) --
            it.y = (isLampSlot ? this.defaultLampY : this.defaultPipeY) + (it.offsetY || 0); //ALPHA CHANGE 558 -- apply per-item offsetY for ground alignment --
            this.items.push(it);
        }
    }
    //FINISH ALPHA CHANGE 556 -- AnimatedBackground: shuffle-bag picker (cycles through all) --

    update(deltaTime){
         //START ALPHA CHANGE 559 -- AnimatedBackground: dt-based motion (motionFps) + recycle via x --
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000;
        const baseSpeed = (this.game && typeof this.game.speed === 'number') ? this.game.speed : 1;
        //START ALPHA CHANGE 562 -- AnimatedBackground: apply speedFactor -- setta come vuoi la levocità di AnimatedBackground rispetto a layer 3 per effetto parallax 
        const sf = (typeof this.speedFactor === 'number') ? this.speedFactor : 1.0;
        const vx = baseSpeed * ((typeof this.speedModifier === 'number') ? this.speedModifier : 1) * sf;
        //FINISH ALPHA CHANGE 562 -- AnimatedBackground: apply speedFactor --
        const dx = vx * ((typeof deltaTime === 'number') ? deltaTime : 0) * motionScale;

        // 1) move + animate
        let rightMostX = -Infinity;
        for (let i = 0; i < this.items.length; i++){
            const it = this.items[i];
            if (!it) continue;

            it.x -= dx;

            // lamps animate via their own update(deltaTime); pipes may no-op
            if (typeof it.update === 'function') it.update(deltaTime);

            const rx = it.x + (it.offsetX || 0) + (it.width || 0);
            if (rx > rightMostX) rightMostX = rx;
        }

        // 2) recycle to the right when fully off-screen LEFT
        for (let i = 0; i < this.items.length; i++){
            const it = this.items[i];
            if (!it) continue;

            const offLeft = (it.x + (it.offsetX || 0) + (it.width || 0)) < 0;
            if (offLeft){
                const wasLamp = (it && typeof it.type === 'string' && it.type.startsWith("lamp"));
                const nextKey = wasLamp ? this._pickLampKey() : this._pickPipeKey();
                const fresh = this._makeItemByKey(nextKey);

                if (fresh){
                    fresh.x = rightMostX + this.spacingPx; // spawn to the right
                    fresh.y = (wasLamp ? this.defaultLampY : this.defaultPipeY) + (fresh.offsetY || 0); // keep per-item Y tweak
                    this.items[i] = fresh;

                    rightMostX = fresh.x + (fresh.offsetX || 0) + (fresh.width || 0);
                } else {
                    // safe fallback reuse
                    it.x = rightMostX + this.spacingPx;
                    rightMostX = it.x + (it.offsetX || 0) + (it.width || 0);
                }
            }
        }
        //FINISH ALPHA CHANGE 559 -- AnimatedBackground: dt-based motion (motionFps) + recycle via x --
        // Optional cleanup (safe even when empty)
        this.items = this.items.filter(it => it && !it.markedForDeletion);
    }

    draw(context){
       //START ALPHA CHANGE 561 -- AnimatedBackground: draw pipes first, then lamps (lamps on top) --
    // Pass 1: pipes
    for (let i = 0; i < this.items.length; i++){
        const it = this.items[i];
        if (!it || typeof it.draw !== 'function') continue;
        const isLamp = (it && typeof it.type === "string" && it.type.startsWith("lamp"));
        if (isLamp) continue;

        const oldX = it.x;
        it.x = oldX + (it.offsetX || 0);
        it.draw(context);
        it.x = oldX;
    }

    // Pass 2: lamps
    for (let i = 0; i < this.items.length; i++){
        const it = this.items[i];
        if (!it || typeof it.draw !== 'function') continue;
        const isLamp = (it && typeof it.type === "string" && it.type.startsWith("lamp"));
        if (!isLamp) continue;

        const oldX = it.x;
        it.x = oldX + (it.offsetX || 0);
        it.draw(context);
        it.x = oldX;
    }
    //FINISH ALPHA CHANGE 561 -- AnimatedBackground: draw pipes first, then lamps (lamps on top) --
    }
}
//FINISH ALPHA CHANGE 555 -- AnimatedBackground: scaffold (draw between layer2 and layer3) --

//START ALPHA CHANGE 556 -- AnimatedBackground items: base + Lamp1..7 + Pipe1..7 (enemy-style subclasses) --
class AnimatedBgItem {
    constructor(game){
        this.game = game;
        this.x = 0;
        this.y = 0;
        this.offsetX = 0; // applied in AnimatedBackground.draw() to anchored X
        this.offsetY = 0; // applied at spawn/recycle to defaultLampY/defaultPipeY
        this.markedForDeletion = false;
        this.frameX = 0;         // safe default (lamps use it, pipes ignore it)
        this.motionFps = 60;     // motion calibration knob (matches Enemy base style)
        // Note: no fps/interval/timer here; subclasses own animation tuning.
    }
    update(deltaTime){}
    draw(context){}
    //Base no-op fallback: guarantees every AnimatedBgItem has update() and draw()
    //If a subclass forgets to override update/draw, the main loop won’t crash with
}

// Animated lamp base: shared 7×7 TOP→BOTTOM draw and dt-based frame stepping.
// Subclasses MUST define: this.image, this._srcStride, this.scale, this.width/height,
// plus their own: this.fps, this.interval, this.timer, this.maxFrame.
class AnimatedBgLampBase extends AnimatedBgItem {
    constructor(game){
        super(game);
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this._srcSizeW = 0;
        this._srcSizeH = 0;
    }
    update(deltaTime){
        //START ALPHA CHANGE 556 -- lamp time-based animation (fields live in subclasses) --
        if (typeof this.timer === 'number' && typeof this.interval === 'number' && typeof this.maxFrame === 'number') {
            this.timer += deltaTime;
            if (this.timer > this.interval) {
                this.timer = 0;
                this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
            }
        }
        //FINISH ALPHA CHANGE 556 -- lamp time-based animation (fields live in subclasses) --
    }
    draw(context){
        //START ALPHA CHANGE 556 -- lamp draw: 7×7 TOP→BOTTOM, no crop --
        //START ALPHA CHANGE 611 -- AnimatedBgLampBase: Angler1-standard fallback (raw <img> only), scaled sheet optional w/ META --
    let src = this.image;

    // Default: raw-sheet sampling + runtime scaling fallback
    let strideX = (typeof this._srcStrideX === "number") ? this._srcStrideX : this._srcStride;
    let strideY = (typeof this._srcStrideY === "number") ? this._srcStrideY : this._srcStride;

    let offX = (this._srcOffsetX | 0);
    let offY = (this._srcOffsetY | 0);

    let srcW = this._srcSizeW;
    let srcH = this._srcSizeH;

    // Default DEST is legacy behavior (RAW fallback stays identical)
    let destW = this.width;
    let destH = this.height;

    try {
        const al = this.game && this.game.assetsLoading;
        const id = (this.image && this.image.id) ? this.image.id : null;
        if (al && id && typeof al.getCachedOrFallback === "function") {

            // Try scaled-sheet ONLY (no attempt to use img:${id} cache — avoids double-store assumptions + avoids fallback warn spam)
            const s = (typeof this.scale === "number" && isFinite(this.scale)) ? (Math.round(this.scale * 10000) / 10000) : null;
            const isSquare = (strideX > 0 && strideY > 0 && strideX === strideY);

            const scaledKey = (s && strideX > 0 && strideY > 0)
                ? (isSquare
                    ? `img:${id}:sheetScaled:${s}:stride:${strideX}`
                    : `img:${id}:sheetScaled:${s}:stride:${strideX}x${strideY}`)
                : null;

            if (scaledKey) {
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> returns raw <img> (Angler1 behavior)

                if (cand && cand !== this.image) {
                    const meta = (typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    if (meta) {
                        src = cand;

                        // META can be legacy stride OR strideX/strideY
                        const mStrideX = (typeof meta.strideX === "number") ? meta.strideX : meta.stride;
                        const mStrideY = (typeof meta.strideY === "number") ? meta.strideY : meta.stride;

                        strideX = mStrideX;
                        strideY = mStrideY;

                        offX = meta.offX | 0;
                        offY = meta.offY | 0;

                        srcW = meta.srcW;
                        srcH = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep draw size consistent after scaled sheet kicks in
                        if (!this._scaledSizeSynced604) {
                            this.width = destW;
                            this.height = destH;
                            this._scaledSizeSynced604 = true;
                        }
                    } else {
                        // META missing -> force RAW fallback exactly like Angler1 (optional warning pattern if you want)
                        src = this.image;
                    }
                } else {
                    // scaledKey missing from cache -> RAW fallback (<img>) exactly like Angler1
                    src = this.image;
                }
            }
        }
    } catch (_) {}

    const idx = this.frameX | 0;
    const col = idx % 7;
    const row = (idx / 7) | 0;

    const sx = col * strideX + offX;
    const sy = row * strideY + offY;

    context.drawImage(
        src,
        sx, sy, srcW, srcH,
        this.x, this.y, destW, destH
    );
    //FINISH ALPHA CHANGE 611 -- AnimatedBgLampBase: Angler1-standard fallback --
        //FINISH ALPHA CHANGE 556 -- lamp draw: 7×7 TOP→BOTTOM, no crop --
    }
}
//Single class instances must match the hardcoded scale and stride values in "scaledSheetOnly"
class Lamp1 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp1");
        //START ALPHA CHANGE 560 -- Lamp1: square 7x7 sheet (4480x4480) --
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        //FINISH ALPHA CHANGE 560 -- Lamp1: square 7x7 sheet (4480x4480) --
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp1";
        this.offsetY = -188; //tweak spawn y position (+ value move it down; - value move it up) (for scale 0.8 use -80, for scale 1.0 use -188)
        //this.offsetX = 18; optional, tweak X spawning position (negative = left, positive = right)
    }
}
class Lamp2 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp2");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp2";
        this.offsetY = -150; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Lamp3 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp3");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp3";
        this.offsetY = -180; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Lamp4 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp4");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp4";
        this.offsetY = -175; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Lamp5 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp5");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp5";
        this.offsetY = -140; //tweak spawn y position (+ value move it down; - value move it up) -- scale 0.8->Y=-50, scale 1.0->y=-140
    }
}
class Lamp6 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp6");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp6";
        this.offsetY = -80; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Lamp7 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp7");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp7";
        this.offsetY = -100; //tweak spawn y position (+ value move it down; - value move it up) default -60 
    }
}

class Lamp8 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp8");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp8";
        this.offsetY = -120; //tweak spawn y position (+ value move it down; - value move it up -- -25 per 0.8, -120 per 1) 
    }
}

class Lamp9 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp9");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp9";
        this.offsetY = -130; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}

class Lamp10 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp10");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 0.8;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp10";
        this.offsetY = -70; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}

class Lamp11 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp11");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 0.8;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp11";
        this.offsetY = -70; //tweak spawn y position (+ value move it down; - value move it up -- -70 for 0.8 scale) 
    }
}

class Lamp12 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp12");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 0.8;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp12";
        this.offsetY = -90; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}

class Lamp13 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp13");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 0.8;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp13";
        this.offsetY = 0; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}

class Lamp14 extends AnimatedBgLampBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("lamp14");
        this._srcStride = 640; // 4480 / 7
        this._srcSizeW = this._srcStride;
        this._srcSizeH = this._srcStride;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;
        this.scale = 1;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;
        this.type = "lamp14";
        this.offsetY = -150; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}

// Static pipes base (subclasses own scale/size)
class AnimatedBgPipeBase extends AnimatedBgItem {
    constructor(game){
        super(game);
        this.scale = 1;
        this.width = 0;
        this.height = 0;
    }
    draw(context){
       //START ALPHA CHANGE 634 -- pipe draw: prefer pre-scaled cached bitmap (1:1 blit) --
        let src = this.image;
        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null;

            if (al && id) {
                const w = Math.max(1, Math.round(this.width  || 1));
                const h = Math.max(1, Math.round(this.height || 1));
                const scaledKey = `img:${id}:scaled:${w}x${h}`;

                // silent peek (no fallback log spam)
                const scaled = (typeof al.getCachedIfValid === "function") ? al.getCachedIfValid(scaledKey) : null;
                if (scaled) {
                    src = scaled;
                    context.drawImage(src, this.x, this.y); // 1:1 blit (already scaled)
                    return;
                }

                // fallback to normal decoded bitmap (or <img>)
                if (typeof al.getCachedOrFallback === "function") {
                    src = al.getCachedOrFallback(`img:${id}`, this.image);
                }
            }
        } catch (_) {}
        context.drawImage(src, this.x, this.y, this.width, this.height);
        //FINISH ALPHA CHANGE 634 -- pipe draw: prefer pre-scaled cached bitmap (1:1 blit) --
    }
}

class Pipe1 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe1");
        // Use known source size (no naturalWidth dependency)
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe1";
        this.offsetY = -150; //tweak spawn y position (+ value move it down; - value move it up -- -10 per 0.6, -150 per 0.8) 
    }
}
class Pipe2 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe2");
        // Use known source size (no naturalWidth dependency)
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe2";
        this.offsetY = -160; //tweak spawn y position (+ value move it down; - value move it up -- -8 per 0.6, -160 per 0.8) 
    }
}
class Pipe3 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe3");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe3";
        this.offsetY = -200; //tweak spawn y position (+ value move it down; - value move it up -- -60 per 0.6, -160 per 0.8) 
    }
}
class Pipe4 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe4");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe4";
        this.offsetY = -215; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe5 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe5");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe5";
        this.offsetY = -160; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe6 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe6");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe6";
        this.offsetY = -180; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe7 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe7");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe7";
        this.offsetY = -180; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe8 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe8");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.9;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe8";
        this.offsetY = -220; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe9 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe9");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.9;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe9";
        this.offsetY = -220; //tweak spawn y position (-190 per 0.8, -220 per 0.9) 
    }
}
class Pipe10 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe10");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe10";
        this.offsetY = -190; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe11 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe11");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe11";
        this.offsetY = -190; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe12 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe12");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe12";
        this.offsetY = -170; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe13 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe13");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe13";
        this.offsetY = -190; //tweak spawn y position (+ value move it down; - value move it up) 
    }

}
class Pipe14 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe14");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe14";
        this.offsetY = -190; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
class Pipe15 extends AnimatedBgPipeBase {
    constructor(game){
        super(game);
        this.image = document.getElementById("pipe15");
        const SRC_W = 768;   // <-- real pixel width 
        const SRC_H = 768;    // <-- real pixel height 
        this.scale = 0.8;
        this.width = Math.round(SRC_W * this.scale);
        this.height = Math.round(SRC_H * this.scale);
        this.type = "pipe15";
        this.offsetY = -190; //tweak spawn y position (+ value move it down; - value move it up) 
    }
}
//FINISH ALPHA CHANGE 556 -- AnimatedBackground items: base + Lamp1..7 + Pipe1..7 (enemy-style subclasses) --

//START ALPHA CHANGE 563 -- FlyingTrain: visual-only parallax entity (between layer2 and AnimatedBackground) --
class FlyingTrain {
    constructor(game, x, y, speed, dir, flipX){ //support BOTH directions + optional mirror -- ALPHA CHANGE 564 -- trains will move with dir controlling direction and flipX controlling mirroring
        this.game = game;
        this.x = x;
        this.y = y;

        this.image = document.getElementById("train");

        // 7×7 layout: 3584 / 7 = 512 stride per cell (no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        // scale 1.0 as requested (tweak later if needed)
        this.scale = 1.0;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 612 -- FlyingTrain: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 612 -- FlyingTrain: keep ONLY normalized sheetScale --

        // animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // dt-based motion (same pattern as your other entities)
        this.motionFps = 60;
        this.speed = (typeof speed === "number") ? Math.abs(speed) : 0;//ALPHA CHANGE 567: store speed as magnitude; dir controls sign -- update() line using this.speed * this.dir is correct

        //START ALPHA CHANGE 647 -- FlyingTrain: base drift depth between layer2 and layer3 (mid) --
        this.driftModifier = 1.5; // layer2=1.0, layer3=2.0 -> exact mid (tweak later)
        //FINISH ALPHA CHANGE 647 -- FlyingTrain: base drift depth between layer2 and layer3 (mid) --

        // Direction: -1 = right->left (default), +1 = left->right -- ALPHA CHANGE 564
        this.dir = (dir === 1 || dir === -1) ? dir : -1;

        // Optional draw-time mirror (independent from animation order) -- ALPHA CHANGE 564
        this.flipX = !!flipX;

        this.markedForDeletion = false;
    }

    update(deltaTime){
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000;
        
        //START ALPHA CHANGE 648 -- FlyingTrain: apply base parallax drift (camera) + local dir motion --
        const driftMod = (typeof this.driftModifier === "number") ? this.driftModifier : 1.5; // mid by default
        const driftLeft = (this.game && typeof this.game.speed === "number") ? (this.game.speed * driftMod) : 0;
        this.x += ((this.speed * this.dir) - driftLeft) * deltaTime * motionScale;
        //FINISH ALPHA CHANGE 648 -- FlyingTrain: apply base parallax drift (camera) + local dir motion --

        //START ALPHA CHANGE 564 -- FlyingTrain: cull based on direction --
        const w = (this.game && typeof this.game.width === 'number') ? this.game.width : 1280;
        if (this.dir < 0) {
            if (this.x + this.width < 0) this.markedForDeletion = true;   // exiting LEFT
        } else {
            if (this.x > w) this.markedForDeletion = true;                // exiting RIGHT
        }
        //FINISH ALPHA CHANGE 564 -- FlyingTrain: cull based on direction --

        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
        //START ALPHA CHANGE 612 -- FlyingTrain: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "train"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> logs once and returns raw <img>

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep visual geometry synced (important for flipX translate)
                        if (!this._scaledSizeSynced612) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced612 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> force RAW fallback + warn once
                        try {
                            if (!this._warnedMetaMissing612) this._warnedMetaMissing612 = new Set();
                            if (!this._warnedMetaMissing612.has(scaledKey)) {
                                console.warn(`[FlyingTrain] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing612.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    // RAW fallback path stays as legacy
                    src = this.image;
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        // Optional mirror at draw-time (use destW to avoid any drift)
        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 612 -- FlyingTrain: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}

class FlyingTrainSpawner {
    constructor(game){
        this.game = game;
        this.trains = [];

        // dt motion tuning
        this.motionFps = 60;

        // Spawn controls (tweak freely)
        this.maxTrains = 3;
        this.spawnTimer = 0;
        this.spawnIntervalMs = 4500; // average delay between spawns

        // Y range (train flies behind AnimatedBackground, above layer2)
        this.minY = Math.round(this.game.height * 0.05);
        this.maxY = Math.round(this.game.height * 0.35);

        // Speed: based on game.speed, with your own factor
        this.speedFactor = 1.0;    // set <1 to slow down, >1 to speed up (easy “depth” knob)

        // Seed a couple immediately so you see it right away
        this._spawnBurst(2);
    }

    _rand(min, max){
        return min + Math.random() * (max - min);
    }

    _calcSpeed(){ //FlyingTrainSpawner: enemy-style speedX (negative = left) --
       const base = 10; // main knob (like enemy "raw" magnitude). Try 4.0 / 6.0 if you want faster.
        const sf = (typeof this.speedFactor === 'number') ? this.speedFactor : 1;
        const jitter = this._rand(0.85, 1.15);

        return (base * sf * jitter);// ALPHA CHANGE 568: return magnitude only (no undefined vars) -- baseSpeed/sm defined
    }

    _spawnOne(xPad){
        const w = (this.game && typeof this.game.width === 'number') ? this.game.width : 1280;
        const y = Math.round(this._rand(this.minY, Math.max(this.minY, this.maxY)));

    //START ALPHA CHANGE 564 -- FlyingTrainSpawner: spawn trains in BOTH directions --
    // Chance a train goes left->right (set 0.0..1.0)
    const leftToRightChance = 0.5; // tweak freely (0.3 = mostly right->left)
    const dir = (Math.random() < leftToRightChance) ? 1 : -1;

    // Optional: mirror ONLY when moving left->right, so it "faces" its travel direction
    const flipX = (dir > 0);

    // Create train first so we know its width, then place it off-screen on the correct side
    const t = new FlyingTrain(this.game, 0, y, this._calcSpeed(), dir, flipX);
    t.motionFps = this.motionFps;

    const pad = ((typeof xPad === "number") ? xPad : 0); //ALPHA CHANGE 566 -- fix undefined pad (normalize xPad) --

    t.x = (dir < 0) ? (w + pad) : (-t.width - pad);

    this.trains.push(t);
    //FINISH ALPHA CHANGE 564 -- FlyingTrainSpawner: spawn trains in BOTH directions --
    }

    _spawnBurst(n){
        const count = Math.max(1, n | 0);
        for (let i = 0; i < count && this.trains.length < this.maxTrains; i++){
            // stagger within the burst so they’re not stacked
            this._spawnOne(i * 420);
        }
    }

    update(deltaTime){
        // update existing
        for (let i = 0; i < this.trains.length; i++){
            const t = this.trains[i];
            if (!t) continue;
            t.update(deltaTime);
        }
        this.trains = this.trains.filter(t => t && !t.markedForDeletion);

        // spawn timer
        this.spawnTimer += deltaTime;
        if (this.spawnTimer > this.spawnIntervalMs){
            this.spawnTimer = 0;

            // sometimes spawn 2, usually 1
            const burst = (Math.random() < 0.25) ? 2 : 1;
            if (this.trains.length < this.maxTrains) this._spawnBurst(burst);
        }
    }

    draw(context){
        for (let i = 0; i < this.trains.length; i++){
            const t = this.trains[i];
            if (!t) continue;
            t.draw(context);
        }
    }
}
//FINISH ALPHA CHANGE 563 -- FlyingTrain: visual-only parallax entity (between layer2 and AnimatedBackground) --

//START ALPHA CHANGE 639 -- BackgroundShip: visual-only parallax entity (between layer1 and layer2) --
class BackgroundShip {
    constructor(game, x, y, speed, dir, flipX){ // same contract as FlyingTrain
        this.game = game;
        this.x = x;
        this.y = y;

        this.image = document.getElementById("background_ship");

        // 7×7 layout: 3584 / 7 = 512 stride per cell (no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        // initial ship scale (tweak later)
        this.scale = 0.2;
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        // Keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading)
        this._sheetScale = Math.round(this.scale * 10000) / 10000;

        // animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // dt-based motion
        this.motionFps = 60;
        this.speed = (typeof speed === "number") ? Math.abs(speed) : 0;

        //START ALPHA CHANGE 645 -- BackgroundShip: base drift depth between layer1 and layer2 --
        this.driftModifier = 1.0; // 0.3≈layer1, 1.0≈layer2 (piu alto piu realistico --> "1.0") IMPORTANTE compensa lo sclolling in avanti sottaendolo alla velocità
        //the ship is drawn right around where layer2’s features are, so your eye naturally tracks layer2’s movement when judging whether the ship is “moving with the world”
        //with driftModifier = 1.0, that bias becomes: game.speed * (1-1.0)= 0 -- That reads as correct to your eyes, because it stops the ship from “creeping” relative 
        //to the layer you’re subconsciously anchored to (layer2) -- TL;DR: anchor to Layer2 speed 
        //FINISH ALPHA CHANGE 645 -- BackgroundShip: base drift depth between layer1 and layer2 --


        // Direction: -1 = right->left (default), +1 = left->right
        this.dir = (dir === 1 || dir === -1) ? dir : -1;

        // Optional draw-time mirror (independent from animation order)
        this.flipX = !!flipX;

        this.markedForDeletion = false;
    }

    update(deltaTime){
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000;

        //START ALPHA CHANGE 646 -- BackgroundShip: apply base parallax drift (camera) + local dir motion --
        const driftMod = (typeof this.driftModifier === "number") ? this.driftModifier : 0.65;
        const driftLeft = (this.game && typeof this.game.speed === "number") ? (this.game.speed * driftMod) : 0;
        this.x += ((this.speed * this.dir) - driftLeft) * deltaTime * motionScale;
        //FINISH ALPHA CHANGE 646 -- BackgroundShip: apply base parallax drift (camera) + local dir motion --


        const w = (this.game && typeof this.game.width === 'number') ? this.game.width : 1280;
        if (this.dir < 0) {
            if (this.x + this.width < 0) this.markedForDeletion = true;   // exiting LEFT
        } else {
            if (this.x > w) this.markedForDeletion = true;                // exiting RIGHT
        }

        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
        // Prefer cached sheetScaled bitmap + META (same pattern as FlyingTrain)
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "background_ship"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep visual geometry synced (important for flipX translate)
                        if (!this._scaledSizeSynced639) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced639 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> force RAW fallback + warn once
                        try {
                            if (!this._warnedMetaMissing639) this._warnedMetaMissing639 = new Set();
                            if (!this._warnedMetaMissing639.has(scaledKey)) {
                                console.warn(`[BackgroundShip] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing639.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    src = this.image; // RAW fallback
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
    }
}

class BackgroundShipSpawner {
    constructor(game){
        this.game = game;
        this.ships = [];

        // dt motion tuning
        this.motionFps = 60;

        // Spawn controls
        this.maxShips = 3;
        this.spawnTimer = 0;
        this.spawnIntervalMs = 4500;

        // Y range (ship sits between layer1 and layer2)
        this.minY = Math.round(this.game.height * 0.02);
        this.maxY = Math.round(this.game.height * 0.15);

        this.speedFactor = 0.3;

        // Seed one so you see it immediately
        this._spawnBurst(1);
    }

    _rand(min, max){
        return min + Math.random() * (max - min);
    }

    _calcSpeed(){
        const base = 8;
        const sf = (typeof this.speedFactor === 'number') ? this.speedFactor : 1;
        const jitter = this._rand(0.98, 1.02); // "this._rand(0.99, 1.01);" varianza velocità -- ± variance (+ veloce + lento): 0.95, 1.05 (±5%)/low variance: 0.98, 1.02 (±2%)
        return (base * sf * jitter);           //only 2% slower-or-equal speeds: 0.98, 1.00/2% to 4% slower than base (0.96, 0.98)/ metti solo 1 al posto di "this._rand(0.99, 1.01);" no varianza 
    }

    _spawnOne(xPad){
        const w = (this.game && typeof this.game.width === 'number') ? this.game.width : 1280;
        const y = Math.round(this._rand(this.minY, Math.max(this.minY, this.maxY)));

        const leftToRightChance = 0.5;
        const dir = (Math.random() < leftToRightChance) ? 1 : -1;

        // Mirror when moving left->right so it "faces" travel direction
        const flipX = (dir > 0);

        const s = new BackgroundShip(this.game, 0, y, this._calcSpeed(), dir, flipX);
        s.motionFps = this.motionFps;

        const pad = ((typeof xPad === "number") ? xPad : 0);

        s.x = (dir < 0) ? (w + pad) : (-s.width - pad);

        this.ships.push(s);
    }

    _spawnBurst(n){
        const count = Math.max(1, n | 0);
        for (let i = 0; i < count && this.ships.length < this.maxShips; i++){
            this._spawnOne(i * 420);
        }
    }

    update(deltaTime){
        for (let i = 0; i < this.ships.length; i++){
            const s = this.ships[i];
            if (!s) continue;
            s.update(deltaTime);
        }
        this.ships = this.ships.filter(s => s && !s.markedForDeletion);

        this.spawnTimer += deltaTime;
        if (this.spawnTimer > this.spawnIntervalMs){
            this.spawnTimer = 0;
            const burst = (Math.random() < 0.20) ? 2 : 1;
            if (this.ships.length < this.maxShips) this._spawnBurst(burst);
        }
    }

    draw(context){
        for (let i = 0; i < this.ships.length; i++){
            const s = this.ships[i];
            if (!s) continue;
            s.draw(context);
        }
    }
}
//FINISH ALPHA CHANGE 639 -- BackgroundShip: visual-only parallax entity (between layer1 and layer2) --

//START ALPHA CHANGE 569 -- Layer3GroundProps: truck/tank + walking mechs anchored to layer3 (draw ABOVE layer3, behind gameplay) --
//START ALPHA CHANGE 570 -- ground props: Enemy-style base + fully-configured subclasses (image lookup + draw/update per class) --
class Layer3GroundPropItem {
    constructor(game){
        this.game = game;

        // World/canvas coords. (Layer3GroundProps will place these on-screen; for now treat as canvas coords.)
        this.x = 0;
        this.y = 0;

        // Optional draw-time mirror
        this.flipX = false;

        // Enemy-style defaults: subclasses must define visuals + behavior
        this.type = "";
        this.image = null;

        this.width = 0;
        this.height = 0;

        this.frameX = 0;
        this.maxFrame = 0;

        // time-based animation helpers fallback default values (subclasses must overwrite with their own values)
        this.fps = 0;
        this.interval = 0;
        this.timer = 0;

        // motion knobs fallbacks (subclass-owned)
        this.lockFactor = 1.0;
        this.walkDir = 0;
        this.walkSpeed = 0;
    }

    update(deltaTime){ //safe fallback — subclasses usually override
        // no-op fallback (Enemy-style). Each subclass controls its own animation/motion 
    }

    draw(context){
        // Safe fallback: warn once in debug if subclass forgot to implement draw()
        if (this.game && this.game.debug && !this._warnedNoDraw) {
            const name = (this && this.type) ? this.type
                       : (this && this.constructor ? this.constructor.name : "Layer3GroundPropItem");
            console.log(`[Layer3GroundPropItem.draw] No draw() override for ${name}. Using base fallback.`);
            this._warnedNoDraw = true;
        }
        // no-op fallback
    }
}

// ---- Vehicles (do not walk; animate turrets) ----
class GroundTruck extends Layer3GroundPropItem {
    constructor(game){
        super(game);
        this.type = "truck";
        this.image = document.getElementById("truck");

        // Sheet spec (today: 7×7, 512 stride, no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        this.scale  = 0.6; // tweak
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 613 -- GroundTruck: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 613 -- GroundTruck: keep ONLY normalized sheetScale --

        // Animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // Subclass-owned motion knobs
        this.lockFactor = 1; // 100% of layer3 speed (if not it will have "slide effect")
        this.walkDir = 0;
        this.walkSpeed = 0;
    }

    update(deltaTime){
        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
        //START ALPHA CHANGE 618 -- GroundTruck: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "truck"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        destW = srcW; // 1:1 blit
                        destH = srcH;

                        if (!this._scaledSizeSynced618) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced618 = true;
                        }
                    } else {
                        try {
                            if (!this._warnedMetaMissing618) this._warnedMetaMissing618 = new Set();
                            if (!this._warnedMetaMissing618.has(scaledKey)) {
                                console.warn(`[GroundTruck] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing618.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    src = this.image; // RAW fallback
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 618 -- GroundTruck: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}

class GroundTank extends Layer3GroundPropItem {
    constructor(game){
        super(game);
        this.type = "tank";
        this.image = document.getElementById("tank");

        // Sheet spec (today: 7×7, 512 stride, no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        this.scale  = 0.6; // tweak
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 614 -- GroundTank: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 614 -- GroundTank: keep ONLY normalized sheetScale --

        // Animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = 0;
        this.fps = 20;
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // Subclass-owned motion knobs
        this.lockFactor = 1; // 100% of layer3 speed (if not it will have "slide effect")
        this.walkDir = 0;
        this.walkSpeed = 0;
    }

    update(deltaTime){
        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
         //START ALPHA CHANGE 614 -- GroundTank: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "tank"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        destW = srcW;
                        destH = srcH;

                        if (!this._scaledSizeSynced619) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced619 = true;
                        }
                    } else {
                        try {
                            if (!this._warnedMetaMissing619) this._warnedMetaMissing619 = new Set();
                            if (!this._warnedMetaMissing619.has(scaledKey)) {
                                console.warn(`[GroundTank] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing619.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    src = this.image;
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 614 -- GroundTank: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}

// ---- Mechs (walk left/right; can exceed layer3 scroll) ----
class GroundMechRed extends Layer3GroundPropItem {
    constructor(game){
        super(game);
        this.type = "mech_red";
        this.image = document.getElementById("mech_red");

        // Sheet spec (today: 7×7, 512 stride, no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        this.scale  = 0.3; // tweak
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 615 -- GroundMechRed: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 615 -- GroundMechRed: keep ONLY normalized sheetScale --

        // Animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = Math.floor(Math.random() * (this.maxFrame + 1)); //randomize starting animation 
        this.fps = 30; //matches the 20 grey faster animation 
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // Subclass-owned motion knobs
        this.lockFactor = 1.0; // fully on layer3 ground
        this.walkDir = 0;//walking direction: the value here is replaced by MechCluster.reset() walkDir that forces it to ±1
        this.walkSpeed = 0.3; //matches nicely with the 30fps animation
    }

    update(deltaTime){
        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
        //START ALPHA CHANGE 615 -- GroundMechRed: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "mech_red"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        destW = srcW;
                        destH = srcH;

                        if (!this._scaledSizeSynced620) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced620 = true;
                        }
                    } else {
                        try {
                            if (!this._warnedMetaMissing620) this._warnedMetaMissing620 = new Set();
                            if (!this._warnedMetaMissing620.has(scaledKey)) {
                                console.warn(`[GroundMechRed] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing620.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    src = this.image;
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 615 -- GroundMechRed: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}

class GroundMechWhite extends Layer3GroundPropItem {
    constructor(game){
        super(game);
        this.type = "mech_white";
        this.image = document.getElementById("mech_white");

        // Sheet spec (today: 7×7, 512 stride, no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        this.scale  = 0.3; // tweak
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 616 -- GroundMechWhite: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 616 -- GroundMechWhite: keep ONLY normalized sheetScale --

        // Animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = Math.floor(Math.random() * (this.maxFrame + 1)); //randomize starting animation 
        this.fps = 30; //30 to match 20 grey
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // Subclass-owned motion knobs
        this.lockFactor = 1.0;
        this.walkDir = 0;//walking direction: the value here is replaced by MechCluster.reset() walkDir that forces it to ±1
        this.walkSpeed = 0.3; //matches nicely with the 30fps animation
    }

    update(deltaTime){
        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
        //START ALPHA CHANGE 612 -- GroundMechWhite: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "mech_white"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep instance sizing aligned to 1:1 draw size (once)
                        if (!this._scaledSizeSynced621) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced621 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing621) this._warnedMetaMissing621 = new Set();
                            if (!this._warnedMetaMissing621.has(scaledKey)) {
                                console.warn(`[GroundMechWhite] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing621.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    // Raw fallback path stays legacy
                    src = this.image;
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 612 -- GroundMechWhite: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}

class GroundMechGrey extends Layer3GroundPropItem {
    constructor(game){
        super(game);
        this.type = "mech_grey";
        this.image = document.getElementById("mech_grey");

        // Sheet spec (today: 7×7, 512 stride, no crop)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        this.scale  = 0.3; // tweak
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        //START ALPHA CHANGE 618 -- GroundMechGrey: keep ONLY normalized sheetScale for cache key (META comes from AssetsLoading) --
        this._sheetScale = Math.round(this.scale * 10000) / 10000; // must match AssetsLoading key format
        //FINISH ALPHA CHANGE 618 -- GroundMechGrey: keep ONLY normalized sheetScale --

        // Animation (TOP→BOTTOM, 0..48)
        this.maxFrame = 48;
        this.frameX = Math.floor(Math.random() * (this.maxFrame + 1)); //randomize starting animation 
        this.fps = 20; //faster animation so at 20 it matches the other at 30 
        this.interval = 1000 / this.fps;
        this.timer = 0;

        // Subclass-owned motion knobs
        this.lockFactor = 1.0;
        this.walkDir = 0; //walking direction: the value here is replaced by MechCluster.reset() walkDir that forces it to ±1
        this.walkSpeed = 0.3; //0.3 matching perfectly with the current animation fps (20 for grey because it is faster)
    }

    update(deltaTime){
        this.timer += deltaTime;
        if (this.timer > this.interval){
            this.timer = 0;
            this.frameX = (this.frameX < this.maxFrame) ? (this.frameX + 1) : 0;
        }
    }

    draw(context){
       //START ALPHA CHANGE 618 -- GroundMechGrey: META-only sheetScaled sampling + 1:1 dest sizing (Angler1 blueprint) --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
            const al = this.game && this.game.assetsLoading;
            const id = (this.image && this.image.id) ? this.image.id : null; // "mech_grey"
            if (al && id && typeof al.getCachedOrFallback === "function") {
                const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
                const cand = al.getCachedOrFallback(scaledKey, this.image);

                if (cand && cand !== this.image) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;

                        // guaranteed 1:1 blit (no resample)
                        destW = srcW;
                        destH = srcH;

                        // keep instance sizing aligned to 1:1 draw size (once)
                        if (!this._scaledSizeSynced622) {
                            this.width  = destW;
                            this.height = destH;
                            this._scaledSizeSynced622 = true;
                        }
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                        try {
                            if (!this._warnedMetaMissing622) this._warnedMetaMissing622 = new Set();
                            if (!this._warnedMetaMissing622.has(scaledKey)) {
                                console.warn(`[GroundMechGrey] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedMetaMissing622.add(scaledKey);
                            }
                        } catch (_) {}

                        src    = this.image;
                        stride = this._srcStride;
                        offX   = this._srcOffsetX;
                        offY   = this._srcOffsetY;
                        srcW   = this._srcSizeW;
                        srcH   = this._srcSizeH;
                        destW  = this.width;
                        destH  = this.height;
                    }
                } else {
                    // Raw fallback path stays legacy
                    src = this.image;
                }
            }
        } catch (_) {}

        const idx = this.frameX | 0;
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx = col * stride + offX;
        const sy = row * stride + offY;

        if (this.flipX){
            context.save();
            context.translate(this.x + destW, this.y);
            context.scale(-1, 1);
            context.drawImage(src, sx, sy, srcW, srcH, 0, 0, destW, destH);
            context.restore();
        } else {
            context.drawImage(src, sx, sy, srcW, srcH, this.x, this.y, destW, destH);
        }
        //FINISH ALPHA CHANGE 618 -- GroundMechGrey: META-only sheetScaled sampling + 1:1 dest sizing --
    }
}
//FINISH ALPHA CHANGE 570 -- ground props: Enemy-style base + fully-configured subclasses (image lookup + draw/update per class) --

//START ALPHA CHANGE 571 -- ground props: positional-only clusters (no motion/anim logic here) --

// Truck/Tank cluster: 2 vehicles, same row (aligned), only X offsets inside the cluster.
// NOTE: This class does NOT move items and does NOT use deltaTime.
class TruckTankCluster {
    constructor(game, opts){
        this.game = game;
        this.items = [];
        //START ALPHA CHANGE 572 -- truck/tank cluster: separate bottomPx per type --
        this._yFromBottom = (opts && typeof opts.yFromBottom === "function") ? opts.yFromBottom : null;

        // Keep separate bottoms so each sprite can be tuned independently
        this._truckBottomPx = (opts && typeof opts.truckBottomPx === "number") ? opts.truckBottomPx : 0;
        this._tankBottomPx  = (opts && typeof opts.tankBottomPx === "number") ? opts.tankBottomPx : 0;

        this._gapX = (opts && typeof opts.gapX === "number") ? opts.gapX : 80; // tunable gap between the two vehicles
        //FINISH ALPHA CHANGE 572 -- truck/tank cluster: separate bottomPx per type --

        // build initial composition
        this._buildItems();
    }

    _buildItems(){
        this.items.length = 0;
        // Random 2 picks between truck/tank so we can get all combinations
        for (let i = 0; i < 2; i++){
            const pick = (Math.random() < 0.5) ? new GroundTruck(this.game) : new GroundTank(this.game);
            this.items.push(pick);
        }
    }

    // Positional reset: decides cluster direction + places items at absolute screen-space coordinates.
    // NOTE: no motion here; only sets initial x/y + facing.
    reset(screenX){
        // Optional: re-roll composition on each recycle (keeps variety even with few clusters)
        this._buildItems();

        const dir = (Math.random() < 0.5) ? 1 : -1;   // pack direction (for facing only; vehicles don't walk)
        const flip = (dir < 0);                       // base art faces RIGHT => flip when moving LEFT

    //START ALPHA CHANGE 572 -- truck/tank cluster: per-type bottom alignment --
    /*
    We still bottom-align the row visually, but baseY is computed per-item type:
    - trucks use this._truckBottomPx
    - tanks use this._tankBottomPx
    */
    let maxH = 0;
    for (let i = 0; i < this.items.length; i++){
        maxH = Math.max(maxH, (this.items[i] && this.items[i].height) ? this.items[i].height : 0);
    }

    // Place the 2 vehicles along X
    let x = screenX;
    for (let i = 0; i < this.items.length; i++){
        const it = this.items[i];
        if (!it) continue;

        const isTank = (it.type === "tank");
        const bottomPx = isTank ? this._tankBottomPx : this._truckBottomPx;
        const baseY = (this._yFromBottom) ? this._yFromBottom(bottomPx, maxH) : 0;

        it.x = x;
        it.y = baseY + (maxH - (it.height || 0)); // bottom-aligned across the row
        it.flipX = flip;

        x += (it.width || 0) + this._gapX;
    }
    //FINISH ALPHA CHANGE 572 -- truck/tank cluster: per-type bottom alignment --
  }

    bounds(){
        // Returns {minX, maxEdge} in screen-space
        let minX = Infinity;
        let maxEdge = -Infinity;
        for (let i = 0; i < this.items.length; i++){
            const it = this.items[i];
            if (!it) continue;
            const x = (typeof it.x === "number") ? it.x : 0;
            const w = (it.width || 0);
            minX = Math.min(minX, x);
            maxEdge = Math.max(maxEdge, x + w);
        }
        if (minX === Infinity) minX = 0;
        if (maxEdge === -Infinity) maxEdge = 0;
        return { minX, maxEdge };
    }
}

// Mech cluster: 3×3 grid (9 mechs). Top row uses the cluster base Y.
// Row2 and Row3 use +dy offsets (tunable). Also optional per-row X shift (tunable).
// NOTE: This class does NOT move items and does NOT use deltaTime.
class MechCluster {
    constructor(game, opts){
        this.game = game;
        this.items = [];
        this._yFromBottom = (opts && typeof opts.yFromBottom === "function") ? opts.yFromBottom : null;
        this._bottomPx = (opts && typeof opts.bottomPx === "number") ? opts.bottomPx : 0;

        // Tunables (positional only)
        this._colGapX = (opts && typeof opts.colGapX === "number") ? opts.colGapX : 40;  // gap between columns
        this._rowDy = (opts && typeof opts.rowDy === "number") ? opts.rowDy : 55;        // vertical drop per row
        this._rowShiftX = (opts && typeof opts.rowShiftX === "number") ? opts.rowShiftX : 28; // X shift per row (stagger)

        this._buildItems();
    }

    _newRandomMech(){
        const r = Math.random();
        if (r < 0.333) return new GroundMechRed(this.game);
        if (r < 0.666) return new GroundMechWhite(this.game);
        return new GroundMechGrey(this.game);
    }

    _buildItems(){
        this.items.length = 0;
        for (let i = 0; i < 9; i++){ //numero totale di elementi nel cluster (e.g., 3x3=9)
            this.items.push(this._newRandomMech());
        }
    }

    // Positional reset: decides shared direction + places the 3×3 formation at absolute screen-space coords.
    // NOTE: no motion here; only initial x/y + facing + shared walkDir for the pack.
    reset(screenX){
        // Optional: re-roll composition on each recycle
        this._buildItems();

        const dir = 1;   // whole pack walks same direction -- removed "(Math.random() < 0.5) ? 1 : -1" for random direction with no flip to avoid "moonwalk"
        const flip = false;                       // "(dir < 0);" ---> "false"  to always face right-- base mech art faces RIGHT => flip when moving LEFT

        // Use max height for clean bottom alignment across rows if needed
        let maxH = 0;
        for (let i = 0; i < this.items.length; i++){
            maxH = Math.max(maxH, (this.items[i] && this.items[i].height) ? this.items[i].height : 0);
        }
        const baseY = (this._yFromBottom) ? this._yFromBottom(this._bottomPx, maxH) : 0;

        // Compute a reasonable cell width based on mech width
        const cellW = (this.items[0] && this.items[0].width) ? this.items[0].width : 0;

        let idx = 0;
        for (let row = 0; row < 3; row++){ //numero di righe (e.g., 3 righe)
            for (let col = 0; col < 3; col++){ //numero totale di colonne (e.g., 3 colonne)
                const it = this.items[idx++];
                if (!it) continue;

                it.x = screenX + col * (cellW + this._colGapX) + row * this._rowShiftX;
                it.y = (baseY + row * this._rowDy) + (maxH - (it.height || 0)); // bottom-aligned

                it.flipX = flip;

                // shared pack direction (used by existing Layer3GroundProps motion math)
                it.walkDir = dir;

                // do NOT touch it.walkSpeed here (subclasses own it)
            }
        }
    }

    bounds(){
        let minX = Infinity;
        let maxEdge = -Infinity;
        for (let i = 0; i < this.items.length; i++){
            const it = this.items[i];
            if (!it) continue;
            const x = (typeof it.x === "number") ? it.x : 0;
            const w = (it.width || 0);
            minX = Math.min(minX, x);
            maxEdge = Math.max(maxEdge, x + w);
        }
        if (minX === Infinity) minX = 0;
        if (maxEdge === -Infinity) maxEdge = 0;
        return { minX, maxEdge };
    }
}

//FINISH ALPHA CHANGE 571 -- ground props: positional-only clusters (no motion/anim logic here) --

class Layer3GroundProps {
    constructor(game, anchorLayer){// speedModifier is read from anchorLayer inside update() so there is no stale/unused state
        this.game = game;
        this.anchorLayer = anchorLayer || null;

        this.motionFps = 60;

        // Fixed "distance from bottom" (0 = bottom edge). TWEAK THESE FIRST.
        // yFromTop = canvasH - bottomPx - spriteH
        this.truckBottomPx = 38;  // <-- tweak trucks
        this.tankBottomPx  = 38;  // <-- tweak tunks
        this.mechBottomPx  = 100;  // <-- tweak mech 

        //START ALPHA CHANGE 571 -- clusters: fixed composition (no random counts) --
        // Vehicle clusters: 2 items per cluster, total clusters controls total vehicles on screen.
        this.truckTankClusterCount = 1;     // 2 clusters × 2 vehicles = 4 vehicles visible
        this.truckTankGapX = 80;            // X gap between the two vehicles in the cluster (tunable)
        this.truckTankClusterSpacingPx = 400; // spacing between clusters (tunable) 520 originally 

        // Mech clusters: fixed 3×3 = 9 mechs per cluster
        this.mechClusterCount = 1;          // 1 cluster × 9 mechs = 9 mechs visible
        this.mechClusterSpacingPx = 400;    // spacing between mech clusters (tunable)
        this.mechClusterColGapX = 40;       // tunable -- distanza tra le colonne 
        this.mechClusterRowDy = 10;         // tunable -- distanza verticale tra le row 
        this.mechClusterRowShiftX = 35;     // tunable -- More “diagonal formation” look
        //FINISH ALPHA CHANGE 571 -- clusters: fixed composition (no random counts) --

        this.spawnPadPx = 160; //the single knob that controls “how far off-screen” respawns happen. 
        //Increase it (e.g. 160 → 240/320) if you still catch a tiny pop on very wide sprites or large dt jumps
        
        //START ALPHA CHANGE 571 -- clusters: storage --
        this.truckTankClusters = [];
        this.mechClusters = [];
        //FINISH ALPHA CHANGE 571 -- clusters: storage --

        this._seedInitial();
    }

    _yFromBottom(bottomPx, spriteH){
        const h = (this.game && typeof this.game.height === "number") ? this.game.height : 720;
        return Math.round(h - (bottomPx | 0) - (spriteH | 0));
    }

    //we use it.x directly

    //START ALPHA CHANGE 571 -- clusters: edge scan uses cluster items --
    _rightMostEdge(){
        let rightMost = -Infinity;

        for (let c = 0; c < this.truckTankClusters.length; c++){
            const cl = this.truckTankClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;
                const rx = ((typeof it.x === "number") ? it.x : 0) + (it.width || 0);
                if (rx > rightMost) rightMost = rx;
            }
        }

        for (let c = 0; c < this.mechClusters.length; c++){
            const cl = this.mechClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;
                const rx = ((typeof it.x === "number") ? it.x : 0) + (it.width || 0);
                if (rx > rightMost) rightMost = rx;
            }
        }

        //START ALPHA CHANGE 573 -- safe guard -- Number.isFinite (no coercion -- it doesn’t let non-number junk sneak through as “valid”) catches all of: Infinity, -Infinity, NaN edge cases -- 
        if (!Number.isFinite(rightMost)) rightMost = 0;
        //FINISH ALPHA CHANGE 573 -- guard against -Infinity when no items exist -- 

        return rightMost;
    }

    _leftMostEdge(){
        let leftMost = Infinity;

        for (let c = 0; c < this.truckTankClusters.length; c++){
            const cl = this.truckTankClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;
                const lx = ((typeof it.x === "number") ? it.x : 0);
                if (lx < leftMost) leftMost = lx;
            }
        }

        for (let c = 0; c < this.mechClusters.length; c++){
            const cl = this.mechClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;
                const lx = ((typeof it.x === "number") ? it.x : 0);
                if (lx < leftMost) leftMost = lx;
            }
        }

        //START ALPHA CHANGE 573 -- safe guard -- Number.isFinite (no coercion -- it doesn’t let non-number junk sneak through as “valid”) catches all of: Infinity, -Infinity, NaN edge cases -- 
        if (!Number.isFinite(leftMost)) leftMost = 0;
        //FINISH ALPHA CHANGE 573 -- guard against Infinity when no items exist --

        return leftMost;
    }
    //FINISH ALPHA CHANGE 571 -- clusters: edge scan uses cluster items --

    _seedInitial(){
        //START ALPHA CHANGE 571 -- seed clusters across the screen (unit spawn) --
        let cursor = 0;

        // 1) Truck/Tank clusters
        this.truckTankClusters.length = 0;
        for (let i = 0; i < this.truckTankClusterCount; i++){
            const cl = new TruckTankCluster(this.game, { //ALPHA CHANGE 572 -- pass both truck/tank bottoms into cluster --
                yFromBottom: this._yFromBottom.bind(this),
                truckBottomPx: this.truckBottomPx,
                tankBottomPx: this.tankBottomPx,
                gapX: this.truckTankGapX
            });
            cl.reset(cursor);
            this.truckTankClusters.push(cl);

            const b = cl.bounds();
            cursor = b.maxEdge + this.truckTankClusterSpacingPx;
        }

        // 2) Mech clusters (spawn after vehicles)
        //cursor += 220; offset iniziale spawn tra mech e truck/truck -- usalo negativo (e.g., -700) per controllare clipping metch truck/tunk in primo piano

        this.mechClusters.length = 0;
        for (let i = 0; i < this.mechClusterCount; i++){
            const cl = new MechCluster(this.game, {
                yFromBottom: this._yFromBottom.bind(this),
                bottomPx: this.mechBottomPx,
                colGapX: this.mechClusterColGapX,
                rowDy: this.mechClusterRowDy,
                rowShiftX: this.mechClusterRowShiftX
            });
            cl.reset(cursor);
            this.mechClusters.push(cl);

            const b = cl.bounds();
            cursor = b.maxEdge + this.mechClusterSpacingPx;
        }
        //FINISH ALPHA CHANGE 571 -- seed clusters across the screen (unit spawn) --
    }

    update(deltaTime){
        //START ALPHA CHANGE 574 -- Layer3GroundProps: pure AnimatedBackground-style scroll + recycle (screen-space) --
        const motionScale = ((typeof this.motionFps === "number") ? this.motionFps : 60) / 1000;
        const dt = (typeof deltaTime === "number") ? deltaTime : 0;

        const w = (this.game && typeof this.game.width === "number") ? this.game.width : 1280;
//START ALPHA CHANGE 575 -- GroundProps: derive dx from anchorLayer.x (wrap-aware) to prevent phase desync --
let dx = 0;
try {
    const al = this.anchorLayer;
    const ax = (al && typeof al.x === "number") ? al.x : 0;

    // initialize on first frame
    if (typeof this._prevAnchorX !== "number") this._prevAnchorX = ax;

    // raw delta of anchor x (anchor moves left => ax decreases => rawDelta negative)
    let rawDelta = ax - this._prevAnchorX;

    // wrap-aware correction (Layer wraps by +/- layer.width)
    const aw = (al && typeof al.width === "number") ? al.width : 0;
    if (aw > 0) {
        // if we jumped due to wrap, pick the smaller equivalent delta
        if (rawDelta >  aw * 0.5) rawDelta -= aw;
        if (rawDelta < -aw * 0.5) rawDelta += aw;
    }

    // we want dx as "pixels scrolled left this frame" (positive number)
    dx = -rawDelta;

    this._prevAnchorX = ax;
} catch (_) {
    dx = 0; // safe fallback
}
//FINISH ALPHA CHANGE 575 -- GroundProps: derive dx from anchorLayer.x (wrap-aware) to prevent phase desync --

         //START ALPHA CHANGE 571 -- update: move items as before, recycle clusters as units --
        // 1) move + animate ITEMS (motion stays item-owned: lockFactor/walkDir/walkSpeed live on each item)
        for (let c = 0; c < this.truckTankClusters.length; c++){
            const cl = this.truckTankClusters[c];
            if (!cl || !cl.items) continue;

            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;

                const lock = (typeof it.lockFactor === "number") ? it.lockFactor : 1.0;
                const dir  = (it.walkDir === 1 || it.walkDir === -1) ? it.walkDir : 0;
                const ws   = (typeof it.walkSpeed === "number") ? it.walkSpeed : 0;

                it.x -= dx * lock;
                it.x += (dir * ws) * dt * motionScale;

                if (typeof it.update === "function") it.update(dt);
            }
        }

        for (let c = 0; c < this.mechClusters.length; c++){
            const cl = this.mechClusters[c];
            if (!cl || !cl.items) continue;

            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (!it) continue;

                const lock = (typeof it.lockFactor === "number") ? it.lockFactor : 1.0;
                const dir  = (it.walkDir === 1 || it.walkDir === -1) ? it.walkDir : 0;
                const ws   = (typeof it.walkSpeed === "number") ? it.walkSpeed : 0;

                it.x -= dx * lock;
                it.x += (dir * ws) * dt * motionScale;

                if (typeof it.update === "function") it.update(dt);
            }
        }

        // 2) recycle CLUSTERS as units
        let rightMost = this._rightMostEdge();
        let leftMost  = this._leftMostEdge();

        if (dx >= 0) {
            // screen moving LEFT -> recycle when cluster fully off LEFT, respawn on RIGHT
            for (let c = 0; c < this.truckTankClusters.length; c++){
                const cl = this.truckTankClusters[c];
                if (!cl) continue;
                const b = cl.bounds();
                if (b.maxEdge >= -this.spawnPadPx) continue;

                //START ALPHA CHANGE 577 -- clamp respawn X so truck/tank cluster starts off-screen right (prevents popping) --
                let newX = rightMost + this.truckTankClusterSpacingPx;
                const minSpawnX = w + this.spawnPadPx;
                if (newX < minSpawnX) newX = minSpawnX;

                cl.reset(newX);
                rightMost = cl.bounds().maxEdge;
                //FINISH ALPHA CHANGE 577 -- clamp respawn X so truck/tank cluster starts off-screen right (prevents popping) --
            }

            for (let c = 0; c < this.mechClusters.length; c++){
                const cl = this.mechClusters[c];
                if (!cl) continue;
                const b = cl.bounds();
                if (b.maxEdge >= -this.spawnPadPx) continue;

                //START ALPHA CHANGE 576 -- clamp respawn X so mech cluster starts off-screen right (prevents popping) --
                let newX = rightMost + this.mechClusterSpacingPx;
                const minSpawnX = w + this.spawnPadPx; // guarantee fully off-screen
                if (newX < minSpawnX) newX = minSpawnX;

                cl.reset(newX);
                rightMost = cl.bounds().maxEdge;
                //FINISH ALPHA CHANGE 576 -- clamp respawn X so mech cluster starts off-screen right (prevents popping) --
            }
        } else {
            // screen moving RIGHT -> recycle when cluster fully off RIGHT, respawn on LEFT
            for (let c = 0; c < this.truckTankClusters.length; c++){
                const cl = this.truckTankClusters[c];
                if (!cl) continue;
                const b = cl.bounds();
                if (b.minX <= (w + this.spawnPadPx)) continue;

                const newX = leftMost - this.truckTankClusterSpacingPx;
                cl.reset(newX);
                leftMost = cl.bounds().minX;
            }

            for (let c = 0; c < this.mechClusters.length; c++){
                const cl = this.mechClusters[c];
                if (!cl) continue;
                const b = cl.bounds();
                if (b.minX <= (w + this.spawnPadPx)) continue;

                const newX = leftMost - this.mechClusterSpacingPx;
                cl.reset(newX);
                leftMost = cl.bounds().minX;
            }
        }
        //FINISH ALPHA CHANGE 571 -- update: move items as before, recycle clusters as units --
    }

    draw(context){
       //START ALPHA CHANGE 571 -- draw: vehicles behind, mechs in front (cluster-aware) --
        // 1) vehicles first
        for (let c = 0; c < this.truckTankClusters.length; c++){
            const cl = this.truckTankClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (it && typeof it.draw === "function") it.draw(context);
            }
        }

        // 2) mechs always in front
        for (let c = 0; c < this.mechClusters.length; c++){
            const cl = this.mechClusters[c];
            if (!cl || !cl.items) continue;
            for (let i = 0; i < cl.items.length; i++){
                const it = cl.items[i];
                if (it && typeof it.draw === "function") it.draw(context);
            }
        }
        //FINISH ALPHA CHANGE 571 -- draw: vehicles behind, mechs in front (cluster-aware) --
    }
}
//FINISH ALPHA CHANGE 569 -- Layer3GroundProps: truck/tank + walking mechs anchored to layer3 --

    class Background {
        constructor(game){
            this.game = game
            this.image1 = document.getElementById("layer1");
            this.image2 = document.getElementById("layer2");
            this.image3 = document.getElementById("layer3");
            this.image4 = document.getElementById("layer4");
            this.layer1 = new Layer(this.game, this.image1, 0.3);
            this.layer2 = new Layer(this.game, this.image2, 1);
            this.layer3 = new Layer(this.game, this.image3, 2);
            this.layer4 = new Layer(this.game, this.image4, 4);
            //START ALPHA CHANGE 640 -- Background: add BackgroundShipSpawner between layer1 and layer2 --
            this.backgroundShip = new BackgroundShipSpawner(this.game);
            //FINISH ALPHA CHANGE 640 -- Background: add BackgroundShipSpawner between layer1 and layer2 --
            this.animatedBackground = new AnimatedBackground(this.game, this.layer3); // ALPHA CHANGE 555 + ALPHA CHANGE 557 -- AnimatedBackground: draw between layer2 and layer3 + anchor to layer3 instance ----  
            this.flyingTrain = new FlyingTrainSpawner(this.game); //ALPHA CHANGE 563 -- Background: add FlyingTrainSpawner between layer2 and AnimatedBackground --
            this.layer3GroundProps = new Layer3GroundProps(this.game, this.layer3); //ALPHA CHANGE 565 -- Background: instantiate layer3 ground props (truck/tank/mechs) --
            this.layers = [this.layer1, this.layer2, this.layer3]; //draw all the background layers before the player and enemies 
        }
        update(deltaTime){ //forward deltaTime to parallax layers
            this.layers.forEach(layer => layer.update(deltaTime)); //ALPHA CHANGE 448 -- Background: forward deltaTime to parallax layers --
            //START ALPHA CHANGE 641 -- Background: update BackgroundShipSpawner --
            if (this.backgroundShip) this.backgroundShip.update(deltaTime);
            //FINISH ALPHA CHANGE 641 -- Background: update BackgroundShipSpawner --
            if (this.flyingTrain) this.flyingTrain.update(deltaTime); //ALPHA CHANGE 563 -- Background: update FlyingTrainSpawner --
            if (this.animatedBackground) this.animatedBackground.update(deltaTime); //ALPHA CHANGE 555 -- AnimatedBackground: update alongside parallax layers --
            if (this.layer3GroundProps) this.layer3GroundProps.update(deltaTime); //ALPHA CHANGE 565 -- Background: update layer3-anchored ground props --
        }
        draw(context){
            //START ALPHA CHANGE 555 -- AnimatedBackground: enforce draw order (layer2 -> animated -> layer3) --
            this.layer1.draw(context);
            //START ALPHA CHANGE 642 -- Background: draw BackgroundShipSpawner between layer1 and layer2 --
            if (this.backgroundShip) this.backgroundShip.draw(context);
            //FINISH ALPHA CHANGE 642 -- Background: draw BackgroundShipSpawner between layer1 and layer2 --
            this.layer2.draw(context);
            if (this.flyingTrain) this.flyingTrain.draw(context);
            if (this.animatedBackground) this.animatedBackground.draw(context);
            this.layer3.draw(context);
            //FINISH ALPHA CHANGE 555 -- AnimatedBackground: enforce draw order (layer2 -> animated -> layer3) --
            if (this.layer3GroundProps) this.layer3GroundProps.draw(context);//ALPHA CHANGE 565 -- Background: draw layer3 ground props ABOVE layer3, behind gameplay --
        }

    }

    class innbcUniverse {
    constructor(game) {
        this.game = game;
        this.alienInvasion = document.getElementById("universeAlienInvasion");
        this.starfighter = document.getElementById("universeStarfighter");
        this.lab = document.getElementById("universeLab");
        this.scientist = document.getElementById("universeScientist");
        this.news = document.getElementById("universeNews"); //ALPHA CHANGE 524 -- INNBC Universe: add "LATEST NEWS" page (image + content) --
        this.credits = document.getElementById("universeCredits");
        this.images = [this.alienInvasion, this.starfighter, this.lab, this.scientist, this.news, this.credits]; ///ALPHA CHANGE 524 -- added "this.news"
        this.innbcUniversePages = [
            { image: this.alienInvasion, text: "The Earth faces annihilation from technorganic alien invaders, monstrous beings of flesh and machine", links: [] },
            { image: this.starfighter, text: "INNBC Corp scientists reverse-engineer the alien tech to build the INNBC Starfighter, humanity’s only hope! The ship can feed on the same energy-carrying glowing aliens feeding their hive", links: [] },
            { image: this.lab, text: "In reality, Innovative Bioresearch Ltd harnesses science to fight humanity’s real threats, like HIV and cancer. Founded by Dr. Jonathan Fior, Innovative Bioresearch pioneers HIV cure research using SupT1 cell therapy", links: [
                { phrase: "Innovative Bioresearch Ltd", url: "https://www.innovativebioresearch.com/" },
                { phrase: "HIV study published in 'Vaccines'", url: "https://www.mdpi.com/2076-393X/4/2/13" }
            ] },
            { image: this.scientist, text: "Using the INNBC token and games, Fior’s company funds disruptive biomedical research and decentralizes science (DeSci), storing research data on the blockchain for transparency", links: [
                { phrase: "DeSci Study published in 'Springer-Nature'", url: "https://doi.org/10.1186/s12911-024-02498-z", subtext: "(Cited by Harvard University)" } //ALPHA CHANGE 526 -- Universe: add Harvard citation subtext under DeSci link --
            ] },
             //START ALPHA CHANGE 525 -- INNBC Universe: add "LATEST NEWS" page (image + content) --
             { image: this.news, text: "LATEST NEWS", links: [
                { phrase: "INNBC DApp study", url: "https://doi.org/10.1186/s12911-024-02498-z" },
                { phrase: "Peter Novak", url: "https://doi.org/10.3389/fneur.2025.1678955" }
            ] },
            //FINISH ALPHA CHANGE 525 -- INNBC Universe: add "LATEST NEWS" page (image + content) --
            { image: this.credits, text: "Art, Animation, Programming, Game Design, Sound Design: Jonathan Fior Original Soundtrack by: KHA!", links: [
                { phrase: "KHA! official", url: "https://khamusic1.bandcamp.com/album/ghoulish-sex-tape" } // Replace with actual KHA band URL
            ] }
        ];
        this.currentUniversePage = 0;
        this.innbcUniverseItemBounds = [];
        this.selectedInnbcUniverseIndex = 0;
        this.universeButtonHeight = 40;
        this.universeButtonWidth = 100;
        this.nextButton = { x: this.game.width / 2 + 20, y: this.game.height - 50, width: this.universeButtonWidth, height: this.universeButtonHeight, text: "Next", action: "Next" };
        this.backButton = { x: this.game.width / 2 - 120, y: this.game.height - 50, width: this.universeButtonWidth, height: this.universeButtonHeight, text: "Back", action: "Back" };
        this.mainMenuButton = { x: this.game.width / 2 - 120, y: this.game.height - 50, width: this.universeButtonWidth, height: this.universeButtonHeight, text: "Main Menu", action: "MenuBack" };
    }
    isLoaded() {
        return this.images.every(image => image.complete);
    }
}

    //START ALPHA CHANGE 540 -- Explosion: unify to 7x7 sheet (3584x3584), single class, run-once animation --
    class Explosion {
      constructor(game, x, y, scaleOverride){ //ALPHA CHANGE 542 -- Explosion: optional per-spawn scale override --
        this.game = game;
        this.image = document.getElementById("Explosion");

        // 7×7 layout: 3584 / 7 = 512 stride per cell (safe full-cell draw)
        this._srcStride  = 512;
        this._srcSizeW   = 512;
        this._srcSizeH   = 512;
        this._srcOffsetX = 0;
        this._srcOffsetY = 0;

        // On-screen size via scale (tune live if needed)
        //START ALPHA CHANGE 627 -- Explosion: normalize scale for sheetScaled cache key (matches AssetsLoading) --
        const rawScale627 = (typeof scaleOverride === 'number' && isFinite(scaleOverride) && scaleOverride > 0)
            ? scaleOverride
            : 0.25; // fallback (matches existing default)
        this._sheetScale = Math.round(rawScale627 * 10000) / 10000; // must match AssetsLoading key format
        this.scale = this._sheetScale;
        //FINISH ALPHA CHANGE 627 -- Explosion: normalize scale --
        this.width  = Math.round(this._srcSizeW * this.scale);
        this.height = Math.round(this._srcSizeH * this.scale);

        // Center the explosion on (x,y) like before (enemy center is passed in)
        this.x = x - this.width * 0.5;
        this.y = y - this.height * 0.5;

        // Animation: run once through all 49 frames (0..48), TOP→BOTTOM -- tuned down to 26 frames
        this.frameX = 0;
        this.maxFrame = 27;             // only rendering the first 26 frames -- looks much nicer 
        this.fps = 80;                 // visual FPS knob (independent from motion)
        this.timer = 0;
        this.interval = 1000/this.fps;
        this.markedForDeletion = false;

        // Motion: keep dt-based horizontal drift consistent with scroll speed
        this.motionFps = 60; // interpret game.speed as "per frame at 60fps" for scroll motion
      }
      update(deltaTime){
        // dt-based horizontal drift using motionFps (like your other entities)
        const motionScale = ((typeof this.motionFps === 'number') ? this.motionFps : 60) / 1000; // ms → virtual frames
        this.x -= this.game.speed * deltaTime * motionScale;

        // dt-based animation stepping (run-once)
        this.timer += deltaTime;
        while (this.timer >= this.interval){
          this.frameX++;
          this.timer -= this.interval;
        }
        if (this.frameX > this.maxFrame) this.markedForDeletion = true;
      }
      draw(context){
        //START ALPHA CHANGE 628 -- Explosion: use sheetScaled+META cache per-scale (no resample), else RAW fallback --
        let src = this.image;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = this._srcStride;
        let offX   = this._srcOffsetX;
        let offY   = this._srcOffsetY;
        let srcW   = this._srcSizeW;
        let srcH   = this._srcSizeH;

        // Default DEST is legacy behavior
        let destW  = this.width;
        let destH  = this.height;

        try {
          const al = this.game && this.game.assetsLoading;
          const id = (this.image && this.image.id) ? this.image.id : "Explosion";
          if (al && id && typeof al.getCachedOrFallback === "function") {
            const scaledKey = `img:${id}:sheetScaled:${this._sheetScale}:stride:${this._srcStride}`;
            const cand = al.getCachedOrFallback(scaledKey, this.image); // if missing -> returns raw <img>

            if (cand && cand !== this.image) {
              const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;

              if (meta) {
                // Scaled-sheet path: 1:1 sampling using META
                src    = cand;
                stride = meta.stride;
                offX   = meta.offX;
                offY   = meta.offY;
                srcW   = meta.srcW;
                srcH   = meta.srcH;

                // guaranteed 1:1 blit (no resample)
                destW = srcW;
                destH = srcH;

                // Keep existing center if rounding ever differs (rare, but safe)
                if (!this._scaledSizeSynced628) {
                  const oldW = this.width;
                  const oldH = this.height;
                  this.width  = destW;
                  this.height = destH;
                  this.x += (oldW - destW) * 0.5;
                  this.y += (oldH - destH) * 0.5;
                  this._scaledSizeSynced628 = true;
                }
              } else {
                // Bitmap exists but META missing -> FORCE raw fallback + loud warning once
                try {
                  if (!this._warnedMetaMissing628) this._warnedMetaMissing628 = new Set();
                  if (!this._warnedMetaMissing628.has(scaledKey)) {
                    console.warn(`[Explosion] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                    this._warnedMetaMissing628.add(scaledKey);
                  }
                } catch (_) {}
                src = this.image;
              }
            } else {
              // Raw fallback path stays legacy
              src = this.image;
            }
          }
        } catch (_) {}

        const idx = this.frameX | 0;      // 0..48
        const col = idx % 7;              // 0..6
        const row = (idx / 7) | 0;        // 0..6 (TOP→BOTTOM)
        const sx  = col * stride + offX;
        const sy  = row * stride + offY;

        context.drawImage(
          src,
          sx, sy, srcW, srcH,
          this.x, this.y, destW, destH
        );
        //FINISH ALPHA CHANGE 628 -- Explosion: use sheetScaled+META cache per-scale --
      }
    }
    //FINISH ALPHA CHANGE 540 -- Explosion: unify to 7x7 sheet (3584x3584), single class, run-once animation --

    class UI {
        constructor(game){
            this.game = game; //per quello usiamo this.game.gameWon and not this.gameWon directly
            this.fontSize = 25;
            this.fontFamily = "Bangers";
            this.color = "white";
            this.loggedLeaderboard = false; // Track if leaderboard has been logged
            //start change -- add Triangle (button_3) to cancel gamepad binding and fix X/Circle conflicts//
            this.wasAwaitingGamepadInput = false; // Track previous frame's awaitingGamepadInput state
            //finish change//
            // STARTING SIXTH CHANGE: Menu properties
            this.menuItems = ["New Game", "Options", "Multiplayer", "INNBC Universe", "Full Screen", "Quit Game"];
            this.menuItemBounds = []; // New array for bounding boxes
            this.selectedMenuIndex = 0;
            this.menuItemHeight = 50;
            this.menuStartY = this.game.height / 2 - (this.menuItems.length * this.menuItemHeight) / 2;
            // FINISHED SIXTH CHANGE
            //START ALPHA CHANGE 210 -- Multiplayer lobby-name UI defaults --
            this._lobbyRegions = [
                { code: "US", label: "United States" },
                { code: "EU", label: "Europe" },
                { code: "CAN", label: "Canada" },
                { code: "AZN", label: "Australia & New Zeland" },
                { code: "MEA", label: "Middle East and Africa" },
                { code: "LATAM", label: "Latin America" },
                { code: "EASIA", label: "East Asia" },
                { code: "SEA", label: "Southeast Asia" },
                { code: "SA", label: "South Asia" }
            ];
            this._lobbyRegionIndex = 0;   // default: US
            this._lobbyCustomTag   = "COOP"; // empty allowed later; start with COOP
            //FINISH ALPHA CHANGE 210 -- Multiplayer lobby-name UI defaults --
        // START CHANGE: Options menu properties
        this.optionsItems = [
            { action: "Move Up", key: () => this.game.keyBindings.moveUp },
            { action: "Move Down", key: () => this.game.keyBindings.moveDown },
            { action: "Move Left", key: () => this.game.keyBindings.moveLeft },
            { action: "Move Right", key: () => this.game.keyBindings.moveRight },
            { action: "Fire", key: () => this.game.keyBindings.fire },
            { action: "Pause", key: () => this.game.keyBindings.pause },
            //{ action: "Debug Toggle", key: () => this.game.keyBindings.debug }, // Commented out for release
            //START ALPHA CHANGE 279
            { action: "Timer", key: () => null }, // show/edit game time (blinks when selected)
            //FINISH ALPHA CHANGE 279
            { action: "FPS Counter", key: () => this.game.showFPS ? "On" : "Off" },
            { action: "Full Screen", key: () => this.game.fullScreen ? "On" : "Off" }, // New: Full-screen toggle
            { action: "Gamepad Setup", key: () => null }, // add Gamepad Setup to options menu
            { action: "Reset All Settings", key: () => null }, // Added reset option
            //START ALPHA CHANGE 200 -- add Reset Score menu item under Reset All Settings --
            { action: "Reset Score", key: () => null },
            //FINISH ALPHA CHANGE 200 -- add Reset Score menu item under Reset All Settings --
            { action: "Back", key: () => null }
        ];
        this.optionsItemBounds = [];
        this.selectedOptionIndex = 0;
        this.optionsItemHeight = 50;
        this.optionsStartY = this.game.height / 2 - (this.optionsItems.length * this.optionsItemHeight) / 2 + 60; //menu height (+ 40) abbassi o alzi il menu options
        this.awaitingKeyInput = false; // For key rebinding
        // END CHANGE
        //start change -- initialize gamepad setup submenu//
        this.gamepadItems = [
            { action: "Move Up", input: () => this.game.gamepadBindings.moveUp },
            { action: "Move Down", input: () => this.game.gamepadBindings.moveDown },
            { action: "Move Left", input: () => this.game.gamepadBindings.moveLeft },
            { action: "Move Right", input: () => this.game.gamepadBindings.moveRight },
            { action: "Fire", input: () => this.game.gamepadBindings.fire },
            { action: "Pause", input: () => this.game.gamepadBindings.pause },
            //{ action: "Debug Toggle", input: () => this.game.gamepadBindings.debug }, // Commented out for release
            { action: "Back", input: () => null }
        ];
        this.gamepadItemBounds = [];
        //START ALPHA CHANGE 427 -- widen gamepadSetup line spacing to match Options (50px)
        this.gamepadStartY = this.game.height / 2 - (this.gamepadItems.length * 50) / 2; // center using 50px rows (se metti a 50 quello sotto, questo pure per tenerlo centrato)
        this.gamepadItemHeight = 50; // increase interline spacing for gamepadSetup to 50px -- questo cambia l'interlinea per il gamepad setup submenu
        //FINISH ALPHA CHANGE 427
        this.selectedGamepadIndex = 0;
        this.awaitingGamepadInput = false;
        //finish change//
        // START CHANGE: Game over menu properties
        this.gameOverItems = ["Restart", "Main Menu"]; // Removed "Demo Mode"
        this.gameOverItemBounds = [];
        this.selectedGameOverIndex = 0;
        this.gameOverItemHeight = 50;
        this.gameOverStartY = this.game.height / 2 - (this.gameOverItems.length * this.gameOverItemHeight) / 2;
        // END CHANGE
        // START CHANGE: Pause menu properties
        this.selectedPauseIndex = 0; // Default to "Resume"
        // END CHANGE
        // START CHANGE: Multiplayer menu properties
            this.multiplayerItems = ["Region", "Custom", "Create Lobby", "Join Lobby", "Back"]; // ALPHA CHANGE 222 --- expand multiplayerItems to match 5 rendered rows (Region, Custom, Create, Join, Back)--
            this.multiplayerItemBounds = []; //defined in constructor
            this.selectedMultiplayerIndex = 0; // Default to "Join Lobby" (Highlights the item at selectedMultiplayerIndex in red to show it’s selected)
            this.multiplayerItemHeight = 50;
            this.multiplayerStartY = this.game.height / 2 - 50; // Start below header
            this.multiplayerSubMenu = null; // Track multiplayer submenu state (e.g., 'JoinLobby')
            //Multiplayer menu properties
            //start change -- add joinLobby submenu properties//
            this.joinLobbyItems = ["Refresh", "Back"]; // Base items for Refresh and Back buttons
            this.joinLobbyItemBounds = []; // Will include lobbies + buttons
            this.selectedJoinLobbyIndex = 0; // Default to first item
            this.joinLobbyItemHeight = 50; // Consistent with other menus
            this.joinLobbyStartY = this.game.height / 2 - 50; // Start below header, adjust later if needed
            this.joinLobbyFocus = 'list'; // Track focus: 'list' or 'buttons'
            //finish change -- add joinLobby submenu properties//
            // start change -- debug flags for fake lobbies (safe/no side effects) --
            this.debugJoinLobby = false;          // set true to enable fake list for testing JoinLobby menu
            this.debugJoinLobbyCount = 30;        // how many fake entries to show
            // finish change -- debug flags for fake lobbies --
            //INNBC Universe menu properties
            this.innbcUniverseItems = ["Coming Soon", "Back"];
            this.innbcUniverseItemBounds = [];
            this.selectedInnbcUniverseIndex = 0; // Default to "Coming Soon"
            this.innbcUniverseItemHeight = 50;
            this.innbcUniverseStartY = this.game.height / 2 - 50; // Start below header
            // END CHANGE
        }
        draw(context){
            context.save();
            context.fillStyle = this.color;
            context.shadowOffsetX = 2;
            context.shadowOffsetY = 2;
            context.shadowColor = "black";
            context.font = this.fontSize + "px" + this.fontFamily;
//start change -- adding multiplayer and INNBC Universe menu rendering//
if (this.game.gameState === "mainMenu") {
    context.textAlign = "center";
    //context.font = "50px " + this.fontFamily;
    //context.fillText("INNBC STARFIGHTER", this.game.width / 2, 100);
    context.font = "40px " + this.fontFamily;
    this.menuItemBounds = []; // Clear previous bounds
    this.menuItems.forEach((item, index) => {
        const y = this.menuStartY + index * this.menuItemHeight;
        context.fillStyle = index === this.selectedMenuIndex ? "#ff0000" : "#ffffff";
        const displayText = item === "Full Screen" ? `Full Screen: ${this.game.fullScreen ? "On" : "Off"}` : item;
        context.fillText(displayText, this.game.width / 2, y);
        // Store bounding box in separate array
        this.menuItemBounds[index] = {
            text: item,
            x: this.game.width / 2 - context.measureText(item).width / 2,
            y: y - 30,
            width: context.measureText(displayText).width,
            height: 40
        };
    });
    context.restore();
    return;
} else if (this.game.gameState === "multiplayer") {
    context.textAlign = "center";
    context.font = "50px " + this.fontFamily;
    context.save();
    context.fillStyle = "#778899"; 
    context.globalAlpha = 0.70; // adjust opacity to taste (e.g., 0.6–0.85) -- make the MULTIPLAYER title semi-transparent
    context.fillText("Multiplayer online coop", this.game.width / 2, 50);
    context.restore();
    context.font = "40px " + this.fontFamily;
    this.multiplayerItemBounds = [];

    //START ALPHA CHANGE 79 -- host create-lobby progress overlay and Start Game gating --
    const sm = this.game.steamMultiplayer;
    if (sm && sm.isHost && sm.lobbyState === "inLobby") { //START ALPHA CHANGE 80 -- show overlay only after Create Lobby: host + inLobby
    // Use the same look/placement as joinLobby’s window
    const windowX = this.game.width * 0.2;
    const windowY = 150;
    const windowWidth = this.game.width * 0.6;
    const windowHeight = 200;
    // background
    context.fillStyle = "rgba(0, 0, 0, 0.7)";
    context.fillRect(windowX, windowY, windowWidth, windowHeight);

    // dynamic rows
    //START ALPHA CHANGE 276 — treat missing lobbyId as failure + show explicit network error
    const hasLobbyId = (!!sm && !!sm.lobbyId);
    const lobbyCreated = (!!sm && sm.lobbyState === "inLobby" && sm.isHost && hasLobbyId) ? "YES" : "NO"; //YES only if lobby ID is not null
    //const lobbyIdLine = (!!sm && sm.lobbyId) ? String(sm.lobbyId) : ""; -- legacy lobby numeric id not shown anymore
    const p2Joined = (!!sm && sm.opponentSteamId) ? "YES" : "NO";
    const p2pReady = (!!sm && sm._p2pReady) ? "YES" : "NO";

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const blinkOn = (((now / 400) | 0) % 2) === 0; // ~2.5 Hz blink

    // final status line logic
    //ALPHA CHANGE 276 — override status when no lobby id
        let status = "";
        if (!hasLobbyId) {
            status = blinkOn ? "NETWORK CONNECTION ERROR — LEAVE LOBBY AND TRY AGAIN" : "";
        } else if (!sm._p2pReady) {
            status = blinkOn ? "LOADING" : "";
        } else {
            status = blinkOn ? "YOU CAN START A MULTIPLAYER MATCH" : "";
        }
        //FINISH ALPHA CHANGE 276 — override status when no lobby id
//FINISH ALPHA CHANGE 85

    // draw lines (red; last one flashes)
    context.textAlign = "center";
    context.font = "28px " + this.fontFamily;
    const lineGap = 34;
    let lineY = windowY + 40;
    context.fillStyle = "#ff0000";
    context.fillText(`LOBBY CREATED: ${lobbyCreated}`, this.game.width / 2, lineY); lineY += lineGap;
    // Show friendly lobby name if we have it (host just created it)
    //START ALPHA CHANGE 277 — if no lobby id, show a clear failure message instead of hiding the line
    const smHostName = (this.game && this.game.steamMultiplayer && this.game.steamMultiplayer._friendlyLobbyName) || "";
    if (hasLobbyId && smHostName) {
    context.fillText(`LOBBY NAME: ${smHostName}`, this.game.width / 2, lineY);
    lineY += lineGap;
    } else if (!hasLobbyId) {
    context.fillText(`LOBBY NAME: CANNOT CREATE LOBBY`, this.game.width / 2, lineY);
    lineY += lineGap;
    }
    //FINISH ALPHA CHANGE 277 — failure message when lobby id is missing
    //context.fillText(`LOBBY ID: ${lobbyIdLine}`, this.game.width / 2, lineY);      lineY += lineGap; -- legacy lobby numeric id not shown anymore
    context.fillText(`PLAYER 2 JOINED LOBBY: ${p2Joined}`, this.game.width / 2, lineY); lineY += lineGap;
    context.fillText(`P2P CONNECTION ESTABLISHED: ${p2pReady}`, this.game.width / 2, lineY); lineY += lineGap;
    context.fillStyle = blinkOn ? "#ff0000" : "#880000";
    context.fillText(status, this.game.width / 2, lineY);
     } //FINISH ALPHA CHANGE 80
    //FINISH ALPHA CHANGE 79

    //START ALPHA CHANGE 217 -- make Region/Custom selectable items and fold them into the items list --
    const inLobby217 = (this.game.steamMultiplayer.lobbyState === "inLobby");
    // derive current region/custom for display
    const regs217 = (Array.isArray(this._lobbyRegions) && this._lobbyRegions.length) ? this._lobbyRegions : [{ code: "US", label: "United States" }];
    const rIdx217 = Math.max(0, Math.min(regs217.length - 1, (typeof this._lobbyRegionIndex === "number" ? this._lobbyRegionIndex : 0)));
    const r217 = regs217[rIdx217] || regs217[0];
    const code217 = r217.code, label217 = r217.label;
    const custom217 = ((this._lobbyCustomTag || "COOP").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 6)) || "COOP";

    // draw the preview line (still non-interactive) above the first selectable row
    if (!inLobby217) {
        //START ALPHA CHANGE 242 -- also draw the semi-transparent overlay in base Multiplayer state
        const widthFactor242 = 0.50; // tweak this (e.g., 0.50 .. 0.90) to change overlay width
        const windowW242 = Math.floor(this.game.width * widthFactor242);
        const windowX242 = Math.floor((this.game.width - windowW242) / 2);
        const windowY242 = 150;
        const windowH242 = 230;  //regola altezza 
        context.fillStyle = "rgba(0, 0, 0, 0.7)";
        context.fillRect(windowX242, windowY242, windowW242, windowH242);
        //FINISH ALPHA CHANGE 242 -- also draw the semi-transparent overlay in base Multiplayer state
        context.textAlign = "center";
        context.font = "28px " + this.fontFamily;
        context.fillStyle = "#ffe135"; //make preview lobby name yellow to match game UI
        const preview217 = `LOBBY NAME: INNBC_STAR_${code217}_${custom217}XXXXXX`;
        const previewY217 = (this.multiplayerStartY ? this.multiplayerStartY - 60 : 240);
        context.fillText(preview217, this.game.width / 2, previewY217);

        //START ALPHA CHANGE 254 -- helper block: add "Gamepad controls" heading & push farther left
        context.save();
        context.textAlign = "left";
        const helpX = Math.max(8, windowX242 - 290);  // — push farther left (was -220)
        const helpY0 = windowY242 + 28;
        // heading
        context.font = "20px " + this.fontFamily;
        context.fillStyle = "#867dffff";
        context.fillText("Gamepad controls", helpX, helpY0);
        // lines under the heading
        context.font = "18px " + this.fontFamily;
        context.fillText("D-Pad left/right select items/letters", helpX, helpY0 + 22);
        context.fillText("X/circle buttons confirm/delete letter", helpX, helpY0 + 44);
        context.fillText("D-pad Up/Down browse menu",           helpX, helpY0 + 66);
        context.restore();
        // ensure following text remains centered
        context.textAlign = "center";
        //FINISH ALPHA CHANGE 254 -- helper block: add heading & push farther left

        //START ALPHA CHANGE 256 -- right-side helper: "Keyboard controls"
        context.save();
        context.textAlign = "right";
        const helpRX = Math.min(this.game.width - 8, windowX242 + windowW242 + 280); //START ALPHA CHANGE 257 — push further right (was 140)
        const helpRY0 = windowY242 + 28;                 // align vertically with left helper heading
        // heading
        context.font = "20px " + this.fontFamily;
        context.fillStyle = "#867dffff";
        context.fillText("Keyboard controls", helpRX, helpRY0);
        // lines under the heading
        context.font = "18px " + this.fontFamily;
        context.fillText("left/right/mousewheel select items",           helpRX, helpRY0 + 22);
        context.fillText("type/backspace for letters/delete", helpRX, helpRY0 + 44);
        context.fillText("up/down to browse menu",            helpRX, helpRY0 + 66);
        context.restore();
        context.textAlign = "center"; // keep subsequent text centered
        //FINISH ALPHA CHANGE 256 -- right-side helper: "Keyboard controls"
        
        //START ALPHA CHANGE 258 -- left-lower helper near "Create Lobby" height (base state only)
        context.save();
        context.textAlign = "left";
        context.fillStyle = "#867dffff";
        // compute a y close to the "Create Lobby" row (index 2 in base menu)
        const createBaseY258 = (this.multiplayerStartY || (this.game.height / 2)) + 2 * this.multiplayerItemHeight;
        // position a bit to the left of the overlay; tweak -320 / +8 as you like
        const helpLX = Math.max(8, windowX242 - 280);
        const helpLY0 = createBaseY258 - 6; // small nudge; adjust to taste

        context.font = "18px " + this.fontFamily;
        context.fillText("Customize your lobby with", helpLX, helpLY0);
        context.fillText("location and tag and",      helpLX, helpLY0 + 20);
        context.fillText("create a lobby to host a game", helpLX, helpLY0 + 40);

        context.restore();
        // keep subsequent text centered
        context.textAlign = "center";
        //FINISH ALPHA CHANGE 258 -- left-lower helper near "Create Lobby" height (base state only)

        //START ALPHA CHANGE 278 -- "OR" in between
        context.save();
        context.textAlign = "left";
        context.fillStyle = "#867dffff";
        // compute a y close to the "Create Lobby" row (index 2 in base menu)
        const joinBaseY260 = createBaseY258 + this.multiplayerItemHeight + 32
        // position a bit to the left of the overlay; tweak -320 / +8 as you like
        const helpLXb = Math.max(8, windowX242 - 200);
        const helpLY0b = joinBaseY260 - 6; // small nudge; adjust to taste

        context.font = "18px " + this.fontFamily;
        context.fillText("or", helpLXb, helpLY0b);
        

        context.restore();
        // keep subsequent text centered
        context.textAlign = "center";
        //FINISH ALPHA CHANGE 278 -- "OR"in between 
        
        //START ALPHA CHANGE 259 -- left helper aligned with "Join Lobby" height (base state only)
        context.save();
        context.textAlign = "left";
        context.fillStyle = "#867dffff";
        // Compute Y EXACTLY like the menu rows do (no fallback), then add index*height
        const joinBaseY259 = createBaseY258 + this.multiplayerItemHeight + 80; //START ALPHA CHANGE 266 -- +80 matches the "Join Lobby" extra offset from the items loop
        // position to the left of the overlay; tweak -280 as you like
        const helpLXa = Math.max(8, windowX242 - 280);
        const helpLYb = joinBaseY259 - 6; // small nudge; adjust to taste

        context.font = "18px " + this.fontFamily;
        //START ALPHA CHANGE 261 -- replace multi-line helper with a single line
        context.fillText("join an already existing lobby", helpLXa, helpLYb);
        //FINISH ALPHA CHANGE 261

        context.restore();
        // keep subsequent text centered
        context.textAlign = "center";
        //FINISH ALPHA CHANGE 259 -- left helper aligned with "Join Lobby" height (base state only)
        
        
        // subheading right above the first selectable row
        const row0Y217 = (this.multiplayerStartY || (this.game.height / 2));
        context.font = "32px " + this.fontFamily;
        context.fillStyle = "#ff0000";
        context.fillText("Customize lobby name", this.game.width / 2, row0Y217 - 120); //ALPHA CHANGE 243 -- raise heading higher (80)
        
    }

    //START ALPHA CHANGE 223 -- flash the LAST letter when "Custom" is selected (no appended candidate) --
    const isCustomSelected223 = (!inLobby217 && this.selectedMultiplayerIndex === 1);
    const baseTag223 = String(this._lobbyCustomTag || "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 6);
    const blinkOn223 = (((Date.now() / 400) | 0) % 2) === 0; // ~2.5 Hz
    let customLabel223 = baseTag223;
    if (isCustomSelected223) {
        if (customLabel223.length === 0) {
            // If empty, show a flashing 'A' (field never visually empty when selected)
            customLabel223 = blinkOn223 ? "A" : " ";
        } else {
            // Flash the last letter: show substring up to last + (blink? last : space)
            const lastIdx = customLabel223.length - 1;
            const lastChar = customLabel223[lastIdx];
            customLabel223 = customLabel223.slice(0, lastIdx) + (blinkOn223 ? lastChar : " ");
        }
    }
    //FINISH ALPHA CHANGE 223 -- flash the LAST letter when "Custom" is selected --

    // Build selectable items. When not in lobby, prepend Region/Custom (dynamic labels).
    const items = inLobby217
        ? ["Start Game", "Leave Lobby"]
        : [
            `Region: ${code217} (${label217})`,   //START ALPHA CHANGE 217
            `Custom Tag: ${customLabel223}`,               //START ALPHA CHANGE 217 — use blinking label
            "Create Lobby",
            "Join Lobby",
            "Back"
          ]; //FINISH ALPHA CHANGE 217

    items.forEach((item, index) => {
        //START ALPHA CHANGE 84 -- push buttons below the overlay (top=150, height=200, extra gap=160)
        const overlayActive = (this.game.steamMultiplayer && this.game.steamMultiplayer.isHost && this.game.steamMultiplayer.lobbyState === "inLobby");
        const baseY = overlayActive ? (150 + 200 + 130) : this.multiplayerStartY; // 150(top) + 200(height) + 130(gap)
        let y = baseY + index * this.multiplayerItemHeight; // const y changed to let y -- make y mutable for per-item offsets to adjust them independently
        //FINISH ALPHA CHANGE 84

        //START ALPHA CHANGE 248 -- extra per-item offsets in base Multiplayer (not in-lobby)
        if (!inLobby217) {
            // tweak these three values to move each item independently
            if (item === "Create Lobby") y += 30;
            if (item === "Join Lobby")   y += 80;
            if (item === "Back")         y += 120;
        }
        //FINISH ALPHA CHANGE 248

        //START ALPHA CHANGE 79 -- grey-out Start Game if not available
        const isSelected = index === this.selectedMultiplayerIndex;
        const isStart = (item === "Start Game");
        const startAvail = sm && typeof sm.isStartGameAvailable === "function" ? sm.isStartGameAvailable() : false;
        if (isStart && !startAvail) {
            context.fillStyle = isSelected ? "#888888" : "#ffffff"; // grey when selected, white when not
        } else {
            context.fillStyle = isSelected ? "#ff0000" : "#ffffff";
        }
        //FINISH ALPHA CHANGE 79
        
        context.fillText(item, this.game.width / 2, y);
        this.multiplayerItemBounds[index] = {
            text: item, // includes dynamic Region/Custom labels for hit-testing/hover
            x: this.game.width / 2 - context.measureText(item).width / 2,
            y: y - 30,
            width: context.measureText(item).width,
            height: 40
        };
    });
    //FINISH ALPHA CHANGE 217 -- Region/Custom are now selectable items; buttons unchanged --
    //nota -- context.restore(); return; at the end of the branch in cui disegni qualcosa vanno messi sempre (come nelle altre) perchè Canvas state is global (persiste)
    context.restore(); //put the canvas back exactly how it was before this menu drew
    return; //stop drawing anything else for this frame
} else if (this.game.gameState === "joinLobby") {
    context.textAlign = "center";
            context.save();
            context.font = "50px " + this.fontFamily;
            context.fillStyle = "#778899";
            context.globalAlpha = 0.70; // adjust opacity to taste (e.g., 0.6–0.85)
            context.fillText("Join Lobby", this.game.width / 2, 50);
            context.restore();
            context.font = "40px " + this.fontFamily;
            this.multiplayerItemBounds = [];
            //START ALPHA CHANGE 98 -- flashing refresh indicator between title and window --
            try {
                const sm = this.game.steamMultiplayer;
                if (sm && typeof sm._lastLobbyRefreshAt === "number" && sm._lastLobbyRefreshAt > 0) {
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    const since = now - sm._lastLobbyRefreshAt;
                    if (since < 1000) { // show ~1s after any refresh
                        const blinkOn = (((now / 250) | 0) % 2) === 0; // fast blink
                        const label = (sm && sm._lastLobbyRefreshManual) ? "MANUAL REFRESH" : "REFRESHING..."; //START ALPHA CHANGE 102
                        context.save();
                        context.textAlign = "center";
                        context.font = "26px " + this.fontFamily;
                        context.fillStyle = blinkOn ? "#ff0000" : "#880000";
                        context.fillText(label, this.game.width / 2, 130);
                        context.restore();
                    }
                }
            } catch (e) { /* draw-safe */ }
            //FINISH ALPHA CHANGE 98 -- flashing refresh indicator between title and window --
            //start change -- split lobby list rendering from Refresh/Back buttons--
            const windowX = this.game.width * 0.2; // Window left edge posizione box lobby 
            const windowY = 150; // Below "Join Lobby" title
            const windowWidth = this.game.width * 0.6; // 40% of canvas width -- larghezza box lobby
            const windowHeight = this.game.height - 290; // Adjusted to leave space for buttons -- altezza box lobby (diminuisci lo fai piu grande)
            const scrollBarWidth = 10;
            const visibleItems = 10; // Number of visible lobby items
            const itemHeight = 40;
            //START ALPHA CHANGE 13 -- decouple scroll from selection; persist offset; auto-keep in view only when list has focus--
            if (typeof this.joinLobbyScrollOffset !== "number") this.joinLobbyScrollOffset = 0;

            // Compute list to render exactly like hit-testing does
            const hasReal = Array.isArray(this.game.steamMultiplayer.lobbies) && this.game.steamMultiplayer.lobbies.length > 0;
            const totalRows = hasReal ? this.game.steamMultiplayer.lobbies.length
                                      : (this.debugJoinLobby ? (this.debugJoinLobbyCount || 10) : 0);

            let scrollOffset = Math.max(0, Math.min(this.joinLobbyScrollOffset, Math.max(0, totalRows - visibleItems)));

            // If keyboard/gamepad is moving selection in the list, keep it visible
            if (this.joinLobbyFocus === 'list' && this.selectedMultiplayerIndex >= 0) {
                if (this.selectedMultiplayerIndex < scrollOffset) {
                    scrollOffset = this.selectedMultiplayerIndex;
                } else if (this.selectedMultiplayerIndex >= scrollOffset + visibleItems) {
                    scrollOffset = this.selectedMultiplayerIndex - visibleItems + 1;
                }
                // Persist any auto-adjustments
                this.joinLobbyScrollOffset = scrollOffset;
            }
            //FINISH ALPHA CHANGE 13 -- adjust offset of lobbywheel for mouse wheel moving input
            // Draw window background
            context.fillStyle = "rgba(0, 0, 0, 0.7)"; // Semi-transparent black
            context.fillRect(windowX, windowY, windowWidth, windowHeight);
             //START ALPHA CHANGE 16 — side help text (center-left inside the lobby window)
            (function drawJoinLobbyHelp(ctx, x, y, w, h, fontFamily) {// NOTE: 'w' (window width) is intentionally kept for future layout tweaks (It's currently unused, but we keep it to preserve the argument order and avoid accidental param shifting)
                const helpLines = [
                    "move list:",
                    "Analog up/down",
                    "mousewheel"
                ];
                ctx.save();
                ctx.textAlign = "left";
                ctx.font = "24px " + fontFamily;
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                const gutter = 220;                 // push left by this many px
                const colX   = Math.max(10, x - gutter); // clamp so it stays on canvas
                const lineH  = 28;
                const totalH = lineH * helpLines.length;
                let baseY    = y + (h - totalH) / 2 + 24; // vertically centered

                for (let i = 0; i < helpLines.length; i++) {
                    ctx.fillText(helpLines[i], colX, baseY + i * lineH);
                }
                ctx.restore();
            })(context, windowX, windowY, windowWidth, windowHeight, this.fontFamily); //(if you remove the unused "w" also remove "windowWidth" to preserve the IIFE call order)
            //FINISH ALPHA CHANGE 16
            //START ALPHA CHANGE 17 -- helper label aligned with buttons row (same Y as "Refresh"), pushed further left
            const buttonsBaseY = windowY + windowHeight + 50; // baseline Y used for the "Refresh" row
            (function drawButtonsHelp(ctx, x, y, fontFamily) {
               ctx.save();
                ctx.textAlign = "left";
                ctx.font = "24px " + fontFamily;
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                const gutter = 220;                        // move left from the lobby window by this many px
                const helpX  = Math.max(10, x - gutter);   // clamp to keep it on-canvas

                // two-line helper to reduce horizontal width
                const line1 = "menu buttons:";
                const line2 = "D-pad";
                const lineGap = 28; // px between lines

                ctx.fillText(line1, helpX, y);
                ctx.fillText(line2, helpX, y + lineGap);

                ctx.restore();
            })(context, windowX, buttonsBaseY, this.fontFamily);
            //FINISH ALPHA CHANGE 17

             // Prepare lobby list (always an array, even if empty)
            // start change -- derive local sourceLobbies; when debugJoinLobby=true, synthesize fake rows --
            const sourceLobbies = (this.debugJoinLobby && this.game.steamMultiplayer.lobbies.length === 0)
                ? Array.from({ length: this.debugJoinLobbyCount }, (_, k) => ({
                    id: `FAKE12345678910-${(101 + k)}`,
                    players: (k % 2) + 1
                }))
                : this.game.steamMultiplayer.lobbies;
                // Use friendly name when available (fallback to numeric id)
            const lobbyItems = sourceLobbies.map(lobby => `Lobby ${(lobby.name || lobby.id)} (${lobby.players}/2)`);
            // finish change -- derive local sourceLobbies --

            //START ALPHA CHANGE 86 -- joinLobby “joined overlay” state for client
            const sm = this.game.steamMultiplayer;
            const overlayActive = !!(sm && sm.lobbyState === "inLobby" && !sm.isHost);

            // When overlay is active, show status lines and only a “Leave Lobby” button
            if (overlayActive) {
                // force JoinLobby buttons to just [Leave Lobby] so keyboard logic matches draw
                this.joinLobbyItems = ["Leave Lobby"];

                // status panel (reuse same window rect)
                context.fillStyle = "rgba(0, 0, 0, 0.7)";
                context.fillRect(windowX, windowY, windowWidth, windowHeight);

                context.textAlign = "center";
                context.font = "26px " + this.fontFamily;

                const joinedYes = "YES";
                const lobbyIdStr = sm && sm.lobbyId ? String(sm.lobbyId) : "";
                //START ALPHA CHANGE 89 -- client overlay: treat P2P as "YES" once we've SENT PONG (UI-only)
                const p2pLikely = !!(sm && sm._p2pLikelyEstablished);
                const p2pYes = p2pLikely ? "YES" : "NO";
                //FINISH ALPHA CHANGE 89

                // rows
                context.fillStyle = "#ff0000";
                context.fillText(`LOBBY JOINED: ${joinedYes}`, windowX + windowWidth / 2, windowY + 60);
                //START ALPHA CHANGE 234 -- prefer friendly lobby name; fallback to numeric ID --
                const lobbyNameStr = (sm && sm._friendlyLobbyName) ? sm._friendlyLobbyName : lobbyIdStr;
                context.fillText(`LOBBY NAME: ${lobbyNameStr}`, windowX + windowWidth / 2, windowY + 100);
                //FINISH ALPHA CHANGE 234 -- prefer friendly lobby name; fallback to numeric ID --
                context.fillText(`P2P CONNECTION ESTABLISHED: ${p2pYes}`, windowX + windowWidth / 2, windowY + 140);

                // bottom flashing status
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const blinkOn = (((now / 350) | 0) % 2) === 0;
                const statusText = p2pLikely ? "WAITING FOR HOST TO START THE GAME" : "LOADING"; //START ALPHA CHANGE 90 -- keep bottom status in sync with same UI-only flag
                context.fillStyle = blinkOn ? "#ff0000" : "#880000";
                context.fillText(statusText, windowX + windowWidth / 2, windowY + windowHeight - 30);

                // render single “Leave Lobby” button at the usual buttons row
                this.joinLobbyItemBounds = [];
                const y = windowY + windowHeight + 50;
                const btn = this.joinLobbyItems[0];
                context.fillStyle = (this.joinLobbyFocus === 'buttons' && this.selectedJoinLobbyIndex === 0) ? "#ff0000" : "#ffffff";
                context.fillText(btn, this.game.width / 2, y);
                this.joinLobbyItemBounds[0] = {
                    text: btn,
                    x: this.game.width / 2 - context.measureText(btn).width / 2,
                    y: y - 30,
                    width: context.measureText(btn).width,
                    height: 40,
                    action: "leave" //START ALPHA CHANGE 86
                };

                context.restore();
                return;
            }
            //FINISH ALPHA CHANGE 86 -- joined overlay

            //START ALPHA CHANGE 94 -- reset Join Lobby buttons when overlay is NOT active
            this.joinLobbyItems = ["Refresh", "Back"];
            //FINISH ALPHA CHANGE 94 -- reset Join Lobby buttons when overlay is NOT active

            // Draw "Loading..." if no lobbies
            if (lobbyItems.length === 0) {
                context.fillStyle = "#ffffff";
                context.font = "30px " + this.fontFamily;
                context.fillText("Loading...", windowX + windowWidth / 2, windowY + windowHeight / 2);
            }

            // Draw visible lobby items only
            const maxVisibleIndex = Math.min(scrollOffset + visibleItems, lobbyItems.length);
            for (let i = scrollOffset; i < maxVisibleIndex; i++) {
                const item = lobbyItems[i];
                const y = windowY + 47 + (i - scrollOffset) * itemHeight; //regola altezza lobby list 
                context.fillStyle = i === this.selectedMultiplayerIndex ? "#ff0000" : "#ffffff";
                context.fillText(item, windowX + windowWidth / 2, y);
                this.multiplayerItemBounds[i] = {
                    text: item,
                    x: windowX + windowWidth / 2 - context.measureText(item).width / 2,
                    y: y - 30,
                    width: context.measureText(item).width,
                    height: 40,
                    action: "joinLobby",
                    lobbyId: sourceLobbies[i]?.id || null // start change -- bind to local source --
                };
            }
            // Draw scrollbar (based on lobby items only)
            if (lobbyItems.length > visibleItems) {
                const scrollBarHeight = (visibleItems / lobbyItems.length) * windowHeight;
                const scrollBarY = windowY + (scrollOffset / lobbyItems.length) * (windowHeight - scrollBarHeight);
                context.fillStyle = "#888888";
                context.fillRect(windowX + windowWidth - scrollBarWidth - 5, scrollBarY, scrollBarWidth, scrollBarHeight);
            }
            // start change -- allow “no selection” (-1) unless focus is on the list --
            if (this.joinLobbyFocus === 'list' && this.selectedMultiplayerIndex >= 0) {
                // Clamp only when the list actually has focus and a row is selected
                this.selectedMultiplayerIndex = Math.min(lobbyItems.length - 1, this.selectedMultiplayerIndex);
            } else if (this.joinLobbyFocus !== 'list') {
                // Keep the list unselected when focus is on buttons or mouse not over list
                this.selectedMultiplayerIndex = -1;
            }
            // Sync Steam selectedLobbyIndex only when a valid row is selected
            if (this.selectedMultiplayerIndex >= 0 && this.selectedMultiplayerIndex < lobbyItems.length) {
                this.game.steamMultiplayer.selectedLobbyIndex = this.selectedMultiplayerIndex;
            }
            // finish change

            // Render Refresh/Back buttons using joinLobbyItems
            this.joinLobbyItemBounds = [];
            this.joinLobbyItems.forEach((btn, idx) => {
                const y = windowY + windowHeight + 50 + idx * this.joinLobbyItemHeight; // Position below lobby window posizione back e refresh
                // start change -- buttons highlight only when buttons have focus --
                context.fillStyle = (this.joinLobbyFocus === 'buttons' && idx === this.selectedJoinLobbyIndex) ? "#ff0000" : "#ffffff";
                // finish change
                context.fillText(btn, this.game.width / 2, y);
                this.joinLobbyItemBounds[idx] = {
                    text: btn,
                    x: this.game.width / 2 - context.measureText(btn).width / 2,
                    y: y - 30,
                    width: context.measureText(btn).width,
                    height: 40,
                    action: btn.toLowerCase() // "refresh" or "back"
                };
            });
            //console.log("joinLobby rendered: lobbyItems=", lobbyItems, "joinLobbyItems=", this.joinLobbyItems); // Debug log
            //finish change -- split lobby list rendering from Refresh/Back buttons--
    context.restore(); //put the canvas back exactly how it was before this menu drew
    return; //stop drawing anything else for this frame
//start change -- simplify INNBC Universe to match main menu style//
} else if (this.game.gameState === "innbcUniverse") {
    const page = this.game.innbcUniverse.innbcUniversePages[this.game.innbcUniverse.currentUniversePage];

    //START ALPHA CHANGE 501 -- Universe pages: prefer pre-scaled cached ImageBitmap when available --
    const al = this.game.assetsLoading;
    const _pageImg = page && page.image;
    const _pageId = (_pageImg && _pageImg.id) ? _pageImg.id : null;
    const _pageKey = _pageId ? (`img:${_pageId}:scaled:${this.game.width}x${this.game.height}`) : null;
    const _readyPage = (_pageKey && al && typeof al.getCachedOrFallback === "function")
        ? al.getCachedOrFallback(_pageKey, _pageImg)
        : _pageImg;
    context.drawImage(_readyPage, 0, 0, this.game.width, this.game.height); // Full-screen stretch -- fallback to legacy image path if cached not available
    //FINISH ALPHA CHANGE 501 -- Universe pages: prefer pre-scaled cached ImageBitmap when available --

    context.textAlign = "center";
    context.font = "50px " + this.fontFamily;
    //START ALPHA CHANGE 525 -- Universe UI: show LATEST NEWS title (no overlap) + smaller body font on News page --
    const isNews534 = (this.game.innbcUniverse.currentUniversePage === 4);
    //FINISH ALPHA CHANGE 525 -- Universe UI: show LATEST NEWS title (no overlap) + smaller body font on News page --
    context.save();
    context.fillStyle = "#778899";
    //START ALPHA CHANGE 525 -- Universe UI: dynamic title per page --
    context.fillText(isNews534 ? "LATEST NEWS" : "INNBC Universe", this.game.width / 2, 100);
    //FINISH ALPHA CHANGE 525 -- Universe UI: dynamic title per page --
    context.restore();
    context.font = "30px " + this.fontFamily;
    this.innbcUniverseItemBounds = []; // Clear bounds
    //start change for firt page of innbcUniverse
    const menuItems = [];
// Manually split text into 3-4 lines for all pages based on natural breaks
const splitText = (text) => {
    if (this.game.innbcUniverse.currentUniversePage === 0) {
        return [
            text.slice(0, 28), // "The Earth faces annihilation"
            text.slice(28, 62), // "from technorganic alien invaders,"
            text.slice(62, 83), // "monstrous beings of"
            text.slice(83, 100) // "flesh and machine"
        ];
    } else if (this.game.innbcUniverse.currentUniversePage === 1) {
        return [
            text.slice(0, 38), // "INNBC Corp scientists reverse-engineer"
            text.slice(38, 86), // "the alien tech to build the INNBC Starfighter,"
            text.slice(86, 137), // "humanity’s only hope! The ship can feed on the same"
            text.slice(137) // "energy carrying aliens feeding their hive"
        ];
    } else if (this.game.innbcUniverse.currentUniversePage === 2) {
        return [
            text.slice(0, 38), // "In reality, Innovative Bioresearch Ltd"
            text.slice(38, 90), // "harnesses science to fight humanity’s real threats,"
            text.slice(90, 142), // "like HIV and cancer. Founded by Dr. Jonathan Fior,"
            text.slice(142, 192), // "Innovative Bioresearch pioneers HIV cure research"
            text.slice(192, 217) // "using SupT1 cell therapy"
        ];
    } else if (this.game.innbcUniverse.currentUniversePage === 3) {
        return [
            text.slice(0, 47), // "Using the INNBC token and games, Fior’s company"
            text.slice(47, 103), // "funds disruptive biomedical research and decentralizes"
            text.slice(103, 149), // "science (DeSci), storing research data on the blockchain"
            text.slice(149) // "for transparency"
        ];
    } 
    //START ALPHA CHANGE 525 -- Universe UI: News page line slicing (manual, no \n wrapping) --
        else if (this.game.innbcUniverse.currentUniversePage === 4) {
            return [
                "• INNBC L1 blockchain coming: next gen chain for DeSci and gaming!",
                "  Fast (up to 65,000 TPS) and dev friendly (EVM compatible).",
                "  Native INNBC coin for gas that replaces current INNBC ERC20 token",
                "",
                "• INNBC Wallet coming: INNBC chain will also have its own native crypto wallet",
                "  with snappy, snooth, and intuitive interface + multichain support",
                "",
                "• The INNBC DApp study has been Cited by Harvard University in a new paper",
                "  authored by Peter Novak. Our previous work on decentralized blockchain",
                "  technology is now recognized as a possible key component in advanced digital",
                "  twin health solutions"
            ];
        }
    //FINISH ALPHA CHANGE 525 -- Universe UI: News page line slicing (manual, no \n wrapping) --
    else if (this.game.innbcUniverse.currentUniversePage === 5) { //Universe UI: Credits page moved to index 5 after inserting News --
        return [
             text.slice(0, 69), // "Art, Animation, Programming, Game Design, Sound Design: Jonathan Fior"
             text.slice(69) // "Original Soundtrack by: KHA!"
        ];
    }
    return [text]; // Default to single line if no match
};

//START ALPHA CHANGE 525 -- Universe UI: fix menuItems push + spread split lines --
    menuItems.push(...splitText(page.text));
    //FINISH ALPHA CHANGE 528 -- Universe UI: fix menuItems push + spread split lines --

    //START ALPHA CHANGE 525 -- Universe UI: tighter line spacing on News page so it stays on-screen --
    const lineH534 = isNews534 ? 34 : 40; //il primo numero se lo aumenti aumenti l'interlinea
    const textStartY = this.game.height / 2 - (menuItems.length * lineH534) / 2 - (isNews534 ? 30 : 70); //altezza testo - (isNews534 ? 30 : 70) -- primo numero diminuisci va piu in basso
    //FINISH ALPHA CHANGE 525 -- Universe UI: tighter line spacing on News page so it stays on-screen --

    menuItems.forEach((item, index) => {
        const y = textStartY + index * lineH534;

        //START ALPHA CHANGE 525 -- Universe News: embed link phrase INSIDE the line (blue + underlined + clickable) --
        let embeddedHit535 = null;
        if (isNews534 && page && Array.isArray(page.links)) {
            embeddedHit535 = page.links.find(l =>
                l && typeof l.phrase === "string" && l.phrase && (item.indexOf(l.phrase) !== -1)
            ) || null;
        }

        if (embeddedHit535) {
            const phrase535 = embeddedHit535.phrase;
            const idx535 = item.indexOf(phrase535);
            const before535 = item.slice(0, idx535);
            const after535  = item.slice(idx535 + phrase535.length);

            context.save();

            // We want the whole line centered, but draw pieces with left-align.
            const fullW535 = context.measureText(item).width;
            let x535 = (this.game.width / 2) - (fullW535 / 2);
            context.textAlign = "left";

            // before (yellow)
            context.fillStyle = "#ffe135";
            context.fillText(before535, x535, y);
            x535 += context.measureText(before535).width;

            // phrase (blue)
            context.fillStyle = "#00f";
            context.fillText(phrase535, x535, y);

            // underline phrase only
            const phraseW535 = context.measureText(phrase535).width;
            context.lineWidth = 3;  //make underline clearly visible --
            context.lineCap = "round"; //make underline clearly visible --
            context.beginPath();
            context.moveTo(x535, y + 5);
            context.lineTo(x535 + phraseW535, y + 5);
            context.strokeStyle = "#00f";
            context.stroke();

            // clickable bounds ONLY for phrase
            this.innbcUniverseItemBounds.push({
                text: phrase535,
                x: x535 - 10,
                y: y - 30,
                width: phraseW535 + 20,
                height: 40,
                action: "Link",
                url: embeddedHit535.url
            });

            x535 += phraseW535;

            // after (yellow)
            context.fillStyle = "#ffe135";
            context.fillText(after535, x535, y);

            context.restore();
        } else {
            context.fillStyle = "#ffe135";
            context.fillText(item, this.game.width / 2, y);

            this.innbcUniverseItemBounds.push({
                text: item,
                x: this.game.width / 2 - context.measureText(item).width / 2,
                y: y - 30,
                width: context.measureText(item).width,
                height: 40,
                action: "Static"
            });
        }
        //FINISH ALPHA CHANGE 525 -- Universe News: embed link phrase INSIDE the line (blue + underlined + clickable) --
    });
    // Option 1: Fix Links -- solo per News page non includiamo i links al bottom and li includiamo dentro il testo (!isNews534)
    // Keep linkStartY relative to original startY for consistency with buttons
    const originalStartY = this.game.height / 2 - (menuItems.length * 40) / 2; // Recalculate original position
    if (!isNews534 && page.links.length > 0) { // Render links below all text with spacing + News page: suppress bottom link-list (links are embedded inline on News) -- ALPHA 525
        const linkStartY = originalStartY + menuItems.length * 40 + 100; // Maintain original offset
        page.links.forEach((link, linkIndex) => {
            const linkText = link.phrase;
            const x = this.game.width / 2; // removed "- context.measureText(linkText).width / 2;" center without offset adjustment
            context.textAlign = "center"; // Ensure proper centering
            const linkY = linkStartY + linkIndex * 60; // Increased vertical space
            context.fillStyle = "#00f"; // Blue for links
            context.fillText(linkText, x, linkY);
            context.beginPath();
            context.moveTo(x - context.measureText(linkText).width / 2, linkY + 5);
            context.lineTo(x + context.measureText(linkText).width / 2, linkY + 5);
            context.strokeStyle = "#00f";
            context.stroke();
            //START ALPHA CHANGE 527 -- Universe: optional subtext under link phrase (same blue) --
            if (link && typeof link.subtext === "string" && link.subtext) {
                context.save();
                context.fillStyle = "#00f";
                context.font = "25px " + this.fontFamily;
                context.textAlign = "center";
                context.textBaseline = "alphabetic";
                // draw below the link hitbox so it's "under" the link and not clickable
                context.fillText(link.subtext, x, linkY + 40);
                context.restore();
            }
            //FINISH ALPHA CHANGE 527 -- Universe: optional subtext under link phrase (same blue) --
            this.innbcUniverseItemBounds.push({
                text: linkText,
                x: x - context.measureText(linkText).width / 2 - 10, // Adjusted for wider hitbox
                y: linkY - 30,
                width: context.measureText(linkText).width + 40,
                height: 60, // Taller hitbox
                action: "Link",
                url: link.url
            });
            context.fillStyle = "#ffffff"; // Reset color
            context.textAlign = "center"; // Reset alignment
        });
    }
    // Option 2: Remove Links (uncomment and remove Option 1 if preferred)
    // // Links removed
    // Add navigation buttons below text
    // Add navigation buttons on the sides
context.font = "30px " + this.fontFamily; // Buttons
const buttonItems = [];
if (this.game.innbcUniverse.currentUniversePage > 0) buttonItems.push("Back");
else buttonItems.push("Main Menu"); // "Main Menu" on first page
if (this.game.innbcUniverse.currentUniversePage < this.game.innbcUniverse.innbcUniversePages.length - 1) buttonItems.push("Next");
if (this.game.innbcUniverse.currentUniversePage === this.game.innbcUniverse.innbcUniversePages.length - 1) buttonItems.push("Main Menu");
// MODIFIED: Changed 'startY' to 'originalStartY' to keep buttons at original position
const buttonY = originalStartY + menuItems.length * 40 + 20; // Single row for buttons
const totalItems = this.innbcUniverseItemBounds.length; // Current total bounds before buttons
buttonItems.forEach((item, index) => {
    const x = index === 0 ? this.game.width * 0.4 : this.game.width * 0.60; // Your preferred positions
    const buttonIndex = totalItems + index; // Assign as last two indices
    const isSelected = this.selectedInnbcUniverseIndex === buttonIndex; // Match exact button index
    context.fillStyle = isSelected ? "#ff0000" : "#ffffff";
    context.fillText(item, x, buttonY);
    this.innbcUniverseItemBounds.push({
        text: item,
        x: x - context.measureText(item).width / 2 - 50, // Wider left shift
        y: buttonY - 30,
        width: context.measureText(item).width + 120, // Wider hitbox
        height: 50, // Taller hitbox
        action: item === "Back" ? "Back" : item === "Next" ? "Next" : "MenuBack"
    });
});
this.selectedInnbcUniverseIndex = Math.min(this.selectedInnbcUniverseIndex, this.innbcUniverseItemBounds.length - 1);
    context.restore(); //put the canvas back exactly how it was before this menu drew
    return; //stop drawing anything else for this frame
}
//finish change//
    // START FIX: Handle space key display for Fire and add key conflict message
    if (this.game.gameState === "options") {
        context.textAlign = "center";
        context.font = "50px " + this.fontFamily;
        context.save();
        context.fillStyle = "#778899";
        context.globalAlpha = 0.70; // adjust opacity to taste (e.g., 0.6–0.85) -- make the OPTIONS title semi-transparent
        context.fillText("Options", this.game.width / 2, 50);
        context.restore();
        context.font = "40px " + this.fontFamily;
        this.optionsItemBounds = []; // Clear previous bounds
        this.optionsItems.forEach((item, index) => {
            const y = this.optionsStartY + index * this.optionsItemHeight;
            context.fillStyle = index === this.selectedOptionIndex ? "#ff0000" : "#ffffff";
            const keyDisplay = item.key() === " " ? "Space" : item.key() || "None"; // Display "Space" for space key
            //START ALPHA CHANGE 287
            // Render Difficulty label (no blink), mapped from timeLimit --
            let text;
            if (item.action === "Timer") { // START ALPHA CHANGE 434 -- remove hard from timer and set it to hardMode
                const EASY   = 120000;
                let diff;
                if (this.game.hardMode)                   diff = "Hard";
                else if ((this.game.timeLimit|0) >= EASY) diff = "Easy";
                else                                      diff = "Normal";
                text = `Difficulty: ${diff}`;   // FINISH ALPHA CHANGE 434
            } else {
                  text = item.action === "Back" ? "Back" : 
                         item.action === "FPS Counter" ? `FPS Counter: ${this.game.showFPS ? 'On' : 'Off'}` :
                         item.action === "Full Screen" ? `Full Screen: ${this.game.fullScreen ? 'On' : 'Off'}` : 
                         item.action === "Gamepad Setup" ? "Gamepad Setup" : 
                         item.action === "Reset All Settings" ? "Reset All Settings" :
                         //START ALPHA CHANGE 201 -- show Reset Score without suffix --
                         item.action === "Reset Score" ? "Reset Score" :
                         //FINISH ALPHA CHANGE 201 -- show Reset Score without suffix -- 
                         `${item.action}: ${keyDisplay}`; // Added for reset, metti un : aggiungi item.action === "tasti" e mandi avanti la parte finale
                         }
            //FINISH ALPHA CHANGE 287 -- render Difficulty label (no blink), mapped from timeLimit --
            context.fillText(text, this.game.width / 2, y);
            this.optionsItemBounds[index] = {
                action: item.action,
                x: this.game.width / 2 - context.measureText(text).width / 2,
                y: y - 30,
                width: context.measureText(text).width,
                height: 40
            };
        });
        //START ALPHA CHANGE 720 -- options: keep keybind helper text on-screen (avoid off-canvas when options list grows) --
        const hintX720 = this.game.width * 0.182;
        const hintY720 = this.game.height * 0.18;
        if (this.awaitingKeyInput) {
            context.font = "30px " + this.fontFamily;
            context.fillStyle = "white";
            context.fillText("Press a key to bind (ESC/Create to cancel)", hintX720, hintY720);
        }
        if (this.game.keyConflict) {
            context.font = "30px " + this.fontFamily;
            context.fillStyle = "#ff0000"; // Red for emphasis
            context.fillText("Key already in use, choose another", hintX720, hintY720 + 30);
        //FINISH ALPHA CHANGE 720 -- options: keep keybind helper text on-screen (avoid off-canvas when options list grows) --
        }
        context.restore();
        return;
    }
    //start change -- render gamepad setup submenu//
if (this.game.gameState === "gamepadSetup") {
    context.textAlign = "center";
    context.font = "50px " + this.fontFamily;
    context.save();
    context.fillStyle = "#778899";
    context.globalAlpha = 0.70;
    context.fillText("Gamepad Setup", this.game.width / 2, 50);
    context.restore(); 
    context.fillStyle = "#ffe135";
    context.font = "30px " + this.fontFamily;
    context.fillText("Game tested with Sony PS5 gamepad", this.game.width / 2, this.game.height - 40);
    context.font = "40px " + this.fontFamily;
    this.gamepadItemBounds = []; // Clear previous bounds
    //16 buttons and and axes -- so we size lastGamepadButtons to 16 (ALPHA CHANGE 730)
    const buttonNameMap = { //nomi assegnati ai bottoni nella UI (fallback "const inputDisplay")
        "button_0": "X",
        "button_1": "Circle",
        "button_2": "Square",
        "button_3": "Triangle",
        "button_4": "L1",
        "button_5": "R1",
        "button_6": "L2",
        "button_7": "R2",
        "button_8": "Create",
        "button_9": "Start",
        "button_10": "L3",
        "button_11": "R3",
        "button_12": "D-pad Up",    // Changed from missing
        "button_13": "D-pad Down",  // Changed from "Touchpad"
        "button_14": "D-pad Left",  // Added
        "button_15": "D-pad Right", // Added
        "axis_0_neg": "Left Stick Left",
        "axis_0_pos": "Left Stick Right",
        "axis_1_neg": "Left Stick Up",
        "axis_1_pos": "Left Stick Down"
    };
    this.gamepadItems.forEach((item, index) => {
        const y = this.gamepadStartY + index * this.gamepadItemHeight;
        context.fillStyle = index === this.selectedGamepadIndex ? "#ff0000" : "#ffffff";
        const inputDisplay = buttonNameMap[item.input()] || item.input() || "None";
        const text = item.action === "Back" ? "Back" : `${item.action}: ${inputDisplay}`;
        context.fillText(text, this.game.width / 2, y);
        this.gamepadItemBounds[index] = {
            action: item.action,
            x: this.game.width / 2 - context.measureText(text).width / 2,
            y: y - 30,
            width: context.measureText(text).width,
            height: 40
        };
    });
    if (this.awaitingGamepadInput) {
        context.font = "30px " + this.fontFamily;
        context.fillStyle = "white";
        context.fillText("Press a button or move stick (ESC/Create to cancel)", this.game.width / 2, this.gamepadStartY + this.gamepadItems.length * this.gamepadItemHeight + 30);
    }
    //start change -- add Triangle (button_3) to cancel gamepad binding and fix X/Circle conflicts//
    if (this.game.gamepadConflict) {
        context.font = "30px " + this.fontFamily;
        context.fillStyle = "#ff0000";
        context.fillText("Input already in use, choose another", this.game.width / 2, this.gamepadStartY + this.gamepadItems.length * this.gamepadItemHeight + 60);
    }
    context.restore();
    return;
}
//finish change//
    // END FIX
    // END CHANGE
        // FINISHED EIGHTH CHANGE
            context.font = "20px " + this.fontFamily;        
            // Ammo bar inline with label (topmost)
            context.fillStyle = "white"; // Reset color for text
            //START ALPHA CHANGE 177 -- force left-anchored HUD each frame to avoid alignment leaks --
            context.textAlign = "left";
            //FINISH ALPHA CHANGE 177
            //START ALPHA CHANGE 366 -- MP HUD: "TEAM AMMO" label (SP unchanged) --
            const _isMP_HUD = !!(this.game && this.game.steamMultiplayer && this.game.steamMultiplayer.isMultiplayer);
            const _ammoLabel = _isMP_HUD ? "TEAM AMMO: " : "AMMO: ";
            context.fillText(_ammoLabel, 20, 40); // Moved to y=40

            //START ALPHA CHANGE 338 -- replace AMMO ticks with a continuous bar + centered % label --
            (function drawAmmoBar(ctx, ui) {
                // preserve color rule: power-up -> #ff0000 else #ffff00
                const barColor = ((ui.game.player && ui.game.player.powerUp) || (ui.game.player2 && ui.game.player2.powerUp)) ? "#ff0000" : "#ffff00";
                const labelWidth = ctx.measureText(_ammoLabel).width; // use the same label we drew -- FINISH ALPHA CHANGE 366 -- MP HUD: "TEAM AMMO" label (SP unchanged) --
                const x = 20 + labelWidth + 10;   // small gap after label
                const y = 22;                     // top edge so text baseline is ~40
                const w = 250;                    // similar footprint to previous ticks (≈50*5px)
                const h = 22;
            

                // background + border
                ctx.save();
                ctx.fillStyle = "rgba(255,255,255,0.15)";
                ctx.fillRect(x, y, w, h);
                ctx.strokeStyle = "rgba(255,255,255,0.6)";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, w, h);

                // fill based on ammo ratio
                const max = ui.game.maxAmmo || 50;
                const curr = Math.max(0, Math.min(max, ui.game.ammo|0));
                const ratio = max > 0 ? (curr / max) : 0;
                ctx.fillStyle = barColor;
                ctx.fillRect(x, y, Math.round(w * ratio), h);

                // centered white percentage text
                const pct = Math.round(ratio * 100) + "%";
                const oldAlign = ctx.textAlign, oldFill = ctx.fillStyle, oldFont = ctx.font;
                ctx.textAlign = "center";
                ctx.fillStyle = "#ffffff";
                ctx.font = "16px " + ui.fontFamily;
                ctx.fillText(pct, x + w / 2, y + h * 0.72);
                ctx.textAlign = oldAlign; ctx.fillStyle = oldFill; ctx.font = oldFont;

                ctx.restore();
            })(context, this);
            //FINISH ALPHA CHANGE 338 -- replace AMMO ticks with a continuous bar + centered % label --

            // Shield bar inline with label
            context.fillStyle = "white"; // Reset color for text
            const _shieldLabel = _isMP_HUD ? "TEAM SHIELD: " : "SHIELD: "; //START ALPHA CHANGE 367 -- MP HUD: "TEAM SHIELD" label (SP unchanged) --
            context.fillText(_shieldLabel, 20, 70); // Moved to y=70

            //START ALPHA CHANGE 339 -- replace SHIELD ticks with a continuous bar + centered % label --
            (function drawShieldBar(ctx, ui) {
                // preserve color rule: power-up -> #ff00ff else #0000ff (altre belle varianti #00bfff, #448EE4, #00bfff)
                const barColor = ((ui.game.player && ui.game.player.powerUp) || (ui.game.player2 && ui.game.player2.powerUp)) ? "#ff00ff" : "#0000ff";
                const labelWidth = ctx.measureText(_shieldLabel).width; // use the same label we drew -- FINISH ALPHA CHANGE 367 -- MP HUD: "TEAM SHIELD" label (SP unchanged) --
                const x = 20 + labelWidth + 10;
                const y = 52;                     // aligns visually beneath ammo
                const w = 250;
                const h = 22;

                ctx.save();
                ctx.fillStyle = "rgba(255,255,255,0.15)";
                ctx.fillRect(x, y, w, h);
                ctx.strokeStyle = "rgba(255,255,255,0.6)";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, w, h);

                const max = ui.game.maxShieldEnergy || 50;
                const curr = Math.max(0, Math.min(max, ui.game.shieldEnergy|0));
                const ratio = max > 0 ? (curr / max) : 0;
                ctx.fillStyle = barColor;
                ctx.fillRect(x, y, Math.round(w * ratio), h);

                const pct = Math.round(ratio * 100) + "%";
                const oldAlign = ctx.textAlign, oldFill = ctx.fillStyle, oldFont = ctx.font;
                ctx.textAlign = "center";
                ctx.fillStyle = "#ffffff";
                ctx.font = "16px " + ui.fontFamily;
                ctx.fillText(pct, x + w / 2, y + h * 0.72);
                ctx.textAlign = oldAlign; ctx.fillStyle = oldFill; ctx.font = oldFont;

                ctx.restore();
            })(context, this);
            //FINISH ALPHA CHANGE 339 -- replace SHIELD ticks with a continuous bar + centered % label --

            // Score
            context.fillStyle = "white"; // Reset color
            //context.fillText("INNBC SCORE: " + this.game.score, 20, 100); // Moved to y=100, renamed to "SCORE" -- legacy commented out
            //START ALPHA CHANGE 356 -- UI: in multiplayer show "TEAM SCORE", else keep "INNBC SCORE"   
            const sm = this.game && this.game.steamMultiplayer;
            const isMP = !!(sm && sm.isMultiplayer);
            const label = isMP ? "TEAM SCORE: " : "INNBC SCORE: ";
            context.fillText(label + this.game.score, 20, 100);       
            //FINISH ALPHA CHANGE 356 -- UI label adjusted for multiplayer
             // Timer in MM:SS format
             //START ALPHA CHANGE 357 -- UI timer: show COUNTDOWN (time left) instead of elapsed --
             //START ALPHA CHANGE 653 -- UI timer: MP client uses host mpTimeLimit (do NOT use local options) --
             const isHost653 = !!(sm && sm.isHost);
             const limitMs653 = (isMP && !isHost653 && typeof this.game.mpTimeLimit === "number")
                 ? this.game.mpTimeLimit
                 : this.game.timeLimit;
             const remainMs = Math.max(0, (limitMs653 | 0) - (this.game.gameTime | 0));
             //FINISH ALPHA CHANGE 653 -- UI timer: MP client uses host mpTimeLimit --
             const totalSeconds = Math.floor(remainMs * 0.001);
             const minutes = Math.floor(totalSeconds / 60);
             const seconds = totalSeconds % 60;
             const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
             context.fillText("TIMER: " + formattedTime, 20, 130); // countdown to 00:00
             //FINISH ALPHA CHANGE 357 -- UI timer: countdown
             if (this.game.showFPS) {
                 context.fillStyle = "white";
                 context.fillText("FPS: " + Math.round(this.game.fps), 20, 160); // y=160, below timer
             }
             //START GAMMA CHANGE 29 -- MP: show ALPHA 01/02 ONLINE/OFFLINE under FPS --
             try {
                 const sm = this.game.steamMultiplayer;
                 // Only draw in MP during a playing session
                 if (sm && sm.isMultiplayer && sm.lobbyState === "playing") {
                     const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                     const hasBeat = (typeof sm._lastPeerPacketAt === "number" && sm._lastPeerPacketAt > 0);
                     // If heartbeat is available use 3s grace; otherwise fall back to opponent presence
                     const peerOnline = hasBeat ? ((now - sm._lastPeerPacketAt) < 3000)
                                                : !!(sm.opponentSteamId && sm.lobbyState === "playing");

                     // Host is ALPHA 01; Client is ALPHA 02 from the local POV
                     const p1Online = sm.isHost ? true : !!peerOnline;  // host online (remote on client)
                     const p2Online = sm.isHost ? !!peerOnline : true;  // client online (local on client)

                     // Blink OFFLINE text (bright/dark red) ~2Hz
                     const blinkOn = (((now / 500) | 0) % 2) === 0;

                     // Draw labels
                     context.textAlign = "left";
                     const y1 = 190; // under FPS
                     const y2 = 220;

                     context.fillStyle = "white";
                     context.fillText("ALPHA 01:", 20, y1);
                     context.fillStyle = p1Online ? "#00ff00" : (blinkOn ? "#ff0000" : "#880000");
                     context.fillText(p1Online ? "ONLINE" : "OFFLINE", 130, y1);

                     context.fillStyle = "white";
                     context.fillText("ALPHA 02:", 20, y2);
                     context.fillStyle = p2Online ? "#00ff00" : (blinkOn ? "#ff0000" : "#880000");
                     context.fillText(p2Online ? "ONLINE" : "OFFLINE", 130, y2);
                 }
             } catch (e) {
                 console.warn("[UI] MP status draw failed:", e);
             }
             //FINISH GAMMA CHANGE 29 -- MP: show ALPHA 01/02 ONLINE/OFFLINE under FPS --
             //START GAMMA CHANGE 40 -- HOST: 10–15s offline warning at bottom of screen
             try {
                 const sm = this.game.steamMultiplayer;
                 if (sm && sm.isMultiplayer && sm.isHost && sm.lobbyState === "playing") {
                     const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                     const last = (typeof sm._lastPeerPacketAt === "number") ? sm._lastPeerPacketAt : 0;
                     const offlineMs = last ? (now - last) : Infinity;
                     if (offlineMs >= 10000 && offlineMs < 15000) {
                         const secsLeft = Math.ceil((15000 - offlineMs) / 1000);
                         const blinkWarn = (((now / 300) | 0) % 2) === 0; // faster urgency blink
                         context.textAlign = "center";
                         context.font = "24px " + this.fontFamily;
                         context.fillStyle = blinkWarn ? "#ff0000" : "#880000";
                         context.fillText(
                             `PLAYER 2 OFFLINE — SESSION WILL CLOSE IN ${secsLeft} SECONDS`,
                             this.game.width * 0.5,
                             this.game.height - 20
                         );
                     }
                 }
             } catch (e) {
                 console.warn("[UI] offline warning draw failed:", e);
             }
             //FINISH GAMMA CHANGE 40 -- HOST: 10–15s offline warning
             //START GAMMA CHANGE 64 -- CLIENT: 10–15s “HOST OFFLINE” warning at bottom of screen
try {
    const sm = this.game.steamMultiplayer;
    if (sm && sm.isMultiplayer && !sm.isHost && sm.lobbyState === "playing") {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const last = (typeof sm._lastPeerPacketAt === "number") ? sm._lastPeerPacketAt : 0;
        const offlineMs = last ? (now - last) : Infinity;
        if (offlineMs >= 10000 && offlineMs < 15000) {
            const secsLeft = Math.ceil((15000 - offlineMs) / 1000);
            const blinkWarn = (((now / 300) | 0) % 2) === 0;
            context.textAlign = "center";
            context.font = "24px " + this.fontFamily;
            context.fillStyle = blinkWarn ? "#ff0000" : "#880000";
            context.fillText(
                `PLAYER 1 OFFLINE — SESSION WILL CLOSE IN ${secsLeft} SECONDS`,
                this.game.width * 0.5,
                this.game.height - 20
            );
        }
    }
} catch (e) {
    console.warn("[UI] offline warning draw failed (client):", e);
}
//FINISH GAMMA CHANGE 64 -- CLIENT: 10–15s warning

//START ALPHA CHANGE 65 -- CLIENT: Flashing “HOST PAUSED” banner during play
try {
    const sm = this.game.steamMultiplayer;
    if (sm && sm.isMultiplayer && !sm.isHost && sm.lobbyState === "playing" && !!sm._hostPauseActive) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const blinkOn = (((now / 400) | 0) % 2) === 0; // ~2.5 Hz blink
        const msg = "GAME PAUSED BY HOST — WAITING FOR HOST TO RESUME";
        this.game && this.game.context && (this.game.context); // keep style consistent with other UI draws
        const y = 60; // top banner area; avoids overlap with pause menu in center
        const oldAlign = context.textAlign;
        const oldFont = context.font;
        const oldFill = context.fillStyle;
        context.textAlign = "center";
        context.font = "28px " + this.fontFamily;
        context.fillStyle = blinkOn ? "#ff0000" : "#880000";
        context.fillText(msg, this.game.width * 0.5, y);
        context.textAlign = oldAlign;
        context.font = oldFont;
        context.fillStyle = oldFill;
    }
} catch (e) {
    console.warn("[UI] host-pause banner draw failed:", e);
}
//FINISH ALPHA CHANGE 65 -- CLIENT: Flashing “HOST PAUSED” banner during play

//START ALPHA CHANGE 685 -- SP: flashing win-score banner (2s, wall-clock) --
try {
    const g685 = this.game;

    if (g685) {
        const until685 = (typeof g685._winScoreBannerUntilMs683 === "number") ? g685._winScoreBannerUntilMs683 : 0;
        const msg685 = (typeof g685._winScoreBannerText683 === "string") ? g685._winScoreBannerText683 : "";

        if (until685 > 0 && msg685) {
            const now685 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now685 < until685) {
                const blinkOn685 = (((now685 / 400) | 0) % 2) === 0; // same blink rate as host-pause banner

                const y = 255; // same style as ALPHA CHANGE 65 -- does not overlap with it and with pause as well 
                const oldAlign = context.textAlign;
                const oldFont  = context.font;
                const oldFill  = context.fillStyle;
                const oldAlpha = context.globalAlpha;

                context.textAlign = "center";
                context.font = "28px " + this.fontFamily;

                // blinking
                
                context.fillStyle = blinkOn685 ? "#ff0000" : "#880000";

                context.fillText(msg685, g685.width * 0.5, y);

                context.globalAlpha = oldAlpha;
                context.textAlign = oldAlign;
                context.font = oldFont;
                context.fillStyle = oldFill;
            }
        }
    }
} catch (e) {
    console.warn("[UI] win-score banner draw failed:", e);
}
//FINISH ALPHA CHANGE 685 -- SP: flashing win-score banner (2s, wall-clock) --

             //START GAMMA CHANGE 42 -- Draw 2s flashing “SESSION CLOSED” prompt on main menu --
            try {
                // Only show on main menu, if SteamMultiplayer set a prompt recently
                const sm = this.game.steamMultiplayer;
                if (this.game.gameState === "mainMenu" &&
                    sm && typeof sm._leaveNoticeAt === "number" && sm._leaveNoticeAt > 0 &&
                    typeof sm._promptText === "string" && sm._promptText) {
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    const elapsed = now - sm._leaveNoticeAt;
                    if (elapsed < 2000) { // visible for ~2 seconds
                        const blinkOn = (((now / 250) | 0) % 2) === 0; // fast blink
                        context.textAlign = "center";
                        context.font = "24px " + this.fontFamily;
                        context.fillStyle = blinkOn ? "#ff0000" : "#880000"; // flashy red
                        context.fillText(sm._promptText, this.game.width * 0.5, this.game.height - 20);
                    }
                }
            } catch (e) {
                console.warn("[UI] leave notice prompt draw failed:", e);
            }
            //FINISH GAMMA CHANGE 42 -- Draw 2s flashing “SESSION CLOSED” prompt on main menu --

        // Pause message
        // START CHANGE: Add pause menu
        if (this.game.paused && !this.game.gameOver) {
            context.textAlign = "center";
            // Pause menu
            context.save();
            context.font = "40px " + this.fontFamily;
            const pauseItems = ["Resume", "Main Menu", `Full Screen: ${this.game.fullScreen ? 'On' : 'Off'}`];
            const pauseItemHeight = 50;
            const pauseStartY = this.game.height * 0.5 - 75; // Adjusted for 3 items
            pauseItems.forEach((item, index) => {
                const y = pauseStartY + index * pauseItemHeight;
                context.fillStyle = index === this.selectedPauseIndex ? "#ff0000" : "#ffffff";
                context.fillText(item, this.game.width * 0.5, y);
            });
            context.restore();
            context.font = "50px " + this.fontFamily;
            context.fillStyle = "white"; // Ensure "Paused" is white
            context.fillText("Paused", this.game.width * 0.5, this.game.height * 0.5 - 125); // Adjusted position
        }
        // END CHANGE
        // START CHANGE: GAME OVER BLOCK -- HERE ALL THE UI LOGIC RUNNING AT GAME OVER STATE 
            if (this.game.gameOver){//all of this is gated by this.game.gameOver for the host (local logic) or client (remotely set by PKT.GAME_STATE encoded flag)
                context.textAlign = "center";
                let message1;
                let message2;
                if (this.game.gameWon){//ALPHA CHANGE 658 -- use centralized gameWon "this.score >= this.winningScore" --> "this.game.gameWon"
                    message1 = "You are the Real Hero!";
                    message2 = "Well Done INNBC Soldier!";    
                } else {
                    message1 = "Did not Go Well!";
                    message2 = "Mission Failed! Seriously?";
                }
                // Game over messages (left side)
                context.font = "50px " + this.fontFamily;
                context.fillStyle = "white";
                context.fillText(message1, this.game.width * 0.25, this.game.height * 0.3);
                context.font = "30px " + this.fontFamily;
                //context.fillText(message2, this.game.width * 0.25, this.game.height * 0.3 + 40); old legacy message (white, no blink)
                //START ALPHA CHANGE 365 -- blink message2 in red (reuse existing blink cadence) --
                (function(){
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    const blinkOn = (((now / 250) | 0) % 2) === 0; // ~4Hz toggle (same as session-closed banner)
                    const oldFill = context.fillStyle;
                    context.fillStyle = blinkOn ? "#ff0000" : "#880000";
                    context.fillText(message2, this.game.width * 0.25, this.game.height * 0.3 + 40);
                    context.fillStyle = oldFill; // restore
                }).call(this);
                //FINISH ALPHA CHANGE 365 -- blink message2 in red --
                // Game over menu (below messages)
                context.font = "40px " + this.fontFamily;
                this.gameOverItemBounds = []; // Clear previous bounds
                this.gameOverItems.forEach((item, index) => {
                    const y = this.gameOverStartY + 50 + index * this.gameOverItemHeight; // Offset below messages
                    context.fillStyle = index === this.selectedGameOverIndex ? "#ff0000" : "#ffffff";
                    context.fillText(item, this.game.width * 0.25, y);
                    this.gameOverItemBounds[index] = {
                        text: item,
                        x: this.game.width / 2 - context.measureText(item).width / 2,
                        y: y - 30,
                        width: context.measureText(item).width,
                        height: 40
                    };
                });
                //START ALPHA CHANGE 704 -- UI: MP client stateless INSERT COIN blink (client doesn't tick insertCoinTimer) --
                const isMpClient = !!(this.game && this.game.steamMultiplayer && this.game.steamMultiplayer.isMultiplayer && !this.game.steamMultiplayer.isHost);
                let showInsertCoin = !!this.game.showInsertCoin; // host keeps existing stateful blink
                if (isMpClient) {
                    const nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
                    const intervalMs = (this.game && typeof this.game.insertCoinInterval === "number") ? this.game.insertCoinInterval : 500;
                    showInsertCoin = ((((nowMs / intervalMs) | 0) % 2) === 0);
                }
                if (showInsertCoin) {
                    context.font = "40px " + this.fontFamily;
                    context.fillStyle = "#ffff00";
                    context.fillText("INSERT COIN", this.game.width * 0.25, this.game.height * 0.5 + 150);
                }
                //FINISH ALPHA CHANGE 704 -- UI: MP client stateless INSERT COIN blink (client doesn't tick insertCoinTimer) --
                // Name input and leaderboard (right side)
                if (this.game.awaitingNameInput) {
                    context.font = "30px " + this.fontFamily;
                    context.fillStyle = "white";
                    context.fillText("Congratulations, Top 10 Score!", this.game.width * 0.75, this.game.height * 0.5 - 100);
                    context.fillText("Enter Your Name:", this.game.width * 0.75, this.game.height * 0.5 - 60);
                    // Display name with flashing cursor
                    const inputText = this.game.input.nameInput || "";
                    const cursorChar = this.game.input.nameInputCursor ? this.game.input.nameInputCursor.currentLetter : "A";
                    const displayText = inputText + (this.game.showBlink ? cursorChar : " ");
                    context.fillText(displayText, this.game.width * 0.75, this.game.height * 0.5 - 20);
                    context.font = "20px " + this.fontFamily;
                    //START ALPHA CHANGE 718 -- UI: split name input hint into two lines --
                    context.fillText("Typing: X/Circle/D-pad/Keyboard", this.game.width * 0.75, this.game.height * 0.5 + 20);
                    context.fillText("Record name: Enter(Keyboard)/Start(Gamepad)", this.game.width * 0.75, this.game.height * 0.5 + 45);
                    //FINISH ALPHA CHANGE 718 -- UI: split name input hint into two lines --
                } else {
                    context.font = "25px " + this.fontFamily;
                    context.fillStyle = "white";
                    context.fillText("Top 10 Scores", this.game.width * 0.75, this.game.height * 0.5 - 150);
                    const topEntries = this.game.leaderboard.getTopEntries();
                    if (!this.loggedLeaderboard) {
                        console.log("Leaderboard Entries:", topEntries);
                        this.loggedLeaderboard = true;
                    }
                    if (this.game.leaderboard.isLoading || topEntries.length === 0) {
                        context.fillText("Loading...", this.game.width * 0.75, this.game.height * 0.5 - 120);
                    } else {
                        topEntries.forEach((entry, index) => {
                            const nameDisplay = entry.name.length > 20 ? entry.name.slice(0, 17) + '...' : entry.name;
                            const text = `${index + 1}. ${entry.score} (${nameDisplay})`;
                            context.fillText(text, this.game.width * 0.75, this.game.height * 0.5 - 120 + index * 30);
                        });
                    }
                }         
            }
            // END CHANGE: GAME OVER BLOCK -- HERE ALL THE UI LOGIC RUNNING AT GAME OVER STATE 
              context.restore();
            }
            // START GAMMA CHANGE 52 — UI: menu-only overlay for “SESSION CLOSED”
drawMainMenuOverlay(context) {
    try {
        const sm = this.game.steamMultiplayer;
        if (this.game.gameState === "mainMenu" &&
            sm && typeof sm._leaveNoticeAt === "number" && sm._leaveNoticeAt > 0 &&
            typeof sm._promptText === "string" && sm._promptText) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const elapsed = now - sm._leaveNoticeAt;
            if (elapsed < 4000) { // ~4s
                const blinkOn = (((now / 250) | 0) % 2) === 0;
                context.textAlign = "center";
                context.font = "24px " + this.fontFamily;
                context.fillStyle = blinkOn ? "#ff0000" : "#880000";
                context.fillText(sm._promptText, this.game.width * 0.5, this.game.height - 20);
            }
        }
    } catch (e) {
        console.warn("[UI] leave notice prompt draw (menu overlay) failed:", e);
    }
}
// FINISH GAMMA CHANGE 52
            //start change -- add wrapText and renderLine methods for INNBC Universe text rendering//
        wrapText(context, text, x, y, maxWidth, lineHeight, links = []) {
            const words = text.split(" ");
            let line = "";
            let currentY = y;
            let linkBounds = [];
            for (let i = 0; i < words.length; i++) {
                const testLine = line + words[i] + " ";
                const metrics = context.measureText(testLine);
                if ((metrics.width > maxWidth && i > 0) || words[i] === "\n") {
                    this.renderLine(context, line, x, currentY, links, text, linkBounds);
                    line = words[i] === "\n" ? "" : words[i] + " ";
                    currentY += lineHeight;
                } else {
                    line = testLine;
                }
            }
            this.renderLine(context, line, x, currentY, links, text, linkBounds);
            return linkBounds;
        }
        renderLine(context, line, x, y, links, fullText, linkBounds) {
            const words = line.trim().split(" ");
            let currentX = x - context.measureText(line).width / 2;
            for (let word of words) {
                const link = links.find(l => fullText.includes(l.phrase) && fullText.indexOf(l.phrase) <= fullText.indexOf(word) && fullText.indexOf(l.phrase) + l.phrase.length >= fullText.indexOf(word));
                context.fillStyle = link ? "#00f" : "#ffffff";
                context.fillText(word, currentX, y);
                if (link) {
                    context.beginPath();
                    context.moveTo(currentX, y + 5);
                    context.lineTo(currentX + context.measureText(word).width, y + 5);
                    context.strokeStyle = "#00f";
                    context.stroke();
                    linkBounds.push({
                        text: word,
                        x: currentX,
                        y: y - 30,
                        width: context.measureText(word).width,
                        height: 40,
                        action: "Link",
                        url: link.url
                    });
                }
                currentX += context.measureText(word + " ").width;
            }
        }
        //finish change//
        }

        class Leaderboard {
            constructor() {
                this.entries = [];
                this.maxEntries = 10;
                //NEW MODIFICATION: Use localStorage key instead of API URL for leaderboard storage
                this.storageKey = 'innbcgame_leaderboard';
                this.isLoading = true;
                this.loadLeaderboard();
            }
        
            //NEW MODIFICATION: Load leaderboard from localStorage instead of fetching from API
            loadLeaderboard() {
                try {
                    this.isLoading = true;
                    //START ALPHA CHANGE 712 -- localStorage: guard leaderboard JSON + clear corrupted payload --
                    const data = localStorage.getItem(this.storageKey);
                    if (data) {
                        try {
                            const parsed = JSON.parse(data);
                            const list712 =
                                (parsed && typeof parsed === "object" && Array.isArray(parsed.leaderboard))
                                    ? parsed.leaderboard
                                    : [];
                            this.entries = list712;
                        } catch (e) {
                            console.warn("Failed to parse leaderboard storage; clearing saved value:", e);
                            this.entries = [];
                            try { localStorage.removeItem(this.storageKey); } catch (_) {}
                        }
                    } else {
                        this.entries = [];
                    }
                    //FINISH ALPHA CHANGE 712 -- localStorage: guard leaderboard JSON + clear corrupted payload --
                    console.log('Leaderboard loaded from localStorage:', this.entries);
                } catch (err) {
                    console.error('Failed to load leaderboard:', err);
                    this.entries = [];
                } finally {
                    this.isLoading = false;
                }
            }
            
        //NEW MODIFICATION: Use name instead of wallet for local scores
        addEntry(score, name) {
        if (this.qualifies(score)) {
            try {
                console.log('Saving score:', { score, name, scoreType: typeof score });
                const existingIndex = this.entries.findIndex(entry => entry.name === name);
                if (existingIndex !== -1 && score > this.entries[existingIndex].score) {
                    this.entries[existingIndex] = { score, name };
                } else if (existingIndex === -1) {
                    this.entries.push({ score, name });
                }
                this.entries.sort((a, b) => b.score - a.score);
                if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries;
                //NEW MODIFICATION: Save leaderboard to localStorage
                localStorage.setItem(this.storageKey, JSON.stringify({ leaderboard: this.entries }));
                console.log('Leaderboard saved to localStorage:', this.entries);
            } catch (err) {
                console.error('Failed to update leaderboard:', err.message);
                // Fallback: In-memory update
                const existingIndex = this.entries.findIndex(entry => entry.name === name);
                if (existingIndex !== -1 && score > this.entries[existingIndex].score) {
                    this.entries[existingIndex] = { score, name };
                } else if (existingIndex === -1) {
                    this.entries.push({ score, name });
                }
                this.entries.sort((a, b) => b.score - a.score);
                if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries;
            }
        }
    }
        
            qualifies(score) {
                return this.entries.length < this.maxEntries || score > (this.entries[this.entries.length - 1]?.score || 0);
            }
        
            getTopEntries() {
                return this.entries;
            }

            //START ALPHA CHANGE 200 -- add leaderboard hard reset helper --
            resetScores() { // clears in-memory + localStorage
                try {
                    this.entries = []; // wipe in-memory
                    // Remove or overwrite storage; remove to be unambiguous
                    localStorage.removeItem(this.storageKey);
                    // (Optional) If you prefer overwrite style:
                    // localStorage.setItem(this.storageKey, JSON.stringify({ leaderboard: [] }));
                    console.log('Leaderboard reset: entries cleared and storage removed');
                } catch (err) {
                    console.error('Failed to reset leaderboard:', err);
                }
            }
            //FINISH ALPHA CHANGE 200 -- add leaderboard hard reset helper --
        }

    class Game {
        constructor(width, height, canvas){
            this.width = width;
            this.height = height;
            this.canvas = canvas; // Store canvas reference
            this.canvas.tabIndex = 1; // Ensure canvas can receive focus
            this.canvas.focus(); // Set focus to canvas
            console.log("Game constructor: Canvas initialized, focus set");
            //START ALPHA CHANGE 496 -- init AssetsLoading (render-ready warm-up pipeline owner) --
            this.assetsLoading = new AssetsLoading(this);
            //FINISH ALPHA CHANGE 496 -- init AssetsLoading (render-ready warm-up pipeline owner) --
            this.background = new Background(this);
            this.player = new Player (this);
            this.input = new InputHandler(this, this.canvas); // Pass canvas to InputHandler
            this.ui = new UI(this);
            this.innbcUniverse = new innbcUniverse(this);
            this.sound = new SoundController();
            this.shield = new Shield(this);
            this.keys = [];
            this.enemies = [];
            this.particles = [];
            this.explosions = [];
            this.enemyTimer = 0;
            this.enemyInterval = 800;   //1000 = spawn enemies every 1000ms -- 900: moderate value -- 800: harcore -> ideal for projectile speed 10 
            this.ammo = 50; // Start fully charged
            this.maxAmmo = 50;
            this.ammoTimer = 0;
            this.ammoInterval = 300; // Ensure recharge happens every 300ms
            this.shieldEnergy = 50;         // Starting shield energy
            this.maxShieldEnergy = 50;      // Maximum shield energy
            this.shieldDepleteAmount = 10;  // Amount depleted per collision
            this.shieldTimer = 0;           // New: Timer for shield recharge
            this.shieldInterval = 500;      // New: Interval for shield recharge (slower than ammo)
            this.gameOver = false;
            this.score = 0;
            this.winningScore = 700; // When player wins
            this.showFPS = true; // Explicitly set to true by default
            this.gameTime = 0;
            this.timeLimit = 90000;
            this.debug = false; // set to true to show enemy hitboxes + lives wherever code checks this.game.debug -- debug toggle 
            //START ALPHA CHANGE 291 -- load saved Difficulty by snapping to {Hard, Normal, Easy} --
            try {
                const savedTL = localStorage.getItem("innbcTimeLimitMs");
                if (savedTL !== null) {
                    // Keep timeLimit persisted ONLY for Normal (90s) and Easy (180s) -- ALPHA CHANGE 428
                    // Hard no longer shortens timer; it’s controlled by a separate boolean flag -- ALPHA CHANGE 428
                    const NORMAL =  90000; // 1:30 (default)
                    const EASY   = 120000; // 2:00
                    const ms = parseInt(savedTL, 10);
                    if (!isNaN(ms)) {
                        // snap any stored value to the nearest defined difficulty bucket (Snap to NORMAL or EASY) -- ALPHA CHANGE 428
                        let t = NORMAL;
                        if (ms >= EASY) t = EASY; else t = NORMAL;      
                        this.timeLimit = t;  // overwrite default if saved exists
                    }
                }
            } catch (_) {}
            //FINISH ALPHA CHANGE 291 -- load saved Difficulty by snapping to {Hard, Normal, Easy} --
            //START ALPHA CHANGE 428
            // New: independent hardMode flag persisted separately (does NOT change timer)
            this.hardMode = false;
            try {
                const savedHM = localStorage.getItem("innbcHardMode");
                if (savedHM !== null) this.hardMode = (savedHM === "true");
            } catch (_) {}
            //FINISH ALPHA CHANGE 428 -- constructor: load timeLimit (Normal/Easy) + hardMode flag --
            this.speed = 1;
            this.paused = false;
            //START ALPHA CHANGE 652 -- MP: store host difficulty/timer separately (do NOT overwrite local options) --
            this.mpTimeLimit = null; // host-authoritative timeLimit (ms) received via GAME_STATE (MP client only)
            this.mpHardMode  = null; // host-authoritative hardMode (boolean) received via GAME_STATE (MP client only)
            //FINISH ALPHA CHANGE 652 -- MP: store host difficulty/timer separately --
            //start change -- instantiate SteamAchievements in Game constructor//
            this.steamAchievements = new SteamAchievements(this);
            //finish change//
            //start change -- SteamMultiplayer 
            this.steamMultiplayer = new SteamMultiplayer(this); // Add SteamMultiplayer
            this.isMultiplayer = false; // Flag for multiplayer mode
            this.player2 = null; // Second player instance
            //finish change -- multiplayer 
            // CHANGE: Main menu 
            this.gameState = "mainMenu"; // Start in main menu
            this.menuBackground = document.getElementById("menuBackground");
            //START ALPHA CHANGE 424 -- cache different menu backgrounds --
            this.menuBackgroundMP = document.getElementById("menuBackgroundMultiplayer");
            this.menuBackgroundOptions = document.getElementById("menuBackgroundOptions");
            //FINISH ALPHA CHANGE 424 --

            this.sound.resetMenuSoundtrack();
            //finish change--
            //start change -- centralizing fullscreen control with Electron API
            // NOTE: ipcRenderer.on callbacks always receive an IPC `event` as the first argument.
            // We don’t use "event" here, but we keep it so `isFullScreen` stays the 2nd arg
            // matching win.webContents.send('fullscreen-changed', <bool>).
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.on('fullscreen-changed', (event, isFullScreen) => {//event declared but not used: event is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                    this.fullScreen = isFullScreen;
                    console.log("IPC fullscreen-changed:", isFullScreen);
                });
            }
            //finish change-- centralizing fullscreen control with Electron API
            // FINISHED NINTH CHANGE
            this.deathTimer = 0; // New: Tracks delay after death
            this.deathDelay = 500; // New: 0.5s disappearance (adjustable)
            this.insertCoinTimer = 0;
            this.insertCoinInterval = 500; // Flash every 500ms (0.5s)
            this.showInsertCoin = true; // Toggle visibility
            this.leaderboard = new Leaderboard(); // NEW: Add leaderboard
            this.awaitingNameInput = false; // //NEW MODIFICATION: Replace awaitingWalletInput with awaitingNameInput
            this.newHighScore = null; // NEW: Store score temporarily during input
            this.nameSubmitted = false; //NEW MODIFICATION: Replace walletSubmitted with nameSubmitted 
            this.blinkTimer = 0;
            this.blinkInterval = 500; // Matches INSERT COIN flash
            this.showBlink = true;
            this.namePromptTriggered = false; // NEW MODIFICATION: Replace walletPromptTriggered with namePromptTriggered
            this.playerName = ""; // Initialize for name input
            //START ALPHA CHANGE 654 -- repurpose gameWon and track whether the player died this run (used to gate wins at timer end) --
            this.gameWon = false; // Tracks if gameOver is a win (score >= winningScore&&!playerDied) -- reset both in startGame(), game.reset(), returnTomainMenu() (ALPHA CHANGE 655), and leaveLobby() (ALPHA CHANGE 703)
            this.playerDied = false; //Tracks if player dies during a match -- reset both in startGame(), game.reset(),returnTomainMenu() (ALPHA CHANGE 655), and leaveLobby() (ALPHA CHANGE 703) 
            //FINISH ALPHA CHANGE 654 -- repurpose gameWon and track whether the player died this run (used to gate wins at timer end) --

            //START ALPHA CHANGE 683 -- win-score crossing banners: persistent state (SP for now) --
            this._winScoreEverReached683 = false;     // becomes true the first time score >= winningScore
            this._winScoreAtOrAbove683   = false;     // last-known side of the threshold (score >= winningScore)
            this._winScoreBannerText683  = "";        // current banner text (if any)
            this._winScoreBannerUntilMs683 = 0;       // wall-clock expiry timestamp (performance.now/Date.now)
            //FINISH ALPHA CHANGE 683 -- win-score crossing banners: persistent state --
            
            // START CHANGE: Initialize key bindings
            this.keyBindings = {
                moveUp: "ArrowUp",
                moveDown: "ArrowDown",
                moveLeft: "ArrowLeft",
                moveRight: "ArrowRight",
                fire: " ",
                pause: "p"
                //debug: "q" // Commented out for release
            };
            //start change -- initialize gamepad bindings and load from localStorage//
            this.gamepadBindings = {
                moveUp: "axis_1_neg", // Left stick up (Y-axis < -0.5)
                moveDown: "axis_1_pos", // Left stick down (Y-axis > 0.5)
                moveLeft: "axis_0_neg", // Left stick left (X-axis < -0.5)
                moveRight: "axis_0_pos", // Left stick right (X-axis > 0.5)
                fire: "button_0", // X button
                pause: "button_9", // Options button
                //debug: "button_13" // Commented out for release
            };
            this.gamepadConflict = false; // Flag for gamepad binding conflicts
            // Load saved gamepad bindings from localStorage
            //START ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            let savedGamepadBindings = null;
            try {
                savedGamepadBindings = localStorage.getItem("innbcGamepadBindings");
            } catch (e) {
                console.warn("Failed to read innbcGamepadBindings from localStorage:", e);
            }
            //FINISH ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            if (savedGamepadBindings !== null) {
                //START ALPHA CHANGE 710 -- localStorage: guard gamepad bindings JSON parse (avoid startup crash) --
                try {
                    const parsed = JSON.parse(savedGamepadBindings);
                    if (parsed && typeof parsed === "object") this.gamepadBindings = parsed;
                } catch (e) {
                    console.warn("Failed to parse innbcGamepadBindings; clearing saved value:", e);
                    try { localStorage.removeItem("innbcGamepadBindings"); } catch (_) {}
                }
                //FINISH ALPHA CHANGE 710 -- localStorage: guard gamepad bindings JSON parse (avoid startup crash) --
            }
            //finish change//
            this.keyConflict = false; // Flag for key conflict message
            this.showFPS = true; // Default on
            this.fps = 0; // Store FPS value
            this.frameCount = 0; // For FPS calculation
            this.fpsTimer = 0; // Track time for FPS
            this.fpsInterval = 1000; // Update FPS every second
            // Load saved bindings from localStorage
            //START ALPHA CHANGE 711 -- localStorage: guard showFPS/fullScreen JSON.parse (avoid startup crash) --
            //START ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            let savedFPS = null;
            try {
                savedFPS = localStorage.getItem("innbcShowFPS");
            } catch (e) {
                console.warn("Failed to read innbcShowFPS from localStorage:", e);
            }
            //FINISH ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            if (savedFPS !== null) {
                try {
                    const parsedFPS = JSON.parse(savedFPS);
                    if (typeof parsedFPS === "boolean") this.showFPS = parsedFPS;
                } catch (e) {
                    console.warn("Failed to parse innbcShowFPS; clearing saved value:", e);
                    try { localStorage.removeItem("innbcShowFPS"); } catch (_) {}
                }
            }
            //start change -- centralizing fullscreen control with Electron API//
            //START ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            let savedFullScreen = null;
            try {
                savedFullScreen = localStorage.getItem("innbcFullScreen");
            } catch (e) {
                console.warn("Failed to read innbcFullScreen from localStorage:", e);
            }
            //FINISH ALPHA CHANGE 725 -- localStorage: guard getItem (storage may be unavailable at startup) --
            if (savedFullScreen !== null) {
                try {
                    const parsedFullScreen = JSON.parse(savedFullScreen);
                    if (typeof parsedFullScreen === "boolean") this.fullScreen = parsedFullScreen;
                } catch (e) {
                    console.warn("Failed to parse innbcFullScreen; clearing saved value:", e);
                    try { localStorage.removeItem("innbcFullScreen"); } catch (_) {}
                }
            }
            //FINISH ALPHA CHANGE 711 -- localStorage: guard showFPS/fullScreen JSON.parse (avoid startup crash) --
            // END CHANGE
            this.gameOverMenuDelayTimer = null; // Initialize delay timer
            this.gameOverMenuActive = false; // Initialize menu active flag         

        }

        update(deltaTime){ 
            this.frameCount++;
            this.fpsTimer += deltaTime;
            if (this.fpsTimer >= this.fpsInterval) {
                this.fps = this.frameCount / (this.fpsTimer / 1000);
                this.frameCount = 0;
                this.fpsTimer = 0;
            }

            //START ALPHA CHANGE 582 -- Universe menu: play on enter, stop on exit --
            if (typeof this._prevStateUniverseSfx !== "string") this._prevStateUniverseSfx = this.gameState;
            const _prevU = this._prevStateUniverseSfx;
            const _currU = this.gameState;

            if (_currU === "innbcUniverse" && _prevU !== "innbcUniverse") {
                if (this.sound && typeof this.sound.universeVoicePlay === "function") this.sound.universeVoicePlay();
            } else if (_prevU === "innbcUniverse" && _currU !== "innbcUniverse") {
                if (this.sound && typeof this.sound.universeVoiceStop === "function") this.sound.universeVoiceStop();
            }
            this._prevStateUniverseSfx = _currU;
            //FINISH ALPHA CHANGE 582 -- Universe menu: play on enter, stop on exit --
            
        // Handle gamepad input for gamepad setup menu
        if (this.gameState === "gamepadSetup") {
        this.input.pollGamepad();
        }
        //finish change
        //PAY ATTENTION: IF YOU DON'T INCLUDE HERE AN ELEMENT OF THE MENU IT WILL NOT BE CALLED AND EXECUTED!
        // Handle gamepad input for menu states (mainMenu, options, gamepadSetup, multiplayer, innbcUniverse, joinLobby)
        if (["mainMenu", "options", "gamepadSetup", "multiplayer", "innbcUniverse", "joinLobby"].includes(this.gameState)) {
            this.input.pollGamepadForMenus();
        }
        //finish change//
        // Handle gamepad input for playing (paused or not) and gameOver states, including pause menu, game-over menu, and virtual keyboard
        if (this.gameState === "playing" || this.gameState === "gameOver") {
            this.input.pollGamepadForGameplay();
            this.input.pollHeldKeysForGameplay(); //ALPHA CHANGE 487 -- keyboard held-key autofire: call it to run every frame in gameplay (SP/host only) --
        }
        //finish change//
    
        //start change -- update SteamAchievements to check for win condition//
        this.steamAchievements.update();
        //finish change//
        //start change -- multiplayer
        this.steamMultiplayer.update(deltaTime); // Update multiplayer
        //START BETA CHANGE 17 -- client: disable local simulation (host is authoritative) --
        if (this.steamMultiplayer.isMultiplayer && !this.steamMultiplayer.isHost) {
            // Client relies on host updates via the binary snapshot path; skip local ticking 
            return; //famoso early return for the client -- IMPORTANTE! 
        }//in MP client, anything after this point in update() does not run!
        //FINISH BETA CHANGE 17 -- client: disable local simulation (host is authoritative) --
        //finish change --- multiplayer


            if (this.gameState === "playing") {
            if (!this.paused) { // Add this condition
            // Update game time only when not in game-over state to ensure time limit check works
            if(!this.gameOver) this.gameTime += deltaTime;
            this.background.update(deltaTime); // ALPHA CHANGE 448 -- Game: pass deltaTime to background parallax layers --
            this.background.layer4.update(deltaTime); // ALPHA CHANGE 448 -- Game: pass deltaTime to background parallax layers --
            this.player.update(deltaTime);
            //finish change

            //console.log("Before recharge - Ammo:", this.ammo, "Timer:", this.ammoTimer, "deltaTime:", deltaTime); // Log 1: Before checking recharge condition
            if (this.ammoTimer > this.ammoInterval){
                if (this.ammo < this.maxAmmo) {this.ammo++;
                /*console.log("Recharged! Ammo now:", this.ammo);*/ } // Log 2: When ammo increments 
                this.ammoTimer = 0;
            } else {
                this.ammoTimer += deltaTime;
                /*if (this.ammo === 0) {
                    console.log("Ammo at 0 - Timer:", this.ammoTimer); // Log 3: When ammo is 0, track timer progress}*/
            }
            if (this.ammo < 0) this.ammo = 0; // Caps ammo at 0 if anything tries to push it negative
            if (this.ammo > this.maxAmmo) this.ammo = this.maxAmmo; // Ensure ammo doesn’t exceed 50
            // New: Shield recharge logic
            if (this.shieldTimer > this.shieldInterval) {
                if (this.shieldEnergy < this.maxShieldEnergy) this.shieldEnergy++;
                this.shieldTimer = 0;
            } else {
                this.shieldTimer += deltaTime;
            }
            if (this.shieldEnergy > this.maxShieldEnergy) this.shieldEnergy = this.maxShieldEnergy; // Ensure shield doesn’t exceed 50            
            this.shield.update(deltaTime);
            this.particles.forEach(particle => particle.update(deltaTime)); //added deltaTime dt based motion now 
            this.particles = this.particles.filter(particle => !particle.markedForDeletion);
            this.explosions.forEach(explosion => explosion.update(deltaTime));
            this.explosions = this.explosions.filter(explosion => !explosion.markedForDeletion);

            if (!this.gameOver && (!this.isMultiplayer || (this.steamMultiplayer && this.steamMultiplayer.isHost))) { //START ALPHA CHANGE 192 -- host/SP only enemy motion & collisions --

                this.enemies.forEach(enemy => { //ogni istanza è singola e per un nemico ogni volta--> tante istanze parallele per ogni singolo nemico 
                    //START ALPHA CHANGE 436 -- pass deltaTime to enemy.update for time-based animation -- così anche i nemici possono essere frame rate independent 
                    enemy.update(deltaTime);
                     //FINISH ALPHA CHANGE 436 -- pass deltaTime to enemy.update -- per quello non funzionava e hai dovuto usare l'altro metodo (this._animEvery = 3) 
                    //START gamma CHANGE 1
                    // Host must also resolve Player 2 collisions (body + P2 bullets) per enemy tick
                    if (this.steamMultiplayer) {
                        this.steamMultiplayer.handleP2HostCollisions(enemy);
                    }
                    //FINISH GAMMA CHANGE 1
                    if (this.checkCollision(this.player, enemy)) { // questo riguarda le collisione di P1 per l'host -- important: each instance is enemy unique (vedi ALPHA 660)
                        enemy.markedForDeletion = true;
                        this.addExplosion(enemy);
                        this.sound.explosion(); // ALPHA CHANGE 736 -- add explision sound for body collision 
                        //this.sound.hit(); // prima era qua e HIT si estendeva anche a lucky/moon (con ALPHA 735 lo muoviamo sotto)
                        // prima ALPHA 417 era qua -- e mandava HIT per tutti i tipi di nemici 
                        // prima this.shield.reset(); era qui  <-- UNCONDITIONAL: runs for ALL enemy types
                        if (enemy.type !== "lucky" && enemy.type !== "moon") {
                        //START ALPHA CHANGE 463 -- host HIT opcode only for non Lucky/Moon powerups) -- spostato qua dentro come shield.reset(
                            //START ALPHA CHANGE 417 -- HOST: mirror P1 body-collision to client with HIT SFX opcode --
                        try {
                            const sm = this.steamMultiplayer;
                            if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeHitToBuffer === 'function') {
                                const buf = sm.encodeHitToBuffer(1); //ALPHA CHANGE 465 -- include owner=1 (P1) in HIT packet --
                                sm.sendNetworkBinary(buf, 'UnreliableNoDelay');
                            }
                        } catch (_) {}
                        //FINISH ALPHA CHANGE 417 -- HOST: mirror P1 body-collision to client with HIT SFX opcode --
                        //START ALPHA CHANGE 463 -- host HIT opcode only for damaging P1 body-collisions (exclude Lucky/Moon powerups) --
                        this.shield.reset(); // <--  ALPHA CHANGE 460 -- now ONLY for non-lucky, non-moon enemies -- prima era fuori (prima di if) e scudo + suono si applicava ad ogni collisione
                        //START ALPHA CHANGE 309 -- support per-enemy shield damage with safe fallback --
                        this.sound.hit(); // ALPHA CHANGE 735 -- SFX: hit sound only for normal enemies (not lucky/moon) --
                        const _shieldHit = (typeof enemy.shieldDamage === 'number') ? enemy.shieldDamage : this.shieldDepleteAmount;
                        this.shieldEnergy -= _shieldHit;
                        //FINISH ALPHA CHANGE 309 -- support per-enemy shield damage with safe fallback --
                            if (this.shieldEnergy <= 0) {
                                this.shieldEnergy = 0;
                                this.addPlayerExplosion();
                                this.player.markedForDeletion = true;
                                this.deathTimer = 0;
                                //START ALPHA CHANGE 656 -- latch death/outcome for this run (used to gate wins at timer end) --
                                this.playerDied = true;
                                this.gameWon = false;
                                //FINISH ALPHA CHANGE 656 -- latch death/outcome for this run (used to gate wins at timer end) --
                                this.gameOver = true; // Loss via shield
                            }
                        if (!this.gameOver) this.score--;
                    }
                    // Existing collision effects (power-ups, particles)

                    if (enemy.type === "moon") {//powerup here and particle in the general code later 
                        this.player.enterPowerUp(); //enters power up 
                        if (this.steamMultiplayer && this.steamMultiplayer.isMultiplayer && this.player2 && !this.player2.markedForDeletion) {
                            this.player2.enterPowerUp(); //ALPHA CHANGE 368 -- host: mirror P1->P2 shared power-up on body collision (moon/lucky) 
                        }
                        if (this.shieldEnergy < this.maxShieldEnergy) this.shieldEnergy = this.maxShieldEnergy; // Refill shield
                      
                        //START ALPHA CHANGE 418 -- host: notify client to play the power-up SFX -- tenuto solo come esempio
                        try {
                            const sm = this.steamMultiplayer;
                            if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodePowerUpToBuffer === 'function') {
                                sm.sendNetworkBinary(sm.encodePowerUpToBuffer(), 'Unreliable');
                            }
                        } catch (_) {}
                        //FINISH ALPHA CHANGE 418 -- tenuto come esempio
                        
                    }
                    //Explosion by collision with Lucky (activating powerup)
                    if (enemy.type === "lucky") {
                        //START ALPHA CHANGE 677 -- Particle2 (SMALL): scatter around enemy ellipse (single-player visuals) --
                        const cx = enemy.x + enemy.width * 0.5;
                        const cy = enemy.y + enemy.height * 0.5;
                        const edgeFactor = 0.45; // tweak later: ~0.35..0.50
                        for (let i = 0; i < 10; i++){
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle2(this, px, py));
                        }
                        //FINISH ALPHA CHANGE 677 -- Particle2(SMALL): scatter around enemy ellipse (single-player visuals) -- 
                    this.player.enterPowerUp(); // enters power up (refills ammo)
                    if (this.steamMultiplayer && this.steamMultiplayer.isMultiplayer && this.player2 && !this.player2.markedForDeletion) {
                            this.player2.enterPowerUp(); //ALPHA CHANGE 368 -- host: mirror P1->P2 shared power-up on body collision (moon/lucky) 
                        }
                        if (this.shieldEnergy < this.maxShieldEnergy) this.shieldEnergy = this.maxShieldEnergy; // Refills shield
                        
                        //START ALPHA CHANGE 418 -- host: notify client to play the power-up SFX -- tenuto come esempio
                        try {
                            const sm = this.steamMultiplayer;
                            if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodePowerUpToBuffer === 'function') {
                                sm.sendNetworkBinary(sm.encodePowerUpToBuffer(), 'Unreliable');
                            }
                        } catch (_) {}
                        //FINISH ALPHA CHANGE 418 -- tenuto come esempio 
                        
                    //particle explosion by contact (10 particles)         
                    } else if (enemy.type === "drone") {
                       //START ALPHA CHANGE 677 -- Particle2 (SMALL): scatter around enemy ellipse (single-player visuals) --
                        const cx = enemy.x + enemy.width * 0.5;
                        const cy = enemy.y + enemy.height * 0.5;
                        const edgeFactor = 0.45; // tweak later: ~0.35..0.50
                        for (let i = 0; i < 10; i++){
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle2(this, px, py));
                        }
                        //FINISH ALPHA CHANGE 677 -- Particle2(SMALL): scatter around enemy ellipse (single-player visuals) -- 
                    } else if (enemy.type === "hive"){
                        //START ALPHA CHANGE 677 -- Particle3: scatter around enemy ellipse (single-player visuals) --
                        const cx = enemy.x + enemy.width * 0.5;
                        const cy = enemy.y + enemy.height * 0.5;
                        const edgeFactor = 0.45; // tweak later: ~0.35..0.50
                        for (let i = 0; i < 10; i++){
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle3(this, px, py));
                        }
                        //FINISH ALPHA CHANGE 677 -- Particle3: scatter around enemy ellipse (single-player visuals) -- 
                    } else {
                        //START ALPHA CHANGE 677 -- Particle (MEDIUM): scatter around enemy ellipse (single-player visuals) --
                        const cx = enemy.x + enemy.width * 0.5;
                        const cy = enemy.y + enemy.height * 0.5;
                        const edgeFactor = 0.45; // tweak later: ~0.35..0.50
                        for (let i = 0; i < 10; i++){
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle(this, px, py));
                        }
                        //FINISH ALPHA CHANGE 677 -- Particle (MEDIUM): scatter around enemy ellipse (single-player visuals) -- 
                  }
                  //START ALPHA CHANGE 179 -- host mirrors P1 body-collision burst to client (kind by enemy type, count=10)
                    try {
                        const sm = this.steamMultiplayer;
                        if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeParticleToBuffer === 'function') {
                            const cx = (enemy.x + enemy.width * 0.5) | 0;
                            const cy = (enemy.y + enemy.height * 0.5) | 0;
                            const kind = (enemy.type === "hive") ? 3 : ((enemy.type === "lucky" || enemy.type === "drone") ? 2 : 1);
                            const buf = sm.encodeParticleToBuffer(cx, cy, kind, 10);
                            sm.sendNetworkBinary(buf, 'Unreliable');
                        }
                    } catch (_) {}
                    //FINISH ALPHA CHANGE 179              
                }
                // enemies hit by projectiles and particle effects (one particle -- no loop code)
                this.player.projectiles.forEach(projectile => {//ALPHA CHANGE 660 -- "!projectile.markedForDeletion && !enemy.markedForDeletion" skips collision for projectiles and enemies already markedForDeletion 
                    //for "one projectile → one hit" and "dead enemy not processed again" in the same projectile/enemy instance (each enemy and each projectile is its own object instance)
                    if (!projectile.markedForDeletion && !enemy.markedForDeletion && this.checkCollision(projectile, enemy)){
                        enemy.lives--;
                        projectile.markedForDeletion = true;
                        if (enemy.type === "lucky") {
                             //START ALPHA CHANGE 678 -- Particle2 (SMALL): projectile hit spark scatter around enemy ellipse --
                            const cx = enemy.x + enemy.width * 0.5;
                            const cy = enemy.y + enemy.height * 0.5;
                            const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle2(this, px, py));
                            //FINISH ALPHA CHANGE 678 -- Particle2: projectile hit spark scatter around enemy ellipse --
                        } else if (enemy.type === "drone") {
                             //START ALPHA CHANGE 678 -- Particle2 (SMALL): projectile hit spark scatter around enemy ellipse --
                            const cx = enemy.x + enemy.width * 0.5;
                            const cy = enemy.y + enemy.height * 0.5;
                            const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle2(this, px, py));
                            //FINISH ALPHA CHANGE 678 -- Particle2: projectile hit spark scatter around enemy ellipse --
                        } else if (enemy.type === "hive") {
                             //START ALPHA CHANGE 678 -- Particle3 (BIG): projectile hit spark scatter around enemy ellipse --
                            const cx = enemy.x + enemy.width * 0.5;
                            const cy = enemy.y + enemy.height * 0.5;
                            const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle3(this, px, py));
                            //FINISH ALPHA CHANGE 678 -- Particle3: projectile hit spark scatter around enemy ellipse --
                        } else {
                             //START ALPHA CHANGE 678 -- Particle (MEDIUM): projectile hit spark scatter around enemy ellipse --
                            const cx = enemy.x + enemy.width * 0.5;
                            const cy = enemy.y + enemy.height * 0.5;
                            const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                            const a = Math.random() * Math.PI * 2;
                            const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                            const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                            const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                            this.particles.push(new Particle(this, px, py));
                            //FINISH ALPHA CHANGE 678 -- Particle: projectile hit spark scatter around enemy ellipse --
                        }  
                        //START ALPHA CHANGE 180 -- host mirrors P1 projectile single-hit spark (kind by type, count=1)
                        try {
                            const sm = this.steamMultiplayer;
                            if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeParticleToBuffer === 'function') {
                                const cx = (enemy.x + enemy.width * 0.5) | 0;
                                const cy = (enemy.y + enemy.height * 0.5) | 0;
                                const kind = (enemy.type === "hive") ? 3 : ((enemy.type === "lucky" || enemy.type === "drone") ? 2 : 1);
                                const buf = sm.encodeParticleToBuffer(cx, cy, kind, 1);
                                sm.sendNetworkBinary(buf, 'Unreliable');
                            }
                        } catch (_) {}
                        //FINISH ALPHA CHANGE 180
                        
                        //explosions of enemies and particle effects (3 particles)
                        if (enemy.lives <= 0){
                            if (enemy.type === "lucky") {
                               //START ALPHA CHANGE 679 -- Particle2 (BIG): death burst scatter around enemy ellipse --
                                const cx = enemy.x + enemy.width * 0.5;
                                const cy = enemy.y + enemy.height * 0.5;
                                const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                                for (let i = 0; i < 3; i++){
                                    const a = Math.random() * Math.PI * 2;
                                    const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                                    const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                                    const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                                    this.particles.push(new Particle2(this, px, py));
                                }
                                //FINISH ALPHA CHANGE 679 -- Particle2: death burst scatter around enemy ellipse --
                            } else if (enemy.type === "drone") {
                                //START ALPHA CHANGE 679 -- Particle2 (BIG): death burst scatter around enemy ellipse --
                                const cx = enemy.x + enemy.width * 0.5;
                                const cy = enemy.y + enemy.height * 0.5;
                                const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                                for (let i = 0; i < 3; i++){
                                    const a = Math.random() * Math.PI * 2;
                                    const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                                    const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                                    const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                                    this.particles.push(new Particle2(this, px, py));
                                }
                                //FINISH ALPHA CHANGE 679 -- Particle2: death burst scatter around enemy ellipse --
                            } else if (enemy.type === "hive"){
                               //START ALPHA CHANGE 679 -- Particle3 (BIG): death burst scatter around enemy ellipse --
                                const cx = enemy.x + enemy.width * 0.5;
                                const cy = enemy.y + enemy.height * 0.5;
                                const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                                for (let i = 0; i < 3; i++){
                                    const a = Math.random() * Math.PI * 2;
                                    const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                                    const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                                    const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                                    this.particles.push(new Particle3(this, px, py));
                                }
                                //FINISH ALPHA CHANGE 679 -- Particle3: death burst scatter around enemy ellipse --
                            } else {
                                //START ALPHA CHANGE 679 -- Particle (MEDIUM): death burst scatter around enemy ellipse --
                                const cx = enemy.x + enemy.width * 0.5;
                                const cy = enemy.y + enemy.height * 0.5;
                                const edgeFactor = 0.45; // tweak later (try ~0.35..0.55)
                                for (let i = 0; i < 3; i++){
                                    const a = Math.random() * Math.PI * 2;
                                    const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                                    const px = cx + Math.cos(a) * enemy.width  * edgeFactor * t;
                                    const py = cy + Math.sin(a) * enemy.height * edgeFactor * t;
                                    this.particles.push(new Particle(this, px, py));
                                }
                                //FINISH ALPHA CHANGE 679 -- Particle: death burst scatter around enemy ellipse --
                            }
                            //START ALPHA CHANGE 180 -- host mirrors P1 projectile death burst (kind by type, count=3)
                            try {
                                const sm = this.steamMultiplayer;
                                if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeParticleToBuffer === 'function') {
                                    const cx = (enemy.x + enemy.width * 0.5) | 0;
                                    const cy = (enemy.y + enemy.height * 0.5) | 0;
                                    const kind = (enemy.type === "hive") ? 3 : ((enemy.type === "lucky" || enemy.type === "drone") ? 2 : 1);
                                    const buf = sm.encodeParticleToBuffer(cx, cy, kind, 3);
                                    sm.sendNetworkBinary(buf, 'Unreliable');
                                }
                            } catch (_) {}
                            //FINISH ALPHA CHANGE 180

                            this.addExplosion(enemy);
                            this.sound.explosion();
                            enemy.markedForDeletion = true;        
                            //spawn Drone and Missile when killing Hivewhale (ex ALPHA CHANGE 373)
                            if (enemy.type === "hive"){//ALPHA CHANGE 661 -- randomize Hive split counts (drones 3<->6, missiles 2<->4) --
                                 const droneCount = 3 + Math.floor(Math.random() * 4);   // 3<-->6 random spawned drone
                                 const missileCount = 2 + Math.floor(Math.random() * 3); // 2<-->4 random spawned missile

                                 for (let i = 0; i < droneCount; i++){ //drone
                                      this.enemies.push(new Drone(
                                      this,
                                      enemy.x + Math.random() * enemy.width,
                                      enemy.y + Math.random() * enemy.height * 0.5
                                     ));
                                }

                                for (let i = 0; i < missileCount; i++){ //missile 
                                     this.enemies.push(new Missile(
                                     this,
                                     enemy.x + Math.random() * enemy.width,
                                     enemy.y + Math.random() * enemy.height * 0.4
                                     ));
                                }
                                this.sound.missile();//ALPHA CHANGE 737 -- SP: play missile SFX on Hivewhale split spawn (once per kill) --
                                //START ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P1 hive split) --
                                try {
                                    const sm = this.steamMultiplayer;
                                    if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeMissileToBuffer === 'function') {
                                        sm.sendNetworkBinary(sm.encodeMissileToBuffer(), 'UnreliableNoDelay');
                                    }
                                } catch (_) {}
                                //FINISH ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P1 hive split) --
                            }//FINISH hive 
                            //spawn Missile when killing Bulbwhale (ex ALPHA CHANGE 373)
                            if (enemy.type === "bulbwhale"){//ALPHA CHANGE 661 -- randomize Bulbwhale missiles (1<->2) --
                                const bulbMissileCount = 1 + Math.floor(Math.random() * 2); // 1<-->2
                               
                                for (let i = 0; i < bulbMissileCount; i++){
                                     this.enemies.push(new Missile(
                                     this,
                                     enemy.x + Math.random() * enemy.width,
                                     enemy.y + Math.random() * enemy.height * 0.4
                                    ));
                                }
                                this.sound.missile();//ALPHA CHANGE 737 -- SP: play missile SFX on Bulbwhale split spawn (once per kill) --
                                //START ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P1 bulbwhale split) --
                                try {
                                    const sm = this.steamMultiplayer;
                                    if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeMissileToBuffer === 'function') {
                                        sm.sendNetworkBinary(sm.encodeMissileToBuffer(), 'UnreliableNoDelay');
                                    }
                                } catch (_) {}
                                //FINISH ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P1 bulbwhale split) --                 
                            }//FINISH bulbwhale 
                            
                            //if (!this.gameOver) this.score += enemy.score; old system
                            // NEW: Penalize for destroying power-up enemies by their score value
                            if (!this.gameOver) {
                            if (enemy.type === "lucky" || enemy.type === "moon") {
                            this.score -= enemy.score; // Lose points equal to the enemy's score
                            } else {
                            this.score += enemy.score; // Gain points for normal enemies
                            }
                           }
                            //START ALPHA CHANGE 209 -- remove early game-over on reaching winningScore; timer is sole end condition --
                            // (No immediate gameOver here; we keep playing. The game-over message/achievements
                            /*if (this.score > this.winningScore) {
                                this.gameOver = true; // Win via score
                                this.gameWon = true; // NEW: Mark as a win
                                console.log("Score win detected - Score:", this.score, "Time:", this.gameTime, "GameWon:", this.gameWon);
                            }*/
                            //  will still reflect whether score > winningScore at the time the timer expires.)
                            //FINISH ALPHA CHANGE 209 -- remove early game-over on reaching winningScore; timer is sole end condition --
                        }
                    }
                   
                }); 
            }); 
          this.enemies = this.enemies.filter(enemy => !enemy.markedForDeletion);
          if (this.enemyTimer > this.enemyInterval && !this.gameOver){
            this.addEnemy();
            this.enemyTimer = 0;
          } else {
            this.enemyTimer += deltaTime;
          }
//START ALPHA CHANGE 690 (ex ALPHA CHANGE 684) -- SP/MP HOST: win-score crossing detection + 2s banner (wall-clock) --
try {
    const now684 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    const atOrAbove684 =
        (typeof this.score === "number" && typeof this.winningScore === "number")
            ? (this.score >= this.winningScore)
            : false;

    const prev684 = !!this._winScoreAtOrAbove683;

    // crossing happened?
    if (atOrAbove684 !== prev684) {
        if (atOrAbove684) {
            // crossed up: show “reached”
            this._winScoreEverReached683 = true;
            this._winScoreBannerText683 = "WINNING SCORE REACHED: SURVIVE!";
            this._winScoreBannerUntilMs683 = now684 + 2000;

            // MP host: notify client
            try {
                const sm = this.steamMultiplayer;
                if (sm && sm.isMultiplayer && sm.isHost && typeof sm.sendWinScoreBanner === "function") {
                    sm.sendWinScoreBanner(1); // reached/above
                }
            } catch (_) {}

        } else if (this._winScoreEverReached683) {
            // crossed down (but only after we've reached at least once)
            this._winScoreBannerText683 = "BELOW WINNING SCORE";
            this._winScoreBannerUntilMs683 = now684 + 2000;

            // MP host: notify client
            try {
                const sm = this.steamMultiplayer;
                if (sm && sm.isMultiplayer && sm.isHost && typeof sm.sendWinScoreBanner === "function") {
                    sm.sendWinScoreBanner(2); // below after having reached
                }
            } catch (_) {}
        }
    }

    // always keep last side updated
    this._winScoreAtOrAbove683 = atOrAbove684;

  } catch (e) {
    console.warn("[Game] win-score banner arm failed:", e);
  }
//FINISH ALPHA CHANGE 690 (ex ALPHA CHANGE 684) -- SP/MP HOST: win-score crossing detection + 2s banner (wall-clock) --
}//--> CLOSING THE ALPHA CHANGE 192 BLOCK here which already provided the "host/SP-only already" condition so no need to repeat it for ALPHA CHANGE 690

        // CHANGE 3: Added time limit check here to prioritize it over score win
        // Moved from earlier position to ensure it overrides a late score win if time exceeds 90s
        if (this.gameTime > this.timeLimit && !this.gameOver) { // NEW: end-of-session (time limit reached)
            //START ALPHA CHANGE 657 -- time limit end: decide win once (score gate + must have survived) --
            this.gameWon = (this.score >= this.winningScore) && !this.playerDied; //centralized winning condition 
            this.gameOver = true; // End via time (win/loss decided by gameWon)
            console.log("Time end detected - Time:", this.gameTime, "GameWon:", this.gameWon);
            //FINISH ALPHA CHANGE 657 -- time limit end: decide win once (score gate + must have survived) --
        }
   //start change -- introduce 2-second delay before game-over menu becomes interactive//
//start change -- introduce 2-second delay before game-over menu becomes interactive and reset inputs//
if (this.gameOver) {
    if (!this.gameOverMenuDelayTimer) {
        this.gameOverMenuDelayTimer = performance.now(); // Initialize timer
        this.gameOverMenuActive = false; // Disable menu interactivity
        this.input.lastGamepadButtons = new Array(16).fill(false); // Reset button states
        this.input.lastGamepadNav = { up: false, down: false, left: false, right: false }; // Reset navigation
        this.keys = []; // Add this to clear keyboard movement keys
        //START ALPHA CHANGE 550 -- play win voice once on game-over transition 
        if (this.gameWon) {//ALPHA CHANGE 658 -- use centralized gameWon "this.score > this.winningScore" --> "this.gameWon"
            //START ALPHA CHANGE 552 -- multiplayer win voice (team) vs single-player (alpha one) --
            if (this.steamMultiplayer && this.steamMultiplayer.isMultiplayer) {
                this.sound.alphaTeamWin();
            } else {
                this.sound.alphaOneWin();
            }
            //FINISH ALPHA CHANGE 552 -- multiplayer win voice (team) vs single-player (alpha one) --
        } else if (!this.gameWon) {
            //START ALPHA CHANGE 580 -- play lose voice once on game-over transition --
            this.sound.cmon();
            //FINISH ALPHA CHANGE 580 -- play lose voice once on game-over transition --
        }
        //FINISH ALPHA CHANGE 550 -- play win voice once on game-over transition --
        // Process enemy explosions correctly being inside this block and not outside
        this.enemies.forEach(enemy => {
        this.addExplosion(enemy);
        this.sound.explosion();
        enemy.markedForDeletion = true;
        });
        console.log("Game-over transition: Starting 2-second menu delay and resetting inputs");
    }
    const currentTime = performance.now();
    if (currentTime - this.gameOverMenuDelayTimer >= 2000 && !this.gameOverMenuActive) {
        this.gameOverMenuActive = true; // Enable menu after 2 seconds
        console.log("Game-over menu activated");
    }
    
    
    if (this.gameOverMenuActive) {//ALPHA CHANGE 658 -- use centralized gameWon "this.score >= this.winningScore" --> "this.gameWon"
        // NEW MODIFICATION: Use awaitingNameInput for leaderboard prompt
        if (this.gameWon && this.leaderboard.qualifies(this.score) && !this.namePromptTriggered) {
            console.log("Triggering name prompt"); // Debug
            this.awaitingNameInput = true;
            this.newHighScore = this.score;
            this.namePromptTriggered = true; // Prevent re-triggering
        }
    }
}
//finish change//
//finish change//
        // Manage player reappearance
        if (this.gameOver && this.player.markedForDeletion) {
            this.deathTimer += deltaTime;
            if (this.deathTimer > this.deathDelay) {
                this.player.markedForDeletion = false; // Reappear
            }
        }
        // NEW: Add flash logic for game-over within "playing" state
        if (this.gameOver) {
            this.insertCoinTimer += deltaTime;
            if (this.insertCoinTimer > this.insertCoinInterval) {
                this.showInsertCoin = !this.showInsertCoin;
                this.insertCoinTimer = 0;
            }
            // NEW: Update blink timer for underscore
            this.blinkTimer += deltaTime;
            if (this.blinkTimer > this.blinkInterval) {
                this.showBlink = !this.showBlink;
                this.blinkTimer = 0;
            }
        }
    } // Close if (!this.paused)
  } // Close if (this.gameState === "playing")
} // Close update()

          draw(context){
            
            //start change -- updating draw for multiplayer and INNBC Universe menus and any other menu MUST BE HERE//
            //ATTENZIONE: NON VEDI UN MENU E INVECE VEDI LO SFONDO? PERCHE' NON LO HAI AGGIUNTO AL GAME.DRAW METHOD!
            //adesso modifichiamo facendone uno che li include tutti
            //start change -- unified menu rendering for multiple states//
// Any menu-like state: multiplayer, innbcUniverse, joinLobby, gamepadSetup, options
if (
    this.gameState === "mainMenu" ||
    this.gameState === "options" ||
    this.gameState === "gamepadSetup" ||
    this.gameState === "multiplayer" || 
    this.gameState === "joinLobby" ||
    this.gameState === "innbcUniverse" ||  
    this.gameState === "gameOver" 
) {
    //START ALPHA CHANGE 425 -- modular per-state menu background mapping --
    const bgByState = { // add/remove states here; missing/undefined falls back
        multiplayer: this.menuBackgroundMP,
        joinLobby:   this.menuBackgroundMP,
        options:     this.menuBackgroundOptions,
        gamepadSetup: this.menuBackgroundOptions

    };
    const _custom = bgByState[this.gameState];
    const _bg = _custom ? _custom : this.menuBackground;

    //START ALPHA CHANGE 500 -- menu backgrounds: prefer pre-scaled cached ImageBitmap when available --
    const al = this.assetsLoading;
    let _bgId = "menuBackground";
    if (this.gameState === "multiplayer" || this.gameState === "joinLobby") _bgId = "menuBackgroundMultiplayer";
    else if (this.gameState === "options" || this.gameState === "gamepadSetup") _bgId = "menuBackgroundOptions";

    const _fallbackBg = _bg; // original <img> element
    const _cacheKey = `img:${_bgId}:scaled:${this.width}x${this.height}`;
    const _readyBg = (al && typeof al.getCachedOrFallback === "function")
        ? al.getCachedOrFallback(_cacheKey, _fallbackBg)
        : _fallbackBg; 
    
    //skip redundant base background (menuBackground.jpg) for INNBC Universe (pages draw fullscreen images) --
     if (this.gameState !== "innbcUniverse") {
        context.drawImage(_readyBg, 0, 0, this.width, this.height); //<-- we start using the cached background (menus)
    }//skip redundant base background -- faster loading 

    //FINISH ALPHA CHANGE 500 -- menu backgrounds: prefer pre-scaled cached ImageBitmap when available --
    //FINISH ALPHA CHANGE 456 --
    this.ui.draw(context);
    //console.log("Drawing menu state:", this.gameState); // start change -- debug log shows which menu
    // START GAMMA CHANGE 54 — draw main menu MP notice overlay (if any)
    if (this.gameState === "mainMenu" && this.ui && typeof this.ui.drawMainMenuOverlay === "function") {
        this.ui.drawMainMenuOverlay(context);
    }
    // FINISH GAMMA CHANGE 54
    return;
}
//finish change

if (this.gameState === "placeholder") { //perfect example how to code text properties 
    context.drawImage(this.menuBackground, 0, 0, this.width, this.height);
    context.save();
    context.textAlign = "center";
    context.font = "50px Bangers";
    context.fillStyle = "#ffffff";
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;
    context.shadowColor = "black";
    context.fillText("Coming soon", this.width / 2, this.height / 2);
    context.font = "30px Bangers";
    context.fillText("Press any key to return to menu", this.width / 2, this.height / 2 + 50);
    context.restore();
    return;
}

//finish change//
//GAME ELEMENTS DRAWING (BACKGRUND, ENEMIES, PLAYER, PROJECTILES, SHIELD, PARTICLES, EXPLOSIONS) 
//NOTE -- SP/host: draws player 1/2 using player.draw which also renders P1/2 projectiles and does not run 
            this.background.draw(context);

            //ENEMIES DRAWING 
            //START ALPHA CHANGE 667 -- draw enemies early (behind everything else) --
            if (!this.gameOver) { // Only draw enemies if not game-over (win or loss)
                this.enemies.forEach(enemy => {
                    enemy.draw(context);
                });
            }
            //FINISH ALPHA CHANGE 667 -- draw enemies early (behind everything else) --
           
            //START ALPHA CHANGE 669 -- MP client only path: P1 bullets (P1 separate call-site) --
            if (this.isMultiplayer &&
                this.steamMultiplayer &&
                !this.steamMultiplayer.isHost &&
                typeof this.steamMultiplayer.drawP1ClientProjectiles === 'function') {
                this.steamMultiplayer.drawP1ClientProjectiles(context);
            }
            //FINISH ALPHA CHANGE 669 -- MP client bullets: explicit P1 pass --
            
            //DRAWING P1 Ship (Host/SP/Client)-- this.ui.draw(context); (draw its own bullets in player.draw)
            if (!this.player.markedForDeletion) { // Only draw if not deleted
                this.player.draw(context);
            }
            //DRAWING P1 SHIELD -- ALPHA CHANGE 668 -- move P1 shield before P2 so it sits behind it (P1 is drawn before P2)
            this.shield.draw(context); // always draws P1’s shield (when active)
            
            //P2 BULLETS (MP) -- CLIENT ONLY PATH
            //START ALPHA CHANGE 670 -- MP client only path: P2 bullets (separate call-site) --
            if (this.isMultiplayer &&
                this.steamMultiplayer &&
               !this.steamMultiplayer.isHost &&
                typeof this.steamMultiplayer.drawP2ClientProjectiles === 'function') {
                this.steamMultiplayer.drawP2ClientProjectiles(context);
            }
            //FINISH ALPHA CHANGE 670 -- MP client bullets: explicit P2 pass --

            //DRAWING P2 PLAYER (MP) HOST/CLIENT PATH (drawing its own bullets for host MP)
            //start change -- multiplayer -- second player inserted after the first player
                if (this.isMultiplayer && this.player2 && !this.player2.markedForDeletion) {
            this.player2.draw(context); // Draw second player
            }

            //DRAWING P2 SHIELD (MP) HOST/CLIENT 
            //START ALPHA CHANGE 477 -- MP: draw independent P2 shield overlay from SteamMultiplayer --
                if (this.isMultiplayer &&
                    this.steamMultiplayer &&
                    typeof this.steamMultiplayer.drawP2ShieldOverlay === 'function') {
                    this.steamMultiplayer.drawP2ShieldOverlay(context);
                }
            //FINISH ALPHA CHANGE 477 -- MP: draw independent P2 shield overlay from SteamMultiplayer --

            //DRAWING PARTICLES (before explosions so explosions sit of top)
            this.particles.forEach(particle => particle.draw(context));

            //DRAWING EXPLOSIONS 
            this.explosions.forEach(explosion => {
                explosion.draw(context);
            });
            
            
        //START ALPHA CHANGE 364 -- MP: flashing ship labels "ALPHA 01"/"ALPHA 02" drawn locally --
        if (this.isMultiplayer) {
            try {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const blinkOn = (((now / 400) | 0) % 2) === 0; // ~2.5 Hz blink
                const oldAlign = context.textAlign, oldFont = context.font, oldFill = context.fillStyle;
                const oldBaseline = context.textBaseline;                  //START ALPHA CHANGE 365

                // common style
                context.textAlign = "center";
                context.textBaseline = "top";                              //START ALPHA CHANGE 365 -- make Y control intuitive (top of text)
                // scale font to ship size, but keep it small
                const p1h = this.player.height | 0;
                const fontPx = Math.max(12, Math.min(20, (p1h * 0.18) | 0));
                context.font = String(fontPx) + "px " + this.ui.fontFamily;
                context.fillStyle = blinkOn ? "#ff0000" : "#880000";
                const labelYOffset = -3;                                   //START ALPHA CHANGE 365 -- tweak here: positive=down, negative=up

                // label above P1
                const p1cx = this.player.x + (this.player.width * 0.5);
                const p1cy = this.player.y + labelYOffset;                 //START ALPHA CHANGE 365
                context.fillText("ALPHA 01", p1cx, p1cy);

                // label above P2 (only if present)
                if (this.player2 && !this.player2.markedForDeletion) {
                    const p2cx = this.player2.x + (this.player2.width * 0.5);
                    const p2cy = this.player2.y + labelYOffset;            //START ALPHA CHANGE 365
                    context.fillText("ALPHA 02", p2cx, p2cy);
                }

                // restore
                context.textAlign = oldAlign;                               //START ALPHA CHANGE 365
                context.textBaseline = oldBaseline;                         //START ALPHA CHANGE 365
                context.font = oldFont; context.fillStyle = oldFill;        //START ALPHA CHANGE 365
            } catch (e) {
                console.warn("[UI] ship labels draw failed:", e);
            }
        }
        //FINISH ALPHA CHANGE 364 -- MP: flashing ship labels --
        

        //LAYER 4
        this.background.layer4.draw(context);
        
        if (this.gameState === "playing" && this.paused) {
            this.ui.draw(context); // Draw pause menu after all game elements
        } else if (this.gameState === "playing" && !this.paused) {
            this.ui.draw(context); // Draw UI normally for in-game HUD
        } else if (this.gameState === "mainMenu") {
        // START GAMMA CHANGE 53 — draw only the session-closed banner on main menu
        if (this.ui && typeof this.ui.drawMainMenuOverlay === "function") {
            this.ui.drawMainMenuOverlay(context);
           }
        // FINISH GAMMA CHANGE 53
        }
        //ENEMIES->P1 BULLETS->P1 SHIP->P1 SHIELD->P2 BULLETS->P2 SHIP->P2 SHIELD->PARTICLES->EXPLOSIONS->ALPHA 01/02 LABELS
        //perchè se i nemici non sono davanti ai proiettili si overlappano col nemico invece che scomparire appena lo toccano
        //(andando dietro di loro -- visivamente perfetto) e le particelle se no escolo dal centro e non è bello da vedere 
    }
        addEnemy(){
            //START ALPHA CHANGE 478 -- split spawn logic into tunable normal vs powerup ratio --
            //START ALPHA CHANGE 480 -- enforce strict 80/20 ratio via 5-slot pattern (4 normals + 1 powerup) --
            // Lazy-init spawn pattern index
            if (typeof this._spawnPatternIndex !== "number") this._spawnPatternIndex = 0;

            // Regenerate a shuffled [ 'P', 'N', 'N', 'N', 'N' ] pattern at the start of each 5-spawn block
            if (!Array.isArray(this._spawnPattern) ||
                this._spawnPattern.length !== 5 ||      //tunable → 6 for ~16.7% powerup enemies) 
                (this._spawnPatternIndex % 5) === 0) {  //tunable → 6 for ~16.7% powerup enemies) 

                const pattern480 = ['P', 'N', 'N', 'N', 'N']; // 1 powerup, 4 normals → exact 20% powerups (tunable → add N for ~16.7% powerup enemies)
                for (let i = pattern480.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = pattern480[i];
                    pattern480[i] = pattern480[j];
                    pattern480[j] = tmp;
                }
                this._spawnPattern = pattern480;
            }

            const slotIdx480 = this._spawnPatternIndex % this._spawnPattern.length;
            const slotType480 = this._spawnPattern[slotIdx480];
            this._spawnPatternIndex++;

            if (slotType480 === 'N') {
                // NORMAL ENEMIES: preserve original relative weights within 80 "normal" points
                const normalRoll = Math.random() * 85;
                if (normalRoll < 15) this.enemies.push(new Razorfin(this));        // 0–15 → width 15 (14.1% global)
                else if (normalRoll < 35) this.enemies.push(new Angler1(this));    // 15–35 → width 20 (18.8% global)
                else if (normalRoll < 50) this.enemies.push(new Stalker(this));    // 35–50 → width 15 (14.1% global)
                else if (normalRoll < 60) this.enemies.push(new Angler2(this));    // 50–60 → width 10 (9.4% global)
                else if (normalRoll < 70) this.enemies.push(new BulbWhale(this));  //  60–70 → width 10 (9.4% global)
                else this.enemies.push(new HiveWhale(this));                       //  70–85 → width 15 (14.1% global)
            } else {
                // POWERUP ENEMIES: exactly 1 in each 5-spawn block (20% of baseline spawns),
                // Lucky vs Moon is still randomized here
                const powerupRoll = Math.random(); // random 0.5 → about half Moon, half Lucky over time -- tunable: 0.6 → 60% Moon / 40% Lucky 
                if (powerupRoll < 0.5) this.enemies.push(new MoonFish(this));
                else this.enemies.push(new LuckyFish(this));
            }
            //console.log(this.enemies)
            //FINISH ALPHA CHANGE 480 -- enforce strict 80/20 ratio via 5-slot pattern (4 normals + 1 powerup) --
            //FINISH ALPHA CHANGE 478 -- split spawn logic into tunable normal vs powerup ratio --

        /* math explained
           With normalRoll = Math.random() * 85, the ranges are:
           Razorfin: 0–15 → width 15
           Angler1: 15–35 → width 20
           Stalker: 35–50 → width 15
           Angler2: 50–60 → width 10
           BulbWhale: 60–70 → width 10
           HiveWhale: 70–85 → width 15
           Total width = 85.

           So within the normal group:
           Razorfin: 15 / 85 ≈ 17.65% of normals
           Angler1: 20 / 85 ≈ 23.53%
           Stalker: 15 / 85 ≈ 17.65%
           Angler2: 10 / 85 ≈ 11.76%
           BulbWhale:10 / 85 ≈ 11.76%
           HiveWhale:15 / 85 ≈ 17.65%
          
           Since normals are 80% of all spawns, multiply each by 0.8 to get global percentages (including Lucky and Moon):
           Razorfin: 0.8 × 15/85 ≈ 14.1% of all enemies
           Angler1: 0.8 × 20/85 ≈ 18.8%  of all enemies
           Stalker: 0.8 × 15/85 ≈ 14.1%  of all enemies
           Angler2: 0.8 × 10/85 ≈ 9.4%   of all enemies
           BulbWhale:0.8 × 10/85 ≈ 9.4%  of all enemies
           HiveWhale:0.8 × 15/85 ≈ 14.1% of all enemies         
        */  
        }

        addExplosion(enemy){//host-side gameplay event + network send
            // START BETA CHANGE 41 -- host: send tiny reliable explosion event to client --
             //START ALPHA CHANGE 542 -- Explosion: per-enemy scale tuning (bigger enemies → bigger boom) --
            let expScale = 0.25; // default (matches Explosion general fallback) specifically affecting enemies if undefined 
            try {
                const t = enemy && enemy.type;
                if (t === "hive") expScale = 0.50;
                else if (t === "bulbwhale") expScale = 0.40;
                else if (t === "razor") expScale = 0.39;
                else if (t === "stalk") expScale = 0.35;
                else if (t === "angler2") expScale = 0.30;
                else if (t === "angler1") expScale = 0.28;
                else if (t === "drone") expScale = 0.23;
                else if (t === "missile") expScale = 0.24;
                else if (t === "moon") expScale = 0.25;
                else if (t === "lucky") expScale = 0.22;
            } catch (_) {}
            //FINISH ALPHA CHANGE 542 -- moved before the multiplayer block below so it will also propagate to the client 
            try {
                if (this.steamMultiplayer && this.steamMultiplayer.isMultiplayer && this.steamMultiplayer.isHost) {
                    const cx = (enemy.x + enemy.width * 0.5) | 0;
                    const cy = (enemy.y + enemy.height * 0.5) | 0;
                    if (typeof this.steamMultiplayer.encodeExplosionToBuffer === 'function') {
                        const buf = this.steamMultiplayer.encodeExplosionToBuffer(cx, cy, expScale); // MP explosions: include scaleByte in EXPLOSION packet -- ALPHA CHANGE 543
                        this.steamMultiplayer.sendNetworkBinary(buf, 'Reliable');
                    }
                }
            } catch (e) {
                console.warn('[NET][HOST] failed to send explosion event:', e);
            }
            // FINISH BETA CHANGE 41 -- host notify --
           
            //START ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) --
            this.explosions.push(new Explosion(this, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5, expScale)); //added "expScale" -- ALPHA CHANGE 542
            //FINISH ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) -- 
            //In Explosion constructor we changed the signature to accept a 4th param: constructor(game, x, y, scaleOverride) { ... } 
            //In addExplosion(enemy) now we pass that 4th param: this.explosions.push(new Explosion(this, cx, cy, expScale));        
        }
        addPlayerExplosion() { // New method for player explosion
             //START ALPHA CHANGE 544 -- MP: send player-death explosion event (scaleByte) + spawn booms for both ships --
            const expScale = 0.50; // tune here (client will reproduce this scale via PLAYER_EXPLOSION)
            try {
                if (this.steamMultiplayer && this.steamMultiplayer.isMultiplayer && this.steamMultiplayer.isHost) {
                    if (typeof this.steamMultiplayer.encodePlayerExplosionToBuffer === 'function') { //will send byte for remote explosion on the client
                        const buf = this.steamMultiplayer.encodePlayerExplosionToBuffer(expScale);
                        this.steamMultiplayer.sendNetworkBinary(buf, 'Reliable');
                    }
                }
            } catch (e) {
                console.warn('[NET][HOST] failed to send player explosion event:', e);
            }
            //FINISH ALPHA CHANGE 544 -- MP: send player-death explosion event --
            //START ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) --local explosion
            this.explosions.push(new Explosion(this, this.player.x + this.player.width * 0.5, this.player.y + this.player.height * 0.5, expScale)); //ALPHA CHANGE 544 -- MP: added expScale--
            //FINISH ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) --
            //START ALPHA CHANGE 544 -- MP: shared-shield death hides P2 too (visual parity with client) -- local explosion
            try {
                const p2 = this.player2;
                if (p2) {
                    this.explosions.push(new Explosion(this, p2.x + p2.width * 0.5, p2.y + p2.height * 0.5, expScale)); //P2 explosion in the host 
                }
            } catch (_) {}
            //FINISH ALPHA CHANGE 544 -- MP: shared-shield death for P2 too --
            for (let i = 0; i < 10; i++) {
                this.particles.push(new Particle(this, this.player.x + this.player.width * 0.5, this.player.y + this.player.height * 0.5));
            }
            this.sound.explosion();
        }
        // START BETA CHANGE 42 -- client: render explosion at coordinates from a network event -- this is client-side playback of the event sent by addExplosion(enemy)
        addExplosionAt(x, y, scaleOverride) {//added "scaleOverride" -- ALPHA CHANGE 543 
             //START ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) --
            this.explosions.push(new Explosion(this, x, y, scaleOverride)); //added "scaleOverride" -- ALPHA CHANGE 543
             //FINISH ALPHA CHANGE 541 -- Explosion: spawn single unified Explosion (no Smoke/Fire subclasses) --
            // (optional) if you want sound for remote explosions too:
            if (this.sound && typeof this.sound.explosion === 'function') {
                this.sound.explosion();
            }
        }
        // FINISH BETA CHANGE 42 -- client helper --
    checkCollision(rect1, rect2){ //ALPHA CHANGE 681 -- checkCollision: require finite, positive collider dims (else fallback) --
    //START ALPHA CHANGE 333 -- use optional collider (colOX/colOY/colW/colH) with legacy fallback --
    
    const useColA = !!(rect1 && Number.isFinite(rect1.colW) && Number.isFinite(rect1.colH) && rect1.colW > 0 && rect1.colH > 0);
    const useColB = !!(rect2 && Number.isFinite(rect2.colW) && Number.isFinite(rect2.colH) && rect2.colW > 0 && rect2.colH > 0);
    
    //checking: "rect1 exists", "rect1.colW and rect1.colH are finite numbers", "they are positive (> 0)" ---> useColA becomes true (same for useColB)

    //START ALPHA CHANGE 682 -- checkCollision: one-time log when collider fallback is used --
    try {
        if (!this._warnedColFallback682 && (!useColA || !useColB)) { //there is no “already warned” flag set && either A is not using collider OR B is not using collider
            this._warnedColFallback682 = true; //when any collision check happens where A or B fails the “valid collider” test, it logs: 

            const aType = rect1 && (rect1.type || rect1.id || (rect1.constructor && rect1.constructor.name) || 'unknownA'); 
            const bType = rect2 && (rect2.type || rect2.id || (rect2.constructor && rect2.constructor.name) || 'unknownB');
            //whether collider was used (useColA, useColB), bject “type/name” guess (aType, bType), collider dims if present (aColW, aColH, etc.), legacy dims (aW, aH, etc.)

            console.warn(
                '[checkCollision] Collider fallback used (legacy x/y/width/height).', //Message with expandable object
                { useColA, aType, aColW: rect1 && rect1.colW, aColH: rect1 && rect1.colH, aW: rect1 && rect1.width, aH: rect1 && rect1.height,
                  useColB, bType, bColW: rect2 && rect2.colW, bColH: rect2 && rect2.colH, bW: rect2 && rect2.width, bH: rect2 && rect2.height }
            );
        }
    } catch (_) {}
    //FINISH ALPHA CHANGE 682 -- checkCollision: one-time log when collider fallback is used --

    const a = useColA
      ? { x: rect1.x + (rect1.colOX | 0), y: rect1.y + (rect1.colOY | 0), width: (rect1.colW | 0), height: (rect1.colH | 0) } //main logic 
      : { x: rect1.x, y: rect1.y, width: rect1.width, height: rect1.height }; //-->fallback 

    //-->when "useColA" is true, it builds collider rect a from: x = rect1.x + rect1.colOX, y = rect1.y + rect1.colOY, width = rect1.colW, height = rect1.colH
    //-->when useColA is false: use fallback (original/legacy collision method: treat the sprite’s draw box as the collision box)
    const b = useColB
      ? { x: rect2.x + (rect2.colOX | 0), y: rect2.y + (rect2.colOY | 0), width: (rect2.colW | 0), height: (rect2.colH | 0) }
      : { x: rect2.x, y: rect2.y, width: rect2.width, height: rect2.height };

    //-->same for "b" when "useColB" is true -- That’s the “main path”: use the tight collision rectangle. Note: (value | 0) forces integer conversion,
    //it truncates floats and turns undefined into 0, but since you already required colW/colH to be finite + >0, that part is safe for width/height)
    
    return ( a.x < b.x + b.width &&
             a.x + a.width > b.x &&
             a.y < b.y + b.height &&
             a.y + a.height > b.y );
    //FINISH ALPHA CHANGE 333 -- use optional collider (colOX/colOY/colW/colH) with legacy fallback --
    }    
        reset() {//RESTART GAME 
            this.player = new Player(this);
            this.keys = [];
            this.enemies = [];
            this.particles = [];
            this.explosions = [];
            //start change -- multiplayer
            this.player2 = null; // Reset player2
            this.isMultiplayer = false; // Reset multiplayer flag
            //finish change -- multiplayer 
            this.enemyTimer = 0;
            this.ammo = 50;
            this.ammoTimer = 0;
            this.shieldEnergy = 50;
            this.shieldTimer = 0;
            this.gameOver = false;
            this.score = 0;
            this.gameTime = 0;
            //START ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at game.reset() --
            this.playerDied = false;
            this.gameWon = false;
            //FINISH ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at game.reset() --
            //START ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
            this._winScoreEverReached683 = false;
            this._winScoreAtOrAbove683   = false;
            this._winScoreBannerText683  = "";
            this._winScoreBannerUntilMs683 = 0;
            //FINISH ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
            this.paused = false;
            //START ALPHA CHANGE 457 -- Shield: keep OFF on restart (no auto 2s burst or sound) --
            if (this.shield) {
                this.shield.active      = false;
                this.shield.activeTimer = 0;
                this.shield.timer       = 0;
                this.shield.frameX      = 0;
            }
            //FINISH ALPHA CHANGE 457 -- Shield: keep OFF on restart (no auto 2s burst or sound) --
            this.background = new Background(this);
            this.sound.resetSoundtrack();
            //START ALPHA CHANGE 558 -- singleplayer: play intro voice on every restart --
             if (!this.steamMultiplayer || !this.steamMultiplayer.isMultiplayer) { //only play in multiplayer -- alpha One message --
                  this.sound.intro();
            }
            //START ALPHA CHANGE 637 -- multiplayer: play MP intro voice on every restart --
            else {
                  this.sound.MPintro();
            }
            //FINISH ALPHA CHANGE 637 -- multiplayer: play MP intro voice on every restart --
            //FINISH ALPHA CHANGE 558 -- singleplayer: play intro voice on every restart --
            this.gameOverMenuDelayTimer = null; // Reset delay timer
            this.gameOverMenuActive = false; // Reset menu active flag
            this.gameState = "playing";
            //NEW MODIFICATION: Reset name input state
            this.awaitingNameInput = false; // Reset input state
            this.newHighScore = null;
            this.namePromptTriggered = false; // NEW: Reset flag
            this.nameSubmitted = false;
            this.ui.loggedLeaderboard = false; // NEW: Reset UI log flag
            // STARTING TWELFTH CHANGE: Reset menu selection
            this.ui.selectedMenuIndex = 0;
            // FINISHED TWELFTH CHANGE
            //START GAMMA CHANGE 4
            // Preserve multiplayer session on Restart: if an MP game is active, keep MP flags
            // and recreate Player 2 so the host doesn’t lose P2 after reset.
            if (this.steamMultiplayer &&
                this.steamMultiplayer.isMultiplayer &&
                this.steamMultiplayer.lobbyState === "playing") {

                 this.isMultiplayer = true;                         // keep game-side MP flag
                this.player2 = new Player(this);                   // recreate P2 entity
                this.player2.x = 100;                              // same offset used at MP start
                this.player2.y = (this.height * 0.45) | 0;         // START GAMMA CHANGE 10 — spawn a bit above center
                this.steamMultiplayer.player2 = this.player2;      // sync reference used by MP layer

                // Anchor P2 at this spawn until client reports a near-by position
                this.steamMultiplayer._p2SpawnX = this.player2.x;  // START GAMMA CHANGE 10
                this.steamMultiplayer._p2SpawnY = this.player2.y;  // START GAMMA CHANGE 10
                this.steamMultiplayer._p2RequireNearSpawn = true;  // START GAMMA CHANGE 10

                //START ALPHA CHANGE 208 -- host local restart: clear auto-score latch for the new round --
                if (this.steamMultiplayer && typeof this.steamMultiplayer._teamAutoScoreDone !== "undefined") {
                    this.steamMultiplayer._teamAutoScoreDone = false;
                }
                //FINISH ALPHA CHANGE 208 -- host local restart: clear auto-score latch for the new round --

                // Nudge client to re-init (has handler already)
                if (typeof this.steamMultiplayer.encodeGameStartToBuffer === 'function') {
                    const buf = this.steamMultiplayer.encodeGameStartToBuffer();
                    this.steamMultiplayer.sendNetworkBinary(buf, 'Reliable');
                }
                // Note: lobby/session persists; this is just a spawn sync.
            }
            //FINISH GAMMA CHANGE 10
        }
    returnToMainMenu() {//TORNA AL MENU PRINCIPALE 
    //START ALPHA CHANGE 708 -- cursor: force visible + cancel pending hide when leaving gameplay --
    if (this.input && typeof this.input.showCursorAndCancel707 === "function") {
        this.input.showCursorAndCancel707();
    }
    //FINISH ALPHA CHANGE 708 -- cursor: force visible + cancel pending hide when leaving gameplay --
    //START GAMMA CHANGE 14 — fully leave MP session when returning to main menu
     // Centralize MP cleanup: let SteamMultiplayer tear down the session
    if (this.steamMultiplayer) {//ALPHA CHANGE 702 note: -- if you add "&& this.steamMultiplayer.isMultiplayer" condition here to only call leavelobby in an active MP session it produces a bug where after 
    //MULTIPLAYER->CREATE LOBBY->Gamepad "BACK" it will keep the lobby live because that menu is not seen as an active MP session. So it's best to only checks “does the object exist?" here. This happens because
    //steamMultiplayer.isMultiplayer is still false (because match hasn’t started) but steamMultiplayer.lobbyId is set (lobby really exists) so the "&&isMultiplayer" guard prevents leaveLobby() from running->lobby stays alive->bug 
        this.steamMultiplayer.leaveLobby();
    }
    //FINISH GAMMA CHANGE 14
    this.player = new Player(this);
    this.keys = [];
    this.enemies = [];
    this.particles = [];
    this.explosions = [];
    this.enemyTimer = 0;
    this.ammo = 50;
    this.ammoTimer = 0;
    this.shieldEnergy = 50;
    this.shieldTimer = 0;
    this.gameOver = false;
    this.score = 0;
    this.gameTime = 0;
    //START ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at returnTomainMenu() --
    this.playerDied = false;
    this.gameWon = false;
    //FINISH ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at returnTomainMenu() --
    //START ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
    this._winScoreEverReached683 = false;
    this._winScoreAtOrAbove683   = false;
    this._winScoreBannerText683  = "";
    this._winScoreBannerUntilMs683 = 0;
    //FINISH ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
    this.paused = false;
    //START ALPHA CHANGE 458 -- Shield: keep OFF on restart (no auto 2s burst or sound) --
            if (this.shield) {
                this.shield.active      = false;
                this.shield.activeTimer = 0;
                this.shield.timer       = 0;
                this.shield.frameX      = 0;
            }
    //FINISH ALPHA CHANGE 458 -- Shield: keep OFF on restart (no auto 2s burst or sound) --
    this.background = new Background(this);
    this.sound.pauseSoundtrack(); // pause soundtrack for main menu
    //start change -- play main menu music when returning to main menu--
    this.sound.resetMenuSoundtrack();
    //finish change--
    this.gameState = "mainMenu"; // Set to main menu instead of playing
    this.awaitingNameInput = false;
    this.newHighScore = null;
    this.namePromptTriggered = false;
    this.nameSubmitted = false;
    this.ui.loggedLeaderboard = false;
    this.inactivityTimer = 0;
    this.ui.selectedMenuIndex = 0;
    console.log("Returned to main menu with full reset");
}  
        // START CHANGE: Save key bindings and other settings to localStorage
        //START ALPHA CHANGE 722 -- localStorage: wrap setItem writes in try/catch to prevent settings-change crashes --
        saveKeyBindings() {
            try {
               localStorage.setItem("innbcKeyBindings", JSON.stringify(this.keyBindings));
               console.log("Key bindings saved:", this.keyBindings);
           } catch (e) {
               console.warn("Failed to save Key bindings:", e);
           }
        }
        saveFPSSetting() {
           try {
               localStorage.setItem("innbcShowFPS", JSON.stringify(this.showFPS));
               console.log("FPS setting saved:", this.showFPS);
           } catch (e) {
               console.warn("Failed to save FPS setting:", e);
           }
        }
        //START ALPHA CHANGE 283 -- add save helper for Timer (ms) --
        saveTimeLimitSetting() {
            try {
                localStorage.setItem("innbcTimeLimitMs", String(this.timeLimit|0));
                console.log("Timer setting saved (ms):", this.timeLimit|0);
            } catch (e) {
                console.warn("Failed to save Timer setting:", e);
            }
        }
        //FINISH ALPHA CHANGE 283 -- add save helper for Timer (ms) --
        //START ALPHA CHANGE 429 -- add save helper for Hard mode (boolean, independent of timer) --
        saveHardModeSetting() {
            try {
                localStorage.setItem("innbcHardMode", this.hardMode ? "true" : "false");
                console.log("Hard mode setting saved:", this.hardMode);
            } catch (e) {
                console.warn("Failed to save Hard mode setting:", e);
            }
        }
        //FINISH ALPHA CHANGE 429 -- add save helper for Hard mode --
        //start change -- add method to save gamepad bindings to localStorage//
        saveGamepadBindings() {
             try {
                localStorage.setItem("innbcGamepadBindings", JSON.stringify(this.gamepadBindings));
                console.log("Gamepad bindings saved:", this.gamepadBindings);
            } catch (e) {
                console.warn("Failed to save Gamepad bindings:", e);
            }
        }
        //finish change//
        //FINISH ALPHA CHANGE 722 -- localStorage: wrap setItem writes in try/catch to prevent settings-change crashes --
    
    // Reset keyboard bindings to default
    resetAllSettings() {
    // Clear localStorage
    //START ALPHA CHANGE 723 -- localStorage: guard removeItem calls in resetAllSettings to prevent storage-unavailable crashes --
    try {
        localStorage.removeItem("innbcKeyBindings");
    } catch (e) {
        console.warn("Failed to remove innbcKeyBindings during reset:", e);
    }
    try {
        localStorage.removeItem("innbcGamepadBindings");
    } catch (e) {
        console.warn("Failed to remove innbcGamepadBindings during reset:", e);
    }
    try {
        localStorage.removeItem("innbcShowFPS");
    } catch (e) {
        console.warn("Failed to remove innbcShowFPS during reset:", e);
    }
    //START ALPHA CHANGE 286 -- also clear persisted Timer key --
    try {
        localStorage.removeItem("innbcTimeLimitMs");
    } catch (e) {
        console.warn("Failed to remove innbcTimeLimitMs during reset:", e);
    }
    //FINISH ALPHA CHANGE 286 -- also clear persisted Timer key --
    //START ALPHA CHANGE 429 -- also clear persisted Hard mode flag --
    try {
        localStorage.removeItem("innbcHardMode");
    } catch (e) {
        console.warn("Failed to remove innbcHardMode during reset:", e);
    }
    //FINISH ALPHA CHANGE 429 -- also clear persisted Hard mode flag --
    //FINISH ALPHA CHANGE 723 -- localStorage: guard removeItem calls in resetAllSettings to prevent storage-unavailable crashes --
    
    // Reset to default values
    this.keyBindings = {
        moveUp: "ArrowUp",
        moveDown: "ArrowDown",
        moveLeft: "ArrowLeft",
        moveRight: "ArrowRight",
        fire: " ",
        pause: "p"
        // debug: "q" // Commented out for release
    };
    this.gamepadBindings = {
        moveUp: "axis_1_neg",
        moveDown: "axis_1_pos",
        moveLeft: "axis_0_neg",
        moveRight: "axis_0_pos",
        fire: "button_0",
        pause: "button_9"
        // debug: "button_13" // Commented out for release
    };
    //START ALPHA CHANGE 284 -- reset live Timer to default (1:30) --
    this.timeLimit = 90000;
    //FINISH ALPHA CHANGE 284 -- reset live Timer to default (1:30) --
    //START ALPHA CHANGE 429 -- reset live Hard mode flag to default (false) --
    this.hardMode = false;
    //FINISH ALPHA CHANGE 429 -- reset live Hard mode flag --
    this.showFPS = true; // Default to true as specified
    
    //start change -- call toggleFullScreen if in fullscreen and sync localStorage//
    const wasFullScreen = this.fullScreen; // Store current state
    this.fullScreen = false;
    if (wasFullScreen) {
        this.toggleFullScreen(); // Call to exit fullscreen
        //START ALPHA CHANGE 722 -- localStorage: guard innbcFullScreen write in resetAllSettings --
        try {
            localStorage.setItem("innbcFullScreen", "false"); // Sync with main.js
        } catch (e) {
            console.warn("Failed to save innbcFullScreen during reset:", e);
        }
        //FINISH ALPHA CHANGE 722 -- localStorage: guard innbcFullScreen write in resetAllSettings --
    }
    //finish change//
    
    console.log("All settings reset to defaults:", {
        keyBindings: this.keyBindings,
        gamepadBindings: this.gamepadBindings,
        fullScreen: this.fullScreen,
        showFPS: this.showFPS
    });
}
     //start change -- centralizing fullscreen control with Electron API//
        toggleFullScreen() {
        if (window.require) {
           const { ipcRenderer } = window.require('electron');
           ipcRenderer.send('toggle-fullscreen');
           console.log("Sent toggle-fullscreen IPC");        
        } else {
            console.warn("Electron not available, fullscreen toggle skipped");
        }
      }
      //finish change//

        // END CHANGE
        // START CHANGE: Check for key binding conflicts
    checkKeyConflict(key, actionToBind) {
        const actionKeyMap = {
            "Move Up": "moveUp",
            "Move Down": "moveDown",
            "Move Left": "moveLeft",
            "Move Right": "moveRight",
            "Fire": "fire",
            "Pause": "pause"
            // "Debug Toggle": "debug" // Commented out for release
        };
        const targetKey = actionKeyMap[actionToBind];
        for (let action in this.keyBindings) {
            if (action !== targetKey && this.keyBindings[action] === key) {
                return true; // Key is already used
            }
        }
        return false; // Key is available
    }
    //start change -- add method to check gamepad binding conflicts//
    checkGamepadConflict(input, actionToBind) {
        const actionKeyMap = {
            "Move Up": "moveUp",
            "Move Down": "moveDown",
            "Move Left": "moveLeft",
            "Move Right": "moveRight",
            "Fire": "fire",
            "Pause": "pause"
            // "Debug Toggle": "debug" // Commented out for release
        };
        const targetKey = actionKeyMap[actionToBind];
        for (let action in this.gamepadBindings) {
            if (action !== targetKey && this.gamepadBindings[action] === input) {
                return true; // Input is already used
            }
        }
        return false; // Input is available
    }
    //finish change//
    // END CHANGE

            // CHANGE 4.4: Add startGame method to transition from loading to playing
          startGame() {//START GAME 
          // FIX NUMBER 2, CHANGE THIS: Reset key game state
        this.gameState = "playing";
        this.gameOver = false; // Ensure game-over is cleared
        this.player = new Player(this); // New instance
        this.player.x = 20; // Starting x position
        this.player.y = this.height / 2 - this.player.height / 2; // Center vertically
        //start change -- multiplayer
        if (this.steamMultiplayer.isMultiplayer) {
            this.isMultiplayer = true;
            this.steamMultiplayer.startMultiplayerGame();
        } else {
        // Existing startGame logic
            this.gameState = "playing";
            this.isMultiplayer = false; // Ensure single-player mode
        }
        // finish change -- multiplayer
         //START ALPHA CHANGE 708 -- cursor: arm hide timer on gameplay start (even without mousemove) --
        if (this.input && typeof this.input.armCursorHideTimer707 === "function") {
            this.input.armCursorHideTimer707();
        }
        //FINISH ALPHA CHANGE 708 -- cursor: arm hide timer on gameplay start (even without mousemove) --
        //Note: not need to also arm it on restart game because restart always happen after startgame or it will briefly appeart at each restart 
        this.ammo = this.maxAmmo; // Full ammo
        this.shieldEnergy = this.maxShieldEnergy; // Full shield
        // FIX NUMBER 3, CHANGE THIS: Optional - clear demo enemies and particles
        this.enemies = [];
        this.particles = [];
        this.explosions = [];
        this.enemyTimer = 0;  
        //this.sound.playSoundtrack(); changed to restart music from 0
        this.gameTime = 0; // Reset timer to avoid instant time-out
        this.score = 0; // Reset score to avoid win condition
        //START ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at startGame --
        this.playerDied = false;
        this.gameWon = false;
        //FINISH ALPHA CHANGE 655 -- reset run outcome flags (playerDied/gameWon) at startGame --
        //START ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
        this._winScoreEverReached683 = false;
        this._winScoreAtOrAbove683   = false;
        this._winScoreBannerText683  = "";
        this._winScoreBannerUntilMs683 = 0;
        //FINISH ALPHA CHANGE 683 -- win-score crossing banners: reset per run --
        //START ALPHA CHANGE 553 -- startGame: reset game-over 2s delay state so win voice plays on first win --
        this.gameOverMenuDelayTimer = null;
        this.gameOverMenuActive = false;
        //FINISH ALPHA CHANGE 553 -- startGame: reset game-over 2s delay state so win voice plays on first win --
        this.sound.pauseMenuSoundtrack(); // pause main menu music and start game soundtrack
        this.sound.resetSoundtrack(); // Reset and play music from start
        //START ALPHA CHANGE 557 -- startGame: play intro voice once (non-loop) --
        if (!this.steamMultiplayer || !this.steamMultiplayer.isMultiplayer) {
             this.sound.intro(); //only play in single player -- alpha One message -- 
        }
        //FINISH ALPHA CHANGE 557 -- startGame: play intro voice once (non-loop) --
        this.leaderboard.loadLeaderboard(); // Refresh leaderboard on start
        //START ALPHA CHANGE 459 -- startGame: reset shield visual burst + shot debounce on new run --
        if (this.shield) {
            this.shield.active = false;      // ensure shield visuals are OFF at new game start
            this.shield.activeTimer = 0;     // clear any leftover burst timer
            this.shield.frameX = 0;          // rewind sheet to first frame
            this.shield.timer = 0;           // clear frame timer
        }
        if (this.input) {
            // Seed shot debounce so we don’t accidentally treat old timestamps as ready-to-fire
            const now = (typeof performance !== 'undefined' && performance.now)
                ? performance.now()
                : Date.now();
            this.input.lastShotTime = now;   // exact field used in InputHandler for fire rate
        }
        //FINISH ALPHA CHANGE 459 -- startGame: reset shield visual burst + shot debounce on new run --
        console.log("StartGame - gameOver:", this.gameOver, "gameState:", this.gameState); // Debug
        // STARTING FOURTEENTH CHANGE: Reset inactivity timer
            this.inactivityTimer = 0;
            // FINISHED FOURTEENTH CHANGE
          }
          //NEW MODIFICATION: Add submitName method to handle name input
        submitName(name) {
            if (name && this.awaitingNameInput && this.newHighScore !== null && !this.nameSubmitted) {
        //START ALPHA CHANGE 692 -- leaderboard: auto-prefix SP difficulty tag on saved name --
        const diff692 = this.hardMode ? "HARD" : (((this.timeLimit|0) >= 120000) ? "EASY" : "NORMAL");
        const taggedName692 = `SP_${diff692}_${name}`;
        this.leaderboard.addEntry(this.newHighScore, taggedName692);
        this.awaitingNameInput = false;
        this.newHighScore = null;
        this.nameSubmitted = true;
        this.input.nameInput = ""; // Clear input
        this.input.nameInputCursor = null; // Clear cursor
        console.log("Submitted name to leaderboard:", taggedName692);
        //FINISH ALPHA CHANGE 692 -- leaderboard: auto-prefix SP difficulty tag on saved name --
    }
        }

    // CHANGE 4.5: Add demo mode logic
    // demo mode -- removed 
    // END CHANGE 4.5
    //start change -- add isImagesLoaded method to ensure all images are loaded// 
    // (removed) legacy isImagesLoaded(): AssetsLoading.isRenderReady() is now the single render gate
  }
  //finish of game class 
// Note 2: Move animation loop outside the Game class and into the load event listener

//Start SteamAchievements class for handling Steam achievements//
class SteamAchievements {
        constructor(game) {
            this.game = game; //per quello this.gameWon diventa this.game.gameWon
            this.achievedWin = false; // Flag to prevent multiple triggers

            //START ALPHA CHANGE 650 -- achievements: add separate latch for HARD win achievement --
            this.achievedWinHard = false; // Flag to prevent multiple triggers for ACH_WIN_HARD
            //FINISH ALPHA CHANGE 650 -- achievements: add separate latch for HARD win achievement --

              //START ALPHA CHANGE 700 -- score achievements: split into mixed / normal-only / hard-only --
            // Mixed: allowed in NORMAL + HARD (but still blocked in EASY by outer gating)
            this.scoreMixed700 = [ //Note: scoreMixed700 the "700" suffix is added for tracking with "ALPHA CHANGE 700" change 
                { id: 'ACH_SCORE_400', threshold: 400, triggered: false },
                { id: 'ACH_SCORE_600', threshold: 600, triggered: false },
                { id: 'ACH_SCORE_850', threshold: 850, triggered: false }
            ];

            // Normal-only: allowed ONLY in NORMAL
            this.scoreNormalOnly700 = [
                { id: 'ACH_SCORE_750', threshold: 750, triggered: false },
                { id: 'ACH_SCORE_800', threshold: 800, triggered: false },
                { id: 'ACH_SCORE_900', threshold: 900, triggered: false },
                { id: 'ACH_SCORE_1000', threshold: 1000, triggered: false }
            ];

            // Hard-only: allowed ONLY in HARD
            this.scoreHardOnly700 = [
                { id: 'ACH_SCORE_750_HARD', threshold: 750, triggered: false },
                { id: 'ACH_SCORE_800_HARD', threshold: 800, triggered: false },
                { id: 'ACH_SCORE_900_HARD', threshold: 900, triggered: false },
                { id: 'ACH_SCORE_1000_HARD', threshold: 1000, triggered: false }
            ];
            //FINISH ALPHA CHANGE 700 -- score achievements: split into mixed / normal-only / hard-only --
        //finish change//
        }

    update() {
    //START ALPHA CHANGE 653 (overwrites ALPHA CHANGE 649) -- achievements: in MP client, use host mpTimeLimit/mpHardMode for gating --
    const g = this.game;
    
    // Multiplayer gate:
    const sm = g && g.steamMultiplayer;
    const isMultiplayer = !!(sm && sm.isMultiplayer);
    const isHost653 = !!(sm && sm.isHost);
    const isMPClient653 = (isMultiplayer && !isHost653);

    // Difficulty source:
    // - SP + MP host: local options (timeLimit/hardMode)
    // - MP client: host snapshot (mpTimeLimit/mpHardMode)
    const hardMode = isMPClient653 ? !!(g && g.mpHardMode) : !!(g && g.hardMode);
    const timeLimitMs = isMPClient653
        ? ((g && typeof g.mpTimeLimit === "number") ? g.mpTimeLimit : ((g && typeof g.timeLimit === "number") ? g.timeLimit : 0))
        : ((g && typeof g.timeLimit === "number") ? g.timeLimit : 0);

    const EASY_MS = 120000;
    const isEasy = (!hardMode && timeLimitMs >= EASY_MS);
    const isNormal653 = (!hardMode && !isEasy); // NORMAL bucket (90s)
    const isHard653 = !!hardMode;

    // If MP client hasn't received host difficulty yet, don't allow score achievements to fire.
    const haveHostDifficulty653 = (!isMPClient653) || (typeof g.mpTimeLimit === "number" && typeof g.mpHardMode === "boolean");
    //FINISH ALPHA CHANGE 653 (overwrites ALPHA CHANGE 649) -- achievements: MP client uses host difficulty --

    // Check for win condition (score > winningScore)
    //START ALPHA CHANGE 651 -- ACH_WIN only on NORMAL (no EASY, no HARD) + singleplayer --
    if (this.game.gameState === "playing" && //ALPHA CHANGE 706 -- achievements: gate WIN achievements to gameplay state ("playing") to prevent menu-trigger leaks; gameOver UI runs while state remains "playing" --
        this.game.gameOver &&
        this.game.gameWon &&            //ALPHA CHANGE 658 -- use centralized gameWon "this.score >= this.winningScore" --> "this.game.gameWon" 
        !this.achievedWin &&
        !hardMode &&               // <-- NEW: block HARD (so NORMAL only)
        !isEasy &&                 // <-- block EASY (redundant with !hardMode in your current isEasy logic, but kept explicit)
        !isMultiplayer             // <-- singleplayer only
    ) {
        this.achievedWin = true; // Set flag to prevent re-trigger
        console.log("ACH_WIN condition met - Score:", this.game.score, "Sending IPC message");
        // Send IPC message to index.js to trigger ACH_WIN
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('trigger-achievement', 'ACH_WIN');
            console.log("Sent trigger-achievement IPC for ACH_WIN");
        } else {
            console.warn("Electron not available, ACH_WIN IPC skipped");
        }
    }
    //FINISH ALPHA CHANGE 651 -- ACH_WIN NORMAL-only --

    //START ALPHA CHANGE 650 -- ACH_WIN_HARD: HARD only + singleplayer only --
    if (this.game.gameState === "playing" && //ALPHA CHANGE 706 -- achievements: prevent menu leaks by requiring gameState "playing" for WIN achievements --
        this.game.gameOver &&
        this.game.gameWon &&             //ALPHA CHANGE 658 -- use centralized gameWon "this.score >= this.winningScore" --> "this.game.gameWon"
        !this.achievedWinHard &&
        hardMode &&                // <-- NEW: ONLY HARD (no NORMAL/EASY)
        !isMultiplayer             // <-- NEW: singleplayer only
    ) {
        this.achievedWinHard = true; // Set flag to prevent re-trigger
        console.log("ACH_WIN_HARD condition met - Score:", this.game.score, "Sending IPC message");
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('trigger-achievement', 'ACH_WIN_HARD');
            console.log("Sent trigger-achievement IPC for ACH_WIN_HARD");
        } else {
            console.warn("Electron not available, ACH_WIN_HARD IPC skipped");
        }
    }
    //FINISH ALPHA CHANGE 650 -- ACH_WIN_HARD --

    // Check score-based achievements during gameplay (not only when game is over)
    if (this.game.gameState === "playing") {//gameOver UI runs while state remains "playing" so we gate it to it to avoid leaks in menu

        //START ALPHA CHANGE 701 (overwrites ALPHA CHANGE 653 and 649) -- score achievements: gate by list (mixed / normal-only / hard-only) + MP client host-difficulty gate --
        if (!isEasy && haveHostDifficulty653) {
            const currentScore = this.game.score;

            // Helper: try to unlock all achievements in a given list
            const _tryUnlockList701 = (list) => {
                if (!Array.isArray(list) || !list.length) return;

                for (let i = 0; i < list.length; i++) {
                    const achievement = list[i];
                    if (!achievement || achievement.triggered) continue;

                    if (currentScore >= achievement.threshold) {
                        console.log(`Achievement ${achievement.id} condition met - Score: ${currentScore}, Sending IPC message`);
                        if (window.require) {
                            const { ipcRenderer } = window.require('electron');
                            ipcRenderer.send('trigger-achievement', achievement.id);
                            console.log(`Sent trigger-achievement IPC for ${achievement.id}`);
                            achievement.triggered = true; // Mark as triggered to prevent repeat
                        } else {
                            console.warn(`Electron not available, ${achievement.id} IPC skipped`);
                        }
                    }
                }
            };

            // Mixed: allowed in NORMAL + HARD (EASY already blocked by outer if)
            _tryUnlockList701(this.scoreMixed700);

            // Normal-only
            if (isNormal653) {
                _tryUnlockList701(this.scoreNormalOnly700);
            }

            // Hard-only
            if (isHard653) {
                _tryUnlockList701(this.scoreHardOnly700);
            }
        }
        //FINISH ALPHA CHANGE 701 (overwrites ALPHA CHANGE 653 and 649) -- score achievements: gate by list (mixed / normal-only / hard-only) + MP client host-difficulty gate --
    }         
    }
}
    //finish SteamAchievements class
    //Start SteamMultiplayer class
    class SteamMultiplayer {
    constructor(game) {
        this.game = game;
        this.isMultiplayer = false; // Flag for co-op mode
        this.isHost = false; // True if hosting, false if client
        this.lobbyId = null; // Current lobby ID
        this.opponentSteamId = null; // Other player's Steam ID
        this.lobbies = []; // List of available lobbies
        this.selectedLobbyIndex = 0; // For lobby selection UI
        this.lobbyState = "none"; // "none", "listing", "creating", "joining", "inLobby", "playing"
        this.player2 = null; // Second player instance
        this.networkTimer = 0; // For sending/receiving network updates
        this.networkInterval = 16; // Send updates every 16ms(60hz) to match P2P Polling Rate in index.js
        //START ALPHA CHANGE 473 -- MP P2 shield overlay: per-instance timers/state (host + client) --
        this._p2ShieldActive = false;              // overlay ON/OFF for P2
        this._p2ShieldFrameX = 0;                  // 0..48 frame index (matches Shield.maxFrame)
        this._p2ShieldTimerMs = 0;                 // frame-interval accumulator
        this._p2ShieldActiveMs = 0;                // elapsed ms in current burst
        this._p2ShieldIntervalMs = 1000 / 60;      // match Shield.fps = 60
        this._p2ShieldDurationMs = 1000;           // 1s burst window (same as Shield.activeDuration)
        this._p2ShieldLastRenderTimeMs = null;     // local dt clock for overlay renderer
        //FINISH ALPHA CHANGE 473 -- MP P2 shield overlay: per-instance timers/state (host + client) --
        //START ALPHA CHANGE 468 -- legacy shield mirror overlay logic (_lastShieldHitOwner) -- removed 469-470-471-416
        //START ALPHA CHANGE 169 -- client-side: track last applied host tick to reject old/out-of-order frames
        this._lastAppliedTick = -1;
        //FINISH ALPHA CHANGE 169
        this.enableNetLogs = false;               // master toggle for noisy NET logs (host/client) abilita i log pesanti 
        //START ALPHA CHANGE 165
        //this._enemyAnimTimer = 0;                 // time accumulator for client enemy sprite frames (ms)
        //this._enemyAnimInterval = 1000 / 60;      // target enemy animation cadence, matches ~host 60 Hz -- decidi il frame rate dei nemici nel mp 
        //FINISH ALPHA CHANGE 165 

        //START ALPHA CHANGE 138 -- host: per-bullet ID stores (local, not networked)
        this._projIdP1 = new WeakMap(); // Projectile(instance) -> uint16 id
        this._projIdP2 = new WeakMap(); // Projectile(instance) -> uint16 id
        this._nextProjIdP1 = 1;         // roll over at 65535 -> 1
        this._nextProjIdP2 = 1;         // roll over at 65535 -> 1
        //FINISH ALPHA CHANGE 138 -- host: per-bullet ID stores (local, not networked)
        //START GAMMA CHANGE 11
        this.p2ProjectileSpeed = 10; // configurable host-side speed for P2 bullets to match single-player
        //FINISH GAMMA CHANGE 11

        //START ALPHA CHANGE 166 — client: persistent enemy instances by UID (eid)
        this._enemyByUid = new Map();
        //FINISH ALPHA CHANGE 166 — client: persistent enemy instances by UID (eid)

        //START ALPHA CHANGE 95 -- auto-refresh cadence + last-refresh markers --
        this._lobbyAutoRefreshInterval = 5000;  // ms, auto-refresh period while on Join Lobby
        this._lobbyRefreshTimer = 0;            // accumulates deltaTime in update()
        this._lastLobbyRefreshAt = 0;           // timestamp of last refresh (performance.now or Date.now)
        this._lastLobbyRefreshManual = false;   // Step 1: always false; Step 2 will flip on manual presses
        //FINISH ALPHA CHANGE 95 -- auto-refresh cadence + last-refresh markers -

        // === BINARY NET CONSTANTS / MAPPINGS ===
        this.PKT = { 
                     GAME_STATE: 1, // host → client
                     PLAYER_INPUT: 2, // client → host
                     EXPLOSION: 3, // host → client (reliable)
                     GAME_START: 4, // host → client (reliable)
                     RESTART_REQ: 5, // client → host (reliable)
                     LEAVE_NOTICE: 6, // either → peer (reliable): one side is exiting-to-menu
                     HELLO: 7,      // host → client (unreliable): 1-byte warm-up ping in lobby (set opponentSteamId and get client ready to start game) -- GAMMA CHANGE 67
                     PONG:  8,
                     //START ALPHA CHANGE 178 -- add PARTICLE opcode for client particle bursts --
                     PARTICLE: 9,  // host → client (unreliable): spawn particle burst at x,y with kind,count
                     //FINISH ALPHA CHANGE 178 -- add PARTICLE opcode for client particle bursts --       // client → host (unreliable): reply to warm-up; host marks _p2pReady -- GAMMA CHANGE 67
                     //START ALPHA CHANGE 205 -- new opcode for host→client automatic team score signal --
                     AUTO_SCORE: 10, // host → client (reliable): instruct client to auto-save team score
                     //FINISH ALPHA CHANGE 205 -- new opcode for host→client automatic team score signal --
                     HIT: 11, //START ALPHA CHANGE 413 -- new: host → client (unreliable): ship–enemy body collision SFX -- //FINISH ALPHA CHANGE 413
                     POWERUP: 12, //START ALPHA CHANGE 418 -- host → client (unreliable): play power-up SFX on client -- sostituito da ALPHA 421 -- no tenuto perchè non copriva edge case powerup sound when already powered up
                     PLAYER_EXPLOSION: 13, // host→client reliable: trigger P1+P2 ships death explosion on client
                     WIN_SCORE_BANNER: 14, //ALPHA CHANGE 686 -- MP: on-demand win-score banner event (host→client, reliable) -- payload: kind(u8) 1=reached/above, 2=below-after-reaching --
                     MISSILE: 15 // ALPHA CHANGE 738 -- host → client (unreliable): play missile spawn SFX
                    }; 
        //START ALPHA CHANGE 187 -- client SFX dedupe for host P1 bullets --
        this._p1ShotHeard = new Set();
        //FINISH ALPHA CHANGE 187 -- client SFX dedupe for host P1 bullets --            
        //START ALPHA CHANGE 145 -- host: per-enemy UID stores --
        this._enemyIdMap = new Map();     // Enemy object -> uint16 id  //START ALPHA CHANGE 145
        this._nextEnemyId = 1;            // wraps at 65535             //FINISH ALPHA CHANGE 145
        //FINISH ALPHA CHANGE 145 -- host: per-enemy UID stores --          
        //GAMMA CHEANGE 23 -- packets che invii all'host ad esempio restart request e viene decodificato in GAMMA CHANGE 24
        //GAMMA CHANGE 42 -- add LEAVE_NOTICE opcode so peer can signal “exit to main menu”
        //START ALPHA CHANGE 67
        // Warm-up handshake state (used by HELLO/PONG path) -- initializating the fields in the constructor
        this._p2pReady = false;   // becomes true on host when PONG is received
        this._helloTimer = 0;     // accumulates delta to send HELLO at ~60Hz
        this.helloInterval = 16;  // ~16ms cadence (matches networking tick)
        //FINISH ALPHA CHANGE 67 
        //START ALPHA CHANGE 89
        // Client-only UI hint: flip join-lobby overlay to "P2P ... YES" when we SEND PONG (do NOT change _p2pReady)
        this._p2pLikelyEstablished = false;
        //FINISH ALPHA CHANGE 89
        // Track last time we heard from the peer; used for ONLINE/OFFLINE UI
        this._lastPeerPacketAt = 0; //START GAMMA CHANGE 26
        //FINISH GAMMA CHANGE 26
        //START GAMMA CHANGE 38 -- host auto-exit guard so we do it once
        this._autoLeaveFired = false;
        //FINISH GAMMA CHANGE 38
        // Enemy <-> id map for compact enemy serialization -- ALPHA CHANGE 308 -- add stalker -- ALPHA CHANGE 376 -- add Missile
        this.enemyTypeToId = {
            Angler1: 1, Angler2: 2, LuckyFish: 3, HiveWhale: 4,
            Drone: 5, BulbWhale: 6, MoonFish: 7, Razorfin: 8, Stalker: 9, Missile: 10
        };
        this.enemyIdToCtor = {
            1: Angler1, 2: Angler2, 3: LuckyFish, 4: HiveWhale,
            5: Drone,   6: BulbWhale, 7: MoonFish, 8: Razorfin, 9: Stalker, 10: Missile
        };
        // === END BINARY CONSTANTS ===

        // Initialize Steamworks callbacks
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('lobby-list', (event, lobbies) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                this.lobbies = lobbies || [];
                this.selectedLobbyIndex = Math.min(this.selectedLobbyIndex, this.lobbies.length - 1);//if this.lobbies.length === 0, then this.lobbies.length - 1 === -1. so when lobby list is empty (0)
                //there is no selection (-1) and it’s a valid “no row selected” sentinel, and it matches the way the UI already behaves (we also set selectedMultiplayerIndex = -1 when focus is not on the list).
                //Joining is not driven by selectedLobbyIndex so nothing critical indexes lobbies[] using it, as keyboard/mouse/gamepad do not rely on it to enter in list focus, they use: real[this.game.ui.selectedMultiplayerIndex],
                //row.lobbyId, and focus + this.game.ui.selectedMultiplayerIndex (in this order). So, selectedLobbyIndex is mainly a sync/highlight cache so the SteamMultiplayer object “knows” what the UI is currently pointing at.
                if (this.lobbies.length === 0) {
                    console.warn("No lobbies received or lobby list request failed");
                } else {
                    console.log("Received lobby list:", this.lobbies);
                }
            });
            ipcRenderer.on('lobby-created', (event, lobbyId) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                this.lobbyId = lobbyId;
                this.isHost = true;
                this.lobbyState = "inLobby";
                //START ALPHA CHANGE 68
                this._p2pReady = false;   // arm warm-up for the new lobby
                this._helloTimer = 0;     // start counting immediately
                //FINISH ALPHA CHANGE 68
                console.log("Lobby created, ID:", lobbyId);
                //START ALPHA CHANGE 213 -- set friendly lobby name: INNBC_STAR_<REGION>_<CUSTOM><first6digits(lobbyId)> --
                try {
                    // pull Region/CUSTOM from UI (defaults exist from ALPHA 210)
                    const ui = this.game && this.game.ui;
                    const regions = (ui && Array.isArray(ui._lobbyRegions) && ui._lobbyRegions.length)
                        ? ui._lobbyRegions : [{ code: "US", label: "United States" }];
                    const rIdx = ui && typeof ui._lobbyRegionIndex === "number"
                        ? Math.max(0, Math.min(regions.length - 1, ui._lobbyRegionIndex)) : 0;
                    const regionCode = (regions[rIdx] && regions[rIdx].code) ? regions[rIdx].code : "US";

                    // sanitize custom tag: A–Z, 0–9, _, max 6, uppercase, default COOP
                    const rawCustom = (ui && ui._lobbyCustomTag) ? ui._lobbyCustomTag : "COOP";
                    const custom = (String(rawCustom).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 6)) || "COOP";

                    // compute suffix = first 6 decimal digits of lobbyId
                    const idStr = String(lobbyId);
                    const digits = idStr.replace(/\D/g, "");
                    const suffix = (digits.slice(0, 6) || "000000").padEnd(6, "0");

                    const finalName = `INNBC_STAR_${regionCode}_${custom}${suffix}`;

                    // Cache on renderer so host overlay can display it immediately
                    this._friendlyLobbyName = finalName;

                    if (window.require) {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.send('set-lobby-name', lobbyId, finalName);
                        console.log(`[MP] Requested set-lobby-name: ${finalName}`);
                    } else {
                        console.warn("[MP] Electron not available; skipped set-lobby-name IPC");
                    }
                } catch (e) {
                    console.warn("[MP] Failed to build/send friendly lobby name:", e);
                }
                //FINISH ALPHA CHANGE 213 -- set friendly lobby name --
            });
            ipcRenderer.on('lobby-joined', (event, lobbyId, success) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                if (success) {
                    this.lobbyId = lobbyId;
                    this.isHost = false;
                    this.lobbyState = "inLobby";
                    //START ALPHA CHANGE 68
                    this._p2pReady = false; // make sure any previous session state doesn’t carry over
                    this._helloTimer = 0;
                    //FINISH ALPHA CHANGE 68
                    console.log("Joined lobby, ID:", lobbyId);
                } else {
                    this.lobbyState = "none";
                    console.error("Failed to join lobby");
                }
            });
            ipcRenderer.on('lobby-player-joined', (event, steamId) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                this.opponentSteamId = steamId;
                //START ALPHA CHANGE 68
                if (this.isHost) this._helloTimer = this.helloInterval; // host: force a HELLO send on next update tick
                //FINISH ALPHA CHANGE 68
                console.log("Player joined lobby, SteamID:", steamId);
            });
            //START ALPHA CHANGE 91 -- react to main-process lobby-player-left by tearing down locally
            ipcRenderer.on('lobby-player-left', (event, payload) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                try {
                    const info = (payload && typeof payload === 'object') ? payload : { lobbyId: payload, steamId: undefined };
                    // Only act for our current lobby; safe to call leaveLobby() idempotently
                    if (this.lobbyId != null && String(this.lobbyId) === String(info.lobbyId)) {
                        this.leaveLobby();
                    }
                } catch (e) {
                    console.warn('[MP] lobby-player-left handler failed:', e);
                }
            });
            //FINISH ALPHA CHANGE 91 -- react to main-process lobby-player-left by tearing down locally
            // START CHANGE BINARY-ONLY PATH -- receive raw buffers, no JSON
            ipcRenderer.on('network-binary', (event, buffer, sender) => {//event declared but unused: it is the IPC metadata object (sender, etc.). It’s always passed as the first argument.
                try {
                    this.handleBinaryMessage(buffer, sender);
                } catch (e) {
                    console.error('[NET][CLIENT/HOST] binary handler error:', e);
                }
            });
            //FINISH BETA CHANGE -- BINARY-ONLY PATH --
        }
    }

    update(deltaTime) {
        //START GAMMA CHANGE 67 -- Send 1-byte HELLO while host is in lobby (pre-return in update(deltaTime))
        // Host warm-up: in lobby, spam tiny HELLO (~60 Hz, UnreliableNoDelay) until we receive a PONG
        if (this.isHost && this.lobbyState === "inLobby" && this.opponentSteamId && !this._p2pReady) {
            this._helloTimer += deltaTime;
            if (this._helloTimer >= this.helloInterval) {
                this._helloTimer = 0;
                try {
                    const h = this.encodeHelloToBuffer();
                    this.sendNetworkBinary(h, 'UnreliableNoDelay');
                    // (silent by default; add logging if needed)
                } catch (e) {
                    console.warn('[NET][HOST] HELLO send failed:', e);
                }
            }
        }//FINISH GAMMA CHANGE 67
        //START ALPHA CHANGE 96 -- auto-refresh lobby list while viewing Join Lobby --
        try {
            // Only auto-refresh when user is on the Join Lobby screen AND we haven't already joined a lobby
            //START ALPHA CHANGE 103 -- pause during busy lobby ops (joining/creating) to avoid flicker --
            const _busyLobbyOp = (this.lobbyState === "joining" || this.lobbyState === "creating");
            if (this.game && this.game.gameState === "joinLobby" && this.lobbyState !== "inLobby" && !_busyLobbyOp) {
            //FINISH ALPHA CHANGE 103 -- pause during busy lobby ops (joining/creating) to avoid flicker --
                this._lobbyRefreshTimer += deltaTime;
                if (this._lobbyRefreshTimer >= this._lobbyAutoRefreshInterval) {
                    this._lobbyRefreshTimer = 0;
                    this._lastLobbyRefreshManual = false; // Step 1: treat as auto
                    this.requestLobbyList();
                    // timestamp for UI flash
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    this._lastLobbyRefreshAt = now;
                }
            } else {
                // Reset the timer when leaving the Join Lobby UI
                this._lobbyRefreshTimer = 0;
            }
        } catch (e) {
            console.warn("[MP] auto-refresh loop error:", e);
        }
        //FINISH ALPHA CHANGE 96 -- auto-refresh lobby list while viewing Join Lobby --
        if (!this.isMultiplayer || this.lobbyState !== "playing") return;

        //START ALPHA CHANGE 111
        // CLIENT: visuals-only tick so explosions animate/clean up while client skips full simulation
        if (this.isMultiplayer && !this.isHost && !this._hostPauseActive) { // ALPHA CHANGE 454 -- disabled when remote host pause is active 
            try {
                //START ALPHA CHANGE 159 — extend client visuals-only tick (no physics)
                // Background parallax layers
                this.game.background.update(deltaTime); //ALPHA CHANGE 448 -- MP client: pass deltaTime to background parallax layers --
                this.game.background.layer4.update(deltaTime); // ALPHA CHANGE 448 -- MP client: pass deltaTime to background parallax layers --

                // Shield animation — advance shared shield sprite frames (used for P1; P2 shield is drawn separately via drawP2ShieldOverlay)
                if (this.game && this.game.shield) this.game.shield.update(deltaTime); //START ALPHA CHANGE 159

                // Sprite-only animation helper (only advance animation frames -- movement handled separately in ALPHA CHANGE 453)
                //On the client, enemy.update() never runs during MP (the visuals-only branch advances frames in _tickSprite)
                //Remote actor on a peer → uses _tickSprite(remote, deltaTime) (frames-only, time-based), while Local simulated actor → uses its own update(deltaTime) (time-based); 
                //START ALPHA CHANGE 440 -- CLIENT MP visuals-only: use Shield-style timer/interval (no _animEvery) --
                // Use exactly the single-player pattern: timer += dt; if (timer > interval) step frame.
                const _tickSprite = (o, dt) => {
                    if (!o) return;
                    if (typeof o.timer !== 'number' || typeof o.interval !== 'number' || o.interval <= 0) return; // require timer/interval

                    o.timer += dt;
                    if (o.timer > o.interval) {
                        o.timer = 0;
                        if (typeof o.frameX === 'number' && typeof o.maxFrame === 'number') {
                            o.frameX = (o.frameX < o.maxFrame) ? (o.frameX + 1) : 0;
                        }
                    }
                };
                
                // Animate P1 (host ship) locally on client -- P1 frames-only visuals path -- P2 runs full player2.update(deltaTime) in the BETA CHANGE 31
                _tickSprite(this.game.player, deltaTime); //START ALPHA CHANGE 159

                // Advance enemy sprite frames locally (movement hanled in ALPHA CHANGE 453) -- START ALPHA CHANGE 159
                //START ALPHA CHANGE 169 -- use _tickSprite per enemy (It advances only frameX via each enemy’s timer/interval-- matches SP) 
                if (Array.isArray(this.game.enemies) && this.game.enemies.length) { // this.game.enemies -- i nemici sono animati qui 
                    for (let i = 0; i < this.game.enemies.length; i++) {
                        const e = this.game.enemies[i];
                        _tickSprite(e, deltaTime); //START ALPHA CHANGE 169 -- — switch enemies to per-enemy tick based on their own frameInterval
                    }
                }
                //FINISH ALPHA CHANGE 169
                
                //START ALPHA CHANGE 453 -- CLIENT: time-based enemy X from host gameTime + spawnGameTimeMs (no fixed 60Hz accumulator) --
                if (!this._hostPauseActive && Array.isArray(this.game.enemies)) { // ALPHA CHANGE 454 -- not include local client pause (&& !this.game.paused) here to be coherent (client pause cannot stop game world) -- coherent = cool 
                    // Robustly derive a client-side estimate of host gameTime in ms
                    
                    //Step 1 — Convert delta to ms (this is from the local deltatime)
                    //START ALPHA CHANGE 713 -- MP client: fix dtMs unit detection for high-FPS (240/360Hz) -- impossible to mis-detect at high FPS
                    const dtMs = deltaTime; // always ms — no heuristic needed
                    //FINISH ALPHA CHANGE 713 -- MP client: fix dtMs unit detection for high-FPS -- impossible to mis-detect at high FPS
                    
                    //Step 2 — Seed _clientHostTimeMs on first use -- Despite the name, _clientHostTimeMs is client’s best estimate of host time, advanced locally each frame, then bounded by the last received host clock
                    if (typeof this._clientHostTimeMs !== 'number') {
                        // The first time this runs, the client clock starts at the latest known host clock (gameTime in GAME_STATE).
                        this._clientHostTimeMs = (this.game && typeof this.game.gameTime === 'number')
                            ? (this.game.gameTime | 0) : 0; // If you somehow don’t have host gameTime yet, you fall back to 0 (rare, but safe)
                    } else {
                        this._clientHostTimeMs += dtMs; //Step 3 — Advance it locally each render frame -- this is what makes motion smooth between snapshots
                        
                        //Step 4 — Clamp it relative to the latest snapshot host time (with a “best compromise control”)
                        if (this.game && typeof this.game.gameTime === 'number') {
                            const hostG = (this.game.gameTime | 0);

                            //START ALPHA CHANGE 695 -- CLIENT: fixed render bias (ms) to reduce remaining perceived offset --
                            const renderBiasMs695 = 50; // tune this (e.g. 0..50). Higher = render more "in the past" -- 30 feels good -- 50 feels perfect compromise
                            const hostGBiased695 = hostG - renderBiasMs695;
                            

                            // never render earlier than (host time – bias)
                            if (this._clientHostTimeMs < hostGBiased695) { 
                                this._clientHostTimeMs = hostGBiased695;      
                            }

                            // maxLead controls how far ahead the client render time is allowed to be relative to host time: (+)increase= more smoothness between snapshots, (-)decrease = collisions closer to real time -- lag versus jitter basically 
                            const maxLead = 50; // 50 seems the best compromise -- huge improvement in collision timing and with minimal/no noticieable jitter 
                            if (this._clientHostTimeMs > hostGBiased695 + maxLead) { 
                                this._clientHostTimeMs = hostGBiased695 + maxLead;  //FINISH ALPHA CHANGE 695 -- CLIENT: fixed render bias (ms) to reduce remaining perceived offset --
                            }
                        }
                    }

                    //Step 5 — Use the clamped time to render enemy X deterministically
                    const tMs = this._clientHostTimeMs | 0;
                    const gSpeed = (this.game && typeof this.game.speed === 'number') ? this.game.speed : 0;
                    const motionFps = 60; // match Enemy.motionFps default (per-frame speeds at 60 fps)

                    if (this.game.enemies.length) {
                        for (let i = 0; i < this.game.enemies.length; i++) {
                            const e = this.game.enemies[i];

                            // Ensure spawn fields are present; fall back to current pose/time if missing
                            if (typeof e.__spawnX !== 'number') e.__spawnX = e.x;
                            const spawnMs = (typeof e.__spawnGameTimeMs === 'number')
                                ? (e.__spawnGameTimeMs | 0)
                                : tMs;
                            const ageMs = Math.max(0, tMs - spawnMs);

                            // Same kinematic as single-player: (speedX - game.speed) interpreted as "per frame at 60 fps"
                            const sx = (typeof e.speedX === 'number')
                                ? e.speedX
                                : (typeof this.defaultEnemySpeedX === 'number' ? this.defaultEnemySpeedX : -1);
                            const vx = (sx - gSpeed) * (motionFps / 1000); // px/ms

                            e.x = e.__spawnX + vx * ageMs;
                            // DO NOT markForDeletion here; host snapshots control lifecycle/removal
                        }
                    }
                }
                //FINISH ALPHA CHANGE 453 -- CLIENT: time-based enemy X from host gameTime + spawnGameTimeMs --
                 
                // Existing explosion life-cycles (keep as-is)
                this.game.explosions.forEach(explosion => explosion.update(deltaTime)); //START ALPHA CHANGE 111
                this.game.explosions = this.game.explosions.filter(explosion => !explosion.markedForDeletion); //FINISH ALPHA CHANGE 111
                //FINISH ALPHA CHANGE 159 — extend client visuals-only tick (no physics)
                //START ALPHA CHANGE 181 -- client: animate & cull particles like in SP so they don’t freeze --
                this.game.particles.forEach(particle => particle.update(deltaTime));
                this.game.particles = this.game.particles.filter(particle => !particle.markedForDeletion);
                //FINISH ALPHA CHANGE 181 -- client: animate & cull particles --
            } catch (e) {
                console.warn('[MP][CLIENT] visuals tick (explosions) failed:', e);
            }
        }
        //FINISH ALPHA CHANGE 111 -- CLIENT: visuals-only tick while client skips full simulation

        this.networkTimer += deltaTime;
        if (this.networkTimer >= this.networkInterval) {
            this.networkTimer = 0;
            if (this.isHost) { //Replace the whole block with binary send
                const buf = this.encodeGameStateToBuffer();
                // ~60Hz — send reliably to preserve total order
                this.sendNetworkBinary(buf, 'Reliable'); // ALPHA CHANGE 390 flip from UnreliableNoDelay to Reliable to solve lag issues with not in order packets
                //START ALPHA CHANGE 179 -- gate & slow host net log
                // Throttled log each 60th tick (≈1/sec), gated by enableNetLogs
                if (this.enableNetLogs && (this.hostTick % 60) === 0) {
                    // Enemies count is encoded; log from live array to keep cost tiny
                    console.log(`[NET][HOST→CLIENT] send gameState tick=${this.hostTick} enemies=${Math.min(this.game.enemies.length,30)} score=${this.game.score}`);
                }
                //FINISH ALPHA CHANGE 179 -- gate & slow host net log
            }
            // Client: Send compact inputs
            if (!this.isHost && this.player2) { //keep heartbeats during host pause to not trigger 15s offline condition
                const ibuf = this.encodePlayerInputsToBuffer();
                this.sendNetworkBinary(ibuf, 'UnreliableNoDelay');
            }
        }

        //start change -- multiplayer logic 
      //START BETA CHANGE 31 -- client authoritative: host must NOT update player2 locally --
      //this block runs on the client -- it enforces the ALPHA 30 condition on the client: only the client runs player2.update(...) (and only when not paused)
      //Client path (!this.isHost): runs player2.update(deltaTime) (movement + animation), unless host-pause is active
if (this.isMultiplayer && this.player2 && !this.isHost) {
    //START ALPHA CHANGE 65
    const localPaused = !!(this.game && this.game.paused);
    if (this._hostPauseActive || localPaused) { //ALPHA CHANGE 691 -- extend the pause condition to include local pause
        // Freeze local movement while host-pause is active
        //this.game.keys = []; // removed: clearing keys every frame in the “paused” branch is redundant, and for local pause it’s actively harmful UX-wise
        this.player2.speedX = 0;
        this.player2.speedY = 0;
        // (skip update to stop movement/accel)
    } else {
        this.player2.update(deltaTime); // Update second player
    }
    //FINISH ALPHA CHANGE 65
}
//FINISH BETA CHANGE 31 -- client authoritative: host must NOT update player2 locally --


// HOST: visuals-only sprite tick for Player 2 (advance frames locally; no physics here) -- because in BETA CHANGE 30 you do not run player2 locally
//Host path (this.isHost): does not run player2.update(...); visuals-only frame-advance helper so P2’s sprite animates without it moving the ship (only P2/client can move the ship)
//START ALPHA CHANGE 440 -- HOST P2 visuals-only: use Shield-style timer/interval (no _animEvery) -- this block runs on the host 
if (this.isMultiplayer && this.isHost && this.player2 && !this.game.paused) { //ALPHA CHANGE 454 -- added pause condition for P2 animation (&& !this.game.paused)
    try {
        const o = this.player2;
        if (typeof o.timer === 'number' && typeof o.interval === 'number' && o.interval > 0) {
            // Use host's frame delta when available (host draw path owns deltaTime here) -- aggiornato al deltatime da _animEvery
            const dt = (typeof deltaTime === 'number') ? deltaTime : 0;
            o.timer += dt;
            if (o.timer > o.interval) {
                o.timer = 0;
                if (typeof o.frameX === 'number' && typeof o.maxFrame === 'number') {
                    o.frameX = (o.frameX < o.maxFrame) ? (o.frameX + 1) : 0;
                }
            }
        }
    } catch (e) {
        console.warn('[MP][HOST] visuals-only tick for P2 failed:', e);
    }
}
//FINISH ALPHA CHANGE 440 -- HOST P2 visuals-only: timer/interval only --
        //finish change -- multiplayer logic 

        //START GAMMA CHANGE 3
        // host still advances P2's projectiles so they move/render/collide locally
        //START ALPHA CHANGE 673 -- HOST pause: freeze P2 bullets too --
        if (this.isMultiplayer && this.isHost && this.player2 && Array.isArray(this.player2.projectiles) && !this.game.paused) {
            //FINISH ALPHA CHANGE 673 -- HOST pause: freeze P2 bullets too --
            this.player2.projectiles.forEach(p => {
                p.speed = this.p2ProjectileSpeed; //START GAMMA CHANGE 11 -- set projectile speed matching player 1
                p.update(deltaTime);
            });
            //FINISH GAMMA CHANGE 11
            this.player2.projectiles = this.player2.projectiles.filter(p => !p.markedForDeletion);
        }
        //FINISH GAMMA CHANGE 3

        //START ALPHA CHANGE 128 — HOST: tick P2 power-up visuals (sprite row/frameY) without moving P2 -- nell'host per settare il powerup visivamente per il P2
        //Host-owned power-up expiry for P2 -- Client mirrors p2Pow from GAME_STATE; it does not run a local countdown 
        try {
            if (this.isMultiplayer && this.isHost && this.player2 && !this.game.paused) {
                if (this.player2.powerUp) {
                    this.player2.frameY = 1;                        //START ALPHA CHANGE 114 -- utilizza sprite row 1 per il modello powerup
                    this.player2.powerUpTimer = (this.player2.powerUpTimer || 0) + deltaTime; // match Player.update timing
                    const limit = (typeof this.player2.powerUpLimit === 'number') ? this.player2.powerUpLimit : 10000; 
                    if (this.player2.powerUpTimer > limit) {        
                        this.player2.powerUp = false;               // expire visual power-up
                        this.player2.powerUpTimer = 0;
                        this.player2.frameY = 0;                    // back to normal sprite row
                    }
                } else {
                    this.player2.frameY = 0;                        // ensure normal row when not powered up
                }
            }
        } catch (e) {
            console.warn('[HOST] P2 power-up visual tick failed:', e);
        }
        //FINISH ALPHA CHANGE 128 — HOST: tick P2 power-up visuals (sprite row/frameY) without moving P2

        //START ALPHA CHANGE 205 -- HOST: on game-over win, auto-save local leaderboard & notify client once --
        try {
            if (this.isMultiplayer && this.isHost && this.lobbyState === "playing") {
                if (this.game && this.game.gameOver && this.game.gameWon) {//ALPHA CHANGE 658 -- use centralized gameWon "this.score >= this.winningScore" --> "this.game.gameWon"
                    if (!this._teamAutoScoreDone) {
                        this._teamAutoScoreDone = true; // one-shot latch
                        // Suppress any name prompt path on host
                        if (this.game.awaitingNameInput) this.game.awaitingNameInput = false; //START ALPHA CHANGE 205
                        this.game.namePromptTriggered = true; // avoid showing input UI
                        // Auto-add locally if it qualifies
                        if (this.game.leaderboard && typeof this.game.leaderboard.qualifies === 'function' &&
                            this.game.leaderboard.qualifies(this.game.score)) {
                            //START ALPHA CHANGE 693 -- MP leaderboard: auto-tag by difficulty (host) --
                            const diff693 = this.game.hardMode ? "HARD" : (((this.game.timeLimit|0) >= 120000) ? "EASY" : "NORMAL");
                            const name693 = `MP_${diff693}_`;
                            this.game.leaderboard.addEntry(this.game.score, name693);
                            //FINISH ALPHA CHANGE 693 -- MP leaderboard: auto-tag by difficulty (host) --
                        }
                        // Tell client to try the same locally
                        const pkt = this.encodeAutoScoreToBuffer(this.game.score);
                        this.sendNetworkBinary(pkt, 'Reliable'); 
                    }
                }
            }
        } catch (e) {
            console.warn("[MP][HOST] auto team score failed:", e);
        }
        //FINISH ALPHA CHANGE 205 -- HOST: on game-over win, auto-save local leaderboard & notify client once --

        //START ALPHA CHANGE 22 -- client: arm game-over menu after 2s without flipping gameState
        if (this.isMultiplayer && !this.isHost) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (this.game.gameOver) {
                if (!this._clientGameOverAt) {
                    // (edge handled in handleBinaryMessage, but guard if we re-enter)
                    this._clientGameOverAt = now;
                //START ALPHA CHANGE 197 -- client: remove Game Over consume-latching; rely on the 2s inactivity window --
                    this.game.gameOverMenuActive = false; // keep UI locked during the 2s window
                    if (this.game) {
                        // Clear keyboard keys once on edge; DO NOT force any gamepad buttons/nav as "held"
                        if (Array.isArray(this.game.keys)) this.game.keys.length = 0;
                    }
            //FINISH ALPHA CHANGE 197 -- client: remove Game Over consume-latching; rely on the 2s inactivity window --
                } else if (!this.game.gameOverMenuActive && (now - this._clientGameOverAt >= 2000)) {
                    //START ALPHA CHANGE 197 -- enable menu after 2s without latching any buttons for this tick --
                    // Simply enable interaction; stale holds have had 2s to clear naturally
                    this.game.gameOverMenuActive = true; // enable interaction
                    //FINISH ALPHA CHANGE 197 -- enable menu after 2s without latching any buttons for this tick --
                } else {
                    //START ALPHA CHANGE 197 -- during the 2s window we do nothing else; no latching, no nav forcing --
                    //Intentional no-op: inactivity window blocks input handling elsewhere
                    //FINISH ALPHA CHANGE 197 -- during the 2s window we do nothing else; no latching, no nav forcing --
                }
            } else {
                this._clientGameOverAt = null; // reset if host resumed/restarted
            }
        }
        //FINISH ALPHA CHANGE 22
        //START GAMMA CHANGE 39 -- HOST: if peer is offline ≥15s, auto-return to Main Menu
        if (this.isHost && this.isMultiplayer && this.lobbyState === "playing" && !this._autoLeaveFired) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const last = (typeof this._lastPeerPacketAt === 'number') ? this._lastPeerPacketAt : 0;
            if (last > 0) { // START GAMMA CHANGE 41 -- require at least one peer packet before starting 15s offline timer
                const offlineMs = now - last;
                if (offlineMs >= 15000) {
                    this._autoLeaveFired = true;
                    console.log("[MP][HOST] Peer offline ≥15s — auto-returning to main menu");
                    this.leaveLobby(); // will also close lobby + p2p (your existing wiring)
                }
            } // FINISH GAMMA CHANGE 41
        }
        //FINISH GAMMA CHANGE 39
        //START GAMMA CHANGE 63 -- CLIENT: if host offline ≥15s, auto-return to Main Menu
if (!this.isHost && this.isMultiplayer && this.lobbyState === "playing" && !this._autoLeaveFired) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const last = (typeof this._lastPeerPacketAt === 'number') ? this._lastPeerPacketAt : 0;
    if (last > 0) {
        const offlineMs = now - last;
        if (offlineMs >= 15000) {
            this._autoLeaveFired = true;
            console.log("[MP][CLIENT] Host offline ≥15s — auto-returning to main menu");
            this.leaveLobby(); // same teardown path as host
        }
    }
}
//FINISH GAMMA CHANGE 63
    }

    // NEW: binary sender (Buffer + send type string)
    sendNetworkBinary(buffer, sendTypeStr = 'UnreliableNoDelay') {
        if (window.require && this.opponentSteamId) {
            const { ipcRenderer } = window.require('electron');
            // Buffer.from is safe; Node/Electron IPC can pass Buffers directly
            const buf = (buffer instanceof Uint8Array) ? Buffer.from(buffer) : buffer;
            ipcRenderer.send('send-network-binary', this.opponentSteamId, buf, sendTypeStr);
        }
    }
    //START ALPHA CHANGE 114 -- client: draw host bullets from cached snapshot --
    // START ALPHA CHANGE 142 -- client: interpolate bullets by stable bullet IDs (fallback: sort-by-x) -- removed  
    // FINISH ALPHA CHANGE 142 -- client: interpolate bullets by stable bullet IDs (fallback: sort-by-x) -- removed 
    
    //START ALPHA CHANGE 474 -- MP P2 shield overlay renderer (host + client) --
    // Shared renderer for P2 shield burst in multiplayer:
    // - Host toggles this via a helper when P2 collides with non-powerup enemies.
    // - Client toggles this via PKT.HIT(owner=2) handling.
    // Actual animation/draw logic is identical for host + client; only the trigger differs.
    //helper: trigger a fresh MP P2 shield burst (host + client) --
    triggerP2ShieldBurst() {
        if (!this.isMultiplayer) return;

        // Reset P2 overlay timers/frames and flip it ON
        this._p2ShieldActive = true;
        this._p2ShieldFrameX = 0;
        this._p2ShieldTimerMs = 0;
        this._p2ShieldActiveMs = 0;
        this._p2ShieldLastRenderTimeMs = null; // next draw will seed dt
    }

    drawP2ShieldOverlay(context) {
        if (!this.isMultiplayer) return;

        const g = this.game;
        if (!g || !g.player2 || g.player2.markedForDeletion) return;
        if (!g.shield) return; // reuse Shield sprite layout; P2 overlay has its own timers/state

        if (!this._p2ShieldActive) return;

        // Local dt clock for overlay (independent of Game.update)
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        let deltaMs;
        if (typeof this._p2ShieldLastRenderTimeMs === 'number') {
            deltaMs = nowMs - this._p2ShieldLastRenderTimeMs;
        } else {
            // first frame: assume ~60Hz so behaviour matches Shield’s 60fps
            deltaMs = 1000 / 60;
        }
        this._p2ShieldLastRenderTimeMs = nowMs;

        // Clamp to avoid huge jumps or negatives
        if (deltaMs < 0) deltaMs = 0;
        if (deltaMs > 100) deltaMs = 100;

        // Advance timers
        this._p2ShieldActiveMs += deltaMs;
        this._p2ShieldTimerMs += deltaMs;

        // Frame stepping: same pattern as Shield.update (timer/interval → frameX)
        if (this._p2ShieldTimerMs > this._p2ShieldIntervalMs) {
            this._p2ShieldTimerMs = 0;
            this._p2ShieldFrameX = (this._p2ShieldFrameX < 48) ? (this._p2ShieldFrameX + 1) : 0;
        }

        // Auto-stop after duration
        if (this._p2ShieldActiveMs >= this._p2ShieldDurationMs) {
            this._p2ShieldActive = false;
            this._p2ShieldActiveMs = 0;
            this._p2ShieldTimerMs = 0;
            this._p2ShieldFrameX = 0;
            return;
        }

        // Use Shield sprite geometry from game.shield (no duplication of layout constants)
        const s = g.shield;
        //START ALPHA CHANGE 625 -- MP P2 shield overlay: META-only sheetScaled sampling + 1:1 dest sizing (match Shield.draw) --
        let src = s.image || null;
        if (!src) return;

        // Default: RAW sampling + runtime scaling (fallback stays identical)
        let stride = (typeof s._srcStride  === 'number') ? s._srcStride  : 512;
        let srcW   = (typeof s._srcSizeW   === 'number') ? s._srcSizeW   : 360;
        let srcH   = (typeof s._srcSizeH   === 'number') ? s._srcSizeH   : 360;
        let offX   = (typeof s._srcOffsetX === 'number') ? s._srcOffsetX : (stride - srcW) / 2;
        let offY   = (typeof s._srcOffsetY === 'number') ? s._srcOffsetY : (stride - srcH) / 2;

        const scale = (typeof s.scale === 'number') ? s.scale : 1.05;
        const sheetScale = (typeof s._sheetScale === 'number') ? s._sheetScale : (Math.round(scale * 10000) / 10000);

        // Default DEST is legacy behaviour (RAW fallback)
        let dw = Math.round(srcW * scale);
        let dh = Math.round(srcH * scale);

        try {
            const al = g && g.assetsLoading;
            if (al && typeof al.getCachedOrFallback === "function") {
                const id = (src && src.id) ? src.id : "shield";
                const scaledKey = `img:${id}:sheetScaled:${sheetScale}:stride:${stride}`;
                const cand = al.getCachedOrFallback(scaledKey, src); // if missing -> returns raw <img>

                if (cand && cand !== src) {
                    const meta = (al && typeof al.getSheetMeta === "function") ? al.getSheetMeta(scaledKey) : null;
                    if (meta) {
                        // Scaled-sheet path: 1:1 sampling using META (no resample)
                        src    = cand;
                        stride = meta.stride;
                        offX   = meta.offX;
                        offY   = meta.offY;
                        srcW   = meta.srcW;
                        srcH   = meta.srcH;
                        dw     = srcW;
                        dh     = srcH;
                    } else {
                        // Bitmap exists but META missing -> FORCE raw fallback + warn once
                        try {
                            if (!this._warnedP2ShieldMetaMissing625) this._warnedP2ShieldMetaMissing625 = new Set();
                            if (!this._warnedP2ShieldMetaMissing625.has(scaledKey)) {
                                console.warn(`[MP P2 Shield] META MISSING for key=${scaledKey} -> forcing RAW fallback`);
                                this._warnedP2ShieldMetaMissing625.add(scaledKey);
                            }
                        } catch (_) {}
                        src = s.image || src;
                    }
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 625 -- MP P2 shield overlay: META-only sheetScaled sampling + 1:1 dest sizing (match Shield.draw) --

        const idx = this._p2ShieldFrameX | 0;  // 0..48
        const col = idx % 7;
        const row = (idx / 7) | 0;
        const sx  = col * stride + offX;
        const sy  = row * stride + offY;

        // Center overlay on Player 2 ship
        const dx = g.player2.x + (g.player2.width  - dw) / 2;
        const dy = g.player2.y + (g.player2.height - dh) / 2;

        context.drawImage(
            src,
            sx, sy, srcW, srcH,
            dx, dy, dw, dh
        );
    }
    //FINISH ALPHA CHANGE 474 -- MP P2 shield overlay renderer (host + client) --
    
     //START ALPHA CHANGE 671 -- MP client bullets: split renderer into explicit P1/P2 functions (no shared flip-flop) --
    drawP1ClientProjectiles(context) {//Client-only bullet renderer (persistent local map; P1 only)
        if (this.isHost || !this.isMultiplayer) return;

        //START ALPHA CHANGE 176 -- client-only: prevent double-render by clearing local projectile arrays --
        try {
            const g = this.game;
            if (g && !this.isHost) {
                if (g.player && Array.isArray(g.player.projectiles)) g.player.projectiles.length = 0;
                if (g.player2 && Array.isArray(g.player2.projectiles)) g.player2.projectiles.length = 0;
                if (this.player2 && Array.isArray(this.player2.projectiles)) this.player2.projectiles.length = 0; // mirror field safety
            }
        } catch (e) {
            console.warn('[MP][CLIENT] projectile array clear failed (safe to ignore):', e);
        }
        //FINISH ALPHA CHANGE 176 -- client-only: prevent double-render by clearing local projectile arrays --

        const g = this.game;
        const al = g && g.assetsLoading;

        // Get stable fallback <img> elements for BOTH sheets
        let imgElRed  = this._imgFireballEl  || null;   // "fireball"  (red)
        let imgElBlue = this._imgFireball2El || null;   // "fireball2" (blue)

        if (!imgElRed) {
            try {
                imgElRed = (al && typeof al.getImgOrThrow === "function")
                    ? al.getImgOrThrow("fireball")
                    : document.getElementById("fireball");
            } catch (_) { imgElRed = null; }
            this._imgFireballEl = imgElRed;
        }
        if (!imgElBlue) {
            try {
                imgElBlue = (al && typeof al.getImgOrThrow === "function")
                    ? al.getImgOrThrow("fireball2")
                    : document.getElementById("fireball2");
            } catch (_) { imgElBlue = null; }
            this._imgFireball2El = imgElBlue;
        }
        if (!imgElRed || !imgElBlue) return;

        //START ALPHA CHANGE 621 -- MP bullets: use sheetScaled cache (META 1:1) to match Projectile + avoid runtime scaling --
        const projScale = 0.1; // keep in sync with Projectile.scale
        const sheetScale = Math.round(projScale * 10000) / 10000; // must match AssetsLoading key format

        const _rawStride = 512;
        const _rawSrcW = 512, _rawSrcH = 512;
        const frames = 49;

        let stride = _rawStride;
        let offX = 0, offY = 0;
        let srcW = _rawSrcW, srcH = _rawSrcH;
        let dw = Math.round(_rawSrcW * projScale);
        let dh = Math.round(_rawSrcH * projScale);

        const keyRed  = `img:fireball:sheetScaled:${sheetScale}:stride:${_rawStride}`;
        const keyBlue = `img:fireball2:sheetScaled:${sheetScale}:stride:${_rawStride}`;

        const imgRed = (al && typeof al.getCachedOrFallback === "function")
            ? al.getCachedOrFallback(keyRed, imgElRed)
            : imgElRed;
        const imgBlue = (al && typeof al.getCachedOrFallback === "function")
            ? al.getCachedOrFallback(keyBlue, imgElBlue)
            : imgElBlue;

        try {
            const meta = (al && typeof al.getSheetMeta === "function")
                ? (al.getSheetMeta(keyRed) || al.getSheetMeta(keyBlue))
                : null;
            if (meta) {
                stride = meta.stride;
                offX = meta.offX;
                offY = meta.offY;
                srcW = meta.srcW;
                srcH = meta.srcH;
                dw = srcW;
                dh = srcH;
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 621 -- MP bullets: use sheetScaled cache (META 1:1) --

        //START ALPHA CHANGE 446 -- client bullets: local dt clock (P1) --
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        let deltaMs;
        if (typeof this._bulletLastRenderTimeMsP1 === 'number') {
            deltaMs = nowMs - this._bulletLastRenderTimeMsP1;
        } else {
            deltaMs = 1000 / 60;
        }
        this._bulletLastRenderTimeMsP1 = nowMs;

        //START ALPHA CHANGE 673 -- freeze client bullet stepping while paused (host pause only) --
        const isPaused673 = !!this._hostPauseActive;
        if (isPaused673) {
            deltaMs = 0; // freeze motion (here) + animation (ALPHA CHANGE 675); lastRenderTime is still refreshed to avoid jump on resume
        }
        //FINISH ALPHA CHANGE 673 -- freeze client bullet stepping while paused --

        if (deltaMs < 0) deltaMs = 0;
        if (deltaMs > 100) deltaMs = 100;

        const bulletMotionFps = 60;
        const motionScale = bulletMotionFps / 1000;

        const bulletAnimFps = 60;
        const animScale = bulletAnimFps / 1000;
        //FINISH ALPHA CHANGE 446 -- client bullets: local dt clock (P1) --

        const SPEED_P1 = 10; // keep in sync with Projectile.speed
        const map = this._localProjectilesP1;

        if (map && map.size) {
            for (const b of map.values()) {//b is the projectile object
                b.x += SPEED_P1 * deltaMs * motionScale;

                const prevAge = (typeof b.ageFrames === 'number') ? b.ageFrames : 0;
                b.ageFrames = prevAge + deltaMs * animScale;

                const isPow = (typeof b.powerUpAtSpawn === 'boolean') ? b.powerUpAtSpawn : false;
                const sheet = isPow ? imgRed : imgBlue;

                const idx = (Math.floor(b.ageFrames) % frames) | 0;
                const col = idx % 7;
                const row = (idx / 7) | 0;

                const sx = col * stride + offX;
                const sy = row * stride + offY;

                context.drawImage(sheet, sx, sy, srcW, srcH, b.x, b.y, dw, dh);
            }
        }
    }

    drawP2ClientProjectiles(context) {//Client-only bullet renderer (persistent local map; P2 only)
        if (this.isHost || !this.isMultiplayer) return;

        //START ALPHA CHANGE 176 -- client-only: prevent double-render by clearing local projectile arrays --
        try {
            const g = this.game;
            if (g && !this.isHost) {
                if (g.player && Array.isArray(g.player.projectiles)) g.player.projectiles.length = 0;
                if (g.player2 && Array.isArray(g.player2.projectiles)) g.player2.projectiles.length = 0;
                if (this.player2 && Array.isArray(this.player2.projectiles)) this.player2.projectiles.length = 0; // mirror field safety
            }
        } catch (e) {
            console.warn('[MP][CLIENT] projectile array clear failed (safe to ignore):', e);
        }
        //FINISH ALPHA CHANGE 176 -- client-only: prevent double-render by clearing local projectile arrays --

        const g = this.game;
        const al = g && g.assetsLoading;

        let imgElRed  = this._imgFireballEl  || null;
        let imgElBlue = this._imgFireball2El || null;

        if (!imgElRed) {
            try {
                imgElRed = (al && typeof al.getImgOrThrow === "function")
                    ? al.getImgOrThrow("fireball")
                    : document.getElementById("fireball");
            } catch (_) { imgElRed = null; }
            this._imgFireballEl = imgElRed;
        }
        if (!imgElBlue) {
            try {
                imgElBlue = (al && typeof al.getImgOrThrow === "function")
                    ? al.getImgOrThrow("fireball2")
                    : document.getElementById("fireball2");
            } catch (_) { imgElBlue = null; }
            this._imgFireball2El = imgElBlue;
        }
        if (!imgElRed || !imgElBlue) return;

        const projScale = 0.1;
        const sheetScale = Math.round(projScale * 10000) / 10000;

        const _rawStride = 512;
        const _rawSrcW = 512, _rawSrcH = 512;
        const frames = 49;

        let stride = _rawStride;
        let offX = 0, offY = 0;
        let srcW = _rawSrcW, srcH = _rawSrcH;
        let dw = Math.round(_rawSrcW * projScale);
        let dh = Math.round(_rawSrcH * projScale);

        const keyRed  = `img:fireball:sheetScaled:${sheetScale}:stride:${_rawStride}`;
        const keyBlue = `img:fireball2:sheetScaled:${sheetScale}:stride:${_rawStride}`;

        const imgRed = (al && typeof al.getCachedOrFallback === "function")
            ? al.getCachedOrFallback(keyRed, imgElRed)
            : imgElRed;
        const imgBlue = (al && typeof al.getCachedOrFallback === "function")
            ? al.getCachedOrFallback(keyBlue, imgElBlue)
            : imgElBlue;

        try {
            const meta = (al && typeof al.getSheetMeta === "function")
                ? (al.getSheetMeta(keyRed) || al.getSheetMeta(keyBlue))
                : null;
            if (meta) {
                stride = meta.stride;
                offX = meta.offX;
                offY = meta.offY;
                srcW = meta.srcW;
                srcH = meta.srcH;
                dw = srcW;
                dh = srcH;
            }
        } catch (_) {}

        //START ALPHA CHANGE 446 -- client bullets: local dt clock (P2) --
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        let deltaMs;
        if (typeof this._bulletLastRenderTimeMsP2 === 'number') {
            deltaMs = nowMs - this._bulletLastRenderTimeMsP2;
        } else {
            deltaMs = 1000 / 60;
        }
        this._bulletLastRenderTimeMsP2 = nowMs;

        //START ALPHA CHANGE 673 -- freeze client bullet stepping while paused (host pause only) --
        const isPaused673 = !!this._hostPauseActive;
        if (isPaused673) {
            deltaMs = 0; // freeze motion (here) + animation (ALPHA CHANGE 675); lastRenderTime is still refreshed to avoid jump on resume
        }
        //FINISH ALPHA CHANGE 673 -- freeze client bullet stepping while paused --

        if (deltaMs < 0) deltaMs = 0;
        if (deltaMs > 100) deltaMs = 100;

        const bulletMotionFps = 60;
        const motionScale = bulletMotionFps / 1000;

        const bulletAnimFps = 60;
        const animScale = bulletAnimFps / 1000;
        //FINISH ALPHA CHANGE 446 -- client bullets: local dt clock (P2) --

        const SPEED_P2 = 10;
        const map = this._localProjectilesP2;

        if (map && map.size) {
            for (const b of map.values()) {//b is the projectile object
                b.x += SPEED_P2 * deltaMs * motionScale;

                const prevAge = (typeof b.ageFrames === 'number') ? b.ageFrames : 0;
                b.ageFrames = prevAge + deltaMs * animScale;

                const isPow = (typeof b.powerUpAtSpawn === 'boolean') ? b.powerUpAtSpawn : false;
                const sheet = isPow ? imgRed : imgBlue;

                const idx = (Math.floor(b.ageFrames) % frames) | 0;
                const col = idx % 7;
                const row = (idx / 7) | 0;

                const sx = col * stride + offX;
                const sy = row * stride + offY;

                context.drawImage(sheet, sx, sy, srcW, srcH, b.x, b.y, dw, dh);
            }
        }
    }
    //FINISH ALPHA CHANGE 671 -- MP client bullets: split renderer into explicit P1/P2 functions --
    
    //START CHANGE -- Implement binary encode/decode helpers inside SteamMultiplayer
        // === BINARY ENCODERS ===

    // Compact gameState snapshot: see your size plan
    encodeGameStateToBuffer() {
        // Cap lists to reasonable limits to avoid > MTU
        const enemies = this.game.enemies.slice(0, 255); //START ALPHA CHANGE 150 -- raise enemy cap to 255 (A uint8 can only represent 0..255) --
       // Combine projectiles of both players; we’ll keep them separate for owner tagging
        const projP1 = (this.game.player?.projectiles || []).slice(0, 512);  //START ALPHA CHANGE 149 -- raise per-owner pre-cap to 512 --
        const projP2 = (this.player2?.projectiles || []).slice(0, 512);      //FINISH ALPHA CHANGE 149  -- raise per-owner pre-cap to 512 --
        //const projectiles = projP1.concat(projP2).slice(0, 16); prima erano compresi entrambi 
       // START ALPHA CHANGE 117 -- include both owners and prepare counts for encoding //
        const projectilesP1 = projP1;                                     
        const projectilesP2 = projP2;                                     
        const totalProjectiles = Math.min(1024, projectilesP1.length + projectilesP2.length); //1024 totali (P1+P2)
        // FINISH ALPHA CHANGE 117 //
        

        // Header (1 + 4)
        const headerBytes = 1 + 4;
        // Players (2 * int16) = 4   (P1 only)
        const playersBytes = 4; // ALPHA CHANGE 696 -- GAME_STATE: drop p2x/p2y (P2 is client-authoritative via PLAYER_INPUT) --
        //START ALPHA CHANGE 652 -- GAME_STATE: add host timeLimit + hardMode for MP client UI/achievements --
        //previously -- ALPHA CHANGE 184 (ex ALPHA CHANGE 65) -- bump UI section to include p1/p2 powerUp flags 
        const uiBytes = 20; //finale UI state: score(int16)+ammo(uint16)+shield(uint16)+gameTime(uint32)+gameOver(u8)+gameWon(u8)+paused(u8)+p1Pow(u8)+p2Pow(u8)+timeLimitMs(uint32)+hardMode(u8)
        //FINISH ALPHA CHANGE 652 -- GAME_STATE: add host timeLimit + hardMode --
        // Enemies: count(1) + n * (1 + 2 + 2 + 1 + 1 + 1) = 1 + n*8 (prima, dopo 10)
        //START ALPHA CHANGE 144 -- host: account for per-enemy UID (uint16) in size math --
        // Enemies: count(1) + n * (uid(uint16)=2 + type(1) + x(2) + y(2) + lives(1)) = 1 + n*8   //ALPHA CHANGE 162 -- questo prima
        const enemiesBytes = 1 + enemies.length * 14; //ALPHA CHANGE 450 -- 14 bytes: uid (2 bytes uint16) + type (1 byte uint8) + x (2 bytes int16) + y (2 bytes int16) + lives (1 byte uint8) + speedX (2 bytes fixed ×100 int16) + spawnGameTimeMs (4 bytes uint32 little-endian) = 1 (enemyCount byte) + 14bytes * nEnemies
        //FINISH ALPHA CHANGE 391A -- extends enemy payload from 8 bytes → 10 bytes per enemy by appending speedX as int16 fixed-point ×100 (host write + client read)
        //FINISH ALPHA CHANGE 144 -- host: account for per-enemy UID (uint16) in size math -- 
        // Projectiles: count(1) + m * (1 + 2 + 2) = 1 + m*5
       //START ALPHA CHANGE 139 -- add 2-byte bullet ID per projectile -- (prima era 1 + totalProjectiles * 5) -- (portato a 2 + totalProjectiles * 8)
        const projBytes = 2 + totalProjectiles * 8;  //START ALPHA CHANGE 154 -- widen projectile count to uint16 (was 1 + m*8) -- 8 bytes: (owner/type uint8 = 1, bullet id uint16 = 2, age uint8 = 1, x int16 = 2, y int16 = 2) = 2 (projCount uint16) + 8bytes * nProj
        //FINISH ALPHA CHANGE 139 -- add 2-byte bullet ID per projectile --

        const total = headerBytes + playersBytes + uiBytes + enemiesBytes + projBytes;
        const buf = new ArrayBuffer(total);
        const dv = new DataView(buf);
        let o = 0;

        // Header
        dv.setUint8(o, this.PKT.GAME_STATE); o += 1;
        if (this.hostTick == null) this.hostTick = 0;
        dv.setUint32(o, this.hostTick++, true); o += 4;

        //START ALPHA CHANGE 697 -- GAME_STATE: encode P1 only (remove p2x/p2y to save 4 bytes) --
        // Players (host P1 only). P2 pose is client-authoritative and arrives via PKT.PLAYER_INPUT.
        dv.setInt16(o, this.game.player.x|0, true); o += 2; //P1 x
        dv.setInt16(o, this.game.player.y|0, true); o += 2; //P1 y
        //FINISH ALPHA CHANGE 697 -- GAME_STATE: encode P1 only --

        // UI & game flags
        dv.setInt16(o, (this.game.score|0), true); o += 2;
        dv.setUint16(o, (this.game.ammo|0), true); o += 2;
        dv.setUint16(o, (this.game.shieldEnergy|0), true); o += 2;
        dv.setUint32(o, (this.game.gameTime||0), true); o += 4; // changed from Float32 to Unit32 for bette precision for time (integer millisecond timestamp instead of a float)
        dv.setUint8(o, this.game.gameOver ? 1 : 0); o += 1;
        dv.setUint8(o, this.game.gameWon ? 1 : 0); o += 1;
        //START ALPHA CHANGE 65 -- actually write the paused byte right after gameWon (encode)
        dv.setUint8(o, this.game.paused ? 1 : 0); o += 1; // host paused state
        //FINISH ALPHA CHANGE 65
        //START ALPHA CHANGE 185 -- p1/p2 visual power-up flags after pause --
        dv.setUint8(o, (this.game.player && this.game.player.powerUp) ? 1 : 0); 
        o += 1; // P1 powerUp (visual)
        dv.setUint8(o, (this.player2 && this.player2.powerUp) ? 1 : 0);        
        o += 1; // P2 powerUp (visual)
        //FINISH ALPHA CHANGE 185 -- p1/p2 visual power-up flags after pause --
        //START ALPHA CHANGE 652 -- GAME_STATE: send host timeLimit + hardMode (MP client UI/achievements) --
        dv.setUint32(o, (this.game && typeof this.game.timeLimit === "number") ? (this.game.timeLimit >>> 0) : 0, true);
        o += 4; // timeLimitMs (host) -- i 4 byte per il tempo
        dv.setUint8(o, (this.game && this.game.hardMode) ? 1 : 0);
        o += 1; // hardMode (host) -- 1 byte per il livello di difficoltà
        //FINISH ALPHA CHANGE 652 -- GAME_STATE: send host timeLimit + hardMode --

        // Enemies
        dv.setUint8(o, enemies.length); o += 1;
        for (let i=0;i<enemies.length;i++) {
            const e = enemies[i];
            const id = this.enemyTypeToId[e.constructor.name] || 0;
            //START ALPHA CHANGE 145 -- host: write per-enemy UID (uint16) before type --
            if (typeof e.__eid !== 'number') {
                if (typeof this._nextEnemyUid !== 'number') this._nextEnemyUid = 1;
                e.__eid = this._nextEnemyUid & 0xFFFF;
                if (e.__eid === 0) e.__eid = 1;
                this._nextEnemyUid = ((e.__eid + 1) & 0xFFFF) || 1;
            }
            dv.setUint16(o, e.__eid, true); o += 2;
            //FINISH ALPHA CHANGE 145 -- host: write per-enemy UID (uint16) before type --
            dv.setUint8(o, id); o += 1;   //ID
            dv.setInt16(o, e.x|0, true); o += 2; //x 
            dv.setInt16(o, e.y|0, true); o += 2; //y
            dv.setUint8(o, (e.lives|0)); o += 1; //lives
            //START ALPHA CHANGE 163 -- stop writing animation bytes (frameX/frameY) to save bandwidth --
            // (removed) dv.setUint8(o, (e.frameX|0)); o += 1;
            // (removed) dv.setUint8(o, (e.frameY|0)); o += 1;
            //FINISH ALPHA CHANGE 163 -- stop writing animation bytes --
            //START ALPHA CHANGE 391A -- write per-enemy speedX as int16 fixed-point (×100) --
            {
                const sx = (typeof e.speedX === 'number') ? e.speedX : 0;
                const sxfp = Math.round(sx * 100);
                dv.setInt16(o, sxfp, true); o += 2;
            }
            //FINISH ALPHA CHANGE 391A -- write per-enemy speedX --
            
            //START ALPHA CHANGE 451 -- write per-enemy spawn gameTime (uint32 ms) for dt-based prediction --
            // Fallback: if __spawnGameTimeMs is missing, use current gameTime so buffer layout stays valid.
            const spawnMs = (typeof e.__spawnGameTimeMs === 'number')
                ? (e.__spawnGameTimeMs | 0)
                : (this.game && typeof this.game.gameTime === 'number' ? (this.game.gameTime | 0) : 0);
            dv.setUint32(o, spawnMs >>> 0, true); o += 4;
            //FINISH ALPHA CHANGE 451 -- write per-enemy spawn gameTime --
        }

        // Projectiles (only type + x,y;  type=owner: 1=P1(host), 2=P2(client))
        //START ALPHA CHANGE 137 -- host: interleave P1/P2 bullets to avoid bias at cap --
        //START ALPHA CHANGE 154 -- write projectile count as uint16 (was uint8) --
        dv.setUint16(o, totalProjectiles, true); o += 2;
        //FINISH ALPHA CHANGE 154 -- write projectile count as uint16 --
        // START ALPHA CHANGE 140 -- host: per-bullet ID mint/reuse (uint16) --
        const idFor = (proj, owner /*1=P1,2=P2*/) => {
            // Requires: this._projIdP1/_projIdP2 and _nextProjIdP1/_nextProjIdP2 in constructor
            const map = owner === 1 ? this._projIdP1 : this._projIdP2;
            const key = owner === 1 ? '_nextProjIdP1' : '_nextProjIdP2';
            let id = map.get(proj);
            if (!id) {
                id = this[key] & 0xFFFF;
                if (id === 0) id = 1;
                map.set(proj, id);
                this[key] = ((id + 1) & 0xFFFF) || 1;
            }
            return id;
        };
        // FINISH ALPHA CHANGE 140 -- host: per-bullet ID mint/reuse (uint16) --
        //START ALPHA CHANGE 153 -- host: compute snapshot tick used in header for age math --
        const _tickForAge = ((this.hostTick|0) - 1) & 0xFFFFFFFF;
        //FINISH ALPHA CHANGE 153 -- host: compute snapshot tick used in header for age math --
        let i1 = 0, i2 = 0, written = 0;
        while (written < totalProjectiles && (i1 < projectilesP1.length || i2 < projectilesP2.length)) {
            // write one from P1 if available
            if (i1 < projectilesP1.length) {
                const p = projectilesP1[i1++];
                dv.setUint8(o, 1); o += 1;                            // owner/type = P1  //START ALPHA CHANGE 137
                //START ALPHA CHANGE 143 -- host: write bullet ID for P1 --
                dv.setUint16(o, idFor(p, 1), true); o += 2;
                //FINISH ALPHA CHANGE 143 -- host: write bullet ID for P1 --
                //START ALPHA CHANGE 153 -- host: write age (uint8) = tick - spawnTick; mint spawnTick once --
                if (typeof p.__spawnHostTick !== 'number') p.__spawnHostTick = _tickForAge;
                const _ageP1 = (_tickForAge - (p.__spawnHostTick|0)) & 0xFF;
                dv.setUint8(o, _ageP1); o += 1;
                //FINISH ALPHA CHANGE 153 -- host: write age (uint8) --
                dv.setInt16(o, p.x|0, true); o += 2;                   //FINISH ALPHA CHANGE 137
                dv.setInt16(o, p.y|0, true); o += 2;
                written++;
                if (written >= totalProjectiles) break;
            }
            // then one from P2 if available
            if (i2 < projectilesP2.length && written < totalProjectiles) {
                const p = projectilesP2[i2++];
                dv.setUint8(o, 2); o += 1;                            // owner/type = P2  //START ALPHA CHANGE 137
                //START ALPHA CHANGE 143 -- host: write bullet ID for P2 --
                dv.setUint16(o, idFor(p, 2), true); o += 2;
                //FINISH ALPHA CHANGE 143 -- host: write bullet ID for P2 --
                //START ALPHA CHANGE 153 -- host: write age (uint8) = tick - spawnTick; mint spawnTick once --
                if (typeof p.__spawnHostTick !== 'number') p.__spawnHostTick = _tickForAge;
                const _ageP2 = (_tickForAge - (p.__spawnHostTick|0)) & 0xFF;
                dv.setUint8(o, _ageP2); o += 1;
                //FINISH ALPHA CHANGE 153 -- host: write age (uint8) --
                dv.setInt16(o, p.x|0, true); o += 2;                   //FINISH ALPHA CHANGE 137
                dv.setInt16(o, p.y|0, true); o += 2;
                written++;
            }
        }
        //FINISH ALPHA CHANGE 137 -- host: interleave P1/P2 bullets to avoid bias at cap --

        return new Uint8Array(buf);
    }

    //START ALPHA CHANGE 205 -- host → client: AUTO_SCORE(score)
    // type(1) + score(2, uint16)
    encodeAutoScoreToBuffer(finalScore) {
        const s = Math.max(0, Math.min(65535, finalScore|0));
        const buf = new ArrayBuffer(1+2);
        const dv = new DataView(buf);
        dv.setUint8(0, this.PKT.AUTO_SCORE);
        dv.setUint16(1, s, true);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 205 -- host → client: AUTO_SCORE(score)

    //START ALPHA CHANGE 687 -- MP: WIN_SCORE_BANNER encoder + host helper sender --
    // Packet: [type:u8][kind:u8]
    // kind: 1="WINNING SCORE REACHED: SURVIVE", 2="BELOW WINNING SCORE"
    encodeWinScoreBannerToBuffer(kind) {
        const buf = new ArrayBuffer(1 + 1);
        const dv = new DataView(buf);
        dv.setUint8(0, this.PKT.WIN_SCORE_BANNER);
        const k = (kind === 2) ? 2 : 1;
        dv.setUint8(1, k);
        return new Uint8Array(buf);
    }

    // Convenience wrapper: call this from the host’s threshold-crossing logic (on demand)
    sendWinScoreBanner(kind) {
        try {
            if (!this.isMultiplayer || !this.isHost) return;
            const pkt = this.encodeWinScoreBannerToBuffer(kind);
            this.sendNetworkBinary(pkt, 'Reliable'); // rare + must-not-miss UI moment
        } catch (e) {
            console.warn('[NET][HOST] WIN_SCORE_BANNER send failed:', e);
        }
    }
    //FINISH ALPHA CHANGE 687 -- MP: WIN_SCORE_BANNER encoder + host helper sender --

    // Client -> host compact input packet (p2 pos + fire flag)
    encodePlayerInputsToBuffer() {
        // type(1) + x(2) + y(2) + flags(1)
        const buf = new ArrayBuffer(1+2+2+1);
        const dv = new DataView(buf); let o=0;
        dv.setUint8(o, this.PKT.PLAYER_INPUT); o+=1;
        dv.setInt16(o, (this.player2?.x|0) || 0, true); o+=2;
        dv.setInt16(o, (this.player2?.y|0) || 0, true); o+=2;

        // bit0 = fire
         //START GAMMA CHANGE 2
        let flags = 0;
        let fireActive = this.game.keys.includes(this.game.keyBindings.fire); // keyboard
        // also honor gamepad binding (e.g., "button_0") via InputHandler’s lastGamepadButtons
        if (this.game && this.game.input && this.game.gamepadBindings && typeof this.game.gamepadBindings.fire === 'string' && this.game.gamepadBindings.fire.startsWith('button_')) {
            const idx = parseInt(this.game.gamepadBindings.fire.split('_')[1], 10);
            if (!isNaN(idx) && this.game.input.lastGamepadButtons && this.game.input.lastGamepadButtons[idx]) {
                fireActive = true;
            }
        }
        //START ALPHA CHANGE 65
        if (this._hostPauseActive) fireActive = false; // client is frozen while host paused
        //FINISH ALPHA CHANGE 65

        //START ALPHA CHANGE 676 -- client-local pause: never send FIRE while local pause menu is open --
        //evita bug che quando premi pause mentre stai facendo fuoco (client) durante la pausa continua a sparare
        if (this.game && this.game.paused) fireActive = false; // local UI pause stops only our firing; world continues
        //FINISH ALPHA CHANGE 676 -- client-local pause: never send FIRE --

        //START GAMMA CHANGE 6
        // Cooldown gate for client so holding fire doesn’t spam the host
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const interval = (this.game && this.game.input && typeof this.game.input.shotInterval === 'number')
            ? this.game.input.shotInterval : 100; // fallback 100ms
        if (fireActive && (!this._p2LastFireSentAt || (now - this._p2LastFireSentAt >= interval))) {
            flags |= 1;
            this._p2LastFireSentAt = now;
        }
        //FINISH GAMMA CHANGE 6
        //FINISH GAMMA CHANGE 2
        dv.setUint8(o, flags); o+=1;
        return new Uint8Array(buf);
    }

    encodeGameStartToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.GAME_START);
        return new Uint8Array(buf);
    }

    //START ALPHA CHANGE 67 -- Add tiny encoders: encodeHelloToBuffer + encodePongToBuffer
    encodeHelloToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.HELLO);
        return new Uint8Array(buf);
    }
    encodePongToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.PONG);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 67

    //START GAMMA CHANGE 24
    // Client -> host: tiny restart request (1 byte) (GAMMA CHANGE 23)
    encodeRestartRequestToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.RESTART_REQ);
        return new Uint8Array(buf);
    }
    //FINISH GAMMA CHANGE 24

    // === NEW: Host-only collisions for Player 2 (body + projectiles) === start
    handleP2HostCollisions(enemy) {
        // Guard: only host simulates collisions, must have P2, and only during live gameplay
        if (!this.isMultiplayer || !this.isHost) return;
        const g = this.game;
        if (!g || !g.player2 || g.gameOver) return;

        // --- BODY COLLISION: P2 <-> enemy (mirrors your P1 logic) --- crea una singola istanza indipendente per ogni nemico (vedi ALPHA 660)
        if (g.checkCollision(g.player2, enemy)) {
            enemy.markedForDeletion = true;
            g.addExplosion(enemy);
            g.sound.explosion(); // ALPHA CHANGE 736 -- add explosion sound P2 collision 
            //g.sound.hit(); -- moved into the "if non luck/moon" block (ALPHA 735)
            //g.shield.reset(); // ALPHA CHANGE 461 shield reset -- removed --  <-- UNCONDITIONAL: runs for ALL enemy types
            //START GAMMA CHANGE 2
            // Mirror P1 effects for P2 body collisions:
            // - Non power-up enemies: deplete shared shield and possibly trigger game over.
            // - Power-up enemies ('moon'/'lucky'): grant P2 power-up and refill shared shield like P1.

            //START ALPHA CHANGE 461 -- host triggers locally (and send HIT opcode remotely) only on non power-up enemies on P2 collisions --
            if (enemy.type !== "lucky" && enemy.type !== "moon") { //send remote HIT opcode to client 
                try {
                    const sm = this; // we're inside SteamMultiplayer
                    if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodeHitToBuffer === 'function') {
                        const buf = sm.encodeHitToBuffer(2); // ALPHA CHANGE 466 -- include owner=2 (P2) in HIT packet --
                        sm.sendNetworkBinary(buf, 'UnreliableNoDelay');
                    }
                } catch (_) {}
                
                //START ALPHA CHANGE 475 -- host: trigger P2-only shield overlay burst + shield SFX on damaging hits --
                this.triggerP2ShieldBurst(); //calling the helper function 
                if (g.sound && typeof g.sound.shield === 'function') g.sound.shield();
                
                //FINISH ALPHA CHANGE 475 -- host: trigger P2-only shield overlay burst + shield SFX on damaging hits --
                if (g.sound && typeof g.sound.hit === 'function') g.sound.hit(); //ALPHA CHANGE 735 -- make HIT non powerup enemy only 
            }
            //FINISH ALPHA CHANGE 461 -- host triggers locally (and send HIT opcode remotely) only on non power-up enemies on P2 collisions --
            if (enemy.type === "lucky" || enemy.type === "moon") {
                if (typeof g.player2.enterPowerUp === 'function') g.player2.enterPowerUp(); // P2 power-up
                if (g.player && !g.player.markedForDeletion && typeof g.player.enterPowerUp === 'function') g.player.enterPowerUp(); //ALPHA CHANGE 369 -- shared power up (when P2 gets power up P1 also gets)
                if (g.shieldEnergy < g.maxShieldEnergy) g.shieldEnergy = g.maxShieldEnergy; // refill shared shield
              
                //START ALPHA CHANGE 418 -- host: notify client to play the power-up SFX -
                try {
                    const sm = this;
                    if (sm && sm.isMultiplayer && sm.isHost && typeof sm.encodePowerUpToBuffer === 'function') {
                        sm.sendNetworkBinary(sm.encodePowerUpToBuffer(), 'Unreliable'); // SFX-only, low-latency
                    }
                } catch (_) {}
                //FINISH ALPHA CHANGE 418
              
                if (enemy.type === "lucky") {
                    for (let i = 0; i < 10; i++){
                        g.particles.push(new Particle2(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));
                    }

                    //START ALPHA CHANGE 179 -- host emits PARTICLE burst (kind=2, count=10) for lucky body-collision
                    try {
                        const sm = this;
                        const cx = (enemy.x + enemy.width * 0.5) | 0;
                        const cy = (enemy.y + enemy.height * 0.5) | 0;
                        const buf = sm.encodeParticleToBuffer(cx, cy, /*kind*/2, /*count*/10);
                        sm.sendNetworkBinary(buf, 'Unreliable');
                    } catch (_) {}
                    //FINISH ALPHA CHANGE 179

                }
            } else {
                //START ALPHA CHANGE 310 -- per-enemy shield damage for P2 body-collisions (host) --
                const _shieldHit = (typeof enemy.shieldDamage === 'number') ? enemy.shieldDamage : g.shieldDepleteAmount;
                g.shieldEnergy -= _shieldHit;
                //FINISH ALPHA CHANGE 310
                if (g.shieldEnergy <= 0) {
                    g.shieldEnergy = 0;
                    g.addPlayerExplosion();        // visual boom (uses P1 sprite, consistent with existing flow)
                    g.player.markedForDeletion = true;
                    g.deathTimer = 0;
                    //START ALPHA CHANGE 659 -- MP: latch death/outcome when P2 collision drains shared shield --
                    g.playerDied = true;           // keep semantics consistent with P1 shield-death path
                    g.gameWon = false;             // force loss state for snapshots/UI/achievements
                    //FINISH ALPHA CHANGE 659 -- MP: latch death/outcome when P2 collision drains shared shield --
                    g.gameOver = true;             // loss via shield (shared)
                }
                if (!g.gameOver) g.score--;        // match P1 body-hit score penalty
            }
            //FINISH GAMMA CHANGE 2
            for (let i = 0; i < 3; i++) {
                g.particles.push(new Particle(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));
            }
            //START ALPHA CHANGE 180 -- host emits PARTICLE burst (kind=1, count=3) for generic body-collision flair
            try {
                const sm = this;
                const cx = (enemy.x + enemy.width * 0.5) | 0;
                const cy = (enemy.y + enemy.height * 0.5) | 0;
                const buf = sm.encodeParticleToBuffer(cx, cy, /*kind*/1, /*count*/3);
                sm.sendNetworkBinary(buf, 'Unreliable');
            } catch (_) {}
            //FINISH ALPHA CHANGE 180
        }

        // --- PROJECTILE COLLISION: P2 bullets -> enemy (mirrors your P1 logic) ---
        if (g.player2 && Array.isArray(g.player2.projectiles)) {
            g.player2.projectiles.forEach(projectile => {//ALPHA CHANGE 660 -- "!projectile.markedForDeletion && !enemy.markedForDeletion" skips collision for projectiles and enemies already markedForDeletion
            //for "one projectile → one hit" and "dead enemy not processed again" in the same projectile/enemy instance (each enemy and each projectile is its own object instance)
                if (!projectile.markedForDeletion && !enemy.markedForDeletion && g.checkCollision(projectile, enemy)) {
                    enemy.lives--;
                    projectile.markedForDeletion = true;
                    g.particles.push(new Particle(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));

                    //START ALPHA CHANGE 181 -- host emits PARTICLE tick for single-hit spark (kind by type, count=1)
                    try {
                        const sm = this;
                        const cx = (enemy.x + enemy.width * 0.5) | 0;
                        const cy = (enemy.y + enemy.height * 0.5) | 0;
                        const kind = (enemy.type === "hive") ? 3 : ((enemy.type === "lucky" || enemy.type === "drone") ? 2 : 1);
                        const buf = sm.encodeParticleToBuffer(cx, cy, kind, /*count*/1);
                        sm.sendNetworkBinary(buf, 'Unreliable');
                    } catch (_) {}
                    //FINISH ALPHA CHANGE 181

                    // If enemy dies, mirror your exact effects/score logic
                    if (enemy.lives <= 0) {
                        // Particle flavor by enemy type (exactly like your P1 path)
                        if (enemy.type === "lucky" || enemy.type === "drone") {
                            for (let i = 0; i < 3; i++) g.particles.push(new Particle2(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));
                        } else if (enemy.type === "hive") {
                            for (let i = 0; i < 3; i++) g.particles.push(new Particle3(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));
                        } else {
                            for (let i = 0; i < 3; i++) g.particles.push(new Particle(g, enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.5));
                        }

                        //START ALPHA CHANGE 181 -- host emits PARTICLE tick for death burst (kind by type, count=3)
                        try {
                            const sm = this;
                            const cx = (enemy.x + enemy.width * 0.5) | 0;
                            const cy = (enemy.y + enemy.height * 0.5) | 0;
                            const kind = (enemy.type === "hive") ? 3 : ((enemy.type === "lucky" || enemy.type === "drone") ? 2 : 1);
                            const buf = sm.encodeParticleToBuffer(cx, cy, kind, /*count*/3);
                            sm.sendNetworkBinary(buf, 'Unreliable');
                        } catch (_) {}
                        //FINISH ALPHA CHANGE 181

                        g.addExplosion(enemy);       // also emits EXPLOSION to client when host
                        g.sound.explosion();
                        enemy.markedForDeletion = true;

                        // Hive splits (exactly like your code -- ex ALPHA CHANGE 373)
                        if (enemy.type === "hive") {//ALPHA CHANGE 662 -- MP: randomize Hive spawns -- (drones 3<-->6, missiles 2<-->4) --
                            const droneCount = 3 + Math.floor(Math.random() * 4);   // 3<->6
                            const missileCount = 2 + Math.floor(Math.random() * 3); // 2<->4
                            
                           for (let i = 0; i < droneCount; i++) {
                                g.enemies.push(new Drone(
                                g,
                                enemy.x + Math.random() * enemy.width,
                                enemy.y + Math.random() * enemy.height * 0.5
                                ));
                            }

                           for (let i = 0; i < missileCount; i++) {
                                g.enemies.push(new Missile(
                                g,
                                enemy.x + Math.random() * enemy.width,
                                enemy.y + Math.random() * enemy.height * 0.4
                                ));
                            }
                            g.sound.missile(); //ALPHA CHANGE 737 -- MP host P2: play missile SFX locally on hive split spawn (once per kill) --
                            //START ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P2 hive split) --
                            try {
                                    if (this && this.isMultiplayer && this.isHost && typeof this.encodeMissileToBuffer === 'function') {
                                        this.sendNetworkBinary(this.encodeMissileToBuffer(), 'UnreliableNoDelay');
                                    }
                                } catch (_) {}
                            //FINISH ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P2 hive split) --                 
                        }//finish hive 
                            //spawn Missile when killing Bulbwhale
                            if (enemy.type === "bulbwhale"){//ALPHA CHANGE 662 -- MP: randomize Bulbwhale missiles (1<-->2) --
                                const bulbMissileCount = 1 + Math.floor(Math.random() * 2); // 1<->2

                                for (let i = 0; i < bulbMissileCount; i++) {
                                     g.enemies.push(new Missile(
                                     g,
                                     enemy.x + Math.random() * enemy.width,
                                     enemy.y + Math.random() * enemy.height * 0.4
                                    ));
                                }
                                g.sound.missile(); //ALPHA CHANGE 737 -- MP host P2: play missile SFX locally on bulbwhale split spawn (once per kill) --
                                //START ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P2 Bulbwhale split) --
                                try {
                                        if (this && this.isMultiplayer && this.isHost && typeof this.encodeMissileToBuffer === 'function') {
                                            this.sendNetworkBinary(this.encodeMissileToBuffer(), 'UnreliableNoDelay');
                                        }
                                    } catch (_) {}
                                //FINISH ALPHA CHANGE 738 -- MP: mirror missile spawn SFX to client (P2 bulbwhale split) --                    
                            }
                            //FINISH spawn Missile when killing Bulbwhale
                            //nota: inside handleP2HostCollisions(enemy) the game object is g, 
                            //so the spawns must use g.enemies.push(...) (not this.enemies.push(...))

                        // Score logic (identical to your P1 path)
                        if (!g.gameOver) {
                            if (enemy.type === "lucky" || enemy.type === "moon") {
                                g.score -= enemy.score;
                            } else {
                                g.score += enemy.score;
                            }
                        }
                        //START ALPHA CHANGE 307 -- MP: remove immediate score-based game-over; timer is sole end condition --
                        // (We no longer end the game here when score exceeds winningScore.
                        //  Single player already removed this earlier; this aligns MP host P2 path.)
                       //FINISH ALPHA CHANGE 307 -- MP: remove immediate score-based game-over --
                    }
                }
            });
        }
    }
    // === NEW: Host-only collisions for Player 2 (body + projectiles) === finish 

    // Reliable explosion event: type(1) + x(2) + y(2) + scaleByte(1) = 6 bytes 
    encodeExplosionToBuffer(x, y, scaleOverride) { // add scaleByte(1) -- ALPHA CHANGE 543
        const buf = new ArrayBuffer(1+2+2+1); // type + x(int16) + y(int16) + scaleByte(uint8) -- ALPHA CHANGE 543
        const dv = new DataView(buf);
        dv.setUint8(0, this.PKT.EXPLOSION);
        dv.setInt16(1, x|0, true);
        dv.setInt16(3, y|0, true);
        //START ALPHA CHANGE 543 -- EXPLOSION: pack scaleByte (scale*100, clamped 0..255) --
        let s = (typeof scaleOverride === 'number' && Number.isFinite(scaleOverride)) ? scaleOverride : 0.25; //fallback to 0.25 so we never have undefined over the network 
        let scaleByte = Math.round(s * 100);
        if (scaleByte < 0) scaleByte = 0;
        if (scaleByte > 255) scaleByte = 255;
        dv.setUint8(5, scaleByte);
        //FINISH ALPHA CHANGE 543 -- EXPLOSION: pack scaleByte --
        return new Uint8Array(buf);
    }

    //START ALPHA CHANGE 544 -- PLAYER_EXPLOSION: encode scaleByte-only player-death event (client uses local P1/P2 coords) --
    encodePlayerExplosionToBuffer(scaleOverride){
        // Packet: [type:u8][scaleByte:u8]
        const buf = new ArrayBuffer(1 + 1);
        const dv = new DataView(buf);
        dv.setUint8(0, this.PKT.PLAYER_EXPLOSION);
        let scaleByte = Math.round(scaleOverride * 100);
        if (scaleByte < 0) scaleByte = 0;
        if (scaleByte > 255) scaleByte = 255;
        dv.setUint8(1, scaleByte);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 544 -- PLAYER_EXPLOSION: encode scaleByte-only player-death event --
    
    //START ALPHA CHANGE 414 -- HIT encoder: type(1)=HIT (no payload needed for SFX only) --
    //START ALPHA CHANGE 464 -- EXTEND HIT encoder: add owner byte (1=P1, 2=P2) --
    encodeHitToBuffer(owner) {
        const buf = new ArrayBuffer(2);
        const dv  = new DataView(buf);
        dv.setUint8(0, this.PKT.HIT);
        const who = (owner === 2 ? 2 : 1); // default to P1 if unspecified/invalid 
        dv.setUint8(1, who);               // owner: 1 = P1, 2 = P2                        
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 464 -- EXTEND HIT encoder: add owner byte (1=P1, 2=P2) --
    //FINISH ALPHA CHANGE 414 -- HIT encoder --
    
    //START ALPHA CHANGE 418 -- host → client: POWERUP (type only) -- tenuto come esempio 
    encodePowerUpToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.POWERUP);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 418 -- tenuto come esempio 

    //START ALPHA CHANGE 738 -- MP: MISSILE encoder (type only; SFX) --
    encodeMissileToBuffer() {
        const buf = new ArrayBuffer(1);
        new DataView(buf).setUint8(0, this.PKT.MISSILE);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 738 -- MP: MISSILE encoder (type only; SFX) --
    
    //START ALPHA CHANGE 178 -- PARTICLE encoder: type(1)=PARTICLE + x(2) + y(2) + kind(1) + count(1) --
    encodeParticleToBuffer(x, y, kind, count) {
        const buf = new ArrayBuffer(1+2+2+1+1);
        const dv = new DataView(buf);
        dv.setUint8(0, this.PKT.PARTICLE);
        dv.setInt16(1, x|0, true);
        dv.setInt16(3, y|0, true);
        dv.setUint8(5, (kind|0) & 0xFF);
        dv.setUint8(6, (count|0) & 0xFF);
        return new Uint8Array(buf);
    }
    //FINISH ALPHA CHANGE 178 -- PARTICLE encoder --

    //START ALPHA CHANGE 399 -- remove legacy snapshot buffer helper (no remaining readers) --
    // (Removed _pushClientSnapshot(snap) and its ALPHA 131/173 internals.)
    //FINISH ALPHA CHANGE 399 -- remove legacy snapshot buffer helper --

    // === BINARY DECODER ===
    handleBinaryMessage(buffer, senderSteamId) {
        // Guard: only accept from our opponent
        if (!this.opponentSteamId && senderSteamId != null) {
            this.opponentSteamId = senderSteamId;
            console.log('[MP] opponentSteamId (binary) assigned:', String(senderSteamId));
        }
        if (String(senderSteamId) !== String(this.opponentSteamId)) return;

        //START ALPHA CHANGE 721 -- MP: guard binary decoder against empty/invalid buffers (avoid RangeError on getUint8(0)) --
        //This block makes sure we only create a DataView and read getUint8(0) when we actually have a valid, non-empty byte buffer

        //Initialize “normalized buffer view” variables
        let _ab721 = null;//will hold an ArrayBuffer (the raw byte storage).
        let _off721 = 0;//will hold the byte offset where our packet starts inside that ArrayBuffer.
        let _len721 = 0;//will hold the length in bytes of the packet.
        //Why: We want to support two possible incoming shapes: 1. buffer is an ArrayBuffer (raw bytes), 
        //2. buffer is a view like Uint8Array or Buffer (has .buffer, .byteOffset, .byteLength)

        //Case 1: buffer is already a raw ArrayBuffer
        if (buffer && buffer instanceof ArrayBuffer) {//If buffer exists and it is literally an ArrayBuffer
            _ab721 = buffer;//Use this ArrayBuffer as our underlying storage
            _off721 = 0;//Because it’s a raw ArrayBuffer, our packet starts at the beginning (offset 0)
            _len721 = buffer.byteLength;//The packet length is the entire ArrayBuffer length
        //Case 2: buffer is a view (Buffer / Uint8Array / etc.)
        } else if (buffer && buffer.buffer instanceof ArrayBuffer) {//Otherwise, if buffer exists and it has a .buffer property that is an ArrayBuffer
        //This is the typical shape for Uint8Array and Node Buffer (buffer.buffer → the underlying ArrayBuffer, buffer.byteOffset → where this view starts, buffer.byteLength → how many bytes in this view)
            _ab721 = buffer.buffer;//Use the underlying ArrayBuffer
            _off721 = (typeof buffer.byteOffset === "number") ? buffer.byteOffset : 0;//Use the view’s byteOffset if it’s a number; otherwise fallback to 0 (this is defensive: in normal cases it will be a number)
            _len721 = (typeof buffer.byteLength === "number") ? buffer.byteLength : 0;//Use the view’s byteLength if it’s a number; otherwise treat as 0 (Again defensive)
        }
        //Early return if there’s no usable buffer or it’s empty

        if (!_ab721 || _len721 < 1) return;//If _ab721 is still null→ don’t decode, If _len721 < 1 → packet has 0 bytes → reading getUint8(0) would crash → don’t decode
        
        //Create the DataView safely
        let dv;//Declare the DataView variable
        try {
            dv = new DataView(_ab721, _off721, _len721);//Attempt to create a DataView over the underlying bytes, starting at _off721, with length _len721 (This does not copy bytes. It just references them)
        } catch (e) {
            console.warn('[MP] handleBinaryMessage: invalid buffer view:', e);//If construction fails (bad offset/length combo), log a warning and exit safely
            return;
        }
        //Read the packet type safely
        let type;//Declare type (your first byte of the packet)
        try {
            type = dv.getUint8(0);//Read byte #0 of the packet — the packet type (This is exactly what the old code did)
        } catch (e) {
            console.warn('[MP] handleBinaryMessage: empty/invalid packet:', e);
            return;//If something still goes wrong → log and exit instead of crashing the whole multiplayer logic (bad/empty packets no longer crash the game)
        }
        //FINISH ALPHA CHANGE 721 -- MP: guard binary decoder against empty/invalid buffers (avoid RangeError on getUint8(0)) --
        //START GAMMA CHANGE 28
        // Any packet from our opponent refreshes the "online" clock
        const _now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this._lastPeerPacketAt = _now; 
        //FINISH GAMMA CHANGE 28

        //START ALPHA CHANGE 550 -- client: ignore late gameplay packets while in local menus (main/options/gamepadSetup) --
        try {
            if (!this.isHost && this.game && (this.game.gameState === "mainMenu" || this.game.gameState === "options" || this.game.gameState === "gamepadSetup")) {
                if (type === this.PKT.GAME_STATE ||
                    type === this.PKT.EXPLOSION ||
                    type === this.PKT.GAME_START ||
                    type === this.PKT.PARTICLE ||
                    type === this.PKT.AUTO_SCORE ||
                    type === this.PKT.HIT ||
                    type === this.PKT.POWERUP ||
                    type === this.PKT.MISSILE || //ALPHA CHANGE 738 -- ignore MISSILE SFX packets while in local menus --
                    type === this.PKT.PLAYER_EXPLOSION ||
                    type === this.PKT.WIN_SCORE_BANNER //ALPHA CHANGE 688 -- ignore banner events while in local menus --
                ) {
                    return;
                }
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 550 -- client: ignore late gameplay packets while in local menus --

        //START ALPHA CHANGE 67 -- Handle HELLO/PONG in the binary decoder
        // Warm-up handshake:
        // - Client replies to HELLO with PONG (unreliable)
        // - Host marks _p2pReady on PONG and stops HELLO loop
        if (type === this.PKT.HELLO && !this.isHost) {
            try {
                if (!this.opponentSteamId && senderSteamId != null) this.opponentSteamId = senderSteamId;
                const pong = this.encodePongToBuffer();
                this.sendNetworkBinary(pong, 'UnreliableNoDelay');
                //START ALPHA CHANGE 89 -- UI-only: mark P2P "likely established" when we SEND PONG (do NOT set _p2pReady)
                this._p2pLikelyEstablished = true;
                //FINISH ALPHA CHANGE 89
                // (optional) console.log('[NET][CLIENT] PONG sent');
            } catch (e) {
                console.warn('[NET][CLIENT] PONG send failed:', e);
            }
            return;
        }
        if (type === this.PKT.PONG && this.isHost) {
            this._p2pReady = true;
              console.log('[NET][HOST] PONG received — path warmed');
            return;
        }
        //FINISH ALPHA CHANGE 67

        //START GAMMA CHANGE 26 -- Host handles RESTART_REQ → performs actual restart
        if (type === this.PKT.RESTART_REQ && this.isHost) {
            console.log('[NET][HOST] RESTART_REQ received — restarting match');
            //START ALPHA CHANGE 207 -- reset team auto-score latch on host-driven restart --
            this._teamAutoScoreDone = false;
            //FINISH ALPHA CHANGE 207 -- reset team auto-score latch on host-driven restart --
            // Host restart: your Game.reset() already preserves MP and re-sends GAME_START
            this.game.reset();
            return;
        }
        //FINISH GAMMA CHANGE 26 -- nota come quello sotto è simile
//START GAMMA CHANGE 61 -- LEAVE_NOTICE: passive-side sets banner; initiator ignores remote notice
//ignores remote notices if we are the initiator, and never echoes from the passive path because leaveLobby() 
//no longer sends when _leaveNoticeGuard is already set
if (type === this.PKT.LEAVE_NOTICE) {
    try {
        // If WE initiated a leave, ignore any remote notice (don’t override our own banner)
        if (this._leaveNoticeGuard) return;

        const roleByte = (dv.byteLength >= 2) ? dv.getUint8(1) : 0; // 1=host, 2=client
        const who = (roleByte === 1) ? 'PLAYER 1' : (roleByte === 2) ? 'PLAYER 2' : 'PEER';
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        this._leaveNoticeAt = now;
        this._promptText = `${who} LEFT THE GAME — SESSION CLOSED`;

        // Mark passive path, then leave WITHOUT echoing (leaveLobby won't send when guard is set)
        this._leaveNoticeGuard = true;
        this.leaveLobby();
    } catch (e) {
        console.warn('[NET] LEAVE_NOTICE handling failed:', e);
    }
    return;
}
//FINISH GAMMA CHANGE 61

        if (type === this.PKT.GAME_START && !this.isHost) {//STARTING AND RESTARTING A MULTIPLAYER SESSION: CLIENT SIDE -- here you reset all things MP client 
            console.log('[NET][CLIENT] gameStart (binary) received');
            this.startMultiplayerGame();
            //START ALPHA CHANGE 638 -- MP client: play MP intro voice on GAME_START --
            this.game.sound.MPintro();
            //FINISH ALPHA CHANGE 638 -- MP client: play MP intro voice on GAME_START --
            //START GAMMA CHANGE 5
            // After host restarts, force-clear local inputs and spawn P2 locally
            // so the first PLAYER_INPUT carries a correct fresh position.
            try {
                // Clear keyboard + gamepad buffers
                if (this.game && this.game.input) {
                    this.game.keys = [];
                    this.game.input.keys = [];
                    if (Array.isArray(this.game.input.lastGamepadButtons)) {
                        this.game.input.lastGamepadButtons = new Array(16).fill(false);//ALPHA CHANGE 731 -- lastGamepadButtons: keep fixed-size Array, not [] --
                    }//don’t clear to [], clear to new Array(16).fill(false) because rebind math loop won't work if length is 0
                }
                // Ensure local P2 exists and is at fresh spawn before first input tick
                if (this.game) {
                    if (!this.game.player2) this.game.player2 = new Player(this.game);
                    this.player2 = this.game.player2;
                    if (this.player2) {
                        this.player2.projectiles = [];
                        this.player2.x = 100;
                        this.player2.y = (this.game.height / 2 - this.player2.height / 2) | 0;
                    }
                }
            } catch (e) {
                console.warn('[NET][CLIENT] GAME_START post-init failed:', e);
            }
            //START ALPHA CHANGE 124 -- reset client-side projectile visuals on new game start -- qui resetti tutto ogni volta che inizia un nuovo round
            this._remoteProjectiles = [];
            this._clientProjectiles  = [];
            this._remoteProjFrame    = 0;
            this._remoteProjTimer    = 0;
            //FINISH ALPHA CHANGE 124 -- reset client-side projectile visuals on new game start --
            //START ALPHA CHANGE 188 -- reset host P1 shot SFX dedupe set on new round --
            this._p1ShotHeard = new Set();
            //FINISH ALPHA CHANGE 188 -- reset host P1 shot SFX dedupe set on new round --
            //FINISH GAMMA CHANGE 5
            //START ALPHA CHANGE 167 — reset client enemy instance map on new game start
            if (this._enemyByUid) this._enemyByUid = new Map();
            //FINISH ALPHA CHANGE 167 — reset client enemy instance map on new game start
            //START ALPHA CHANGE 175 -- reset tick guard -- _lastAppliedTick inside the GAME_STATE rejects old/out-of-order packets in START ALPHA CHANGE 174
            this._lastAppliedTick = -1;
            //FINISH ALPHA CHANGE 175 -- reset tick guard -- here we simply reset it so it prevents visual/state “rewinds” if packets arrive out of order (common on P2P).
            //START ALPHA CHANGE 405 -- reset client-side fixed-timestep accumulators on new round --
            this._enemySimAccMs = 0;   // reset accumulator used by ALPHA CHANGE 403
            this._enemySimTick  = 0;   // reset tick counter used by ALPHA CHANGE 404
            //FINISH ALPHA CHANGE 405 -- reset client-side fixed-timestep accumulators on new round --
            //START ALPHA CHANGE 724 -- MP client: reset host-time estimator on new round (avoid clamp-jump after restart) --
            this._clientHostTimeMs = undefined; //undefined and not 0 because in the logic "if (typeof this._clientHostTimeMs !== 'number')-> you seed it from the current this.game.gameTime" so undefined works better 
            //FINISH ALPHA CHANGE 724 -- MP client: reset host-time estimator on new round --
    
            if (this.lobbyState !== 'playing' && !this.isMultiplayer) {
                this.startMultiplayerGame();
                }
            return;
        }

        if (type === this.PKT.GAME_STATE && !this.isHost) { // client GAME_STATE decode
            //START ALPHA CHANGE 68 -- client: auto-start if first GAME_STATE snapshot arrives while still in lobby --
            if (this.lobbyState === 'inLobby' && !this.isMultiplayer) {
                console.log('[NET][CLIENT] gameState received in lobby — auto-starting client.');
                this.startMultiplayerGame();
                //START ALPHA CHANGE 125 -- also clear any stale projectile visuals on implicit start --
                this._remoteProjectiles = [];
                this._clientProjectiles  = [];
                this._remoteProjFrame    = 0;
                this._remoteProjTimer    = 0;
                //FINISH ALPHA CHANGE 125 -- also clear any stale projectile visuals on implicit start --               
            }
            //FINISH ALPHA CHANGE 68 -- previously the game only started after a Reliable GAME_START -- this makes it snappy
            let o = 1;
            const tick = dv.getUint32(o, true); o+=4;

            //START ALPHA CHANGE 174 -- monotonic apply: ignore outdated GAME_STATE if sent -- ALPHA CHANGE 699 -- MOVED HERE immediately after reading tick, before you decode/apply anything else
            if (typeof this._lastAppliedTick === 'number' && (tick | 0) <= (this._lastAppliedTick | 0)) {
                return; // older or same tick -> do not apply again
            }
            this._lastAppliedTick = (tick | 0);
            //FINISH ALPHA CHANGE 174 -- monotonic apply: ignore outdated GAME_STATE -- use <= to ignore duplicates too (prevents double SFX / double apply)
            //così non applica quelli uguali (duplicati) e quelli vecchi (datati)

            //START ALPHA CHANGE 698 -- GAME_STATE: decode P1 only (p2x/p2y removed from packet) --
            // Players (P1 only)
            const p1x = dv.getInt16(o, true); o+=2;
            const p1y = dv.getInt16(o, true); o+=2;
            //FINISH ALPHA CHANGE 698 -- GAME_STATE: decode P1 only --

            // UI / game (GAME_STATE)
            const score = dv.getInt16(o, true); o+=2;
            const ammo  = dv.getUint16(o, true); o+=2;
            const shield= dv.getUint16(o, true); o+=2;
            const gtime = dv.getUint32(o, true); o+=4; // changed Float32 to Unit32 -- better time precision for time (integer millisecond timestamp instead of a float) 
            const gOver = dv.getUint8(o++) === 1;
            const gWon  = dv.getUint8(o++) === 1; // decoded from network buffer -- used by host in ALPHA CHANGE 658
            //START ALPHA CHANGE 65 -- read the extra paused byte on the client (decode)
            const gPaused = dv.getUint8(o++) === 1; // host paused flag
            //FINISH ALPHA CHANGE 65 -- contali, 2+2+2+4+1+1+1 = 13, come const uiBytes = 13 in encodeGameStateToBuffer (dopo diventano 15 vedo sotto)
            //START ALPHA CHANGE 186 -- p1/p2 powerUp flags and apply visuals on client after pause --
            const p1Pow   = dv.getUint8(o++) === 1; // P1 power-up (visual)
            const p2Pow   = dv.getUint8(o++) === 1; // P2 power-up (visual)

            //START ALPHA CHANGE 421 -- client: play powerDown when powerUp transitions true->false --
            try {
                // initialize latches on first use
                if (typeof this._p1PowLatch === "undefined") this._p1PowLatch = p1Pow;
                if (typeof this._p2PowLatch === "undefined") this._p2PowLatch = p2Pow;

                // P1 (host ship) SFX on client is harmless; main need is P2
                if (this._p1PowLatch === true && p1Pow === false && this.game?.sound?.powerDown) {
                    this.game.sound.powerDown();
                }
                if (this._p2PowLatch === true && p2Pow === false && this.game?.sound?.powerDown) {
                    this.game.sound.powerDown();
                }

                // update latches
                this._p1PowLatch = p1Pow;
                this._p2PowLatch = p2Pow;
            } catch (_) {}
            //FINISH ALPHA CHANGE 421 -- client: play powerDown when powerUp transitions true->false --

            // Apply to local visuals immediately (no simulation side-effects)
            try {
                if (this.game && this.game.player) {
                    this.game.player.powerUp = p1Pow;
                    this.game.player.frameY  = p1Pow ? 1 : 0;
                }
                if (this.player2) {
                    this.player2.powerUp = p2Pow;
                    this.player2.frameY  = p2Pow ? 1 : 0;
                }
            } catch (_) {}
            //FINISH ALPHA CHANGE 186 -- p1/p2 flags and apply visuals on client after pause --

            //START ALPHA CHANGE 652 -- GAME_STATE: decode host timeLimit + hardMode into MP-only fields --
            const hostTimeLimitMs = dv.getUint32(o, true); o += 4;
            const hostHardMode = (dv.getUint8(o) ? true : false); o += 1;

            // Store host values WITHOUT overwriting local options
            if (this.game) {
                this.game.mpTimeLimit = hostTimeLimitMs;
                this.game.mpHardMode  = hostHardMode;
            }
            //FINISH ALPHA CHANGE 652 -- GAME_STATE: decode host timeLimit + hardMode --

            // Enemies
            const nEnemies = dv.getUint8(o++);
            //START ALPHA CHANGE 168 — client: persist/reuse enemies by eid (no per-frame recreation)
            //NOTE: removed "const snapshotEnemies = [];" (ALPHA CHANGE 147 unused scaffolding). Client uses reusedList + _enemyByUid as the live state.
            const prevMap = this._enemyByUid || new Map();
            const nextMap = new Map();
            const reusedList = [];

            for (let i=0;i<nEnemies;i++) {
                //START ALPHA CHANGE 144 -- read per-enemy UID before type --
                const eid = dv.getUint16(o, true); o+=2;       //ALPHA CHANGE 144 -- per-enemy UID (host-minted)
                const id = dv.getUint8(o++);                   // enemy type id          
                const ex = dv.getInt16(o, true); o+=2;
                const ey = dv.getInt16(o, true); o+=2;
                const lives = dv.getUint8(o++); 
                //START ALPHA CHANGE 391B -- read per-enemy speedX (int16 fixed-point ×100) -- 
                const sxfp = dv.getInt16(o, true); o += 2;
                const speedX = sxfp / 100;
                //FINISH ALPHA CHANGE 391B -- read speedX --
                //START ALPHA CHANGE 452 -- read per-enemy spawn gameTime (uint32 ms) --
                const spawnGameTimeMs = dv.getUint32(o, true); o += 4;
                //FINISH ALPHA CHANGE 452 -- read per-enemy spawn gameTime --
                //START ALPHA CHANGE 164 -- stop reading animation bytes (fx/fy) and let client animate locally --
                // (removed) const fx = dv.getUint8(o++);
                // (removed) const fy = dv.getUint8(o++);
                // Reflect removal in snapshot (drop fx/fy)
                //Note: older client decoder (ALPHA 132/144/164) mirrored enemies into snapshotEnemies via
                // `snapshotEnemies.push({ eid, typeId: id, x: ex, y: ey, lives });` — removed because unused.
                //Live client state is now reusedList + _enemyByUid.
                // Reuse by eid when possible, else create a fresh instance for this type
                let enemy = prevMap.get(eid);
                const Ctor = this.enemyIdToCtor[id];
                if (!enemy && Ctor) {
                    enemy = new Ctor(this.game);
                    enemy.__eid = eid; // remember uid on the instance for debugging
                }
                if (enemy) {
                    //START ALPHA CHANGE 393 -- client: Y/LIVES stay host-auth -- removed hard snap due to ghost double draw bug -- 
                        //START ALPHA CHANGE 532 -- MP client: remove hard snap reconciliation (no enemy.x overwrite after firstSeen) --
                        const firstSeen = enemy.__firstSeen !== true; //computes whether this enemy instance has already been seeded from a snapshot
                        if (firstSeen) {
                            enemy.x = ex;            // Seeds the initial X from the authoritative snapshot -- enemy doesn’t start at the constructor default position --
                            enemy.y = ey;            // Y is constant per spawn; keep host Y
                            enemy.__firstSeen = true; //marks this instance as “seeded”; prevents re-seeding on later packets.
                            //START ALPHA CHANGE 452 -- seed client-side spawn kinematics from snapshot --
                            enemy.__spawnGameTimeMs = spawnGameTimeMs >>> 0; //sets the authoritative spawn timestamp used by ALPHA 453’s kinematic x(t) prediction
                            enemy.__spawnX = ex; //sets the authoritative origin X used by ALPHA 453’s kinematic x(t) prediction -- 
                            //FINISH ALPHA CHANGE 452 -- seed client-side spawn kinematics from snapshot --
                        }
                        //FINISH ALPHA CHANGE 532 -- MP client: remove hard snap reconciliation --
        
                    enemy.lives = lives;  // host-auth lives always applied
                    //START ALPHA CHANGE 391B -- store decoded speedX for future local stepping (no behavior change yet) --
                    enemy.speedX = speedX; // keep decoded speedX for local stepping -- updates speed used by client prediction/extrapolation (ALPHA 453 uses e.speedX) -- 
                    //FINISH ALPHA CHANGE 391B -- store decoded speedX --
                    //FINISH ALPHA CHANGE 393 -- seed + host-auth Y/LIVES --       
                    nextMap.set(eid, enemy); //saves the instance by unique ID for reuse on the next packet decode -- find the same enemy object next frame even after it has moved, been damaged, animated, etc
                    reusedList.push(enemy); //it’s the ordered list of enemy instances for this snapshot --> assign it to this.game.enemies --> it becomes “the current enemies array”
                }
            }

            // Replace live array with reused/persisted instances and swap the map
            this.game.enemies = reusedList;
            this._enemyByUid = nextMap;
            //FINISH ALPHA CHANGE 168 — client: persist/reuse enemies by eid (no per-frame recreation)
            
            // Projectiles (not strictly needed to reconstruct logic, but renders better)
            //START ALPHA CHANGE 154 -- read projectile count as uint16 (was uint8) --
            const nProj = dv.getUint16(o, true); o += 2;
            //FINISH ALPHA CHANGE 154 -- read projectile count as uint16 --
           //START ALPHA CHANGE 151 -- client: read per-projectile age (uint8) written by host --
            const projHost = [];
            const projClient = [];
            for (let i=0;i<nProj;i++) {
                const ptype = dv.getUint8(o++); // 1=P1 host, 2=P2 client
                const pid   = dv.getUint16(o, true); o+=2; // bullet id (uint16)
                const page  = dv.getUint8(o++);            // ageTicks (uint8) //START ALPHA CHANGE 151
                const px    = dv.getInt16(o, true); o+=2;
                const py    = dv.getInt16(o, true); o+=2;
                const row = { id: pid, age: page, x: px, y: py };   // include age for visuals //FINISH ALPHA CHANGE 151
                if (ptype === 2) projClient.push(row);
                else              projHost.push(row);
            }
            // cache host P1 bullets for visuals
            this._remoteProjectiles = projHost;
            // replace local client visual list with authoritative positions from host
            this._clientProjectiles = projClient;
            
            //This block is strictly client-side, and it uses the host’s PKT.GAME_STATE snapshot to decide which bullets exist 
            //(spawn/despawn + their initial seed pose), then it uses the client to animate them smoothly between snapshots when drawing
            //START ALPHA CHANGE 672 (ex ALPHA CHANGE 394) -- bullets: split persistent maps into P1 + P2 (no shared owner field) --
            // Build authoritative sets for this tick (separate sets so ids can't cross-contaminate)
            const _activeIdsP1 = new Set();
            const _activeIdsP2 = new Set();
            for (let i = 0; i < projHost.length; i++)  _activeIdsP1.add(projHost[i].id);
            for (let i = 0; i < projClient.length; i++) _activeIdsP2.add(projClient[i].id);

            // Ensure local maps exist:
            // - P1 map: id -> { x, y, ageFrames, powerUpAtSpawn }
            // - P2 map: id -> { x, y, ageFrames, powerUpAtSpawn }
            if (!this._localProjectilesP1) this._localProjectilesP1 = new Map();
            if (!this._localProjectilesP2) this._localProjectilesP2 = new Map();

            // Compute power flags ONCE per snapshot (use already-decoded snapshot flags)
            const powAtSpawnP1_672 = !!p1Pow;
            const powAtSpawnP2_672 = !!p2Pow;

            // SPAWN / REFRESH presence (pose is NOT snapped; we only seed on first see)
            const _seedP1 = (row) => {
                if (!this._localProjectilesP1.has(row.id)) {
                    this._localProjectilesP1.set(row.id, {
                        x: row.x, y: row.y,
                        ageFrames: (typeof row.age === 'number' ? row.age : 0),
                        powerUpAtSpawn: powAtSpawnP1_672
                    });
                } else {
                    const b = this._localProjectilesP1.get(row.id);
                    //START ALPHA CHANGE 675 -- freeze bullet anim phase refresh while HOST paused only --
                    const freezeAnim674 = !!gPaused; // authoritative host pause byte decoded in this GAME_STATE
                    if (b && !freezeAnim674) {
                        b.ageFrames = (typeof row.age === 'number' ? row.age : b.ageFrames);
                    }
                    //FINISH ALPHA CHANGE 675 -- freeze bullet anim phase refresh while HOST paused only --
                }
            };

            const _seedP2 = (row) => {
                if (!this._localProjectilesP2.has(row.id)) {
                    this._localProjectilesP2.set(row.id, {
                        x: row.x, y: row.y,
                        ageFrames: (typeof row.age === 'number' ? row.age : 0),
                        powerUpAtSpawn: powAtSpawnP2_672
                    });
                } else {
                    const b = this._localProjectilesP2.get(row.id);
                    //START ALPHA CHANGE 675 -- freeze bullet anim phase refresh while HOST paused only --
                    const freezeAnim674 = !!gPaused; // authoritative host pause byte decoded in this GAME_STATE
                    if (b && !freezeAnim674) {
                        b.ageFrames = (typeof row.age === 'number' ? row.age : b.ageFrames);
                    }
                    //FINISH ALPHA CHANGE 675 -- freeze bullet anim phase refresh while HOST paused only --
                }
            };

            for (let i = 0; i < projHost.length; i++)  _seedP1(projHost[i]);
            for (let i = 0; i < projClient.length; i++) _seedP2(projClient[i]);

            // DESPAWN per-owner: any local id not present in its snapshot disappears
            for (const id of this._localProjectilesP1.keys()) {
                if (!_activeIdsP1.has(id)) this._localProjectilesP1.delete(id);
            }
            for (const id of this._localProjectilesP2.keys()) {
                if (!_activeIdsP2.has(id)) this._localProjectilesP2.delete(id);
            }
            //FINISH ALPHA CHANGE 672 (ex ALPHA CHANGE 394)-- bullets: split persistent maps into P1 + P2 --

            //START ALPHA CHANGE 189 -- client: play host P1 fire SFX once per new bullet id --
            if (!this.isHost) {
                if (!this._p1ShotHeard) this._p1ShotHeard = new Set();
                for (let i = 0; i < projHost.length; i++) {
                    const id = projHost[i] && projHost[i].id;
                    if (id != null && !this._p1ShotHeard.has(id)) {
                        this._p1ShotHeard.add(id);
                        //START ALPHA CHANGE 483 -- client: mirror P1 power-up shot SFX (shot + secondShot) --
                        if (this.game && this.game.sound) {
                            const g  = this.game;
                            const p1 = g.player;
                            const powerUpActiveP1 = !!(p1 && p1.powerUp);

                            if (!powerUpActiveP1) {
                                if (typeof g.sound.shot === 'function') g.sound.shot();
                            } else {
                                if (typeof g.sound.shot === 'function') g.sound.shot();
                                if (typeof g.sound.secondShot === 'function') g.sound.secondShot();
                            }
                        }
                        //FINISH ALPHA CHANGE 483 -- client: mirror P1 power-up shot SFX (shot + secondShot) --
                    }
                }
            }
            //FINISH ALPHA CHANGE 189 -- client: play host P1 fire SFX once per new bullet id --

            //START ALPHA CHANGE 484 -- client: play host P2 fire SFX once per new bullet id (authoritative like P1) --
            if (!this.isHost) {
                if (!this._p2ShotHeard) this._p2ShotHeard = new Set();
                for (let i = 0; i < projClient.length; i++) {
                    const id = projClient[i] && projClient[i].id;
                    if (id != null && !this._p2ShotHeard.has(id)) {
                        this._p2ShotHeard.add(id);

                        if (this.game && this.game.sound) {
                            const g  = this.game;
                            const p2 = g.player2; // client-local ship state (authoritative for p2 pose/powerup)
                            const powerUpActiveP2 = !!(p2 && p2.powerUp);

                            if (typeof g.sound.shot === 'function') g.sound.shot();
                            if (powerUpActiveP2 && typeof g.sound.secondShot === 'function') g.sound.secondShot();
                        }
                    }
                }
            }
            //FINISH ALPHA CHANGE 484 -- client: play host P2 fire SFX once per new bullet id (authoritative like P1) --

            //FINISH ALPHA CHANGE 141 -- read bullet id and keep it in the snapshot rows --
            
            //START ALPHA CHANGE 398 -- remove legacy snapshot buffering write (no longer used anywhere) --
            // (Removed the whole START/FINISH ALPHA CHANGE 132 block that created 'snap' and called this._pushClientSnapshot(snap))
            //FINISH ALPHA CHANGE 398 -- remove legacy snapshot buffering write --

            // Apply — client authoritative for p2, so only apply p1 from host
            //START ALPHA CHANGE 168 — enemies already assigned above (persisted by eid)
            this.game.score = score;
            this.game.ammo = ammo;
            this.game.shieldEnergy = shield;
            this.game.gameTime = gtime;
            //FINISH ALPHA CHANGE 168 — enemies already assigned above (persisted by eid)
                       
            //START ALPHA CHANGE 21 -- client: detect rising edge of gameOver and start arm timer (no state flip)
            const wasOver = !!this.game.gameOver;
            this.game.gameOver = gOver;
            this.game.gameWon  = gWon;//ALPHA CHANGE 658 -- use centralized gameWon (gWon) --> apply the logic from the network decoder (const gWon  = dv.getUint8(o++) === 1;)
            if (!this.isHost && gOver && !wasOver) { 
               if (gWon) {this.game.sound.alphaTeamWin();}//ALPHA CHANGE 554 -- client: win voice uses gWon
               else if (!gWon) {this.game.sound.cmon();} //ALPHA CHANGE 581 -- client: play lose voice once on game-over edge --
                // mirror host’s 2s “arm” delay locally on client
                this._clientGameOverAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                // clear sticky inputs once on transition to avoid accidental selects
                try {
                    this.game.keys = [];
                    if (this.game.input) {
                        this.game.input.lastGamepadButtons = new Array(16).fill(false);
                        this.game.input.lastGamepadNav = { up:false, down:false, left:false, right:false };
                    }
                } catch (e) { /* safe no-op */ }
                //START ALPHA CHANGE 157
                this.game.gameOverMenuActive = false; // lock out client menu during 2s arm
                //FINISH ALPHA CHANGE 157
                
                //START ALPHA CHANGE 691 -- MP: gameOver overrides client-local pause (avoid pause/gameOver input conflict) --
                if (this.game.paused) { //forza la chiusura del menu di pausa se rimane aperto durante il game over così non crea il conflitto di input 
                    this.game.paused = false;
                    if (this.game.ui) this.game.ui.selectedPauseIndex = 0;
                    if (this.game.input) this.game.input.togglePause = false;
                }
                //FINISH ALPHA CHANGE 691 -- MP: gameOver overrides client-local pause --
            } else if (!gOver) {
                // host left game over: clear timer
                this._clientGameOverAt = null;
                //START ALPHA CHANGE 158
                this.game.gameOverMenuActive = false; // ensure menu is closed between rounds
                //FINISH ALPHA CHANGE 158
            }
            //FINISH ALPHA CHANGE 21
            //START ALPHA CHANGE 65
            // Client mirrors host pause as a separate remote-pause latch.
            // On rising edge: clear any held inputs so ship stops instantly.
            if (!this.isHost) {
                const wasHostPaused = !!this._hostPauseActive;
                this._hostPauseActive = !!gPaused;
                if (this._hostPauseActive && !wasHostPaused) {
                    try {
                        this.game.keys = [];
                        if (this.game.input) {
                            this.game.input.lastGamepadButtons = new Array(16).fill(false);
                            this.game.input.lastGamepadNav = { up:false, down:false, left:false, right:false };
                        }
                    } catch (e) { /* safe no-op */ }
                    this._hostPauseAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    //START ALPHA CHANGE 406 -- pause edge: zero fixed-step accumulators so resume doesn’t “burst step” --
                    this._enemySimAccMs = 0;
                    this._enemySimTick  = 0;
                    //FINISH ALPHA CHANGE 406 -- pause edge resets --        
                } else if (!this._hostPauseActive && wasHostPaused) {
                    this._hostPauseAt = null;
                    //START ALPHA CHANGE 406 -- unpause edge: also zero accumulators to restart cadence cleanly --
                    this._enemySimAccMs = 0;
                    this._enemySimTick  = 0;
                    //FINISH ALPHA CHANGE 406 -- unpause edge resets --
                }
            }
            //FINISH ALPHA CHANGE 65

            if (this.game.player) { this.game.player.x = p1x; this.game.player.y = p1y; }
            // p2 stays local on client

            //START ALPHA CHANGE 178
            // Log (throttled & gated)
            if (this.enableNetLogs && (tick % 60) === 0) {
                console.log(`[NET][CLIENT] applied tick=${tick} p1=(${p1x},${p1y}) p2Local=(${this.player2?.x|0},${this.player2?.y|0})`);
            }
            //FINISH ALPHA CHANGE 178
            return;
        }

        if (type === this.PKT.PLAYER_INPUT && this.isHost) {
            // Host receives compact player 2 input
            let o = 1;
            const x = dv.getInt16(o, true); o+=2;
            const y = dv.getInt16(o, true); o+=2;
            const flags = dv.getUint8(o++);

            //START ALPHA CHANGE 674 -- HOST pause: ignore remote P2 inputs (freeze ship + bullets) --
            if (this.game && this.game.paused) return;
            //FINISH ALPHA CHANGE 674 -- HOST pause: ignore remote P2 inputs (freeze ship + bullets) --

            if (this.player2) {
                this.player2.x = x; this.player2.y = y;
                //START GAMMA CHANGE 5
                // Host now trusts Player.shoot() to handle ammo/cooldown/SFX.
                // This avoids double-decrementing ammo or rejecting valid fires.
                if ((flags & 1) && typeof this.player2.shoot === 'function') {
                    this.player2.shoot();
                }
                //FINISH GAMMA CHANGE 5               
            }
            return;
        }
        //EXPLOSION decode -- [type:u8][x:i16][y:i16][scaleByte:u8] -- with true (little-endian) because encoder writes with setInt16(..., true) (e.g., dv.setInt16(1, x|0, true);)
        //byte 0 = type (1 byte), bytes 1–2 = x (2 bytes) → so getInt16(1, true), bytes 3–4 = y (2 bytes) → so getInt16(3, true), byte 5 = scaleByte (1 byte) → so getUint8(5)
        if (type === this.PKT.EXPLOSION && !this.isHost) { 
            // Client spawns the explosion locally
            const x = dv.getInt16(1, true); //coordinata x
            const y = dv.getInt16(3, true); //coordinata y
            // Route through the dedicated helper so visuals & sound match local explosions
            if (this.game && typeof this.game.addExplosionAt === 'function') {
                //START ALPHA CHANGE 543 -- EXPLOSION: decode scaleByte  --  fixed 6-byte packet decode       
                const scaleByte = dv.getUint8(5); //fattore di scaling
                const scaleOverride = (scaleByte / 100);           
                this.game.addExplosionAt(x, y, scaleOverride); // added scaleOverride
                //FINISH ALPHA CHANGE 543 -- EXPLOSION: decode scaleByte -- fixed 6-byte packet decode
            }        
            return;
        }

        //START ALPHA CHANGE 544 -- PLAYER_EXPLOSION decode: briefly hides ships + spawn P1+P2 booms (scaleByte) --
        if (type === this.PKT.PLAYER_EXPLOSION && !this.isHost) {
            const scaleByte = dv.getUint8(1);
            const scaleOverride = scaleByte / 100;
            const g = this.game;
            try {
                if (g) {
                    const p1 = g.player;
                    const p2 = (g.player2 ? g.player2 : this.player2);
                    if (p1) {
                        const cx1 = p1.x + p1.width * 0.5;
                        const cy1 = p1.y + p1.height * 0.5;
                        g.explosions.push(new Explosion(g, cx1, cy1, scaleOverride)); //P1 client explosion
                    }
                    if (p2) {
                        const cx2 = p2.x + p2.width * 0.5;
                        const cy2 = p2.y + p2.height * 0.5;
                        g.explosions.push(new Explosion(g, cx2, cy2, scaleOverride)); //P2 client explosion 
                    }
                    if (g.sound && typeof g.sound.explosion === 'function') g.sound.explosion();
                }
            } catch (e) {
                console.warn('[NET][CLIENT] failed to apply PLAYER_EXPLOSION:', e);
            }
            return;
        }
        //FINISH ALPHA CHANGE 544 -- PLAYER_EXPLOSION decode --

        //START ALPHA CHANGE 415 -- CLIENT: on HIT, play the same ship–collision SFX the host uses --
        if (type === this.PKT.HIT && !this.isHost) {
            //START ALPHA CHANGE 467 -- decode HIT owner (1=P1, 2=P2), keep shared SFX for now -- replaced ALPHA CHANGE 462
            try {
                // owner byte: 1 = P1(host ship), 2 = P2(client ship); 0/other = unknown (fallback)
                let owner = 0;
                try {
                    if (buffer && buffer.byteLength >= 2) { //fixed -- buf→buffer 
                        owner = dv.getUint8(1) | 0;
                    }
                } catch (e) {
                    console.warn("[NET][CLIENT] HIT owner decode failed (fallback to 0):", e);
                }

                //START ALPHA CHANGE 476 -- client: owner-specific shield visuals (P1 local shield, P2 overlay) --
                if (this.game && this.game.sound && typeof this.game.sound.hit === 'function') {
                    this.game.sound.hit(); // shared collision SFX (both ships)
                }

                // If host P1 ship was hit (or unknown legacy), use main Shield burst on P1
                if (owner === 1 ) {
                    if (this.game && this.game.shield && typeof this.game.shield.reset === 'function') {
                        this.game.shield.reset(); // plays shield sound + activates 1s burst at P1 position
                    }
                }
                // If client P2 ship was hit, drive independent P2 overlay instead
                else if (owner === 2) {
                    if (typeof this.triggerP2ShieldBurst === 'function') {
                        this.triggerP2ShieldBurst(); // turn P2 overlay ON for 1s burst
                    }
                    if (this.game && this.game.sound && typeof this.game.sound.shield === 'function') {
                        this.game.sound.shield(); // P2 shield SFX (matches host P2 branch)
                    } 
                } else {console.warn("[NET][CLIENT] HIT FAILED");} //log error 

                
                //FINISH ALPHA CHANGE 476 -- client: owner-specific shield visuals (P1 local shield, P2 overlay) --

            } catch (e) {
                console.warn("[NET][CLIENT] HIT SFX failed:", e);
            }
            //FINISH ALPHA CHANGE 467 -- decode HIT owner (1=P1, 2=P2), keep shared SFX for now --
            return;
        }
        //FINISH ALPHA CHANGE 415 -- CLIENT: on HIT, play ship–collision SFX --
        
       
        //START ALPHA CHANGE 418 -- CLIENT: POWERUP → play SFX immediately -- tenuto come esempio 
        if (type === this.PKT.POWERUP && !this.isHost) {
            try { if (this.game && this.game.sound && typeof this.game.sound.powerUp === 'function') this.game.sound.powerUp(); } catch (_) {}
            return;
        }
        //FINISH ALPHA CHANGE 418

        //START ALPHA CHANGE 738 -- CLIENT: MISSILE → play missile spawn SFX immediately --
        if (type === this.PKT.MISSILE && !this.isHost) {
            try { if (this.game && this.game.sound && typeof this.game.sound.missile === 'function') this.game.sound.missile(); } catch (_) {}
            return;
        }
        //FINISH ALPHA CHANGE 738 -- CLIENT: MISSILE → play missile spawn SFX immediately --
        

        //START ALPHA CHANGE 205 -- CLIENT: receive AUTO_SCORE(score) → try local auto-save & suppress prompt --
        if (type === this.PKT.AUTO_SCORE && !this.isHost) {
            try {
                const score = dv.getUint16(1, true) | 0;
                if (!this._teamAutoScoreDone) {
                    this._teamAutoScoreDone = true; // one-shot
                    if (this.game) {
                        // suppress local prompt path
                        if (this.game.awaitingNameInput) this.game.awaitingNameInput = false; 
                        this.game.namePromptTriggered = true;
                        // auto-add if qualifies on THIS machine’s leaderboard
                        if (this.game.leaderboard && typeof this.game.leaderboard.qualifies === 'function' &&
                            this.game.leaderboard.qualifies(score)) {
                            //START ALPHA CHANGE 694 -- MP leaderboard: auto-tag by host difficulty (client) --
                            const t694 = (typeof this.game.mpTimeLimit === "number") ? this.game.mpTimeLimit : this.game.timeLimit;
                            const hm694 = (typeof this.game.mpHardMode === "boolean") ? this.game.mpHardMode : this.game.hardMode;
                            const diff694 = hm694 ? "HARD" : (((t694|0) >= 120000) ? "EASY" : "NORMAL");
                            const name694 = `MP_${diff694}`;
                            this.game.leaderboard.addEntry(score, name694);
                            //FINISH ALPHA CHANGE 694 -- MP leaderboard: auto-tag by host difficulty (client) --
                        }
                    }
                }
            } catch (e) {
                console.warn("[NET][CLIENT] AUTO_SCORE decode/apply failed:", e);
            }
            return;
        }
        //FINISH ALPHA CHANGE 205 -- CLIENT: receive AUTO_SCORE(score) → try local auto-save & suppress prompt --

        //START ALPHA CHANGE 689 -- CLIENT: WIN_SCORE_BANNER(kind) → arm local 2s banner (wall-clock) --
        if (type === this.PKT.WIN_SCORE_BANNER && !this.isHost) {//handle WIN_SCORE_BANNER packet (client-side UI) --
            try {
                const kind = (dv.byteLength >= 2) ? (dv.getUint8(1) | 0) : 1;

                const g = this.game;
                if (g) {
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    g._winScoreBannerUntilMs683 = now + 2000;

                    // Text is chosen locally (no strings on the wire)
                    g._winScoreBannerText683 = (kind === 2)
                        ? "BELOW WINNING SCORE"
                        : "WINNING SCORE REACHED: SURVIVE!";
                }
            } catch (e) {
                console.warn("[NET][CLIENT] WIN_SCORE_BANNER decode/apply failed:", e);
            }
            return;
        }
        //FINISH ALPHA CHANGE 689 -- CLIENT: WIN_SCORE_BANNER(kind) --

        //START ALPHA CHANGE 178 -- PARTICLE (client visuals only): spawn particle burst --
        if (type === this.PKT.PARTICLE && !this.isHost) {
            try {
                const px = dv.getInt16(1, true);
                const py = dv.getInt16(3, true);
                const kind = dv.getUint8(5) | 0;
                let count = dv.getUint8(6) | 0;
                if (count <= 0) count = 1;

                let Cls = Particle;
                if (kind === 2) Cls = Particle2;
                else if (kind === 3) Cls = Particle3;

                //START ALPHA CHANGE 680 -- MP: PARTICLE decode scatter using representative enemy sizes by kind --
                // Representative on-screen sizes from your enemy classes:
                // - kind 3 (Particle3) = HiveWhale 420x400
                // - kind 2 (Particle2) = Drone 115x100 (also works for Lucky)
                // - kind 1 (Particle)  = Angler1 285x285
                const edgeFactor = 0.45; // keep consistent with your SP tuning (tweak later if needed)
                let baseW = 285, baseH = 285;
                if (kind === 2) { baseW = 115; baseH = 100; }
                else if (kind === 3) { baseW = 420; baseH = 400; }

                for (let i = 0; i < count; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const t = 0.70 + Math.random() * 0.30; // annulus thickness (0.70..1.00)
                    const sx = px + Math.cos(a) * baseW * edgeFactor * t;
                    const sy = py + Math.sin(a) * baseH * edgeFactor * t;
                    this.game.particles.push(new Cls(this.game, sx, sy));
                }
                //FINISH ALPHA CHANGE 680 -- MP: PARTICLE decode scatter using representative enemy sizes by kind --
            } catch (e) {
                console.warn('[NET] PARTICLE decode failed:', e);
            }
            return;
        }
        //FINISH ALPHA CHANGE 178 -- PARTICLE (client visuals only) --
    }
    //FINISH CHANGE Implement binary encode/decode helpers inside SteamMultiplayer 

    //START ALPHA CHANGE 726 -- MP: remove legacy JSON handleNetworkMessage (binary-only path) --
    // Legacy JSON multiplayer path removed to avoid confusion. The shipped MP path is binary via:
    //   ipcRenderer.on('network-binary', ...) -> handleBinaryMessage(buffer, sender)
    //FINISH ALPHA CHANGE 726 -- MP: remove legacy JSON handleNetworkMessage (binary-only path) --

    requestLobbyList() {
        this.lobbyState = "listing";
        //START ALPHA CHANGE 97 -- mark refresh moment for UI flash --
        try {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            this._lastLobbyRefreshAt = now;
            // Step 1: manual flag stays false; Step 2 will flip it on manual presses
            if (typeof this._lastLobbyRefreshManual !== "boolean") this._lastLobbyRefreshManual = false;
        } catch (e) { /* no-op */ }
        //FINISH ALPHA CHANGE 97 -- mark refresh moment for UI flash --
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('request-lobby-list');
            console.log("Requested lobby list");
        }
    }

    createLobby() {
        this.lobbyState = "creating";
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('create-lobby', 2, "public"); // 2 players, public lobby
            console.log("Creating public lobby");
        }
    }

    joinLobby(lobbyId) {
        this.lobbyState = "joining";
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            //START ALPHA CHANGE 235
            // Cache friendly name locally for the client overlay:
            // look up the lobby entry we’re about to join and prefer its .name (fallback: undefined)
            try {
                const arr = Array.isArray(this.lobbies) ? this.lobbies : [];
                const entry = arr.find(l => String(l.id) === String(lobbyId));
                this._friendlyLobbyName = entry && entry.name ? entry.name : undefined;
            } catch (e) {
                console.warn("[MP] failed to cache friendly lobby name before join:", e);
            }
            //FINISH ALPHA CHANGE 235
            ipcRenderer.send('join-lobby', lobbyId);
            console.log("Joining lobby:", lobbyId);
        }
    }

    //START ALPHA CHANGE 79 -- helper: host can start only when in-lobby, opponent known, P2P warmed --
    isStartGameAvailable() {
        if (!this.isHost) return false;
        return (this.lobbyState === "inLobby") && !!this.opponentSteamId && !!this._p2pReady;
    }
    //FINISH ALPHA CHANGE 79

    startMultiplayerGame() {
        //START BETA CHANGE 12 -- add precise diagnostics for why start is blocked --
        console.log("[MP] startMultiplayerGame called", {
            lobbyState: this.lobbyState,
            opponentSteamId: this.opponentSteamId ? String(this.opponentSteamId) : null,
            isHost: this.isHost,
            lobbyId: this.lobbyId ? String(this.lobbyId) : null,
            gameState: this.game.gameState
        });
        // START GAMMA CHANGE 49 — client safety: tolerate late/failed lobby-joined
        if (!this.isHost && this.lobbyState !== "inLobby") {
            console.warn("[MP][CLIENT] startMultiplayerGame(): forcing lobbyState='inLobby' (late start)");
            this.lobbyState = "inLobby";
        }
        // FINISH GAMMA CHANGE 49
        if (this.lobbyState !== "inLobby") {
            console.warn("[MP] Blocked: lobbyState is", this.lobbyState, "(expected 'inLobby')");
            return;
        }
        if (!this.opponentSteamId) {
            console.warn("[MP] Blocked: opponentSteamId is missing/null");
            return;
        }
        //START ALPHA CHANGE 79 -- host must wait for warm path (_p2pReady) before starting --
        if (this.isHost && !this._p2pReady) {
            console.warn("[MP][HOST] Blocked: P2P path not ready yet (_p2pReady=false)");
            return;
        }
        //FINISH ALPHA CHANGE 79 -- helper for create lobby menu text
        //FINISH BETA CHANGE 12 -- add precise diagnostics for why start is blocked --
        //START GAMMA CHANGE 48 — clear transient leave-notice/watchdog state on new session
        this._leaveNoticeGuard = false;
        this._leaveNoticeAt = 0;
        this._promptText = "";
        this._autoLeaveFired = false;   // re-arm 15s watchdog each session
        this._lastPeerPacketAt = 0;     // fresh heartbeat timing
        //FINISH GAMMA CHANGE 48
        //START ALPHA CHANGE 636 -- MP: set MP flag BEFORE host reset so Game.reset does not play SP intro voice --
        this.isMultiplayer = true; // set early so Game.reset() sees multiplayer and skips introMessage
        //FINISH ALPHA CHANGE 636 -- MP: set MP flag BEFORE host reset so Game.reset does not play SP intro voice --
        //START BETA CHANGE 22 -- host reset must happen BEFORE flags/player2 creation --
        if (this.isHost) {
            this.game.reset(); // reset now, so we don't wipe multiplayer flags/player2 later
        }
        //FINISH BETA CHANGE 22 -- host reset must happen BEFORE flags/player2 creation --
        //START ALPHA CHANGE 206 -- reset team auto-score latch at the start of each new round --
        this._teamAutoScoreDone = false;
        //FINISH ALPHA CHANGE 206 -- reset team auto-score latch at the start of each new round --
        this.lobbyState = "playing";
        this.isMultiplayer = true;
        //START BETA CHANGE 19 -- make Game aware it’s in multiplayer so player2 gets drawn --
        this.game.isMultiplayer = true;
        //FINISH BETA CHANGE 19 -- make Game aware it’s in multiplayer so player2 gets drawn --
        this.game.gameState = "playing";
        //START ALPHA CHANGE 708a -- cursor: arm initial hide timer on MP start (shares InputHandler _cursorHideTimer707 slot) --
        //invoke the existing InputHandler helper inside startMultiplayerGame() after switched the game into "playing"
        try {
            if (this.game && this.game.input && typeof this.game.input.armCursorHideTimer707 === "function") {
                this.game.input.armCursorHideTimer707();
            }
        } catch (_) {}
        //FINISH ALPHA CHANGE 708a -- cursor: arm initial hide timer on MP start --
        this.game.player2 = new Player(this.game);
        this.player2 = this.game.player2;
        this.player2.x = 100; // Offset from player1
        this.game.sound.pauseMenuSoundtrack();
        this.game.sound.resetSoundtrack();
        console.log("Starting multiplayer game, isHost:", this.isHost);
        //START GAMMA CHANGE 25
        // Client-only: intercept any calls to game.reset() (e.g., Game Over → Restart)
        // to request a host-driven restart instead of resetting locally.
        if (!this.isHost && !this._patchedReset && this.game && typeof this.game.reset === 'function') {
            this._patchedReset = true;
            const orig = this.game.reset.bind(this.game);
            this._origGameReset = orig;
            const self = this;
            this.game.reset = function patchedClientReset() {
                try {
                    if (self.isMultiplayer && !self.isHost) {
                        const buf = self.encodeRestartRequestToBuffer();
                        self.sendNetworkBinary(buf, 'Reliable');
                        console.log('[MP][CLIENT] Sent RESTART_REQ to host');
                        return; // don’t reset locally
                    }
                } catch (e) { console.warn('[MP][CLIENT] restart request failed, falling back:', e); }
                return self._origGameReset(); // fallback (SP or unexpected state)
            };
        }
        //FINISH GAMMA CHANGE 25
        if (this.isHost) {
            //START BETA CHANGE 22 -- moved reset above; keep only the start signal here --
            // Send compact binary gameStart
            const gsb = this.encodeGameStartToBuffer();
            this.sendNetworkBinary(gsb, 'Reliable');
            //FINISH BETA CHANGE 22 -- moved reset above; keep only the start signal here --
        }
    }

leaveLobby() {//LASCIA LOBBY E TORNA AL MENU PRINCIPALE (SENZA CHIAMARE returnToMainMenu())
//START ALPHA CHANGE 708 -- cursor: force visible + cancel pending hide when leaving lobby --
    try {
        if (this.game && this.game.input && typeof this.game.input.showCursorAndCancel707 === "function") {
            this.game.input.showCursorAndCancel707();
        }
    } catch (_) {}
//FINISH ALPHA CHANGE 708 -- cursor: force visible + cancel pending hide when leaving lobby --
//START GAMMA CHANGE 36 -- capture peer and ask main process to close P2P before tearing down
const peerId = this.opponentSteamId; // keep a copy before we clear it
//FINISH GAMMA CHANGE 36
//START GAMMA CHANGE 59 -- snapshot role; use it for LEAVE_NOTICE + banner
const wasHost = !!this.isHost;
//FINISH GAMMA CHANGE 59
//START GAMMA CHANGE 60 -- initiator-only LEAVE_NOTICE + banner; passive side does not echo
//This guarded version (a) only sends when we’re the initiator and (b) uses the snapshotted 
//role wasHost you already captured (const wasHost = !!this.isHost;) a few lines above
try {
    if (peerId != null && !this._leaveNoticeGuard) {
        // We are the initiator of the leave
        this._leaveNoticeGuard = true;

        // 2-byte packet: [LEAVE_NOTICE, roleByte] where 1=host (P1), 2=client (P2)
        const buf = new Uint8Array(2);
        buf[0] = this.PKT.LEAVE_NOTICE;
        buf[1] = wasHost ? 1 : 2;
        this.sendNetworkBinary(buf, 'Reliable');

        // Show our own banner with the *initiator’s* role (snapshotted before any state changes)
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this._leaveNoticeAt = now;
        this._promptText = `${wasHost ? 'PLAYER 1' : 'PLAYER 2'} LEFT THE GAME — SESSION CLOSED`;
    }
} catch (e) {
    console.warn('[MP] LEAVE_NOTICE send failed (safe to ignore):', e);
}
//FINISH GAMMA CHANGE 60 -- initiator-only LEAVE_NOTICE + banner
        this.lobbyId = null;
        // (moved) this.opponentSteamId = null; // handled at the end after IPC
        this.isHost = false;
        this.isMultiplayer = false;
        this.lobbyState = "none";
        this.game.player2 = null;
        this.player2 = null;
        this.game.gameState = "mainMenu"; //Note: we simply go to main menu, we don't call returnToMainMenu() here or it would create an infinite loop bug (returnToMainMenu() → leaveLobby() → returnToMainMenu())
        //START ALPHA CHANGE 703 -- MP leaveLobby: clear run outcome flags so achievements can't leak into menus and fixes "changing difficulty setting triggers ach win score" bug ---
        this.game.gameOver = false;
        this.game.gameWon = false;
        this.game.playerDied = false;
        //FINISH ALPHA CHANGE 703 -- MP leaveLobby: clear run outcome flags so achievements can't leak into menus and fixes "changing difficulty setting triggers ach win score" bug -- 
        this.game.ui.selectedMenuIndex = 0;
        this.game.sound.pauseSoundtrack();
        this.game.sound.resetMenuSoundtrack();
        //START GAMMA CHANGE 16
        // Mirror MP state to the Game object and clear respawn guard fields
        this.game.isMultiplayer = false;
        this._p2RequireNearSpawn = false;
        this._p2SpawnX = undefined;
        this._p2SpawnY = undefined;
        this._p2LastFireSentAt = undefined;
        //FINISH GAMMA CHANGE 16
        //START ALPHA CHANGE 190 -- clear host P1 shot SFX dedupe on leave --
        if (this._p1ShotHeard) this._p1ShotHeard.clear();
        //FINISH ALPHA CHANGE 190 -- clear host P1 shot SFX dedupe on leave --
        //START ALPHA CHANGE 68
        this._helloTimer = 0;      // stop any pending lobby warm-up cadence
        this._p2pReady = false;    // force a fresh warm-up next session
        //FINISH ALPHA CHANGE 68
        //START ALPHA CHANGE 89
        this._p2pLikelyEstablished = false; // UI-only flag: clear on exit so next session starts at NO
        //FINISH ALPHA CHANGE 89
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
        // START GAMMA CHANGE 51 — give Reliable LEAVE_NOTICE a moment to flush before teardown
        const doTearDown = () => {
            try {
                if (peerId != null) {
                    ipcRenderer.send('close-p2p', peerId);
                    console.log('[P2P] Requested close for peer', String(peerId));
                }
            } catch (e) {
                console.warn('[P2P] close-p2p IPC failed:', e);
            }
            ipcRenderer.send('leave-lobby');
            console.log('Left lobby');
            this.opponentSteamId = null; // clear after IPC
        };

        // If we just notified the peer (peerId != null), delay teardown ~200ms
        if (peerId != null) {
            setTimeout(doTearDown, 200);
        } else {
            doTearDown();
        }
        // FINISH GAMMA CHANGE 51
    } else {
        // no IPC available; still clear locally
        this.opponentSteamId = null;
    }
  }//closes leaveLobby
}//closes SteamMultiplayer
//finish SteamMultiplayer class

//final game loop 

    const game = new Game(canvas.width, canvas.height, canvas);
    
    //START ALPHA CHANGE 497 -- AssetsLoading: build task list immediately at boot (no warm-up yet) --
    try {
        if (game && game.assetsLoading && typeof game.assetsLoading.buildTasks === "function") {
            game.assetsLoading.buildTasks();
        }
    } catch (e) {
        console.warn("[AssetsLoading] buildTasks() failed at boot:", e);
    }
    //FINISH ALPHA CHANGE 497 -- AssetsLoading: build task list immediately at boot (no warm-up yet) --
    
    let lastTime = 0;

    //update animate loop to check AssetsLoading before rendering -- game won’t start until ready -- rendering the actual game (game.draw/update) is blocked --
    function animate(timeStamp){

        //START ALPHA CHANGE 498 -- AssetsLoading: advance ONE preload/warm task per frame (non-blocking) --
        //while assets are not ready: this mini-worker (runOne()) keeps advancing progress -- rendering the actual game (game.draw/update) is blocked
        try {
            const al = game && game.assetsLoading;
            if (al && typeof al.runOne === "function" && typeof al.isRenderReady === "function" && !al.isRenderReady()) {
                al.runOne();
            }
        } catch (e) {
            // keep silent (perf-safe); optional: console.warn("[AssetsLoading] runOne failed:", e);
        }
        //FINISH ALPHA CHANGE 498 -- AssetsLoading: advance ONE preload/warm task per frame (non-blocking) --
        
        //Ok gating rendering così tutte le immagini sono render ready -- only catch non è gate anche il constructor ovvero game.constructor puo lo stesso costruire la logica nel frattempo, 
        //ma dato che specifichiamo sempre la risoluzione delle immagini, non sono mai undefined anche prima che siano caricate (sono valori deterministici che non deve ricavare dai file)
        //START ALPHA CHANGE 519 -- gate rendering on AssetsLoading render-ready (replaces legacy isImagesLoaded) --
        try {
            const al = game && game.assetsLoading;
            if (al && typeof al.isRenderReady === "function" && !al.isRenderReady()) {

                //START ALPHA CHANGE 520 -- Loading bar overlay while AssetsLoading warms up --
                try {
                    const w = canvas && canvas.width ? canvas.width : (game && game.width ? game.width : 1280);
                    const h = canvas && canvas.height ? canvas.height : (game && game.height ? game.height : 720);

                    // Clear frame (we're not rendering the game yet)
                    ctx.clearRect(0, 0, w, h);

                    //loading screen: draw menu background if available (fallback to dark) --
                    const bg = document.getElementById("menuBackgroundMultiplayer");
                    if (bg && bg.complete && bg.naturalWidth > 0) {
                        ctx.drawImage(bg, 0, 0, w, h);
                    } else {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        ctx.fillRect(0, 0, w, h);
                    }

                    //LOADING: match in-game blink style (flash last letter) + same UI fontFamily --
                    const now527 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
                    const blinkOn527 = (((now527 / 400) | 0) % 2) === 0; // same cadence used by UI overlays
                    const ff527 = (game && game.ui && game.ui.fontFamily) ? game.ui.fontFamily : "Bangers";
                    const loadingText527 = blinkOn527 ? "LOADING" : "";

                    ctx.save();
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.font = "48px " + ff527;
                    ctx.fillStyle = blinkOn527 ? "#ff0000" : "#880000";
                    ctx.fillText(loadingText527, Math.round(w / 2), Math.round(h / 2));
                    ctx.restore();
                    
                    //START ALPHA CHANGE 705 -- Loading screen: add static quote under LOADING (client+host, loading-only) --
                    ctx.save();
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.font = "32px " + ff527;
                    //shadow 
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    ctx.shadowColor = "black";
                    ctx.shadowBlur = 6; // optional
                    //text color 
                    ctx.fillStyle = "#ffff00";
                    ctx.globalAlpha = 0.9;
                    ctx.fillText("[WK] One man can make a difference, Alpha One", Math.round(w / 2), Math.round(h * 0.1) + 0);
                    ctx.restore();
                    //FINISH ALPHA CHANGE 705 -- Loading screen: add static quote under LOADING (client+host, loading-only) --

                    // Percent (prefer method, fallback to counters)
                    let percent = 0;
                    if (al && typeof al.getPercent === "function") {
                        percent = al.getPercent();
                    } else if (al && al.totalTasks) {
                        percent = Math.round((al.completedTasks / al.totalTasks) * 100);
                    }
                    if (percent < 0) percent = 0;
                    if (percent > 100) percent = 100;

                    const label = (al && typeof al.currentLabel === "string" && al.currentLabel)
                        ? al.currentLabel
                        : "loading assets...";

                    // Bar geometry (top-left, like shield/ammo UI style but red)
                    const pad = 20;
                    const barW = Math.round(w * 0.35);
                    const barH = 18;
                    const x = pad;
                    const y = pad;

                    // Title text
                    ctx.save();
                    ctx.textAlign = "left";
                    ctx.textBaseline = "alphabetic";
                    const ff528 = (game && game.ui && game.ui.fontFamily) ? game.ui.fontFamily : "Bangers"; //loading bar title: use UI fontFamily (Bangers) --
                    ctx.font = "16px " + ff528;
                    ctx.fillStyle = "#ffffff";
                    ctx.fillText(`Loading assets: ${percent}%`, x, y - 6);

                    // Outline
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = "rgba(255, 0, 0, 0.95)";
                    ctx.strokeRect(x, y, barW, barH);

                    // Fill (flash a bit at 100%)
                    const flash = (percent >= 100) ? ((Math.floor(timeStamp / 250) % 2) ? 0.25 : 0.65) : 0.45;
                    ctx.fillStyle = `rgba(255, 0, 0, ${flash})`;
                    ctx.fillRect(x, y, Math.round(barW * (percent / 100)), barH);

                    // Small label under the bar (which asset/task we are on)
                    ctx.font = "12px Helvetica";
                    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                    ctx.textBaseline = "top";
                    ctx.fillText(label, x, y + barH + 8);

                    ctx.restore();
                } catch (_) {}
                //FINISH ALPHA CHANGE 520 -- Loading bar overlay while AssetsLoading warms up --

                //START ALPHA CHANGE 709 -- animate: prevent huge deltaTime after loading gate --
                lastTime = timeStamp;
                //FINISH ALPHA CHANGE 709 -- animate: prevent huge deltaTime after loading gate --

                setTimeout(() => requestAnimationFrame(animate), 100);
                return;
            }
        } catch (_) {
            // if anything goes wrong, don't hard-block rendering
        }
        //FINISH ALPHA CHANGE 519 -- gate rendering on AssetsLoading render-ready --

        const deltaTime = timeStamp - lastTime;
        lastTime = timeStamp

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        game.draw(ctx);

        game.update(deltaTime);

        requestAnimationFrame(animate);
    } 
    animate(0);
}); // end of code
