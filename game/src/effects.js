// Visual effects, all pooled: nothing is created or destroyed while the game
// runs. Tracers are short-lived lines, impacts are small tetra bursts, the
// explosion is one expanding sphere plus a light, smoke is three growing
// translucent spheres. Every effect is fetched from a pool and returned to it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 14;
const SPARK_COUNT = 10;
const SMOKE_COUNT = 4;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.tracer), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparks = [];
  const sparkGeo = new THREE.TetrahedronGeometry(0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a') });
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }

  const smokes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < SMOKE_COUNT; i += 1) {
    const mesh = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.smoke), transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, maxLife: 1 });
  }

  const flash = new THREE.PointLight(new THREE.Color('#ffd27a'), 0, 9, 1.6);
  scene.add(flash);
  let flashLife = 0;

  const boomLight = new THREE.PointLight(new THREE.Color('#ff7a3c'), 0, 22, 1.4);
  scene.add(boomLight);
  const boomGeo = new THREE.SphereGeometry(1, 16, 12);
  const boom = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff9a3c'), transparent: true, opacity: 0, depthWrite: false,
  }));
  boom.visible = false;
  scene.add(boom);
  let boomLife = 0;

  function tracer(from, to) {
    let slot = tracers.find((t) => t.life <= 0);
    if (!slot) slot = tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.material.opacity = 0.9;
    slot.life = 0.09;
  }

  function impact(point, normal) {
    let n = 0;
    for (const spark of sparks) {
      if (spark.life > 0 || n >= 3) continue;
      n += 1;
      spark.mesh.position.copy(point);
      spark.mesh.visible = true;
      spark.vel.set(
        normal.x + (Math.random() - 0.5) * 2.4,
        Math.abs(normal.y) + Math.random() * 1.6 + 0.4,
        normal.z + (Math.random() - 0.5) * 2.4,
      );
      spark.life = 0.32;
    }
  }

  function muzzle(point) {
    flash.position.copy(point);
    flash.intensity = 14;
    flashLife = 0.05;
  }

  function explosion(point) {
    boom.position.copy(point);
    boom.visible = true;
    boom.scale.setScalar(0.4);
    boom.material.opacity = 0.85;
    boomLight.position.copy(point);
    boomLight.intensity = 60;
    boomLife = 0.7;
  }

  function smoke(point) {
    for (const puff of smokes) {
      if (puff.life > 0) continue;
      puff.mesh.position.set(point.x + (Math.random() - 0.5), point.y + 0.6, point.z + (Math.random() - 0.5));
      puff.mesh.visible = true;
      puff.mesh.scale.setScalar(0.4);
      puff.mesh.material.opacity = 0.5;
      puff.life = 1;
      puff.maxLife = 2.2 + Math.random();
      break;
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.material.opacity = 0;
      else t.line.material.opacity = Math.min(0.9, t.life / 0.09 * 0.9);
    }
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.mesh.position.addScaledVector(spark.vel, dt);
      spark.vel.y -= 9 * dt;
      if (spark.life <= 0) spark.mesh.visible = false;
    }
    for (const puff of smokes) {
      if (puff.life <= 0) continue;
      puff.life -= dt / puff.maxLife;
      puff.mesh.scale.addScalar(dt * 1.1);
      puff.mesh.material.opacity = Math.max(0, puff.life * 0.5);
      if (puff.life <= 0) puff.mesh.visible = false;
    }
    if (flashLife > 0) {
      flashLife -= dt;
      if (flashLife <= 0) flash.intensity = 0;
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const k = 1 - boomLife / 0.7;
      boom.scale.setScalar(0.4 + k * 6.5);
      boom.material.opacity = Math.max(0, 0.85 * (1 - k));
      boomLight.intensity = Math.max(0, 60 * (1 - k));
      if (boomLife <= 0) boom.visible = false;
    }
  }

  return { tracer, impact, muzzle, explosion, smoke, step };
}
