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

export type ModifierFixture = {
  readonly value: string;
  readonly nested?: { readonly count: number };
  mutable: number;
};
export type MappedReadonlyFixture = Readonly<{ value: string }>;
export type MappedMutableFixture = { -readonly [K in keyof ModifierFixture]: ModifierFixture[K] };
export class GetterFixture {
  get value(): string { return "value"; }
  get mutable(): string { return "mutable"; }
  set mutable(value: string) { void value; }
}

interface CopyPayload { expandedCopyField: string; }
interface CopyInput { expandedInputField: number; }
interface CopyCallable {
  readonly metadata?: CopyPayload;
  (input: CopyInput): CopyPayload;
}
interface CopyConstructor { new (input: CopyInput): CopyPayload; }
interface CopyIndex { readonly [key: string]: CopyPayload; }

type CopyRegressionFixture = {
  namedCall: CopyCallable;
  namedConstruct: CopyConstructor;
  namedIndex: CopyIndex;
  methods: { (): void; get(input?: CopyInput): CopyPayload; };
  numeric: { (): void; 0: CopyPayload; };
};
