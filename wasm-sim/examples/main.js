import init, { GraphSimulation } from '../pkg/wasm_sim.js';

async function run() {
	await init();

	const canvas = document.getElementById('graph-canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('2D canvas context is unavailable.');
	}

	const sim = new GraphSimulation();
	const nodeCount = 50;

	sim.add_nodes(nodeCount, 180.0);

	for (let index = 0; index < nodeCount - 1; index += 1) {
		sim.add_edge(index, index + 1);
		if (index + 3 < nodeCount && index % 4 === 0) {
			sim.add_edge(index, index + 3);
		}
	}

	sim.build(60.0, -42.0);

	const edges = sim.get_edges();
	const devicePixelRatio = window.devicePixelRatio || 1;

	function resizeCanvas() {
		const displayWidth = canvas.clientWidth || canvas.width;
		const displayHeight = Math.round(displayWidth * (canvas.height / canvas.width));
		canvas.width = Math.round(displayWidth * devicePixelRatio);
		canvas.height = Math.round(displayHeight * devicePixelRatio);
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
	}

	function drawFrame(positions) {
		const displayWidth = canvas.width / devicePixelRatio;
		const displayHeight = canvas.height / devicePixelRatio;

		ctx.clearRect(0, 0, displayWidth, displayHeight);
		ctx.save();
		ctx.translate(displayWidth / 2, displayHeight / 2);

		ctx.strokeStyle = 'rgba(125, 211, 252, 0.4)';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		for (let index = 0; index < edges.length; index += 2) {
			const sourceIndex = edges[index] * 2;
			const targetIndex = edges[index + 1] * 2;
			ctx.moveTo(positions[sourceIndex], positions[sourceIndex + 1]);
			ctx.lineTo(positions[targetIndex], positions[targetIndex + 1]);
		}
		ctx.stroke();

		for (let index = 0; index < positions.length; index += 2) {
			const x = positions[index];
			const y = positions[index + 1];

			ctx.beginPath();
			ctx.fillStyle = '#38bdf8';
			ctx.arc(x, y, 4.5, 0, Math.PI * 2);
			ctx.fill();

			ctx.beginPath();
			ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
			ctx.arc(x - 1.2, y - 1.2, 1.4, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.restore();
	}

	function animate() {
		if (!sim.is_finished()) {
			sim.step();
		}

		const positions = sim.get_positions();
		drawFrame(positions);
		window.requestAnimationFrame(animate);
	}

	window.addEventListener('resize', resizeCanvas);
	resizeCanvas();
	animate();
}

run().catch((error) => {
	console.error('Failed to start wasm-sim demo:', error);
});
