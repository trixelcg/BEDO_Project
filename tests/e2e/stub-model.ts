/**
 * A valid, empty GLB, built in memory.
 *
 * Why the browser lesson test uses it: the shipped apparatus model is 26 MB and ~764 MB
 * of texture memory, and under the software renderer a CI machine has, each interaction
 * with the scene loaded takes tens of seconds (measured: 44 s between two lesson steps).
 * That is a real, documented performance defect (`docs/11`, PERF-13) and BEDO-002 does
 * not fix it — but it must not be allowed to make the lesson test slow and flaky, because
 * then nobody runs it.
 *
 * So the default lesson run swaps the model for this stub: the app loads, the canvas
 * renders, the lesson engine and the whole DOM are real, and the 3D content is empty.
 * The real model is still covered — `readiness.e2e.ts` loads it in a browser, and
 * `tests/unit/glb-contract.spec.ts` checks every node name in it.
 *
 * Set `BEDO_E2E_FULL_MODEL=1` to run the same lesson against the real asset.
 */

const JSON_CHUNK = 0x4e4f534a;
const GLB_MAGIC = 0x46546c67;

const STUB_GLTF = {
  asset: { version: '2.0', generator: 'BEDO-002 e2e stub' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  // One empty node, so GLTFLoader hands back a real Object3D rather than nothing.
  nodes: [{ name: 'BedoE2EStubRoot' }],
};

export function buildStubGlb(): Buffer {
  const json = Buffer.from(JSON.stringify(STUB_GLTF), 'utf8');
  const padding = (4 - (json.length % 4)) % 4;
  const chunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + chunk.length, 8);

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(chunk.length, 0);
  chunkHeader.writeUInt32LE(JSON_CHUNK, 4);

  return Buffer.concat([header, chunkHeader, chunk]);
}
