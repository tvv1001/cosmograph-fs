use wasm_bindgen::prelude::*;
use petgraph::graph::{NodeIndex, UnGraph};
use petgraph::visit::EdgeRef;
use fjadra::Simulation;
use fjadra::force::{ManyBody, Link, Center, SimulationBuilder};

const DEFAULT_INITIAL_SPREAD: f64 = 100.0;
const DEFAULT_LINK_DISTANCE: f64 = 30.0;
const DEFAULT_CHARGE_STRENGTH: f64 = -30.0;

fn positive_or_default(value: f64, default: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

fn finite_or_default(value: f64, default: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

#[wasm_bindgen]
pub struct GraphSimulation {
    graph: UnGraph<(), ()>,
    simulation: Option<Simulation>,
    // Store initial positions to build the simulation
    initial_positions: Vec<[f64; 2]>,
}

#[wasm_bindgen]
impl GraphSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            graph: UnGraph::new_undirected(),
            simulation: None,
            initial_positions: Vec::new(),
        }
    }

    pub fn add_nodes(&mut self, count: usize, initial_spread: f64) {
        let spread = positive_or_default(initial_spread, DEFAULT_INITIAL_SPREAD);

        for _ in 0..count {
            self.graph.add_node(());
            let x = (js_sys::Math::random() - 0.5) * spread;
            let y = (js_sys::Math::random() - 0.5) * spread;
            self.initial_positions.push([x, y]);
        }
    }

    pub fn add_edge(&mut self, source_idx: usize, target_idx: usize) {
        let source = NodeIndex::new(source_idx);
        let target = NodeIndex::new(target_idx);
        self.graph.add_edge(source, target, ());
    }

    pub fn build(&mut self, link_distance: f64, charge_strength: f64) {
        let resolved_link_distance = positive_or_default(link_distance, DEFAULT_LINK_DISTANCE);
        let resolved_charge_strength = finite_or_default(charge_strength, DEFAULT_CHARGE_STRENGTH);
        let edges: Vec<(usize, usize)> = self.graph
            .edge_references()
            .map(|e| (e.source().index(), e.target().index()))
            .collect();

        let mut simulation = SimulationBuilder::new()
            .with_alpha_min(0.02)
            .with_velocity_decay(0.72)
            .build(self.initial_positions.clone());

        simulation = simulation.add_force("charge", ManyBody::new().strength(resolved_charge_strength))
            .add_force("center", Center::new().x(0.0).y(0.0));

        if !edges.is_empty() {
            simulation = simulation.add_force("link", Link::new(edges).distance(resolved_link_distance));
        }

        self.simulation = Some(simulation);
    }

    pub fn tick(&mut self, iterations: usize) {
        if let Some(ref mut sim) = self.simulation {
            sim.tick(iterations);
        }
    }

    pub fn is_finished(&self) -> bool {
        if let Some(ref sim) = self.simulation {
            sim.is_finished()
        } else {
            true
        }
    }

    pub fn step(&mut self) {
        if let Some(ref mut sim) = self.simulation {
            sim.step();
        }
    }

    pub fn get_positions(&self) -> Vec<f32> {
        if let Some(ref sim) = self.simulation {
            sim.positions()
                .flat_map(|p| [p[0] as f32, p[1] as f32])
                .collect()
        } else {
            self.initial_positions
                .iter()
                .flat_map(|p| [p[0] as f32, p[1] as f32])
                .collect()
        }
    }
}
