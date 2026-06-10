import { LEGACY_DEFAULT_POMODORO_FOCUS_COLOR } from './constants';

export function getThemeAccentColor(): string {
  const bodyStyle = getComputedStyle(activeDocument.body);
  const rootStyle = getComputedStyle(activeDocument.documentElement);
  const hue = getCssVariableNumber(bodyStyle, rootStyle, '--accent-h');
  const saturation = getCssVariableNumber(bodyStyle, rootStyle, '--accent-s');
  const lightness = getCssVariableNumber(bodyStyle, rootStyle, '--accent-l');

  if (hue !== null && saturation !== null && lightness !== null) {
    return hslToHex(hue, saturation, lightness);
  }

  const color = bodyStyle.getPropertyValue('--interactive-accent').trim();
  return cssColorToHex(color) || LEGACY_DEFAULT_POMODORO_FOCUS_COLOR;
}

function getCssVariableNumber(bodyStyle: CSSStyleDeclaration, rootStyle: CSSStyleDeclaration, name: string): number | null {
  const value = bodyStyle.getPropertyValue(name).trim() || rootStyle.getPropertyValue(name).trim();
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360;
  const normalizedSaturation = Math.min(1, Math.max(0, saturation / 100));
  const normalizedLightness = Math.min(1, Math.max(0, lightness / 100));

  const hueToRgb = (lowerBound: number, upperBound: number, hueOffset: number): number => {
    let adjusted = hueOffset;
    if (adjusted < 0) {
      adjusted += 1;
    }
    if (adjusted > 1) {
      adjusted -= 1;
    }
    if (adjusted < 1 / 6) {
      return lowerBound + (upperBound - lowerBound) * 6 * adjusted;
    }
    if (adjusted < 1 / 2) {
      return upperBound;
    }
    if (adjusted < 2 / 3) {
      return lowerBound + (upperBound - lowerBound) * (2 / 3 - adjusted) * 6;
    }
    return lowerBound;
  };

  const upperBound = normalizedLightness < 0.5
    ? normalizedLightness * (1 + normalizedSaturation)
    : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const lowerBound = 2 * normalizedLightness - upperBound;
  const red = hueToRgb(lowerBound, upperBound, normalizedHue + 1 / 3);
  const green = hueToRgb(lowerBound, upperBound, normalizedHue);
  const blue = hueToRgb(lowerBound, upperBound, normalizedHue - 1 / 3);

  return [red, green, blue]
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^/, '#');
}

function cssColorToHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return '';
  }

  return [match[1], match[2], match[3]]
    .map((channel) => Math.min(255, Math.max(0, Number(channel))).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^/, '#');
}
