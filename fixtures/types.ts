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

export type { LargeUnion, NamedMember, NamedMemberHolder, NamedRecursiveMember, RecursiveNode };
