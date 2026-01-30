/**
 * Plan parser for Python-like assignment statements.
 *
 * Parses a restricted subset of Python syntax:
 * - Assignment statements: var = expr or var: Type = expr
 * - Function calls: func(args, kwargs)
 * - Literals: numbers, strings, booleans, None
 * - Variable references
 * - Lists and dicts
 */

import { PlanParseError } from '../exceptions.js';
import type {
  Assignment,
  CallExpression,
  Expression,
  Plan,
  Statement,
} from './ast.js';
import { tokenize, Token, TokenType } from './tokenizer.js';

export class PlanParser {
  private tokens: Token[] = [];
  private pos = 0;
  private source = '';

  /**
   * Parse a source string into a Plan AST.
   */
  parse(source: string): Plan {
    this.source = source;
    this.tokens = tokenize(source);
    this.pos = 0;

    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (!this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          statements.push(stmt);
        }
      }
    }

    return { statements, source };
  }

  private parseStatement(): Statement | null {
    // Skip empty lines
    if (this.check(TokenType.NEWLINE) || this.check(TokenType.EOF)) {
      return null;
    }

    // Parse: variable = expression
    // Or:    variable: Type = expression
    const varToken = this.expect(
      TokenType.IDENTIFIER,
      'Expected variable name at start of statement'
    );
    const variable = varToken.value;
    const line = varToken.line;

    let typeAnnotation: string | undefined;

    // Check for type annotation
    if (this.match(TokenType.COLON)) {
      const typeToken = this.expect(
        TokenType.IDENTIFIER,
        'Expected type name after :'
      );
      typeAnnotation = typeToken.value;
    }

    this.expect(TokenType.EQUALS, "Expected '=' after variable name");

    const value = this.parseExpression();

    // Consume newline or EOF
    if (!this.check(TokenType.EOF)) {
      this.match(TokenType.NEWLINE);
    }

    return {
      type: 'assignment',
      variable,
      typeAnnotation,
      value,
      line,
    };
  }

  private parseExpression(): Expression {
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    // Number literal
    if (this.check(TokenType.NUMBER)) {
      const token = this.advance();
      return { type: 'number', value: parseFloat(token.value) };
    }

    // String literal
    if (this.check(TokenType.STRING)) {
      const token = this.advance();
      return { type: 'string', value: token.value };
    }

    // Boolean literals
    if (this.check(TokenType.TRUE)) {
      this.advance();
      return { type: 'boolean', value: true };
    }
    if (this.check(TokenType.FALSE)) {
      this.advance();
      return { type: 'boolean', value: false };
    }

    // None/null
    if (this.check(TokenType.NONE)) {
      this.advance();
      return { type: 'null' };
    }

    // List literal: [elem, elem, ...]
    if (this.check(TokenType.LBRACKET)) {
      return this.parseList();
    }

    // Dict literal: {key: value, ...}
    if (this.check(TokenType.LBRACE)) {
      return this.parseDict();
    }

    // Identifier (variable reference or function call)
    if (this.check(TokenType.IDENTIFIER)) {
      const token = this.advance();
      let expr: Expression = { type: 'identifier', name: token.value };

      // Check for attribute access (obj.attr) or method call (obj.method())
      while (this.match(TokenType.DOT)) {
        const attrToken = this.expect(
          TokenType.IDENTIFIER,
          'Expected attribute name after .'
        );

        // Check if this is a method call
        if (this.check(TokenType.LPAREN)) {
          // It's a method call like obj.method(args)
          // We'll treat this as a call with the full dotted name
          const callee = `${this.expressionToCallee(expr)}.${attrToken.value}`;
          return this.parseCallArgs(callee);
        }

        // Just attribute access
        expr = {
          type: 'attribute',
          object: expr,
          attribute: attrToken.value,
        };
      }

      // Check for function call
      if (this.check(TokenType.LPAREN)) {
        const callee = this.expressionToCallee(expr);
        return this.parseCallArgs(callee);
      }

      return expr;
    }

    const token = this.peek();
    throw new PlanParseError(
      `Unexpected token: ${token.type} '${token.value}'`,
      this.source,
      token.line,
      token.column
    );
  }

  private expressionToCallee(expr: Expression): string {
    if (expr.type === 'identifier') {
      return expr.name;
    }
    if (expr.type === 'attribute') {
      return `${this.expressionToCallee(expr.object)}.${expr.attribute}`;
    }
    throw new PlanParseError(
      'Invalid callee expression',
      this.source,
      this.peek().line,
      this.peek().column
    );
  }

  private parseCallArgs(callee: string): CallExpression {
    this.expect(TokenType.LPAREN, "Expected '(' after function name");

    const args: Expression[] = [];
    const kwargs: Record<string, Expression> = {};

    // Parse arguments
    let seenKwarg = false;

    while (!this.check(TokenType.RPAREN)) {
      // Check for keyword argument: name=value
      if (
        this.check(TokenType.IDENTIFIER) &&
        this.checkNext(TokenType.EQUALS)
      ) {
        seenKwarg = true;
        const name = this.advance().value;
        this.expect(TokenType.EQUALS, "Expected '=' in keyword argument");
        kwargs[name] = this.parseExpression();
      } else {
        // Positional argument
        if (seenKwarg) {
          throw new PlanParseError(
            'Positional argument cannot follow keyword argument',
            this.source,
            this.peek().line,
            this.peek().column
          );
        }
        args.push(this.parseExpression());
      }

      // Consume comma or break
      if (!this.check(TokenType.RPAREN)) {
        this.expect(TokenType.COMMA, "Expected ',' or ')' in argument list");
      }
    }

    this.expect(TokenType.RPAREN, "Expected ')' after arguments");

    return { type: 'call', callee, args, kwargs };
  }

  private parseList(): Expression {
    this.expect(TokenType.LBRACKET, "Expected '['");

    const elements: Expression[] = [];

    while (!this.check(TokenType.RBRACKET)) {
      elements.push(this.parseExpression());

      if (!this.check(TokenType.RBRACKET)) {
        this.expect(TokenType.COMMA, "Expected ',' or ']' in list");
      }
    }

    this.expect(TokenType.RBRACKET, "Expected ']' to close list");

    return { type: 'list', elements };
  }

  private parseDict(): Expression {
    this.expect(TokenType.LBRACE, "Expected '{'");

    const entries: Array<{ key: Expression; value: Expression }> = [];

    while (!this.check(TokenType.RBRACE)) {
      const key = this.parseExpression();
      this.expect(TokenType.COLON, "Expected ':' after dict key");
      const value = this.parseExpression();

      entries.push({ key, value });

      if (!this.check(TokenType.RBRACE)) {
        this.expect(TokenType.COMMA, "Expected ',' or '}' in dict");
      }
    }

    this.expect(TokenType.RBRACE, "Expected '}' to close dict");

    return { type: 'dict', entries };
  }

  // Token navigation helpers

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private peekNext(): Token {
    return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1];
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkNext(type: TokenType): boolean {
    return this.peekNext().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }

    const token = this.peek();
    throw new PlanParseError(
      `${message} (got ${token.type} '${token.value}')`,
      this.source,
      token.line,
      token.column
    );
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private skipNewlines(): void {
    while (this.match(TokenType.NEWLINE)) {
      // Skip
    }
  }
}
