import type { TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import * as tsutils from 'ts-api-utils';
import type { Type } from 'typescript';

import { createRule, getParserServices } from '../util';

export type Options = [
  {
    ignoreIntersections?: boolean;
    ignoreUnions?: boolean;
  },
];

export type MessageIds = 'duplicate';

const astIgnoreKeys = new Set(['range', 'loc', 'parent']);

const isSameAstNode = (actualNode: unknown, expectedNode: unknown): boolean => {
  if (actualNode === expectedNode) {
    return true;
  }
  if (
    actualNode &&
    expectedNode &&
    typeof actualNode === 'object' &&
    typeof expectedNode === 'object'
  ) {
    if (Array.isArray(actualNode) && Array.isArray(expectedNode)) {
      if (actualNode.length !== expectedNode.length) {
        return false;
      }
      return !actualNode.some(
        (nodeEle, index) => !isSameAstNode(nodeEle, expectedNode[index]),
      );
    }
    const actualNodeKeys = Object.keys(actualNode).filter(
      key => !astIgnoreKeys.has(key),
    );
    const expectedNodeKeys = Object.keys(expectedNode).filter(
      key => !astIgnoreKeys.has(key),
    );
    if (actualNodeKeys.length !== expectedNodeKeys.length) {
      return false;
    }
    if (
      actualNodeKeys.some(
        actualNodeKey => !Object.hasOwn(expectedNode, actualNodeKey),
      )
    ) {
      return false;
    }
    if (
      actualNodeKeys.some(
        actualNodeKey =>
          !isSameAstNode(
            actualNode[actualNodeKey as keyof typeof actualNode],
            expectedNode[actualNodeKey as keyof typeof expectedNode],
          ),
      )
    ) {
      return false;
    }
    return true;
  }
  return false;
};

export default createRule<Options, MessageIds>({
  name: 'no-duplicate-type-constituents',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow duplicate constituents of union or intersection types',
      recommended: 'recommended',
      requiresTypeChecking: true,
    },
    fixable: 'code',
    messages: {
      duplicate: '{{type}} type constituent is duplicated with {{previous}}.',
    },
    schema: [
      {
        additionalProperties: false,
        type: 'object',
        properties: {
          ignoreIntersections: {
            description: 'Whether to ignore `&` intersections.',
            type: 'boolean',
          },
          ignoreUnions: {
            description: 'Whether to ignore `|` unions.',
            type: 'boolean',
          },
        },
      },
    ],
  },
  defaultOptions: [
    {
      ignoreIntersections: false,
      ignoreUnions: false,
    },
  ],
  create(context, [{ ignoreIntersections, ignoreUnions }]) {
    const parserServices = getParserServices(context);

    function checkDuplicate(
      node: TSESTree.TSIntersectionType | TSESTree.TSUnionType,
    ): void {
      const cachedTypeMap = new Map<Type, TSESTree.TypeNode>();
      node.types.reduce<TSESTree.TypeNode[]>(
        (uniqueConstituents, constituentNode) => {
          const constituentNodeType =
            parserServices.getTypeAtLocation(constituentNode);
          if (tsutils.isIntrinsicErrorType(constituentNodeType)) {
            return uniqueConstituents;
          }

          const duplicatedPreviousConstituentInAst = uniqueConstituents.find(
            ele => isSameAstNode(ele, constituentNode),
          );
          if (duplicatedPreviousConstituentInAst) {
            reportDuplicate(
              {
                duplicated: constituentNode,
                duplicatePrevious: duplicatedPreviousConstituentInAst,
              },
              node,
            );
            return uniqueConstituents;
          }
          const duplicatedPreviousConstituentInType =
            cachedTypeMap.get(constituentNodeType);
          if (duplicatedPreviousConstituentInType) {
            reportDuplicate(
              {
                duplicated: constituentNode,
                duplicatePrevious: duplicatedPreviousConstituentInType,
              },
              node,
            );
            return uniqueConstituents;
          }
          cachedTypeMap.set(constituentNodeType, constituentNode);
          return [...uniqueConstituents, constituentNode];
        },
        [],
      );
    }
    function reportDuplicate(
      duplicateConstituent: {
        duplicated: TSESTree.TypeNode;
        duplicatePrevious: TSESTree.TypeNode;
      },
      parentNode: TSESTree.TSIntersectionType | TSESTree.TSUnionType,
    ): void {
      const beforeTokens = context.sourceCode.getTokensBefore(
        duplicateConstituent.duplicated,
        { filter: token => token.value === '|' || token.value === '&' },
      );
      const beforeUnionOrIntersectionToken =
        beforeTokens[beforeTokens.length - 1];
      const bracketBeforeTokens = context.sourceCode.getTokensBetween(
        beforeUnionOrIntersectionToken,
        duplicateConstituent.duplicated,
      );
      const bracketAfterTokens = context.sourceCode.getTokensAfter(
        duplicateConstituent.duplicated,
        { count: bracketBeforeTokens.length },
      );
      const reportLocation: TSESTree.SourceLocation = {
        start: duplicateConstituent.duplicated.loc.start,
        end:
          bracketAfterTokens.length > 0
            ? bracketAfterTokens[bracketAfterTokens.length - 1].loc.end
            : duplicateConstituent.duplicated.loc.end,
      };
      context.report({
        data: {
          type:
            parentNode.type === AST_NODE_TYPES.TSIntersectionType
              ? 'Intersection'
              : 'Union',
          previous: context.sourceCode.getText(
            duplicateConstituent.duplicatePrevious,
          ),
        },
        messageId: 'duplicate',
        node: duplicateConstituent.duplicated,
        loc: reportLocation,
        fix: fixer => {
          return [
            beforeUnionOrIntersectionToken,
            ...bracketBeforeTokens,
            duplicateConstituent.duplicated,
            ...bracketAfterTokens,
          ].map(token => fixer.remove(token));
        },
      });
    }
    return {
      ...(!ignoreIntersections && {
        TSIntersectionType: checkDuplicate,
      }),
      ...(!ignoreUnions && {
        TSUnionType: checkDuplicate,
      }),
    };
  },
});
