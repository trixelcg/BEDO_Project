import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAMPUS_LEVELS, closeCampusSeams } from '../../src/lib/campusSeams';

/**
 * The campus model's open seams (QA, 2026-09-29): walls and lab fronts that stop short of
 * the ceiling and floor slabs let the exterior backdrop show through as bright strips.
 * `closeCampusSeams` moves each short edge into the slab it should meet.
 */

const part = (name: string, y0: number, y1: number, at = new THREE.Vector3()) => {
  const geometry = new THREE.BoxGeometry(1, y1 - y0, 0.1);
  geometry.translate(0, (y0 + y1) / 2, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.position.copy(at);
  return mesh;
};
const yRange = (mesh: THREE.Mesh) => {
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox!;
  return [+(b.min.y + mesh.position.y).toFixed(4), +(b.max.y + mesh.position.y).toFixed(4)];
};

describe('closeCampusSeams', () => {
  it('lifts wall and transom tops into the ceiling slab, and drops rail and mullion feet into the floor', () => {
    const root = new THREE.Group();
    const wall = part('Campus_lab_back_wall001', -0.05, 3.05);
    const divider = part('Campus_lab_partition003', -0.05, 3.05);
    const endWall = part('Campus_end_wall', -0.05, 3.05);
    const transom = part('Campus_facade_transom002', 2.69, 2.99);
    const lowRail = part('Campus_glazing_horizontal_rail002', 0.0178, 0.0522);
    const highRail = part('Campus_glazing_horizontal_rail003', 2.742, 2.777);
    const mullion = part('Campus_glazing_mullion004', 0, 2.8);
    const ceiling = part('Campus_acoustic_ceiling', 3.09, 3.21);
    root.add(wall, divider, endWall, transom, lowRail, highRail, mullion, ceiling);

    expect(closeCampusSeams(root)).toBe(6);
    for (const m of [wall, divider, endWall]) expect(yRange(m)).toEqual([-0.05, CAMPUS_LEVELS.ceilingTop]);
    expect(yRange(transom)).toEqual([2.69, CAMPUS_LEVELS.ceilingTop]);
    expect(yRange(lowRail)).toEqual([CAMPUS_LEVELS.floorBottom, 0.0522]);
    expect(yRange(mullion)).toEqual([CAMPUS_LEVELS.floorBottom, 2.8]);
    // The top rail and the ceiling itself are left as they are.
    expect(yRange(highRail)).toEqual([2.742, 2.777]);
    expect(yRange(ceiling)).toEqual([3.09, 3.21]);
  });

  it('works in the scene root’s frame, wherever the part sits under it', () => {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    holder.position.set(4, 0.5, -2);
    const wall = part('Campus_lab_back_wall', -0.55, 2.55); // 0.5 up: -0.05 … 3.05 in the root
    holder.add(wall);
    root.add(holder);
    root.position.set(10, -1.8, 3); // the root's own placement does not matter
    root.scale.setScalar(1.8);
    closeCampusSeams(root);
    const [lo, hi] = yRange(wall);
    expect([+(lo + 0.5).toFixed(4), +(hi + 0.5).toFixed(4)]).toEqual([-0.05, CAMPUS_LEVELS.ceilingTop]);
  });

  it('touches each part once, and never the shared cached geometry', () => {
    const root = new THREE.Group();
    const wall = part('Campus_end_wall001', -0.05, 3.05);
    const original = wall.geometry;
    root.add(wall);
    closeCampusSeams(root);
    closeCampusSeams(root);
    expect(yRange(wall)).toEqual([-0.05, CAMPUS_LEVELS.ceilingTop]);
    expect(wall.geometry).not.toBe(original);
    original.computeBoundingBox();
    expect(original.boundingBox!.max.y).toBeCloseTo(3.05, 6);
  });

  it('is applied to the campus scene when it loads', () => {
    const CAMPUS = readFileSync('src/components/CampusEnvironment.tsx', 'utf8');
    expect(CAMPUS).toMatch(/closeCampusSeams\(scene\);/);
  });
});
