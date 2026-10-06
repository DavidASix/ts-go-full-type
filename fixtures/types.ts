type LargeUnion =
  | { kind: "a"; value: string }
  | { kind: "b"; value: number }
  | { kind: "c"; value: boolean }
  | { kind: "d"; value: Date }
  | { kind: "e"; value: bigint }
  | { kind: "f"; value: symbol }
  | { kind: "g"; value: null }
  | { kind: "h"; value: undefined }
  | { kind: "i"; value: string[] }
  | { kind: "j"; value: readonly [string, number] }
  | { kind: "k"; value: { nested: true } }
  | { kind: "l"; value: unknown };

type RecursiveNode = {
  value: string;
  children: RecursiveNode[];
};

type NamedMember =
  | { kind: "plain"; value: string }
  | NamedRecursiveMember;

type NamedRecursiveMember = {
  kind: "recursive";
  child: NamedMember;
};

type NamedMemberHolder = {
  member: NamedRecursiveMember;
};

type CallSiteType = {
  fromDefinition: string;
  nested: { count: number };
};

const selectedVariable: CallSiteType = {
  fromDefinition: "fixture",
  nested: { count: 1 },
};

export {
  type CallSiteType,
  type LargeUnion,
  type NamedMember,
  type NamedMemberHolder,
  type NamedRecursiveMember,
  type RecursiveNode,
  selectedVariable,
};

// Shapes used to verify that every compound branch can reach its primitive leaves.
type TreeFixture = {
  nested: { child: { value: string } };
  alternatives: { name: string } | { count: number };
  values: string[];
  pair: readonly [name: string, count?: number];
  lookup: Record<string, { enabled: boolean }>;
  handler: (input: { id: string }) => { result: number };
  factory: new (name: string) => { id: string };
  phantom: Phantom<{ value: number }>;
};

type GenericTree<T extends { id: string }> = {
  value: T;
  key: keyof T;
  indexed: T[keyof T];
  conditional: T extends { id: string } ? { yes: string } : { no: number };
  template: `id-${T["id"]}`;
  mapped: Uppercase<T["id"]>;
};

class Phantom<T> {}
