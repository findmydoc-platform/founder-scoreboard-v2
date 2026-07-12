"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TableUrlField<Value> = {
  defaultValue: Value;
  parse: (values: string[]) => Value | undefined;
  serialize: (value: Value) => string[];
  equals?: (left: Value, right: Value) => boolean;
};

export type TableUrlSchema<State extends object> = {
  [Key in keyof State]: TableUrlField<State[Key]>;
};

export type TableUrlHistoryMode = "push" | "replace";

function valuesEqual<Value>(field: TableUrlField<Value>, left: Value, right: Value) {
  return field.equals ? field.equals(left, right) : Object.is(left, right);
}

export function stringUrlField(defaultValue = ""): TableUrlField<string> {
  return {
    defaultValue,
    parse: (values) => values[0],
    serialize: (value) => value ? [value] : [],
  };
}

export function dateUrlField(defaultValue = ""): TableUrlField<string> {
  return {
    defaultValue,
    parse: (values) => {
      const value = values[0];
      if (!value) return "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
    },
    serialize: (value) => value ? [value] : [],
  };
}

export function enumUrlField<Value extends string>(defaultValue: Value, values: readonly Value[]): TableUrlField<Value> {
  return {
    defaultValue,
    parse: (rawValues) => values.find((value) => value === rawValues[0]),
    serialize: (value) => [value],
  };
}

export function multiEnumUrlField<Value extends string>(defaultValue: Value[], values: readonly Value[]): TableUrlField<Value[]> {
  return {
    defaultValue,
    parse: (rawValues) => {
      if (!rawValues.length) return undefined;
      const selected = Array.from(new Set(rawValues.filter((value): value is Value => values.includes(value as Value))));
      return selected.length ? selected : undefined;
    },
    serialize: (selected) => selected,
    equals: (left, right) => left.length === right.length && left.every((value, index) => value === right[index]),
  };
}

export function readTableUrlState<State extends object>(namespace: string, schema: TableUrlSchema<State>, params: URLSearchParams): State {
  return Object.fromEntries(Object.entries(schema).map(([key, untypedField]) => {
    const field = untypedField as TableUrlField<unknown>;
    const parsed = field.parse(params.getAll(`${namespace}.${key}`));
    return [key, parsed ?? field.defaultValue];
  })) as State;
}

export function hasTableUrlState<State extends object>(namespace: string, schema: TableUrlSchema<State>, params: URLSearchParams) {
  return Object.keys(schema).some((key) => params.has(`${namespace}.${key}`));
}

export function writeTableUrlState<State extends object>(namespace: string, schema: TableUrlSchema<State>, state: State, params: URLSearchParams) {
  const next = new URLSearchParams(params);
  for (const [key, untypedField] of Object.entries(schema)) {
    const field = untypedField as TableUrlField<unknown>;
    const param = `${namespace}.${key}`;
    next.delete(param);
    const value = state[key as keyof State];
    if (valuesEqual(field, value, field.defaultValue)) continue;
    for (const serialized of field.serialize(value)) next.append(param, serialized);
  }
  return next;
}

export function useTableUrlState<State extends object>({
  namespace,
  schema,
}: {
  namespace: string;
  schema: TableUrlSchema<State>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serializedParams = searchParams.toString();
  const urlState = useMemo(
    () => readTableUrlState(namespace, schema, new URLSearchParams(serializedParams)),
    [namespace, schema, serializedParams],
  );
  const [state, setState] = useState<State>(urlState);
  const stateRef = useRef<State>(urlState);
  const replaceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      stateRef.current = urlState;
      setState(urlState);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [urlState]);

  useEffect(() => () => {
    if (replaceTimerRef.current !== null) window.clearTimeout(replaceTimerRef.current);
  }, []);

  const commit = useCallback((nextState: State, history: TableUrlHistoryMode) => {
    const apply = () => {
      replaceTimerRef.current = null;
      const params = writeTableUrlState(namespace, schema, nextState, new URLSearchParams(window.location.search));
      const query = params.toString();
      const nextUrl = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      window.history[history === "push" ? "pushState" : "replaceState"](null, "", nextUrl);
    };

    if (history === "replace") {
      if (replaceTimerRef.current !== null) window.clearTimeout(replaceTimerRef.current);
      replaceTimerRef.current = window.setTimeout(apply, 180);
      return;
    }
    if (replaceTimerRef.current !== null) {
      window.clearTimeout(replaceTimerRef.current);
      replaceTimerRef.current = null;
    }
    apply();
  }, [namespace, pathname, schema]);

  const updateState = useCallback((patch: Partial<State> | ((current: State) => State), history: TableUrlHistoryMode = "push") => {
    const current = stateRef.current;
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    stateRef.current = next;
    setState(next);
    commit(next, history);
  }, [commit]);

  const resetState = useCallback(() => {
    const defaults = readTableUrlState(namespace, schema, new URLSearchParams());
    stateRef.current = defaults;
    setState(defaults);
    commit(defaults, "push");
  }, [commit, namespace, schema]);

  return {
    state,
    updateState,
    resetState,
    hasUrlState: hasTableUrlState(namespace, schema, new URLSearchParams(serializedParams)),
  };
}
