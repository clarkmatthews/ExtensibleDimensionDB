import { prisma } from "@/lib/prisma";

const UNITED_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
]);

export type PlaceChoice = { label: string; value: string };

export async function ensurePlaceCatalog() {
  const stateList = await prisma.choiceList.findFirst({ where: { choiceSource: "US_STATE" }, select: { id: true } });
  const cityList = await prisma.choiceList.findFirst({ where: { choiceSource: "US_CITY" }, select: { id: true } });
  if (!stateList || !cityList) return;
  await prisma.choiceList.updateMany({
    where: { id: stateList.id, description: "The 50 states and Washington, D.C." },
    data: { description: "Add, rename, or remove states. Cities stay mapped to the state name." },
  });
  await prisma.choiceList.updateMany({
    where: { id: cityList.id, description: "Cities in the correlated US state." },
    data: { description: "Cities mapped to each state. Add a city when a state gains one." },
  });
  const [stateCount, cityCount] = await Promise.all([
    prisma.choiceListItem.count({ where: { listId: stateList.id } }),
    prisma.choiceListItem.count({ where: { listId: cityList.id } }),
  ]);
  if (stateCount > 0 && cityCount > 0) return;
  const { City, State } = await import("country-state-city");
  const states = State.getStatesOfCountry("US")
    .filter((state) => UNITED_STATES.has(state.isoCode))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (stateCount === 0) {
    await prisma.choiceListItem.createMany({
      data: states.map((state, index) => ({
        listId: stateList.id,
        label: state.name,
        value: state.name,
        sortOrder: index,
      })),
    });
  }
  if (cityCount === 0) {
    const rows: { listId: string; label: string; value: string; parentValues: string; sortOrder: number }[] = [];
    for (const state of states) {
      const names = [...new Set(City.getCitiesOfState("US", state.isoCode).map((city) => city.name))].sort((left, right) =>
        left.localeCompare(right),
      );
      names.forEach((name, index) => {
        rows.push({ listId: cityList.id, label: name, value: name, parentValues: state.name, sortOrder: index });
      });
    }
    for (let index = 0; index < rows.length; index += 500) {
      await prisma.choiceListItem.createMany({ data: rows.slice(index, index + 500) });
    }
  }
  await prisma.choiceList.update({ where: { id: cityList.id }, data: { parentListId: stateList.id } });
}

export async function usStateChoices(): Promise<PlaceChoice[]> {
  const list = await prisma.choiceList.findFirst({
    where: { choiceSource: "US_STATE", isActive: true },
    select: { id: true },
  });
  if (!list) return [];
  const items = await prisma.choiceListItem.findMany({
    where: { listId: list.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { label: true, value: true },
  });
  return items.map((item) => ({ label: item.label, value: item.value }));
}

export async function usCityChoices(stateName: string): Promise<PlaceChoice[]> {
  const name = stateName.trim();
  if (!name) return [];
  const list = await prisma.choiceList.findFirst({
    where: { choiceSource: "US_CITY", isActive: true },
    select: { id: true },
  });
  if (!list) return [];
  const items = await prisma.choiceListItem.findMany({
    where: { listId: list.id, isActive: true, parentValues: name },
    orderBy: [{ label: "asc" }],
    select: { label: true, value: true },
  });
  return items.map((item) => ({ label: item.label, value: item.value }));
}

export async function usCityExists(cityName: string) {
  const name = cityName.trim();
  if (!name) return false;
  const list = await prisma.choiceList.findFirst({ where: { choiceSource: "US_CITY", isActive: true }, select: { id: true } });
  if (!list) return false;
  const found = await prisma.choiceListItem.findFirst({
    where: { listId: list.id, isActive: true, value: name },
    select: { id: true },
  });
  return Boolean(found);
}

export async function placeChoices(source: string, stateName: string): Promise<PlaceChoice[] | null> {
  if (source === "US_STATE") return usStateChoices();
  if (source === "US_CITY") return usCityChoices(stateName);
  return null;
}
