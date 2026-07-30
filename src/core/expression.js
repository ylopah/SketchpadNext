const CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });

const FUNCTIONS = Object.freeze({
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  abs: Math.abs,
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sgn: Math.sign,
  sign: Math.sign,
  round: Math.round,
  trunc: Math.trunc,
  floor: Math.floor,
  ceil: Math.ceil,
});

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const operator = rest[0];
    if ("+-*/^(),".includes(operator)) {
      tokens.push({ type: operator, value: operator });
      index += 1;
      continue;
    }
    throw new Error(`表达式中包含无法识别的字符：${operator}`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

class Parser {
  constructor(source, variables) {
    this.tokens = tokenize(String(source ?? ""));
    this.index = 0;
    this.variables = variables;
  }

  current() { return this.tokens[this.index]; }

  consume(type) {
    if (this.current().type !== type) throw new Error(`表达式格式错误，期望 ${type}`);
    return this.tokens[this.index++];
  }

  parse() {
    const value = this.additive();
    if (this.current().type !== "eof") throw new Error("表达式末尾存在多余内容");
    if (!Number.isFinite(value)) throw new Error("表达式结果不是有限数值");
    return value;
  }

  additive() {
    let value = this.multiplicative();
    while (["+", "-"].includes(this.current().type)) {
      const operator = this.tokens[this.index++].type;
      const right = this.multiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  multiplicative() {
    let value = this.unary();
    while (["*", "/"].includes(this.current().type)) {
      const operator = this.tokens[this.index++].type;
      const right = this.unary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  unary() {
    if (this.current().type === "+") { this.index += 1; return this.unary(); }
    if (this.current().type === "-") { this.index += 1; return -this.unary(); }
    return this.power();
  }

  power() {
    const base = this.primary();
    if (this.current().type !== "^") return base;
    this.index += 1;
    return base ** this.unary();
  }

  primary() {
    if (this.current().type === "number") return this.tokens[this.index++].value;
    if (this.current().type === "(") {
      this.index += 1;
      const value = this.additive();
      this.consume(")");
      return value;
    }
    if (this.current().type !== "identifier") throw new Error("表达式缺少数值或变量");
    const name = this.tokens[this.index++].value;
    if (this.current().type === "(") {
      this.index += 1;
      const argument = this.additive();
      this.consume(")");
      const fn = FUNCTIONS[name.toLowerCase()];
      if (!fn) throw new Error(`不支持的函数：${name}`);
      return fn(argument);
    }
    const lower = name.toLowerCase();
    if (Object.hasOwn(CONSTANTS, lower)) return CONSTANTS[lower];
    if (!Object.hasOwn(this.variables, name)) throw new Error(`未知变量：${name}`);
    const value = Number(this.variables[name]);
    if (!Number.isFinite(value)) throw new Error(`变量 ${name} 不是有效数值`);
    return value;
  }
}

export function evaluateExpression(source, variables = {}) {
  return new Parser(source, variables).parse();
}

export function expressionIdentifiers(source) {
  const tokens = tokenize(String(source ?? ""));
  const identifiers = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    const lower = token.value.toLowerCase();
    if (tokens[index + 1]?.type === "(" || Object.hasOwn(CONSTANTS, lower)) continue;
    identifiers.add(token.value);
  }
  return [...identifiers];
}

export function validateIdentifier(value) {
  const normalized = String(value ?? "").trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : null;
}

export const supportedFunctions = Object.freeze(Object.keys(FUNCTIONS));
