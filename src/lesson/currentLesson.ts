/**
 * The lesson the application ships today, as data.
 *
 * **This is a transcription, not a redesign.** Every condition below is the one that was
 * previously written as a comparison against a step number, in whichever of the three
 * files happened to own it. `docs/34 §3` is the line-by-line mapping.
 *
 * The canonical structure in `docs/32` — eleven steps, the volumetric valve demoted to an
 * affordance, assessment separated from the closing step — is deliberately **not** here.
 * `BEDO-019` makes that change by editing this file, which is the point of the exercise.
 */

import { FIRST_READING_VALVE, SECOND_READING_VALVE, VALVE_SNAP_MARGIN } from '../domain/physics';
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
      // the learner confirms. Preserved exactly as it behaves today.
      isSatisfied: never,
      advance: { kind: 'confirm', when: (c) => c.simulation.apparatus.isCoverOpen },
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
      id: 'open-volumetric-valve',
      displayNumber: 5,
      target: 'volumetricValve',
      highlight: ['volumetricValve'],
      panelControls: ['volumetricValve'],
      expectation: { type: 'OPEN_VOLUMETRIC_VALVE' },
      isSatisfied: (c) => c.simulation.apparatus.isVolumetricValveOpen,
      advance: { kind: 'confirm', when: (c) => c.simulation.apparatus.isVolumetricValveOpen },
      // Confirming forces the valve open even if it somehow is not — as the old switch did.
      onComplete: [{ type: 'OPEN_VOLUMETRIC_VALVE' }],
    },
    {
      id: 'set-flow-reading-1',
      displayNumber: 6,
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
      displayNumber: 7,
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
      displayNumber: 8,
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
      displayNumber: 9,
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
      displayNumber: 10,
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
      displayNumber: 11,
      target: null,
      highlight: [],
      panelControls: ['monitor'],
      expectation: { type: 'RECORD_ACTUAL_FORCE' },
      isSatisfied: (c) => c.simulation.isActualForceRecorded,
      advance: { kind: 'action' },
    },
    {
      id: 'finish',
      displayNumber: 12,
      target: null,
      highlight: [],
      panelControls: ['monitor'],
      // The closing step carries the assessment question today. `docs/32` shows BEDO's own
      // sheets keep the two apart — the question is unnumbered content and the closing
      // step opens the answer-sheet document — but separating them is BEDO-019's content
      // migration, not this task's.
      expectation: { type: 'ANSWER_QUESTION' },
      isSatisfied: always,
      advance: { kind: 'action' },
    },
  ],
};

/** How many steps the learner is told there are. */
export const CURRENT_LESSON_STEP_COUNT = CURRENT_LESSON.steps.length;
