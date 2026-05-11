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
  const ability = useMemo(
    () => createMongoAbility<AppAbility>(rules),
    [rules],
  );
  return (
    <AbilityContext.Provider value={ability}>
      {children}
    </AbilityContext.Provider>
  );
}
