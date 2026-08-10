/**
 * Todoist-style named colors for labels — mobile mirror of
 * `apps/desktop/src/lib/labelColors.ts`.
 *
 * `nimble-core`'s `labels` table stores a color *name* (e.g. "orange",
 * "gray"), not a hex value. Keep this map in sync with the desktop copy
 * (and the Rust hex table in `nimble-core/src/api/todoist_migration.rs`)
 * so a label's color resolves to the same swatch on both platforms.
 */
const LABEL_COLOR_HEX: Record<string, string> = {
  berry_red: '#b8255f',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#fad000',
  olive_green: '#afb83b',
  lime_green: '#7ecc49',
  green: '#299438',
  mint_green: '#6accbc',
  teal: '#158fad',
  sky_blue: '#14aaf5',
  light_blue: '#96c3eb',
  blue: '#4073ff',
  grape: '#884dff',
  violet: '#af38eb',
  lavender: '#eb96eb',
  magenta: '#e05194',
  salmon: '#ff8d85',
  charcoal: '#808080',
  // Rust's map only has "grey"; the default-label path writes the US
  // spelling ("gray"), so both keys are covered to avoid falling through
  // to DEFAULT_HEX for that common case.
  grey: '#b8b8b8',
  gray: '#b8b8b8',
  taupe: '#ccac93',
};

const DEFAULT_HEX = '#6366f1';

/** Resolves a stored label color name to its hex swatch. Unknown/legacy
 * names fall back to the same indigo default the Rust importer uses. */
export function labelColor(name: string): string {
  return LABEL_COLOR_HEX[name] ?? DEFAULT_HEX;
}
