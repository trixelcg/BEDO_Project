# QA_REPAIR_VALIDATION — baseline and per-phase evidence

Evidence log for the VL-FM009 repair programme. One section per phase. A row in
`QA_REPAIR_LEDGER.md` may only reach `verified` when the evidence that justifies it is
recorded here and matches what the criterion actually asks for.

**Rule:** a green build, a passing type check and a clean lint prove that the code
compiles. They prove nothing about the physics, the geometry or the rendered image.

---

## 1. Baseline — P0

| Field | Value |
| --- | --- |
| Revision tested | `484be85` |
| Branch | `phase2/security-remediation` |
| Working tree | clean (`git status --porcelain` empty) before and after this phase's document additions |
| Date | 2026-09-20 |
| Node / npm | v24.15.0 / 11.15.0 |
| Application code changed | **none** |

## 2. Baseline results

### 2.1 Type check — PASS

```
$ npm run typecheck
> tsc -b && tsc -p tsconfig.test.json
(no output)
```

### 2.2 Lint — PASS with 2 pre-existing warnings, 0 errors

```
$ npm run lint
scripts/analyze-glb.mjs:197:19: warning eslint(no-unused-vars): Variable 'nodeNames' is declared but never used.
src/components/DeviceModel.tsx:1516:21: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'pick'
```

Both predate this programme. Recorded so a later phase does not report them as new.

### 2.3 Unit + integration — PASS

```
$ npm run test:unit
Test Files  52 passed (52)
     Tests  1179 passed (1179)
  Duration  6.64s
```

### 2.4 E2E — 18 passed, 1 failed, 21 skipped

```
$ npm run test:e2e
1 failed
  [chromium] › tests/e2e/lesson.e2e.ts:277:3 › guided walkthrough ›
    removes a single weight and leaves the others on the holder
21 skipped
18 passed (2.6m)
```

Failure point: `tests/e2e/lesson.e2e.ts:305`

```js
await button(page, 'Remove 10 g').first().click();
```

**Re-run in isolation — PASS:**

```
$ npx playwright test --grep "removes a single weight"
✓ 1 [chromium] › tests/e2e/lesson.e2e.ts:277:3 › guided walkthrough ›
    removes a single weight and leaves the others on the holder (10.0s)
1 passed (11.2s)
```

## 3. Baseline interpretation

The E2E failure is **flaky under full-suite load, not a deterministic defect**: the same
test passes on its own at the same revision with no code change. It is recorded as a known
baseline condition, not as a bug that has been fixed and not as a regression. Per the
programme's own rule, a non-reproducible defect gets documented verification, not an
assumed repair.

The 21 skipped E2E tests were not investigated in this phase. Whether they are
conditionally skipped by design or silently disabled is an open question for P7 (C07),
where the full regression runs. It is noted here so it is not discovered late.

**Baseline stance:** unit and integration coverage is broad (1179 assertions) and green,
and the domain layer is pure and directly testable — which is a good position for the
physics phases. But none of it is evidence for any acceptance criterion in the source
report, because the criteria that matter are about measured behaviour, rendered images and
end-to-end state agreement, and no such evidence exists yet.

## 4. What was NOT verified in this phase

Stated explicitly so nothing here is read as more than it is.

- No visual or rendered evidence was produced. F01, F02, F04, F06, F07, F08 and A19 are untouched.
- No spreadsheet was opened. No FBX was inspected. Neither file is in the repository.
- The PDF's images were read as images alongside the report's own descriptions. A static screenshot was not treated as a test of runtime behaviour (this matters for F17, where the source itself says the screenshot does not prove hover is absent).
- No equation was re-derived against an approved source, because the approved source is undecided (DEC01).
- The application was not run interactively in this phase.

---

## 5. Phase P1 (C01 — F18, F19)

*Not started.*

---

## 6. Phase P2 (C02 — F09, F10, F11, F15)

*Not started.*

---

## 7. Phase P3 (C03 — F03, F04, F05)

*Not started.*

---

## 8. Phase P4 (C04 — F08)

*Not started.*

---

## 9. Phase P5 (C05 — F01, F02, F06, F07)

*Not started.*

---

## 10. Phase P6 (C06 — F12, F13, F14, F16, F17, UI01–UI12)

*Not started.*

---

## 11. Phase P7 (C07 — full regression, A01–A20)

*Not started.* C08 remains the release gate: no QA-approved claim while any Critical
finding is open.
