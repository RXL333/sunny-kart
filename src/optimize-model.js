import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL = /^Wheel(?:Front|Rear)[LR]$/;

function geometrySlice(geometry, start, count) {
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(count * attribute.itemSize);
    for (let i = 0; i < count; i++) for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.getComponent(start + i, j);
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  return result;
}

function harmonize(geometries) {
  const schema = new Map();
  for (const geometry of geometries) for (const [name, attribute] of Object.entries(geometry.attributes)) schema.set(name, attribute.itemSize);
  for (const geometry of geometries) {
    for (const [name, itemSize] of schema) {
      const old = geometry.getAttribute(name), count = geometry.getAttribute('position').count;
      const values = new Float32Array(count * itemSize);
      if (old) {
        for (let i = 0; i < count; i++) for (let j = 0; j < itemSize; j++) values[i * itemSize + j] = old.getComponent(i, j);
      } else if (name === 'color') values.fill(1);
      else if (name === 'tangent') for (let i = 0; i < count; i++) { values[i * itemSize] = 1; values[i * itemSize + 3] = 1; }
      geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
    }
    geometry.clearGroups();
  }
}

/**
 * Bake static glTF hierarchy into material batches while retaining the four
 * animated wheel pivots. Input geometry/materials are never changed or disposed.
 * Wheel meshes use material groups so each wheel remains one transformable mesh.
 */
export function optimizeModel(model) {
  model.updateWorldMatrix(true, true);
  const optimized = new THREE.Group();
  optimized.name = model.name || 'OptimizedKart';
  optimized.position.copy(model.position); optimized.quaternion.copy(model.quaternion); optimized.scale.copy(model.scale);
  optimized.userData = { ...model.userData };
  optimized.visible = model.visible;
  const rootInverse = model.matrixWorld.clone().invert();
  const wheels = new Map(), buckets = new Map();
  let beforeMeshes = 0;

  model.traverse(object => {
    if (!WHEEL.test(object.name) || object.isMesh) return;
    const group = new THREE.Group(); group.name = object.name; group.userData = { ...object.userData };
    group.matrix.multiplyMatrices(rootInverse, object.matrixWorld);
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    optimized.add(group); wheels.set(object, group);
  });

  const bucketFor = (container, material) => {
    const key = `${container.uuid}:${material.uuid}`;
    if (!buckets.has(key)) buckets.set(key, { container, material, geometries: [], castShadow: false, receiveShadow: false });
    return buckets.get(key);
  };
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    beforeMeshes++;
    let ancestor = mesh.parent;
    while (ancestor && ancestor !== model && !wheels.has(ancestor)) ancestor = ancestor.parent;
    const sourceWheel = wheels.has(ancestor) ? ancestor : null;
    const container = sourceWheel ? wheels.get(sourceWheel) : optimized;
    const relative = new THREE.Matrix4().multiplyMatrices(sourceWheel ? sourceWheel.matrixWorld.clone().invert() : rootInverse, mesh.matrixWorld);
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(relative);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.getAttribute('position').count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex];
      if (!material) continue;
      const piece = geometrySlice(geometry, group.start, group.count);
      const bucket = bucketFor(container, material);
      bucket.geometries.push(piece); bucket.castShadow ||= mesh.castShadow; bucket.receiveShadow ||= mesh.receiveShadow;
    }
    geometry.dispose();
  });

  // All buckets are normalized together so wheel submeshes can subsequently
  // merge even when a material uses an additional UV/color attribute.
  harmonize([...buckets.values()].flatMap(bucket => bucket.geometries));
  const wheelParts = new Map();
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    if (!geometry) throw new Error(`Unable to batch kart material: ${bucket.material.name}`);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    for (const piece of bucket.geometries) piece.dispose();
    if (bucket.container === optimized) {
      const mesh = new THREE.Mesh(geometry, bucket.material);
      mesh.name = `Static_${bucket.material.name || 'Material'}`;
      mesh.castShadow = bucket.castShadow; mesh.receiveShadow = bucket.receiveShadow;
      optimized.add(mesh);
    } else {
      if (!wheelParts.has(bucket.container)) wheelParts.set(bucket.container, []);
      wheelParts.get(bucket.container).push({ geometry, ...bucket });
    }
  }
  for (const [group, parts] of wheelParts) {
    const geometry = mergeGeometries(parts.map(part => part.geometry), true);
    if (!geometry) throw new Error(`Unable to batch kart wheel: ${group.name}`);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, parts.map(part => part.material));
    mesh.name = `${group.name}_Batched`;
    mesh.castShadow = parts.some(part => part.castShadow); mesh.receiveShadow = parts.some(part => part.receiveShadow);
    group.add(mesh);
    for (const part of parts) part.geometry.dispose();
  }
  let afterMeshes = 0, drawCalls = 0;
  optimized.traverse(object => { if (object.isMesh) { afterMeshes++; drawCalls += Array.isArray(object.material) ? object.geometry.groups.length : 1; } });
  optimized.userData.optimization = { beforeMeshes, afterMeshes, drawCalls };
  optimized.updateMatrixWorld(true);
  return optimized;
}
