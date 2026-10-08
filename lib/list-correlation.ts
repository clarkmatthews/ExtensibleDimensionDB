export type ListChoice = {
  label: string;
  value: string;
  parentValues?: string;
};

export function isListType(dataType: string) {
  return dataType === "DROPDOWN" || dataType === "RADIO";
}

export function correlationLoops(parentId: string, selfId: string, parentOf: (id: string) => string) {
  if (!selfId || !parentId) return false;
  let cursor = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === selfId || seen.has(cursor)) return cursor === selfId;
    seen.add(cursor);
    cursor = parentOf(cursor);
  }
  return false;
}

export function parentTokens(parentValue: string) {
  return parentValue.split("|").map((value) => value.trim()).filter(Boolean);
}

export function choicesForParent(options: ListChoice[], parentValue: string, correlated: boolean) {
  if (!correlated) return options;
  const selected = new Set(parentTokens(parentValue));
  if (!selected.size) return [];
  return options.filter((option) => {
    const parents = parentTokens(option.parentValues ?? "");
    if (!parents.length) return true;
    return parents.some((value) => selected.has(value));
  });
}
