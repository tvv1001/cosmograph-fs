let wasmSim: any = null;
let loaded = false;

export async function loadWasmSim(): Promise<any | null> {
	if (loaded) return wasmSim;
	loaded = true;

	// Try a few likely locations for the generated wasm-bindgen package.
	// Prefer resolving a bare package name first (if published or linked into node_modules).
	const candidates = ['wasm-sim', '/wasm-sim/pkg/wasm_sim.js', '/wasm-sim/pkg/wasm-sim.js', '/wasm-sim/wasm_sim.js', '/wasm-sim/pkg/wasm_sim/index.js'];

	for (const candidate of candidates) {
		try {
			// If candidate looks like an absolute URL path, only attempt at runtime in the browser.
			let importPath: string | null = null;
			if (candidate.startsWith('/')) {
				if (typeof window === 'undefined') {
					// skip server-side attempts for paths served from the static server
					continue;
				}
				// Build the full URL at runtime to avoid bundler static analysis
				importPath = (window.location.origin ?? '') + candidate;
			} else {
				importPath = candidate;
			}

			if (!importPath) continue;

			// Dynamic import; for runtime URLs build above so the bundler won't try to statically resolve them
			// eslint-disable-next-line @typescript-eslint/no-var-requires, no-eval
			const mod = await import(/* webpackIgnore: true */ importPath);

			// Some wasm-pack outputs export an `init`/default function that must be called.
			if (mod && typeof mod.default === 'function') {
				try {
					// default(init) may accept the wasm URL or may auto-load — call without args
					await mod.default();
				} catch (e) {
					// ignore init failures; we may still have usable named exports
				}
			}

			// Prefer named exports if present
			wasmSim = mod;
			return wasmSim;
		} catch (e) {
			// continue to next candidate
		}
	}

	// Not available
	return null;
}

export async function setBounds(minX: number, minY: number, maxX: number, maxY: number): Promise<void> {
	const mod = await loadWasmSim();
	if (!mod) return;
	try {
		if (typeof mod.set_bounds === 'function') {
			mod.set_bounds(minX, minY, maxX, maxY);
		} else if (mod.default && typeof mod.default.set_bounds === 'function') {
			mod.default.set_bounds(minX, minY, maxX, maxY);
		}
	} catch (e) {
		// swallow errors
		// console.warn('wasm-sim set_bounds failed', e);
	}
}

export async function clearBounds(): Promise<void> {
	const mod = await loadWasmSim();
	if (!mod) return;
	try {
		if (typeof mod.clear_bounds === 'function') {
			mod.clear_bounds();
		} else if (mod.default && typeof mod.default.clear_bounds === 'function') {
			mod.default.clear_bounds();
		}
	} catch (e) {}
}

export async function setBoundaryMode(mode: number): Promise<void> {
	const mod = await loadWasmSim();
	if (!mod) return;
	try {
		if (typeof mod.set_boundary_mode === 'function') {
			mod.set_boundary_mode(mode);
		} else if (mod.default && typeof mod.default.set_boundary_mode === 'function') {
			mod.default.set_boundary_mode(mode);
		}
	} catch (e) {}
}
