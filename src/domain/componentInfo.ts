// What each part of the VL-FM009 rig is called and what it does — one definition (F17).
//
// The hover tooltip, the component card opened by a deliberate click, and the focus
// tooltip on the panel controls all read this module and nothing else. Before it, the
// scene composed its hover labels inline (`DeviceModel.labelFor`), named only six kinds of
// part, and had nothing to say about the tank cover, the pointer, the spring, the weight
// carrier or the bench's measuring scale.
//
// Every figure below is derived, not restated: the nozzle bore from `NOZZLE_AREA_M2`, the
// spring rate from `SPRING_RATE_N_PER_M`, a deflector's name and momentum factor from
// `DEFLECTORS`. The wording follows the lesson's own (`experiments.ts`): "weight base",
// "pointer tip", "flow control valve", «قاعدة الأوزان», «طرف المؤشر».
//
// Pure data and string functions: no scene, no React, no state (see domain-boundary.spec).

import { DEFLECTORS, WEIGHTS, getDeflector } from './apparatus';
import { NOZZLE_AREA_M2, SPRING_RATE_N_PER_M } from './physics';

export type ComponentLanguage = 'en' | 'ar';

/** Every reviewed part a learner can point at. */
export type ComponentKey =
  | 'tankCover'
  | 'nozzle'
  | 'deflector'
  | 'weightCarrier'
  | 'pointer'
  | 'spring'
  | 'weight'
  | 'flowValve'
  | 'volumetricValve'
  | 'powerSwitch'
  | 'flowmeter';

/**
 * Which part, and which one of it.
 *
 * `variant` is the deflector's id (its angle) or the weight's mass in grams. `installed`
 * distinguishes the deflector on the rod from the ones on the tray, and `onCarrier` a disc
 * already on the weight carrier from one on the tray: same part, different thing to do.
 */
export interface ComponentRef {
  key: ComponentKey;
  variant?: number;
  installed?: boolean;
  onCarrier?: boolean;
}

/** What a surface shows for a part, in one language. */
export interface ComponentText {
  /** The part's name — the tooltip's first line and the card's heading. */
  name: string;
  /** One short sentence: what it does. The tooltip's second line. */
  role: string;
  /** A few lines for the card: how it works and the numbers that matter. */
  details: string[];
  /** What the learner can do with it, or what to watch it for. */
  use: string;
  /** The tooltip's last line: how to open the card for this part. */
  hint: string;
}

type Bilingual = { en: string; ar: string };
type BilingualList = { en: string[]; ar: string[] };

interface ComponentEntry {
  /**
   * Whether pressing the part does something to the rig.
   *
   * Operational parts keep their click for the action, so their card opens on a right-click
   * (or a long press). Informational parts do nothing when pressed, so a plain click opens
   * their card. Hover is informational for both — it names the part and nothing else.
   */
  operational: boolean;
  name: Bilingual;
  role: Bilingual;
  details: BilingualList;
  use: Bilingual;
}

/**
 * A formula inside Arabic text, isolated left-to-right (U+2066 … U+2069).
 *
 * Without it the bidi algorithm reorders "Q = ΔV / Δt" around the Arabic words, and the
 * card read ". ΔV / Δt = Q :" — measured in the browser. Plain characters, so every
 * surface (tooltip, card, a screen reader) gets the same fixed text. Its spaces are
 * non-breaking, so a wrapped line cannot split a formula in two.
 */
export const ltr = (formula: string): string => `\u2066${formula.replace(/ /g, '\u00a0')}\u2069`;

/** The nozzle's bore, computed back out of the area the momentum equations use. */
export const nozzleBoreMm = (): number => 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000;

const isStandardWeight = (grams: number) => WEIGHTS.some((w) => w.grams === grams);

export const COMPONENTS: Record<ComponentKey, ComponentEntry> = {
  tankCover: {
    operational: true,
    name: { en: 'Tank cover (upper plate)', ar: 'غطاء الخزان (اللوحة العلوية)' },
    role: {
      en: 'Closes the top of the jet tank; the deflector rod passes through it.',
      ar: 'يغلق أعلى خزان النفث، ويمر عمود العاكس من خلاله.',
    },
    details: {
      en: [
        'Unscrew it to reach the rod and install a deflector.',
        'Screw it back on to run water: the pump will not start with it open, and it will not open while the pump runs or weights are on the carrier.',
      ],
      ar: [
        'فكّه للوصول إلى العمود وتركيب العاكس.',
        'أعد تركيبه لتشغيل المياه: لا تعمل المضخة وهو مفتوح، ولا يُفتح أثناء تشغيل المضخة أو بوجود أوزان على الحامل.',
      ],
    },
    use: { en: 'Click the cover to unscrew it or screw it back on.', ar: 'اضغط على الغطاء لفكّه أو إعادة تركيبه.' },
  },
  nozzle: {
    operational: false,
    name: { en: 'Nozzle', ar: 'الفوهة' },
    role: {
      en: 'Forms the vertical water jet that strikes the deflector.',
      ar: 'تُكوِّن نفث الماء الرأسي الذي يصطدم بالعاكس.',
    },
    details: { en: [], ar: [] }, // Built with the bore and area below.
    use: { en: 'Nothing to operate: the jet runs while the pump is on.', ar: 'لا يوجد ما يُشغَّل: يعمل النفث ما دامت المضخة تعمل.' },
  },
  deflector: {
    operational: true,
    name: { en: 'Deflector', ar: 'العاكس' },
    role: {
      en: 'Turns the jet through its angle; the change in the jet’s momentum is the force on it.',
      ar: 'يحرف النفث بزاويته؛ والتغيّر في كمية حركة النفث هو القوة المؤثرة عليه.',
    },
    details: { en: [], ar: [] }, // Built with the deflector's own factor below.
    use: { en: 'Drag it to the tank to install it on the rod.', ar: 'اسحبه إلى الخزان لتركيبه على العمود.' },
  },
  weightCarrier: {
    operational: false,
    name: { en: 'Weight carrier (weight base)', ar: 'حامل الأوزان (قاعدة الأوزان)' },
    role: {
      en: 'Holds the balancing weights on top of the deflector rod.',
      ar: 'يحمل أوزان الموازنة أعلى عمود العاكس.',
    },
    details: {
      en: [
        'The jet pushes the rod up; the weights on the carrier push it back down.',
        'Balanced when the carrier is level with the pointer tip: then F_ac = m·g.',
      ],
      ar: [
        'يدفع النفث العمود إلى أعلى، وتدفعه الأوزان الموضوعة على الحامل إلى أسفل.',
        `يتحقق التوازن عندما يستوي الحامل مع طرف المؤشر، وعندها ${ltr('F_ac = m·g')}.`,
      ],
    },
    use: {
      en: 'Add weights with the + buttons, or click a disc on the tray.',
      ar: 'أضف الأوزان بأزرار + أو بالضغط على قرص في الصينية.',
    },
  },
  pointer: {
    operational: false,
    name: { en: 'Pointer', ar: 'المؤشر' },
    role: {
      en: 'A fixed mark at the weight carrier’s rest height.',
      ar: 'علامة ثابتة عند ارتفاع حامل الأوزان في وضع السكون.',
    },
    details: {
      en: [
        'While the jet wins, the carrier sits above the tip; while the weights win, below it.',
        'Level with the tip, the weights balance the jet force.',
      ],
      ar: [
        'عندما يتغلب النفث يكون الحامل أعلى الطرف، وعندما تتغلب الأوزان يكون أسفله.',
        'عند استوائه مع الطرف تتوازن الأوزان مع قوة النفث.',
      ],
    },
    use: { en: 'Watch it while you add or remove weights.', ar: 'راقبه أثناء إضافة الأوزان أو إزالتها.' },
  },
  spring: {
    operational: false,
    name: { en: 'Deflector spring', ar: 'نابض العاكس' },
    role: {
      en: 'Supports the rod and carrier, and stretches as the jet pushes the deflector up.',
      ar: 'يحمل العمود والحامل، ويستطيل عندما يدفع النفث العاكس إلى أعلى.',
    },
    details: { en: [], ar: [] }, // Built with the spring rate below.
    use: { en: 'Nothing to operate: it responds to the jet and the weights.', ar: 'لا يوجد ما يُشغَّل: يستجيب للنفث والأوزان.' },
  },
  weight: {
    operational: true,
    name: { en: 'Weight', ar: 'وزن' },
    role: {
      en: 'A balancing mass: its weight m·g is set against the jet force.',
      ar: `كتلة موازنة: وزنها ${ltr('m·g')} يقابل قوة النفث.`,
    },
    details: {
      en: ['Weights stack on the carrier; only the top one can be taken off.'],
      ar: ['تُكدَّس الأوزان على الحامل، ولا يمكن إزالة إلا الوزن العلوي.'],
    },
    use: { en: 'Click it to put it on the weight carrier.', ar: 'اضغط عليه لوضعه على حامل الأوزان.' },
  },
  flowValve: {
    operational: true,
    name: { en: 'Flow control valve', ar: 'صمام التحكم في التدفق' },
    role: {
      en: 'Sets how much water the pump sends to the nozzle.',
      ar: 'يحدد كمية الماء التي ترسلها المضخة إلى الفوهة.',
    },
    details: {
      en: ['Opening it further raises the flow rate Q, and with it the jet velocity V₀ = Q / A.'],
      ar: [`كلما زاد فتحه زاد معدل التدفق ${ltr('Q')}، ومعه سرعة النفث ${ltr('V₀ = Q / A')}.`],
    },
    use: {
      en: 'Use the flow slider in the panel, or click the valve lever.',
      ar: 'استخدم منزلق التدفق في اللوحة، أو اضغط على ذراع الصمام.',
    },
  },
  volumetricValve: {
    operational: true,
    name: { en: 'Volumetric valve', ar: 'الصمام الحجمي' },
    role: {
      en: 'The drain valve of the tank the water collects in.',
      ar: 'صمام تصريف الخزان الذي يتجمع فيه الماء.',
    },
    details: {
      en: ['Opening it drains the water that has collected in the tank.'],
      ar: ['فتحه يصرّف الماء المتجمع في الخزان.'],
    },
    use: {
      en: 'Click the lever, or use “Open volumetric valve” in the panel.',
      ar: 'اضغط على الذراع، أو استخدم «فتح الصمام الحجمي» في اللوحة.',
    },
  },
  powerSwitch: {
    operational: true,
    name: { en: 'Power switch', ar: 'مفتاح الطاقة' },
    role: { en: 'Turns the pump on and off.', ar: 'يشغّل المضخة ويوقفها.' },
    details: {
      en: ['The green lamp beside it lights while the pump runs.'],
      ar: ['يضيء المصباح الأخضر بجانبه أثناء تشغيل المضخة.'],
    },
    use: { en: 'Click the switch to turn it.', ar: 'اضغط على المفتاح لتدويره.' },
  },
  flowmeter: {
    operational: false,
    name: { en: 'Flowmeter (volumetric scale)', ar: 'مقياس التدفق (المقياس الحجمي)' },
    role: {
      en: 'The scale on the bench’s measuring tank: it reads the volume of water collected.',
      ar: 'المقياس الموجود على خزان القياس في المنضدة: يقرأ حجم الماء المتجمع.',
    },
    details: {
      en: [
        'Timing a collected volume gives the flow rate: Q = ΔV / Δt.',
        'In this simulator Q follows the valve opening. The column shows the water collecting while the volumetric valve is shut — a picture only; no value is taken from it.',
      ],
      ar: [
        `قياس زمن تجمّع حجم معيّن يعطي معدل التدفق: ${ltr('Q = ΔV / Δt')}.`,
        `في هذا المحاكي يتبع ${ltr('Q')} فتحة الصمام. يُظهر العمود الماء المتجمع أثناء إغلاق الصمام الحجمي — للعرض فقط، ولا تؤخذ منه أي قيمة.`,
      ],
    },
    use: { en: 'Nothing to operate here.', ar: 'لا يوجد ما يُشغَّل هنا.' },
  },
};

/** Every key, in the order the card list and the tests enumerate them. */
export const COMPONENT_KEYS = Object.keys(COMPONENTS) as ComponentKey[];

/**
 * The stable anchor id a popup is attached to: `vlfm009.<part>[.<variant>]`.
 *
 * Stable across reloads, languages and re-exports of the model — it names the part, not a
 * mesh. The scene resolves it to the part's measured position each frame.
 */
export const anchorIdOf = (ref: ComponentRef): string => {
  const part = ref.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const where = ref.key === 'deflector' ? (ref.installed ? '.installed' : '.tray') : ref.key === 'weight' ? (ref.onCarrier ? '.carrier' : '.tray') : '';
  return `vlfm009.${part}${where}${ref.variant !== undefined ? `.${ref.variant}` : ''}`;
};

/** Whether pressing this part acts on the rig. The installed deflector is only looked at. */
export const isOperational = (ref: ComponentRef): boolean =>
  ref.key === 'deflector' && ref.installed ? false : COMPONENTS[ref.key].operational;

/** Right-click (or a long press on touch) opens the card on every part. */
const HINT = {
  operational: { en: 'Right-click for details', ar: 'انقر بالزر الأيمن للتفاصيل' },
  informational: { en: 'Click or right-click for details', ar: 'اضغط أو انقر بالزر الأيمن للتفاصيل' },
};

const fmt = (n: number, digits: number) => n.toFixed(digits);

/** The text every surface shows for one part, in one language. */
export function describeComponent(
  ref: ComponentRef,
  lang: ComponentLanguage,
  options: {
    /**
     * Whether a plain click on the part would open its card. True by default for the
     * informational parts; false where the part sits inside a control's click area (the
     * spring and the carrier are inside the tank cover's), so the hint never promises a
     * click that would instead act on the rig.
     */
    clickOpens?: boolean;
  } = {}
): ComponentText {
  const entry = COMPONENTS[ref.key];
  const ar = lang === 'ar';
  let name = entry.name[lang];
  let details = [...entry.details[lang]];
  let use = entry.use[lang];

  switch (ref.key) {
    case 'nozzle': {
      const bore = nozzleBoreMm();
      // `غ`/`مم` as the app's own Arabic strings write units.
      name = ar ? `الفوهة — قطر ${fmt(bore, 0)} مم` : `Nozzle — ${fmt(bore, 0)} mm bore`;
      const area = NOZZLE_AREA_M2.toExponential(2).replace('e-', ' × 10⁻').replace(/⁻(\d)/, (_, d) => `⁻${'⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]}`);
      details = ar
        ? [`مساحة الفتحة ${ltr(`A = ${area} m²`)}`, `سرعة النفث عند الفوهة ${ltr('V₀ = Q / A')}.`]
        : [`Bore area A = ${area} m²`, 'Jet velocity at the nozzle: V₀ = Q / A.'];
      break;
    }
    case 'deflector': {
      const d = ref.variant !== undefined ? getDeflector(ref.variant) : undefined;
      if (d) {
        name = ar ? d.nameAr : d.nameEn;
        details = ar
          ? [`معامل كمية الحركة ${ltr(`k = ${d.momentumFactor}`)}، و ${ltr('F_th = k·ρ·A·V²')}.`]
          : [`Momentum factor k = ${d.momentumFactor}: F_th = k·ρ·A·V².`];
      }
      if (ref.installed) {
        use = ar
          ? 'مركّب على العمود؛ يدفعه النفث إلى أعلى.'
          : 'Installed on the rod; the jet pushes it upward.';
      }
      break;
    }
    case 'spring':
      details = ar
        ? [`الصلابة ${ltr(`k = ${SPRING_RATE_N_PER_M} N/m`)}.`, 'يرتفع العاكس مع النفث وينخفض مع الأوزان.']
        : [`Stiffness k = ${SPRING_RATE_N_PER_M} N/m.`, 'The deflector rises with the jet and falls back with the weights.'];
      break;
    case 'weight': {
      const g = ref.variant;
      if (g !== undefined) {
        // The custom weight names itself, not the mass it happens to be set to (F04).
        name = !isStandardWeight(g) ? (ar ? 'وزن مخصص' : 'Custom weight') : ar ? `وزن ${g} غ` : `${g} g`;
      }
      if (ref.onCarrier) {
        use = ar
          ? 'على حامل الأوزان. اسحب الوزن العلوي لإزالته، أو استخدم أزرار − في اللوحة.'
          : 'On the weight carrier. Drag the top one off, or use the − buttons in the panel.';
      }
      break;
    }
    default:
      break;
  }

  return {
    name,
    role: entry.role[lang],
    details,
    use,
    hint: ((options.clickOpens ?? !isOperational(ref)) ? HINT.informational : HINT.operational)[lang],
  };
}

/** Every deflector id, for enumerating the tray's parts. */
export const DEFLECTOR_IDS = DEFLECTORS.map((d) => d.id);
