// Copied from the web client's palettes and modes: the API imports nothing from it.
export const THEME_PALETTES = {
  brisa: "brisa",
  tinta: "tinta",
} as const;

export const THEME_MODES = {
  light: "light",
  dark: "dark",
  system: "system",
} as const;

export type ThemePalette = keyof typeof THEME_PALETTES;
export type ThemeMode = keyof typeof THEME_MODES;

export interface Theme {
  palette: ThemePalette;
  mode: ThemeMode;
}
