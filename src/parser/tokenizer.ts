/**
 * Simple tokenizer for TypeScript-like plan statements.
 *
 * Handles the minimal set of tokens needed for assignment statements:
 * - Identifiers
 * - Numbers (int and float)
 * - Strings (single, double, and template literals)
 * - Operators: = :
 * - Delimiters: ( ) [ ] { } , .
 * - Keywords: true, false, null, undefined, const, let
 * - Newlines and EOF
 */

export enum TokenType {
  // Literals
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',

  // Keywords
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  NULL = 'NULL',
  UNDEFINED = 'UNDEFINED',
  CONST = 'CONST',
  LET = 'LET',

  // Operators
  EQUALS = 'EQUALS',
  COLON = 'COLON',
  DOT = 'DOT',

  // Delimiters
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  COMMA = 'COMMA',

  // Control
  NEWLINE = 'NEWLINE',
  SEMICOLON = 'SEMICOLON',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  null: TokenType.NULL,
  undefined: TokenType.UNDEFINED,
  const: TokenType.CONST,
  let: TokenType.LET,
};

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  '=': TokenType.EQUALS,
  ':': TokenType.COLON,
  '.': TokenType.DOT,
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  '[': TokenType.LBRACKET,
  ']': TokenType.RBRACKET,
  '{': TokenType.LBRACE,
  '}': TokenType.RBRACE,
  ',': TokenType.COMMA,
  ';': TokenType.SEMICOLON,
};

/**
 * Tokenize a source string into tokens.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function peek(offset = 0): string {
    return source[pos + offset] ?? '';
  }

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  function addToken(type: TokenType, value: string, startColumn: number): void {
    tokens.push({ type, value, line, column: startColumn });
  }

  function isAlpha(ch: string): boolean {
    return /[a-zA-Z_]/.test(ch);
  }

  function isAlphaNumeric(ch: string): boolean {
    return /[a-zA-Z0-9_]/.test(ch);
  }

  function isDigit(ch: string): boolean {
    return /[0-9]/.test(ch);
  }

  function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\r';
  }

  function readString(quote: string): string {
    const startColumn = column;
    const isTemplate = quote === '`';

    advance(); // opening quote

    let value = '';

    while (pos < source.length) {
      if (peek() === quote) {
        advance();
        break;
      }

      // Template literals allow newlines, regular strings don't
      if (!isTemplate && peek() === '\n') {
        throw new Error(
          `Unterminated string at line ${line}, column ${startColumn}`
        );
      }

      // Handle escape sequences
      if (peek() === '\\') {
        advance();
        const escaped = advance();
        switch (escaped) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case 'r':
            value += '\r';
            break;
          case '\\':
            value += '\\';
            break;
          case "'":
            value += "'";
            break;
          case '"':
            value += '"';
            break;
          case '`':
            value += '`';
            break;
          default:
            value += escaped;
        }
      } else {
        value += advance();
      }
    }

    return value;
  }

  function readNumber(): string {
    let value = '';

    // Handle negative sign
    if (peek() === '-') {
      value += advance();
    }

    // Integer part
    while (isDigit(peek())) {
      value += advance();
    }

    // Decimal part
    if (peek() === '.' && isDigit(peek(1))) {
      value += advance(); // .
      while (isDigit(peek())) {
        value += advance();
      }
    }

    // Exponent part
    if (peek() === 'e' || peek() === 'E') {
      value += advance();
      if (peek() === '+' || peek() === '-') {
        value += advance();
      }
      while (isDigit(peek())) {
        value += advance();
      }
    }

    return value;
  }

  function readIdentifier(): string {
    let value = '';
    while (isAlphaNumeric(peek())) {
      value += advance();
    }
    return value;
  }

  function skipComment(): void {
    // Skip the // characters
    advance();
    advance();
    // Skip until end of line
    while (peek() !== '\n' && pos < source.length) {
      advance();
    }
  }

  while (pos < source.length) {
    const ch = peek();
    const startColumn = column;

    // Skip whitespace (but not newlines)
    if (isWhitespace(ch)) {
      advance();
      continue;
    }

    // Comments (// style)
    if (ch === '/' && peek(1) === '/') {
      skipComment();
      continue;
    }

    // Newlines
    if (ch === '\n') {
      addToken(TokenType.NEWLINE, '\n', startColumn);
      advance();
      continue;
    }

    // String literals (single, double, or template)
    if (ch === '"' || ch === "'" || ch === '`') {
      const value = readString(ch);
      addToken(TokenType.STRING, value, startColumn);
      continue;
    }

    // Numbers (including negative)
    if (isDigit(ch) || (ch === '-' && isDigit(peek(1)))) {
      const value = readNumber();
      addToken(TokenType.NUMBER, value, startColumn);
      continue;
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      const value = readIdentifier();
      const keywordType = KEYWORDS[value];
      if (keywordType) {
        addToken(keywordType, value, startColumn);
      } else {
        addToken(TokenType.IDENTIFIER, value, startColumn);
      }
      continue;
    }

    // Single character tokens
    const singleCharType = SINGLE_CHAR_TOKENS[ch];
    if (singleCharType) {
      addToken(singleCharType, ch, startColumn);
      advance();
      continue;
    }

    throw new Error(
      `Unexpected character '${ch}' at line ${line}, column ${column}`
    );
  }

  addToken(TokenType.EOF, '', column);
  return tokens;
}

/**
 * Format a token for debugging.
 */
export function tokenToString(token: Token): string {
  return `${token.type}(${JSON.stringify(token.value)}) at ${token.line}:${token.column}`;
}
