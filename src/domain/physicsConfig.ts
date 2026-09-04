/**
 * The physics choices BEDO owns.
 *
 * Every constant here selects between formulations that are each defensible and each
 * supported by a different source. They are gathered in one small file so the decision is
 * a one-line edit with the reasoning beside it, rather than an equation buried in
 * `physics.ts` that nobody dares touch.
 *
 * Nothing here is tuned. If a value needs to move, it moves because a document says so.
 */

/**
 * Which theoretical-force law the simulator uses.
 *
 * `legacyAV2`     F_th = k · ρ · A · V_impact²
 *                 The jet's cross-section at the vane is taken to be the nozzle's.
 *
 * `momentumFlux`  F_th = k · ρ · Q · V_impact
 *                 Momentum flux with the mass flow held constant, which is what
 *                 continuity gives: the jet slows as it climbs and therefore widens, so
 *                 its area at the vane is not the nozzle's.
 *
 * **The two disagree, and BEDO's own material backs the first.**
 * `Jet force_Mathematical model.xlsx`'s `Fth` column at n = 0.4 reads 0.819924835 N for
 * the flat plate, which is `ρ · A · V_impact²` to seven figures;
 * `tests/fixtures/bedo-reference.ts` transcribes that column and
 * `tests/unit/physics.spec.ts` pins it. The momentum-flux form gives 0.8464 N for the same
 * jet — about 3 % higher, and higher by a shrinking margin as the flow rises, because the
 * two agree exactly in the limit where the 35 mm climb costs no velocity.
 *
 * So the default is `legacyAV2`: it is what BEDO's curriculum tabulates, and changing what
 * a student's worksheet says the answer is is BEDO's decision, not this repository's.
 * `momentumFlux` is fully implemented and tested — flip this one constant.
 */
export type PhysicsModel = 'momentumFlux' | 'legacyAV2';
export const PHYSICS_MODEL: PhysicsModel = 'legacyAV2';

/**
 * How valve opening maps to flow.
 *
 * `powerLaw`         Q = Q_max · n^VALVE_EXPONENT. Smooth, monotonic, and documented by
 *                    two numbers rather than by four polynomial coefficients.
 * `bedoPolynomial`   The quartic transcribed from BEDO's reference simulator, which
 *                    `tests/fixtures/bedo-reference.ts` tabulates at n = 0, 0.2, … 1.0.
 *
 * The polynomial is not smooth in the range a student uses: it puts 40 % at 15.7 L/min and
 * 50 % at 27.0 L/min — a 72 % jump for a tenth of a turn — and then reaches 43.5 L/min by
 * 60 %. It is kept, and still pinned against BEDO's table, because it is their curve; it
 * is not the default because a valve that jumps like that is disorienting to operate.
 */
export type FlowCharacteristic = 'powerLaw' | 'bedoPolynomial';
export const FLOW_CHARACTERISTIC: FlowCharacteristic = 'powerLaw';

/** Exponent of the power-law characteristic. */
export const VALVE_EXPONENT = 1.5;

/**
 * Pump delivery at a fully open valve, in L/min.
 *
 * 40 L/min, not the reference simulator's 120. A real Armfield or TecQuipment impact-of-a-
 * jet bench runs at roughly 30–40 L/min, and the arithmetic says why the larger figure
 * cannot be right for this rig: at 120 L/min a fully open valve puts about 51 N on the
 * vane, which needs 5.2 kg of weights against a tray stocked to 500 g. At 40 L/min the
 * same valve gives 5.6 N — 572 g, which the discs can just reach.
 *
 * The two recorded readings are unaffected: their setpoints are derived from the flow they
 * are meant to record, so both still land on 15.714 and 27.024 L/min. See
 * `FIRST_READING_VALVE` in `physics.ts`.
 */
export const PUMP_MAX_FLOW_L_MIN = 40;

/** The range the Parameters tab offers for pump delivery, in L/min. */
export const PUMP_FLOW_RANGE_L_MIN = { min: 10, max: PUMP_MAX_FLOW_L_MIN, step: 1 } as const;
