// DUSK HARBOR: a 36 x 32 m harbor freight yard at dusk, three lanes from the
// south spawn to the Pier bombsite in the north. Everything is boxes: the map is
// a list of boxes, each one a collider and a surface a bullet stops on.
// Waypoints form the graph the bots patrol and path over.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [width, height, depth, x, y, z, material]
const BOXES = [
  // Floor and outer walls (5 m high, open to the dusk sky).
  [36.6, 0.4, 32.6, 0, -0.2, 0, 'ground'],
  [36.6, 5, 0.6, 0, 2.5, -16.3, 'wall'],
  [36.6, 5, 0.6, 0, 2.5, 16.3, 'wall'],
  [0.6, 5, 32.6, -18.3, 2.5, 0, 'wall'],
  [0.6, 5, 32.6, 18.3, 2.5, 0, 'wall'],
  // West lane — Crane Alley: containers along the west wall, one corner wall.
  [2.6, 2.6, 6, -15.5, 1.3, -6, 'containerTeal'],
  [2.6, 2.6, 4, -15.5, 1.3, 4, 'containerRust'],
  [1.2, 1.2, 1.2, -11, 0.6, -10, 'crate'],
  [1.2, 1.2, 1.2, -12, 0.6, 2, 'crate'],
  [0.6, 3, 6, -9, 1.5, -8, 'wall'],
  [2.4, 0.9, 1.2, -13, 0.45, 10, 'crate'],
  // Mid lane — the Yard: the central container stack and low cover.
  [5, 2.6, 2.6, 0, 1.3, -2, 'containerTeal'],
  [4, 2.4, 2.4, 0.5, 3.8, -2, 'containerRust'],
  [1.2, 1.1, 1.2, -3, 0.55, 4, 'crate'],
  [1.2, 1.1, 1.2, 3.5, 0.55, 6, 'crate'],
  [2.2, 0.9, 1.2, -4.5, 0.45, -7, 'crate'],
  [4, 1.1, 0.6, 4, 0.55, -9, 'wall'],
  // East lane — Warehouse Row: the warehouse block and a corner wall.
  [6, 4, 8, 14, 2, 0, 'wall'],
  [0.6, 3, 8, 9, 1.5, -4, 'wall'],
  [2.6, 2.6, 5, 15, 1.3, -10, 'containerTeal'],
  [1.2, 1.2, 1.2, 11, 0.6, 8, 'crate'],
  [1.2, 1.2, 1.2, 12.5, 0.6, -12, 'crate'],
  // The Pier: a low platform at the north end, the bombsite.
  [8, 0.3, 6, 0, 0.15, -13, 'containerRust'],
  [8.6, 0.12, 0.5, 0, 0.36, -10.2, 'lamp'],
  [0.5, 0.12, 6.5, -4.1, 0.36, -13, 'lamp'],
  [0.5, 0.12, 6.5, 4.1, 0.36, -13, 'lamp'],
];

// Waypoint graph: [x, z] nodes the bots walk between. Edges are index pairs.
const NODES = [
  [0, -13], [-8, -12], [8, -12], // 0-2 site
  [0, -7], [0, 0], [0, 8], // 3-5 mid
  [-12, -4], [-12, 6], [-12, -11], // 6-8 west
  [12, -4], [12, 6], [12, -11], // 9-11 east
  [-6, 0], [6, 0], // 12-13 connectors
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 8], [2, 11], [1, 3], [2, 3],
  [3, 4], [4, 5], [4, 12], [4, 13], [4, 6], [4, 9],
  [6, 7], [7, 5], [6, 8], [9, 10], [10, 5], [9, 11],
  [12, 6], [12, 7], [13, 9], [13, 10], [12, 13], [3, 6], [3, 9],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'lamp' ? 0.4 : 0.92,
      metalness: name === 'containerTeal' || name === 'containerRust' ? 0.3 : 0.05,
      emissive: name === 'lamp' ? new THREE.Color(PALETTE.lamp) : new THREE.Color(0x000000),
      emissiveIntensity: name === 'lamp' ? 0.9 : 0,
    });
  }

  const colliders = [];
  const shootables = [];
  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }
  for (const spec of BOXES) box(...spec);

  // The Pier bombsite reads at a glance: a painted ring on the platform and
  // a thin pillar of warm light over it, so the objective is visible from
  // every lane mouth.
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.32, -13);
  group.add(ring);
  const pillarMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.07,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 5, 24, 1, true), pillarMat);
  pillar.position.set(0, 2.8, -13);
  group.add(pillar);

  // Crane silhouettes outside the walls, so the yard reads as a harbor at a glance.
  const craneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#12141f') });
  for (const [x, z, h] of [[-26, -10, 16], [26, 6, 19], [-24, 12, 13]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), craneMat);
    leg.position.set(x, h / 2, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 0.8), craneMat);
    arm.position.set(x + 5, h - 1, z);
    group.add(leg, arm);
  }

  // Light: a low warm sun from the west, a cold indigo fill, sodium lamps at the
  // lane mouths and one over the Pier.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#3a4066'), new THREE.Color('#1a1410'), 0.9));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ff9a3c'), 1.7);
  sun.position.set(-22, 10, 14);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6a9a'), 0.4);
  fill.position.set(10, 12, -14);
  scene.add(fill);
  const lampLights = [];
  for (const [x, y, z] of [[-12, 4.5, 0], [12, 4.5, 0], [0, 5, -13]]) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 26, 20, 1.8);
    lamp.position.set(x, y, z);
    scene.add(lamp);
    lampLights.push(lamp);
  }

  const waypoints = NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const adjacency = waypoints.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    site: { center: new THREE.Vector3(0, 0, -13), radius: 4 },
    spawnPlayer: new THREE.Vector3(0, 0, 14),
    spawnBots: [
      new THREE.Vector3(-6, 0, -12),
      new THREE.Vector3(6, 0, -12),
      new THREE.Vector3(-12, 0, -8),
      new THREE.Vector3(12, 0, -8),
    ],
    waypoints,
    adjacency,
    // Breadth-first path over the waypoint graph, as a list of positions.
    findPath(from, to) {
      let best = 0;
      let bestDist = Infinity;
      let goal = 0;
      let goalDist = Infinity;
      for (let i = 0; i < waypoints.length; i += 1) {
        const d0 = waypoints[i].distanceToSquared(from);
        const d1 = waypoints[i].distanceToSquared(to);
        if (d0 < bestDist) { bestDist = d0; best = i; }
        if (d1 < goalDist) { goalDist = d1; goal = i; }
      }
      const prev = new Array(waypoints.length).fill(-1);
      const queue = [best];
      prev[best] = best;
      while (queue.length) {
        const cur = queue.shift();
        if (cur === goal) break;
        for (const next of adjacency[cur]) {
          if (prev[next] === -1) {
            prev[next] = cur;
            queue.push(next);
          }
        }
      }
      const path = [];
      let cur = goal;
      while (cur !== best && prev[cur] !== -1) {
        path.unshift(waypoints[cur].clone());
        cur = prev[cur];
      }
      path.push(to.clone());
      return path;
    },
  };
}
