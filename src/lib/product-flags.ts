import type { BranchId } from "./settings";
import type { Product } from "../types";

export type ProductFlag = "exempt";

interface FlaggedProduct {
  code: string;
  name: string;
}

const EXEMPT_SHOP_123: FlaggedProduct[] = [
  { code: "46", name: "اسم قزاز طيران" },
  { code: "47", name: "اسم طيران تطريز" },
  { code: "48", name: "اسم طيران طباعة" },
  { code: "49", name: "اسم طيران ليزر" },
  { code: "71", name: "شعار ابريها كبير" },
  { code: "72", name: "شعار ابريها صغير" },
  { code: "73", name: "حديد داخلي" },
  { code: "74", name: "لياقة مكتبي" },
  { code: "79", name: "شعار بدله" },
  { code: "80", name: "سيف النخلا تطريز" },
  { code: "81", name: "سيف النخلا ليزر" },
  { code: "82", name: "سيف النخلا مخمل" },
  { code: "83", name: "سيف النخلا ربر" },
  { code: "108", name: "داسه بوستار" },
  { code: "109", name: "بوستار MEGNUM" },
  { code: "110", name: "شرطة عسكرية قطف" },
  { code: "111", name: "بوستار سيني ALTIMA" },
  { code: "1", name: "R.H بوستار" },
];

const EXEMPT_SHOP_4: FlaggedProduct[] = [
  { code: "39", name: "اسم طباعة" },
  { code: "40", name: "اسم تطريز" },
  { code: "41", name: "اسم ليزر" },
  { code: "42", name: "اسم مخمل" },
  { code: "43", name: "اسم CT" },
  { code: "44", name: "اسم حفر بلاستك" },
  { code: "45", name: "اسم قزاز" },
  { code: "46", name: "اسم قزاز طيران" },
  { code: "47", name: "اسم طيران تطريز" },
  { code: "48", name: "اسم طيران طباعة" },
  { code: "49", name: "اسم طيران ليزر" },
  { code: "", name: "شعار ابريها كبير" },
  { code: "72", name: "شعار ابريها صغير" },
  { code: "73", name: "حديد داخلي" },
  { code: "74", name: "لياقة مكتبي" },
  { code: "77", name: "سبلائت ساده" },
  { code: "78", name: "سبلائت قوي" },
  { code: "79", name: "شعار بدله" },
  { code: "80", name: "سيف النخلا تطريز" },
  { code: "81", name: "سيف النخلا ليزر" },
  { code: "82", name: "سيف النخلا مخمل" },
  { code: "83", name: "سيف النخلا ربر" },
  { code: "85", name: "بدله تقيف" },
  { code: "86", name: "بدله تفصيل مكتبي بدون قماش" },
  { code: "87", name: "بدله تفصيل موه بدون قماش" },
  { code: "88", name: "بدله تفصيل مضلي بدون قماش" },
  { code: "89", name: "بدله تفصيل ميداني هندي" },
  { code: "90", name: "بدله تفصيل مكتبي هندي" },
  { code: "91", name: "بدله تفصيل دوريات هندي" },
  { code: "92", name: "بدله تفصيل حرس الحدود امريكي" },
  { code: "93", name: "بدله تفصيل سجون امريكي" },
  { code: "94", name: "بدله تفصيل أمن البئي" },
  { code: "95", name: "بدله تفصيل أفواج الأمنية كوري" },
  { code: "96", name: "بدله تفصيل القوات الخاصة امريكي" },
  { code: "97", name: "بدله تفصيل جيش امريكي درجة اول سادة" },
  { code: "98", name: "بدله تفصيل جيش امريكي درجة اول مضلي" },
  { code: "99", name: "بدله تفصيل دبلوماسي سادة" },
  { code: "100", name: "بدله تفصيل دبلوماسي مضلي" },
  { code: "101", name: "بدله تفصيل منشات كوري" },
  { code: "102", name: "بدله تفصيل جيش امريكي ساده" },
  { code: "103", name: "بدله تفصيل جيش امريكي مضلي" },
  { code: "104", name: "بدله تفصيل جيش امريكي درجة واحد ساده" },
  { code: "105", name: "بدله تفصيل جيش امريكي درجة واحد مضلي" },
  { code: "106", name: "بدله تفصيل جوازات مكتبي" },
];

const NAME_ONLY_CODES = new Set(["1"]);

export function normalizeName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\u0640/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeCode(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
  return trimmed.toLowerCase();
}

export function flaggedList(branchId: BranchId): FlaggedProduct[] {
  return branchId === "shop-4" ? EXEMPT_SHOP_4 : EXEMPT_SHOP_123;
}

function indexes(branchId: BranchId): { names: Set<string>; codes: Set<string> } {
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const item of flaggedList(branchId)) {
    if (item.name) names.add(normalizeName(item.name));
    const code = normalizeCode(item.code);
    if (code && !NAME_ONLY_CODES.has(code)) codes.add(code);
  }
  return { names, codes };
}

export function productFlag(
  product: Pick<Product, "code" | "name">,
  branchId: BranchId,
): ProductFlag | null {
  const { names, codes } = indexes(branchId);
  if (product.name && names.has(normalizeName(product.name))) return "exempt";
  const code = normalizeCode(product.code);
  if (code && codes.has(code)) return "exempt";
  return null;
}

export function isBlockedProduct(product: Pick<Product, "code" | "name">, branchId: BranchId): boolean {
  return productFlag(product, branchId) != null;
}

export function allowedProducts(products: Product[], branchId: BranchId): Product[] {
  return products.filter((product) => product.price > 0 && !isBlockedProduct(product, branchId));
}

export function flagLabel(flag: ProductFlag | null, enabled = true): string {
  if (flag === "exempt") return "Exempt";
  return enabled ? "Enabled" : "Disabled";
}
