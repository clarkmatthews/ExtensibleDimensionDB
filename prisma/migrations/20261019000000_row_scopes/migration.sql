-- Named scopes limit which records a person can see. A record type with no rule stays fully visible.

CREATE TYPE "ScopeRuleKind" AS ENUM ('RECORDS', 'ATTRIBUTE');

CREATE TABLE "Scope" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScopeAssignment" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "ScopeAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScopeRule" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "recordTypeId" TEXT NOT NULL,
    "kind" "ScopeRuleKind" NOT NULL,
    "fieldId" TEXT,
    "sourceRuleId" TEXT,

    CONSTRAINT "ScopeRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScopeRuleRecord" (
    "ruleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "ScopeRuleRecord_pkey" PRIMARY KEY ("ruleId","locationId")
);

CREATE TABLE "ScopeRuleValue" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "valueText" TEXT NOT NULL,

    CONSTRAINT "ScopeRuleValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScopeAssignment_scopeId_subjectType_subjectId_key" ON "ScopeAssignment"("scopeId", "subjectType", "subjectId");
CREATE INDEX "ScopeAssignment_subjectType_subjectId_idx" ON "ScopeAssignment"("subjectType", "subjectId");
CREATE INDEX "ScopeRule_scopeId_recordTypeId_idx" ON "ScopeRule"("scopeId", "recordTypeId");
CREATE INDEX "ScopeRuleRecord_locationId_idx" ON "ScopeRuleRecord"("locationId");
CREATE UNIQUE INDEX "ScopeRuleValue_ruleId_valueText_key" ON "ScopeRuleValue"("ruleId", "valueText");

ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeRule" ADD CONSTRAINT "ScopeRule_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeRule" ADD CONSTRAINT "ScopeRule_recordTypeId_fkey" FOREIGN KEY ("recordTypeId") REFERENCES "RecordType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeRule" ADD CONSTRAINT "ScopeRule_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScopeRule" ADD CONSTRAINT "ScopeRule_sourceRuleId_fkey" FOREIGN KEY ("sourceRuleId") REFERENCES "ScopeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScopeRuleRecord" ADD CONSTRAINT "ScopeRuleRecord_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ScopeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeRuleRecord" ADD CONSTRAINT "ScopeRuleRecord_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeRuleValue" ADD CONSTRAINT "ScopeRuleValue_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ScopeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
