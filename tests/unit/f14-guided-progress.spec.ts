import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLessonRunner } from '../../src/lesson/runner';
import { CURRENT_LESSON } from '../../src/lesson/currentLesson';
import type { LessonContext } from '../../src/lesson/schema';
import { createSimulationRuntime, type SimulationCommand } from '../../src/simulation/runtime';
import { selectReadings } from '../../src/simulation/selectors';
import { buildSteps, EXPERIMENTS } from '../../src/domain/experiments';

/**
 * F14 — Guided progression synchronised with the experiment state (QA, 2026-09-29).
 *
 * Observed: the build reported a balanced pointer while the step still said to add
 * weights, and a later step named a "Calculate" button the workflow did not show where it
 * said. Required: the Steps view is a live progress view on the same authoritative state
 * as the apparatus, and instructions name only controls that exist. `docs/61`.
 */

const source = (path: string) => readFileSync(path, 'utf8');
const APP = source('src/App.tsx');
const OVERLAY = source('src/components/UIOverlay.tsx');
const PROGRESS = source('src/components/StepProgress.tsx');
const CARD = source('src/components/StepInstructionCard.tsx');
const MONITOR = source('src/components/SoftwareMonitor.tsx');
const CSS = source('src/index.css');
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const harness = () => {
  const sim = createSimulationRuntime();
  const runner = createLessonRunner(CURRENT_LESSON);
  let monitorOpen = false;
  const context = (): LessonContext => ({
    simulation: sim.getState(),
    readings: selectReadings(sim.getState()),
    monitorOpen,
  });
  const run = (commands: SimulationCommand[]) => commands.forEach((c) => sim.dispatch(c));
  /** What App does after every commit: sync, apply, repeat until nothing more finishes. */
  const settle = () => {
    for (let i = 0; i < CURRENT_LESSON.steps.length; i++) {
      const result = runner.sync(context());
      if (!result.advanced) return;
      run([...result.commands]);
    }
  };
  const confirm = () => {
    const result = runner.confirm(context());
    run([...result.commands]);
    settle();
    return result.advanced;
  };
  return {
    sim,
    runner,
    context,
    run,
    settle,
    confirm,
    openMonitor: () => {
      monitorOpen = true;
      settle();
    },
  };
};

/** Drive the lesson to the first balance step. */
const toBalance1 = () => {
  const h = harness();
  h.run([{ type: 'OPEN_COVER' }]);
  h.settle();
  h.confirm(); // install the sheet's deflector
  h.run([{ type: 'CLOSE_COVER' }]);
  h.settle();
  h.run([{ type: 'POWER_ON' }]);
  h.settle();
  h.run([{ type: 'SET_VALVE', opening: 0.4 }]);
  h.confirm();
  return h;
};

describe('AC1 — a satisfied balance completes the balance step immediately', () => {
  it('the balance steps finish on the balance itself, and offer no OK', () => {
    for (const id of ['balance-reading-1', 'balance-reading-2']) {
      const step = CURRENT_LESSON.steps.find((s) => s.id === id)!;
      expect(step.advance.kind, id).toBe('condition');
    }
    const h = toBalance1();
    expect(h.runner.getCurrentStep().id).toBe('balance-reading-1');
    h.run([{ type: 'ADD_WEIGHT', massG: 50 }]);
    h.settle();
    expect(h.runner.getCurrentStep().id).toBe('balance-reading-1');
    expect(h.runner.canConfirm(h.context())).toBe(false);
    h.run([{ type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }]);
    h.settle();
    // "Pointer balanced" and "add weights" can no longer be on screen together.
    expect(h.runner.getCurrentStep().id).toBe('increase-flow-reading-2');
    expect(h.context().readings[1].loadedMassG).toBe(80);
  });

  it('whatever balanced it: a Q_total change counts too', () => {
    // 70 g does not balance reading 1 at 120 L/min (83.6 g) …
    const h = toBalance1();
    h.run([{ type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }]);
    h.settle();
    expect(h.runner.getCurrentStep().id).toBe('balance-reading-1');
    // … but it does at a slightly lower pump delivery. No weight action happened.
    h.run([{ type: 'SET_PUMP_FLOW', lPerMin: 110 }]);
    h.settle();
    expect(h.runner.getCurrentStep().id).toBe('increase-flow-reading-2');
  });

  it('App asks the runner after every commit, before paint, with the monitor in the context', () => {
    expect(APP).toMatch(/useLayoutEffect\(\(\) => \{\s*applyAdvance\(runner\.sync\(context\)\);\s*\}, \[context, lessonState, runner, applyAdvance\]\);/);
    expect(APP).toMatch(/\(\{ simulation, readings, monitorOpen: ui\.showMonitor \}\)/);
  });

  it('every step whose goal is a state of the rig finishes on that state', () => {
    const kinds = Object.fromEntries(CURRENT_LESSON.steps.map((s) => [s.id, s.advance.kind]));
    expect(kinds).toEqual({
      'unscrew-cover': 'condition',
      'install-deflector': 'confirm',
      'mount-cover': 'condition',
      'power-on': 'condition',
      'set-flow-reading-1': 'confirm',
      'balance-reading-1': 'condition',
      'increase-flow-reading-2': 'confirm',
      'balance-reading-2': 'condition',
      'open-monitor': 'condition',
      'record-actual-force': 'condition',
      'open-answer-sheet': 'action',
    });
  });

  it('open-monitor is done when the monitor is open — even if it was opened earlier', () => {
    const h = toBalance1();
    h.openMonitor(); // opened at step 6: legal, and changes nothing now
    expect(h.runner.getCurrentStep().id).toBe('balance-reading-1');
    h.run([{ type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }]);
    h.settle();
    h.run([{ type: 'SET_VALVE', opening: 0.5 }]);
    h.confirm();
    h.run([{ type: 'ADD_WEIGHT', massG: 200 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 20 }]);
    h.settle();
    // Reading 2 balanced, and the monitor already on screen: straight on to step 10.
    expect(h.runner.getCurrentStep().id).toBe('record-actual-force');
  });

  it('the balance just reached stays on the carrier', () => {
    const h = toBalance1();
    h.run([{ type: 'ADD_WEIGHT', massG: 50 }, { type: 'ADD_WEIGHT', massG: 20 }, { type: 'ADD_WEIGHT', massG: 10 }]);
    h.settle();
    expect(h.sim.getState().apparatus.loadedWeightsG).toEqual([50, 20, 10]);
  });
});

describe('AC2 — Completed / Current / Upcoming by icon and emphasis, not colour alone', () => {
  it('each status has its own icon and its own word', () => {
    expect(PROGRESS).toMatch(/row\.status === 'completed' \? CheckCircle2 : isCurrent \? ArrowRightCircle : Circle/);
    expect(PROGRESS).toMatch(/completed: \{ en: 'Done'/);
    expect(PROGRESS).toMatch(/current: \{ en: 'Now'/);
    expect(PROGRESS).toMatch(/upcoming: \{ en: 'Next'/);
    expect(PROGRESS).toMatch(/aria-current=\{isCurrent \? 'step' : undefined\}/);
  });

  it('the current row is heavier and edged; the upcoming rows are dimmed', () => {
    const rule = (sel: string) => CSS.slice(CSS.indexOf(sel + ' {'), CSS.indexOf('}', CSS.indexOf(sel + ' {')));
    expect(rule('.step-row.is-current')).toMatch(/font-weight: 700;/);
    expect(rule('.step-row.is-current')).toMatch(/border-inline-start-color: #f58220;/);
    expect(rule('.step-row.is-upcoming')).toMatch(/color: rgba\(255, 255, 255, 0\.48\);/);
  });

  it('the view is built by the runner from the lesson, the same state as the card', () => {
    expect(APP).toMatch(/progress: CURRENT_LESSON\.steps\.map\(\(definition\) => \{/);
    expect(APP).toMatch(/status: runner\.hasCompleted\(definition\.id\)/);
  });
});

describe('AC3 — the view scrolls only when the current step changes', () => {
  it('a change of current step is the only trigger, and it scrolls the list, not the page', () => {
    expect(PROGRESS).toMatch(/if \(lastScrolledFor\.current === currentId\) return;/);
    expect(PROGRESS).toMatch(/\}, \[currentId, isComplete\]\);/);
    expect(strip(PROGRESS)).not.toMatch(/scrollIntoView/);
    expect(PROGRESS).toMatch(/list\.scrollTo\(/);
  });
});

describe('AC4 — step rows cannot skip the procedure', () => {
  it('rows are list items with no handler, no button and no tab stop', () => {
    const list = strip(PROGRESS).slice(strip(PROGRESS).indexOf('<ol'), strip(PROGRESS).indexOf('</ol>'));
    expect(list).not.toMatch(/onClick|<button|tabIndex|role="button"|href=/);
  });

  it('the runner is only moved by the rig, OK and the answer sheet', () => {
    // No component can call the runner; the view only reads `lesson.progress`.
    expect(strip(PROGRESS)).not.toMatch(/runner|dispatch|onAdvance|onSelectStep/);
  });

  it('Guided takes back only the rig it left, so the list never shows a step the rig has passed', () => {
    expect(APP).toMatch(/procedureRig\(\) === rigWhenGuidedLeft\.current \|\|/);
    expect(APP).not.toMatch(/choice === 'keep'/);
  });
});

describe('AC5 — questions and popups are not numbered steps', () => {
  it('the lesson holds procedure steps only', () => {
    const ids = CURRENT_LESSON.steps.map((s) => s.id);
    expect(ids).not.toContain('assessment');
    expect(CURRENT_LESSON.steps.map((s) => s.displayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('an observation note is dismissed with "Got it", never a second OK', () => {
    const at = OVERLAY.indexOf('{notice && !warningMessage && (');
    const block = strip(OVERLAY.slice(at, OVERLAY.indexOf('</div>', at)));
    expect(block).toMatch(/'Got it'/);
    expect(block).not.toMatch(/'OK'/);
  });
});

describe('AC6 — completion is a dedicated state', () => {
  it('the last step is named for its action; "You finished!" belongs to the completed state', () => {
    const steps = buildSteps('Flat surface (90°)', 'العاكس المسطح');
    expect(steps.map((s) => s.titleEn)).not.toContain('You finished!');
    expect(steps[10].titleEn).toBe('Open the answer sheet');
    expect(CARD).toMatch(/if \(lesson\.isComplete\) \{/);
    expect(CARD).toMatch(/'You finished!'/);
    expect(PROGRESS).toMatch(/\{isComplete && \(\s*<li className="step-row is-finished"/);
  });

  it('once complete the runner neither confirms nor advances, and every step reads done', () => {
    const h = harness();
    const runner = createLessonRunner({ steps: CURRENT_LESSON.steps.slice(10) });
    expect(runner.notify('OPEN_ANSWER_SHEET', h.context()).advanced).toBe(true);
    expect(runner.getState().isComplete).toBe(true);
    expect(runner.hasCompleted('open-answer-sheet')).toBe(true);
    expect(runner.canConfirm(h.context())).toBe(false);
    expect(runner.notify('OPEN_ANSWER_SHEET', h.context()).advanced).toBe(false);
  });
});

describe('AC7 — a compact current-step card persists in Guided Mode', () => {
  it('the card is rendered throughout Guided; the Steps view can be put away and back', () => {
    // F16 names the condition (the guided shell) and renders the card inside it.
    expect(OVERLAY).toMatch(/const inGuidedShell = guided && started && !guidedPanelOpen;/);
    expect(OVERLAY).toMatch(/\{inGuidedShell && \(\(\) => \{/);
    expect(OVERLAY).toMatch(/\{activeStep && \(\s*<StepInstructionCard/);
    expect(OVERLAY).toMatch(/onClick=\{\(\) => setShowSteps\(\(open\) => !open\)\}/);
    expect(OVERLAY).toMatch(/aria-pressed=\{showSteps\}/);
  });
});

describe('instructions name only controls that exist', () => {
  /** Every “quoted” control name in the step copy and the observation notes. */
  const quoted = (text: string) => [...text.matchAll(/[“«"]([^”»"]+)[”»"]/g)].map((m) => m[1]);

  it('every quoted English control is a button label in the build', () => {
    const labels = new Set<string>();
    for (const e of EXPERIMENTS) {
      for (const step of buildSteps(e.nameEn, e.nameAr)) {
        for (const q of [...quoted(step.bodyEn), ...quoted(step.noticeEn ?? '')]) labels.add(q);
      }
    }
    expect([...labels].sort()).toEqual(['Calculate', 'Export Data', 'Open Data Monitor', 'Open the answer sheet', 'Save Screen']);
    const sources: Record<string, string> = {
      Calculate: MONITOR,
      'Export Data': MONITOR,
      'Save Screen': MONITOR,
      'Open Data Monitor': OVERLAY,
      'Open the answer sheet': CARD,
    };
    for (const label of labels) expect(sources[label], label).toContain(`'${label}'`);
  });

  it('every quoted Arabic control is the Arabic label of that button', () => {
    const steps = buildSteps('x', 'x');
    const ar = steps.flatMap((s) => quoted(s.bodyAr));
    expect(ar).toContain('فتح شاشة البيانات');
    expect(ar).toContain('احسب (Calculate)');
    expect(ar).toContain('عرض ورقة الإجابة');
    expect(OVERLAY).toContain("'فتح شاشة البيانات'");
    expect(MONITOR).toContain("'احسب (Calculate)'");
    expect(CARD).toContain("'عرض ورقة الإجابة'");
  });

  it('the Calculate step says where the button is: under the results table, in the monitor', () => {
    const step = buildSteps('x', 'x').find((s) => s.stepId === 'record-actual-force')!;
    expect(step.bodyEn).toBe('In the Data Monitor, press “Calculate” under the results table to record F_ac.');
    // And in guided mode the monitor shows it (free mode has no Calculate step, F10).
    expect(MONITOR).toMatch(/\{!free && \(\s*<button\s+className="btn-primary"\s+onClick=\{onCalculate\}/);
  });

  it('no step names the "Document" tab, which this build does not have', () => {
    for (const step of buildSteps('x', 'x')) expect(step.bodyEn).not.toMatch(/Document/);
  });
});
