function countChinese(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function countReplacement(text: string) {
  return (text.match(/�/g) ?? []).length;
}

function looksLikeUtf8Mojibake(text: string) {
  return /[ÃÂâçåæäöï]|â|ï¼|å|æ|ç|è¿/.test(text);
}

function scoreText(text: string) {
  return countChinese(text) * 3 - countReplacement(text);
}

function looksLikeUtf16AsciiMojibake(text: string) {
  return text.includes('\u0000') || /HrCg@b|w\u0000s\u0000l\u0000|M\u0000i\u0000c\u0000r\u0000o\u0000/.test(text);
}

export function repairUtf16AsciiMojibake(text: string) {
  if (!text || !looksLikeUtf16AsciiMojibake(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
    return scoreText(decoded) > scoreText(text) ? decoded : text;
  } catch {
    return text;
  }
}

export function repairUtf8Mojibake(text: string) {
  if (!text || !looksLikeUtf8Mojibake(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return scoreText(decoded) > scoreText(text) ? decoded : text;
  } catch {
    return text;
  }
}

export function normalizeDisplayText(text: string) {
  return repairUtf8Mojibake(repairUtf16AsciiMojibake(text));
}

export function normalizeRawLogText(rawText: string) {
  if (!rawText) {
    return '';
  }

  const normalized = rawText
    .split(/\r?\n/)
    .map((line) => normalizeDisplayText(line.replace(/^\[[^\]]+\]\[(stdout|stderr)\]\s?/i, '')))
    .join('\n')
    .replace(/\u0000/g, '');

  return normalizeDisplayText(normalized);
}
