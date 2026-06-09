import * as THREE from 'three';

// Vertices for a Truncated Octahedron (permutations of 0, ±1, ±2)
const verticesOfTruncatedOctahedron = [
    0, 1, 2,   0, 1,-2,   0,-1, 2,   0,-1,-2, // 0-3
    1, 0, 2,   1, 0,-2,  -1, 0, 2,  -1, 0,-2, // 4-7
    1, 2, 0,   1,-2, 0,  -1, 2, 0,  -1,-2, 0, // 8-11
    2, 0, 1,   2, 0,-1,  -2, 0, 1,  -2, 0,-1, // 12-15
    2, 1, 0,   2,-1, 0,  -2, 1, 0,  -2,-1, 0, // 16-19
    0, 2, 1,   0, 2,-1,   0,-2, 1,   0,-2,-1  // 20-23
];

// Triangulated faces (6 squares, 8 hexagons)
const indicesOfFaces = [
    // 6 Squares (2 triangles each)
    4, 0, 6,   4, 6, 2,     // +Z
    5, 3, 7,   5, 7, 1,     // -Z
    16, 13, 17,  16, 17, 12, // +X
    18, 14, 19,  18, 19, 15, // -X
    8, 20, 10,  8, 10, 21,   // +Y
    9, 23, 11,  9, 11, 22,   // -Y
    
    // 8 Hexagons (4 triangles each, fanning from first vertex)
    4, 0, 20,  4, 20, 8,  4, 8, 16,  4, 16, 12, // +++
    0, 6, 14,  0, 14, 18, 0, 18, 10, 0, 10, 20, // -++
    6, 2, 22,  6, 22, 11, 6, 11, 19, 6, 19, 14, // --+
    2, 4, 12,  2, 12, 17, 2, 17, 9,  2, 9, 22,  // +-+
    
    5, 13, 16, 5, 16, 8,  5, 8, 21,  5, 21, 1,  // ++-
    1, 21, 10, 1, 10, 18, 1, 18, 15, 1, 15, 7,  // -+-
    7, 15, 19, 7, 19, 11, 7, 11, 23, 7, 23, 3,  // ---
    3, 23, 9,  3, 9, 17,  3, 17, 13, 3, 13, 5   // +--
];

export function createFirmGeometry(size: number): THREE.BufferGeometry {
    // Octahedron creates a perfect, sealed 3D diamond/crystal shape with no holes.
    return new THREE.OctahedronGeometry(size * 1.5, 0);
}

export function createPersonGeometry(size: number): THREE.BufferGeometry {
    // Icosahedron with detail 1 creates a shape visually similar to a Deltoidal Icositetrahedron
    // (a semi-spherical crystal with triangular/kite-like faces)
    return new THREE.IcosahedronGeometry(size * 1.2, 1);
}
