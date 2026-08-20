// How an authored apparatus name becomes a name three.js will answer to.
//
// This is scene-layer knowledge, not domain knowledge: the domain says a part is called
// "JET Force 2_214" (src/domain/apparatus.ts), and this says what GLTFLoader will have
// renamed it to by the time it is in the scene graph.

/**
 * The name three.js will actually give a node.
 *
 * GLTFLoader runs every node name through PropertyBinding.sanitizeNodeName, which
 * turns whitespace into underscores and strips `. [ ] : /`. So the GLB's
 * "JET Force 2_214" is loaded as "JET_Force_2_214", and "Flat_surface_deflector_90.001"
 * as "Flat_surface_deflector_90001".
 *
 * getObjectByName on the authored name therefore returns undefined and fails silently.
 * That is why the nozzle was never found (so the jet never rendered), why the mounted
 * deflector never appeared on the rod, and why all seven mounted deflectors stayed
 * visible inside the tank at once — the code that meant to hide them never matched a
 * single node.
 */
export const gltfName = (authored: string): string =>
  authored.replace(/\s/g, '_').replace(/[[\]./:]/g, '');
