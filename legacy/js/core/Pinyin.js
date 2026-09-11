/**
 * Pinyin - lightweight, self-contained helper that maps the first character
 * of a Chinese label to its pinyin initial (first letter), used by the
 * Notebook app's "按拼音首字" grouping mode.
 *
 * This intentionally avoids pulling in a full pinyin library/dependency:
 * it ships a small lookup table covering the characters used by this
 * project's demo data, plus a generic fallback for any other character.
 * Extend `FIRST_CHAR_TO_INITIAL` as new keyword labels are added.
 */
const FIRST_CHAR_TO_INITIAL = {
  发: "F",
  咳: "K",
  失: "S",
  头: "T",
  眩: "X",
  神: "S",
  深: "S",
  旧: "J",
  夜: "Y",
  功: "G",
  流: "L",
  高: "G",
  地: "D",
};

/**
 * Resolve the pinyin initial (A-Z) for a label's first character.
 * Falls back to the upper-cased first character itself (e.g. for latin
 * text) or "#" when no reasonable initial can be determined.
 * @param {string} label
 * @returns {string}
 */
export function getPinyinInitial(label) {
  if (!label) return "#";
  const firstChar = [...label][0];
  if (FIRST_CHAR_TO_INITIAL[firstChar]) {
    return FIRST_CHAR_TO_INITIAL[firstChar];
  }
  const upper = firstChar.toUpperCase();
  if (upper >= "A" && upper <= "Z") return upper;
  return "#";
}
