/**
 * The canonical lesson: eleven numbered steps, as BEDO's four experiment sheets specify.
 *
 * `BEDO-018` made this a data file; `BEDO-019` then made the change it was built for —
 * nine apparatus steps, then Calculate, then the closing step that opens the answer sheet.
 * The volumetric valve moved to `alwaysAvailable`, the assessment moved out of the
 * numbered flow, and no code needed editing to follow any of it. `docs/35`.
 */

import { FIRST_READING_VALVE, SECOND_READING_VALVE, VALVE_SNAP_MARGIN } from '../domain/physics';
import { isDeflectorInScope } from '../domain/experiments';
import type { Lesson, LessonContext } from './schema';

/** The valve has reached a reading setpoint, allowing for the snap margin. */
const valveAtLeast = (setpoint: number) => (context: LessonContext) =>
  context.simulation.apparatus.valveOpening >= setpoint - VALVE_SNAP_MARGIN;

/** The tray balances the jet for a given results row. */
const readingBalanced = (index: number) => (context: LessonContext) =>
  context.readings[index]?.isBalanced === true;

const never = () => false;
const always = () => true;

export const CURRENT_LESSON: Lesson = {
  /**
   * Controls the learner can reach at any point, regardless of step.
   *
   * The volumetric valve lives here after BEDO-019. It is part of the rig — the state
   * machine gives it a transition in every state, and it turns without changing anything —
   * but no experiment sheet instructs it, so it is an affordance rather than a step.
   * `docs/35 §3`.
   *
   * The software board joins it in BEDO-UX-12C, for the same reason and by the same rule.
   * It is instrumentation, not a step: reading it changes nothing about the rig, and a
   * learner turning the valve or loading the pan should be able to watch what that does.
   * Putting it here rather than into each step's `panelControls` is the whole point —
   * `panelControls` stays the one action the current step asks for, and this stays the
   * short list of things reachable regardless of where the procedure has got to. Steps
   * 9-11 still name the board as their own contextual control, so it is not listed twice
   * on screen; the guided footer offers it only when they do not.
   */
  alwaysAvailable: ['volumetricValve', 'monitor'],
  steps: [
    {
      id: 'unscrew-cover',
      displayNumber: 1,
      target: 'cover',
      // The arrow points at the plate; the camera shows the whole bench, so the lesson
      // opens on the view the operator actually stands in.
      cameraView: 'overview',
      highlight: ['cover'],
      panelControls: [],
      expectation: { type: 'OPEN_COVER' },
      isSatisfied: (c) => c.simulation.apparatus.isCoverOpen,
      advance: { kind: 'action' },
    },
    {
      id: 'install-deflector',
      displayNumber: 2,
      target: 'tray',
      highlight: ['deflectors'],
      panelControls: ['deflectors'],
      expectation: { type: 'SELECT_DEFLECTOR' },
      // Nothing observable marks a deflector as "installed" — the rod always carries one —
      // so this step has no completion condition of its own and the arrow stays up until
      // the learner confirms.
      isSatisfied: never,
      // The tank must be open, and the deflector on the rod must be one this experiment is
      // run with. The gate already refuses an out-of-scope choice in guided mode, so this
      // is belt and braces — but it is the *lesson's* own statement of what finishing this
      // step means, and it catches the one route the gate does not cover: exploring in
      // free mode and switching back. `BUG-05`, docs/37 §6.
      advance: {
        kind: 'confirm',
        when: (c) =>
          c.simulation.apparatus.isCoverOpen &&
          isDeflectorInScope(c.simulation.experimentId, c.simulation.apparatus.selectedDeflectorId),
      },
    },
    {
      id: 'mount-cover',
      displayNumber: 3,
      target: 'cover',
      highlight: ['cover'],
      panelControls: [],
      expectation: { type: 'CLOSE_COVER' },
      isSatisfied: (c) => !c.simulation.apparatus.isCoverOpen,
      advance: { kind: 'action' },
    },
    {
      id: 'power-on',
      displayNumber: 4,
      target: 'power',
      highlight: ['power'],
      panelControls: ['power'],
      expectation: { type: 'POWER_ON' },
      isSatisfied: (c) => c.simulation.apparatus.isPowerOn,
      advance: { kind: 'action' },
    },
    {
      id: 'set-flow-reading-1',
      displayNumber: 5,
      target: 'flowValve',
      highlight: ['flowValve'],
      panelControls: ['flowValve'],
      expectation: { type: 'SET_VALVE' },
      isSatisfied: valveAtLeast(FIRST_READING_VALVE),
      advance: { kind: 'confirm', when: valveAtLeast(FIRST_READING_VALVE) },
      // Settle on the exact setpoint the first row is computed at, and start that reading.
      onComplete: [
        { type: 'SET_VALVE', opening: FIRST_READING_VALVE },
        { type: 'BEGIN_READING', index: 1 },
      ],
    },
    {
      id: 'balance-reading-1',
      displayNumber: 6,
      target: 'weights',
      highlight: ['weights'],
      panelControls: ['weights'],
      expectation: { type: 'ADD_WEIGHT' },
      isSatisfied: readingBalanced(1),
      advance: { kind: 'confirm', when: readingBalanced(1) },
      onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }],
    },
    {
      id: 'increase-flow-reading-2',
      displayNumber: 7,
      target: 'flowValve',
      highlight: ['flowValve'],
      panelControls: ['flowValve'],
      expectation: { type: 'SET_VALVE' },
      isSatisfied: valveAtLeast(SECOND_READING_VALVE),
      advance: { kind: 'confirm', when: valveAtLeast(SECOND_READING_VALVE) },
      onComplete: [
        { type: 'SET_VALVE', opening: SECOND_READING_VALVE },
        { type: 'BEGIN_READING', index: 2 },
      ],
    },
    {
      id: 'balance-reading-2',
      displayNumber: 8,
      target: 'weights',
      highlight: ['weights'],
      panelControls: ['weights'],
      expectation: { type: 'ADD_WEIGHT' },
      isSatisfied: readingBalanced(2),
      advance: { kind: 'confirm', when: readingBalanced(2) },
      onComplete: [{ type: 'END_READING' }, { type: 'REMOVE_ALL_WEIGHTS' }],
    },
    {
      id: 'open-monitor',
      displayNumber: 9,
      target: 'overview',
      highlight: [],
      panelControls: ['monitor'],
      expectation: { type: 'OPEN_MONITOR' },
      // Reachable from the moment the step opens: pressing OK opens the monitor, and so
      // does opening it directly. Both paths finish the step.
      isSatisfied: always,
      advance: { kind: 'confirm', when: always },
      alsoCompletesOn: 'OPEN_MONITOR',
    },
    {
      id: 'record-actual-force',
      displayNumber: 10,
      target: null,
      highlight: [],
      panelControls: ['monitor'],
      expectation: { type: 'RECORD_ACTUAL_FORCE' },
      isSatisfied: (c) => c.simulation.isActualForceRecorded,
      advance: { kind: 'action' },
    },
    {
      id: 'open-answer-sheet',
      displayNumber: 11,
      target: null,
      highlight: [],
      panelControls: ['monitor', 'answerSheet'],
      // BEDO's sheets close with "You finished! Click the 'Document' tab to view the
      // answer sheet". Opening it finishes the numbered procedure; the assessment sits
      // beside the lesson, unnumbered, exactly as the sheets place it.
      expectation: { type: 'OPEN_ANSWER_SHEET' },
      isSatisfied: always,
      advance: { kind: 'action' },
    },
  ],
};

/** How many steps the learner is told there are. */
export const CURRENT_LESSON_STEP_COUNT = CURRENT_LESSON.steps.length;
