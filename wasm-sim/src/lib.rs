use wasm_bindgen::prelude::*;
use fjadra::{Collide, ManyBody, Link, Center, SimulationBuilder, Node};

fn positive_or(v: f64, default: f64) -> f64 {
    if v.is_finite() && v > 0.0 { v } else { default }
}

fn finite_or(v: f64, default: f64) -> f64 {
    if v.is_finite() { v } else { default }
}

/// Force-directed graph simulation exposed to JavaScript via wasm-bindgen.
///
/// Workflow:
///   1. `new()` — create instance
///   2. `add_nodes(count, spread)` — add nodes with random initial positions
///   3. `add_edge(src, tgt)` — add undirected edges (by node index)
///   4. `set_radii(radii)` — set per-node collision radii (Float32Array, one per node)
///   5. `build(link_distance, charge_strength)` — compile forces and start simulation
///   6. `step()` each animation frame; read back positions with `get_positions()`
///   7. `reheat()` to re-energise after user interaction
#[wasm_bindgen]
pub struct GraphSimulation {
    initial_positions: Vec<[f64; 2]>,
    edges: Vec<(usize, usize)>,
    radii: Vec<f64>,
    simulation: Option<fjadra::Simulation>,
}

#[wasm_bindgen]
impl GraphSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            initial_positions: Vec::new(),
            edges: Vec::new(),
            radii: Vec::new(),
            simulation: None,
        }
    }

    /// Add `count` nodes placed randomly within `±initial_spread/2` on each axis.
    pub fn add_nodes(&mut self, count: usize, initial_spread: f64) {
        let spread = positive_or(initial_spread, 3000.0);
        for _ in 0..count {
            let x = (js_sys::Math::random() - 0.5) * spread;
            let y = (js_sys::Math::random() - 0.5) * spread;
            self.initial_positions.push([x, y]);
        }
    }

    /// Add nodes from a flat `[x0, y0, x1, y1, …]` Float32Array.
    /// Use this to seed node positions from an existing layout (e.g. after graph expansion)
    /// rather than random placement.
    pub fn add_nodes_with_positions(&mut self, positions: &[f32]) {
        for chunk in positions.chunks(2) {
            let x = chunk.first().copied().unwrap_or(0.0) as f64;
            let y = chunk.get(1).copied().unwrap_or(0.0) as f64;
            self.initial_positions.push([x, y]);
        }
    }

    /// Add an undirected edge. Both indices must be < the number of added nodes.
    pub fn add_edge(&mut self, source: usize, target: usize) {
        if source != target {
            self.edges.push((source, target));
        }
    }

    /// Set per-node collision radii (Float32Array, one radius per node in insertion order).
    /// Must be called before `build()`. Nodes without a radius entry default to 10 units.
    pub fn set_radii(&mut self, radii: &[f32]) {
        self.radii = radii.iter().map(|&r| r as f64).collect();
    }

    /// Compile forces and start the simulation. Call after `add_nodes`, `add_edge`, `set_radii`.
    ///
    /// * `link_distance`   — rest length of spring edges (layout units)
    /// * `charge_strength` — global repulsion (negative value, e.g. -250)
    pub fn build(&mut self, link_distance: f64, charge_strength: f64) {
        let link_dist   = positive_or(link_distance, 80.0);
        let charge      = finite_or(charge_strength, -120.0);

        let nodes: Vec<Node> = self.initial_positions.iter()
            .map(|&[x, y]| Node::default().position(x, y))
            .collect();

        let edges = self.edges.clone();
        let radii = self.radii.clone();

        let mut sim = SimulationBuilder::default()
            .with_alpha_min(0.001)
            .with_velocity_decay(0.45)
            .build(nodes)
            .add_force("charge", ManyBody::new().strength(charge))
            .add_force("center", Center::new().x(0.0).y(0.0))
            .add_force(
                "collide",
                // 2 px padding gap so touching nodes never visually overlap
                Collide::new()
                    .radius(move |i| radii.get(i).copied().unwrap_or(10.0) + 2.0)
                    .iterations(4),
            );

        if !edges.is_empty() {
            sim = sim.add_force("link", Link::new(edges).distance(link_dist));
        }

        self.simulation = Some(sim);
    }

    /// Advance the simulation by one step. Call once per animation frame.
    pub fn step(&mut self) {
        if let Some(ref mut sim) = self.simulation {
            sim.step();
        }
    }

    /// Advance by `n` steps at once (useful for warmup before first render).
    pub fn tick(&mut self, n: usize) {
        if let Some(ref mut sim) = self.simulation {
            sim.tick(n);
        }
    }

    /// Returns `true` once the simulation has cooled below alpha_min.
    pub fn is_finished(&self) -> bool {
        self.simulation.as_ref().map_or(true, |s| s.is_finished())
    }

    /// Re-energise the simulation (e.g. when the user clicks "Refresh").
    pub fn reheat(&mut self) {
        if let Some(ref mut sim) = self.simulation {
            sim.set_alpha(0.5);
        }
    }

    /// Returns a `Float32Array` of `[x0, y0, x1, y1, …]` for every node.
    /// More efficient than returning a `Vec<f32>` — avoids a JS-heap copy.
    pub fn get_positions(&self) -> js_sys::Float32Array {
        let data: Vec<f32> = match &self.simulation {
            Some(sim) => sim.positions()
                .flat_map(|[x, y]| [x as f32, y as f32])
                .collect(),
            None => self.initial_positions.iter()
                .flat_map(|&[x, y]| [x as f32, y as f32])
                .collect(),
        };
        let arr = js_sys::Float32Array::new_with_length(data.len() as u32);
        arr.copy_from(&data);
        arr
    }
}

impl Default for GraphSimulation {
    fn default() -> Self {
        Self::new()
    }
}

