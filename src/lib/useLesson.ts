/**
 * The React adapter for the lesson runner — the mirror of `useSimulation.ts`.
 *
 * Same shape, same reasoning: the runner owns where the learner is, React observes it
 * through `useSyncExternalStore`, and the runner itself has no idea React exists. Lesson
 * state changes at the rate a person presses buttons, so there is nothing here to
 * optimise.
 */

import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createLessonRunner, type LessonRunner, type LessonState } from '../lesson/runner';
import { CURRENT_LESSON } from '../lesson/currentLesson';

export function useLessonRunner(): LessonRunner {
  const ref = useRef<LessonRunner | null>(null);
  if (ref.current === null) ref.current = createLessonRunner(CURRENT_LESSON);
  return ref.current;
}

export function useLessonState(runner: LessonRunner): LessonState {
  const subscribe = useMemo(
    () => (onStoreChange: () => void) => runner.subscribe(onStoreChange),
    [runner]
  );
  return useSyncExternalStore(subscribe, runner.getState, runner.getState);
}
