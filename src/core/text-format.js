const COMMAND_SYMBOLS = Object.freeze({
  "->": "→",
  "=>": "⇒",
  "1/2": "½",
  "<": "∠",
  angle: "∠",
  rightangle: "∟",
  degree: "°",
  lte: "≤",
  gte: "≥",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  perp: "⟂",
  parallel: "∥",
  cong: "≅",
  sim: "∼",
  neq: "≠",
  ne: "≠",
  le: "≤",
  ge: "≥",
  pm: "±",
  times: "×",
  cdot: "·",
  infty: "∞",
  infinity: "∞",
  approx: "≈",
  in: "∈",
  notin: "∉",
  sqrt: "√",
  therefore: "∴",
  because: "∵",
  leftarrow: "←",
  rightarrow: "→",
  leftrightarrow: "↔",
});

const ESCAPED_LITERALS = new Set(["\\", "_", "^", "{", "}", "[", "]"]);

function appendSegment(segments, text, script = "normal", decoration = null) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.script === script && (previous.decoration || null) === decoration) {
    previous.text += text;
    return;
  }
  const segment = { text, script };
  if (decoration) segment.decoration = decoration;
  segments.push(segment);
}

function matchingBrace(source, openingIndex) {
  if (source[openingIndex] !== "{") return -1;
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === "\\" && ESCAPED_LITERALS.has(source[index + 1])) {
      index += 1;
      continue;
    }
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseDecoration(source, index, options) {
  const command = "\\overline";
  if (!source.startsWith(command, index) || source[index + command.length] !== "{") return null;
  const opening = index + command.length;
  const end = matchingBrace(source, opening);
  if (end < 0) return null;
  const inner = parseMathText(source.slice(opening + 1, end), {
    ...options,
    legacyBracketSubscript: false,
    enableScripts: true,
  });
  return { segments: inner, next: end + 1, decoration: "overline" };
}

function symbolForCommand(command) {
  return Object.prototype.hasOwnProperty.call(COMMAND_SYMBOLS, command)
    ? COMMAND_SYMBOLS[command]
    : null;
}

function parseCommand(source, index) {
  if (source[index] === "\\") {
    const escaped = source[index + 1];
    if (ESCAPED_LITERALS.has(escaped)) return { text: escaped, next: index + 2 };
    const match = source.slice(index + 1).match(/^([A-Za-z]+|->|=>|1\/2|<)/);
    if (!match) return null;
    const symbol = symbolForCommand(match[1]);
    return symbol === null ? null : { text: symbol, next: index + match[0].length + 1 };
  }
  if (source[index] === "{") {
    const end = source.indexOf("}", index + 1);
    if (end < 0) return null;
    const command = source.slice(index + 1, end);
    const symbol = symbolForCommand(command);
    return symbol === null ? null : { text: symbol, next: end + 1 };
  }
  return null;
}

function parseScriptAtom(source, index) {
  if (index >= source.length) return null;
  const command = parseCommand(source, index);
  if (command) return command;
  const opening = source[index];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (closing) {
    const end = source.indexOf(closing, index + 1);
    if (end < 0) return null;
    const inner = parseMathText(source.slice(index + 1, end), { legacyBracketSubscript: false });
    return { text: inner.map((segment) => segment.text).join(""), next: end + 1 };
  }
  const tail = source.slice(index);
  const number = tail.match(/^\d+(?:[.,]\d+)?/);
  if (number) return { text: number[0], next: index + number[0].length };
  const [character] = Array.from(tail);
  return character ? { text: character, next: index + character.length } : null;
}

/**
 * Convert lightweight geometry-label markup into SVG-friendly text runs.
 *
 * Supported forms include A_1, x^{2}, the legacy A[1] label syntax,
 * GSP-style {alpha}/{angle} codes, and TeX-style \\alpha/\\angle commands.
 */
export function parseMathText(value, options = {}) {
  const source = String(value ?? "");
  const legacyBracketSubscript = options.legacyBracketSubscript === true;
  const enableScripts = options.enableScripts === true || legacyBracketSubscript;
  if (legacyBracketSubscript) {
    const legacy = source.match(/^(.*)\[([^\]\r\n]+)\]$/s);
    if (legacy) {
      const result = parseMathText(legacy[1], { legacyBracketSubscript: false, enableScripts: true });
      const subscript = parseMathText(legacy[2], { legacyBracketSubscript: false })
        .map((segment) => segment.text).join("");
      appendSegment(result, subscript, "sub");
      return result;
    }
  }

  const segments = [];
  let index = 0;
  while (index < source.length) {
    const decoration = parseDecoration(source, index, options);
    if (decoration) {
      for (const segment of decoration.segments) {
        appendSegment(
          segments,
          segment.text,
          segment.script,
          segment.decoration || decoration.decoration,
        );
      }
      index = decoration.next;
      continue;
    }
    const command = parseCommand(source, index);
    if (command) {
      appendSegment(segments, command.text);
      index = command.next;
      continue;
    }
    const marker = source[index];
    if (enableScripts && (marker === "_" || marker === "^")) {
      const atom = parseScriptAtom(source, index + 1);
      if (atom?.text) {
        appendSegment(segments, atom.text, marker === "_" ? "sub" : "super");
        index = atom.next;
        continue;
      }
    }
    if (enableScripts && marker === "{" && source[index + 1] === "^") {
      const end = source.indexOf("}", index + 2);
      if (end >= 0) {
        appendSegment(segments, source.slice(index + 2, end), "super");
        index = end + 1;
        continue;
      }
    }
    appendSegment(segments, marker);
    index += marker.length;
  }
  return segments;
}

export function plainMathText(value, options = {}) {
  return parseMathText(value, options).map((segment) => segment.text).join("");
}
