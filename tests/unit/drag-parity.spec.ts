import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/glb';
import { DEFLECTORS } from '../../src/domain/apparatus';
import { EXPERIMENTS, type ExperimentId } from '../../src/domain/experiments';
import { restingState } from '../../src/domain/stateMachine';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import type { LessonMode } from '../../src/lesson/runner';
import { evaluateInteraction, type Interaction } from '../../src/interaction/gate';
import { interactionFor } from '../../src/interaction/drag';

/**
 * Semantic parity: a drag and a click are the same request (BEDO-021 §30).
 *
 * The client asked for drag-and-drop; BEDO's own storyboard describes a click. `docs/16
 * §4.1` resolved that by supporting both *as the same interaction*, and this is the test
 * that keeps it true. A drag-specific lesson policy would be `BUG-04` again with a third
 * surface, so the property being pinned is not "drag works" but "drag decides nothing".
 */

const MODES: LessonMode[] = ['guided', 'free'];
const EXPERIMENT_IDS = EXPERIMENTS.map((e) => e.id) as ExperimentId[];

/** What the 2D panel and the 3D click path have always sent. */
const panelSelect = (deflectorId: number): Interaction => ({
  kind: 'apparatus',
  action: { type: 'SELECT_DEFLECTOR', deflectorId },
});
const panelRemove = (index: number): Interaction => ({
  kind: 'apparatus',
  action: { type: 'REMOVE_WEIGHT', index },
});

describe('a dragged deflector and a clicked one are one interaction', () => {
  it('produces a literally identical intent for every deflector on the tray', () => {
    for (const deflector of DEFLECTORS) {
      expect(interactionFor({ kind: 'deflector', deflectorId: deflector.id })).toEqual(
        panelSelect(deflector.id)
      );
    }
  });

  it('gets the identical gate decision at every step, in every experiment, in both modes', () => {
    // Includes the states that must refuse: the wrong experiment's deflector (`BUG-05`,
    // DEFLECTOR_NOT_IN_EXPERIMENT), a step that is not about deflectors
    // (NOT_EXPECTED_IN_CURRENT_STEP), and a shut tank (the apparatus's own COVER_CLOSED).
    for (const mode of MODES) {
      for (const experimentId of EXPERIMENT_IDS) {
        for (const step of CURRENT_LESSON.steps) {
          for (const coverOpen of [false, true]) {
            const apparatus = { ...restingState(90), isCoverOpen: coverOpen };
            for (const deflector of DEFLECTORS) {
              const request = { apparatus, experimentId, step, lesson: CURRENT_LESSON, mode };
              const clicked = evaluateInteraction({
                ...request,
                interaction: panelSelect(deflector.id),
              });
              const dragged = evaluateInteraction({
                ...request,
                interaction: interactionFor({ kind: 'deflector', deflectorId: deflector.id }),
              });
              expect(
                dragged,
                `drag and click disagree: ${experimentId}/${step.id}/${mode}/${deflector.id}` +
                  `/cover ${coverOpen}`
              ).toEqual(clicked);
            }
          }
        }
      }
    }
  });

  it('refuses a dragged out-of-scope deflector for the documented lesson reason', () => {
    // Exp. 1 is run with the 90° flat deflector alone. Dragging the 135° conical onto the
    // rod has to fail the same way clicking it in the panel does.
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'install-deflector')!;
    const decision = evaluateInteraction({
      interaction: interactionFor({ kind: 'deflector', deflectorId: 135 }),
      apparatus: { ...restingState(90), isCoverOpen: true },
      experimentId: 'flat',
      step,
      lesson: CURRENT_LESSON,
      mode: 'guided',
    });
    expect(decision).toEqual({
      allowed: false,
      blockedBy: 'lesson',
      reason: 'DEFLECTOR_NOT_IN_EXPERIMENT',
      affordance: 'deflectors',
    });
  });

  it('accepts a dragged in-scope deflector on the step that asks for one', () => {
    const step = CURRENT_LESSON.steps.find((s) => s.id === 'install-deflector')!;
    expect(
      evaluateInteraction({
        interaction: interactionFor({ kind: 'deflector', deflectorId: 90 }),
        apparatus: { ...restingState(90), isCoverOpen: true },
        experimentId: 'flat',
        step,
        lesson: CURRENT_LESSON,
        mode: 'guided',
      })
    ).toEqual({ allowed: true, why: 'EXPECTED' });
  });

  it('lets free mode explore every deflector, exactly as the panel does', () => {
    for (const deflector of DEFLECTORS) {
      expect(
        evaluateInteraction({
          interaction: interactionFor({ kind: 'deflector', deflectorId: deflector.id }),
          apparatus: { ...restingState(90), isCoverOpen: true },
          experimentId: 'flat',
          step: CURRENT_LESSON.steps[0],
          lesson: CURRENT_LESSON,
          mode: 'free',
        })
      ).toEqual({ allowed: true, why: 'FREE_MODE' });
    }
  });
});

describe('a disc pulled off the holder and one clicked off are one interaction', () => {
  it('produces a literally identical intent, by stack position', () => {
    for (const index of [0, 1, 2, 5]) {
      expect(interactionFor({ kind: 'weight', index })).toEqual(panelRemove(index));
    }
  });

  it('gets the identical gate decision at every step and in both modes', () => {
    for (const mode of MODES) {
      for (const step of CURRENT_LESSON.steps) {
        const apparatus = { ...restingState(90), loadedWeightsG: [100, 100] as const };
        const request = {
          apparatus,
          experimentId: 'flat' as ExperimentId,
          step,
          lesson: CURRENT_LESSON,
          mode,
        };
        for (const index of [0, 1]) {
          expect(
            evaluateInteraction({ ...request, interaction: interactionFor({ kind: 'weight', index }) }),
            `drag and click disagree on removing disc ${index} at ${step.id}/${mode}`
          ).toEqual(evaluateInteraction({ ...request, interaction: panelRemove(index) }));
        }
      }
    }
  });
});

describe('the drag layer holds no policy of its own', () => {
  const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

  it('never names a lesson, a step, an experiment or a safety rule', () => {
    for (const file of ['src/interaction/drag.ts', 'src/components/useObjectDrag.ts']) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const forbidden of [
        'CURRENT_LESSON',
        'isDeflectorInScope',
        'evaluateInteraction',
        'availableAffordances',
        'getExperiment',
        'attempt(',
        'isCoverOpen',
        'loadedWeightsG',
      ]) {
        expect(code, `${file} has grown its own copy of the rules: ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });

  it('never lets pointer data past the gesture layer', () => {
    // No lesson decision may depend on a coordinate, a button, a distance or a mesh id.
    const code = read('src/interaction/drag.ts');
    const mapping = code.slice(code.indexOf('export const interactionFor'));
    for (const leak of ['currentPoint', 'startPoint', 'pointerId', 'isDragging', 'uuid']) {
      expect(mapping, `interactionFor reads ${leak}`).not.toContain(leak);
    }
  });
});
