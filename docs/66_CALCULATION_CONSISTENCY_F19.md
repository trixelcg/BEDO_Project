# 66 — One calculation: code against `Logic(final) 2.xlsx` (F19)

This is a working-tree change on top of F03–F18 (`docs/53`–`65`). It is not committed and not deployed.

**Observed (QA, E34–E35, IMG24, IMG31–IMG33):** the live panel, the recorded table and the workbook did not show one consistent Q / velocity / force dataset:

* the workbook maps n = 0 … 1.0 at QT = 120 to Q ≈ 0, 6.954, 15.714, 43.457, 84.713, 111.372 L/min;
* the build's screens showed other series, and a live Q of 185.620 L/min;
* the workbook has a `#REF!` at Y38 and cross-block references (Y24→T15, Y37→T29).

**Evidence available.** On 2026-09-29 the user supplied a screenshot of the workbook covering columns P–AF, rows 1–20:

* It shows **values, not formulas.**
* **Column Y is hidden** in it; Z follows X directly.
* Rows 21 and below are not shown, so Y24, Y37 and Y38 are not visible.

As a result, **AC01 (repair Y38) and AC02 (audit the cross-block references) still need the file itself.** Everything else below is decided from the values.

## 1. The code already reproduces the workbook

`src/domain/physics.ts` gives the workbook's numbers at every row, at the precision the sheet displays them (`tests/unit/f19-calculation-consistency.spec.ts`).

**Flat block (rows 4–10):**

| n | Q (L/min) | V₀ | V | F_th (N) | mass (g) |
|---|---|---|---|---|---|
| 0.2 | 6.9537984 | 1.476 | 1.222 | 0.12 | 11.95 |
| 0.4 | 15.7144704 | 3.336 | 3.232 | 0.82 | 83.58 |
| 0.6 | 43.4568384 | 9.227 | 9.189 | 6.63 | 675.71 |
| 0.8 | 84.7129344 | 17.986 | 17.967 | 25.34 | 2583.07 |
| 1.0 | 111.372 | 23.646 | 23.631 | 43.84 | 4468.66 |
| Manual, Q = 25 | 25 | 5.308 | 5.243 | 2.158 | 219.949 |

**The rest of the sheet:**

* **Oblique 45:** the code follows the law ρAV²·sin²θ. It matches the sheet to within 0.004 %; §3.2 explains the gap.
* **Constants:** A = 7.85e-5 m², s = 0.035 m, g = 9.81 and k = 200 N/m. These are the sheet's values; its hW column (2, 5, 10, 25 mm) is exactly load / k.
* **F(ac):** F(ac) = mass × g, which is the code's F_ac.

**The "other series" were the same mapping at Q_total = 200.** The Parameters tab allows Q_total from 20 to 200 L/min. At Q_total = 200:

* IMG24's live Q = 185.620 L/min is n = 1.0 (111.372 × 200 / 120), with V₀ 39.410, V 39.401 and F_th 121.8668 N.
* Its table rows 26.191, 45.040 and 72.428 are n = 0.4, 0.5 and 0.6.

All of these are reproduced exactly. **There is no second formula.**

**Correction to the ledger.** The P0 ledger said the code's quartic "gives a different series" from IMG31. That was wrong: it gives the IMG31 series digit for digit. The row is now closed.

## 2. Defined once, used everywhere (AC03, AC04)

* **One definition.** The valve → Q curve, the nozzle area, g, s and the L/min → m³/s conversion each exist once, in `physics.ts` / `units.ts`. The spec fails if a copy appears anywhere in `src`.
* **One copy removed.** It found one: the 3D carrier computed its load force as `seatedMassG * 9.81 / 1000` inline. That now goes through `gramsToNewtons(…, GRAVITY_MS2)`, like F_ac everywhere else. The number is unchanged.
* **One state, one set of numbers.** Driven through the runtime to the recorded first reading (n = 0.4, 80 g):
  * the live readout and the recorded row carry identical Q, V₀, V and F_th;
  * the CSV row reads `2,120.0,0.40,15.714,2.6191e-4,3.336,3.232,80,3.92,0.8199,0.7848`;
  * F_th 0.8199 N and mass 83.58 g are the workbook's own figures.

  The board, the monitor and the 3D rig read these selectors; none computes its own.

## 3. The workbook, audited from its values

These are findings to take to the file, not repairs. None of them changes the code, because the code follows the sheet's Flat block and its stated laws.

1. **`#NUM!` at n = 0 (rows 4 and 14; AF14).** V = √(V₀² − 2gs) with V₀ = 0 is √(−0.687).
   * The code treats a jet that cannot climb s as not reaching the deflector: V = 0, F_th = 0.
   * **Repair:** `=IF(T4^2<2*g*s, 0, SQRT(T4^2-2*g*s))`, and the same in each block.
2. **The Oblique 45 block is not computed from the Flat block's V.**
   * At n = 1, the Oblique block's V reads 23.632 against Flat's 23.631 for the same Q.
   * Its F_th values are 0.002–0.004 % above ρAV²·0.5 taken from Flat's V (21.9196 vs 21.9188 at n = 1).
   * So one block uses a different reference or constant. Y24→T15 and Y37→T29 sit exactly in this region, and **this needs the formulas.**
3. **The Oblique 45 "h (cm)" column (X14–X19) reads 0.25, 0.05, 0.10, 0.25, 0.00, 0.00.**
   * Rows 15–17 equal the Flat block's hW (X5–X7 = 5, 10, 25 mm) ÷ 100.
   * Rows 18–19 equal the empty X8–X9.
   * That looks like a reference into the Flat block, with mm → cm divided by 100 instead of 10.
   * For its own loads (0.05, 0.1, 0.2, 0.5 kg) the column should read 0.25, 0.49, 0.98, 2.45 cm.
4. **The Flat block's hF (cm) is F_th / k plus about 0.03 cm.**
   * It reads 0.44, 3.34, 12.70, 21.95 and 0.09, where F_th / k gives 0.41, 3.31, 12.67, 21.92 and 0.06.
   * The Oblique block's hF has no such offset.
   * The source of the extra 0.3 mm is not in the values; it needs the formula.
5. **"Ideal mass (g)" is not the balancing mass.**
   * Flat reads 0, 0, 150, 650, 1100 (Manual 200) against balancing masses of 83.58, 675.71, 2583.07 and 4468.66 g.
   * Oblique reads 0, 0, 100, 300, 550 (Manual 100).
   * F(ac) is consistently ideal mass × g, so the column is a load someone entered or referenced.
   * The code's F_ac is the load actually on the carrier × g, which is the same relation. Its balance target is the "mass (g)" column.
6. **Rows versus readings.**
   * The sheet tabulates n = 0, 0.2, …, 1.0. The lesson reads at n = 0.4 and 0.5; the 0.5 comes from the reference simulator's recorded row (`physics.ts` `ROW_VALVE_SETTINGS`).
   * It is the same curve, so Q(0.5) = 27.024 L/min is the sheet's mapping. Only the choice of rows differs.

## 4. Spring height versus the geometric stop (AC05)

`spring.ts` keeps them apart:

* `springHeightMm(F) = F / k` is a pure function of force.
* The travel limit and the mechanical stop are parameters the scene measures from the model. The domain holds no geometric number: s = 0.035 m is not used as a stop.

The spec pins this. Setting the actual stop value is still DEC03 / BLK-03.

## 5. Sequencing (AC06)

The state-binding items (F09–F15) are closed. The measurement sequence was rolled back to live Q at the user's request (F18, `docs/65`). The equation-level regression in §1–§2 was therefore run now, against the workbook values the user supplied.

## 6. What is still needed

* **The file `Logic(final) 2.xlsx`**, for:
  * Y38's `#REF!` (AC01);
  * the Y24→T15 and Y37→T29 audit, and items 2–4 of §3 (AC02).
* **DEC01, partly answered.** The code equals this workbook's Flat block. `Jet force_Mathematical model.xlsx` (the file `physics.ts` cites) is still not here to compare against. Approving `Logic(final) 2.xlsx`, Flat block, as the source is a one-line decision for BEDO.
