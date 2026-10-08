import { prisma } from "@/lib/prisma";
import { storedToDisplay, type DefinedField } from "@/lib/values";

export type StoreNode = {
  id: string;
  label: string;
  hint: string;
  locationId?: string;
  children: StoreNode[];
};

export async function buildStoreTargets(fieldId: string): Promise<StoreNode[]> {
  const [field, labelFields, locations] = await Promise.all([
    prisma.fieldDefinition.findUnique({ where: { id: fieldId }, include: { options: true } }),
    prisma.fieldDefinition.findMany({
      where: { key: { in: ["name", "state", "city"] } },
      include: { options: true },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      include: { values: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!field) return [];
  const byKey = new Map(labelFields.map((item) => [item.key, item]));
  const nameField = byKey.get("name");
  const stateField = byKey.get("state");
  const cityField = byKey.get("city");

  const textOf = (values: (typeof locations)[number]["values"], source: DefinedField | undefined) => {
    if (!source) return "";
    return storedToDisplay(source, values.find((value) => value.fieldId === source.id));
  };

  const grouped = new Map<string, Map<string, StoreNode[]>>();
  for (const location of locations) {
    const state = textOf(location.values, stateField) || "No state";
    const city = textOf(location.values, cityField) || "No city";
    const name = textOf(location.values, nameField) || "Untitled dimension";
    const current = storedToDisplay(field, location.values.find((value) => value.fieldId === field.id));
    const cities = grouped.get(state) ?? new Map<string, StoreNode[]>();
    const stores = cities.get(city) ?? [];
    stores.push({
      id: location.id,
      label: name,
      hint: current ? `Current: ${current}` : "Empty",
      locationId: location.id,
      children: [],
    });
    cities.set(city, stores);
    grouped.set(state, cities);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, cities]) => {
      const cityNodes = [...cities.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([city, stores]) => ({
          id: `city:${state}:${city}`,
          label: city,
          hint: `${stores.length} ${stores.length === 1 ? "dimension" : "dimensions"}`,
          children: stores.sort((left, right) => left.label.localeCompare(right.label)),
        }));
      const storeCount = cityNodes.reduce((count, city) => count + city.children.length, 0);
      return {
        id: `state:${state}`,
        label: state,
        hint: `${storeCount} ${storeCount === 1 ? "dimension" : "dimensions"}`,
        children: cityNodes,
      };
    });
}
