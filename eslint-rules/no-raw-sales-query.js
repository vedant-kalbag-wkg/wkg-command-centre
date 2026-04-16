'use strict';

/**
 * ESLint rule: `wkg/no-raw-sales-query`
 *
 * Flags Drizzle queries against `salesRecords` that don't pass through
 * `scopedSalesCondition()` in the same function. This is the belt-and-braces
 * enforcement for the scoping backbone (see `src/lib/scoping/scoped-query.ts`).
 *
 * Triggers on any of:
 *   db.select().from(salesRecords)
 *   db.delete(salesRecords)
 *   db.update(salesRecords)
 *   db.insert(salesRecords)
 *
 * Suppress individual cases with:
 *   // eslint-disable-next-line wkg/no-raw-sales-query -- <reason>
 *
 * Allow-list entire files at the ESLint config level — tests, seeds, the
 * scoping lib itself, and the schema file are all expected to access
 * `salesRecords` directly without going through scopedSalesCondition.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require scopedSalesCondition when querying salesRecords outside of allow-listed paths',
    },
    schema: [],
    messages: {
      rawSalesQuery:
        'Direct `salesRecords` queries must go through `scopedSalesCondition()`. ' +
        'Call it first and pass the result into `.where()`, or suppress with ' +
        '`// eslint-disable-next-line wkg/no-raw-sales-query -- <reason>`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      CallExpression(node) {
        if (!isSalesRecordsArgument(node)) return;

        const functionScope = enclosingFunction(node);
        if (functionScope && containsScopedCall(functionScope)) return;

        context.report({ node, messageId: 'rawSalesQuery' });
      },
    };

    /**
     * Returns true if `node` is a call like:
     *   .from(salesRecords)
     *   .delete(salesRecords)
     *   .update(salesRecords)
     *   .insert(salesRecords)
     */
    function isSalesRecordsArgument(node) {
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return false;
      const prop = callee.property;
      if (!prop || prop.type !== 'Identifier') return false;
      if (!['from', 'delete', 'update', 'insert'].includes(prop.name)) return false;
      const args = node.arguments;
      if (args.length === 0) return false;
      const arg = args[0];
      return arg.type === 'Identifier' && arg.name === 'salesRecords';
    }

    function enclosingFunction(node) {
      let current = node.parent;
      while (current) {
        if (
          current.type === 'FunctionDeclaration' ||
          current.type === 'FunctionExpression' ||
          current.type === 'ArrowFunctionExpression'
        ) {
          return current;
        }
        current = current.parent;
      }
      return null;
    }

    function containsScopedCall(funcNode) {
      const text = sourceCode.getText(funcNode);
      // Simple textual check — good enough for a linter, avoids a full AST walk
      // and allows the call to live anywhere in the enclosing function body.
      return /scopedSalesCondition\s*\(/.test(text);
    }
  },
};
