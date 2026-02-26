declare const __SDK_VERSION__: string;

export const VERSION: string =
  typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0';
