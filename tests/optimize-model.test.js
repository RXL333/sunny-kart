import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeModel } from '../src/optimize-model.js';

for (const filename of ['kart.glb', 'kart-rabbit.glb', 'kart-panda.glb']) {
  test(`model batching preserves ${filename} bounds, four wheel pivots, and paint material`, async () => {
    const buffer = await fs.readFile(new URL(`../public/models/${filename}`, import.meta.url));
    const model = (await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')).scene;
    const sourceBounds = new THREE.Box3().setFromObject(model);
    const sourceWheels = [];
    model.traverse(object => { if (/^Wheel(?:Front|Rear)[LR]$/.test(object.name)) sourceWheels.push(object); });
    const output = optimizeModel(model);
    const bounds = new THREE.Box3().setFromObject(output);
    const error = Math.max(...['min', 'max'].flatMap(key => ['x', 'y', 'z'].map(axis => Math.abs(bounds[key][axis] - sourceBounds[key][axis]))));
    assert.ok(error < 1e-5, `Bounds changed by ${error}`);
    assert.ok(output.userData.optimization.afterMeshes <= 20);
    assert.equal(sourceWheels.length, 4);
    for (const source of sourceWheels) {
      const wheel = output.getObjectByName(source.name);
      assert.ok(wheel?.isGroup);
      assert.ok(wheel.getWorldPosition(new THREE.Vector3()).distanceTo(source.getWorldPosition(new THREE.Vector3())) < 1e-5);
      assert.equal(wheel.children.length, 1);
      wheel.rotation.x += 0.5;
      assert.equal(wheel.rotation.x, source.rotation.x + 0.5);
    }
    assert.ok(output.children.some(object => object.material?.name === 'KartPaint'));
    let originalMeshes = 0; model.traverse(object => { if (object.isMesh) originalMeshes++; });
    assert.equal(originalMeshes, output.userData.optimization.beforeMeshes);
    console.log(`${filename}: ${JSON.stringify(output.userData.optimization)}, boundsError=${error}`);
  });
}
