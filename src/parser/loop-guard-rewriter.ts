/**
 * Loop guard rewriter using the TypeScript transformation API.
 *
 * Injects iteration counters into for/while/do-while/for-of loops
 * to prevent infinite loops in generated plans. Analogous to the
 * .NET LoopGuard Roslyn syntax rewriter.
 *
 * Uses ts.transform() with a TransformerFactory — no hand-written AST
 * manipulation, everything goes through the official TypeScript API.
 */

import ts from 'typescript';

/**
 * Inject loop guards into a parsed plan's AST.
 *
 * Transforms loops to include iteration counters that throw
 * when maxIterations is exceeded.
 *
 * @returns A new SourceFile with loop guards injected.
 */
export function injectLoopGuards(
  sourceFile: ts.SourceFile,
  maxIterations: number
): ts.SourceFile {
  const counter = { value: 0 };

  const result = ts.transform(sourceFile, [
    createLoopGuardTransformer(maxIterations, counter),
  ]);

  const transformed = result.transformed[0] as ts.SourceFile;
  result.dispose();

  // Re-parse to get a clean SourceFile with proper positions
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printed = printer.printFile(transformed);

  return ts.createSourceFile(
    'plan.ts',
    printed,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function createLoopGuardTransformer(
  maxIterations: number,
  counter: { value: number }
): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => {
    const { factory } = context;

    function visit(node: ts.Node): ts.Node {
      // Transform loop statements
      if (
        ts.isForStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isForOfStatement(node)
      ) {
        return transformLoop(node, factory, maxIterations, counter, context);
      }

      return ts.visitEachChild(node, visit, context);
    }

    return (sf: ts.SourceFile) => {
      const visited = ts.visitEachChild(sf, visit, context);
      return visited;
    };
  };
}

function transformLoop(
  node: ts.ForStatement | ts.WhileStatement | ts.DoStatement | ts.ForOfStatement,
  factory: ts.NodeFactory,
  maxIterations: number,
  counter: { value: number },
  context: ts.TransformationContext
): ts.Node {
  const guardName = `__osai_guard_${counter.value++}`;

  // Create: let __osai_guard_N = 0;
  const counterDecl = factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          guardName,
          undefined,
          undefined,
          factory.createNumericLiteral(0)
        ),
      ],
      ts.NodeFlags.Let
    )
  );

  // Create the guard check block:
  // __osai_guard_N++;
  // if (__osai_guard_N > maxIterations) throw new Error("Loop guard: exceeded N iterations");
  const increment = factory.createExpressionStatement(
    factory.createPostfixUnaryExpression(
      factory.createIdentifier(guardName),
      ts.SyntaxKind.PlusPlusToken
    )
  );

  const guardCheck = factory.createIfStatement(
    factory.createBinaryExpression(
      factory.createIdentifier(guardName),
      ts.SyntaxKind.GreaterThanToken,
      factory.createNumericLiteral(maxIterations)
    ),
    factory.createThrowStatement(
      factory.createNewExpression(
        factory.createIdentifier('Error'),
        undefined,
        [
          factory.createStringLiteral(
            `Loop guard: exceeded ${maxIterations} iterations`
          ),
        ]
      )
    )
  );

  // Get the existing loop body (may be a block or single statement)
  const existingBody = getLoopBody(node);
  const existingStatements = ts.isBlock(existingBody)
    ? [...existingBody.statements]
    : [existingBody];

  // Build new body with guard + original statements
  const newBody = factory.createBlock(
    [increment, guardCheck, ...existingStatements],
    true
  );

  // Recursively transform nested loops in the new body
  const transformedBody = ts.visitEachChild(
    newBody,
    function visitInner(child: ts.Node): ts.Node {
      if (
        ts.isForStatement(child) ||
        ts.isWhileStatement(child) ||
        ts.isDoStatement(child) ||
        ts.isForOfStatement(child)
      ) {
        return transformLoop(child, factory, maxIterations, counter, context);
      }
      return ts.visitEachChild(child, visitInner, context);
    },
    context
  );

  // Rebuild the loop with the new body
  let newLoop: ts.Statement;

  if (ts.isForStatement(node)) {
    newLoop = factory.updateForStatement(
      node,
      node.initializer,
      node.condition,
      node.incrementor,
      transformedBody
    );
  } else if (ts.isWhileStatement(node)) {
    newLoop = factory.updateWhileStatement(
      node,
      node.expression,
      transformedBody
    );
  } else if (ts.isDoStatement(node)) {
    newLoop = factory.updateDoStatement(
      node,
      transformedBody,
      node.expression
    );
  } else {
    // ForOfStatement
    newLoop = factory.updateForOfStatement(
      node,
      node.awaitModifier,
      node.initializer,
      node.expression,
      transformedBody
    );
  }

  // Return a block containing: counter declaration + guarded loop
  // We wrap in an immediately-invoked block to scope the counter
  return factory.createBlock([counterDecl, newLoop], true);
}

function getLoopBody(
  node: ts.ForStatement | ts.WhileStatement | ts.DoStatement | ts.ForOfStatement
): ts.Statement {
  if (ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isForOfStatement(node)) {
    return node.statement;
  }
  // DoStatement
  return node.statement;
}
