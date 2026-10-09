import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient, type ChoiceSource, type DataType } from "@prisma/client";
import { ensurePlaceCatalog } from "@/lib/place-catalog";

const prisma = new PrismaClient();

type FieldSeed = {
  key: string;
  friendlyName: string;
  description: string;
  dataType: DataType;
  maxLength?: number;
  isRequired?: boolean;
  isStoreKey?: boolean;
  isActiveFilter?: boolean;
  isCreatedDate?: boolean;
  isActive?: boolean;
  choiceSource?: ChoiceSource;
  defaultValue?: string;
  formatExample?: string;
  checkboxLabel?: string;
};

const generalFields: FieldSeed[] = [
  { key: "name", friendlyName: "Name", description: "Restaurant name", dataType: "TEXT", maxLength: 100, isRequired: true, isStoreKey: true, formatExample: "Mesa Verde Grill" },
  { key: "cuisine_type", friendlyName: "Cuisine Type", description: "Style of food served", dataType: "TEXT", maxLength: 50, formatExample: "Mexican" },
  { key: "phone_number", friendlyName: "Phone Number", description: "Main phone number", dataType: "PHONE", maxLength: 20, formatExample: "480-555-0142" },
  { key: "email", friendlyName: "Email", description: "Public email address", dataType: "EMAIL", maxLength: 100, formatExample: "hello@mesaverdegrill.example" },
  { key: "address_line1", friendlyName: "Address Line 1", description: "Street address", dataType: "ADDRESS", maxLength: 150, isRequired: true, formatExample: "1840 E Camelback Rd" },
  { key: "address_line2", friendlyName: "Address Line 2", description: "Suite, floor, or unit", dataType: "ADDRESS", maxLength: 100, formatExample: "Suite 12" },
  { key: "city", friendlyName: "City", description: "US city. Choices follow the selected state.", dataType: "DROPDOWN", isRequired: true, choiceSource: "US_CITY", formatExample: "Phoenix" },
  { key: "state", friendlyName: "State", description: "US state", dataType: "DROPDOWN", isRequired: true, choiceSource: "US_STATE", formatExample: "Arizona" },
  { key: "postal_code", friendlyName: "Postal Code", description: "Postal code", dataType: "TEXT", maxLength: 20, isRequired: true, formatExample: "85016" },
  { key: "country", friendlyName: "Country", description: "Country", dataType: "TEXT", maxLength: 50, isActive: false },
  { key: "is_active", friendlyName: "Active", description: "Whether the restaurant is open", dataType: "CHECKBOX", defaultValue: "1", checkboxLabel: "Active", isActiveFilter: true },
  { key: "created_at", friendlyName: "Created At", description: "Date the dimension was added. Filled in automatically.", dataType: "DATE", isCreatedDate: true },
];

const restaurants: Record<string, string>[] = [
  { name: "Mesa Verde Grill", cuisine_type: "Mexican", phone_number: "480-555-0142", email: "hello@mesaverdegrill.example", address_line1: "1840 E Camelback Rd", address_line2: "Suite 12", city: "Phoenix", state: "Arizona", postal_code: "85016", country: "United States", is_active: "1", created_at: "2018-04-12" },
  { name: "Harbor & Rye", cuisine_type: "American", phone_number: "206-555-0198", email: "dining@harborandrye.example", address_line1: "412 Alaskan Way", address_line2: "", city: "Seattle", state: "Washington", postal_code: "98104", country: "United States", is_active: "1", created_at: "2016-09-03" },
  { name: "Little Lantern", cuisine_type: "Chinese", phone_number: "415-555-0166", email: "night@littlelantern.example", address_line1: "88 Waverly Pl", address_line2: "Floor 2", city: "San Francisco", state: "California", postal_code: "94108", country: "United States", is_active: "1", created_at: "2014-11-21" },
  { name: "Cinder Oven", cuisine_type: "Pizza", phone_number: "312-555-0174", email: "oven@cinderoven.example", address_line1: "2105 N Milwaukee Ave", address_line2: "", city: "Chicago", state: "Illinois", postal_code: "60647", country: "United States", is_active: "1", created_at: "2019-06-18" },
  { name: "Saffron House", cuisine_type: "Indian", phone_number: "214-555-0133", email: "table@saffronhouse.example", address_line1: "4512 McKinney Ave", address_line2: "", city: "Dallas", state: "Texas", postal_code: "75205", country: "United States", is_active: "1", created_at: "2017-02-09" },
  { name: "Bluefin Counter", cuisine_type: "Seafood", phone_number: "617-555-0181", email: "catch@bluefincounter.example", address_line1: "75 Salem St", address_line2: "", city: "Boston", state: "Massachusetts", postal_code: "02113", country: "United States", is_active: "1", created_at: "2021-08-14" },
  { name: "The Copper Pot", cuisine_type: "Southern", phone_number: "404-555-0127", email: "hello@thecopperpot.example", address_line1: "675 Ponce de Leon Ave", address_line2: "Unit B", city: "Atlanta", state: "Georgia", postal_code: "30308", country: "United States", is_active: "1", created_at: "2015-05-27" },
  { name: "Nori & Co", cuisine_type: "Japanese", phone_number: "503-555-0190", email: "hi@noriandco.example", address_line1: "920 NW 11th Ave", address_line2: "", city: "Portland", state: "Oregon", postal_code: "97209", country: "United States", is_active: "1", created_at: "2020-01-30" },
  { name: "Red Wagon Diner", cuisine_type: "American", phone_number: "303-555-0114", email: "closed@redwagondiner.example", address_line1: "1416 Larimer St", address_line2: "", city: "Denver", state: "Colorado", postal_code: "80202", country: "United States", is_active: "0", created_at: "2011-03-04" },
];

function storedValue(dataType: DataType, raw: string) {
  if (dataType === "CHECKBOX") {
    return { valueText: null, valueNumber: null, valueBoolean: raw === "1", valueDateTime: null };
  }
  if (dataType === "DATE") {
    const day = raw.slice(0, 10);
    return { valueText: day || null, valueNumber: null, valueBoolean: null, valueDateTime: day ? new Date(`${day}T12:00:00Z`) : null };
  }
  if (dataType === "DATETIME") {
    return { valueText: raw, valueNumber: null, valueBoolean: null, valueDateTime: raw ? new Date(raw) : null };
  }
  return { valueText: raw || null, valueNumber: null, valueBoolean: null, valueDateTime: null };
}

function initialAdminPassword() {
  const configured = process.env.ADMIN_PASSWORD?.trim();
  if (configured) return configured;
  let password = "";
  do {
    password = `Kv${randomBytes(12).toString("base64url")}!9`;
  } while (password.toLowerCase().includes("admin"));
  console.log(`Created admin@local. One-time password: ${password}`);
  return password;
}

async function main() {
  const email = "admin@local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: "Administrator",
        passwordHash: await hash(initialAdminPassword(), 10),
        isAdmin: true,
        canDefineWorkflows: true,
      },
    });
  } else {
    await prisma.user.update({
      where: { email },
      data: { isAdmin: true, isActive: true, name: "Administrator" },
    });
  }

  // The first record type. The migration creates it on existing databases; this covers new ones.
  const recordType = await prisma.recordType.upsert({
    where: { id: "location" },
    update: {},
    create: { id: "location", name: "Location", description: "The records this database started with.", sortOrder: 1 },
  });

  const category = await prisma.category.upsert({
    where: { id: (await prisma.category.findFirst({ where: { name: "General" } }))?.id ?? "missing-general" },
    update: { description: "Core restaurant information", isActive: true },
    create: { name: "General", description: "Core restaurant information", sortOrder: 1, recordTypeId: recordType.id },
  });

  await prisma.fieldDefinition.updateMany({
    data: { isStoreKey: false },
    where: { isStoreKey: true, key: { not: "name" }, category: { recordTypeId: category.recordTypeId } },
  });

  const fields = [];
  for (const [index, field] of generalFields.entries()) {
    const saved = await prisma.fieldDefinition.upsert({
      where: { key: field.key },
      update: {
        friendlyName: field.friendlyName,
        description: field.description,
        dataType: field.dataType,
        categoryId: category.id,
        sortOrder: index,
        isActive: field.isActive ?? true,
        isRequired: field.isRequired ?? false,
        isStoreKey: field.isStoreKey ?? false,
        isActiveFilter: field.isActiveFilter ?? false,
        isCreatedDate: field.isCreatedDate ?? false,
        choiceSource: field.choiceSource ?? "MANUAL",
        defaultValue: field.defaultValue ?? "",
        formatExample: field.formatExample ?? "",
        maxLength: field.maxLength ?? null,
        checkboxLabel: field.checkboxLabel ?? "",
      },
      create: {
        key: field.key,
        friendlyName: field.friendlyName,
        description: field.description,
        dataType: field.dataType,
        categoryId: category.id,
        sortOrder: index,
        isActive: field.isActive ?? true,
        isRequired: field.isRequired ?? false,
        isStoreKey: field.isStoreKey ?? false,
        isActiveFilter: field.isActiveFilter ?? false,
        isCreatedDate: field.isCreatedDate ?? false,
        choiceSource: field.choiceSource ?? "MANUAL",
        defaultValue: field.defaultValue ?? "",
        formatExample: field.formatExample ?? "",
        maxLength: field.maxLength ?? null,
        checkboxLabel: field.checkboxLabel ?? "",
      },
    });
    fields.push(saved);
  }

  const stateField = fields.find((field) => field.key === "state");
  const cityField = fields.find((field) => field.key === "city");
  if (stateField && cityField && !cityField.parentFieldId) {
    await prisma.fieldDefinition.update({ where: { id: cityField.id }, data: { parentFieldId: stateField.id } });
  }

  const stateList = await prisma.choiceList.upsert({
    where: { id: "list_us_states" },
    update: {},
    create: {
      id: "list_us_states",
      name: "US States",
      description: "Add, rename, or remove states. Cities stay mapped to the state name.",
      choiceSource: "US_STATE",
    },
  });
  const cityList = await prisma.choiceList.upsert({
    where: { id: "list_us_cities" },
    update: {},
    create: {
      id: "list_us_cities",
      name: "US Cities",
      description: "Cities mapped to each state. Add a city when a state gains one.",
      choiceSource: "US_CITY",
      parentListId: stateList.id,
    },
  });
  if (stateField) {
    await prisma.fieldDefinition.updateMany({ where: { id: stateField.id, choiceListId: null }, data: { choiceListId: stateList.id } });
  }
  if (cityField) {
    await prisma.fieldDefinition.updateMany({ where: { id: cityField.id, choiceListId: null }, data: { choiceListId: cityList.id } });
  }
  await ensurePlaceCatalog();

  const nameField = fields.find((field) => field.key === "name");
  if (!nameField) return;

  for (const restaurant of restaurants) {
    const existing = await prisma.fieldValue.findFirst({
      where: { fieldId: nameField.id, valueText: restaurant.name },
    });
    const location = existing
      ? await prisma.location.findUniqueOrThrow({ where: { id: existing.locationId } })
      : await prisma.location.create({ data: { recordTypeId: category.recordTypeId } });

    for (const field of fields) {
      const raw = restaurant[field.key] ?? "";
      const value = storedValue(field.dataType, raw);
      await prisma.fieldValue.upsert({
        where: { locationId_fieldId: { locationId: location.id, fieldId: field.id } },
        update: value,
        create: { locationId: location.id, fieldId: field.id, ...value },
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
