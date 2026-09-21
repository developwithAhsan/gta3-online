// re3 WebAssembly runtime launcher.
//
// Responsibilities (see docs/BROWSER_RUNTIME.md and docs/GAME_ASSETS.md):
//   - instantiate the Emscripten module produced by src/CMakeLists.txt (MODULARIZE=1,
//     EXPORT_NAME=createRe3Module) with our own progress/error hooks instead of the
//     default auto-running shell
//   - own the <canvas> element and its sizing (CSS size, devicePixelRatio, resize,
//     fullscreen) independently of whether the engine itself has gotten that far
//   - report a live diagnostics panel (WASM load state, WebGL support, canvas size,
//     browser feature support) regardless of whether engine init succeeds
//   - mount a game-asset root into the module's virtual filesystem (web/vfs.js) --
//     from a packaged build, a local dev server, and/or a user-picked folder -- and
//     validate it against web/asset-manifest.json before the engine ever touches it
//   - fail *visibly*: any failure at any stage (script load, module instantiation,
//     asset mounting, re3's own main()) is caught and shown in the UI, never just a
//     blank page
//
// This file never contains, downloads, or ships any GTA III asset data. It only
// moves bytes the user already has into the running module's filesystem. See
// docs/GAME_ASSETS.md for the full picture and the legal requirement behind this.
//
// re3's own main() is not called automatically -- see runEngineMain() and the
// "Start engine" button. Phase 3 is the asset-loading mechanism, not gameplay.

(() => {
	"use strict";

	const els = {
		statusDot: document.getElementById("status-dot"),
		statusText: document.getElementById("status-text"),
		loadingOverlay: document.getElementById("loading-overlay"),
		loadingTitle: document.getElementById("loading-title"),
		loadingStatus: document.getElementById("loading-status"),
		loadingDetail: document.getElementById("loading-detail"),
		loadingPercent: document.getElementById("loading-percent"),
		loadingStage: document.getElementById("loading-stage"),
		progressFill: document.getElementById("progress-fill"),
		errorBanner: document.getElementById("error-banner"),
		errorDetail: document.getElementById("error-detail"),
		canvas: document.getElementById("canvas"),
		viewport: document.getElementById("viewport"),
		sidepanel: document.getElementById("sidepanel"),
		diagnosticsBtn: document.getElementById("diagnostics-btn"),
		fullscreenBtn: document.getElementById("fullscreen-btn"),
		diagnosticsTable: document.getElementById("diagnostics-table"),
		logOutput: document.getElementById("log-output"),
		assetsOverlay: document.getElementById("assets-overlay"),
		assetsStatus: document.getElementById("assets-status"),
		assetsMissingList: document.getElementById("assets-missing-list"),
		pickFolderBtn: document.getElementById("pick-folder-btn"),
		pickZipBtn: document.getElementById("pick-zip-btn"),
		downloadPlayBtn: document.getElementById("download-play-btn"),
		clearCacheBtn: document.getElementById("clear-cache-btn"),
		zipInput: document.getElementById("zip-input"),
		devMountBtn: document.getElementById("dev-mount-btn"),
		startEngineBtn: document.getElementById("start-engine-btn"),
		folderInput: document.getElementById("folder-input"),
		inputDebugBtn: document.getElementById("input-debug-btn"),
		pointerlockHint: document.getElementById("pointerlock-hint"),
		heroLayer: document.querySelector(".hero-layer"),
		inputSummaryTable: document.getElementById("input-summary-table"),
		inputMouseTable: document.getElementById("input-mouse-table"),
		inputKeysList: document.getElementById("input-keys-list"),
		inputGamepadInfo: document.getElementById("input-gamepad-info"),
		perfTable: document.getElementById("perf-table"),
		fpsBadge: document.getElementById("fps-badge"),
		bootProgressList: document.getElementById("boot-progress-list"),
		debugModeCheckbox: document.getElementById("debug-mode-checkbox"),
		saveTable: document.getElementById("save-table"),
		saveForceSyncBtn: document.getElementById("save-force-sync-btn"),
		saveClearBtn: document.getElementById("save-clear-btn"),
	};

	// Boot progress (Phase 9, docs/FIRST_BOOT.md): created immediately -- it
	// doesn't depend on the module having loaded, only on the DOM. renderAssetValidation()
	// below (JS-side stage 2) and main() (JS-side stage 1, then C++-side stages
	// 3-7 via pollFromEngine()) both use this shared instance.
	const bootProgress = Re3Boot.setupBootProgress(els.bootProgressList);

	// ---------------------------------------------------------------------
	// Status / log / error UI helpers
	// ---------------------------------------------------------------------

	function setStatus(state, text) {
		els.statusDot.dataset.state = state;
		els.statusText.textContent = text;
	}

	function setLoadingStatus(text) {
		els.loadingStatus.textContent = text;
	}

	function setLoadingTitle(text) {
		if (els.loadingTitle) els.loadingTitle.textContent = text;
	}

	function setLoadingDetail(text) {
		if (els.loadingDetail) els.loadingDetail.textContent = text || "";
	}

	function setLoadingStage(text) {
		if (els.loadingStage) els.loadingStage.textContent = text || "";
	}

	function formatBytes(bytes) {
		if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
		const mb = bytes / (1024 * 1024);
		if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
		return `${(mb / 1024).toFixed(2)} GB`;
	}

	function setProgress(fraction /* 0..1, or null for indeterminate */) {
		if (fraction == null) {
			els.progressFill.classList.add("indeterminate");
			els.progressFill.style.width = "";
			if (els.loadingPercent) els.loadingPercent.textContent = "Loading…";
		} else {
			const clamped = Math.max(0, Math.min(1, fraction));
			const pct = Math.round(clamped * 100);
			els.progressFill.classList.remove("indeterminate");
			els.progressFill.style.width = `${pct}%`;
			if (els.loadingPercent) els.loadingPercent.textContent = `${pct}%`;
		}
	}

	function hideLoadingOverlay() {
		els.loadingOverlay.classList.add("hidden");
	}

	function showLoadingOverlay() {
		els.loadingOverlay.classList.remove("hidden");
	}

	const MAX_LOG_LINES = 500;
	let logLineCount = 0;

	function log(text, cls) {
		const line = document.createElement("div");
		line.className = "log-line" + (cls ? ` ${cls}` : "");
		line.textContent = text;
		els.logOutput.appendChild(line);
		logLineCount++;
		if (logLineCount > MAX_LOG_LINES) {
			els.logOutput.removeChild(els.logOutput.firstChild);
			logLineCount--;
		}
		els.logOutput.parentElement.scrollTop = els.logOutput.parentElement.scrollHeight;
	}

	function formatError(err) {
		if (err == null) return "(no error object)";
		if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`;
		if (typeof err === "object") {
			try { return JSON.stringify(err, null, 2); } catch { /* fall through */ }
		}
		return String(err);
	}

	// This is the "controlled shutdown/error" endpoint from the Phase 2 goal diagram:
	// every failure path in this file funnels through here rather than being handled
	// ad hoc, so the page always ends in a visible, explained state instead of a
	// silent blank canvas.
	function showFatalError(title, err) {
		const detail = formatError(err);
		els.errorDetail.textContent = detail;
		els.errorBanner.querySelector(".error-title").textContent = title;
		els.errorBanner.classList.add("visible");
		hideLoadingOverlay();
		setStatus("error", title);
		log(`[fatal] ${title}: ${detail}`, "stderr");
		console.error(title, err);
	}

	// ---------------------------------------------------------------------
	// Diagnostics
	// ---------------------------------------------------------------------

	const diagRows = new Map(); // key -> <tr>

	function setDiag(key, value, ok /* true|false|"warn"|undefined */) {
		let row = diagRows.get(key);
		if (!row) {
			row = document.createElement("tr");
			const k = document.createElement("td");
			k.className = "key";
			k.textContent = key;
			const v = document.createElement("td");
			v.className = "val";
			row.appendChild(k);
			row.appendChild(v);
			els.diagnosticsTable.appendChild(row);
			diagRows.set(key, row);
		}
		const valCell = row.children[1];
		valCell.textContent = value;
		if (ok === undefined) {
			delete valCell.dataset.ok;
		} else {
			valCell.dataset.ok = String(ok);
		}
	}

	function probeWebGL() {
		// Independent of the engine/module: this only tells us what the *browser* can
		// do, using a throwaway canvas, so it's meaningful even before/if the WASM
		// module ever loads.
		const probe = document.createElement("canvas");
		let gl = probe.getContext("webgl2");
		let version = null;
		if (gl) {
			version = gl.getParameter(gl.VERSION);
			return { available: true, contextType: "webgl2", version };
		}
		gl = probe.getContext("webgl") || probe.getContext("experimental-webgl");
		if (gl) {
			version = gl.getParameter(gl.VERSION);
			return { available: true, contextType: "webgl", version };
		}
		return { available: false, contextType: null, version: null };
	}

	function collectStaticDiagnostics() {
		setDiag("WASM loaded", "false", false);
		setDiag("Engine initialized", "false", false);

		const webgl = probeWebGL();
		setDiag("WebGL available", String(webgl.available), webgl.available);
		setDiag("WebGL context type", webgl.contextType ?? "n/a", webgl.available);
		setDiag("WebGL version string", webgl.version ?? "n/a", webgl.available);
		// re3 targets WebGL2 specifically (USE_WEBGL2=1 / RW_GL3) -- surface that
		// distinction explicitly since "WebGL available" alone can be misleading.
		setDiag("WebGL2 (required by re3)", String(webgl.contextType === "webgl2"), webgl.contextType === "webgl2");

		setDiag("WebAssembly support", String(typeof WebAssembly === "object"), typeof WebAssembly === "object");
		// re3_wasm no longer uses Emscripten pthreads (Phase 8, docs/THREADING_WASM.md
		// -- the only background thread anywhere in the engine, CD streaming, now runs
		// synchronously on the main thread instead), so SharedArrayBuffer/cross-origin
		// isolation are no longer *required* for this build -- shown here purely as
		// informational browser-capability probes, not a pass/fail gate.
		setDiag("SharedArrayBuffer (not required by re3_wasm)", String(typeof SharedArrayBuffer !== "undefined"));
		setDiag("crossOriginIsolated (not required by re3_wasm)", String(!!window.crossOriginIsolated));
		setDiag("hardwareConcurrency", String(navigator.hardwareConcurrency ?? "unknown"));
		setDiag("Worker support", String(typeof Worker !== "undefined"), typeof Worker !== "undefined");
		setDiag("Fullscreen API", String(!!(document.documentElement.requestFullscreen)), !!(document.documentElement.requestFullscreen));
		setDiag("Pointer Lock API", String(!!els.canvas.requestPointerLock), !!els.canvas.requestPointerLock);
		setDiag("Gamepad API", String(!!navigator.getGamepads), !!navigator.getGamepads);
		setDiag("devicePixelRatio", String(window.devicePixelRatio || 1));
		setDiag("deviceMemory (GB)", String(navigator.deviceMemory ?? "unknown"));
		setDiag("userAgent", navigator.userAgent);
		setDiag("location", location.href);

		updateCanvasDiagnostics();
	}

	function updateCanvasDiagnostics() {
		const rect = els.canvas.getBoundingClientRect();
		setDiag("Canvas CSS size", `${Math.round(rect.width)} x ${Math.round(rect.height)}`);
		setDiag("Canvas backing size", `${els.canvas.width} x ${els.canvas.height}`);
		// DevTools-dependency debugging: opening/docking DevTools resizes the
		// viewport, which is exactly what these three track -- compare them with
		// DevTools open vs closed to see what (if anything) actually differs.
		setDiag("window.innerWidth x innerHeight", `${window.innerWidth} x ${window.innerHeight}`);
		setDiag("document.hidden", String(document.hidden));
		setDiag("document.visibilityState", document.visibilityState);
	}

	// GS_* names mirror src/skel/crossplatform.h exactly (re3_GetGameState()
	// returns the raw enum value, see src/skel/glfw/glfw.cpp).
	const GAME_STATE_NAMES = [
		"GS_START_UP", "GS_INIT_LOGO_MPEG", "GS_LOGO_MPEG", "GS_INIT_INTRO_MPEG",
		"GS_INTRO_MPEG", "GS_INIT_ONCE", "GS_INIT_FRONTEND", "GS_FRONTEND",
		"GS_INIT_PLAYING_GAME", "GS_PLAYING_GAME",
	];
	const AUDIO_CONTEXT_STATE_NAMES = ["no context yet", "running", "suspended", "closed"];

	// Live runtime state (task: Part 1/3 debugging) -- polled via setTimeout,
	// not requestAnimationFrame, for the same reason web/perf.js's frame-timing
	// panel is (see its comment): this must keep working even in hosting
	// contexts where rAF is suspended.
	function setupRuntimeStateDiagnostics(instance) {
		let getGameState, getAudioState;
		try {
			getGameState = instance.cwrap("re3_GetGameState", "number", []);
			getAudioState = instance.cwrap("re3_GetAudioContextState", "number", []);
		} catch {
			return; // export not present (e.g. an older build)
		}
		function poll() {
			// Each read is independent -- one missing/throwing export (e.g. an
			// older build without re3_GetAudioContextState) must not stop the
			// others, or the whole poll loop, from continuing.
			try {
				const gs = getGameState();
				setDiag("gGameState", GAME_STATE_NAMES[gs] ?? `unknown(${gs})`);
			} catch { /* ignore */ }
			try {
				const as = getAudioState();
				setDiag("AudioContext state", AUDIO_CONTEXT_STATE_NAMES[as] ?? `unknown(${as})`, as === 1 ? true : as === 2 ? "warn" : undefined);
			} catch { /* ignore */ }
			updateCanvasDiagnostics();
			setTimeout(poll, 250);
		}
		setTimeout(poll, 250);
	}

	// Save system diagnostics (docs/SAVES_WASM.md): Re3Saves (web/saves.js)
	// tracks its own sync state and calls back on every transition, so this
	// panel is event-driven rather than polled -- no per-frame or per-timer
	// work, it just re-renders whenever there's actually something new to show.
	function setupSaveDiagnosticsPanel() {
		const rows = new Map();
		function setRow(key, value) {
			let row = rows.get(key);
			if (!row) {
				row = document.createElement("tr");
				const k = document.createElement("td");
				k.className = "key";
				k.textContent = key;
				const v = document.createElement("td");
				v.className = "val";
				row.append(k, v);
				els.saveTable.appendChild(row);
				rows.set(key, row);
			}
			row.children[1].textContent = value;
		}

		function render() {
			const s = Re3Saves.getStatus();
			setRow("Backend", s.backend);
			setRow("Save directory", s.saveDir || "(not mounted yet)");
			setRow("Storage status", s.state === "syncing" ? "Syncing…" : "Ready");
			setRow(
				"Last sync",
				s.lastSyncResult
					? `${s.lastSyncResult === "success" ? "Success" : "Failure: " + s.lastSyncError}` +
					  (s.lastSyncAt ? ` @ ${s.lastSyncAt.toLocaleTimeString()}` : "")
					: "(none yet)"
			);
		}

		Re3Saves.setOnStateChange(render);
		render();

		els.saveForceSyncBtn.addEventListener("click", () => {
			log("[Save] Force Save Sync requested", "info");
			Re3Saves.forceSync();
		});
		els.saveClearBtn.addEventListener("click", async () => {
			if (!confirm("Delete all browser-saved GTA III save games? This cannot be undone.")) return;
			try {
				await Re3Saves.clearSaves();
				render();
			} catch (err) {
				log(`[Save] ERROR: could not clear saves: ${err}`, "stderr");
			}
		});
	}

	// ---------------------------------------------------------------------
	// Canvas sizing: CSS size is driven by layout (see styles.css, #canvas is
	// 100%/100% of #viewport); the backing pixel buffer is sized to CSS size *
	// devicePixelRatio so rendering is crisp on HiDPI displays. This is entirely a
	// DOM/browser-shell concern and works whether or not the engine has initialized.
	// ---------------------------------------------------------------------

	function resizeCanvasToDisplaySize() {
		const dpr = window.devicePixelRatio || 1;
		const rect = els.viewport.getBoundingClientRect();
		const width = Math.max(1, Math.round(rect.width * dpr));
		const height = Math.max(1, Math.round(rect.height * dpr));
		if (els.canvas.width !== width || els.canvas.height !== height) {
			els.canvas.width = width;
			els.canvas.height = height;
			log(`[canvas] resized to ${width}x${height} (dpr=${dpr})`, "info");
		}
		updateCanvasDiagnostics();
	}

	function setupResizeHandling() {
		resizeCanvasToDisplaySize();
		// ResizeObserver covers layout-driven size changes (sidepanel opening,
		// container CSS changes, etc); window "resize" covers the outer viewport
		// changing size. Both are wired unconditionally -- some embedders/automation
		// harnesses only reliably fire one or the other, and there's no downside to
		// having both (resizeCanvasToDisplaySize() is a no-op if the size is unchanged).
		if (typeof ResizeObserver !== "undefined") {
			const ro = new ResizeObserver(() => resizeCanvasToDisplaySize());
			ro.observe(els.viewport);
		}
		window.addEventListener("resize", resizeCanvasToDisplaySize);
		window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", resizeCanvasToDisplaySize, { once: true });

		// ResizeObserver/rAF-driven layout only updates while the tab is actually
		// being rendered (per spec, both are suspended for hidden documents -- e.g.
		// a tab opened in the background, a prerendered page, or one restored from
		// the back/forward cache). Re-measure once the page actually becomes visible
		// so the canvas isn't left sized from whatever layout existed at that time.
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) resizeCanvasToDisplaySize();
		});
		window.addEventListener("load", resizeCanvasToDisplaySize);
	}

	function setupFullscreen() {
		els.fullscreenBtn.addEventListener("click", () => {
			if (!document.fullscreenElement) {
				els.viewport.requestFullscreen?.().catch((err) => log(`[fullscreen] request failed: ${err}`, "stderr"));
			} else {
				document.exitFullscreen?.();
			}
		});
		document.addEventListener("fullscreenchange", () => {
			els.fullscreenBtn.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
			// Give the layout a frame to settle before resizing the backing buffer.
			requestAnimationFrame(resizeCanvasToDisplaySize);
		});
	}

	function setupDiagnosticsToggle() {
		els.diagnosticsBtn.addEventListener("click", () => {
			els.sidepanel.classList.toggle("open");
		});
	}

	function setupInputDebugToggle() {
		els.inputDebugBtn.addEventListener("click", () => {
			els.sidepanel.classList.toggle("open");
			document.getElementById("input-debug-section")?.scrollIntoView({ block: "start" });
		});
	}

	// ---------------------------------------------------------------------
	// Asset mounting (Phase 3 -- see web/vfs.js, web/asset-manifest.json,
	// docs/GAME_ASSETS.md). None of this touches engine/librw code: it only moves
	// files into the module's virtual filesystem and, once the user is ready,
	// chdir()s the engine's startup code there -- see runEngineMain().
	// ---------------------------------------------------------------------

	function getAssetRoot() {
		return new URLSearchParams(location.search).get("assetRoot") || AssetVFS.DEFAULT_MOUNT_POINT;
	}

	function devAssetsRequested() {
		return new URLSearchParams(location.search).get("devAssets") === "1";
	}

	let cachedManifest = null;
	async function loadAssetManifest() {
		if (cachedManifest) return cachedManifest;
		const resp = await fetch("asset-manifest.json?v=12", { cache: "no-cache" });
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		cachedManifest = await resp.json();
		return cachedManifest;
	}

	function renderAssetValidation(result, mountPoint) {
		const total = result.presentRequired.length + result.missingRequired.length + (result.emptyRequired?.length || 0);
		const invalidRequired = result.missingRequired.length + (result.emptyRequired?.length || 0);
		els.startEngineBtn.disabled = !result.ok;
		els.startEngineBtn.textContent = result.ok ? "Play GTA III" : "Game files required";
		setDiag("Required assets valid", `${result.presentRequired.length} / ${total}`, invalidRequired === 0);
		if (result.defaultDatChecked) {
			setDiag("data/default.dat references missing", String(result.missingFromDefaultDat.length), result.missingFromDefaultDat.length === 0);
		}
		if (result.gta3DatChecked) {
			setDiag("data/gta3.dat references missing", String(result.missingFromGta3Dat.length), result.missingFromGta3Dat.length === 0);
		}
		setDiag("Core asset format issues", String(result.formatIssues?.length || 0), (result.formatIssues?.length || 0) === 0);

		els.assetsMissingList.innerHTML = "";
		for (const msg of result.messages) {
			log(`[assets] ${msg}`, "stderr");
			const li = document.createElement("li");
			li.textContent = msg;
			els.assetsMissingList.appendChild(li);
		}

		if (result.ok) {
			els.assetsStatus.textContent = `All startup assets and level-manifest references are valid under ${mountPoint}.`;
			els.assetsStatus.dataset.ok = "true";
			bootProgress.setStage(2);
		} else {
			els.assetsStatus.textContent = `${result.messages.length} asset validation issue(s) found under ${mountPoint}. Play is disabled until these files are supplied from a valid GTA III installation.`;
			els.assetsStatus.dataset.ok = "false";
		}
	}

	async function revalidateAssets(instance, mountPoint, manifest) {
		if (!manifest) return null;
		const result = AssetVFS.validate(instance.FS, mountPoint, manifest);
		renderAssetValidation(result, mountPoint);
		return result;
	}


	async function extractCachedZipToRuntime(instance, mountPoint, manifest, zipFile, label = "cached ZIP") {
		showLoadingOverlay();
		setLoadingTitle("Preparing GTA III");
		setLoadingStage("OPFS → RAM");
		setLoadingStatus(`Extracting ${label} into the WebAssembly runtime…`);
		setLoadingDetail("No network download is needed for this step.");
		setProgress(0);

		const n = await AssetVFS.mountFromZipFile(instance.FS, mountPoint, zipFile, {
			onProgress: (p) => {
				const fraction = p.compressedTotal > 0 ? p.compressedRead / p.compressedTotal : null;
				setProgress(fraction);
				if (p.phase === "reading-archive") {
					setLoadingStatus(`Reading ${label}…`);
					setLoadingDetail(`${formatBytes(p.compressedRead)} / ${formatBytes(p.compressedTotal)} • ${p.filesDone} file(s) extracted`);
				} else if (p.phase === "extracting") {
					setLoadingStatus(`Extracting game files — ${p.filesDone} complete`);
					setLoadingDetail(`${p.currentFile} • ${formatBytes(p.extractedBytes)} extracted to runtime RAM`);
				}
			},
		});

		log(`[assets] extracted ${n} relevant file(s) from ${label} into MEMFS`, "info");
		setLoadingTitle("Checking GTA III files");
		setLoadingStage("VALIDATION");
		setLoadingStatus("Validating GTA III game data…");
		setLoadingDetail("Checking required models, scripts and level-manifest references.");
		setProgress(0.99);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const result = await revalidateAssets(instance, mountPoint, manifest);
		if (!result?.ok) {
			throw new Error("Cached ZIP extracted successfully, but required GTA III files are missing or incompatible.");
		}

		setProgress(1);
		setLoadingStatus("Game files ready");
		setLoadingDetail("Starting GTA III automatically…");
		log("[assets] cached ZIP validated; scheduling automatic engine start", "info");
		setTimeout(() => els.startEngineBtn.click(), 0);
		return result;
	}

	async function installRemoteArchiveToOPFS(url) {
		showLoadingOverlay();
		setLoadingTitle("Downloading GTA III archive");
		setLoadingStage("NETWORK → OPFS");
		setLoadingStatus("Saving the compressed ZIP in private browser storage…");
		setLoadingDetail("This is a one-time network download. Future visits reuse the OPFS cache.");
		setProgress(0);

		await OPFSAssetCache.cacheRemoteUrl(url, {
			onProgress: (p) => {
				const fraction = p.total > 0 ? p.loaded / p.total : null;
				setProgress(fraction);
				setLoadingStatus("Downloading GTA III archive…");
				setLoadingDetail(
					p.total > 0
						? `${formatBytes(p.loaded)} / ${formatBytes(p.total)} saved to OPFS`
						: `${formatBytes(p.loaded)} saved to OPFS`
				);
			},
		});
	}

	async function setupAssetPanel(instance, mountPoint) {
		setDiag("Asset root", mountPoint);

		let manifest = null;
		try {
			manifest = await loadAssetManifest();
		} catch (err) {
			log(`[assets] could not load asset-manifest.json (${err}) -- validation will be skipped`, "stderr");
		}

		// Keep the large GTA III installation session-only. Persisting the entire
		// install to IDBFS duplicates hundreds of MB of data, causes long syncs,
		// and can make the page appear frozen/black on memory-constrained devices.
		// Save games still use their own small persistent IDBFS mount (saves.js).
		AssetVFS.mountEmpty(instance.FS, mountPoint);
		log(`[assets] mounted session-only game filesystem at ${mountPoint}; save games remain persistent`, "info");

		// Packaged filesystem (task 7): quietly try, it's normal for there to be none.
		try {
			const n = await AssetVFS.mountFromPackage(instance.FS, mountPoint);
			log(`[assets] loaded ${n} file(s) from the packaged build`, "info");
		} catch (err) {
			log(`[assets] no packaged asset build found (${err.message})`, "info");
		}

		await revalidateAssets(instance, mountPoint, manifest);


		els.downloadPlayBtn.addEventListener("click", async () => {
			if (engineStartRequested) return;

			const cfg = window.GTA3_ASSET_CONFIG || {};
			els.downloadPlayBtn.disabled = true;
			els.pickFolderBtn.disabled = true;
			els.pickZipBtn.disabled = true;
			els.clearCacheBtn.disabled = true;
			els.startEngineBtn.disabled = true;
			const originalLabel = els.downloadPlayBtn.textContent;
			els.downloadPlayBtn.textContent = "Preparing…";

			try {
				if (!window.OPFSAssetCache?.supported()) {
					throw new Error("This browser does not support OPFS. Use the local ZIP or folder option instead.");
				}

				await OPFSAssetCache.requestPersistence();
				const cacheStatus = await OPFSAssetCache.getStatus();

				if (cacheStatus.ready) {
					log(`[assets] Download & Play: using existing OPFS cache (${formatBytes(cacheStatus.size)})`, "info");
					els.downloadPlayBtn.textContent = "Loading cached game…";
					const cachedZip = await OPFSAssetCache.getArchiveFile();
					await extractCachedZipToRuntime(instance, mountPoint, manifest, cachedZip, "cached GTA III ZIP");
					return;
				}

				const downloadUrl = cfg.proxyUrl || cfg.archiveUrl;
				if (!downloadUrl) {
					throw new Error(
						"No authorized archive source is configured in web/asset-source.js. " +
						"Set GTA3_ASSET_CONFIG.proxyUrl (recommended) or archiveUrl."
					);
				}

				els.downloadPlayBtn.textContent = "Downloading…";
				try {
					await installRemoteArchiveToOPFS(downloadUrl);
				} catch (downloadErr) {
					const directDrive = !cfg.proxyUrl && /drive\.usercontent\.google\.com|drive\.google\.com/i.test(downloadUrl);
					if (directDrive && /Failed to fetch|NetworkError|Load failed/i.test(String(downloadErr))) {
						throw new Error(
							"Google Drive blocked the browser's cross-origin fetch (CORS). " +
							"Deploy the included Cloudflare Worker and put its public URL in " +
							"GTA3_ASSET_CONFIG.proxyUrl. The OPFS downloader will then work normally."
						);
					}
					throw downloadErr;
				}

				const downloaded = await OPFSAssetCache.getArchiveFile();
				els.downloadPlayBtn.textContent = "Starting…";
				await extractCachedZipToRuntime(instance, mountPoint, manifest, downloaded, "downloaded GTA III ZIP");
			} catch (err) {
				log(`[assets] Download & Play failed: ${err}`, "stderr");
				showFatalError("Download & Play failed", err);
			} finally {
				els.downloadPlayBtn.disabled = false;
				els.pickFolderBtn.disabled = false;
				els.pickZipBtn.disabled = false;
				els.clearCacheBtn.disabled = false;
				els.downloadPlayBtn.textContent = originalLabel;
			}
		});

		els.pickZipBtn.addEventListener("click", () => els.zipInput.click());
		els.zipInput.addEventListener("change", async () => {
			const zipFile = els.zipInput.files?.[0];
			if (!zipFile) return;

			els.pickFolderBtn.disabled = true;
			els.pickZipBtn.disabled = true;
			els.clearCacheBtn.disabled = true;
			els.startEngineBtn.disabled = true;
			const originalLabel = els.pickZipBtn.textContent;

			try {
				if (window.OPFSAssetCache?.supported()) {
					await OPFSAssetCache.requestPersistence();
					showLoadingOverlay();
					setLoadingTitle("Caching GTA III ZIP");
					setLoadingStage("ZIP → OPFS");
					setLoadingStatus("Saving your ZIP in private browser storage…");
					setLoadingDetail("This cached ZIP will be reused on later visits.");
					setProgress(0);

					await OPFSAssetCache.cacheLocalFile(zipFile, {
						onProgress: (p) => {
							const fraction = p.total > 0 ? p.loaded / p.total : null;
							setProgress(fraction);
							setLoadingStatus("Caching GTA III ZIP…");
							setLoadingDetail(
								p.total > 0
									? `${formatBytes(p.loaded)} / ${formatBytes(p.total)} saved to OPFS`
									: `${formatBytes(p.loaded)} saved to OPFS`
							);
							els.pickZipBtn.textContent = `Caching… ${Math.round((fraction || 0) * 100)}%`;
						},
					});

					const cached = await OPFSAssetCache.getArchiveFile();
					await extractCachedZipToRuntime(instance, mountPoint, manifest, cached, "cached GTA III ZIP");
				} else {
					log("[assets] OPFS unavailable; falling back to session-only ZIP extraction", "stderr");
					await extractCachedZipToRuntime(instance, mountPoint, manifest, zipFile, "selected GTA III ZIP");
				}
			} catch (err) {
				log(`[assets] ZIP cache/import failed: ${err}`, "stderr");
				showFatalError("Could not cache or load GTA III ZIP", err);
			} finally {
				els.pickFolderBtn.disabled = false;
				els.pickZipBtn.disabled = false;
				els.clearCacheBtn.disabled = false;
				els.pickZipBtn.textContent = originalLabel;
				els.zipInput.value = "";
			}
		});

		els.clearCacheBtn.addEventListener("click", async () => {
			if (!window.OPFSAssetCache?.supported()) return;
			els.clearCacheBtn.disabled = true;
			try {
				await OPFSAssetCache.clear();
				els.assetsStatus.textContent = "Cached GTA III ZIP cleared. Select a ZIP to cache it again.";
				delete els.assetsStatus.dataset.ok;
				log("[assets] cleared persistent OPFS GTA III ZIP cache", "info");
			} catch (err) {
				log(`[assets] failed to clear OPFS cache: ${err}`, "stderr");
			} finally {
				els.clearCacheBtn.disabled = false;
			}
		});

		els.pickFolderBtn.addEventListener("click", () => els.folderInput.click());
		els.folderInput.addEventListener("change", async () => {
			if (!els.folderInput.files.length) return;
			els.pickFolderBtn.disabled = true;
			els.startEngineBtn.disabled = true;
			const originalLabel = els.pickFolderBtn.textContent;
			showLoadingOverlay();
			setLoadingTitle("Loading GTA III files");
			setLoadingStage("GAME FILES");
			setLoadingStatus("Reading your local GTA III folder…");
			setLoadingDetail("Files stay on this device and are not uploaded.");
			setProgress(0);

			try {
				const n = await AssetVFS.mountFromFileList(instance.FS, mountPoint, els.folderInput.files, {
					onProgress: (done, total, currentFile, doneBytes, totalBytes, phase, meta) => {
						const fraction = totalBytes > 0 ? doneBytes / totalBytes : (total ? done / total : 0);
						setProgress(fraction);
						if (phase === "filtered") {
							setLoadingStatus(`Preparing ${total} required/relevant files…`);
							setLoadingDetail(
								`Skipped ${meta?.skippedFiles || 0} unused files (${formatBytes(meta?.skippedBytes || 0)}) to reduce browser memory use.`
							);
						} else {
							setLoadingStatus(`Loading game files — ${done}/${total}`);
							setLoadingDetail(
								`${phase === "reading" ? "Reading" : "Loaded"}: ${currentFile} • ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`
							);
						}
						els.pickFolderBtn.textContent = `Loading… ${done}/${total}`;
					},
				});
				log(`[assets] loaded ${n} file(s) from the chosen folder`, "info");

				setLoadingTitle("Checking GTA III files");
				setLoadingStage("VALIDATION");
				setLoadingStatus("Validating required game data…");
				setLoadingDetail("Checking gta3.dat references and required models.");
				setProgress(0.99);
				await new Promise((resolve) => setTimeout(resolve, 0));
				await revalidateAssets(instance, mountPoint, manifest);
				setProgress(1);
			} catch (err) {
				log(`[assets] failed to load folder: ${err}`, "stderr");
				showFatalError("Could not load GTA III files", err);
			} finally {
				els.pickFolderBtn.disabled = false;
				els.pickFolderBtn.textContent = originalLabel;
				els.folderInput.value = "";
				if (!els.errorBanner.classList.contains("visible")) hideLoadingOverlay();
			}
		});

		if (devAssetsRequested()) {
			els.devMountBtn.style.display = "";
			els.devMountBtn.addEventListener("click", async () => {
				els.devMountBtn.disabled = true;
				const originalLabel = els.devMountBtn.textContent;
				try {
					const n = await AssetVFS.mountFromDevServer(instance.FS, mountPoint, {
						onProgress: (done, total) => {
							if (done % 25 === 0 || done === total) els.devMountBtn.textContent = `Loading… ${done}/${total}`;
						},
					});
					log(`[assets] loaded ${n} file(s) from the dev asset server`, "info");
				} catch (err) {
					log(`[assets] dev-mount failed: ${err}`, "stderr");
				} finally {
					els.devMountBtn.disabled = false;
					els.devMountBtn.textContent = originalLabel;
				}
				await revalidateAssets(instance, mountPoint, manifest);
			});
		}

		// Persistent OPFS archive cache status only. Do not extract or download
		// game data during ordinary page load. The user explicitly starts that
		// work by pressing PLAY GAME in the site UI.
		if (window.OPFSAssetCache?.supported()) {
			try {
				await OPFSAssetCache.requestPersistence();
				const cacheStatus = await OPFSAssetCache.getStatus();
				setDiag("Persistent OPFS ZIP cache", cacheStatus.ready ? formatBytes(cacheStatus.size) : "not installed", cacheStatus.ready ? true : "warn");

				if (cacheStatus.ready) {
					els.assetsStatus.textContent = `Cached GTA III ZIP ready (${formatBytes(cacheStatus.size)}). Press PLAY GAME to load it.`;
					els.assetsStatus.dataset.ok = "true";
				} else {
					els.assetsStatus.textContent = "No cached GTA III archive yet. PLAY GAME will download and cache it.";
					delete els.assetsStatus.dataset.ok;
				}
			} catch (err) {
				log(`[assets] OPFS cache status check failed: ${err}`, "stderr");
				els.assetsStatus.textContent = "Persistent cache status could not be checked. PLAY GAME can still retry.";
				els.assetsStatus.dataset.ok = "false";
			}
		}

		els.assetsOverlay.classList.remove("hidden");
	}

	function monitorEngineStartup(instance) {
		let getStage, getGameState, getRenderCount;
		try { getStage = instance.cwrap("re3_GetBootStage", "number", []); } catch {}
		try { getGameState = instance.cwrap("re3_GetGameState", "number", []); } catch {}
		try { getRenderCount = instance.cwrap("re3_GetRenderCallCount", "number", []); } catch {}

		let stopped = false;
		let lastState = -1;
		let lastStage = -1;
		let lastChangeAt = performance.now();
		let frontendShown = false;

		const stageLabels = {
			1: ["Starting WebAssembly runtime…", 0.22, "WASM"],
			2: ["Game filesystem ready…", 0.30, "FILESYSTEM"],
			3: ["Starting WebGL renderer…", 0.40, "RENDERER"],
			4: ["Starting silent audio backend…", 0.48, "AUDIO"],
			5: ["Loading core GTA III data…", 0.58, "GAME DATA"],
			6: ["Initializing GTA III engine…", 0.67, "ENGINE"],
			7: ["Main menu ready…", 0.74, "FRONTEND"],
		};

		function poll() {
			if (stopped) return;

			let stage = 1;
			let state = -1;
			let renders = 0;
			try { if (getStage) stage = getStage(); } catch {}
			try { if (getGameState) state = getGameState(); } catch {}
			try { if (getRenderCount) renders = getRenderCount(); } catch {}

			if (state !== lastState || stage !== lastStage) {
				lastState = state;
				lastStage = stage;
				lastChangeAt = performance.now();
				log(`[startup] stage=${stage} state=${GAME_STATE_NAMES[state] ?? state} renders=${renders}`, "info");
			}

			const stageInfo = stageLabels[Math.max(1, Math.min(7, stage))];
			if (stageInfo && state < 8) {
				setLoadingStatus(stageInfo[0]);
				setProgress(stageInfo[1]);
				setLoadingStage(stageInfo[2]);
			}

			if (state >= 0) {
				setLoadingDetail(`Engine state: ${GAME_STATE_NAMES[state] ?? `state ${state}`}`);
			}

			// Read-only production monitor: never mutate re3 state/timing here.
			if (state === 7 && !frontendShown) {
				frontendShown = true;
				setProgress(1);
				setStatus("ok", "GTA III main menu ready");
				setLoadingStatus("GTA III main menu ready");
				setLoadingDetail("Use the game menu to start or load a game.");
				setTimeout(hideLoadingOverlay, 120);
			}

			if (state === 8) {
				showLoadingOverlay();
				setLoadingTitle("Loading Liberty City");
				setLoadingStatus("Initializing world, models and scripts…");
				setLoadingDetail("Reading GTA III data and preparing the world.");
				setLoadingStage("WORLD");
				setProgress(0.86);
			}

			if (state === 9) {
				setLoadingTitle("Entering Liberty City");
				setLoadingStatus("Starting gameplay renderer…");
				setLoadingDetail(`Rendered gameplay frames: ${renders}`);
				setLoadingStage("PLAYING");
				setProgress(renders > 0 ? 0.98 : 0.94);

				if (renders >= 2) {
					setProgress(1);
					setStatus("ok", "GTA III running");
					setLoadingStatus("GTA III is ready");
					setLoadingDetail("Click the game to capture the mouse. Press Esc to release it.");
					setTimeout(hideLoadingOverlay, 120);
				}
			}

			if (performance.now() - lastChangeAt > 15000) {
				setLoadingDetail(`Still working: stage ${stage}, state ${GAME_STATE_NAMES[state] ?? state}. Open Diagnostics if this does not advance.`);
			}

			setTimeout(poll, 150);
		}

		setTimeout(poll, 60);
		return () => { stopped = true; };
	}

	// Deliberately not called automatically -- the user decides when to hand off to
	// re3's own C++ startup path, after mounting whatever assets they have (or none,
	// to see the engine's own error reporting). See docs/GAME_ASSETS.md.
	//
	// Async because it must await the save directory's IDBFS restore
	// (docs/SAVES_WASM.md) before calling into re3's own callMain(): re3's
	// startup scans for existing save slots (C_PcSave::PopulateSlotInfo(),
	// triggered from the frontend menu once the engine is running) shortly
	// after main() starts, and that scan must never run before whatever was
	// persisted in IndexedDB last session has actually been restored onto the
	// virtual filesystem -- FS.syncfs(true) is asynchronous, so this is a real
	// ordering requirement, not a formality.
	let engineStartRequested = false;

	async function runEngineMain(instance, mountPoint, focusRecovery, tabThrottling) {
		if (engineStartRequested) return;
		engineStartRequested = true;

		// Give instant visible feedback for the Play button. Previously the loader
		// was shown underneath #assets-overlay and the asset dialog stayed on top
		// while save restoration ran, making the button appear to do nothing.
		els.startEngineBtn.disabled = true;
		els.startEngineBtn.textContent = "Starting…";
		els.assetsOverlay.classList.add("hidden");
		els.heroLayer?.classList.add("hidden");
		showLoadingOverlay();
		// Never hold the Play flow at a "save restore" checkpoint. The browser
		// build currently uses session-only MEMFS saves, so prepare that directory
		// opportunistically and enter the engine immediately.
		setLoadingTitle("Booting GTA III");
		setLoadingStage("ENGINE");
		setLoadingStatus("Starting the re3 engine…");
		setLoadingDetail("Preparing the game filesystem and renderer.");
		setProgress(0.20);
		setStatus("loading", "starting re3 engine…");

		try {
			const saveSetup = Re3Saves.mountAndRestore(instance, mountPoint, log);
			if (saveSetup && typeof saveSetup.catch === "function") {
				saveSetup.catch((err) =>
					log(`[Save] Session save setup failed; continuing without persistence: ${err}`, "stderr")
				);
			}
		} catch (err) {
			log(`[Save] Session save setup failed; continuing: ${err}`, "stderr");
		}

		AssetVFS.chdirToRoot(instance.FS, mountPoint);
		log(`[module] cwd set to ${mountPoint}, calling main()`, "info");

		// Keep the browser loader visible until the engine reaches real gameplay
		// and has completed at least two rendered frames.
		monitorEngineStartup(instance);

		// Only start clearing input state on browser focus loss once the engine is
		// actually about to run -- see Re3Input.setupFocusLossRecovery and
		// re3_OnBrowserFocusLost's own RsGlobal.ps guard in glfw.cpp.
		focusRecovery?.arm();
		// Same reasoning for CTimer::Suspend()/Resume() on tab visibility -- see
		// Re3Perf.setupTabThrottling.
		tabThrottling?.arm();

		// Everything from here on is re3's own C++ startup path (RsEventHandler
		// (rsINITIALIZE, ...) -> RenderWare/GLFW/WebGL setup -> game state machine).
		// It was written for a native OS and still assumes things this browser shell
		// cannot fully provide yet -- see docs/GAME_ASSETS.md and
		// docs/BROWSER_RUNTIME.md for exactly what and why. We do not patch around
		// that here: we call it, and report exactly what happens, success or failure.
		try {
			setStatus("loading", "running re3 initialization…");

			// Important: let the browser commit the 20% loading overlay before
			// entering re3's synchronous C++ startup. Without this paint turn,
			// callMain() can monopolize the main thread before the user sees any
			// visual feedback, making Play look completely unresponsive.
			await new Promise((resolve) =>
				requestAnimationFrame(() => setTimeout(resolve, 0))
			);

			log("[module] entering callMain()", "info");
			const rc = instance.callMain([]);
			setDiag("Engine initialized", "main loop registered", true);
			setStatus("loading", "GTA III engine running…");
			log(`[module] main() returned ${rc}; waiting for gameplay state`, "info");
		} catch (err) {
			setDiag("Engine initialized", "false (see error)", false);
			engineStartRequested = false;
			els.startEngineBtn.disabled = false;
			els.startEngineBtn.textContent = "Play GTA III";
			showFatalError("re3 initialization failed", err);
		}
	}

	// ---------------------------------------------------------------------
	// Module bring-up
	// ---------------------------------------------------------------------

	async function main() {
		collectStaticDiagnostics();
		setupResizeHandling();
		setupFullscreen();
		setupDiagnosticsToggle();
		setupInputDebugToggle();
		// WebGL errors (Phase 9, docs/FIRST_BOOT.md): browser-level context
		// loss/creation-failure events, independent of the module -- meaningful
		// even before/if it ever loads.
		Re3Boot.setupWebGLErrorCapture(els.canvas, log);

		// Input (Phase 5, docs/BROWSER_INPUT.md): none of this depends on the module
		// having loaded -- preventDefault, pointer lock, and the debug overlay all
		// operate on raw browser events and are useful even before/if the engine
		// starts. Focus-loss recovery is set up once the module instance exists
		// (it needs ccall) but only actually armed once main() is about to run --
		// see runEngineMain().
		Re3Input.setupPreventDefaults();
		Re3Input.setupPointerLock(els.canvas, els.pointerlockHint, log);
		Re3Input.setupDebugOverlay({
			summaryTable: els.inputSummaryTable,
			mouseTable: els.inputMouseTable,
			keysList: els.inputKeysList,
			gamepadInfo: els.inputGamepadInfo,
		});

		if (typeof createRe3Module !== "function") {
			showFatalError(
				"build/re3_wasm.js did not load",
				new Error("createRe3Module() is not defined. Build the WASM target first: " +
					"see docs/WASM_BUILD.md / docs/BROWSER_RUNTIME.md.")
			);
			return;
		}

		setStatus("loading", "loading WebAssembly module…");
		setLoadingTitle("Preparing GTA III");
		setLoadingStage("WASM");
		setLoadingStatus("Fetching and compiling re3_wasm.wasm…");
		setLoadingDetail("Loading the browser game engine.");
		setProgress(null);

		/** @type {any} */
		let instance;
		try {
			instance = await createRe3Module({
				canvas: els.canvas,
				print: (text) => log(text, "stdout"),
				printErr: (text) => log(text, "stderr"),
				setStatus: (text) => {
					if (text) setLoadingStatus(text);
				},
				monitorRunDependencies: (left) => {
					if (left === 0) {
						setProgress(1);
					} else {
						setLoadingStatus(`Resolving ${left} run dependenc${left === 1 ? "y" : "ies"}…`);
						setProgress(null);
					}
				},
				onAbort: (reason) => {
					// Emscripten calls this on a fatal internal abort (assert, OOM, an
					// unimplemented native API call, etc). This is exactly the "engine
					// cannot initialize because native APIs are still present" case
					// called out in the Phase 2 task list -- we surface it, we don't
					// try to paper over it.
					showFatalError("WebAssembly runtime aborted", reason);
				},
			});
		} catch (err) {
			showFatalError("Failed to instantiate the WebAssembly module", err);
			return;
		}

		window.re3Module = instance; // for manual poking from devtools
		setDiag("WASM loaded", "true", true);
		hideLoadingOverlay();
		log("[module] instantiated successfully", "info");
		bootProgress.setStage(1); // [1] WASM loaded

		const focusRecovery = Re3Input.setupFocusLossRecovery(instance, log);
		Re3Input.setupMenuAwarePointerLockRelease(instance, els.canvas);

		// Frame timing (Phase 7, docs/BROWSER_MAIN_LOOP.md): the polling panel is
		// harmless to start immediately (it just reads 0s until the engine reaches
		// GS_PLAYING_GAME and Idle() starts rendering), but tab-throttling handling
		// touches CTimer directly, so it's armed the same way and at the same point
		// as focus-loss recovery -- only once main() is about to run.
		Re3Perf.setupFrameTimingPanel(instance, els.perfTable, els.fpsBadge);
		const tabThrottling = Re3Perf.setupTabThrottling(instance, log);

		// Boot progress (Phase 9, docs/FIRST_BOOT.md): stages 3-7 are C++-side and
		// only mean anything once the engine is actually running, but polling can
		// start immediately -- it just reads "1" until then.
		bootProgress.pollFromEngine(instance);
		Re3Boot.setupDebugMode(els.debugModeCheckbox, instance, log);
		setupRuntimeStateDiagnostics(instance);
		setupSaveDiagnosticsPanel();

		const mountPoint = getAssetRoot();
		try {
			await setupAssetPanel(instance, mountPoint);
		} catch (err) {
			log(`[assets] asset panel setup failed: ${err}`, "stderr");
			els.assetsOverlay.classList.remove("hidden"); // still let the user hit Start
		}

		setStatus("ok", "Ready — persistent GTA III asset cache initialized.");
		els.startEngineBtn.addEventListener("click", () => {
			runEngineMain(instance, mountPoint, focusRecovery, tabThrottling)
				.catch((err) => {
					engineStartRequested = false;
					els.startEngineBtn.disabled = false;
					els.startEngineBtn.textContent = "Play GTA III";
					showFatalError("Engine startup failed unexpectedly", err);
				});
		});

		window.dispatchEvent(new CustomEvent("gta3-launcher-ready"));
	}

	window.addEventListener("error", (event) => {
		// Catches load-time script errors too (e.g. build/re3_wasm.js missing/corrupt),
		// not just errors thrown from within this file.
		if (els.errorBanner.classList.contains("visible")) return; // already reported
		showFatalError("Unhandled script error", event.error || event.message);
	});
	window.addEventListener("unhandledrejection", (event) => {
		if (els.errorBanner.classList.contains("visible")) return;
		showFatalError("Unhandled promise rejection", event.reason);
	});

	main().catch((err) => showFatalError("Launcher failed unexpectedly", err));
})();
