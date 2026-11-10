const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+/gi,
  /\b(authorization\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi,
];

export function redactSecrets(value) {
  if (typeof value !== 'string') return value;
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, match => {
    const separator = match.match(/^([^:=]*[:=]\s*)/);
    return `${separator?.[1] ?? ''}[REDACTED]`;
  }), value);
}

export function containsSecretPattern(value) {
  if (typeof value === 'string') return SECRET_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
  if (Array.isArray(value)) return value.some(containsSecretPattern);
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsSecretPattern);
  return false;
}

export function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

export function truncateUtf8Tail(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
