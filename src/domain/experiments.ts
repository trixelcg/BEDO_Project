// The four experiments, transcribed from BEDO's Phase 2 documents
// (Exp.1 Flat surface / Exp.2 Semi-circular / Exp.3 Conical surface / Exp.4 Oblique surface).
//
// They share one procedure and differ only in which deflector goes on the rod, the force
// law that follows from its geometry, and the closing question.

import { DEFLECTORS, type AnchorKey, type DeflectorFamily } from './apparatus';

/** Which experiment is loaded — matches BEDO's four Phase 2 sheets. */
export type ExperimentId = DeflectorFamily;

export type QuizKind = 'mcq' | 'trueFalse';

export interface QuizQuestion {
  kind: QuizKind;
  promptEn: string;
  promptAr: string;
  optionsEn: string[];
  optionsAr: string[];
  /** Index into optionsEn/optionsAr. */
  answer: number;
  explainEn: string;
  explainAr: string;
}

/**
 * Stable identity for a step of the procedure.
 *
 * Content is keyed by name, not by position, so the lesson engine never has to ask "what
 * is step 7" — and `BEDO-019` can renumber the procedure without any code following it.
 */
export type StepId =
  | 'unscrew-cover'
  | 'install-deflector'
  | 'mount-cover'
  | 'power-on'
  | 'set-flow-reading-1'
  | 'balance-reading-1'
  | 'increase-flow-reading-2'
  | 'balance-reading-2'
  | 'open-monitor'
  | 'record-actual-force'
  | 'open-answer-sheet';

export interface ExperimentStep {
  /** Stable identity. Use this, never the number. */
  stepId: StepId;
  /** 1-based step number shown to the student. Display only. */
  id: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  /** Part of the rig this step is about — drives the highlight, arrow and camera. */
  target: AnchorKey | null;
  /** Observation the reference shows as a popup once the step is satisfied. */
  noticeEn?: string;
  noticeAr?: string;
}

export interface ExperimentDef {
  id: DeflectorFamily;
  nameEn: string;
  nameAr: string;
  /** Deflector angles this experiment can be run with. */
  angles: number[];
  /** Angle used unless the student picks another. */
  defaultAngle: number;
  /** The derivation, as printed in the experiment sheet. */
  lawEn: string;
  lawAr: string;
  objectiveEn: string;
  objectiveAr: string;
  quiz: QuizQuestion[];
}

const NOTICE_JET_PUSH = {
  en: 'Notice that the water jet pushes the deflector upward.',
  ar: 'لاحظ أن الماء الخارج من الفوهة يقوم بدفع العاكس لأعلى.',
};
const NOTICE_IMPINGE = {
  en: 'Notice the shape of water impinging the deflector.',
  ar: 'لاحظ شكل الماء بعد الاصطدام بالعاكس.',
};

/**
 * The guided procedure: eleven steps, shared by all four experiments — only the deflector
 * named in step 2 changes.
 *
 * This is BEDO's own sequence, from the four Phase 2 experiment sheets (`docs/32 §3`):
 * nine apparatus steps, then Calculate, then the closing step that opens the answer sheet.
 *
 * It used to be twelve. The extra one instructed the student to open the volumetric
 * control valve, which appears in **no** experiment sheet, is absent from the storyboard's
 * state tables, and was removed by BEDO from their own Unity build in October 2025. The
 * valve is still part of the rig and still operable — it simply is not a step. `docs/35`.
 */
export const buildSteps = (deflectorName: string, deflectorNameAr: string): ExperimentStep[] => [
  {
    stepId: 'unscrew-cover',
    id: 1,
    titleEn: 'Unscrew the upper plate',
    titleAr: 'فك اللوحة العلوية',
    bodyEn: 'Press the upper plate to unscrew it.',
    bodyAr: 'اضغط على الغطاء العلوي لفكه.',
    target: 'cover',
  },
  {
    stepId: 'install-deflector',
    id: 2,
    titleEn: 'Install the deflector',
    titleAr: 'تثبيت العاكس',
    bodyEn: `Drag the ${deflectorName} onto the rod to install it.`,
    bodyAr: `اسحب ${deflectorNameAr} لتركيبه في العمود من الأسفل.`,
    target: 'tray',
  },
  {
    stepId: 'mount-cover',
    id: 3,
    titleEn: 'Screw the tank cover',
    titleAr: 'إغلاق غطاء الخزان',
    bodyEn: 'Press the plate again to mount it to the tank.',
    bodyAr: 'اضغط على الغطاء مرة أخرى لتركيبها على الخزان.',
    target: 'cover',
  },
  {
    stepId: 'power-on',
    id: 4,
    titleEn: 'Power switch',
    titleAr: 'تشغيل الطاقة',
    bodyEn: 'Turn on the power switch of the unit.',
    bodyAr: 'قم بتشغيل مفتاح التشغيل الخاص بالوحدة.',
    target: 'power',
  },
  {
    stepId: 'set-flow-reading-1',
    id: 5,
    titleEn: 'Adjust the flow valve',
    titleAr: 'صمام التحكم في التدفق',
    bodyEn: 'Slightly open the flow control valve of the unit to control the flow rate.',
    bodyAr: 'قم بفتح صمام التحكم في التدفق الخاص بالوحدة قليلاً للتحكم في معدل التدفق.',
    target: 'flowValve',
    noticeEn: NOTICE_JET_PUSH.en,
    noticeAr: NOTICE_JET_PUSH.ar,
  },
  {
    stepId: 'balance-reading-1',
    id: 6,
    titleEn: 'Balance the pointer (reading 1)',
    titleAr: 'موازنة المؤشر (القراءة 1)',
    bodyEn: 'Add weights to balance the weight base with the pointer tip.',
    bodyAr: 'قم بإضافة الأوزان حتى تتوازن قاعدة الأوزان مع طرف المؤشر.',
    target: 'weights',
    noticeEn: NOTICE_IMPINGE.en,
    noticeAr: NOTICE_IMPINGE.ar,
  },
  {
    stepId: 'increase-flow-reading-2',
    id: 7,
    titleEn: 'Increase the flow rate',
    titleAr: 'زيادة تدفق المياه',
    bodyEn: 'Increase the opening of the flow control valve.',
    bodyAr: 'قم بزيادة فتحة صمام التحكم في التدفق.',
    target: 'flowValve',
    noticeEn: NOTICE_JET_PUSH.en,
    noticeAr: NOTICE_JET_PUSH.ar,
  },
  {
    stepId: 'balance-reading-2',
    id: 8,
    titleEn: 'Balance the pointer (reading 2)',
    titleAr: 'موازنة المؤشر (القراءة 2)',
    bodyEn: 'Add weights to balance the weight base with the pointer tip.',
    bodyAr: 'قم بإضافة الأوزان حتى تتوازن قاعدة الأوزان مع طرف المؤشر.',
    target: 'weights',
  },
  {
    stepId: 'open-monitor',
    id: 9,
    titleEn: 'Open the software monitor',
    titleAr: 'عرض شاشة المراقبة',
    bodyEn: 'Switch to the software monitor.',
    bodyAr: 'قم بالضغط على شاشة السوفت وير.',
    target: 'overview',
  },
  {
    stepId: 'record-actual-force',
    id: 10,
    titleEn: 'Record the actual force',
    titleAr: 'تسجيل القوة الفعلية',
    bodyEn: 'Click the “Calculate” button on the table to record the value of F_ac.',
    bodyAr: 'قم بالضغط على "Calculate" في الجدول لتسجيل قيمة F_ac.',
    target: null,
    noticeEn:
      'Notice the table readings and the graph between the actual force F_ac and the theoretical force F_th. You can use “Save Screen” and “Export Data” to keep the readings.',
    noticeAr:
      'لاحظ قراءات الجدول والمنحنى بين القوة الفعلية والقوة النظرية. يمكنك الضغط على "Save Screen" و "Export Data" لحفظ القراءات.',
  },
  {
    stepId: 'open-answer-sheet',
    id: 11,
    titleEn: 'You finished!',
    titleAr: 'لقد انتهيت!',
    // The closing instruction as BEDO's own experiment sheets write it. The app calls it
    // the answer sheet rather than the "Document" tab, because that is the control it has.
    bodyEn: 'Open the answer sheet to record and check your results.',
    bodyAr: 'افتح ورقة الإجابة لتسجيل نتائجك والتحقق منها.',
    target: null,
  },
];

export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: 'flat',
    nameEn: 'Exp. 1 — Flat surface deflector',
    nameAr: 'التجربة 1: العاكس المسطح',
    angles: [90],
    defaultAngle: 90,
    lawEn: 'F = ρAV × (V sin 90° − 0)  ⇒  F = ρAV²',
    lawAr: 'F = ρAV × (V sin 90° − 0)  ⇒  F = ρAV²',
    objectiveEn:
      'By Newton’s second law the jet force equals the rate of change of momentum. For a flat deflector (θ = 90°) the jet is turned through a right angle, so F = ρAV².',
    objectiveAr:
      'وفقاً لقانون نيوتن الثاني، فإن قوة النفث تساوي معدل تغير الزخم. بالنسبة للعاكس المسطح (θ = 90°) فإن F = ρAV².',
    quiz: [
      {
        kind: 'mcq',
        promptEn: 'If the flow velocity doubles, how does the force change?',
        promptAr: 'إذا تضاعفت سرعة التدفق، كيف تتغير القوة؟',
        optionsEn: ['It doubles', 'It triples', 'It quadruples'],
        optionsAr: ['تتضاعف', 'تتضاعف ثلاث مرات', 'تتضاعف أربع مرات'],
        answer: 2,
        explainEn: 'Force is proportional to the square of the velocity (F ∝ V²).',
        explainAr: 'القوة تتناسب طردياً مع مربع السرعة (F ∝ V²).',
      },
      {
        kind: 'mcq',
        promptEn: 'Why is the impact velocity V lower than the nozzle velocity V₀?',
        promptAr: 'لماذا تكون سرعة الاصطدام V أقل من سرعة الفوهة V₀؟',
        optionsEn: [
          'The jet loses energy to friction with the air',
          'The jet climbs 35 mm against gravity before it reaches the vane',
          'The nozzle narrows towards its outlet',
          'The deflector pushes back on the jet',
        ],
        optionsAr: [
          'يفقد النفث طاقته بالاحتكاك مع الهواء',
          'يرتفع النفث 35 مم ضد الجاذبية قبل وصوله إلى العاكس',
          'تضيق الفوهة عند مخرجها',
          'يدفع العاكس النفث للخلف',
        ],
        answer: 1,
        explainEn:
          'V = √(V₀² − 2gs) with s = 35 mm — the rise from the nozzle lip to the vane. Nothing else in the model takes energy from the jet.',
        explainAr: 'V = √(V₀² − 2gs) حيث s = 35 مم، وهو ارتفاع النفث من الفوهة إلى العاكس.',
      },
      {
        kind: 'trueFalse',
        promptEn:
          'At balance, the weights on the pan measure the jet force directly, because the pointer is back at its datum.',
        promptAr: 'عند التوازن، تقيس الأوزان قوة النفث مباشرة لأن المؤشر عاد إلى وضعه الأصلي.',
        optionsEn: ['True', 'False'],
        optionsAr: ['صحيح', 'خطأ'],
        answer: 0,
        explainEn:
          'A balanced pointer means the spring is back where it started, so the spring exerts the same force it did at rest and the weight of the discs equals the jet force.',
        explainAr:
          'عودة المؤشر إلى الصفر تعني أن الزنبرك عاد إلى وضعه الأصلي، فيصبح وزن الأثقال مساوياً لقوة النفث.',
      },
      {
        kind: 'mcq',
        promptEn: 'Which quantity does the volumetric tank measure, and how?',
        promptAr: 'ما الكمية التي يقيسها الخزان الحجمي، وكيف؟',
        optionsEn: [
          'The jet force, by weighing the collected water',
          'The flow rate, from the volume collected in a measured time',
          'The nozzle velocity, from the height the water reaches',
          'The pump pressure, from how fast the tank fills',
        ],
        optionsAr: [
          'قوة النفث، بوزن الماء المتجمع',
          'معدل التدفق، من الحجم المتجمع خلال زمن مقاس',
          'سرعة الفوهة، من ارتفاع الماء',
          'ضغط المضخة، من سرعة امتلاء الخزان',
        ],
        answer: 1,
        explainEn:
          'Q = ΔV / Δt. It is an independent check on the flowmeter — two ways of knowing the same number.',
        explainAr: 'Q = ΔV / Δt، وهو فحص مستقل لقراءة مقياس التدفق.',
      },
      {
        kind: 'mcq',
        promptEn:
          'Your measured force F_ac comes out a few per cent below the theoretical F_th. What is the most likely reason?',
        promptAr: 'جاءت القوة المقاسة F_ac أقل من النظرية F_th ببضعة بالمئة. ما السبب الأرجح؟',
        optionsEn: [
          'The theory ignores losses, and some jet momentum is lost as spray and friction',
          'The weights are heavier than their markings',
          'The flowmeter reads high by exactly that amount',
          'The measurement is wrong and should be discarded',
        ],
        optionsAr: [
          'النظرية تهمل الفواقد، ويُفقد جزء من زخم النفث في الرذاذ والاحتكاك',
          'الأثقال أثقل من قيمتها المكتوبة',
          'يقرأ مقياس التدفق أعلى من الحقيقة بنفس المقدار',
          'القياس خاطئ ويجب إهماله',
        ],
        answer: 0,
        explainEn:
          'A small shortfall is expected and is the point of comparing the two: the ideal model assumes the whole jet is turned and none of it is lost.',
        explainAr:
          'الفارق الصغير متوقع، فالنموذج المثالي يفترض انحراف النفث بالكامل دون أي فواقد.',
      },
    ],
  },
  {
    id: 'semi',
    nameEn: 'Exp. 2 — Semi-circular deflector',
    nameAr: 'التجربة 2: العاكس نصف الدائري',
    angles: [120, 180],
    defaultAngle: 180,
    lawEn: 'F = ρAV × (V cos α − V cos β)  ⇒  F = ρAV² (1 − cos β)',
    lawAr: 'F = ρAV × (V cos α − V cos β)  ⇒  F = ρAV² (1 − cos β)',
    objectiveEn:
      'For the semi-circular deflectors (α = 0°, β = 120° or 180°) the jet is turned back on itself, so F = ρAV²(1 − cos β) — up to twice the flat-plate force.',
    objectiveAr:
      'بالنسبة للعاكس نصف الدائري (α = 0°، β = 120° أو 180°) فإن F = ρAV²(1 − cos β).',
    quiz: [
      {
        kind: 'trueFalse',
        promptEn: 'When the flow increases, the upward force on the deflector increases.',
        promptAr: 'عند زيادة التدفق، تزداد القوة التي تدفع العاكس لأعلى.',
        optionsEn: ['True', 'False'],
        optionsAr: ['صحيح', 'خطأ'],
        answer: 0,
        explainEn: 'Greater flow means greater velocity, and F ∝ V².',
        explainAr: 'زيادة التدفق تعني زيادة السرعة، والقوة تتناسب مع مربع السرعة.',
      },
      {
        kind: 'mcq',
        promptEn:
          'The 180° hemisphere gives twice the force of the flat plate at the same flow. Why?',
        promptAr: 'يعطي نصف الكرة 180° ضعف قوة العاكس المسطح عند نفس التدفق. لماذا؟',
        optionsEn: [
          'It has twice the surface area',
          'It reverses the jet, so the momentum change is twice as large',
          'It is twice as heavy',
          'The water strikes it twice',
        ],
        optionsAr: [
          'لأن مساحته ضعف مساحة المسطح',
          'لأنه يعكس النفث، فيصبح تغير الزخم ضعفاً',
          'لأن وزنه ضعف وزن المسطح',
          'لأن الماء يصطدم به مرتين',
        ],
        answer: 1,
        explainEn:
          'k = 1 − cos β. At 90° the jet is stopped in its original direction (k = 1); at 180° it is sent back the way it came, so the momentum change is 2ṁV.',
        explainAr:
          'k = 1 − cos β. عند 90° يتوقف النفث (k = 1)، وعند 180° يعود من حيث أتى فيصبح تغير الزخم 2ṁV.',
      },
      {
        kind: 'mcq',
        promptEn: 'What is k for the 120° semi-circular deflector?',
        promptAr: 'ما قيمة k للعاكس نصف الدائري 120°؟',
        optionsEn: ['1.00', '1.50', '1.73', '2.00'],
        optionsAr: ['1.00', '1.50', '1.73', '2.00'],
        answer: 1,
        explainEn: '1 − cos 120° = 1 − (−0.5) = 1.5.',
        explainAr: 'المعامل k = 1 − cos 120° = 1 − (−0.5) = 1.5.',
      },
      {
        kind: 'trueFalse',
        promptEn:
          'Swapping the 120° deflector for the 180° one, at the same valve setting, needs more weight on the pan to balance.',
        promptAr: 'استبدال العاكس 120° بالعاكس 180° عند نفس فتحة الصمام يحتاج أوزاناً أكبر للتوازن.',
        optionsEn: ['True', 'False'],
        optionsAr: ['صحيح', 'خطأ'],
        answer: 0,
        explainEn:
          'The flow is unchanged, so only k changes: 2.0 against 1.5, a third more force and a third more mass.',
        explainAr: 'التدفق لم يتغير، وتتغير k فقط: 2.0 مقابل 1.5، أي قوة أكبر بالثلث.',
      },
      {
        kind: 'mcq',
        promptEn: 'Which pair of readings makes the best straight-line plot of F against Q²?',
        promptAr: 'أي زوج من القراءات يعطي أفضل خط مستقيم عند رسم F مقابل Q²؟',
        optionsEn: [
          'Two readings as close together as the valve allows',
          'Two readings well apart across the valve’s useful range',
          'One reading, taken twice',
          'Two readings taken with different deflectors',
        ],
        optionsAr: [
          'قراءتان متقاربتان قدر الإمكان',
          'قراءتان متباعدتان عبر المدى المفيد للصمام',
          'قراءة واحدة مكررة مرتين',
          'قراءتان بعاكسين مختلفين',
        ],
        answer: 1,
        explainEn:
          'A line through two nearby points is dominated by the error in each. Spreading them out is what makes the slope mean something — and a different deflector changes k, so the two points are not on the same line at all.',
        explainAr:
          'الخط بين نقطتين متقاربتين يتأثر بالخطأ في كل منهما. التباعد هو ما يجعل الميل ذا معنى، وتغيير العاكس يغير k فلا تقع النقطتان على خط واحد.',
      },
    ],
  },
  {
    id: 'conical',
    nameEn: 'Exp. 3 — Conical surface deflector',
    nameAr: 'التجربة 3: العاكس المخروطي',
    angles: [135],
    defaultAngle: 135,
    lawEn: 'F = ρAV × (V cos α − V cos β)  ⇒  F = 1.707 ρAV²',
    lawAr: 'F = ρAV × (V cos α − V cos β)  ⇒  F = 1.707 ρAV²',
    objectiveEn:
      'For the conical deflector (α = 0°, β = 135°) the momentum factor is 1 − cos 135° = 1.707, so F = 1.707 ρAV².',
    objectiveAr:
      'بالنسبة للعاكس المخروطي (α = 0°، β = 135°) فإن معامل الزخم يساوي 1.707، وبالتالي F = 1.707 ρAV².',
    quiz: [
      {
        kind: 'mcq',
        promptEn:
          'What is the purpose of using different deflector shapes (flat, semi-circular, conical)?',
        promptAr: 'ما الهدف من استخدام أشكال مختلفة للعاكس (مسطح، نصف دائري، مخروطي)؟',
        optionsEn: [
          'To change the water temperature',
          'To study how the deflection angle affects the reaction force',
          'To reduce the flow pressure',
          'To block the jet completely',
        ],
        optionsAr: [
          'لتغيير درجة حرارة الماء',
          'لدراسة تأثير زاوية الانحراف على القوة الناتجة',
          'لتقليل ضغط التدفق',
          'لحجب النفث تماماً',
        ],
        answer: 1,
        explainEn:
          'Each shape turns the jet through a different angle, which changes the momentum factor and so the reaction force.',
        explainAr: 'كل شكل يحرف النفث بزاوية مختلفة، مما يغير معامل الزخم وبالتالي القوة.',
      },
      {
        kind: 'mcq',
        promptEn: 'Where does the conical deflector’s factor of 1.707 come from?',
        promptAr: 'من أين يأتي معامل العاكس المخروطي 1.707؟',
        optionsEn: [
          'It is measured on the rig and has no formula',
          '1 − cos 135°',
          'sin² 135°',
          'The ratio of the cone’s area to the nozzle’s',
        ],
        optionsAr: [
          'يُقاس على الجهاز وليس له صيغة',
          '1 − cos 135°',
          'sin² 135°',
          'نسبة مساحة المخروط إلى مساحة الفوهة',
        ],
        answer: 1,
        explainEn: '1 − cos 135° = 1 + 0.7071 = 1.7071, which the spreadsheet carries as 1.707.',
        explainAr: '1 − cos 135° = 1 + 0.7071 = 1.7071، وتُكتب في الجدول 1.707.',
      },
      {
        kind: 'trueFalse',
        promptEn:
          'The conical deflector turns the jet further than the flat plate but not as far as the hemisphere.',
        promptAr: 'يحرف العاكس المخروطي النفث أكثر من المسطح وأقل من نصف الكرة.',
        optionsEn: ['True', 'False'],
        optionsAr: ['صحيح', 'خطأ'],
        answer: 0,
        explainEn: '135° sits between 90° and 180°, and so does its factor: 1 < 1.707 < 2.',
        explainAr: 'الزاوية 135° تقع بين 90° و180°، وكذلك معاملها: 1 < 1.707 < 2.',
      },
      {
        kind: 'mcq',
        promptEn: 'The nozzle bore is 10 mm. What is A, and why does it matter?',
        promptAr: 'قطر الفوهة 10 مم. ما قيمة A، ولماذا تهم؟',
        optionsEn: [
          '7.85 × 10⁻⁵ m² — it converts the flow Q into the jet velocity V₀ = Q/A',
          '10 × 10⁻³ m² — it is the force per unit pressure',
          '3.14 × 10⁻² m² — it is the deflector’s wetted area',
          'It does not matter; the force depends only on Q',
        ],
        optionsAr: [
          '7.85 × 10⁻⁵ م² — تحوّل التدفق Q إلى السرعة V₀ = Q/A',
          '10 × 10⁻³ م² — القوة لكل وحدة ضغط',
          '3.14 × 10⁻² م² — المساحة المبتلة من العاكس',
          'لا تهم، فالقوة تعتمد على Q فقط',
        ],
        answer: 0,
        explainEn:
          'A = π(d/2)² = 7.85 × 10⁻⁵ m². Every velocity in the experiment comes from Q/A, so the bore sets the whole scale of the result.',
        explainAr: 'A = π(d/2)² = 7.85 × 10⁻⁵ م²، وكل السرعات في التجربة تُحسب من Q/A.',
      },
      {
        kind: 'mcq',
        promptEn:
          'You record both readings and the two points do not fall on a line through the origin. What should you check first?',
        promptAr: 'سجّلت القراءتين ولم تقعا على خط يمر بنقطة الأصل. ما أول ما تتحقق منه؟',
        optionsEn: [
          'That the pointer was truly at its datum for both, and that no weight was left on the pan from the first',
          'That the room temperature is the same',
          'That the pump has been running for at least ten minutes',
          'Nothing — two points always make a line',
        ],
        optionsAr: [
          'أن المؤشر كان عند الصفر في القراءتين، وأن الأوزان لم تُترك من القراءة الأولى بالخطأ',
          'أن درجة حرارة الغرفة ثابتة',
          'أن المضخة تعمل منذ عشر دقائق على الأقل',
          'لا شيء، فنقطتان تصنعان خطاً دائماً',
        ],
        answer: 0,
        explainEn:
          'Two points do always make a line — the question is whether it passes through the origin, and an unbalanced pointer or a leftover disc is the usual reason it does not.',
        explainAr:
          'نقطتان تصنعان خطاً دائماً، والسؤال هو هل يمر بالأصل؛ وعدم توازن المؤشر أو بقاء ثقل من القراءة السابقة هو السبب المعتاد.',
      },
    ],
  },
  {
    id: 'oblique',
    nameEn: 'Exp. 4 — Oblique surface deflector',
    nameAr: 'التجربة 4: العاكس المنحرف',
    angles: [30, 45, 60],
    defaultAngle: 45,
    lawEn: 'F = ρAV × (V sin θ − 0),  Fx = F sin θ  ⇒  Fx = ρAV² sin²θ',
    lawAr: 'F = ρAV × (V sin θ − 0)،  Fx = F sin θ  ⇒  Fx = ρAV² sin²θ',
    objectiveEn:
      'For the oblique deflectors (θ = 30°, 45° or 60°) only the normal component acts, and resolving it back along the jet gives Fx = ρAV² sin²θ.',
    objectiveAr:
      'بالنسبة للعاكس المنحرف (θ = 30°، 45° أو 60°) فإن Fx = ρAV² sin²θ.',
    quiz: [
      {
        kind: 'mcq',
        promptEn: 'If you increase the angle from 45° to 60°, what will happen to the force?',
        promptAr: 'إذا زادت الزاوية من 45° إلى 60°، ماذا يحدث للقوة؟',
        optionsEn: ['It decreases', 'It stays the same', 'It increases'],
        optionsAr: ['تقل', 'تبقى كما هي', 'تزداد'],
        answer: 2,
        explainEn: 'sin²60° = 0.75 is greater than sin²45° = 0.5, so the force increases.',
        explainAr: 'sin²60° = 0.75 أكبر من sin²45° = 0.5، لذلك تزداد القوة.',
      },
      {
        kind: 'mcq',
        promptEn: 'Why is the oblique family’s factor sin²θ rather than 1 − cos θ?',
        promptAr: 'لماذا معامل العاكس المنحرف هو sin²θ وليس 1 − cos θ؟',
        optionsEn: [
          'Because the oblique deflector is smaller than the others',
          'Because only the component normal to the plate is turned, and that force is then resolved back along the jet — one sine each time',
          'Because the water leaves at a different speed',
          'It is a convention with no derivation',
        ],
        optionsAr: [
          'لأن العاكس المنحرف أصغر من غيره',
          'لأن المركبة العمودية على السطح وحدها تنحرف، ثم تُحلَّل القوة على اتجاه النفث — جيب في كل مرة',
          'لأن الماء يغادر بسرعة مختلفة',
          'إنه اصطلاح بلا اشتقاق',
        ],
        answer: 1,
        explainEn:
          'F = ρAV(V sin θ) normal to the plate, and F_x = F sin θ along the jet — hence sin²θ. Applying 1 − cos θ here would give 0.5 at 60° instead of 0.75.',
        explainAr:
          'F = ρAV(V sin θ) عمودياً على السطح، ثم F_x = F sin θ باتجاه النفث، ومن ثم sin²θ.',
      },
      {
        kind: 'trueFalse',
        promptEn:
          'At the same flow, the 30° oblique deflector needs a quarter of the weight the flat plate needs.',
        promptAr: 'عند نفس التدفق، يحتاج العاكس المنحرف 30° إلى ربع أوزان العاكس المسطح.',
        optionsEn: ['True', 'False'],
        optionsAr: ['صحيح', 'خطأ'],
        answer: 0,
        explainEn: 'sin²30° = 0.25 against the flat plate’s 1.0, and the mass scales with the force.',
        explainAr: 'sin²30° = 0.25 مقابل 1.0 للمسطح، والكتلة تتناسب مع القوة.',
      },
      {
        kind: 'mcq',
        promptEn:
          'The 30° deflector gives the smallest force of the seven. What does that make hardest about the reading?',
        promptAr: 'يعطي العاكس 30° أصغر قوة بين السبعة. ما الذي يجعله أصعب في القياس؟',
        optionsEn: [
          'The balancing mass is small, so the smallest disc is a larger share of it and the reading is coarser',
          'The jet cannot reach the deflector',
          'The flowmeter stops working at low force',
          'Nothing — a smaller force is easier to balance',
        ],
        optionsAr: [
          'كتلة التوازن صغيرة، فيصبح أصغر ثقل نسبة أكبر منها وتصبح القراءة أخشن',
          'لا يصل النفث إلى العاكس',
          'يتوقف مقياس التدفق عند القوى الصغيرة',
          'لا شيء، فالقوة الأصغر أسهل في الموازنة',
        ],
        answer: 0,
        explainEn:
          'Resolution is what suffers. The discs come in fixed steps, so the same 10 g is a small error against 260 g and a large one against 20 g.',
        explainAr:
          'الدقة هي ما يتأثر: الأثقال بخطوات ثابتة، فالـ 10 غ خطأ صغير أمام 260 غ وكبير أمام 20 غ.',
      },
      {
        kind: 'mcq',
        promptEn:
          'Across all four experiments, what is held constant so the deflector shape is the only thing being tested?',
        promptAr: 'عبر التجارب الأربع، ما الذي يبقى ثابتاً حتى يكون شكل العاكس هو المتغير الوحيد؟',
        optionsEn: [
          'The nozzle bore and the flow rate at which each reading is taken',
          'The mass on the pan',
          'The pointer deflection',
          'The number of weights used',
        ],
        optionsAr: [
          'قطر الفوهة ومعدل التدفق الذي تؤخذ عنده كل قراءة',
          'الكتلة على القاعدة',
          'انحراف المؤشر',
          'عدد الأثقال المستخدمة',
        ],
        answer: 0,
        explainEn:
          'Same bore, same two flows, so V is the same and every difference in F is k — which is the whole comparison.',
        explainAr:
          'نفس القطر ونفس معدلي التدفق، فتكون V واحدة ويصبح كل فارق في F راجعاً إلى k.',
      },
    ],
  },
];

export const getExperiment = (id: DeflectorFamily): ExperimentDef =>
  EXPERIMENTS.find((e) => e.id === id) ?? EXPERIMENTS[0];

/** Deflectors belonging to an experiment, in tray order. */
export const deflectorsFor = (id: DeflectorFamily) => DEFLECTORS.filter((d) => d.family === id);

/**
 * Is this deflector one the experiment is run with?
 *
 * **The single authority for `BUG-05`.** `angles` is transcribed from step 2 of each
 * experiment sheet — *"Drag the 90° flat deflector"*, *"the 120° or 180° semi-circular
 * deflector"*, *"the 135° conical surface deflector"*, *"the 45° oblique surface
 * deflector"* with objectives reading *"(θ = 30°, 45° or 60°)"* — so two of the four
 * genuinely offer a choice and two do not. Evidence in `docs/37 §2`.
 *
 * Nothing else may hold this mapping. Before BEDO-022 the panel enforced it by filtering
 * the list it rendered, which the 3D tray could not do, and the state machine said so in
 * a comment.
 */
export const isDeflectorInScope = (id: DeflectorFamily, deflectorId: number): boolean =>
  getExperiment(id).angles.includes(deflectorId);

/** The canonical count, per BEDO's four experiment sheets. Was 12 before BEDO-019. */
export const TOTAL_STEPS = 11;

/**
 * The worksheet the closing step opens, one per experiment.
 *
 * Keyed by experiment id, never by file order — `docs/35 §5`. Copied unmodified from
 * BEDO's Phase 2 delivery; provenance in `public/answer-sheets/README.txt`. Fetched on
 * demand, never at boot.
 *
 * Despite the name these are not answer keys: each is a blank worksheet the student fills
 * in by hand, computing Q, Vo, V^2, F_th and F_ac and plotting F against Q.
 */
export const ANSWER_SHEETS: Record<ExperimentId, string> = {
  flat: '/answer-sheets/flat.pdf',
  semi: '/answer-sheets/semi.pdf',
  conical: '/answer-sheets/conical.pdf',
  oblique: '/answer-sheets/oblique.pdf',
};

/** The worksheet for an experiment, or null when none has been delivered. */
export const answerSheetFor = (experimentId: ExperimentId): string | null =>
  ANSWER_SHEETS[experimentId] ?? null;
