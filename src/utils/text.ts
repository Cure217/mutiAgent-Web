function countChinese(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function countReadableAscii(text: string) {
  return (text.match(/[A-Za-z0-9]/g) ?? []).length;
}

function countControl(text: string) {
  return (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []).length;
}

function countReplacement(text: string) {
  return (text.match(/�/g) ?? []).length;
}

function looksLikeUtf8Mojibake(text: string) {
  return /[ÃÂâçåæäöï]|â|ï¼|å|æ|ç|è¿/.test(text);
}

function scoreText(text: string) {
  return countChinese(text) * 4 + countReadableAscii(text) - countReplacement(text) * 6 - countControl(text) * 4;
}

function looksLikeUtf16AsciiMojibake(text: string) {
  return text.includes('\u0000') || /HrCg@b|w\u0000s\u0000l\u0000|M\u0000i\u0000c\u0000r\u0000o\u0000/.test(text);
}

function encodeUtf16Le(text: string) {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

export function repairUtf8DecodedAsUtf16(text: string) {
  if (!text) {
    return text;
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(encodeUtf16Le(text));
    return scoreText(decoded) > scoreText(text) ? decoded : text;
  } catch {
    return text;
  }
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

export function normalizeTerminalText(text: string) {
  return repairUtf8Mojibake(repairUtf8DecodedAsUtf16(repairUtf16AsciiMojibake(text)));
}

export function stripAnsiEscapes(text: string) {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function normalizeMessageText(text: string) {
  if (!text) {
    return '';
  }
  return stripAnsiEscapes(normalizeTerminalText(text))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeDisplayText(text: string) {
  return normalizeMessageText(text);
}

const CODEX_PROMPT_ONLY = /^[>›]+$/;
const CODEX_CONTEXT_LINE = /^\d+%\s+context\s+left$/i;
const CODEX_SPINNER_LINE = /^[⠁-⣿]+(?:\s+.*)?$/;
const CODEX_BOX_DRAWING_ONLY = /^[╭╮╰╯│─╴╶┌┐└┘├┤┬┴┼_\s]+$/;
const CODEX_WORKING_FRAGMENT = /^(?:[\u2022\u25e6·]\s*)?(?:\d+|W|Wo|or|rk|ki|in|ng|Wng|Wog|Working?)$/i;
const CODEX_WORKING_LINE = /^(?:[\u2022\u25e6·]\s*)?Working\b.*$/i;
const CODEX_SHORT_ASCII_FRAGMENT = /^[\u2022\u25e6·A-Za-z0-9]+$/;

function stripCodexTrailingStatus(line: string) {
  return line
    .replace(/\s*tab to queue message.*$/i, '')
    .replace(/\s*\d+%\s+context\s+left.*$/i, '')
    .replace(/\s*gpt-[\w.-]+.*$/i, '')
    .trim();
}

function shouldSkipCodexLine(line: string) {
  if (!line) {
    return true;
  }

  const normalized = line.toLowerCase();
  const normalizedWithoutBox = normalized.replace(/^[╭╮╰╯│─╴╶┌┐└┘├┤┬┴┼_\s]+/g, '').trim();
    const compactLine = line.replace(/\s+/g, '');

    if (
    !normalizedWithoutBox
    || CODEX_PROMPT_ONLY.test(line)
      || CODEX_CONTEXT_LINE.test(line)
    || CODEX_SPINNER_LINE.test(line)
    || CODEX_BOX_DRAWING_ONLY.test(line)
    || CODEX_WORKING_FRAGMENT.test(line)
    || CODEX_WORKING_LINE.test(line)
    || (compactLine.length <= 4 && CODEX_SHORT_ASCII_FRAGMENT.test(compactLine))
  ) {
    return true;
  }

  return normalized.startsWith('›')
    || normalized.startsWith('>')
    || normalized.includes('›')
    || normalized.includes('tab to queue message')
    || normalized.includes('context left')
    || normalized.includes('esc to interrupt')
    || normalized.includes('press enter to continue')
    || normalized.includes('openai codex')
    || normalized.startsWith('gpt-')
    || normalizedWithoutBox.startsWith('model:')
    || normalizedWithoutBox.startsWith('directory:')
    || normalizedWithoutBox.includes('model:')
    || normalizedWithoutBox.includes('directory:');
}

export function cleanupCodexTuiMessage(text: string) {
  if (!text) {
    return '';
  }

  const cleanedLines = normalizeMessageText(text)
    .split('\n')
    .map((line) => stripCodexTrailingStatus(line.trim()))
    .filter((line) => !shouldSkipCodexLine(line));

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeRawLogText(rawText: string) {
  if (!rawText) {
    return '';
  }

  const normalized = rawText
    .split(/\r?\n/)
    .map((line) => normalizeTerminalText(line.replace(/^\[[^\]]+\]\[(stdout|stderr)\]\s?/i, '')))
    .join('\n')
    .replace(/\u0000/g, '');

  return normalizeTerminalText(normalized);
}
