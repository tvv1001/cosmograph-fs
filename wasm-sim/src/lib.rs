use wasm_bindgen::prelude::*;
use petgraph::graph::{NodeIndex, UnGraph};
use petgraph::visit::EdgeRef;
use fjadra::Simulation;
use fjadra::force::{ManyBody, Link, Center, SimulationBuilder};

const DEFAULT_INITIAL_SPREAD: f64 = 100.0;
const DEFAULT_LINK_DISTANCE: f64 = 30.0;
const DEFAULT_CHARGE_STRENGTH: f64 = -30.0;
const DEFAULT_MIN_NODE_SEPARATION: f64 = 18.0;
const DEFAULT_NODE_SEPARATION_PADDING: f64 = 4.0;
const OVERLAP_RELAXATION_PASSES: usize = 8;

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
    graph: UnGraph<(), f64>,
    simulation: Option<Simulation>,
    // Store initial positions to build the simulation
    initial_positions: Vec<[f64; 2]>,
    // Reused flat buffer for zero-copy position reads from JavaScript
    position_buffer: Vec<f32>,
    min_node_separation: f64,
}

impl Default for GraphSimulation {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl GraphSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            graph: UnGraph::new_undirected(),
            simulation: None,
            initial_positions: Vec::new(),
            position_buffer: Vec::new(),
            min_node_separation: DEFAULT_MIN_NODE_SEPARATION + DEFAULT_NODE_SEPARATION_PADDING,
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
        self.add_weighted_edge(source_idx, target_idx, 1.0);
    }

    pub fn add_weighted_edge(&mut self, source_idx: usize, target_idx: usize, weight: f64) {
        let source = NodeIndex::new(source_idx);
        let target = NodeIndex::new(target_idx);
        let resolved_weight = positive_or_default(weight, 1.0);

        if let Some(edge_index) = self.graph.find_edge(source, target) {
            if let Some(existing_weight) = self.graph.edge_weight_mut(edge_index) {
                *existing_weight = resolved_weight;
            }
            return;
        }

        self.graph.add_edge(source, target, resolved_weight);
    }

    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    // Expose edge pairs to JavaScript for rendering lines.
    pub fn get_edges(&self) -> Vec<u32> {
        self.graph
            .edge_references()
            .flat_map(|e| [e.source().index() as u32, e.target().index() as u32])
            .collect()
    }

    pub fn build(&mut self, link_distance: f64, charge_strength: f64) {
        let resolved_link_distance = positive_or_default(link_distance, DEFAULT_LINK_DISTANCE);
        let resolved_charge_strength = finite_or_default(charge_strength, DEFAULT_CHARGE_STRENGTH);
        self.min_node_separation = resolved_link_distance.max(DEFAULT_MIN_NODE_SEPARATION) * 0.55 + DEFAULT_NODE_SEPARATION_PADDING;
        let weighted_degrees = collect_weighted_degrees(&self.graph);
        self.initial_positions = seed_force_directed_positions(&self.graph, &weighted_degrees, resolved_link_distance, self.min_node_separation);

        let edges = expand_weighted_edges(&self.graph);
        let charge_multiplier = derive_charge_multiplier(&weighted_degrees);

        let mut simulation = SimulationBuilder::new()
            .with_alpha_min(0.02)
            .with_velocity_decay(0.72)
            .build(self.initial_positions.clone());

        simulation = simulation.add_force("charge", ManyBody::new().strength(resolved_charge_strength * charge_multiplier))
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
        let mut positions = self.collect_positions();
        resolve_overlaps(&mut positions, self.min_node_separation);

        positions
            .into_iter()
            .flat_map(|p| [p[0] as f32, p[1] as f32])
            .collect()
    }

    // Write positions into a persistent flat buffer and expose a raw pointer
    // so JavaScript can create a Float32Array view directly over WASM memory.
    pub fn get_positions_ptr(&mut self) -> *const f32 {
        let expected_len = self.graph.node_count().saturating_mul(2);
        if self.position_buffer.capacity() < expected_len {
            self.position_buffer
                .reserve(expected_len - self.position_buffer.capacity());
        }

        self.position_buffer.clear();

        let mut positions = self.collect_positions();
        resolve_overlaps(&mut positions, self.min_node_separation);

        for position in positions {
            self.position_buffer.push(position[0] as f32);
            self.position_buffer.push(position[1] as f32);
        }

        self.position_buffer.as_ptr()
    }
}

impl GraphSimulation {
    fn collect_positions(&self) -> Vec<[f64; 2]> {
        if let Some(ref sim) = self.simulation {
            sim.positions().map(|p| [p[0], p[1]]).collect()
        } else {
            self.initial_positions.clone()
        }
    }
}

fn collect_weighted_degrees(graph: &UnGraph<(), f64>) -> Vec<f64> {
    let mut weighted_degrees = vec![0.0; graph.node_count()];

    for edge in graph.edge_references() {
        let weight = positive_or_default(*edge.weight(), 1.0);
        weighted_degrees[edge.source().index()] += weight;
        weighted_degrees[edge.target().index()] += weight;
    }

    weighted_degrees
}

fn expand_weighted_edges(graph: &UnGraph<(), f64>) -> Vec<(usize, usize)> {
    graph
        .edge_references()
        .flat_map(|edge| {
            let source = edge.source().index();
            let target = edge.target().index();
            let repetitions = positive_or_default(*edge.weight(), 1.0).round().clamp(1.0, 8.0) as usize;
            std::iter::repeat_n((source, target), repetitions)
        })
        .collect()
}

fn derive_charge_multiplier(weighted_degrees: &[f64]) -> f64 {
    if weighted_degrees.is_empty() {
        return 1.0;
    }

    let average_degree = weighted_degrees.iter().sum::<f64>() / weighted_degrees.len() as f64;
    (1.0 + average_degree.sqrt() * 0.08).clamp(1.0, 1.7)
}

fn seed_force_directed_positions(
    graph: &UnGraph<(), f64>,
    weighted_degrees: &[f64],
    link_distance: f64,
    min_node_separation: f64,
) -> Vec<[f64; 2]> {
    let node_count = graph.node_count();
    if node_count == 0 {
        return Vec::new();
    }

    let components = collect_connected_components(graph);
    let component_count = components.len().max(1);
    let mut positions = vec![[0.0, 0.0]; node_count];
    let mut placed = vec![false; node_count];
    let component_spacing = link_distance * 4.0 + min_node_separation * 5.0;
    let golden_angle = std::f64::consts::PI * (3.0 - 5.0_f64.sqrt());

    for (component_index, component_nodes) in components.iter().enumerate() {
        let component_center = if component_count == 1 {
            [0.0, 0.0]
        } else {
            let angle = component_index as f64 * golden_angle;
            let radius = component_spacing * (1.0 + component_index as f64 * 0.22);
            [angle.cos() * radius, angle.sin() * radius]
        };

        let mut ordered_nodes = component_nodes.clone();
        ordered_nodes.sort_by(|left, right| weighted_degrees[*right].partial_cmp(&weighted_degrees[*left]).unwrap_or(std::cmp::Ordering::Equal));

        let hub_index = ordered_nodes[0];
        positions[hub_index] = component_center;
        placed[hub_index] = true;

        for (local_index, node_index) in ordered_nodes.iter().enumerate().skip(1) {
            let anchor_index = graph
                .edges(NodeIndex::new(*node_index))
                .filter_map(|edge| {
                    let source = edge.source().index();
                    let target = edge.target().index();
                    let neighbor = if source == *node_index { target } else { source };
                    placed[neighbor].then_some((neighbor, positive_or_default(*edge.weight(), 1.0)))
                })
                .max_by(|left, right| left.1.partial_cmp(&right.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(neighbor, _)| neighbor)
                .unwrap_or(hub_index);

            let ring_index = (local_index - 1) / 6;
            let slot_index = (local_index - 1) % 6;
            let remaining_in_component = ordered_nodes.len().saturating_sub(1 + ring_index * 6);
            let ring_size = remaining_in_component.clamp(1, 6);
            let base_angle = stable_angle_seed(*node_index, anchor_index);
            let angle = base_angle + (slot_index as f64 / ring_size as f64) * std::f64::consts::TAU + ring_index as f64 * 0.27;
            let anchor_weight = graph
                .find_edge(NodeIndex::new(*node_index), NodeIndex::new(anchor_index))
                .and_then(|edge_index| graph.edge_weight(edge_index).copied())
                .map(|weight| positive_or_default(weight, 1.0))
                .unwrap_or(1.0);
            let radial_distance = min_node_separation * 1.35
                + link_distance * (1.0 + ring_index as f64 * 0.78)
                + (weighted_degrees[anchor_index].sqrt() * 2.4)
                - anchor_weight * 3.0;
            let radial_distance = radial_distance.max(min_node_separation * 1.1);
            let anchor_position = positions[anchor_index];

            positions[*node_index] = [
                anchor_position[0] + angle.cos() * radial_distance,
                anchor_position[1] + angle.sin() * radial_distance,
            ];
            placed[*node_index] = true;
        }
    }

    resolve_overlaps(&mut positions, min_node_separation);
    positions
}

fn collect_connected_components(graph: &UnGraph<(), f64>) -> Vec<Vec<usize>> {
    let mut visited = vec![false; graph.node_count()];
    let mut components = Vec::new();

    for node_index in graph.node_indices() {
        let start = node_index.index();
        if visited[start] {
            continue;
        }

        let mut stack = vec![start];
        let mut component = Vec::new();
        visited[start] = true;

        while let Some(current) = stack.pop() {
            component.push(current);

            for edge in graph.edges(NodeIndex::new(current)) {
                let source = edge.source().index();
                let target = edge.target().index();
                let neighbor = if source == current { target } else { source };

                if !visited[neighbor] {
                    visited[neighbor] = true;
                    stack.push(neighbor);
                }
            }
        }

        components.push(component);
    }

    components.sort_by_key(|component| std::cmp::Reverse(component.len()));
    components
}

fn stable_angle_seed(node_index: usize, anchor_index: usize) -> f64 {
    let hash = (node_index as u64)
        .wrapping_mul(1_103_515_245)
        .wrapping_add((anchor_index as u64).wrapping_mul(12_345));
    ((hash % 360) as f64).to_radians()
}

fn resolve_overlaps(positions: &mut [[f64; 2]], min_separation: f64) {
    if positions.len() < 2 {
        return;
    }

    let min_distance = positive_or_default(min_separation, DEFAULT_MIN_NODE_SEPARATION);
    let min_distance_sq = min_distance * min_distance;

    for _ in 0..OVERLAP_RELAXATION_PASSES {
        let mut changed = false;

        for left_index in 0..positions.len() {
            for right_index in (left_index + 1)..positions.len() {
                let dx = positions[right_index][0] - positions[left_index][0];
                let dy = positions[right_index][1] - positions[left_index][1];
                let distance_sq = dx * dx + dy * dy;

                if distance_sq >= min_distance_sq {
                    continue;
                }

                let (unit_x, unit_y, distance) = if distance_sq > f64::EPSILON {
                    let distance = distance_sq.sqrt();
                    (dx / distance, dy / distance, distance)
                } else {
                    let angle = ((left_index * 97 + right_index * 57) as f64).to_radians();
                    (angle.cos(), angle.sin(), 0.0)
                };

                let push_distance = (min_distance - distance).max(0.0) * 0.5;
                positions[left_index][0] -= unit_x * push_distance;
                positions[left_index][1] -= unit_y * push_distance;
                positions[right_index][0] += unit_x * push_distance;
                positions[right_index][1] += unit_y * push_distance;
                changed = true;
            }
        }

        if !changed {
            break;
        }
    }

    let count = positions.len() as f64;
    let centroid_x = positions.iter().map(|position| position[0]).sum::<f64>() / count;
    let centroid_y = positions.iter().map(|position| position[1]).sum::<f64>() / count;

    for position in positions.iter_mut() {
        position[0] -= centroid_x;
        position[1] -= centroid_y;
    }
}
