"use client";

import { createContext, useMemo, type ReactNode } from "react";
import { createMongoAbility, type RawRuleOf } from "@casl/ability";
import { createContextualCan } from "@casl/react";
import type { AppAbility } from "./types";

export const AbilityContext = createContext<AppAbility>(
  createMongoAbility([]) as AppAbility,
);
export const Can = createContextualCan(AbilityContext.Consumer);

export function AbilityProvider({
  rules,
  children,
}: {
  rules: RawRuleOf<AppAbility>[];
  children: ReactNode;
}) {
  // Stabilise the dependency on the serialised content of rules, not the
  // array reference. RSC passes a fresh array object on every render even
  // when the rules are unchanged; comparing by JSON string prevents
  // unnecessary ability reconstruction and downstream re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rulesKey = useMemo(() => JSON.stringify(rules), [JSON.stringify(rules)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ability = useMemo(() => createMongoAbility<AppAbility>(rules), [rulesKey]);
  return (
    <AbilityContext.Provider value={ability}>
      {children}
    </AbilityContext.Provider>
  );
}
