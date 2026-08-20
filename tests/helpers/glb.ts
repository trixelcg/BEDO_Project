import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GLB inspection for the contract tests (BEDO-002 §5, §6).
 *
 * Parsing is delegated to `scripts/analyze-glb.mjs`, the same analyser that produced the
 * asset numbers in `docs/11 §3`. Re-implementing the GLB parser here would give the
 * contract test its own opinion of what a node name is, which is exactly the class of
 * silent divergence these tests exist to catch.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
const ANALYSER = path.join(REPO_ROOT, 'scripts', 'analyze-glb.mjs');

export interface GlbReport {
  file: string;
  fileBytes: number;
  counts: {
    nodes: number;
    meshes: number;
    primitives: number;
    triangles: number;
    vertices: number;
    materials: number;
    textures: number;
    images: number;
    animations: number;
  };
  /** Node names exactly as authored in the GLB, before three.js sanitises them. */
  nodeNames: string[];
}

export const assetPath = (relative: string) => path.join(REPO_ROOT, relative);

export function readGlb(relative: string): GlbReport {
  const file = assetPath(relative);
  if (!existsSync(file)) {
    throw new Error(`asset missing: ${relative} (looked in ${file})`);
  }
  const stdout = execFileSync(process.execPath, [ANALYSER, file, '--nodes', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as GlbReport;
}

export function fileSize(relative: string): number {
  const file = assetPath(relative);
  return existsSync(file) ? statSync(file).size : -1;
}

/**
 * A missing-name report a person can act on: what was asked for, what three.js would
 * have looked up, and the closest thing the export actually contains.
 */
export function describeMissing(
  label: string,
  authored: string,
  exposed: string,
  available: Map<string, string>
): string {
  const lower = exposed.toLowerCase();
  const near = [...available.entries()]
    .filter(([sanitised]) => {
      const other = sanitised.toLowerCase();
      return other.includes(lower) || lower.includes(other) || sharedPrefix(other, lower) >= 6;
    })
    .slice(0, 5)
    .map(([sanitised, raw]) => `      - "${raw}" (exposed as "${sanitised}")`);

  return [
    `${label} is not in the GLB.`,
    `      authored name : "${authored}"`,
    `      looked up as  : "${exposed}"  (after gltfName)`,
    near.length
      ? `      closest nodes in the export:\n${near.join('\n')}`
      : '      no similarly named node exists in the export.',
    '      Fix the export or update src/lib/apparatus.ts — the runtime resolves this name',
    '      with getObjectByName, which returns undefined silently when it is wrong.',
  ].join('\n');
}

const sharedPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
