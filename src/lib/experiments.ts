// The four experiments, transcribed from BEDO's Phase 2 documents
// (Exp.1 Flat surface / Exp.2 Semi-circular / Exp.3 Conical surface / Exp.4 Oblique surface).
//
// They share one procedure and differ only in which deflector goes on the rod, the force
// law that follows from its geometry, and the closing question.

import { DEFLECTORS, type AnchorKey, type DeflectorFamily } from './apparatus';

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

export interface ExperimentStep {
  /** 1-based step number shown to the student. */
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
 * The guided procedure. Every experiment runs the same twelve steps; only the deflector
 * named in step 2 changes.
 *
 * Steps 1-10 follow the shipped reference simulator. Steps 11 and 12 come from the
 * experiment sheets and were missing entirely: the student must press Calculate to record
 * F_ac, then open the answer sheet.
 */
export const buildSteps = (deflectorName: string, deflectorNameAr: string): ExperimentStep[] => [
  {
    id: 1,
    titleEn: 'Unscrew the upper plate',
    titleAr: 'فك اللوحة العلوية',
    bodyEn: 'Press the upper plate to unscrew it.',
    bodyAr: 'اضغط على الغطاء العلوي لفكه.',
    target: 'cover',
  },
  {
    id: 2,
    titleEn: 'Install the deflector',
    titleAr: 'تثبيت العاكس',
    bodyEn: `Drag the ${deflectorName} onto the rod to install it.`,
    bodyAr: `اسحب ${deflectorNameAr} لتركيبه في العمود من الأسفل.`,
    target: 'tray',
  },
  {
    id: 3,
    titleEn: 'Screw the tank cover',
    titleAr: 'إغلاق غطاء الخزان',
    bodyEn: 'Press the plate again to mount it to the tank.',
    bodyAr: 'اضغط على الغطاء مرة أخرى لتركيبها على الخزان.',
    target: 'cover',
  },
  {
    id: 4,
    titleEn: 'Power switch',
    titleAr: 'تشغيل الطاقة',
    bodyEn: 'Turn on the power switch of the unit.',
    bodyAr: 'قم بتشغيل مفتاح التشغيل الخاص بالوحدة.',
    target: 'power',
  },
  {
    id: 5,
    titleEn: 'Volumetric valve',
    titleAr: 'صمام التحكم الحجمي',
    bodyEn: 'Slightly open the volumetric control valve of the unit.',
    bodyAr: 'افتح صمام التحكم الحجمي للوحدة قليلاً.',
    target: 'volumetricValve',
  },
  {
    id: 6,
    titleEn: 'Adjust the flow valve',
    titleAr: 'صمام التحكم في التدفق',
    bodyEn: 'Slightly open the flow control valve of the unit to control the flow rate.',
    bodyAr: 'قم بفتح صمام التحكم في التدفق الخاص بالوحدة قليلاً للتحكم في معدل التدفق.',
    target: 'flowValve',
    noticeEn: NOTICE_JET_PUSH.en,
    noticeAr: NOTICE_JET_PUSH.ar,
  },
  {
    id: 7,
    titleEn: 'Balance the pointer (reading 1)',
    titleAr: 'موازنة المؤشر (القراءة 1)',
    bodyEn: 'Add weights to balance the weight base with the pointer tip.',
    bodyAr: 'قم بإضافة الأوزان حتى تتوازن قاعدة الأوزان مع طرف المؤشر.',
    target: 'weights',
    noticeEn: NOTICE_IMPINGE.en,
    noticeAr: NOTICE_IMPINGE.ar,
  },
  {
    id: 8,
    titleEn: 'Increase the flow rate',
    titleAr: 'زيادة تدفق المياه',
    bodyEn: 'Increase the opening of the flow control valve.',
    bodyAr: 'قم بزيادة فتحة صمام التحكم في التدفق.',
    target: 'flowValve',
    noticeEn: NOTICE_JET_PUSH.en,
    noticeAr: NOTICE_JET_PUSH.ar,
  },
  {
    id: 9,
    titleEn: 'Balance the pointer (reading 2)',
    titleAr: 'موازنة المؤشر (القراءة 2)',
    bodyEn: 'Add weights to balance the weight base with the pointer tip.',
    bodyAr: 'قم بإضافة الأوزان حتى تتوازن قاعدة الأوزان مع طرف المؤشر.',
    target: 'weights',
  },
  {
    id: 10,
    titleEn: 'Open the software monitor',
    titleAr: 'عرض شاشة المراقبة',
    bodyEn: 'Switch to the software monitor.',
    bodyAr: 'قم بالضغط على شاشة السوفت وير.',
    target: 'overview',
  },
  {
    id: 11,
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
    id: 12,
    titleEn: 'You finished!',
    titleAr: 'لقد انتهيت!',
    bodyEn: 'Answer the question below to complete the experiment.',
    bodyAr: 'أجب عن السؤال أدناه لإكمال التجربة.',
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
    ],
  },
];

export const getExperiment = (id: DeflectorFamily): ExperimentDef =>
  EXPERIMENTS.find((e) => e.id === id) ?? EXPERIMENTS[0];

/** Deflectors belonging to an experiment, in tray order. */
export const deflectorsFor = (id: DeflectorFamily) => DEFLECTORS.filter((d) => d.family === id);

export const TOTAL_STEPS = 12;
